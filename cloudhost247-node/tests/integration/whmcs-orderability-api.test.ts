import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { WhmcsClient } from '../../src/whmcs/client';
import { loadWhmcsConfig, type WhmcsConfig } from '../../src/whmcs/config';
import {
  computeSnapshotChecksum,
  fingerprintBaseUrl,
  sealProductMap,
} from '../../src/whmcs/product-map';
import type { Transport, TransportRequest } from '../../src/whmcs/transport';

/**
 * B2.4 through the real HTTP surface, with a real (sealed, checksummed) product map on disk and a
 * scripted WHMCS.
 *
 * The properties under test are the ones a storefront depends on:
 *  - a page cannot be told a service is buyable unless the map binds it *and* WHMCS still sells it;
 *  - every other service says, in a machine-readable way, exactly why it is not;
 *  - nothing a client sends can change the verdict or the price;
 *  - a WHMCS outage degrades to "unavailable" on a 200, never to a 500 and never to a stale price.
 */

const BASE_URL = 'https://billing.example.com';

const ENV = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'g'.repeat(32),
} as NodeJS.ProcessEnv);

function productMapFixture(): unknown {
  const snapshot = {
    version: 1 as const,
    source: 'whmcs-getproducts' as const,
    baseUrlFingerprint: fingerprintBaseUrl(BASE_URL),
    whmcsVersion: '8.9.0',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    products: [
      {
        id: 101,
        groupId: 3,
        name: 'Business Hosting',
        module: 'cpanel',
        payType: 'recurring',
        hidden: false,
        currencies: ['USD'],
        cycles: { USD: ['monthly' as const, 'annually' as const] },
      },
    ],
  };
  const checksum = computeSnapshotChecksum(snapshot);
  return sealProductMap({
    ...snapshot,
    services: {
      'business-hosting': {
        productId: 101,
        productGroupId: 3,
        billingCycles: ['monthly', 'annually'],
        provisioningModule: 'cpanel',
        boundAt: '2026-01-01T00:00:00.000Z',
        boundFrom: checksum,
      },
    },
    unmapped: {
      'shared-hosting': { reason: 'no WHMCS product selected yet', since: '2026-01-01T00:00:00.000Z' },
    },
  });
}

const dir = mkdtempSync(path.join(tmpdir(), 'whmcs-map-'));
const GOOD_MAP = path.join(dir, 'product-map.json');
writeFileSync(GOOD_MAP, JSON.stringify(productMapFixture(), null, 2));

// A map whose body was edited after sealing: the checksum no longer matches.
const TAMPERED_MAP = path.join(dir, 'tampered-map.json');
const tampered = productMapFixture() as { services: Record<string, { productId: number }> };
tampered.services['business-hosting']!.productId = 999;
writeFileSync(TAMPERED_MAP, JSON.stringify(tampered, null, 2));

afterAll(() => {
  // tmpdir, removed by the OS; nothing to clean inside the repository.
});

function whmcsConfig(): WhmcsConfig {
  const loaded = loadWhmcsConfig({
    WHMCS_BASE_URL: BASE_URL,
    WHMCS_API_IDENTIFIER: 'cloudhost247-site',
    WHMCS_API_SECRET: 'super-secret-value-that-must-not-leak',
  } as NodeJS.ProcessEnv);
  if (!loaded.enabled) throw new Error('test env invalid');
  return loaded.config;
}

interface Scenario {
  products?: unknown[];
  currencies?: unknown[];
  groups?: unknown[];
  fail?: boolean;
}

function whmcs(scenario: Scenario = {}) {
  const requests: TransportRequest[] = [];
  const products = scenario.products ?? [
    {
      pid: 101,
      gid: 3,
      name: 'Business Hosting',
      module: 'cpanel',
      paytype: 'recurring',
      pricing: { USD: { monthly: '12.50', annually: '120.00', quarterly: '-1' } },
    },
  ];
  const currencies = scenario.currencies ?? [{ id: 1, code: 'USD', default: '1' }];
  const groups = scenario.groups ?? [{ id: 3, name: 'Hosting' }];

  const transport: Transport = {
    async send(request) {
      requests.push(request);
      if (scenario.fail) {
        const error = new Error('connect ECONNREFUSED');
        throw error;
      }
      const action = new URLSearchParams(request.body).get('action');
      if (action === 'GetProductGroups') return { status: 200, body: JSON.stringify({ result: 'success', productgroups: groups }) };
      if (action === 'GetProducts') return { status: 200, body: JSON.stringify({ result: 'success', products }) };
      if (action === 'GetCurrencies') return { status: 200, body: JSON.stringify({ result: 'success', currencies }) };
      return { status: 200, body: JSON.stringify({ result: 'error', message: `unexpected ${action}` }) };
    },
  };

  const config = whmcsConfig();
  return {
    requests,
    deps: {
      whmcsConfig: { enabled: true as const, config, reason: null as string | null },
      whmcsClient: new WhmcsClient({ config, transport }),
      mapPath: GOOD_MAP,
      catalogueTtlMs: 60_000,
    },
  };
}

