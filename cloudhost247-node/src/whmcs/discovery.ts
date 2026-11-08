/**
 * C1 — read-only discovery of a real WHMCS installation.
 *
 * What this produces, and what it deliberately does not:
 *
 *   * it **reads** groups, products, product ids, descriptions, currencies, prices, billing cycles,
 *     visibility and availability, and writes two artifacts: a JSON snapshot and a human-readable
 *     report;
 *   * it **does not bind anything**. Binding a website service to a product id is a separate,
 *     reviewed step (`npm run whmcs:map -- bind …`), because a snapshot reviewer must be able to
 *     see the catalogue before anyone decides which page sells which product;
 *   * it **invents nothing**. A price that WHMCS did not return is absent, not zero; a cycle WHMCS
 *     marked `-1` is absent, not free; a product with no provisioning module is reported as such
 *     rather than assumed to work.
 *
 * The functions here are pure data transformations with an injected client, so the whole pipeline is
 * exercised in tests against a scripted installation (`tests/unit/whmcs-discovery.test.ts`) and can
 * be pointed at staging by the operator without a code change.
 *
 * Read-only by construction: the only actions it issues are `GetCurrencies`, `GetProductGroups`,
 * `GetProducts` and (optionally) `WhmcsDetails`. A test asserts that list.
 */

import type { WhmcsClient } from './client';
import { WhmcsMalformedResponseError, WhmcsSchemaError } from './errors';
import {
  CYCLE_SETUP_KEY,
  currencySchema,
  getCurrenciesSchema,
  getProductGroupsSchema,
  getProductsSchema,
  groupSchema,
  productSchema,
  toArray,
} from './schemas';
import { buildCatalogue } from './catalogue';
import { BILLING_CYCLES, type BillingCycle } from './types';
import { fingerprintBaseUrl } from './product-map';
import { z } from 'zod';

export const DISCOVERY_SCHEMA = 'cloudhost247/whmcs-discovery@1' as const;

/** The complete list of WHMCS actions discovery may issue. Asserted by test; never grows silently. */
export const DISCOVERY_ACTIONS = ['GetCurrencies', 'GetProductGroups', 'GetProducts', 'WhmcsDetails'] as const;

export interface DiscoveryCurrency {
  code: string;
  prefix: string;
  suffix: string;
  /** WHMCS marks exactly one currency as the install default; it is the one pages price in. */
  isDefault: boolean;
}

export interface DiscoveryCyclePrice {
  cycle: BillingCycle;
  /** Exactly the string WHMCS returned. Never parsed, rounded or reformatted. */
  price: string;
  setupFee: string;
}

export interface DiscoveryProduct {
  pid: number;
  gid: number;
  name: string;
  description: string;
  /** WHMCS server module (e.g. `cpanel`, `plesk`); null when the product provisions nothing. */
  module: string | null;
  payType: string | null;
  /** Hidden in WHMCS, so absent from its own storefront. Bindable, but warned about. */
  hidden: boolean;
  /** True only when at least one cycle carries a real price in at least one currency. */
  available: boolean;
  /** Per-currency cycles, each with WHMCS's own price string. Missing currency = not priced in it. */
  pricing: Record<string, DiscoveryCyclePrice[]>;
}

export interface DiscoveryGroup {
  id: number;
  name: string;
  hidden: boolean;
  productCount: number;
}

export interface DiscoveryArtifact {
  schema: typeof DISCOVERY_SCHEMA;
  retrievedAt: string;
  /** sha256 of the WHMCS base URL — the URL itself is not written into an artifact. */
  baseUrlFingerprint: string;
  whmcsVersion: string | null;
  currencies: DiscoveryCurrency[];
  defaultCurrency: string | null;
  groups: DiscoveryGroup[];
  products: DiscoveryProduct[];
  /** Everything a human reviewer must look at before any binding is approved. */
  warnings: string[];
}

const whmcsDetailsSchema = z.looseObject({
  result: z.literal('success'),
  version: z.union([z.string(), z.number()]).optional(),
});

