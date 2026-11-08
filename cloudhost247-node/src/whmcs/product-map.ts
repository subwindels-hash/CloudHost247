/**
 * The verified service → WHMCS product map.
 *
 * This module exists because of one rule in the brief: *do not invent WHMCS product IDs.* A wrong
 * `pid` is not a cosmetic bug — `cart.php?a=add&pid=7` will happily sell the customer product 7,
 * whatever the page said it was. So the site never carries a product id in a page, a template or a
 * TypeScript constant. It carries a **service key** ("hosting-vps"), and that key only becomes
 * orderable when a generated, checksummed map binds it to a product that discovery actually read
 * out of WHMCS.
 *
 * Properties that make the map trustworthy:
 *
 *  - it is produced by `scripts/whmcs/catalogue-map.ts snapshot` from `GetProducts`, never typed;
 *  - it records what the installation looked like when it was taken (`retrievedAt`, product
 *    snapshot, `baseUrlFingerprint`), so a map from staging cannot be silently used in production;
 *  - every binding is checked against the snapshot on load: the product must exist, the group must
 *    match, and every billing cycle offered for sale must be a cycle the product actually has;
 *  - the whole document is checksummed after generation, and a hand edit fails closed instead of
 *    shipping.
 *
 * `services` may be empty. `unmapped` must then explain, per service key, why it is not orderable —
 * which is what makes "no price, no buy button" a deliberate state rather than an oversight.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { WhmcsMapChecksumError, WhmcsMapInvalidError } from './errors';
import { BILLING_CYCLES, type BillingCycle } from './types';

export const PRODUCT_MAP_VERSION = 1 as const;

const cycleSchema = z.enum(BILLING_CYCLES);

const bindingSchema = z.object({
  productId: z.number().int().positive(),
  productGroupId: z.number().int().nonnegative(),
  billingCycles: z.array(cycleSchema).min(1),
  provisioningModule: z.string().nullable(),
  boundAt: z.string().min(10),
  /** Checksum of the snapshot this binding was made against. */
  boundFrom: z.string().length(64),
});

const snapshotProductSchema = z.object({
  id: z.number().int().positive(),
  groupId: z.number().int().nonnegative(),
  name: z.string().min(1),
  module: z.string().nullable(),
  payType: z.string().nullable(),
  hidden: z.boolean(),
  currencies: z.array(z.string().min(1)),
  cycles: z.record(z.string(), z.array(cycleSchema)),
});

const unmappedSchema = z.object({
  reason: z.string().min(1),
  since: z.string().min(10),
});

const documentSchema = z.object({
  version: z.literal(PRODUCT_MAP_VERSION),
  source: z.literal('whmcs-getproducts'),
  /** sha256 of the WHMCS base URL (the URL is not a secret; the fingerprint still prevents drift). */
  baseUrlFingerprint: z.string().length(64),
  whmcsVersion: z.string().nullable(),
  retrievedAt: z.string().min(10),
  /**
   * Integrity of the *snapshot* alone (products + provenance). Bindings are stamped with this value,
   * so adding a binding changes the document checksum but never invalidates the other bindings.
   */
  snapshotChecksum: z.string().length(64),
  services: z.record(z.string(), bindingSchema),
  unmapped: z.record(z.string(), unmappedSchema),
  products: z.array(snapshotProductSchema),
  checksum: z.string().length(64),
});

export type ProductBinding = z.infer<typeof bindingSchema>;
export type SnapshotBody = Pick<
  ProductMapDocument,
  'version' | 'source' | 'baseUrlFingerprint' | 'whmcsVersion' | 'retrievedAt' | 'products'
>;
export type SnapshotProduct = z.infer<typeof snapshotProductSchema>;
export type ProductMapDocument = z.infer<typeof documentSchema>;
export type UnmappedReason = z.infer<typeof unmappedSchema>;

export type MapWithChecksum = Omit<ProductMapDocument, 'checksum'>;

/**
 * Deterministic JSON: object keys sorted at every level.
 *
 * `JSON.stringify` preserves insertion order, so a map regenerated from identical data could produce
 * a different checksum after a refactor of the writer. Sorting removes that class of false alarm.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function computeChecksum(document: MapWithChecksum): string {
  return createHash('sha256').update(canonicalJson(document)).digest('hex');
}

export function fingerprintBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().toLowerCase().replace(/\/+$/, '');
  return createHash('sha256').update(normalized).digest('hex');
}

/** Checksum of the product snapshot and its provenance — the identity bindings are stamped with. */
export function computeSnapshotChecksum(snapshot: SnapshotBody): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        version: snapshot.version,
        source: snapshot.source,
        baseUrlFingerprint: snapshot.baseUrlFingerprint,
        whmcsVersion: snapshot.whmcsVersion,
        retrievedAt: snapshot.retrievedAt,
        products: snapshot.products,
      }),
    )
    .digest('hex');
}

