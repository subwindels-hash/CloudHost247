/**
 * Shared HTTP transport for domain-provider adapters — ported from
 * `cloudhost247-node/src/domain-services/providers/provider-http.ts`.
 *
 * Adapters never call `fetch` directly. They go through here so that:
 *
 *   1. every outbound request has one timeout and one error-mapping policy, so a registrar outage
 *      can never be mistaken for a customer validation error;
 *   2. credentials never reach a log line — the caller passes headers, and the only thing this
 *      module ever puts into an error is the response status and a bounded body sample;
 *   3. tests can script the whole HTTP layer by injecting `transport`, so the *real* adapter code
 *      runs against a fake registry rather than a stub standing in for the adapter.
 *
 * Outbound URLs are public-internet only. `validateTargetUrl` — the same guard the live DNS and
 * HTTP-monitor probes use — rejects private addresses, loopback, link-local and internal hostnames,
 * so a provider row cannot be pointed at the platform's own network. Tests run with
 * `NODE_ENV=test`, which is the one place loopback is permitted; that is a property of the test
 * harness, not something a caller can ask for.
 */
'use strict';

const { DomainProviderError } = require('./types');
const { validateTargetUrl } = require('../tools-connectors');

const DEFAULT_TIMEOUT_MS = 20_000;

/** A URL with any credential-bearing parts stripped, safe for an error detail. */
function safeUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * One provider HTTP request.
 *
 * @param {object} request  `{ url, method, headers, body, timeoutMs, transport, guard }`
 * @returns {Promise<{status:number, ok:boolean, text:string}>}
 */
async function providerFetch(request) {
  const { url, method = 'GET', headers, body, timeoutMs = DEFAULT_TIMEOUT_MS } = request;
  const transport = request.transport ?? globalThis.fetch;
  if (typeof transport !== 'function') {
    throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', 'No HTTP transport is available for domain provider requests', false);
  }

  // Refuse before egress. A private/loopback target is a configuration fault, so it is reported as
  // such and no request is made — the guard runs *before* the transport is called.
  //
  // `allowLoopback` is the sandbox escape hatch, and it is deliberately not free: the seam passes it
  // only for a provider row whose `environment` is `sandbox` (see `lib/domain-provider-service.js`),
  // so a loopback base URL — a staging registry mirror, or the fake a test drives — has to be
  // configured on purpose by an operator. A production provider never gets it.
  if (request.guard !== false) {
    try {
      await validateTargetUrl(url, { allowLoopback: request.allowLoopback === true });
    } catch (error) {
      // The guard's own refusal is reported in the provider vocabulary — an unreachable or
      // forbidden address is a configuration fault ("this provider row points somewhere it may not
      // go"), and a caller must not have to know which internal error class expresses that.
      throw new DomainProviderError('PROVIDER_NOT_CONFIGURED', error.message, false, { reason: 'BLOCKED_TARGET', url: safeUrl(url) });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    const response = await transport(url, {
      method,
      headers: { Accept: 'application/json, application/rdap+json', ...(headers ?? {}) },
      ...(body === undefined ? {} : { body }),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = typeof response.text === 'function' ? await response.text() : '';
    return { status: response.status, ok: response.status >= 200 && response.status < 300, text };
  } catch (error) {
    // An abort is this module's own timeout; anything else is the network. Both are retryable, and
    // neither is ever reported as an answer.
    const timedOut = error instanceof Error && error.name === 'AbortError';
    const detail = { cause: error instanceof Error ? error.message : String(error) };
    throw new DomainProviderError(
      timedOut ? 'PROVIDER_UNAVAILABLE' : 'NETWORK_TEMPORARY_FAILURE',
      timedOut ? 'Provider request timed out' : 'The domain provider could not be reached',
      true,
      detail,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Map an HTTP error status onto the provider failure vocabulary. */
function httpStatusToProviderError(status, bodyText) {
  const detail = { status, bodySample: String(bodyText ?? '').slice(0, 500) };
  if (status === 401 || status === 403) {
    return new DomainProviderError('AUTHENTICATION_FAILED', 'Provider rejected the configured credentials', false, detail);
  }
  if (status === 404) {
    return new DomainProviderError('NO_REGISTRY_RECORD', 'Provider has no record for that object', false, detail);
  }
  if (status === 429) {
    return new DomainProviderError('RATE_LIMITED', 'Provider rate limit reached', true, detail);
  }
  if (status >= 500) {
    return new DomainProviderError('PROVIDER_UNAVAILABLE', 'Provider server error', true, detail);
  }
  return new DomainProviderError('PROVIDER_ERROR', `Provider returned HTTP ${status}`, false, detail);
}

/** Parse a JSON provider body, mapping a malformed payload to a typed error. */
function parseProviderJson(response) {
  try {
    return JSON.parse(response.text);
  } catch {
    throw new DomainProviderError('INVALID_PROVIDER_RESPONSE', 'Provider returned a malformed JSON response', false, {
      status: response.status,
      bodySample: String(response.text ?? '').slice(0, 500),
    });
  }
}

module.exports = { providerFetch, httpStatusToProviderError, parseProviderJson, DEFAULT_TIMEOUT_MS };
