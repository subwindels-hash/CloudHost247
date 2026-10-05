/**
 * API client for the public site.
 *
 * Dependency-free: fetch + a small token store. The same client shape is used by the React SPA
 * (spa/src/lib/api.js) so both frontends talk to the backend identically.
 *
 * Tokens live in localStorage rather than a cookie because the SPA and the Capacitor apps share
 * this code path, and native WebViews do not always give us a usable cookie jar. The trade-off
 * (XSS can read the token) is mitigated by the strict CSP the server sends on every response.
 */

const TOKEN_KEY = 'ch247.accessToken';
const REFRESH_KEY = 'ch247.refreshToken';
const USER_KEY = 'ch247.user';

export const store = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  get refreshToken() {
    try { return localStorage.getItem(REFRESH_KEY); } catch { return null; }
  },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  },
  save({ accessToken, refreshToken, user }) {
    try {
      if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken);
      if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      // Private browsing can throw on write; the session simply will not persist.
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(USER_KEY);
    } catch { /* nothing to clear */ }
  },
};

/** Error carrying the API's structured error body. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Make a request to the platform API.
 *
 * On a 401 with a stored refresh token it attempts exactly one refresh and retries, so an expired
 * access token does not silently sign the user out mid-session.
 */
export async function api(path, options = {}) {
  const { method = 'GET', body, auth = true, retry = true, headers = {} } = options;

  const finalHeaders = { Accept: 'application/json', ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  if (auth && store.token) finalHeaders.Authorization = `Bearer ${store.token}`;

  const response = await fetch(path, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && auth && store.refreshToken && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return api(path, { ...options, retry: false });
    store.clear();
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, payload.error ?? 'ERROR', payload.message ?? response.statusText, payload.details);
  }
  return payload;
}

async function tryRefresh() {
  try {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken: store.refreshToken }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    store.save(data);
    return true;
  } catch {
    return false;
  }
}

// --- auth helpers ---------------------------------------------------------

export const authApi = {
  register: (payload) => api('/api/v1/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (payload) => api('/api/v1/auth/login', { method: 'POST', body: payload, auth: false }),
  logout: () => api('/api/v1/auth/logout', { method: 'POST' }),
  me: () => api('/api/v1/auth/me'),
  forgot: (email) => api('/api/v1/auth/password/forgot', { method: 'POST', body: { email }, auth: false }),
  reset: (token, password) => api('/api/v1/auth/password/reset', { method: 'POST', body: { token, password }, auth: false }),
  changePassword: (currentPassword, newPassword) =>
    api('/api/v1/auth/password/change', { method: 'POST', body: { currentPassword, newPassword } }),
  mfaStatus: () => api('/api/v1/auth/mfa/status'),
  mfaEnroll: () => api('/api/v1/auth/mfa/totp/enroll', { method: 'POST', body: {} }),
  mfaConfirm: (code) => api('/api/v1/auth/mfa/totp/confirm', { method: 'POST', body: { code } }),
  mfaDisable: (password) => api('/api/v1/auth/mfa/disable', { method: 'POST', body: { password } }),
};

export const catalogApi = {
  all: () => api('/api/v1/catalog', { auth: false }),
  products: (category) => api(`/api/v1/catalog/products${category ? `?category=${encodeURIComponent(category)}` : ''}`, { auth: false }),
  plans: (slug) => api(`/api/v1/catalog/products/${encodeURIComponent(slug)}/plans`, { auth: false }),
};

export const accountApi = {
  profile: () => api('/api/v1/account/profile'),
  updateProfile: (patch) => api('/api/v1/account/profile', { method: 'PATCH', body: patch }),
  services: () => api('/api/v1/account/services'),
  domains: () => api('/api/v1/account/domains'),
  tickets: () => api('/api/v1/account/tickets'),
  ticket: (id) => api(`/api/v1/account/tickets/${encodeURIComponent(id)}`),
  createTicket: (payload) => api('/api/v1/account/tickets', { method: 'POST', body: payload }),
  reply: (id, body) => api(`/api/v1/account/tickets/${encodeURIComponent(id)}/replies`, { method: 'POST', body: { body } }),
};

/** Human-readable rendering of an ApiError for form alerts. */
export function describeError(err) {
  if (err instanceof ApiError) {
    if (Array.isArray(err.details) && err.details.length > 0) {
      return err.details.map((d) => `${(d.path ?? []).join('.') || 'request'}: ${d.message}`).join('. ');
    }
    return err.message;
  }
  return err?.message ?? 'Something went wrong, please try again';
}
