/**
 * Thin fetch wrapper. Uses relative URLs only — this SPA is always served from the same origin
 * as the API (by the Fastify server in production, or via the Vite dev proxy locally), so it
 * never needs to know a hostname/port. This is required for the app to work correctly whether
 * it is reached through cPanel/Apache/Passenger or a local dev server.
 */
import { clearSession } from './auth';

export interface ApiError {
  error: string;
  message: string;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('ch247_token');
  const res = await fetch(path, {
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
    throw new Error(body.message || 'Request failed');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
