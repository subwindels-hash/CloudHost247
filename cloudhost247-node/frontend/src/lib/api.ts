/**
 * Thin fetch wrapper. Uses relative URLs only — this SPA is always served from the same origin
 * as the API (by the Fastify server in production, or via the Vite dev proxy locally), so it
 * never needs to know a hostname/port. This is required for the app to work correctly whether
 * it is reached through cPanel/Apache/Passenger or a local dev server.
 */
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
    throw new Error(body.message || 'Request failed');
  }

  return (await res.json()) as T;
}
