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
    let response: Response;
    try {
      response = await fetch(request.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': 'CloudHost247-WHMCS/1.0',
          ...request.headers,
        },
        body: request.body,
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new WhmcsTimeoutError(request.url, request.timeoutMs);
      }
      throw new WhmcsUnreachableError(request.url, String((error as Error | null)?.message ?? 'network error'));
    }

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      // Drain nothing: refusing early keeps a hostile/huge body out of memory.
      throw new WhmcsUnreachableError(request.url, 'response larger than the 1 MiB cap');
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new WhmcsUnreachableError(request.url, 'response larger than the 1 MiB cap');
    }
    return { status: response.status, body: text };
  }
}

export const defaultTransport: Transport = new FetchTransport();