function app(deps: Parameters<typeof buildApp>[1]['whmcsPublic']) {
  return buildApp(ENV, { serveFrontend: false, whmcsPublic: deps });
}

describe('GET /api/v1/whmcs/orderability', () => {
  it('is public and reports a bound, live, priced service as orderable', async () => {
    const fake = whmcs();
    const response = await app(fake.deps).inject({ method: 'GET', url: '/api/v1/whmcs/orderability' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ configured: true, mapValid: true, currency: 'USD' });

    const orderable = body.services.find((s: { serviceKey: string }) => s.serviceKey === 'business-hosting');
    expect(orderable).toMatchObject({
      state: 'orderable',
      orderable: true,
      reasonCode: 'ORDERABLE',
      productId: '101',
      productName: 'Business Hosting',
      currency: 'USD',
    });
    expect(orderable.cycles).toEqual([
      expect.objectContaining({
        cycle: 'monthly',
        price: '12.50',
        cartUrl: 'https://billing.example.com/cart.php?a=add&pid=101&billingcycle=monthly',
      }),
      expect.objectContaining({
        cycle: 'annually',
        price: '120.00',
        cartUrl: 'https://billing.example.com/cart.php?a=add&pid=101&billingcycle=annually',
      }),
    ]);
    // WHMCS's "-1" quarterly cycle never appears.
    expect(orderable.cycles.map((c: { cycle: string }) => c.cycle)).not.toContain('quarterly');

    // Prices are strings, exactly as WHMCS sent them.
    for (const cycle of orderable.cycles) expect(typeof cycle.price).toBe('string');
    expect(response.headers['cache-control']).toContain('max-age=30');
  });

  it('reports every service that has no binding as NOT INTEGRATED', async () => {
    const response = await app(whmcs().deps).inject({ method: 'GET', url: '/api/v1/whmcs/orderability' });
    const body = response.json();
    const shared = body.services.find((s: { serviceKey: string }) => s.serviceKey === 'shared-hosting');
    expect(shared).toMatchObject({
      state: 'not-integrated',
      orderable: false,
      reasonCode: 'NOT_INTEGRATED',
      productId: null,
      cycles: [],
    });
    // The operator's note stays internal.
    expect(shared.reason).not.toContain('no WHMCS product selected yet');
  });

  it('cannot be talked into an orderable verdict by the client', async () => {
    const response = await app(whmcs().deps).inject({
      method: 'GET',
      // Everything an attacker or an over-eager component might try. All dropped by the schema.
      url: '/api/v1/whmcs/orderability?services=shared-hosting,unknown-thing&orderable=true&force=1&pid=101&price=0.01&currency=USD',
    });
    expect(response.statusCode).toBe(200);
    for (const service of response.json().services) {
      expect(service.orderable).toBe(false);
      expect(service.state).not.toBe('orderable');
      expect(service.cycles).toEqual([]);
    }
  });

  it('drops a bound service when WHMCS no longer sells it', async () => {
    const fake = whmcs({ products: [] });
    const response = await app(fake.deps).inject({
      method: 'GET',
      url: '/api/v1/whmcs/orderability/business-hosting',
    });
    expect(response.statusCode).toBe(200);
    const [service] = response.json().services;
    expect(service).toMatchObject({ state: 'unavailable', orderable: false, reasonCode: 'PRODUCT_NOT_IN_CATALOGUE' });
    expect(service.cycles).toEqual([]);
  });

  it('says "no purchasable cycle" when the product exists but the bound cycles are unpriced', async () => {
    const fake = whmcs({
      products: [
        { pid: 101, gid: 3, name: 'Business Hosting', module: 'cpanel', paytype: 'recurring', pricing: { USD: { monthly: '-1', annually: '-1' } } },
        // A second product keeps the catalogue "priced in USD", so the failure is per-service.
        { pid: 202, gid: 3, name: 'Starter', module: 'cpanel', paytype: 'recurring', pricing: { USD: { monthly: '5.00' } } },
      ],
    });
    const response = await app(fake.deps).inject({ method: 'GET', url: '/api/v1/whmcs/orderability/business-hosting' });
    expect(response.json().services[0]).toMatchObject({
      state: 'unavailable',
      reasonCode: 'NO_CYCLES_OFFERED',
      orderable: false,
    });
  });

  it('refuses a currency the install does not sell', async () => {
    const response = await app(whmcs().deps).inject({
      method: 'GET',
      url: '/api/v1/whmcs/orderability?currency=EUR',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.currency).toBeNull();
    const bound = body.services.find((s: { serviceKey: string }) => s.serviceKey === 'business-hosting');
    expect(bound).toMatchObject({ state: 'unavailable', orderable: false, reasonCode: 'CURRENCY_UNAVAILABLE', cycles: [] });
    // An unmapped service keeps saying "not integrated": that is the credential-independent truth
    // and it does not change with the currency.
    const unmapped = body.services.find((s: { serviceKey: string }) => s.serviceKey === 'shared-hosting');
    expect(unmapped.reasonCode).toBe('NOT_INTEGRATED');
  });

  it('rejects a malformed currency instead of guessing', async () => {
    const response = await app(whmcs().deps).inject({
      method: 'GET',
      url: '/api/v1/whmcs/orderability?currency=dollars',
    });
    expect(response.statusCode).toBe(400);
  });

  it('degrades to UPSTREAM_UNAVAILABLE on a WHMCS outage, never to a 500', async () => {
    const fake = whmcs({ fail: true });
    const response = await app(fake.deps).inject({ method: 'GET', url: '/api/v1/whmcs/orderability' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.configured).toBe(true);
    const bound = body.services.find((s: { serviceKey: string }) => s.serviceKey === 'business-hosting');
    expect(bound).toMatchObject({ state: 'unavailable', orderable: false, reasonCode: 'UPSTREAM_UNAVAILABLE' });
    // Nothing anywhere in the answer claims a price or a cart link during an outage.
    expect(body.services.every((s: { orderable: boolean; cycles: unknown[] }) => !s.orderable && s.cycles.length === 0)).toBe(true);
  });

  it('reports an unconfigured deployment as explicitly unavailable', async () => {
    const response = await app({
      whmcsConfig: { enabled: false, config: null, reason: 'WHMCS is not connected: WHMCS_BASE_URL not set' },
      mapPath: GOOD_MAP,
    }).inject({ method: 'GET', url: '/api/v1/whmcs/orderability' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.configured).toBe(false);
    expect(body.mapValid).toBe(true);
    expect(body.services.length).toBeGreaterThan(0);
    // No service is orderable, and the one that *would* be gets the explicit disabled state.
    expect(body.services.every((s: { orderable: boolean }) => s.orderable === false)).toBe(true);
    const bound = body.services.find((s: { serviceKey: string }) => s.serviceKey === 'business-hosting');
    expect(bound).toMatchObject({ state: 'unavailable', reasonCode: 'WHMCS_DISABLED' });
  });

  it('fails closed when the product map has been edited after sealing', async () => {
    const response = await app({ ...whmcs().deps, mapPath: TAMPERED_MAP }).inject({
      method: 'GET',
      url: '/api/v1/whmcs/orderability/business-hosting',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mapValid).toBe(false);
    expect(body.services[0]).toMatchObject({ state: 'unavailable', reasonCode: 'MAP_INVALID', orderable: false });
  });

  it('fails closed when the product map is missing entirely', async () => {
    const response = await app({ ...whmcs().deps, mapPath: path.join(dir, 'does-not-exist.json') }).inject({
      method: 'GET',
      url: '/api/v1/whmcs/orderability?services=business-hosting',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mapValid: false });
    expect(response.json().services[0].reasonCode).toBe('MAP_INVALID');
  });

  it('shares one catalogue read across requests inside the cache window', async () => {
    const fake = whmcs();
    const instance = app(fake.deps);
    await instance.inject({ method: 'GET', url: '/api/v1/whmcs/orderability' });
    const afterFirst = fake.requests.length;
    await instance.inject({ method: 'GET', url: '/api/v1/whmcs/orderability' });
    await instance.inject({ method: 'GET', url: '/api/v1/whmcs/orderability/business-hosting' });
    expect(fake.requests.length).toBe(afterFirst);
    expect(afterFirst).toBe(3);
  });

  it('re-reads when caching is disabled', async () => {
    const fake = whmcs();
    const instance = app({ ...fake.deps, catalogueTtlMs: 0 });
    await instance.inject({ method: 'GET', url: '/api/v1/whmcs/orderability' });
    await instance.inject({ method: 'GET', url: '/api/v1/whmcs/orderability' });
    expect(fake.requests.length).toBe(6);
  });

  it('rejects an unusable service key in the path', async () => {
    const response = await app(whmcs().deps).inject({
      method: 'GET',
      url: '/api/v1/whmcs/orderability/Business%20Hosting',
    });
    expect(response.statusCode).toBe(400);
  });

  it('never leaks a credential or a password in any answer', async () => {
    const response = await app(whmcs().deps).inject({ method: 'GET', url: '/api/v1/whmcs/orderability' });
    const text = JSON.stringify(response.json());
    expect(text).not.toContain('super-secret-value-that-must-not-leak');
    expect(text.toLowerCase()).not.toContain('password');
  });
});
