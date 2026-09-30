import { ProviderError, type ProviderFailureCode } from './types';

export interface ProviderHttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

function classifyStatus(status: number): { code: ProviderFailureCode; retryable: boolean } {
  if (status === 401 || status === 403) return { code: 'AUTHENTICATION_FAILED', retryable: false };
  if (status === 404) return { code: 'RESOURCE_NOT_FOUND', retryable: false };
  if (status === 409 || status === 422) return { code: 'INVALID_CONFIGURATION', retryable: false };
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true };
  if (status === 507) return { code: 'INSUFFICIENT_CAPACITY', retryable: true };
  if (status >= 500) return { code: 'NETWORK_TEMPORARY_FAILURE', retryable: true };
  return { code: 'PROVIDER_ERROR', retryable: false };
}

/** Fetch wrapper that never logs request headers/body (they can contain provider credentials). */
export async function providerRequest<T>(
  url: string,
  init: RequestInit = {},
  options: ProviderHttpOptions = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
        ...(init.headers ?? {}),
      },
    });
    const raw = await response.text();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = { message: raw.slice(0, 500) };
      }
    }
    if (!response.ok) {
      const failure = classifyStatus(response.status);
      const providerMessage =
        body && typeof body === 'object' && 'error' in body
          ? JSON.stringify((body as { error: unknown }).error).slice(0, 500)
          : `Provider returned HTTP ${response.status}`;
      throw new ProviderError(failure.code, providerMessage, failure.retryable, {
        status: response.status,
        // Error response only. Never include request headers, request body, or credentials.
        body,
      });
    }
    return body as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError('PROVIDER_TIMEOUT', 'Provider request timed out', true);
    }
    throw new ProviderError('NETWORK_TEMPORARY_FAILURE', 'Provider API could not be reached', true);
  } finally {
    clearTimeout(timeout);
  }
}
