import { describe, expect, it } from 'vitest';
import { validateDiscoveryArtifact, validationVerdict } from '../../src/whmcs/discovery-validation';
import { DISCOVERY_SCHEMA, type DiscoveryArtifact } from '../../src/whmcs/discovery';

/**
 * The snapshot gate.
 *
 * `whmcs:discover` controls what is written when a run succeeds; this validates the *file on disk*,
 * which a human can copy, truncate, or check in from an older install. Every check below corresponds
 * to a way a review could be built on something that only looks like evidence.
 */

function artifact(overrides: Partial<DiscoveryArtifact> = {}): DiscoveryArtifact {
  return {
    schema: DISCOVERY_SCHEMA,
    retrievedAt: '2026-01-01T00:00:00.000Z',
    baseUrlFingerprint: 'b'.repeat(64),
    whmcsVersion: '8.13.1',
    currencies: [
      { code: 'USD', prefix: '$', suffix: ' USD', isDefault: true },
      { code: 'NGN', prefix: '₦', suffix: '', isDefault: false },
    ],
    defaultCurrency: 'USD',
    groups: [
      { id: 1, name: 'Hosting', hidden: false, productCount: 1 },
      { id: 2, name: 'Retired', hidden: true, productCount: 0 },
    ],
    products: [
      {
        pid: 11,
        gid: 1,
        name: 'Business Hosting',
        description: '',
        module: 'cpanel',
        payType: 'recurring',
        hidden: false,
        available: true,
        pricing: { USD: [{ cycle: 'monthly', price: '12.50', setupFee: '0.00' }] },
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function ids(result: ReturnType<typeof validateDiscoveryArtifact>): string[] {
  return result.checks.map((check) => check.id);
}

describe('validateDiscoveryArtifact', () => {
  it('passes a consistent artifact and reports the facts a reviewer needs', () => {
    const result = validateDiscoveryArtifact(artifact());
    expect(result.usable).toBe(true);
    expect(result.critical).toEqual([]);
    expect(ids(result)).toContain('currencies.default-declared');
    expect(result.checks.find((check) => check.id === 'currencies.default')?.detail).toContain('USD');
    expect(result.checks.find((check) => check.id === 'artifact.version')?.detail).toContain('8.13.1');
  });

  it('rejects anything that is not a JSON object', () => {
    for (const value of [null, 42, 'artifact', []]) {
      const result = validateDiscoveryArtifact(value);
      expect(result.usable).toBe(false);
      expect(result.critical[0]).toContain('artifact.is-object');
    }
  });

  it('refuses a foreign schema and stops early instead of guessing at the shape', () => {
    const result = validateDiscoveryArtifact({ schema: 'someone/else@1' });
    expect(result.usable).toBe(false);
    expect(result.critical.join(' ')).toContain('expected schema');
    expect(ids(result)).toEqual(['artifact.is-object', 'artifact.schema']);
  });

  it('requires provenance: a datable run and a fingerprint that ties it to one install', () => {
    const noDate = validateDiscoveryArtifact(artifact({ retrievedAt: 'not-a-date' }));
    expect(noDate.usable).toBe(false);
    expect(noDate.critical.join(' ')).toContain('artifact.retrieved-at');

    const noFingerprint = validateDiscoveryArtifact(artifact({ baseUrlFingerprint: 'abc' }));
    expect(noFingerprint.usable).toBe(false);
    expect(noFingerprint.critical.join(' ')).toContain('artifact.fingerprint');
  });

  it('requires currencies, exactly one default, and a default that exists', () => {
    const none = validateDiscoveryArtifact(artifact({ currencies: [], defaultCurrency: null }));
    expect(none.usable).toBe(false);
    expect(none.critical.join(' ')).toContain('currencies.present');
    expect(none.critical.join(' ')).toContain('currencies.default');

    const two = validateDiscoveryArtifact(
      artifact({
        currencies: [
          { code: 'USD', prefix: '$', suffix: '', isDefault: true },
          { code: 'NGN', prefix: '₦', suffix: '', isDefault: true },
        ],
      }),
    );
    expect(two.usable).toBe(false);
    expect(two.critical.join(' ')).toContain('WHMCS marks exactly one');

    const declared = validateDiscoveryArtifact(artifact({ defaultCurrency: 'EUR' }));
    expect(declared.usable).toBe(false);
    expect(declared.critical.join(' ')).toContain('currencies.default-declared');
  });

  it('rejects duplicate product ids, because the review would silently pick one', () => {
    const result = validateDiscoveryArtifact(
      artifact({ products: [artifact().products[0], { ...artifact().products[0], name: 'Duplicate' }] }),
    );
    expect(result.usable).toBe(false);
    expect(result.critical.join(' ')).toContain('duplicate product id(s): 11');
  });

  it('rejects a product whose group is not in the response', () => {
    const result = validateDiscoveryArtifact(
      artifact({ products: [{ ...artifact().products[0], gid: 99 }] }),
    );
    expect(result.usable).toBe(false);
    expect(result.critical.join(' ')).toContain('products.groups');
    expect(result.critical.join(' ')).toContain('99');
  });

  it('rejects an unknown billing cycle rather than treating it as a price', () => {
    const result = validateDiscoveryArtifact(
      artifact({
        products: [
          {
            ...artifact().products[0],
            pricing: { USD: [{ cycle: 'weekly', price: '1.00', setupFee: '0.00' } as never] },
          },
        ],
      }),
    );
    expect(result.usable).toBe(false);
    expect(result.critical.join(' ')).toContain('pricing.cycles');
  });

  it('rejects a price that is not a non-negative numeric string', () => {
    for (const price of ['', '-1', 'free', '12,50']) {
      const result = validateDiscoveryArtifact(
        artifact({
          products: [
            { ...artifact().products[0], pricing: { USD: [{ cycle: 'monthly', price, setupFee: '0.00' }] } },
          ],
        }),
      );
      expect(result.usable).toBe(false);
      expect(result.critical.join(' ')).toContain('pricing.prices');
    }
    // Zero is a real price and must survive.
    const free = validateDiscoveryArtifact(
      artifact({
        products: [
          { ...artifact().products[0], pricing: { USD: [{ cycle: 'monthly', price: '0.00', setupFee: '0.00' }] } },
        ],
      }),
    );
    expect(free.usable).toBe(true);
  });

  it('rejects pricing in a currency the install does not report', () => {
    const result = validateDiscoveryArtifact(
      artifact({
        products: [
          { ...artifact().products[0], pricing: { EUR: [{ cycle: 'monthly', price: '9.00', setupFee: '0.00' }] } },
        ],
      }),
    );
    expect(result.usable).toBe(false);
    expect(result.critical.join(' ')).toContain('pricing.currencies');
    expect(result.critical.join(' ')).toContain('EUR');
  });

  it('reports hidden, unpriced and module-less products as reviewer facts, not failures', () => {
    const result = validateDiscoveryArtifact(
      artifact({
        products: [
          { ...artifact().products[0], hidden: true },
          { ...artifact().products[0], pid: 12, pricing: {} },
          { ...artifact().products[0], pid: 13, module: null },
        ],
      }),
    );
    expect(result.usable).toBe(true);
    expect(result.critical).toEqual([]);
    expect(result.checks.find((check) => check.id === 'products.hidden')?.detail).toContain('1 product(s) are hidden');
    expect(result.checks.find((check) => check.id === 'products.priced')?.detail).toContain('1 product(s) have no priced cycle');
    expect(result.checks.find((check) => check.id === 'products.module')?.detail).toContain('no provisioning module');
  });

  it('reports every critical problem in one run instead of one exit code at a time', () => {
    const result = validateDiscoveryArtifact(
      artifact({
        products: [
          { ...artifact().products[0], gid: 42, pricing: { EUR: [{ cycle: 'monthly', price: 'x', setupFee: '0' }] } },
          { ...artifact().products[0] },
        ],
      }),
    );
    expect(result.usable).toBe(false);
    expect(result.critical.length).toBeGreaterThanOrEqual(4);
    expect(result.critical.join(' ')).toContain('products.unique');
    expect(result.critical.join(' ')).toContain('products.groups');
    expect(result.critical.join(' ')).toContain('pricing.currencies');
    expect(result.critical.join(' ')).toContain('pricing.prices');
  });

  it('flags a missing WHMCS version and an empty product list', () => {
    const noVersion = validateDiscoveryArtifact(artifact({ whmcsVersion: null }));
    expect(noVersion.usable).toBe(true);
    expect(noVersion.checks.find((check) => check.id === 'artifact.version')?.detail).toContain('was not read');

    const noProducts = validateDiscoveryArtifact(artifact({ products: [] }));
    expect(noProducts.usable).toBe(false);
    expect(noProducts.critical.join(' ')).toContain('products.present');
  });

  it('gives review and evidence a non-zero verdict for an unusable artifact (C1.10 defect)', () => {
    // These commands used to print a normal success line and exit 0 while refusing to classify anything: the safest
    // behaviour with the least detectable signal. A pipeline or operator could not tell a rejection from a pass.
    expect(validationVerdict(null)).toMatchObject({ status: 'no-artifact', exitCode: 0 });

    const usable = validateDiscoveryArtifact(artifact());
    expect(validationVerdict(usable)).toMatchObject({ status: 'usable', exitCode: 0 });

    const unusable = validateDiscoveryArtifact(artifact({ currencies: [], defaultCurrency: null }));
    const verdict = validationVerdict(unusable);
    expect(verdict.status).toBe('unusable');
    expect(verdict.exitCode).toBe(1);
    expect(verdict.message).toContain('nothing may be reviewed');
    expect(verdict.message).toContain('still written');
  });

  it('carries the run\'s own warnings forward for the reviewer', () => {
    const result = validateDiscoveryArtifact(
      artifact({ warnings: ['product group 2 is hidden', 'currency NGN has no priced products'] }),
    );
    expect(result.checks.find((check) => check.id === 'artifact.warnings')?.detail).toContain('2 warning(s)');
  });
});
