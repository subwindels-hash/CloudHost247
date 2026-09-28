import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Env } from '../config/env';

export interface AuthTokenPayload {
  sub: string; // user id
  role: string;
  email: string;
}

export function signAuthToken(env: Env, payload: AuthTokenPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyAuthToken(env: Env, token: string): AuthTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string') {
    throw new Error('Invalid token payload');
  }
  return decoded as unknown as AuthTokenPayload;
}
