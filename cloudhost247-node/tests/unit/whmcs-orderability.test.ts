import { describe, expect, it } from 'vitest';
import { decideMany, decideOrderability, createCatalogueLoader, catalogueFailure } from '../../src/whmcs/orderability';
import {
  computeSnapshotChecksum,
  fingerprintBaseUrl,
  sealProductMap,
  type ProductMapDocument,
} from '../../src/whmcs/product-map';
import { WhmcsClient } from '../../src/whmcs/client';
import { loadWhmcsConfig, type WhmcsConfig } from '../../src/whmcs/config';
import { WhmcsCurrencyUnavailableError, WhmcsMapChecksumError, WhmcsTimeoutError } from '../../src/whmcs/errors';
import type { NormalizedCatalogue } from '../../src/whmcs/types';
import type { Transport, TransportRequest } from '../../src/whmcs/transport';

/**
 * B2.4 — the orderability verdict.
 *
 * These tests are the specification of "no page may show a price or a buy button WHMCS did not
 * provide": each one removes one of the four preconditions and asserts that the service stops being
 * orderable, with the specific reason a page is expected to render.
 */

const BASE_URL = 'https://billing.example.com';

function mapFixture(): ProductMapDocument {
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
  const snapshotChecksum = computeSnapshotChecksum(snapshot);
  return sealProductMap({
    ...snapshot,
    services: {
      'business-hosting': {
        productId: 101,
        productGroupId: 3,
        billingCycles: ['monthly', 'annually'],
        provisioningModule: 'cpanel',
        boundAt: '2026-01-01T00:00:00.000Z',
        boundFrom: snapshotChecksum,
      },
    },
    unmapped: {
      'shared-hosting': { reason: 'no WHMCS product selected yet', since: '2026-01-01T00:00:00.000Z' },
    },
  });
}

function catalogue(overrides: Partial<NormalizedCatalogue> = {}): NormalizedCatalogue {
  return {
    currency: 'USD',
    groups: [{ id: 3, name: 'Hosting', hidden: false }],
    products: [
      {
        id: 101,
        groupId: 3,
        name: 'Business Hosting',
        description: 'Hosting plan',
        module: 'cpanel',
        payType: 'recurring',
        hidden: false,
        currencies: {
          USD: {
            code: 'USD',
            prefix: '$',
            suffix: ' USD',
            cycles: {
              monthly: { price: '12.50', setupFee: '0.00' },
              annually: { price: '120.00', setupFee: '0.00' },
            },
          },
        },
      },
    ],
    unpricedProductIds: [],
    ...overrides,
  };
}

const CART = { baseUrl: BASE_URL, cartPath: 'cart.php' };

