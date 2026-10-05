/**
 * Authentication and authorization middleware.
 *
 * Ported from cloudhost247-node/src/lib/require-auth.ts and require-role.ts, preserving the
 * exact invalidation semantics that the existing platform's tests depend on — including the
 * deliberate whole-second flooring of `password_changed_at` when comparing against JWT `iat`.
 * See the note in authenticate() below before changing that comparison.
 */
'use strict';

const jwt = require('./jwt');
const { UnauthorizedError, ForbiddenError } = require('../core/errors');

const ROLES = ['customer', 'staff', 'admin', 'super_admin'];

/** Role hierarchy: a role implies every role below it. */
const ROLE_RANK = { customer: 0, staff: 1, admin: 2, super_admin: 3 };

function extractBearerToken(ctx) {
  const header = ctx.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) throw new UnauthorizedError('Missing bearer token');
  return token;
}

/**
 * Verify the bearer token and re-check the account against the store.
 *
 * Checks, in order:
 *   1. Signature + expiry (HS256, algorithm pinned — see src/lib/jwt.js)
 *   2. Revocation list, so an explicit logout kills the token immediately rather than at expiry
 *   3. The account still exists and its status is 'active'
 *   4. Token session-version matches the account's current auth_session_version
 *   5. Token was issued at or after the last password change
 *   6. Delegated support sessions (claims.sup) — the session row must still be open, unexpired,
 *      name this exact customer, and the acting admin must still hold admin privileges
 */
async function authenticate(ctx, { store, config, allowMissing = false } = {}) {
  if (ctx.user) return ctx.user;

  let token;
  try {
    token = extractBearerToken(ctx);
  } catch (err) {
    if (allowMissing) return null;
    throw err;
  }

  let claims;
  try {
    claims = jwt.verify(token, config.JWT_SECRET);
  } catch {
    // Never leak *why* (expired vs bad signature) to the client.
    throw new UnauthorizedError('Invalid or expired token');
  }

  const revoked = await store.table('revoked_tokens').findById(claims.jti);
  if (revoked) throw new UnauthorizedError('This session has been logged out');

  const user = await store.table('users').findById(claims.sub);
  if (!user) throw new UnauthorizedError('Account no longer exists');

  if (user.status !== 'active') {
    // A still-valid, unrevoked JWT must stop working the moment staff suspends or disables the
    // account it belongs to.
    throw new UnauthorizedError('Account is not active');
  }

  // Session-version invalidation. Every token carries the account's session version at issue
  // time; a password change increments it, which immediately kills all prior sessions — including
  // one minted in the same wall-clock second as the change.
  if ((claims.sv ?? 0) !== (user.auth_session_version ?? 0)) {
    throw new UnauthorizedError('Session invalidated by a password change — please log in again');
  }

  // Legacy timestamp safeguard for accounts whose password_changed_at predates the version column.
  //
  // JWT `iat` is whole-second precision (RFC 7519 NumericDate) while our timestamps carry
  // millisecond precision, so `password_changed_at` is floored to the second before comparing.
  // Without that flooring, a user who changes their password and immediately re-authenticates is
  // rejected, because the new token's truncated `iat` lands milliseconds before the sub-second
  // `password_changed_at`. That is a real bug the existing platform's tests caught.
  //
  // The accepted trade-off is the mirror image: a pre-change token issued in that exact same
  // second is not distinguishable by this check alone and survives until it expires. Do not
  // "fix" this by comparing at millisecond precision — that reintroduces the original bug.
  if (user.password_changed_at) {
    const tokenIssuedAtMs = claims.iat * 1000;
    const passwordChangedAtMs = Math.floor(new Date(user.password_changed_at).getTime() / 1000) * 1000;
    if (tokenIssuedAtMs < passwordChangedAtMs) {
      throw new UnauthorizedError('Session invalidated by a password change — please log in again');
    }
  }

  // --- delegated support session ------------------------------------------
  let supportSessionId = null;
  let actingAdminId = null;

  if (claims.sup) {
    const session = await store.table('admin_support_sessions').findById(claims.sup);
    if (!session || session.ended_at || new Date(session.ends_at).getTime() < Date.now()) {
      throw new UnauthorizedError('This support session has ended');
    }
    if (session.customer_user_id !== claims.sub || (claims.act && session.admin_user_id !== claims.act)) {
      throw new UnauthorizedError('This support session is not valid for this account');
    }
    const admin = await store.table('users').findById(session.admin_user_id);
    if (!admin || admin.status !== 'active' || !['admin', 'super_admin'].includes(admin.role)) {
      throw new UnauthorizedError('This support session is no longer authorized');
    }
    supportSessionId = session.id;
    actingAdminId = session.admin_user_id;
  }

  ctx.user = {
    id: user.id,
    userId: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    fullName: user.full_name,
    customerId: user.customer_id ?? null,
    supportSessionId,
    actingAdminId,
    claims,
  };
  return ctx.user;
}

/** Middleware: require a valid session. Populates ctx.user. */
function requireAuth(ctx, deps) {
  return authenticate(ctx, { ...deps, allowMissing: false });
}

/** Middleware: require one of `allowedRoles`, re-read from the store (never trusted from the JWT). */
async function requireRole(roles, ctx, deps) {
  const auth = await authenticate(ctx, { ...deps, allowMissing: false });
  if (!roles.includes(auth.role)) {
    throw new ForbiddenError('Insufficient permissions for this action');
  }
  return auth;
}

/** Bind a role list to a middleware so routes read `r.get('/x', asAdmin, handler)`. */
function roleGuard(roles) {
  return (ctx, deps) => requireRole(roles, ctx, deps);
}

const asAdmin = roleGuard(['admin', 'super_admin']);
const asSuperAdmin = roleGuard(['super_admin']);
const asStaff = roleGuard(['staff', 'admin', 'super_admin']);

function hasRole(user, ...roles) {
  if (!user) return false;
  return roles.includes(user.role);
}

/** True when `actor` outranks or equals `target` — used to stop privilege escalation. */
function outranks(actorRole, targetRole) {
  return (ROLE_RANK[actorRole] ?? -1) > (ROLE_RANK[targetRole] ?? -1);
}

module.exports = {
  ROLES,
  ROLE_RANK,
  authenticate,
  requireAuth,
  requireRole,
  roleGuard,
  asAdmin,
  asSuperAdmin,
  asStaff,
  hasRole,
  outranks,
  extractBearerToken,
};
