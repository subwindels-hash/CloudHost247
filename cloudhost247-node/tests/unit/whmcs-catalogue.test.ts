import { describe, expect, it } from 'vitest';
import { buildCatalogue, cyclesFor, normalizeGroups, normalizeProducts } from '../../src/whmcs/catalogue';
import { WhmcsCurrencyUnavailableError } from '../../src/whmcs/errors';

/**
 * The catalogue rules that stop the website from quoting a price WHMCS never published:
 * cycles only when configured, hidden rows removed, and a currency with no price is an error rather
 * than a fallback to another currency.
 */

const GROUPS = [
  { id: '1', name: 'Shared Hosting', hidden: '0' },
  { id: '2', name: 'Retired Products', hidden: '1' },
];

const PRODUCTS = [
  {
    pid: '10',
    gid: '1',
    name: 'Starter',
    description: 'A starter plan',
    module: 'cpanel',
    paytype: 'recurring',
    pricing: {
      USD: { prefix: '$', suffix: ' USD', monthly: '4.95', quarterly: '-1', annually: '49.50', msetupfee: '0.00', asetupfee: '5.00' },
      EUR: { prefix: '€', suffix: ' EUR', monthly: '4.50', annually: '-1' },
    },
  },
  {
    pid: '11',
    gid: '1',
    name: 'Business',
    description: '',
    module: 'cpanel',
    paytype: 'recurring',
    pricing: { USD: { monthly: '-1', annually: '-1' } },
  },
  { pid: '12', gid: '2', name: 'Legacy Plan', pricing: { USD: { monthly: '1.00' } }, hidden: '0' },
  { pid: '13', gid: '1', name: 'Hidden Plan', pricing: { USD: { monthly: '9.00' } }, hidden: '1' },
];

describe('WHMCS catalogue normalisation', () => {
  it('offers only the cycles WHMCS configured (-1 means not offered)', () => {
    const { products } = normalizeProducts(PRODUCTS, { currency: 'USD' });
    const starter = products.find((product) => product.id === 10);
    expect(starter).toBeDefined();
    expect(cyclesFor(starter!, 'USD')).toEqual(['monthly', 'annually']);
    expect(starter!.currencies.USD?.cycles.monthly).toEqual({ price: '4.95', setupFee: '0.00' });
    expect(starter!.currencies.USD?.cycles.annually).toEqual({ price: '49.50', setupFee: '5.00' });
  });

  it('keeps prices for the other currencies separate', () => {
    const { products } = normalizeProducts(PRODUCTS, { currency: 'USD' });
    const starter = products.find((product) => product.id === 10)!;
    expect(Object.keys(starter.currencies).sort()).toEqual(['EUR', 'USD']);
    expect(cyclesFor(starter, 'EUR')).toEqual(['monthly']);
    expect(starter.currencies.EUR?.prefix).toBe('€');
  });

  it('reports a product with no price at all instead of inventing one', () => {
    const { products, unpricedProductIds } = normalizeProducts(PRODUCTS, { currency: 'USD' });
    const business = products.find((product) => product.id === 11)!;
    expect(cyclesFor(business, 'USD')).toEqual([]);
    expect(unpricedProductIds).toContain(11);
  });

  it('drops hidden products and hidden groups from the public catalogue', () => {
    const catalogue = buildCatalogue(GROUPS, PRODUCTS, { currency: 'USD' });
    const ids = catalogue.products.map((product) => product.id).sort((a, b) => a - b);
    // 10 and 11 are in a visible group and not hidden; 12 sits in a hidden group; 13 is hidden.
    expect(ids).toEqual([10, 11]);
    expect(catalogue.groups.map((group) => group.id)).toEqual([1]);
  });

  it('carries the provisioning module through, because it is part of the product fact sheet', () => {
    const catalogue = buildCatalogue(GROUPS, PRODUCTS, { currency: 'USD' });
    expect(catalogue.products.find((product) => product.id === 10)?.module).toBe('cpanel');
    expect(catalogue.products.find((product) => product.id === 10)?.payType).toBe('recurring');
  });

  it('refuses to price a catalogue in a currency WHMCS never quoted', () => {
    expect(() => buildCatalogue(GROUPS, PRODUCTS, { currency: 'NGN' })).toThrow(WhmcsCurrencyUnavailableError);
  });

  it('accepts the legacy single-pricing shape as the requested currency', () => {
    const legacy = [{ pid: '20', gid: '1', name: 'Legacy', pricing: { monthly: '12.00', annually: '-1' } }];
    const { products } = normalizeProducts(legacy, { currency: 'GBP' });
    expect(cyclesFor(products[0]!, 'GBP')).toEqual(['monthly']);
  });

  it('tolerates collections returned as objects with string keys', () => {
    const asObject = { '0': { id: '5', name: 'Domains', hidden: '0' } };
    expect(normalizeGroups(asObject)).toEqual([{ id: 5, name: 'Domains', hidden: false }]);
  });

  it('extracts the currency WHMCS actually priced when none was requested', () => {
    const { currency, products } = normalizeProducts(PRODUCTS);
    expect(currency).toBe('USD');
    expect(products.length).toBeGreaterThan(0);
  });

  it('ignores a malformed row rather than blanking the catalogue', () => {
    const withJunk = [...PRODUCTS, { name: 'no pid' }, null, 42];
    const { products } = normalizeProducts(withJunk, { currency: 'USD' });
    expect(products.map((product) => product.id)).toEqual([10, 11, 12, 13]);
  });

  it('treats free (0.00) as a real price, not as missing', () => {
    const free = [{ pid: '30', gid: '1', name: 'Free', paytype: 'free', pricing: { USD: { monthly: '0.00' } } }];
    const { products, unpricedProductIds } = normalizeProducts(free, { currency: 'USD' });
    expect(cyclesFor(products[0]!, 'USD')).toEqual(['monthly']);
    expect(products[0]!.currencies.USD?.cycles.monthly?.price).toBe('0.00');
    expect(unpricedProductIds).toEqual([]);
  });
});
