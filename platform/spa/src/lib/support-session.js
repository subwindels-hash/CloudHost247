/**
 * Support-session bookkeeping for the admin console.
 *
 * "Switch to customer" mints a delegated token that authenticates as the customer (see
 * POST /admin/customers/:id/switch). While that token sits in the normal token store the dashboard
 * shows the customer's view, so the admin's own credentials are parked in sessionStorage and the
 * banner in AdminLayout offers the way back.
 *
 * Two details are deliberate:
 *   - the admin's refresh token is parked out of the store, so the delegated session cannot be
 *     silently refreshed back into the admin's identity;
 *   - the delegated session is saved *without* a refresh token, so when it expires the admin lands
 *     on the sign-in page rather than quietly becoming themselves again mid-task.
 */
import { adminApi, describeError, store } from './api.js';

const KEY = 'ch247.supportSession';

const storage = () => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null; // private browsing can throw on property access
  }
};

/** The parked admin session plus who is being acted as, or null when no delegation is active. */
export function read() {
  const box = storage();
  if (!box) return null;
  try {
    const raw = box.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

/** Park the admin's credentials and adopt the delegated token. */
export function begin({ delegatedAccessToken, customer, sessionId }) {
  const parked = {
    accessToken: store.token,
    refreshToken: store.refreshToken,
    user: store.user,
    customer,
    sessionId,
  };
  const box = storage();
  if (box) box.setItem(KEY, JSON.stringify(parked));

  store.clear();
  store.save({ accessToken: delegatedAccessToken, user: customer });
  return parked;
}

/** Restore the parked admin session, without telling the server anything. */
export function restore() {
  const parked = read();
  store.clear();
  if (!parked) return false;
  store.save({ accessToken: parked.accessToken, refreshToken: parked.refreshToken, user: parked.user });
  const box = storage();
  if (box) box.removeItem(KEY);
  return true;
}

/**
 * End the delegation: restore the admin session first (the end-session endpoint is admin-only, so it
 * cannot be called with the customer's token), then mark the session ended on the server.
 *
 * A failure from the server is returned rather than thrown: the admin must get their own session back
 * regardless, and the session row simply expires on its own within the hour.
 */
export async function finish() {
  const parked = read();
  if (!parked) return { restored: false, error: '' };

  restore();
  let error = '';
  if (parked.sessionId) {
    try {
      await adminApi.endSupportSession(parked.sessionId);
    } catch (err) {
      error = describeError(err);
    }
  }
  return { restored: true, sessionId: parked.sessionId, error };
}

/** True when this browser tab is inside a delegated support session. */
export function isActing() {
  return read() !== null;
}