describe('decideOrderability', () => {
  it('is orderable only with a binding, a live product and priced cycles', () => {
    const decision = decideOrderability({
      map: mapFixture(),
      serviceKey: 'business-hosting',
      catalogue: catalogue(),
      cart: CART,
    });

    expect(decision.state).toBe('orderable');
    expect(decision.orderable).toBe(true);
    expect(decision.reasonCode).toBe('ORDERABLE');
    expect(decision.productId).toBe('101');
    expect(decision.productName).toBe('Business Hosting');
    expect(decision.currency).toBe('USD');
    expect(decision.cycles).toEqual([
      {
        cycle: 'monthly',
        price: '12.50',
        setupFee: '0.00',
        currency: 'USD',
        cartUrl: 'https://billing.example.com/cart.php?a=add&pid=101&billingcycle=monthly',
      },
      {
        cycle: 'annually',
        price: '120.00',
        setupFee: '0.00',
        currency: 'USD',
        cartUrl: 'https://billing.example.com/cart.php?a=add&pid=101&billingcycle=annually',
      },
    ]);
  });

  it('keeps WHMCS prices as strings, never recomputed', () => {
    const decision = decideOrderability({
      map: mapFixture(),
      serviceKey: 'business-hosting',
      catalogue: catalogue(),
      cart: CART,
    });
    for (const cycle of decision.cycles) expect(typeof cycle.price).toBe('string');
  });

  it('reports an unmapped service as NOT INTEGRATED even when WHMCS knows every product', () => {
    const decision = decideOrderability({
      map: mapFixture(),
      serviceKey: 'shared-hosting',
      catalogue: catalogue(),
      cart: CART,
    });
    expect(decision.state).toBe('not-integrated');
    expect(decision.reasonCode).toBe('NOT_INTEGRATED');
    expect(decision.orderable).toBe(false);
    expect(decision.cycles).toEqual([]);
    expect(decision.productId).toBeNull();
    // The operator's internal note is not echoed to a browser.
    expect(decision.reason).not.toContain('no WHMCS product selected');
  });

  it('reports an unknown key as not integrated rather than guessing', () => {
    const decision = decideOrderability({
      map: mapFixture(),
      serviceKey: 'totally-unknown',
      catalogue: catalogue(),
      cart: CART,
    });
    expect(decision.reasonCode).toBe('NOT_INTEGRATED');
  });

  it('stops being orderable when the bound product disappears from WHMCS (deleted or hidden)', () => {
    const decision = decideOrderability({
      map: mapFixture(),
      serviceKey: 'business-hosting',
      catalogue: catalogue({ products: [] }),
      cart: CART,
    });
    expect(decision.state).toBe('unavailable');
    expect(decision.reasonCode).toBe('PRODUCT_NOT_IN_CATALOGUE');
    expect(decision.orderable).toBe(false);
    expect(decision.cycles).toEqual([]);
  });

  it('offers only the intersection of bound cycles and live cycles', () => {
    const live = catalogue();
    // WHMCS no longer sells the annual cycle for this product.
    live.products[0]!.currencies.USD!.cycles = { monthly: { price: '12.50', setupFee: '0.00' } };

    const decision = decideOrderability({
      map: mapFixture(),
      serviceKey: 'business-hosting',
      catalogue: live,
      cart: CART,
    });
    expect(decision.state).toBe('orderable');
    expect(decision.cycles.map((c) => c.cycle)).toEqual(['monthly']);
  });

  it('is unavailable when the product has no price for the binding cycles at all', () => {
    const live = catalogue();
    live.products[0]!.currencies.USD!.cycles = {};

    const decision = decideOrderability({
      map: mapFixture(),
      serviceKey: 'business-hosting',
      catalogue: live,
      cart: CART,
    });
    expect(decision.reasonCode).toBe('NO_CYCLES_OFFERED');
    expect(decision.orderable).toBe(false);
  });

  it('never becomes orderable because of a caller-supplied hint', () => {
    // Nothing in the input type accepts a pid, a price or a verdict; this asserts the shape callers
    // actually use — extra properties are simply not read.
    const decision = decideOrderability({
      map: mapFixture(),
      serviceKey: 'shared-hosting',
      catalogue: catalogue(),
      cart: CART,
      // @ts-expect-error — deliberately passing what an attacker would try to inject.
      orderable: true,
      pid: 101,
      price: '0.01',
      force: true,
    } as never);
    expect(decision.orderable).toBe(false);
  });

  it('reports a disabled or unreachable deployment honestly', () => {
    for (const [code, label] of [
      ['WHMCS_DISABLED', 'WHMCS_DISABLED'],
      ['UPSTREAM_UNAVAILABLE', 'UPSTREAM_UNAVAILABLE'],
      ['CURRENCY_UNAVAILABLE', 'CURRENCY_UNAVAILABLE'],
    ] as const) {
      const decision = decideOrderability({
        map: mapFixture(),
        serviceKey: 'business-hosting',
        catalogue: null,
        unavailable: { code },
        cart: CART,
      });
      expect(decision.state).toBe('unavailable');
      expect(decision.reasonCode).toBe(label);
      expect(decision.cycles).toEqual([]);
    }
  });

  it('describes a list of services in a stable, de-duplicated order', () => {
    const decisions = decideMany({
      map: mapFixture(),
      catalogue: catalogue(),
      serviceKeys: ['shared-hosting', 'business-hosting', 'shared-hosting'],
      cart: CART,
    });
    expect(decisions.map((d) => d.serviceKey)).toEqual(['shared-hosting', 'business-hosting']);
  });
});

describe('catalogueFailure', () => {
  it('maps every failure onto a state a page can render', () => {
    expect(catalogueFailure(new WhmcsCurrencyUnavailableError('EUR', ['USD']))).toEqual({
      code: 'CURRENCY_UNAVAILABLE',
    });
    expect(catalogueFailure(new WhmcsMapChecksumError('a', 'b'))).toEqual({ code: 'MAP_INVALID' });
    expect(catalogueFailure(new WhmcsTimeoutError('GetProducts', 10_000))).toEqual({ code: 'UPSTREAM_UNAVAILABLE' });
    expect(catalogueFailure(new Error('boom'))).toEqual({ code: 'UPSTREAM_UNAVAILABLE' });
  });
});

