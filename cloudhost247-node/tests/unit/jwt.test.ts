import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { signAuthToken, verifyAuthToken } from '../../src/lib/jwt';

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
