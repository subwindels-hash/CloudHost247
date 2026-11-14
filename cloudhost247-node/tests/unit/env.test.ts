import { describe, expect, it } from 'vitest';
import { loadEnv, loadRuntimeEnv, EnvValidationError } from '../../src/config/env';

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
    expect(env.WORKER_ONCE).toBe(false);
    expect(env.WORKER_ONCE_LEASE_MS).toBe(900_000);
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
    const envUpper = loadEnv({ ...validBase, DATABASE_SSL: 'YES' } as NodeJS.ProcessEnv);
    expect(envUpper.DATABASE_SSL).toBe(true);
  });

  it('treats blank optional environment variables as unset instead of failing startup', () => {
    const env = loadEnv({
      ...validBase,
      FX_FEED_URL: '',
      STRIPE_WEBHOOK_SECRET: '   ',
      ACME_DIRECTORY_URL: '',
      SOCKET_PATH: '',
    } as NodeJS.ProcessEnv);
    expect(env.FX_FEED_URL).toBeUndefined();
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(env.SOCKET_PATH).toBeUndefined();
  });

  it('maps Unix socket paths injected into PORT (LiteSpeed lsnode / Passenger) to SOCKET_PATH', () => {
    const env = loadEnv({
      ...validBase,
      PORT: '/tmp/lshttpd/lsnode.sock',
    } as NodeJS.ProcessEnv);
    expect(env.SOCKET_PATH).toBe('/tmp/lshttpd/lsnode.sock');
    expect(env.PORT).toBe(3000);

    const unixPrefixed = loadEnv({
      ...validBase,
      PORT: 'unix:/home/cpaneluser/passenger.sock',
    } as NodeJS.ProcessEnv);
    expect(unixPrefixed.SOCKET_PATH).toBe('/home/cpaneluser/passenger.sock');
  });

  it('normalizes scheme-less APP_URL hostnames entered in cPanel', () => {
    const prod = loadEnv({
      ...validBase,
      APP_URL: 'try.vortexprecisionit.com',
    } as NodeJS.ProcessEnv);
    expect(prod.APP_URL).toBe('https://try.vortexprecisionit.com');

    const local = loadEnv({
      ...validBase,
      APP_URL: 'localhost:4000',
    } as NodeJS.ProcessEnv);
    expect(local.APP_URL).toBe('http://localhost:4000');
  });

  it('loadRuntimeEnv derives ephemeral JWT_SECRET and unconfigured DB state when unset', () => {
    const runtime = loadRuntimeEnv({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(runtime.jwtSecretEphemeral).toBe(true);
    expect(runtime.databaseConfigured).toBe(false);
    expect(runtime.env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(runtime.warnings.length).toBe(2);

    // Explicit invalid secrets/URLs still fail closed.
    expect(() =>
      loadRuntimeEnv({ NODE_ENV: 'production', JWT_SECRET: 'short' } as NodeJS.ProcessEnv)
    ).toThrow(EnvValidationError);
    expect(() =>
      loadRuntimeEnv({ NODE_ENV: 'production', DATABASE_URL: 'mysql://localhost/db' } as NodeJS.ProcessEnv)
    ).toThrow(EnvValidationError);
  });
});