/**
 * Builds the persisted document (with both checksums) from its body.
 *
 * The snapshot checksum is computed over an explicit field list, not over `body` — a TypeScript
 * `Pick` is erased at runtime, and passing the whole document would make the "snapshot" checksum
 * change whenever a binding changed, which is exactly what it must not do.
 */
export function sealProductMap(body: Omit<MapWithChecksum, 'snapshotChecksum'>): ProductMapDocument {
  const snapshotChecksum = computeSnapshotChecksum({
    version: body.version,
    source: body.source,
    baseUrlFingerprint: body.baseUrlFingerprint,
    whmcsVersion: body.whmcsVersion,
    retrievedAt: body.retrievedAt,
    products: body.products,
  });
  const withSnapshot = { ...body, snapshotChecksum };
  return { ...withSnapshot, checksum: computeChecksum(withSnapshot) };
}

/**
 * Validates a parsed map: schema, checksum, and the referential integrity of every binding against
 * the snapshot it claims to have been made from.
 */
export function openProductMap(raw: unknown): ProductMapDocument {
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WhmcsMapInvalidError(
      'the document does not match the product-map schema',
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const document = parsed.data;
  const { checksum, ...body } = document;
  const expected = computeChecksum(body);
  if (expected !== checksum) {
    throw new WhmcsMapChecksumError(expected, checksum);
  }
  const snapshotExpected = computeSnapshotChecksum(body);
  if (snapshotExpected !== document.snapshotChecksum) {
    throw new WhmcsMapInvalidError('the product snapshot was modified after it was generated', [
      `snapshotChecksum ${document.snapshotChecksum} != ${snapshotExpected}`,
    ]);
  }

  const byId = new Map(document.products.map((product) => [product.id, product]));
  const problems: string[] = [];
  for (const [serviceKey, binding] of Object.entries(document.services)) {
    const product = byId.get(binding.productId);
    if (!product) {
      problems.push(`${serviceKey}: product ${binding.productId} is not in the snapshot`);
      continue;
    }
    if (product.groupId !== binding.productGroupId) {
      problems.push(`${serviceKey}: product ${binding.productId} belongs to group ${product.groupId}, not ${binding.productGroupId}`);
    }
    const offered = new Set(product.cycles[product.currencies[0] ?? ''] ?? []);
    for (const cycle of binding.billingCycles) {
      if (offered.size > 0 && !offered.has(cycle)) {
        problems.push(`${serviceKey}: cycle ${cycle} is not offered by product ${binding.productId}`);
      }
    }
    if (binding.boundFrom !== document.snapshotChecksum) {
      // Bindings are stamped with the snapshot integrity value they were made against. Anything else
      // means the binding was written by hand or the snapshot was replaced underneath it.
      problems.push(`${serviceKey}: binding provenance does not match the snapshot`);
    }
  }
  if (problems.length > 0) {
    throw new WhmcsMapInvalidError('bindings do not agree with the snapshot', problems.slice(0, 20));
  }
  return document;
}

export function readProductMapFile(path: string): ProductMapDocument {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new WhmcsMapInvalidError(`no product map at ${path}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new WhmcsMapInvalidError(`${path} is not valid JSON`);
  }
  return openProductMap(json);
}

export interface ServiceOffer {
  serviceKey: string;
  productId: number;
  productGroupId: number;
  billingCycles: BillingCycle[];
  provisioningModule: string | null;
}

/** The binding for a service, or `null` when the service is not orderable. Never a guess. */
export function resolveBinding(map: ProductMapDocument, serviceKey: string): ServiceOffer | null {
  const binding = map.services[serviceKey];
  if (!binding) return null;
  return {
    serviceKey,
    productId: binding.productId,
    productGroupId: binding.productGroupId,
    billingCycles: binding.billingCycles,
    provisioningModule: binding.provisioningModule,
  };
}

/** Every service key the map has a disposition for — orderable or explicitly not orderable. */
export function knownServiceKeys(map: ProductMapDocument): string[] {
  return [...Object.keys(map.services), ...Object.keys(map.unmapped)].sort();
}

export function unmappedReason(map: ProductMapDocument, serviceKey: string): string | null {
  return map.unmapped[serviceKey]?.reason ?? null;
}
