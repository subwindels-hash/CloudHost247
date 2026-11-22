/**
 * The only code in the WHMCS layer that performs network I/O.
 *
 * Why a transport interface rather than `fetch` inline: every failure mode this project has to
 * prove (timeout, 500, HTML error page, truncated body, a redirect sign-in wall) is a behaviour of
 * the wire, and a test can only prove it if the wire is replaceable. `fetchTransport` is the
 * production implementation; `tests/unit/whmcs-client.test.ts` passes fakes.
 *
 * Hardening choices:
 *   - the request body is form-encoded (`application/x-www-form-urlencoded`), which is what WHMCS's
 *     `includes/api.php` reads for `identifier`/`secret`/`action`;
 *   - redirects are NOT followed: an invalid API endpoint commonly answers 302 to a login page, and
 *     following it would turn a clear "not configured" into a confusing HTML parse error;
 *   - the response is capped, because a login page or a stack trace can be megabytes;
 *   - the timeout is enforced by an AbortSignal as well as by the socket, because a hung server that
 *     trickles bytes would otherwise defeat a plain timeout.
 */

import { WhmcsTimeoutError, WhmcsUnreachableError } from './errors';

export interface TransportRequest {
  url: string;
  /** Already-encoded form body. Callers build it in one place (client.ts) so secrets travel once. */
  body: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}

export interface TransportResponse {
  status: number;
  body: string;
}

export interface Transport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

export const MAX_RESPONSE_BYTES = 1024 * 1024;

export class FetchTransport implements Transport {
  async send(request: TransportRequest): Promise<TransportResponse> {
    const signal = AbortSignal.timeout(request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': 'CloudHost247-WHMCS/1.0',
          ...request.headers,
        },
        body: request.body,
        signal,
      });
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        // Do not await cancellation: a broken stream must not hold the caller indefinitely.
        void response.body?.cancel().catch(() => undefined);
        throw new WhmcsUnreachableError(request.url, 'response larger than the 1 MiB cap');
      }
      if (!response.body) return { status: response.status, body: '' };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) {
            void reader.cancel().catch(() => undefined);
            throw new WhmcsUnreachableError(request.url, 'response larger than the 1 MiB cap');
          }
          parts.push(decoder.decode(chunk.value, { stream: true }));
        }
        parts.push(decoder.decode());
        return { status: response.status, body: parts.join('') };
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof WhmcsTimeoutError || error instanceof WhmcsUnreachableError) throw error;
      const name = (error as { name?: string } | null)?.name;
      if (signal.aborted || name === 'TimeoutError' || name === 'AbortError') {
        throw new WhmcsTimeoutError(request.url, request.timeoutMs);
      }
      // Do not retain raw transport/body exception messages, which can contain untrusted data.
      throw new WhmcsUnreachableError(request.url, 'network or response stream error');
    }
  }
}

export const defaultTransport: Transport = new FetchTransport();
