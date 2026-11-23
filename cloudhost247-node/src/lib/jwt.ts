import { randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Env } from '../config/env';

export interface AuthTokenPayload {
  sub: string; // user id
  role: string;
  email: string;
  /** Monotonic per-user session generation, incremented on password change/reset. */
  sv?: number;
  /**
   * Delegated "support mode" claims (spec §32). Present only on tokens minted by
   * POST /api/v1/admin/customers/:id/switch. `sup` is the admin_support_sessions row id and
   * `act` ("actor") is the administrator who is acting — the customer the token authenticates as
   * stays in `sub`, so ownership scoping in every existing route keeps working unchanged, while
   * the real human behind the request is never lost.
   *
   * These claims are advisory only: src/lib/require-auth.ts re-reads the support session row
   * from the database on every request, so a token cannot outlive a session that was ended or
   * has expired, and it can never be *self*-granted — the claim is worthless without the row.
   */
  sup?: string;
  act?: string;
}

/**
 * The decoded/verified shape of a token, including the standard claims jsonwebtoken adds
 * automatically: `jti` (a random per-token id, used by src/db/revoked-tokens.ts so logout can
 * invalidate one specific token — see database/migrations/0003_create_revoked_tokens.sql) and the
 * standard `iat`/`exp` timestamps (seconds since epoch).
 */
export interface AuthTokenClaims extends AuthTokenPayload {
  jti: string;
  iat: number;
  exp: number;
}

export function signAuthToken(env: Env, payload: AuthTokenPayload, overrides: { expiresIn?: SignOptions['expiresIn'] } = {}): string {
  const options: SignOptions = {
    // Support-mode tokens deliberately pass a shorter lifetime than the platform default.
    expiresIn: overrides.expiresIn ?? (env.JWT_EXPIRES_IN as SignOptions['expiresIn']),
    jwtid: randomUUID(),
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyAuthToken(env: Env, token: string): AuthTokenClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string') {
    throw new Error('Invalid token payload');
  }
  return decoded as unknown as AuthTokenClaims;
}

/**
 * Reads the `jti`/`exp` pair from a token this app just signed, WITHOUT verifying the signature.
 *
 * Used only on the login response path, where the token was minted by this process microseconds
 * earlier and the caller needs its id and expiry to record the session row. It is deliberately not
 * an authentication primitive: nothing may call this on a token that arrived from a client. The
 * claims are shape-checked rather than trusted, so a malformed token throws instead of yielding a
 * session row keyed on `undefined`.
 */
export function decodeAuthTokenClaims(token: string): { jti: string; exp: number } {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string') {
    throw new Error('Invalid token payload');
  }
  const claims = decoded as { jti?: unknown; exp?: unknown };
  if (typeof claims.jti !== 'string' || typeof claims.exp !== 'number') {
    throw new Error('Token is missing jti/exp claims');
  }
  return { jti: claims.jti, exp: claims.exp };
}
