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

  // Passkeys (WebAuthn). The ceremony itself (navigator.credentials) is run by the shared browser
  // helper, public/assets/js/webauthn.js; these methods only carry the options and responses.
  passkeys: () => api('/api/v1/auth/passkeys'),
  passkeyRegisterOptions: (password) => api('/api/v1/auth/passkeys/register/options', { method: 'POST', body: { password } }),
  passkeyRegisterVerify: (challengeId, response, name) => api('/api/v1/auth/passkeys/register/verify', { method: 'POST', body: { challengeId, response, name } }),
  passkeyRename: (id, name) => api(`/api/v1/auth/passkeys/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
  passkeyRemove: (id, password) => api(`/api/v1/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', body: { password } }),
  passkeyLoginOptions: (email) => api('/api/v1/auth/passkeys/login/options', {
    method: 'POST', body: email ? { email } : {}, auth: false,
  }),
  passkeyLoginVerify: (challengeId, response) => api('/api/v1/auth/passkeys/login/verify', {
    method: 'POST', body: { challengeId, response }, auth: false,
  }),
};

export const catalogApi = {
  all: () => api('/api/v1/catalog', { auth: false }),
  products: (category) => api(`/api/v1/catalog/products${category ? `?category=${encodeURIComponent(category)}` : ''}`, { auth: false }),
  plans: (slug) => api(`/api/v1/catalog/products/${encodeURIComponent(slug)}/plans`, { auth: false }),
};

