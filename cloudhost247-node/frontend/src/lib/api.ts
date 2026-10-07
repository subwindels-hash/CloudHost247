/**
 * Thin fetch wrapper. Uses relative URLs only — this SPA is always served from the same origin
 * as the API (by the Fastify server in production, or via the Vite dev proxy locally), so it
 * never needs to know a hostname/port. This is required for the app to work correctly whether
 * it is reached through cPanel/Apache/Passenger or a local dev server.
 */
import { toolsApiPath, toolsHost } from './tools-runtime';
import { clearSession } from './auth';

export interface ApiError {
  error: string;
  code?: string;
  retryable?: boolean;
  message: string;
}

/**
 * Thrown by apiFetch for any non-2xx response. Carries the real HTTP status code alongside the
 * message so callers that need to tell apart e.g. "not found" (404 — nothing configured yet) from
 * a generic failure (network/500) can do so honestly, without guessing from message text. Existing
 * callers that only did `error instanceof Error` / `error.message` keep working unchanged, since
 * this extends Error.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string, public readonly retryable?: boolean) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {  const token = toolsHost().embedded ? null : localStorage.getItem('ch247_token');
  const res = await fetch(toolsApiPath(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: 'UNKNOWN', message: res.statusText }))) as ApiError;
    // The server is the only source of truth for whether a token is still valid (see
    // src/lib/auth.ts). If a request that *sent* a token comes back 401, that token is no longer
    // good — expired, or explicitly revoked by /api/auth/logout (possibly from another tab, or
    // because the account was disabled server-side). Clearing the local session here means the
    // header/shell and any protected route immediately reflect the real, server-verified state
    // instead of continuing to display a "logged in" UI backed by a dead token.
    if (res.status === 401 && token) {
      clearSession();
    }
    throw new ApiRequestError(res.status, body.error || body.code || 'UNKNOWN', body.message || 'Request failed', body.retryable);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

/**
 * Anonymous read for endpoints that are public by design (`/api/tools/navigation`, the marketing
 * catalogue, published documentation indexes).
 *
 * It is never used for a session-gated call, and — unlike `apiFetch` — it deliberately does not
 * read or clear the stored session: a public GET is not evidence that a token is still valid, so
 * a rate-limited or failing public request must never sign a customer out.
 */
export async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(toolsApiPath(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: 'UNKNOWN', message: res.statusText }))) as ApiError;
    throw new ApiRequestError(res.status, body.error || body.code || 'UNKNOWN', body.message || 'Request failed', body.retryable);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
