import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_ACTIONS,
  collectDiscovery,
  renderDiscoveryReport,
  type DiscoveryArtifact,
} from '../../src/whmcs/discovery';
import { WhmcsClient } from '../../src/whmcs/client';
import { loadWhmcsConfig, type WhmcsConfig } from '../../src/whmcs/config';
import { WhmcsMalformedResponseError } from '../../src/whmcs/errors';
import type { Transport, TransportRequest } from '../../src/whmcs/transport';

/**
 * C1 discovery, exercised against a scripted installation.
 *
 * The point of these tests is that the C1 run *cannot* flatter the installation: hidden products stay
 * reported, unconfigured pricing stays absent, products with no provisioning module are called out,
 * and the run is provably read-only. When the operator points the same code at staging, the only
 * thing that changes is the transport.
 */

const ENV = {
  WHMCS_BASE_URL: 'https://billing.example.com',
  WHMCS_API_IDENTIFIER: 'cloudhost247-site',
  WHMCS_API_SECRET: 'super-secret-value-that-must-not-leak',
} as NodeJS.ProcessEnv;

function config(): WhmcsConfig {
  const loaded = loadWhmcsConfig(ENV);
  if (!loaded.enabled) throw new Error('test env invalid');
  return loaded.config;
}

const GROUPS = {
  productgroups: [
    { id: 1, name: 'Hosting', hidden: '0' },
    { id: 2, name: 'Retired', hidden: '1' },
    { id: 3, name: 'Empty', hidden: '0' },
  ],
};

const PRODUCTS = {
  products: [
    {
      pid: 11,
      gid: 1,
      name: 'Business Hosting',
      description: 'NVMe hosting with cPanel',
      module: 'cpanel',
      paytype: 'recurring',
      hidden: '0',
      pricing: { USD: { monthly: '12.50', quarterly: '-1', annually: '120.00', asetupfee: '5.00' } },
    },
    {
      pid: 12,
      gid: 1,
      name: 'Unpriced Draft',
      description: 'Not priced yet',
      module: 'cpanel',
      paytype: 'recurring',
      hidden: '0',
      pricing: { USD: { monthly: '-1' } },
    },
    {
      pid: 13,
      gid: 1,
      name: 'Bare Product',
      description: 'No module, no price',
      module: '',
      paytype: 'recurring',
      hidden: '0',
      pricing: { USD: { monthly: '-1' } },
    },
    {
      pid: 14,
      gid: 3,
      name: 'Hidden Plan',
      description: 'Hidden but real',
      module: 'cpanel',
      paytype: 'recurring',
      hidden: '1',
      pricing: { USD: { monthly: '7.00' } },
    },
  ],
};

const CURRENCIES = {
  currencies: [
    { id: 1, code: 'USD', prefix: '$', suffix: ' USD', default: '1' },
    { id: 2, code: 'GBP', prefix: '£', suffix: '', default: '0' },
  ],
};

function scripted(options: { version?: string; currencies?: unknown; products?: unknown } = {}) {
  const requests: TransportRequest[] = [];
  const transport: Transport = {
    async send(request) {
      requests.push(request);
      const action = new URLSearchParams(request.body).get('action');
      switch (action) {
        case 'GetProductGroups':
          return { status: 200, body: JSON.stringify({ result: 'success', ...GROUPS }) };
        case 'GetProducts':
          return { status: 200, body: JSON.stringify({ result: 'success', ...(options.products ?? PRODUCTS) }) };
        case 'GetCurrencies':
          return {
            status: 200,
            body: JSON.stringify({ result: 'success', ...(options.currencies ?? CURRENCIES) }),
          };
        case 'WhmcsDetails':
          return { status: 200, body: JSON.stringify({ result: 'success', version: options.version ?? '8.11.2' }) };
        default:
          return { status: 200, body: JSON.stringify({ result: 'error', message: `unexpected action ${action}` }) };
      }
    },
  };
  return { requests, client: new WhmcsClient({ config: config(), transport }) };
}

