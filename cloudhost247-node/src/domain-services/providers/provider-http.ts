/**
 * Shared HTTP transport for domain provider adapters.
 *
 * Adapters never call `fetch` directly. They go through this module so that:
 *   1. every outbound request has one timeout, retry and error-mapping policy;
 *   2. credentials never appear in logs (headers are redacted before logging);
 *   3. tests can script the entire HTTP layer (see setDomainProviderTestOverrides) and exercise
 *      the real adapter code against a fake network, exactly like the Cloudflare client.
 */
import { fetchWithGuard } from '../../tools/core/ssrf';
import { DomainProviderError } from './types';

export interface ProviderHttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  guardPublic?: boolean;
}

export interface ProviderHttpResponse {
  status: number;
  ok: boolean;
  text: string;
}

export type DomainProviderFetch = (url: string, init: RequestInit) => Promise<Response>;

let testOverrides: { fetchImpl?: DomainProviderFetch } | null = null;

/** Test-only seam. Production code always performs real network calls through global fetch. */
export function setDomainProviderTestOverrides(overrides: { fetchImpl?: DomainProviderFetch } | null): void {
  testOverrides = overrides;
}

export function domainProviderFetchImpl(): DomainProviderFetch {
  return testOverrides?.fetchImpl ?? fetch;
}

export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string
  ) {
    super(`Provider HTTP ${status}`);
    this.name = 'ProviderHttpError';
  }
}

/**
 * Performs one provider HTTP request. Maps network failures to typed, retryable
 * DomainProviderError('NETWORK_TEMPORARY_FAILURE') so a registrar outage can never be mistaken
 * for a user validation error or an availability answer.
 */
export async function providerFetch(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 20_000);
  try {
    if (request.guardPublic && !testOverrides?.fetchImpl) {
      const response = await fetchWithGuard(request.url, { method: 'GET', headers: request.headers, timeoutMs: request.timeoutMs ?? 10000, maxBytes: 2 * 1024 * 1024, maxRedirects: 3, allowHttp: false });
      return {status: response.status, ok: response.status >= 200 && response.status < 300, text: response.bodyText};
    }
    const response = await domainProviderFetchImpl()(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text };
  } catch (error) {
    if (error instanceof ProviderHttpError) throw error;
    throw new DomainProviderError(
      'NETWORK_TEMPORARY_FAILURE',
      'The domain provider could not be reached',
      true,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Provider returned an HTTP error status: classify the common ones. */
export function httpStatusToProviderError(status: number, bodyText: string): DomainProviderError {
  const detail = { status, bodySample: bodyText.slice(0, 500) };
  if (status === 401 || status === 403) {
    return new DomainProviderError('AUTHENTICATION_FAILED', 'Provider rejected the configured credentials', false, detail);
  }
  if (status === 429) {
    return new DomainProviderError('RATE_LIMITED', 'Provider rate limit reached', true, detail);
  }
  if (status >= 500) {
    return new DomainProviderError('PROVIDER_UNAVAILABLE', 'Provider server error', true, detail);
  }
  return new DomainProviderError('PROVIDER_ERROR', `Provider returned HTTP ${status}`, false, detail);
}

/** Parses JSON from a provider response, mapping malformed payloads to a typed error. */
export function parseProviderJson<T>(response: ProviderHttpResponse): T {
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new DomainProviderError(
      'INVALID_PROVIDER_RESPONSE',
      'Provider returned a malformed JSON response',
      false,
      { status: response.status, bodySample: response.text.slice(0, 500) }
    );
  }
}
