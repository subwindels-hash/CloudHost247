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

/**
 * Describes a response whose body is not JSON.
 *
 * This is the difference between a support ticket and a fix. A non-JSON body means the request did
 * not reach the API at all: a static file server, an SPA fallback (which answers 200 with
 * index.html, so `res.ok` is true and the status says nothing), a reverse proxy, or a misconfigured
 * mount. `JSON.parse("<")` reports that as `Unexpected token '<', "<!doctype "... is not valid
 * JSON`, which is what a customer saw on the Tools Center — accurate, and useless.
 */
export function notJsonError(res: Response, url: string): ApiRequestError {
  // The body cannot be re-read after a parse failure, so the Content-Type header is what tells us
  // what actually came back. An HTML body on a 200 is the signature of the SPA fallback (or a
  // static file server) answering an API path: `res.ok` was true, so nothing upstream noticed.
  const contentType = res.headers?.get?.('content-type') ?? '';
  return new ApiRequestError(
    res.status,
    'NOT_JSON',
    /text\/html/i.test(contentType)
      ? `The request to ${url} returned an HTML page (status ${res.status}), not the API — the API is not served at this address.`
      : `${url} did not return JSON (status ${res.status}${contentType ? `, content-type ${contentType}` : ''}).`,
  );
}

/**
 * Reads a response as JSON, and — when it is not JSON — fails with a sentence that names the real
 * problem instead of leaking the parser's complaint.
 *
 * Exported so every caller that talks to the API directly (the AI support widget, tool pages) can
 * make the same promise to the reader, rather than each one re-implementing it or forgetting to.
 */
export async function readJson<T>(res: Response, url: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw notJsonError(res, url);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = toolsHost().embedded ? null : localStorage.getItem('ch247_token');
  const res = await fetch(toolsApiPath(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    // The body is usually the API's JSON error envelope, but when the request never reached the
    // API it is whatever the web server sent instead (often an HTML error page). Only the JSON case
    // can be reported as the server's own message; the other is described by what actually arrived.
    const body = (await res.json().catch(() => null)) as ApiError | null;
    // The server is the only source of truth for whether a token is still valid (see
    // src/lib/auth.ts). If a request that *sent* a token comes back 401, that token is no longer
    // good — expired, or explicitly revoked by /api/auth/logout (possibly from another tab, or
    // because the account was disabled server-side). Clearing the local session here means the
    // header/shell and any protected route immediately reflect the real, server-verified state
    // instead of continuing to display a "logged in" UI backed by a dead token.
    if (res.status === 401 && token) {
      clearSession();
    }
    if (!body) throw notJsonError(res, toolsApiPath(path));
    throw new ApiRequestError(res.status, body.error || body.code || 'UNKNOWN', body.message || 'Request failed', body.retryable);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return readJson<T>(res, toolsApiPath(path));
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
    const body = (await res.json().catch(() => null)) as ApiError | null;
    if (!body) throw notJsonError(res, toolsApiPath(path));
    throw new ApiRequestError(res.status, body.error || body.code || 'UNKNOWN', body.message || 'Request failed', body.retryable);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return readJson<T>(res, toolsApiPath(path));
}
