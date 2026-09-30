import { describe, expect, it } from 'vitest';
import { CloudflareClient } from '../../src/integrations/cloudflare/client';
import { CloudflareError, normalizeCloudflareFailure } from '../../src/integrations/cloudflare/errors';
import { capabilitiesForPlan, tierFromZonePlan } from '../../src/integrations/cloudflare/types';
import { ensureZone } from '../../src/integrations/cloudflare/zones';
import { resolveEntitlements } from '../../src/services/cloudflare-service';
import { MockCloudflare } from '../helpers/mock-cloudflare';

const noSleep = () => Promise.resolve();

function clientFor(mock: MockCloudflare, token = mock.validToken) {
  return new CloudflareClient({
    baseUrl: 'https://api.cloudflare.test/client/v4',
    apiToken: token,
    fetchImpl: mock.fetch,
    sleep: noSleep,
  });
}

describe('cloudflare error normalization', () => {
  it('maps documented statuses/codes to stable platform codes', () => {
    expect(normalizeCloudflareFailure(401, []).code).toBe('CLOUDFLARE_AUTH_FAILED');
    expect(normalizeCloudflareFailure(403, []).code).toBe('CLOUDFLARE_PERMISSION_DENIED');
    expect(normalizeCloudflareFailure(429, []).code).toBe('CLOUDFLARE_RATE_LIMITED');
    expect(normalizeCloudflareFailure(404, [{ code: 1001 }]).code).toBe('CLOUDFLARE_ZONE_NOT_FOUND');
    expect(normalizeCloudflareFailure(400, [{ code: 81044 }]).code).toBe('CLOUDFLARE_RECORD_NOT_FOUND');
    expect(normalizeCloudflareFailure(500, []).code).toBe('CLOUDFLARE_SERVICE_UNAVAILABLE');
    expect(normalizeCloudflareFailure(400, []).code).toBe('CLOUDFLARE_VALIDATION_ERROR');
  });

  it('marks only transient failures retryable', () => {
    expect(normalizeCloudflareFailure(429, []).retryable).toBe(true);
    expect(normalizeCloudflareFailure(503, []).retryable).toBe(true);
    expect(normalizeCloudflareFailure(401, []).retryable).toBe(false);
    expect(normalizeCloudflareFailure(400, []).retryable).toBe(false);
  });
});

describe('cloudflare client', () => {
  it('authenticates with the bearer token and validates the envelope', async () => {
    const mock = new MockCloudflare();
    const client = clientFor(mock);
    const { result } = await client.request<{ status: string }>('token.verify', 'GET', '/user/tokens/verify');
    expect(result.status).toBe('active');
  });

  it('fails with CLOUDFLARE_AUTH_FAILED for a bad token and does not retry it', async () => {
    const mock = new MockCloudflare();
    const client = clientFor(mock, 'wrong-token');
    await expect(client.request('token.verify', 'GET', '/user/tokens/verify')).rejects.toMatchObject({
      code: 'CLOUDFLARE_AUTH_FAILED',
    });
    expect(mock.requests).toHaveLength(1); // no retry on non-retryable auth failure
  });

  it('retries rate-limited requests with backoff and then succeeds', async () => {
    const mock = new MockCloudflare();
    mock.addZone('retry.example');
    mock.failNext((m, p) => m === 'GET' && p === '/zones', 429, 971, 'rate limited', 2);
    const client = clientFor(mock);
    const { result } = await client.request<unknown[]>('zones.list', 'GET', '/zones', undefined, { name: 'retry.example' });
    expect(result).toHaveLength(1);
    expect(mock.requests.filter((r) => r.path === '/zones')).toHaveLength(3);
  });

  it('gives up after max retries and surfaces the normalized error', async () => {
    const mock = new MockCloudflare();
    mock.failNext((m, p) => p === '/zones', 429, 971, 'rate limited', 99);
    const client = clientFor(mock);
    await expect(client.request('zones.list', 'GET', '/zones')).rejects.toMatchObject({ code: 'CLOUDFLARE_RATE_LIMITED' });
  });
});

describe('zone idempotency (spec §42)', () => {
  it('ensureZone reuses an existing zone instead of creating a duplicate', async () => {
    const mock = new MockCloudflare();
    const existing = mock.addZone('reuse.example');
    const client = clientFor(mock);

    const first = await ensureZone(client, mock.accountId, 'REUSE.example');
    expect(first.reused).toBe(true);
    expect(first.zone.id).toBe(existing.id);
    expect(mock.zones.size).toBe(1);

    const second = await ensureZone(client, mock.accountId, 'fresh.example');
    expect(second.reused).toBe(false);
    const third = await ensureZone(client, mock.accountId, 'fresh.example');
    expect(third.reused).toBe(true);
    expect(third.zone.id).toBe(second.zone.id);
    expect(mock.zones.size).toBe(2);
  });
});

describe('capabilities and entitlements', () => {
  it('plan tiers resolve from zone plan payloads', () => {
    expect(tierFromZonePlan({ id: 'z', name: 'x', status: 'active', paused: false, plan: { legacy_id: 'pro' } })).toBe('pro');
    expect(tierFromZonePlan({ id: 'z', name: 'x', status: 'active', paused: false, plan: { name: 'Business Website' } })).toBe('business');
    expect(tierFromZonePlan({ id: 'z', name: 'x', status: 'active', paused: false })).toBe('free');
  });

  it('capability layer blocks plan change for enterprise; entitlements never exceed capabilities', () => {
    expect(capabilitiesForPlan('pro').supportsPlanChange).toBe(true);
    expect(capabilitiesForPlan('enterprise').supportsPlanChange).toBe(false);
    const entitlements = resolveEntitlements(null, 'enterprise');
    expect(entitlements.plan_change).toBe(false);
    expect(entitlements.dns).toBe(true);
  });

  it('admin mapping overrides tier defaults (feature matrix per product)', () => {
    const mapping = {
      id: 'm1', plan_id: 'p1', cloudflare_plan: 'free', max_domains: 1, provisioning_mode: 'automatic',
      default_ssl_mode: null, default_proxied: null, created_by: null, created_at: '', updated_at: '',
      entitlements: { firewall: true, analytics: false },
    } as never;
    const entitlements = resolveEntitlements(mapping, 'free');
    expect(entitlements.firewall).toBe(true); // enabled by admin despite free default
    expect(entitlements.analytics).toBe(false); // disabled by admin despite free default
    expect(entitlements.dns).toBe(true); // untouched default
  });
});

describe('CloudflareError safety', () => {
  it('safeMessage never contains upstream detail', () => {
    const error = new CloudflareError('CLOUDFLARE_API_ERROR', 'internal-token-oops', [{ code: 1, message: 'secret detail' }]);
    expect(error.safeMessage).not.toContain('secret detail');
    expect(error.safeMessage).not.toContain('internal-token-oops');
  });
});
