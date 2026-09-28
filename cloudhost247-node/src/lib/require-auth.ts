import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { isTokenRevoked } from '../db/revoked-tokens';
import { UnauthorizedError } from './errors';
import { verifyAuthToken, type AuthTokenClaims } from './jwt';

export interface AuthenticatedRequestContext extends AuthTokenClaims {
  userId: string;
}

function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }
  return header.slice('Bearer '.length);
}

/**
 * Shared authentication check used by every protected route (currently /api/auth/me and
 * /api/auth/logout; future protected routes should use this too rather than re-implementing
 * token parsing). Verifies the JWT signature/expiry, then checks the DB-backed revocation list so
 * a token that was explicitly logged out via /api/auth/logout is rejected immediately, not just
 * once it naturally expires.
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

  return { ...claims, userId: claims.sub };
}
