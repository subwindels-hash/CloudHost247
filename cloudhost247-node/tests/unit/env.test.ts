import { describe, expect, it } from 'vitest';
import { loadEnv, EnvValidationError } from '../../src/config/env';

const validBase = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'a'.repeat(32),
};

describe('env validation', () => {
  it('accepts a valid, minimal configuration and applies safe defaults', () => {
    const env = loadEnv(validBase as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = validBase;
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(EnvValidationError);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadEnv({ ...validBase, DATABASE_URL: 'mysql://user:pass@host/db' } as NodeJS.ProcessEnv)).toThrow(
      EnvValidationError
    );
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => loadEnv({ ...validBase, JWT_SECRET: 'too-short' } as NodeJS.ProcessEnv)).toThrow(EnvValidationError);
  });

  it('never includes secret values in the thrown error message', () => {
    try {
      loadEnv({ ...validBase, JWT_SECRET: 'super-secret-but-too-short' } as NodeJS.ProcessEnv);
      throw new Error('expected loadEnv to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as Error).message).not.toContain('super-secret-but-too-short');
    }
  });

  it('coerces DATABASE_SSL string flags to booleans', () => {
    const env = loadEnv({ ...validBase, DATABASE_SSL: 'true' } as NodeJS.ProcessEnv);
    expect(env.DATABASE_SSL).toBe(true);
  });
});
