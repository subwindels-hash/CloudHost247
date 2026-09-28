import { randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Env } from '../config/env';

export interface AuthTokenPayload {
  sub: string; // user id
  role: string;
  email: string;
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

export function signAuthToken(env: Env, payload: AuthTokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
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