describe('createCatalogueLoader', () => {
  const ENV = {
    WHMCS_BASE_URL: BASE_URL,
    WHMCS_API_IDENTIFIER: 'cloudhost247-site',
    WHMCS_API_SECRET: 'super-secret-value-that-must-not-leak',
  } as NodeJS.ProcessEnv;

  function config(): WhmcsConfig {
    const loaded = loadWhmcsConfig(ENV);
    if (!loaded.enabled) throw new Error('test env invalid');
    return loaded.config;
  }

  function transport(payload: Record<string, unknown>, options: { fail?: boolean } = {}) {
    const requests: TransportRequest[] = [];
    const t: Transport = {
      async send(request) {
        requests.push(request);
        if (options.fail) {
          const error = new Error('timed out');
          error.name = 'TimeoutError';
          throw error;
        }
        return { status: 200, body: JSON.stringify(payload) };
      },
    };
    return { requests, transport: t };
  }

  const PAYLOAD = {
    groups: { productgroups: [{ id: 3, name: 'Hosting' }] },
    products: {
      products: [
        {
          pid: 101,
          gid: 3,
          name: 'Business Hosting',
          module: 'cpanel',
          paytype: 'recurring',
          pricing: { USD: { monthly: '12.50', annually: '120.00' } },
        },
      ],
    },
    currencies: { currencies: [{ id: 1, code: 'USD', default: '1' }] },
  };

  function handlerFor({ groups, products, currencies }: typeof PAYLOAD) {
    return (request: TransportRequest) => {
      const action = new URLSearchParams(request.body).get('action');
      if (action === 'GetProductGroups') return { status: 200, body: JSON.stringify({ result: 'success', ...groups }) };
      if (action === 'GetProducts') return { status: 200, body: JSON.stringify({ result: 'success', ...products }) };
      if (action === 'GetCurrencies') return { status: 200, body: JSON.stringify({ result: 'success', ...currencies }) };
      return { status: 200, body: JSON.stringify({ result: 'error', message: 'unexpected' }) };
    };
  }

  it('reads three times on the first view, then serves from the cache inside the window', async () => {
    let clock = 1_000;
    const requests: TransportRequest[] = [];
    const client = new WhmcsClient({
      config: config(),
      transport: {
        async send(request) {
          requests.push(request);
          return handlerFor(PAYLOAD)(request);
        },
      },
    });
    const loader = createCatalogueLoader(client, { ttlMs: 60_000, now: () => clock });

    const first = await loader.load();
    expect(first.currency).toBe('USD');
    expect(requests).toHaveLength(3);

    await loader.load();
    expect(requests).toHaveLength(3);

    clock += 61_000;
    await loader.load();
    expect(requests).toHaveLength(6);
  });

  it('shares one refresh between simultaneous callers', async () => {
    const requests: TransportRequest[] = [];
    const client = new WhmcsClient({
      config: config(),
      transport: {
        async send(request) {
          requests.push(request);
          return handlerFor(PAYLOAD)(request);
        },
      },
    });
    const loader = createCatalogueLoader(client, { ttlMs: 60_000 });

    await Promise.all([loader.load(), loader.load(), loader.load()]);
    expect(requests).toHaveLength(3);
  });

  it('never caches a failure', async () => {
    let fail = true;
    const requests: TransportRequest[] = [];
    const client = new WhmcsClient({
      config: config(),
      transport: {
        async send(request) {
          requests.push(request);
          if (fail) {
            const error = new Error('timed out');
            error.name = 'TimeoutError';
            throw error;
          }
          return handlerFor(PAYLOAD)(request);
        },
      },
      sleep: async () => undefined,
    });
    const loader = createCatalogueLoader(client, { ttlMs: 60_000, now: () => 0 });

    await expect(loader.load()).rejects.toBeTruthy();
    fail = false;
    const recovered = await loader.load();
    expect(recovered.products).toHaveLength(1);
  });

  it('refuses a currency the install does not sell instead of falling back', async () => {
    const requests: TransportRequest[] = [];
    const client = new WhmcsClient({
      config: config(),
      transport: {
        async send(request) {
          requests.push(request);
          return handlerFor(PAYLOAD)(request);
        },
      },
    });
    const loader = createCatalogueLoader(client, { ttlMs: 60_000 });
    await expect(loader.load('EUR')).rejects.toBeInstanceOf(WhmcsCurrencyUnavailableError);
  });
});