export const cartApi = {
  /**
   * The caller's open cart. Signed-in callers get their own cart; the server creates one on first
   * request, so this is safe to call on page load.
   */
  get: () => api('/api/v1/cart'),
  addItem: (planSlug, { billingCycle = 'monthly', quantity = 1, domain } = {}) => api('/api/v1/cart/items', {
    method: 'POST',
    body: { planSlug, billingCycle, quantity, ...(domain ? { domain } : {}) },
  }),
  /**
   * PATCH answers `{ cart }` while GET/POST answer the cart itself (the ported original is
   * inconsistent here); unwrap so callers always get a cart.
   */
  updateItem: async (id, quantity) => {
    const res = await api(`/api/v1/cart/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: { quantity } });
    return res?.cart ?? res;
  },
  removeItem: (id) => api(`/api/v1/cart/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Turns the cart into an order + invoice + ledger charge, atomically, server-side. */
  checkout: () => api('/api/v1/orders', { method: 'POST', body: {} }),
};

export const billingApi = {
  invoices: () => api('/api/v1/invoices'),
  invoice: (id) => api(`/api/v1/invoices/${encodeURIComponent(id)}`),
  ledger: () => api('/api/v1/billing/ledger'),
  subscriptions: () => api('/api/v1/billing/subscriptions'),
  cancelSubscription: (id) =>
    api(`/api/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} }),
  /**
   * Request a plan change. Accepts either the plan's id or its slug: the public catalog is keyed by
   * slug and never publishes plan ids, so a customer client can only name a slug.
   */
  changePlan: (id, { planId, planSlug } = {}) =>
    api(`/api/v1/billing/subscriptions/${encodeURIComponent(id)}/change-plan`, {
      method: 'POST',
      body: planId ? { planId } : { planSlug },
    }),
  paymentMethods: (invoiceId) =>
    api(`/api/v1/billing/invoices/${encodeURIComponent(invoiceId)}/payment-methods`),
  /**
   * Starts a payment for an invoice. Uses POST /payments rather than the invoice-scoped route
   * because only this one answers with the sandbox token (or the manual gateway's instructions)
   * that the pay button needs. Real gateways are refused by the server with a named reason.
   * The invoice-scoped equivalent, which returns the { payment } DTO, is startInvoicePayment.
   */
  startPayment: (invoiceId, gateway) =>
    api('/api/v1/payments', { method: 'POST', body: { invoiceId, gateway } }),
  startInvoicePayment: (invoiceId, gateway) =>
    api(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/payments`, { method: 'POST', body: { gateway } }),
  payments: () => api('/api/v1/payments'),
  payment: (id) => api(`/api/v1/payments/${encodeURIComponent(id)}`),
  /**
   * Sandbox only: completes the simulated provider flow through the genuine webhook receiver, so
   * the invoice is settled by the same code path a real provider would drive.
   */
  completeSandboxPayment: (id) =>
    api(`/api/v1/payments/${encodeURIComponent(id)}/sandbox/complete`, { method: 'POST', body: {} }),
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

/**
 * Staff-side API (the admin console).
 *
 * The server decides who may do what — these methods only carry the request. Role boundaries are
 * asserted in tests/spa-admin.test.js: staff may work the directory, tickets and the passive
 * service/domain records; only admins may delegate into a customer's session; only super_admins may
 * change an account's status or role, and never their own role.
 */
const queryString = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};

export const adminApi = {
  // --- customer directory (staff+) ---
  customers: (params = {}) => api(`/api/v1/admin/customers${queryString(params)}`),
  customer: (id) => api(`/api/v1/admin/customers/${encodeURIComponent(id)}`),

  // --- account integrity (super_admin only) ---
  setCustomerStatus: (id, status) =>
    api(`/api/v1/admin/customers/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
  setCustomerRole: (id, role) =>
    api(`/api/v1/admin/customers/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: { role } }),

  // --- passive service/domain records (staff+) ---
  createCustomerService: (id, payload) =>
    api(`/api/v1/admin/customers/${encodeURIComponent(id)}/services`, { method: 'POST', body: payload }),
  updateCustomerService: (id, recordId, patch) =>
    api(`/api/v1/admin/customers/${encodeURIComponent(id)}/services/${encodeURIComponent(recordId)}`, { method: 'PATCH', body: patch }),
  createCustomerDomain: (id, payload) =>
    api(`/api/v1/admin/customers/${encodeURIComponent(id)}/domains`, { method: 'POST', body: payload }),
  updateCustomerDomain: (id, recordId, patch) =>
    api(`/api/v1/admin/customers/${encodeURIComponent(id)}/domains/${encodeURIComponent(recordId)}`, { method: 'PATCH', body: patch }),

  // --- support sessions: act as the customer, then come back (admin+) ---
  switchToCustomer: (id, reason) =>
    api(`/api/v1/admin/customers/${encodeURIComponent(id)}/switch${queryString({ reason })}`, { method: 'POST', body: {} }),
  supportSessions: () => api('/api/v1/admin/support-sessions'),
  endSupportSession: (id) =>
    api(`/api/v1/admin/support-sessions/${encodeURIComponent(id)}/end`, { method: 'POST', body: {} }),

  // --- ticket queue (staff+) ---
  tickets: (params = {}) => api(`/api/v1/admin/tickets${queryString(params)}`),
  ticket: (id) => api(`/api/v1/admin/tickets/${encodeURIComponent(id)}`),
  replyToTicket: (id, message) =>
    api(`/api/v1/admin/tickets/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { message } }),
  setTicketStatus: (id, status) =>
    api(`/api/v1/admin/tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } }),

  // --- website content: knowledgebase and blog articles (admin+) ---
  articles: () => api('/api/v1/admin/articles'),
  createArticle: (payload) => api('/api/v1/admin/articles', { method: 'POST', body: payload }),
  updateArticle: (id, patch) =>
    api(`/api/v1/admin/articles/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  deleteArticle: (id) => api(`/api/v1/admin/articles/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // --- platform settings key/value store (reads admin+, writes super_admin) ---
  settings: () => api('/api/v1/admin/settings'),
  saveSetting: (key, value) =>
    api(`/api/v1/admin/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } }),

  // --- staff directory and the catalog ids the service form needs (admin+) ---
  users: () => api('/api/v1/admin/users'),
  catalogProducts: () => api('/api/v1/admin/catalog/products'),
  catalogProduct: (id) => api(`/api/v1/admin/catalog/products/${encodeURIComponent(id)}`),
  createCatalogProduct: (payload) => api('/api/v1/admin/catalog/products', { method: 'POST', body: payload }),
  updateCatalogProduct: (id, payload) => api(`/api/v1/admin/catalog/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }),
  createCatalogPlan: (productId, payload) => api(`/api/v1/admin/catalog/products/${encodeURIComponent(productId)}/plans`, { method: 'POST', body: payload }),
  updateCatalogPlan: (id, payload) => api(`/api/v1/admin/catalog/plans/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }),
  createCatalogPricing: (planId, payload) => api(`/api/v1/admin/catalog/plans/${encodeURIComponent(planId)}/pricing`, { method: 'POST', body: payload }),
  replaceCatalogFeatures: (planId, features) => api(`/api/v1/admin/catalog/plans/${encodeURIComponent(planId)}/features`, { method: 'PUT', body: { features } }),
  servers: () => api('/api/v1/admin/servers'),
  createServer: (payload) => api('/api/v1/admin/servers', { method: 'POST', body: payload }),
  updateServer: (id, patch) => api(`/api/v1/admin/servers/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  providers: () => api('/api/v1/admin/providers'),
  createProvider: (payload) => api('/api/v1/admin/providers', { method: 'POST', body: payload }),
  updateProvider: (id, patch) => api(`/api/v1/admin/providers/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  regions: () => api('/api/v1/admin/regions'),
  createRegion: (payload) => api('/api/v1/admin/regions', { method: 'POST', body: payload }),
  serverPlans: () => api('/api/v1/admin/server-plans'),
  createServerPlan: (payload) => api('/api/v1/admin/server-plans', { method: 'POST', body: payload }),
  cloudflareOverview: () => api('/api/v1/admin/cloudflare'),
  cloudflareServices: () => api('/api/v1/admin/cloudflare/services'),
  createCloudflareAccount: (payload) => api('/api/v1/admin/cloudflare/accounts', { method: 'POST', body: payload }),
  testCloudflareAccount: (id) => api(`/api/v1/admin/cloudflare/accounts/${encodeURIComponent(id)}/test`, { method: 'POST', body: {} }),
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