export interface CollectOptions {
  baseUrl: string;
  now?: () => number;
  /** Read the install version through `WhmcsDetails`. Off by default: it needs a broader API role. */
  includeVersion?: boolean;
}

function parseOrThrow<T>(action: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new WhmcsSchemaError(
      action,
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/**
 * Reads the catalogue and returns the discovery artifact. Throws when the installation answers with
 * something unusable — a C1 run that cannot see the catalogue must not produce an artifact claiming
 * it did.
 */
export async function collectDiscovery(
  client: WhmcsClient,
  options: CollectOptions,
): Promise<DiscoveryArtifact> {
  const now = options.now ?? Date.now;

  const [groupsPayload, productsPayload, currenciesPayload] = await Promise.all([
    client.call('GetProductGroups', {}, getProductGroupsSchema),
    client.call('GetProducts', {}, getProductsSchema),
    client.call('GetCurrencies', {}, getCurrenciesSchema),
  ]);

  const rawCurrencies = toArray(currenciesPayload.currencies as unknown[] | Record<string, unknown> | undefined).map((row) =>
    parseOrThrow('GetCurrencies', currencySchema, row),
  );
  if (rawCurrencies.length === 0) {
    throw new WhmcsMalformedResponseError('GetCurrencies', 'the installation reported no currencies');
  }
  const currencies: DiscoveryCurrency[] = rawCurrencies.map((row) => ({
    code: row.code.toUpperCase(),
    prefix: row.prefix ?? '',
    suffix: row.suffix ?? '',
    isDefault: String(row.default ?? '') === '1' || row.default === true,
  }));
  const defaultCurrency =
    currencies.find((currency) => currency.isDefault)?.code ?? currencies[0]?.code ?? null;

  const rawGroups = toArray(groupsPayload.productgroups as unknown[] | Record<string, unknown> | undefined).map((row) =>
    parseOrThrow('GetProductGroups', groupSchema, row),
  );
  const rawProducts = toArray(productsPayload.products as unknown[] | Record<string, unknown> | undefined).map((row) =>
    parseOrThrow('GetProducts', productSchema, row),
  );

  // Normalise through the same code the storefront uses, so discovery cannot see a different
  // catalogue shape than the orderability endpoint will see later. `buildCatalogue` drops hidden
  // products, so the hidden set is reconstructed from the raw rows below.
  const catalogue = buildCatalogue(rawGroups, rawProducts, { currency: defaultCurrency ?? 'USD' });
  const hiddenById = new Map<number, boolean>();
  for (const row of rawProducts) {
    const id = Number(row.pid);
    const hiddenRaw = row.hidden;
    hiddenById.set(id, hiddenRaw === true || String(hiddenRaw ?? '').trim() === '1');
  }

  const products: DiscoveryProduct[] = catalogue.products.map((product) => {
    const pricing: Record<string, DiscoveryCyclePrice[]> = {};
    for (const [code, currencyPricing] of Object.entries(product.currencies)) {
      const cycles = BILLING_CYCLES.filter((cycle) => currencyPricing.cycles[cycle] !== undefined).map((cycle) => {
        const priced = currencyPricing.cycles[cycle]!;
        return { cycle, price: priced.price, setupFee: priced.setupFee };
      });
      if (cycles.length > 0) pricing[code.toUpperCase()] = cycles;
    }
    return {
      pid: product.id,
      gid: product.groupId,
      name: product.name,
      description: product.description.slice(0, 400),
      module: product.module && product.module !== '' ? product.module : null,
      payType: product.payType ?? null,
      hidden: hiddenById.get(product.id) ?? product.hidden,
      available: Object.values(pricing).some((cycles) => cycles.length > 0),
      pricing,
    };
  });

  // Hidden products are excluded by `buildCatalogue`; list them separately so a reviewer knows they
  // exist (they are bindable but invisible in cart.php) instead of silently missing them.
  const hiddenProducts: DiscoveryProduct[] = [];
  for (const row of rawProducts) {
    const id = Number(row.pid);
    if (products.some((product) => product.pid === id)) continue;
    if (hiddenById.get(id) !== true) continue;
    const pricing: Record<string, DiscoveryCyclePrice[]> = {};
    const pricingRaw = row.pricing as Record<string, Record<string, unknown>> | undefined;
    for (const [code, values] of Object.entries(pricingRaw ?? {})) {
      const cycles = BILLING_CYCLES.filter((cycle) => {
        const value = values?.[cycle];
        if (value === undefined || value === null) return false;
        const text = String(value).trim();
        return text !== '' && text !== '-1' && text !== '-1.00' && Number.isFinite(Number(text));
      }).map((cycle) => ({
        cycle,
        price: String(values[cycle]),
        setupFee: String(values[CYCLE_SETUP_KEY[cycle]] ?? '0.00'),
      }));
      if (cycles.length > 0) pricing[code.toUpperCase()] = cycles;
    }
    hiddenProducts.push({
      pid: id,
      gid: Number(row.gid),
      name: row.name,
      description: String(row.description ?? '').slice(0, 400),
      module: row.module && row.module !== '' ? row.module : null,
      payType: row.paytype ?? null,
      hidden: true,
      available: Object.values(pricing).some((cycles) => cycles.length > 0),
      pricing,
    });
  }

  let whmcsVersion: string | null = null;
  if (options.includeVersion) {
    // Optional: `WhmcsDetails` needs a broader API role than catalogue reads. A failure here is
    // reported as "unknown", never as a failed discovery.
    try {
      const details = await client.call('WhmcsDetails', {}, whmcsDetailsSchema);
      whmcsVersion = details.version === undefined ? null : String(details.version);
    } catch {
      whmcsVersion = null;
    }
  }

  const allProducts = [...products, ...hiddenProducts];
  const groups: DiscoveryGroup[] = rawGroups.map((group) => ({
    id: Number(group.id),
    name: group.name,
    hidden: String(group.hidden ?? '').trim() === '1',
    productCount: allProducts.filter((product) => product.gid === Number(group.id)).length,
  }));

  const warnings: string[] = [];
  if (hiddenProducts.length > 0) {
    warnings.push(
      `${hiddenProducts.length} product(s) are hidden in WHMCS and will not appear in cart.php: ` +
        hiddenProducts.map((product) => `${product.pid} ${product.name}`).join(', '),
    );
  }
  const unavailable = allProducts.filter((product) => !product.available);
  if (unavailable.length > 0) {
    warnings.push(
      `${unavailable.length} product(s) carry no priced billing cycle and cannot be sold until pricing is configured: ` +
        unavailable.map((product) => `${product.pid} ${product.name}`).join(', '),
    );
  }
  const moduleless = allProducts.filter((product) => product.module === null && product.payType !== 'free');
  if (moduleless.length > 0) {
    warnings.push(
      `${moduleless.length} product(s) have no provisioning module, so ordering one would create an invoice with ` +
        `nothing to provision: ${moduleless.map((product) => `${product.pid} ${product.name}`).join(', ')}`,
    );
  }
  for (const currency of currencies) {
    const priced = allProducts.filter((product) => (product.pricing[currency.code] ?? []).length > 0).length;
    if (priced === 0) warnings.push(`Currency ${currency.code} exists but no product is priced in it.`);
  }
  if (!currencies.some((currency) => currency.isDefault)) {
    warnings.push('No currency is marked as the install default; pages will price in the first currency returned.');
  }
  const emptyGroups = groups.filter((group) => group.productCount === 0);
  if (emptyGroups.length > 0) {
    warnings.push(
      `Empty product group(s): ${emptyGroups.map((group) => `${group.id} ${group.name}`).join(', ')}`,
    );
  }

  return {
    schema: DISCOVERY_SCHEMA,
    retrievedAt: new Date(now()).toISOString(),
    baseUrlFingerprint: fingerprintBaseUrl(options.baseUrl),
    whmcsVersion,
    currencies,
    defaultCurrency,
    groups,
    products: allProducts,
    warnings,
  };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function priceCell(product: DiscoveryProduct, currency: string): string {
  const cycles = product.pricing[currency] ?? [];
  if (cycles.length === 0) return '—';
  return cycles.map((cycle) => `${cycle.cycle} ${cycle.price}`).join('<br>');
}

/**
 * Human-readable report for review. Markdown tables only — no HTML, no absolute URLs, and no
 * credential or base URL, so the file can be attached to a change request.
 */
export function renderDiscoveryReport(artifact: DiscoveryArtifact): string {
  const lines: string[] = [];
  lines.push('# WHMCS discovery report (C1)');
  lines.push('');
  lines.push('> Generated by `npm run whmcs:discover` against a live installation. **Read-only.**');
  lines.push('> Nothing in this report binds a website service to a product; that is a separate, reviewed step.');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Discovered at | ${artifact.retrievedAt} |`);
  lines.push(`| WHMCS version | ${artifact.whmcsVersion ?? 'not read (needs a broader API role)'} |`);
  lines.push(`| Installation fingerprint | \`${artifact.baseUrlFingerprint}\` |`);
  lines.push(`| Default currency | ${artifact.defaultCurrency ?? 'none reported'} |`);
  lines.push(`| Product groups | ${artifact.groups.length} |`);
  lines.push(`| Products | ${artifact.products.length} |`);
  lines.push(
    `| Products with a priced cycle | ${artifact.products.filter((product) => product.available).length} |`,
  );
  lines.push('');

  if (artifact.warnings.length > 0) {
    lines.push('## Warnings — resolve before any binding is approved');
    lines.push('');
    for (const warning of artifact.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  lines.push('## Currencies');
  lines.push('');
  lines.push('| Code | Default | Prefix | Suffix |');
  lines.push('| --- | --- | --- | --- |');
  for (const currency of artifact.currencies) {
    lines.push(
      `| ${currency.code} | ${currency.isDefault ? 'yes' : 'no'} | ${escapeCell(currency.prefix)} | ${escapeCell(currency.suffix)} |`,
    );
  }
  lines.push('');

  lines.push('## Product groups');
  lines.push('');
  lines.push('| gid | Name | Hidden | Products |');
  lines.push('| --- | --- | --- | --- |');
  for (const group of artifact.groups) {
    lines.push(`| ${group.id} | ${escapeCell(group.name)} | ${group.hidden ? 'yes' : 'no'} | ${group.productCount} |`);
  }
  lines.push('');

  lines.push('## Products');
  lines.push('');
  const currencyCodes = artifact.currencies.map((currency) => currency.code);
  lines.push(`| pid | gid | Name | Module | Pay type | Hidden | ${currencyCodes.join(' | ')} |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | ${currencyCodes.map(() => '---').join(' | ')} |`);
  for (const product of artifact.products) {
    lines.push(
      `| ${product.pid} | ${product.gid} | ${escapeCell(product.name)} | ${product.module ?? '**none**'} | ` +
        `${product.payType ?? '—'} | ${product.hidden ? 'yes' : 'no'} | ` +
        `${currencyCodes.map((code) => escapeCell(priceCell(product, code))).join(' | ')} |`,
    );
  }
  lines.push('');
  lines.push('Prices are exactly the strings WHMCS returned. `—` means WHMCS configured no price for that');
  lines.push('product in that currency; it is never substituted from another currency.');
  lines.push('');

  lines.push('## Next steps');
  lines.push('');
  lines.push('1. Review this report and decide, service by service, which product sells which page.');
  lines.push('2. Run `npm run whmcs:map -- snapshot` to write the checksummed snapshot from the same installation.');
  lines.push('3. Bind approved mappings, one reviewed command each:');
  lines.push('   `npm run whmcs:map -- bind --service <service-key> --product <pid> --cycles monthly,annually`');
  lines.push('4. `npm run whmcs:map -- verify` — the orderability endpoint will not report a service as');
  lines.push('   orderable until its binding passes this check.');
  lines.push('');
  return lines.join('\n');
}