describe('collectDiscovery', () => {
  it('reports groups, products, ids, prices and cycles without inventing any of them', async () => {
    const { client } = scripted();
    const artifact = await collectDiscovery(client, { baseUrl: 'https://billing.example.com', now: () => Date.parse('2026-11-08T09:00:00Z') });

    expect(artifact.schema).toBe('cloudhost247/whmcs-discovery@1');
    expect(artifact.retrievedAt).toBe('2026-11-08T09:00:00.000Z');
    expect(artifact.defaultCurrency).toBe('USD');
    expect(artifact.currencies.map((currency) => currency.code)).toEqual(['USD', 'GBP']);
    expect(artifact.groups).toEqual([
      { id: 1, name: 'Hosting', hidden: false, productCount: 3 },
      { id: 2, name: 'Retired', hidden: true, productCount: 0 },
      { id: 3, name: 'Empty', hidden: false, productCount: 1 },
    ]);

    const business = artifact.products.find((product) => product.pid === 11)!;
    expect(business).toMatchObject({
      gid: 1,
      name: 'Business Hosting',
      module: 'cpanel',
      payType: 'recurring',
      hidden: false,
      available: true,
    });
    // `-1` quarterly means "not offered" and must be absent, not zero.
    expect(business.pricing.USD).toEqual([
      { cycle: 'monthly', price: '12.50', setupFee: '0.00' },
      { cycle: 'annually', price: '120.00', setupFee: '5.00' },
    ]);
    // GBP has no pricing for this product: no entry, no fallback from USD.
    expect(business.pricing.GBP).toBeUndefined();
  });

  it('keeps hidden products visible to the reviewer, flagged', async () => {
    const { client } = scripted();
    const artifact = await collectDiscovery(client, { baseUrl: 'https://billing.example.com' });
    const hidden = artifact.products.find((product) => product.pid === 14);
    expect(hidden).toMatchObject({ name: 'Hidden Plan', hidden: true, available: true });
    expect(artifact.warnings.join(' ')).toContain('hidden in WHMCS');
  });

  it('flags products that cannot be sold yet instead of quietly dropping them', async () => {
    const { client } = scripted();
    const artifact = await collectDiscovery(client, { baseUrl: 'https://billing.example.com' });

    expect(artifact.products.find((product) => product.pid === 12)).toMatchObject({
      available: false,
      pricing: {},
    });
    const warnings = artifact.warnings.join('\n');
    expect(warnings).toContain('no priced billing cycle');
    expect(warnings).toContain('12 Unpriced Draft');
    // ... and the one with no provisioning module at all, which would invoice for nothing.
    expect(warnings).toContain('no provisioning module');
    expect(warnings).toContain('13 Bare Product');
    // ... and the genuinely empty group (group 2 holds no products at all; group 3 holds one, hidden).
    expect(warnings).toContain('Empty product group(s): 2 Retired');
    expect(warnings).not.toContain('3 Empty');
    expect(warnings).toContain('Currency GBP exists but no product is priced in it');
  });

  it('is read-only: the only actions issued are catalogue reads', async () => {
    const { client, requests } = scripted();
    await collectDiscovery(client, { baseUrl: 'https://billing.example.com' });

    const actions = requests.map((request) => new URLSearchParams(request.body).get('action'));
    expect(actions.sort()).toEqual(['GetCurrencies', 'GetProductGroups', 'GetProducts']);
    for (const action of actions) {
      expect(DISCOVERY_ACTIONS as readonly string[]).toContain(action!);
    }
    // Nothing that could create, price, order or provision.
    expect(actions.some((action) => /^(Add|Update|Create|Delete|Module)/.test(action ?? ''))).toBe(false);
  });

  it('reads the version only when asked, and never fails the run for it', async () => {
    const without = await collectDiscovery(scripted().client, { baseUrl: 'https://billing.example.com' });
    expect(without.whmcsVersion).toBeNull();

    const withVersion = await collectDiscovery(scripted({ version: '8.11.2' }).client, {
      baseUrl: 'https://billing.example.com',
      includeVersion: true,
    });
    expect(withVersion.whmcsVersion).toBe('8.11.2');
  });

  it('refuses to produce an artifact from an installation that reports no catalogue', async () => {
    await expect(
      collectDiscovery(scripted({ products: { products: [] } }).client, {
        baseUrl: 'https://billing.example.com',
      }),
    ).resolves.toMatchObject({ products: [] });

    // No currencies at all is a broken installation, not an empty catalogue.
    await expect(
      collectDiscovery(scripted({ currencies: { currencies: [] } }).client, {
        baseUrl: 'https://billing.example.com',
      }),
    ).rejects.toBeInstanceOf(WhmcsMalformedResponseError);
  });

  it('never writes the installation URL into the artifact', async () => {
    const artifact = await collectDiscovery(scripted().client, { baseUrl: 'https://billing.example.com' });
    const serialised = JSON.stringify(artifact);
    expect(serialised).not.toContain('billing.example.com');
    expect(serialised).not.toContain('super-secret-value-that-must-not-leak');
    expect(artifact.baseUrlFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('renderDiscoveryReport', () => {
  let artifact: DiscoveryArtifact;

  async function load() {
    if (!artifact) {
      artifact = await collectDiscovery(scripted().client, { baseUrl: 'https://billing.example.com' });
    }
    return artifact;
  }

  it('lists every product with its pid, module and WHMCS price strings', async () => {
    const report = renderDiscoveryReport(await load());
    expect(report).toContain('# WHMCS discovery report (C1)');
    expect(report).toContain('| 11 | 1 | Business Hosting | cpanel |');
    expect(report).toContain('monthly 12.50');
    expect(report).toContain('annually 120.00');
    // The unpriced product shows an em dash, never a made-up zero.
    expect(report).toContain('| 12 | 1 | Unpriced Draft | cpanel |');
    expect(report).not.toContain('monthly 0.00');
  });

  it('surfaces the warnings above the tables, where a reviewer will read them', async () => {
    const report = renderDiscoveryReport(await load());
    const warningIndex = report.indexOf('## Warnings');
    const tableIndex = report.indexOf('## Products');
    expect(warningIndex).toBeGreaterThan(0);
    expect(warningIndex).toBeLessThan(tableIndex);
    expect(report).toContain('no provisioning module');
  });

  it('states that nothing was bound and how to bind, one reviewed command at a time', async () => {
    const report = renderDiscoveryReport(await load());
    expect(report).toContain('nothing in this report binds a website service to a product'.toLowerCase().replace('nothing', 'Nothing'));
    expect(report).toContain('npm run whmcs:map -- bind --service <service-key> --product <pid>');
    expect(report).toContain('npm run whmcs:map -- verify');
  });

  it('escapes pipes and newlines so the tables cannot be broken by product names', async () => {
    const nasty: DiscoveryArtifact = {
      ...(await load()),
      products: [
        {
          pid: 99,
          gid: 1,
          name: 'Plan | with\npipe',
          description: '',
          module: null,
          payType: null,
          hidden: false,
          available: false,
          pricing: {},
        },
      ],
      warnings: [],
    };
    const report = renderDiscoveryReport(nasty);
    expect(report).toContain('Plan \\| with pipe');
    expect(report.split('\n').some((line) => line.startsWith('| 99 |'))).toBe(true);
  });
});
