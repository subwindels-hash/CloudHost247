/**
 * The single HTTP entry point for every provider adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/http.ts, with one addition this build
 * needs: the transport is injectable (`options.transport`), which is what lets the test-suite drive
 * an adapter against a local fake provider — real code path, real HTTP, no credentials and no
 * egress to a provider.
 *
 * Nothing in here logs. Request headers and bodies carry credentials, so the only thing that leaves
 * on failure is the classified code plus a bounded, sanitized provider response.
 */
'use strict';

const { ProviderError, classifyStatus } = require('./types');

function classifyProviderErrorBody(body, status) {
  const errorField = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
  if (errorField !== undefined) {
    const rendered = typeof errorField === 'string' ? errorField : JSON.stringify(errorField);
    return rendered.slice(0, 500);
  }
  if (body && typeof body === 'object' && typeof body.message === 'string' && body.message.length > 0) {
    return body.message.slice(0, 500);
  }
  return `Provider returned HTTP ${status}`;
}

/**
 * Performs one provider API call.
 *
 * - `options.transport` defaults to global fetch; a stub is only ever supplied by tests.
 * - Timed-out requests become PROVIDER_TIMEOUT (retryable); unreachable ones become
 *   NETWORK_TEMPORARY_FAILURE (retryable). Both are non-2xx statuses mapped by classifyStatus.
 * - The provider's own error body is attached as `providerResponse` for the job record, with a
 *   500-character bound; it is the *error* response only, never the request.
 */
async function providerRequest(url, init = {}, options = {}) {
  const transport = options.transport ?? globalThis.fetch;
  if (typeof transport !== 'function') {
    throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'No HTTP transport is available for provider requests', false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    const response = await transport(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
        ...(init.headers ?? {}),
      },
    });

    const raw = await response.text();
    let body = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = { message: raw.slice(0, 500) };
      }
    }

    if (!response.ok) {
      const failure = classifyStatus(response.status);
      throw new ProviderError(failure.code, classifyProviderErrorBody(body, response.status), failure.retryable, {
        status: response.status,
        body,
      });
    }
    return body;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError('PROVIDER_TIMEOUT', 'Provider request timed out', true);
    }
    throw new ProviderError('NETWORK_TEMPORARY_FAILURE', 'Provider API could not be reached', true);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { providerRequest };
