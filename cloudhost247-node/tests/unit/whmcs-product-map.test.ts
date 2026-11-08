import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  fingerprintBaseUrl,
  openProductMap,
  resolveBinding,
  sealProductMap,
  type ProductMapDocument,
  type SnapshotProduct,
} from '../../src/whmcs/product-map';
import { WhmcsMapChecksumError, WhmcsMapInvalidError } from '../../src/whmcs/errors';

/**
 * The product map is the only source of WHMCS product ids, so its integrity is a security property,
 * not a convenience: a hand-edited id must fail closed rather than route a customer to product 7.
 */

const PRODUCTS: SnapshotProduct[] = [
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
];

function build(overrides: Partial<Omit<ProductMapDocument, 'checksum'>> = {}): ProductMapDocument {
  return sealProductMap({
    version: 1,
    source: 'whmcs-getproducts',
    baseUrlFingerprint: fingerprintBaseUrl('https://billing.example.com'),
    whmcsVersion: '8.13.1',
    retrievedAt: '2026-11-08T10:00:00.000Z',
    products: PRODUCTS,
    services: {
      'hosting-vps': {
        productId: 12,
        productGroupId: 3,
        billingCycles: ['monthly', 'annually'],
        provisioningModule: 'cloudhost247_ovh',
        boundAt: '2026-11-08T10:05:00.000Z',
        boundFrom: 'placeholder',
      },
    },
    unmapped: { 'hosting-plesk': { reason: 'no Plesk product in WHMCS', since: '2026-11-08T10:05:00.000Z' } },
    ...overrides,
  });
}

/** `sealProductMap` stamps `boundFrom` from the snapshot checksum; rebuild after the first seal. */
function sealed(): ProductMapDocument {
  const draft = build();
  const services = Object.fromEntries(
    Object.entries(draft.services).map(([key, binding]) => [key, { ...binding, boundFrom: draft.snapshotChecksum }]),
  );
  return sealProductMap({
    version: draft.version,
    source: draft.source,
    baseUrlFingerprint: draft.baseUrlFingerprint,
    whmcsVersion: draft.whmcsVersion,
    retrievedAt: draft.retrievedAt,
    products: draft.products,
    services,
    unmapped: draft.unmapped,
  });
}

describe('WHMCS product map', () => {
  it('seals and reopens a valid document', () => {
    const document = sealed();
    const reopened = openProductMap(JSON.parse(JSON.stringify(document)));
    expect(reopened.services['hosting-vps']?.productId).toBe(12);
    expect(reopened.snapshotChecksum).toBe(document.snapshotChecksum);
  });

  it('refuses a document whose checksum does not match its contents', () => {
    const document = sealed();
    const tampered = { ...document, services: { ...document.services, 'hosting-vps': { ...document.services['hosting-vps']!, productId: 7 } } };
    expect(() => openProductMap(tampered)).toThrow(WhmcsMapChecksumError);
  });

  it('refuses a re-sealed document whose snapshot was swapped underneath the bindings', () => {
    const document = sealed();
    const swapped = sealProductMap({
      version: document.version,
      source: document.source,
      baseUrlFingerprint: document.baseUrlFingerprint,
      whmcsVersion: document.whmcsVersion,
      retrievedAt: document.retrievedAt,
      products: [{ ...PRODUCTS[0]!, name: 'Different product' }],
      services: document.services,
      unmapped: document.unmapped,
    });
    // The snapshot checksum moved, so the binding's provenance no longer matches → rejected.
    expect(() => openProductMap(swapped)).toThrow(WhmcsMapInvalidError);
    expect(swapped.snapshotChecksum).not.toBe(document.snapshotChecksum);
  });

  it('rejects a binding to a product that is not in the snapshot', () => {
    const document = sealed();
    const draft = sealProductMap({
      version: document.version,
      source: document.source,
      baseUrlFingerprint: document.baseUrlFingerprint,
      whmcsVersion: document.whmcsVersion,
      retrievedAt: document.retrievedAt,
      products: document.products,
      services: {
        'hosting-vps': {
          productId: 999,
          productGroupId: 3,
          billingCycles: ['monthly'],
          provisioningModule: null,
          boundAt: '2026-11-08T10:06:00.000Z',
          boundFrom: document.snapshotChecksum,
        },
      },
      unmapped: {},
    });
    expect(() => openProductMap(draft)).toThrow(WhmcsMapInvalidError);
  });

  it('rejects a binding that sells a cycle the product does not have', () => {
    const document = sealed();
    const draft = sealProductMap({
      version: document.version,
      source: document.source,
      baseUrlFingerprint: document.baseUrlFingerprint,
      whmcsVersion: document.whmcsVersion,
      retrievedAt: document.retrievedAt,
      products: document.products,
      services: {
        'hosting-vps': {
          productId: 12,
          productGroupId: 3,
          billingCycles: ['triennially'],
          provisioningModule: 'cloudhost247_ovh',
          boundAt: '2026-11-08T10:06:00.000Z',
          boundFrom: document.snapshotChecksum,
        },
      },
      unmapped: {},
    });
    expect(() => openProductMap(draft)).toThrow(WhmcsMapInvalidError);
  });

  it('rejects a binding whose group disagrees with the snapshot', () => {
    const document = sealed();
    const draft = sealProductMap({
      version: document.version,
      source: document.source,
      baseUrlFingerprint: document.baseUrlFingerprint,
      whmcsVersion: document.whmcsVersion,
      retrievedAt: document.retrievedAt,
      products: document.products,
      services: {
        'hosting-vps': {
          productId: 12,
          productGroupId: 99,
          billingCycles: ['monthly'],
          provisioningModule: 'cloudhost247_ovh',
          boundAt: '2026-11-08T10:06:00.000Z',
          boundFrom: document.snapshotChecksum,
        },
      },
      unmapped: {},
    });
    expect(() => openProductMap(draft)).toThrow(WhmcsMapInvalidError);
  });

  it('returns null for a service it has no binding for — never a guess', () => {
    const document = sealed();
    expect(resolveBinding(document, 'hosting-wordpress')).toBeNull();
    expect(resolveBinding(document, 'hosting-vps')?.productId).toBe(12);
  });

  it('produces a stable checksum regardless of key insertion order', () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it('fingerprints the installation without storing the URL', () => {
    const fingerprint = fingerprintBaseUrl('https://billing.example.com');
    expect(fingerprint).toHaveLength(64);
    expect(fingerprint).not.toContain('billing');
    expect(fingerprintBaseUrl('https://billing.example.com/')).toBe(fingerprint);
  });
});
