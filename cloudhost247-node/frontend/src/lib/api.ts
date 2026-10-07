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
 * Reads a response body as JSON without ever letting a parser message reach the visitor.
 *
 * A mis-served deployment makes this the *normal* case rather than an edge case: a web server,
 * proxy or CDN that answers an `/api/...` path with the SPA's `index.html` returns **200 OK HTML**,
 * `res.json()` throws `Unexpected token '<', "<!doctype "... is not valid JSON`, and the page
 * shows that parser complaint — which names neither the URL nor the cause, and reads like a bug in
 * the visitor's own request. Reading the body as text once keeps that diagnosis ours to write.
 */
interface ResponseBody {
  /** False when the body was empty, unreadable, or not JSON at all. */
  isJson: boolean;
  value: unknown;
  /** The raw text, kept only so a non-JSON response can be described accurately. */
  text: string;
}

async function readBody(res: Response): Promise<ResponseBody> {
  let text = '';
  if (typeof res.text === 'function') {
    try {
      text = await res.text();
    } catch {
      return { isJson: false, value: null, text: '' };
    }
  } else if (typeof res.json === 'function') {
    // Minimal fetch doubles in tests provide `json()` only.
    try {
      return { isJson: true, value: await res.json(), text: '' };
    } catch {
      return { isJson: false, value: null, text: '' };
    }
  }
  if (text.trim() === '') return { isJson: false, value: null, text };
  try {
    return { isJson: true, value: JSON.parse(text), text };
  } catch {
    return { isJson: false, value: null, text };
  }
}

/**
 * Says what a non-JSON response actually means, in the visitor's language rather than the parser's.
 *
 * An HTML body is a routing/deployment fault, not a request error: something between the browser
 * and the application answered an API path. Naming that — instead of "temporary" — is the point; a
 * retry button that cannot fix a misrouted URL costs the operator the afternoon.
 */
function describeNonJsonResponse(res: Response, path: string, text: string): string {
  const contentType = (res.headers?.get?.('content-type') ?? '').split(';')[0] || 'an unknown type';
  const looksLikeHtml = /^\s*<(?:!doctype|html|head|body)/i.test(text);
  if (text.trim() === '') {
    // Nothing at all came back. This is the shape a dev server or proxy produces when the
    // application behind it is not running, so say that rather than "invalid JSON".
    return `Nothing answered ${path}: the response was empty (HTTP ${res.status}). If this is a local or preview build, the application is not running behind the page — start it and reload.`;
  }
  if (!looksLikeHtml) {
    return `The application did not answer ${path} with JSON (HTTP ${res.status}, ${contentType}). The URL is being served by something other than the application.`;
  }
  return `The application did not answer ${path}: the server returned an HTML page (HTTP ${res.status}) instead of JSON, so that URL is being served by the website rather than by the application. This is a deployment fault, not a problem with your request — the running application and the page you are reading are not the same build, or ${path} is not routed to the application at all.`;
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
    const { isJson, value, text } = await readBody(res);
    const body = (isJson && value && typeof value === 'object' ? value : null) as ApiError | null;
    // The server is the only source of truth for whether a token is still valid (see
    // src/lib/auth.ts). If a request that *sent* a token comes back 401, that token is no longer
    // good — expired, or explicitly revoked by /api/auth/logout (possibly from another tab, or
    // because the account was disabled server-side). Clearing the local session here means the
    // header/shell and any protected route immediately reflect the real, server-verified state
    // instead of continuing to display a "logged in" UI backed by a dead token.
    //
    // A non-JSON error body is deliberately *not* a reason to sign anyone out: it is evidence that
    // the response did not come from the application at all, so it says nothing about the token.
    // A proxy's sign-in page returned for /api/auth/me must not end a valid session.
    if (res.status === 401 && token && isJson) {
      clearSession();
    }
    if (!body) {
      throw new ApiRequestError(
        res.status,
        'NON_JSON_RESPONSE',
        describeNonJsonResponse(res, path, text),
        res.status >= 500 || res.status === 429,
      );
    }
    throw new ApiRequestError(res.status, body.error || body.code || 'UNKNOWN', body.message || res.statusText || 'Request failed', body.retryable);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await readBody(res);
  if (!body.isJson) {
    throw new ApiRequestError(
      res.status,
      'NON_JSON_RESPONSE',
      describeNonJsonResponse(res, path, body.text),
      res.status >= 500 || res.status === 429,
    );
  }

  return body.value as T;
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
    const { isJson, value, text } = await readBody(res);
    const body = (isJson && value && typeof value === 'object' ? value : null) as ApiError | null;
    if (!body) {
      throw new ApiRequestError(
        res.status,
        'NON_JSON_RESPONSE',
        describeNonJsonResponse(res, path, text),
        res.status >= 500 || res.status === 429,
      );
    }
    throw new ApiRequestError(res.status, body.error || body.code || 'UNKNOWN', body.message || res.statusText || 'Request failed', body.retryable);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await readBody(res);
  if (!body.isJson) {
    // A public read that comes back as HTML is evidence about the deployment, never about the
    // visitor, so it must never be reported as a failed request the visitor could retry.
    throw new ApiRequestError(
      res.status,
      'NON_JSON_RESPONSE',
      describeNonJsonResponse(res, path, body.text),
      res.status >= 500 || res.status === 429,
    );
  }

  return body.value as T;
}
