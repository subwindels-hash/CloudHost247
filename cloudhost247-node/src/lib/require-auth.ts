import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { isTokenRevoked } from '../db/revoked-tokens';
import { findUserById } from '../db/users';
import { findSupportSessionById, isSupportSessionActive } from '../db/support-sessions';
import { UnauthorizedError } from './errors';
import { verifyAuthToken, type AuthTokenClaims } from './jwt';

export interface AuthenticatedRequestContext extends AuthTokenClaims {
  userId: string;
  /** The caller's permanent six-digit Customer ID (null only for rows predating assignment). */
  customerId: string | null;
  /** Set only inside a delegated admin support session (see src/lib/support-mode.ts). */
  supportSessionId: string | null;
  /** The administrator acting on the customer's behalf, when supportSessionId is set. */
  actingAdminId: string | null;
  /** DB-reverified role/status at request time — see requireRole() below. Populated here so
   * every protected route gets a single, consistent, DB-fresh view of the caller without a
   * second query per route. */
  status: string;
}

function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }
  return header.slice('Bearer '.length);
}

/**
 * Shared authentication check used by every protected route. Verifies the JWT signature/expiry,
 * then checks the DB-backed revocation list so a token that was explicitly logged out via
 * /api/auth/logout is rejected immediately, not just once it naturally expires, and finally
 * re-verifies the user against the database (current status, and — Phase 4 — current
 * password_changed_at) rather than trusting only what was baked into the token at login time.
 */
export async function authenticate(request: FastifyRequest, env: Env, pool: Queryable): Promise<AuthenticatedRequestContext> {
  const token = extractBearerToken(request);

  let claims: AuthTokenClaims;
  try {
    claims = verifyAuthToken(env, token);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  if (await isTokenRevoked(pool, claims.jti)) {
    throw new UnauthorizedError('This session has been logged out');
  }

  const user = await findUserById(pool, claims.sub);
  if (!user) {
    throw new UnauthorizedError('Account no longer exists');
  }

  if (user.status !== 'active') {
    // Covers super_admin-only suspend/disable (Phase 4) as well as any pre-existing non-active
    // status: a still-valid, still-unrevoked JWT must not keep working once staff has suspended
    // or disabled the account it belongs to.
    throw new UnauthorizedError('Account is not active');
  }

  // Password-change/reset invalidation. Every token carries the current monotonic session
  // version; updatePasswordHash increments it in the same SQL statement as the new password
  // hash. This immediately invalidates all prior sessions, including one minted in the exact same
  // wall-clock second as the reset. Tokens issued before the 0059 migration lack `sv` and map to
  // zero, matching the migration's default without invalidating every deployed user at migration.
  if ((claims.sv ?? 0) !== user.auth_session_version) {
    throw new UnauthorizedError('Session invalidated by a password change — please log in again');
  }

  // The legacy timestamp check remains a conservative compatibility safeguard for deployments
  // that had password_changed_at before the session-version column existed.
  //
  // Comparison precision trade-off (deliberate, documented, accepted — not a bug):
  // JWT `iat` is whole-second precision (a standard `NumericDate`, per RFC 7519), while Postgres
  // `timestamptz` (`password_changed_at`) carries microsecond precision. Comparing them directly
  // (`iat < passwordChangedAtMs`) would reject a token minted in the *same* wall-clock second as
  // the password change, immediately after the change — the extremely common case of "user
  // changes their password, then their client immediately re-authenticates" — because the new
  // token's truncated-to-the-second `iat` can be milliseconds earlier than the sub-second
  // `password_changed_at` timestamp it should be compared against as "after". That was an actual
  // bug caught by this codebase's own tests (see tests/integration/account-api.test.ts).
  //
  // The fix applied here is to floor `password_changed_at` down to whole-second precision before
  // comparing, matching `iat`'s granularity. This guarantees a freshly issued post-change token
  // always validates immediately. Its accepted, narrow trade-off is the mirror image: a token
  // that was issued in the *exact same wall-clock second* as the password change (before the
  // change) is no longer distinguishable from a legitimate post-change token by this check alone,
  // and so is not invalidated until it separately expires. This is judged an acceptable residual
  // limitation rather than a security gap: it requires an attacker to already hold a valid,
  // unexpired, unrevoked token AND for the legitimate password change to happen to land in the
  // same one-second window as that token's issuance — versus the alternative of guaranteed,
  // reproducible failure for every legitimate immediate re-login after a password change, which
  // is strictly worse. Do not "fix" this by moving to sub-second comparison — that reintroduces
  // the original bug. See docs/API_CUSTOMER_APP.md for the full write-up of this contract.
  const tokenIssuedAtMs = claims.iat * 1000;
  const passwordChangedAtMs = Math.floor(new Date(user.password_changed_at).getTime() / 1000) * 1000;
  if (tokenIssuedAtMs < passwordChangedAtMs) {
    throw new UnauthorizedError('Session invalidated by a password change — please log in again');
  }

  // --- Delegated support session -------------------------------------------------------------
  // A token carrying `sup` only works while its support session row is still open and unexpired.
  // Ending the session (or letting it expire) therefore revokes the token immediately, without
  // needing to touch the revocation list, and an admin can never fabricate delegated access by
  // hand-crafting a claim: the row must exist, must name that same admin, and must point at this
  // exact customer.
  let supportSessionId: string | null = null;
  let actingAdminId: string | null = null;
  if (claims.sup) {
    const session = await findSupportSessionById(pool, claims.sup);
    if (!session || !isSupportSessionActive(session)) {
      throw new UnauthorizedError('This support session has ended');
    }
    if (session.customer_uuid !== claims.sub || (claims.act && session.admin_id !== claims.act)) {
      throw new UnauthorizedError('This support session is not valid for this account');
    }
    const admin = await findUserById(pool, session.admin_id);
    if (!admin || admin.status !== 'active' || !['admin', 'super_admin'].includes(admin.role)) {
      // The acting administrator lost their privileges (or their account) mid-session.
      throw new UnauthorizedError('This support session is no longer authorized');
    }
    supportSessionId = session.id;
    actingAdminId = session.admin_id;
  }

  return {
    ...claims,
    userId: claims.sub,
    status: user.status,
    customerId: user.customer_id ?? null,
    supportSessionId,
    actingAdminId,
  };
}
