import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { findUserById } from '../db/users';
import { authenticate, type AuthenticatedRequestContext } from './require-auth';
import { ForbiddenError, UnauthorizedError } from './errors';

export interface AuthorizedRequestContext extends AuthenticatedRequestContext {
  /** The user's *current* role/status, re-read from the database — never trusted from the JWT
   * claim alone (see rationale below). */
  role: string;
}

/**
 * Authorization check for role-gated routes (currently: catalog administration).
 *
 * Deliberately re-reads the user's role/status from the database on every call instead of trusting
 * the `role` claim embedded in the JWT at login time. The JWT claim is signed and cannot be
 * tampered with by the client, but it is still a *snapshot* taken at login: if an operator revokes
 * someone's admin role in the database, a JWT they obtained before that change would otherwise go
 * on claiming the old role until it naturally expires. Re-checking against the database closes
 * that window immediately, consistent with this project's "never trust a stale/client-controlled
 * role check" requirement — applied here to the backend's own source of truth, not just the
 * frontend.
 *
 * Throws UnauthorizedError (401) if the token itself is missing/invalid/revoked, or ForbiddenError
 * (403) if the token is valid but the account's current role isn't in `allowedRoles`.
 */
export async function requireRole(
  request: FastifyRequest,
  env: Env,
  pool: Queryable,
  allowedRoles: readonly string[]
): Promise<AuthorizedRequestContext> {
  const auth = await authenticate(request, env, pool);

  const user = await findUserById(pool, auth.userId);
  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('Account no longer exists or is not active');
  }

  if (!allowedRoles.includes(user.role)) {
    throw new ForbiddenError('Insufficient permissions for this action');
  }

  return { ...auth, role: user.role };
}
