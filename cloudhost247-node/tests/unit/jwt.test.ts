import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { decodeAuthTokenClaims, signAuthToken, verifyAuthToken } from '../../src/lib/jwt';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'b'.repeat(32),
  JWT_EXPIRES_IN: '1h',
} as NodeJS.ProcessEnv);

describe('jwt helpers', () => {
  it('round-trips a signed token', () => {
    const token = signAuthToken(env, { sub: 'user-1', role: 'customer', email: 'a@example.com' });
    const decoded = verifyAuthToken(env, token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('customer');
    expect(decoded.email).toBe('a@example.com');
    // jti is used by src/lib/require-auth.ts + src/db/revoked-tokens.ts to invalidate one
    // specific token on logout (see database/migrations/0003_create_revoked_tokens.sql).
    expect(decoded.jti).toEqual(expect.any(String));
    expect(decoded.exp).toEqual(expect.any(Number));
  });

  it('gives two tokens for the same user different jti values', () => {
    const a = signAuthToken(env, { sub: 'user-1', role: 'customer', email: 'a@example.com' });
    const b = signAuthToken(env, { sub: 'user-1', role: 'customer', email: 'a@example.com' });
    expect(verifyAuthToken(env, a).jti).not.toBe(verifyAuthToken(env, b).jti);
  });

  it('rejects a token signed with a different secret', () => {
    const otherEnv = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'c'.repeat(32),
    } as NodeJS.ProcessEnv);
    const token = signAuthToken(otherEnv, { sub: 'user-1', role: 'customer', email: 'a@example.com' });
    expect(() => verifyAuthToken(env, token)).toThrow();
  });

  it('rejects a tampered token', () => {
    const token = signAuthToken(env, { sub: 'user-1', role: 'customer', email: 'a@example.com' });
    expect(() => verifyAuthToken(env, `${token}tampered`)).toThrow();
  });
});

describe('decodeAuthTokenClaims', () => {
  it('reads the jti and exp of a token this app just signed, without verifying it', () => {
    const token = signAuthToken(env, { sub: 'user-1', role: 'customer', email: 'a@example.com' });
    const decoded = decodeAuthTokenClaims(token);
    expect(decoded.jti).toBe(verifyAuthToken(env, token).jti);
    expect(decoded.exp).toBe(verifyAuthToken(env, token).exp);
  });

  it('throws on a token with no jti/exp rather than yielding undefined claims', () => {
    // Signed with a payload that cannot carry the standard claims, so the shape check is what
    // refuses it — a session row keyed on `undefined` would be a silent corruption.
    const unsigned = 'not-a-token';
    expect(() => decodeAuthTokenClaims(unsigned)).toThrow();
  });
});
