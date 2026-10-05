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

/**
 * Merges header sources with HTTP's own rule: names are case-insensitive, and a later source
 * replaces an earlier one rather than arriving beside it. Without this, a caller that supplies
 * `content-type` while the default is `Content-Type` produces one header with two values
 * ("application/json, application/x-www-form-urlencoded…"), which a form-encoded provider API is
 * entitled to reject — and which SigV4 would sign as something other than what was sent.
 */
function mergeHeaders(...sources) {
  const merged = new Map();
  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (value === undefined || value === null) continue;
      merged.set(name.toLowerCase(), { name, value });
    }
  }
  const out = {};
  for (const { name, value } of merged.values()) out[name] = value;
  return out;
}

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
 * - `options.returnResponse` hands back `{ status, headers, body }` instead of the body alone, which
 *   the OpenStack client needs for Keystone's `x-subject-token`. The accessor is the transport's own
 *   headers object; nothing is copied or cached.
 * - `options.as = 'text'` returns the raw response text instead of a JSON parse. The AWS query APIs
 *   answer with XML, and a JSON.parse failure would truncate the document to a 500-character
 *   "message" — unusable for a DescribeInstances answer. Even then, what is attached to a failure as
 *   `providerResponse` is bounded, because that evidence is stored on the job record.
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
      headers: mergeHeaders(
        { Accept: 'application/json' },
        init.body ? { 'Content-Type': 'application/json' } : {},
        options.headers,
        init.headers,
      ),
    });

    const raw = await response.text();
    let body = null;
    if (raw) {
      if (options.as === 'text') {
        body = raw;
      } else {
        try {
          body = JSON.parse(raw);
        } catch {
          body = { message: raw.slice(0, 500) };
        }
      }
    }

    if (!response.ok) {
      const failure = classifyStatus(response.status);
      throw new ProviderError(failure.code, classifyProviderErrorBody(body, response.status), failure.retryable, {
        status: response.status,
        body: typeof body === 'string' ? body.slice(0, 4096) : body,
      });
    }
    if (options.returnResponse === true) {
      return { status: response.status, headers: response.headers ?? null, body };
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

module.exports = { providerRequest, mergeHeaders };
