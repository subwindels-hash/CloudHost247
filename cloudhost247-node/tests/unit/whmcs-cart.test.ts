import { describe, expect, it } from 'vitest';
import { buildCartUrl, clientAreaUrl, offeredCycles } from '../../src/whmcs/cart';
import { fingerprintBaseUrl, sealProductMap, type ProductMapDocument } from '../../src/whmcs/product-map';
import { WhmcsCycleNotOfferedError, WhmcsProductNotMappedError } from '../../src/whmcs/errors';

/**
 * The hand-off is the whole commerce contract between the website and WHMCS: right product, right
 * cycle, no price, no credential. Anything unmapped must produce no URL at all.
 */

const BASE = 'https://billing.example.com';

function mapWith(cycles: Array<'monthly' | 'annually'> = ['monthly', 'annually']): ProductMapDocument {
  const draft = sealProductMap({
    version: 1,
    source: 'whmcs-getproducts',
    baseUrlFingerprint: fingerprintBaseUrl(BASE),
    whmcsVersion: '8.13.1',
    retrievedAt: '2026-11-08T10:00:00.000Z',
    products: [
      {
        id: 12,
        groupId: 3,
        name: 'VPS 4GB',
        module: 'cloudhost247_ovh',
        payType: 'recurring',
        hidden: false,
        currencies: ['USD'],
        cycles: { USD: ['monthly', 'annually'] },
      },
    ],
    services: {
      'hosting-vps': {
        productId: 12,
        productGroupId: 3,
        billingCycles: cycles,
        provisioningModule: 'cloudhost247_ovh',
        boundAt: '2026-11-08T10:05:00.000Z',
        boundFrom: 'pending',
      },
    },
    unmapped: { 'hosting-plesk': { reason: 'no Plesk product', since: '2026-11-08T10:05:00.000Z' } },
  });
  return sealProductMap({
    version: draft.version,
    source: draft.source,
    baseUrlFingerprint: draft.baseUrlFingerprint,
    whmcsVersion: draft.whmcsVersion,
    retrievedAt: draft.retrievedAt,
    products: draft.products,
    services: Object.fromEntries(
      Object.entries(draft.services).map(([key, binding]) => [key, { ...binding, boundFrom: draft.snapshotChecksum }]),
    ),
    unmapped: draft.unmapped,
  });
}

describe('WHMCS cart hand-off', () => {
  it('builds the cart URL from the verified binding', () => {
    const url = buildCartUrl(mapWith(), { baseUrl: BASE }, { serviceKey: 'hosting-vps', billingCycle: 'annually' });
    expect(url).toBe('https://billing.example.com/cart.php?a=add&pid=12&billingcycle=annually');
  });

  it('normalises a trailing slash on the install root', () => {
    const url = buildCartUrl(mapWith(), { baseUrl: `${BASE}/` }, { serviceKey: 'hosting-vps', billingCycle: 'monthly' });
    expect(url).toBe('https://billing.example.com/cart.php?a=add&pid=12&billingcycle=monthly');
  });

  it('produces no URL for an unmapped service', () => {
    expect(() => buildCartUrl(mapWith(), { baseUrl: BASE }, { serviceKey: 'hosting-wordpress', billingCycle: 'monthly' })).toThrow(
      WhmcsProductNotMappedError,
    );
  });

  it('produces no URL for a cycle WHMCS does not sell on that product', () => {
    expect(() => buildCartUrl(mapWith(['monthly']), { baseUrl: BASE }, { serviceKey: 'hosting-vps', billingCycle: 'annually' })).toThrow(
      WhmcsCycleNotOfferedError,
    );
  });

  it('carries no price and no credential', () => {
    const url = buildCartUrl(mapWith(), { baseUrl: BASE }, { serviceKey: 'hosting-vps', billingCycle: 'monthly' });
    expect(url).not.toMatch(/secret|identifier|price|amount|total/i);
    expect(new URL(url).searchParams.has('secret')).toBe(false);
  });

  it('reports an empty cycle list for a service it cannot sell', () => {
    expect(offeredCycles(mapWith(), 'hosting-plesk')).toEqual([]);
    expect(offeredCycles(mapWith(), 'hosting-vps')).toEqual(['monthly', 'annually']);
  });

  it('builds a client-area link for account actions', () => {
    expect(clientAreaUrl({ baseUrl: BASE }, 'services')).toBe('https://billing.example.com/clientarea.php?action=services');
    expect(clientAreaUrl({ baseUrl: BASE })).toBe('https://billing.example.com/clientarea.php');
  });
});
