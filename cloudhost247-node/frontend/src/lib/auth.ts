/**
 * Minimal client-side auth state helper.
 *
 * The server is the only source of truth for whether a token is actually valid (every protected
 * API call is re-verified server-side — see src/routes/auth.ts). This module only tracks *local*
 * state so the shared header/shell can show the right nav (Login/Register vs Dashboard/Logout)
 * without an extra round trip on every render. It never decodes/trusts the JWT payload for
 * authorization decisions — only for display convenience (name/role in the header).
 */
export interface StoredUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  emailVerified?: boolean;
}

const TOKEN_KEY = 'ch247_token';
const USER_KEY = 'ch247_user';
const AUTH_EVENT = 'ch247-auth-changed';
/**
 * While an administrator is switched into a customer account, their *own* session is parked here
 * so "Exit support mode" can restore it in one click. It holds the admin's normal token — the
 * delegated customer token lives in the usual slot — and is cleared as soon as support mode ends.
 */
const SUPPORT_ORIGIN_KEY = 'ch247_support_origin';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: StoredUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/** Subscribes to auth state changes made in this tab (custom event) or another tab (storage event). */
export function subscribeToAuthChanges(callback: () => void): () => void {
  window.addEventListener(AUTH_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(AUTH_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export interface SupportOrigin {
  token: string;
  user: StoredUser;
  sessionId: string;
  targetName: string;
  targetCustomerId: string | null;
  expiresAt: string;
}

export function setSupportOrigin(origin: SupportOrigin): void {
  localStorage.setItem(SUPPORT_ORIGIN_KEY, JSON.stringify(origin));
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function getSupportOrigin(): SupportOrigin | null {
  const raw = localStorage.getItem(SUPPORT_ORIGIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SupportOrigin;
  } catch {
    return null;
  }
}

export function clearSupportOrigin(): void {
  localStorage.removeItem(SUPPORT_ORIGIN_KEY);
  window.dispatchEvent(new Event(AUTH_EVENT));
}
