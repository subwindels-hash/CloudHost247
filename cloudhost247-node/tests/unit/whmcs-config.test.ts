import { describe, expect, it } from 'vitest';
import { assertWriteAllowed, loadWhmcsConfig } from '../../src/whmcs/config';
import { WhmcsInvalidConfigError } from '../../src/whmcs/errors';

/**
 * Configuration is the first place a WHMCS integration goes wrong: an unset secret becomes an empty
 * string, an http URL quietly sends the secret in clear text, or a pasted `includes/api.php` produces
 * a double path. Each of those is asserted here as a refusal.
 */

const BASE_ENV = {
  WHMCS_BASE_URL: 'https://billing.example.com',
  WHMCS_API_IDENTIFIER: 'cloudhost247-site',
  WHMCS_API_SECRET: 'a'.repeat(40),
} as NodeJS.ProcessEnv;

describe('WHMCS configuration', () => {
  it('reports a disabled layer — not a crash — when nothing is configured', () => {
    const result = loadWhmcsConfig({} as NodeJS.ProcessEnv);
    expect(result.enabled).toBe(false);
    if (result.enabled) throw new Error('unreachable');
    expect(result.config).toBeNull();
    expect(result.reason).toContain('WHMCS_BASE_URL');
    expect(result.reason).toContain('WHMCS_API_IDENTIFIER');
    expect(result.reason).toContain('WHMCS_API_SECRET');
  });

  it('names exactly which variables are missing', () => {
    const result = loadWhmcsConfig({ WHMCS_BASE_URL: 'https://billing.example.com' } as NodeJS.ProcessEnv);
    expect(result.enabled).toBe(false);
    if (result.enabled) throw new Error('unreachable');
    expect(result.reason).toContain('WHMCS_API_IDENTIFIER');
    expect(result.reason).toContain('WHMCS_API_SECRET');
    expect(result.reason).not.toContain('WHMCS_BASE_URL');
  });

  it('builds the API endpoint and defaults from a valid environment', () => {
    const result = loadWhmcsConfig(BASE_ENV);
    expect(result.enabled).toBe(true);
    if (!result.enabled) throw new Error('unreachable');
    expect(result.config.baseUrl).toBe('https://billing.example.com');
    expect(result.config.apiUrl).toBe('https://billing.example.com/includes/api.php');
    expect(result.config.cartPath).toBe('cart.php');
    expect(result.config.clientAreaPath).toBe('clientarea.php');
    expect(result.config.timeoutMs).toBe(10_000);
    expect(result.config.maxAttempts).toBe(3);
    expect(result.config.mode).toBe('read-only');
  });

  it('refuses plain http for a non-loopback host', () => {
    expect(() => loadWhmcsConfig({ ...BASE_ENV, WHMCS_BASE_URL: 'http://billing.example.com' })).toThrow(
      WhmcsInvalidConfigError,
    );
  });

  it('allows http for a loopback development host', () => {
    const result = loadWhmcsConfig({ ...BASE_ENV, WHMCS_BASE_URL: 'http://localhost:8080' });
    expect(result.enabled).toBe(true);
  });

  it('refuses credentials embedded in the base URL', () => {
    expect(() =>
      loadWhmcsConfig({ ...BASE_ENV, WHMCS_BASE_URL: 'https://user:pass@billing.example.com' }),
    ).toThrow(WhmcsInvalidConfigError);
  });

  it('accepts a pasted API endpoint and reduces it to the install root', () => {
    const result = loadWhmcsConfig({ ...BASE_ENV, WHMCS_BASE_URL: 'https://billing.example.com/includes/api.php' });
    if (!result.enabled) throw new Error('unreachable');
    expect(result.config.baseUrl).toBe('https://billing.example.com');
    expect(result.config.apiUrl).toBe('https://billing.example.com/includes/api.php');
  });

  it('rejects a secret that is too short to be one', () => {
    expect(() => loadWhmcsConfig({ ...BASE_ENV, WHMCS_API_SECRET: 'short' })).toThrow(WhmcsInvalidConfigError);
  });

  it('rejects an unknown mode instead of defaulting to it', () => {
    expect(() => loadWhmcsConfig({ ...BASE_ENV, WHMCS_MODE: 'write' })).toThrow(WhmcsInvalidConfigError);
  });

  it('rejects out-of-range timeouts and attempt counts', () => {
    expect(() => loadWhmcsConfig({ ...BASE_ENV, WHMCS_API_TIMEOUT_MS: '0' })).toThrow(WhmcsInvalidConfigError);
    expect(() => loadWhmcsConfig({ ...BASE_ENV, WHMCS_MAX_ATTEMPTS: '99' })).toThrow(WhmcsInvalidConfigError);
  });

  it('requires MFA for SSO hand-offs by default, and only steps aside when told to explicitly', () => {
    const byDefault = loadWhmcsConfig(BASE_ENV);
    if (!byDefault.enabled) throw new Error('unreachable');
    expect(byDefault.config.ssoRequireMfa).toBe(true);

    for (const value of ['false', '0', ' FALSE ']) {
      const relaxed = loadWhmcsConfig({ ...BASE_ENV, WHMCS_SSO_REQUIRE_MFA: value });
      if (!relaxed.enabled) throw new Error('unreachable');
      expect(relaxed.config.ssoRequireMfa, value).toBe(false);
    }

    // A typo must not silently weaken the policy into "off".
    expect(() => loadWhmcsConfig({ ...BASE_ENV, WHMCS_SSO_REQUIRE_MFA: 'nope' })).toThrow(WhmcsInvalidConfigError);
  });

  it('refuses write actions while the layer is read-only', () => {
    const result = loadWhmcsConfig(BASE_ENV);
    if (!result.enabled) throw new Error('unreachable');
    expect(() => assertWriteAllowed(result.config, 'AddOrder')).toThrow(WhmcsInvalidConfigError);
    expect(() =>
      assertWriteAllowed({ ...result.config, mode: 'full' }, 'AddOrder'),
    ).not.toThrow();
  });
});
