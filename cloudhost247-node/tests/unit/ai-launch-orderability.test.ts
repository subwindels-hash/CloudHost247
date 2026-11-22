import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLaunchServiceKey, lookupLaunchOrderability } from '../../src/whmcs/agent-orderability';

afterEach(() => vi.unstubAllEnvs());

describe('read-only launch orderability adapter', () => {
  it('only accepts the fixed website hosting categories', () => {
    expect(isLaunchServiceKey('hosting-wordpress')).toBe(true);
    expect(isLaunchServiceKey('hosting-business')).toBe(true);
    expect(isLaunchServiceKey('hosting-web-hosting')).toBe(true);
    expect(isLaunchServiceKey('https://other.example')).toBe(false);
    expect(isLaunchServiceKey('hosting-dedicated')).toBe(false);
  });

  it('uses the checked-in map and returns no order or price without configured WHMCS', async () => {
    vi.stubEnv('WHMCS_BASE_URL', '');
    vi.stubEnv('WHMCS_API_IDENTIFIER', '');
    vi.stubEnv('WHMCS_API_SECRET', '');
    const result = await lookupLaunchOrderability('hosting-wordpress');
    expect(result.orderable).toBe(false);
    expect(result.reasonCode).toBe('NOT_INTEGRATED');
    expect(result.cycles).toEqual([]);
  });
});
