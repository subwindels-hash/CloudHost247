/**
 * Validation of a *captured* discovery artifact — the gate between `whmcs:discover` and `whmcs:review`.
 *
 * `discovery.ts` controls what is written when a run succeeds. This module answers a different
 * question: given the file on disk, is it internally consistent enough to classify services against?
 * That distinction matters because the artifact is a committed file that a human can open, copy,
 * truncate or check in from an older run — and a review built on a broken artifact would be evidence
 * of nothing while looking exactly like evidence.
 *
 * Every check is expressed as data (`id`, `ok`, `critical`, `detail`) rather than a thrown error, so
 * the operator sees *all* problems in one run instead of fixing them one exit code at a time.
 *
 * The rules encoded here are the ones whose violation is not merely suspicious but structurally
 * impossible for a correct read of a WHMCS installation:
 *
 *   - the schema tag and base-URL fingerprint identify which run and which install this is;
 *   - every product belongs to a group that exists, and product ids are unique;
 *   - every priced cycle is a real WHMCS billing cycle with a non-negative price string;
 *   - every pricing currency is a currency the install reports, and the default currency is one of
 *     them — because a "price in a currency WHMCS does not have" is how a page ends up showing
 *     something the cart cannot charge.
 *
 * Market conditions (hidden products, unpriced drafts, products without a provisioning module) are
 * **warnings**, not failures: they are exactly the facts a reviewer needs to see, and refusing to
 * review an installation because it contains an unfinished product would hide them.
 */

import { BILLING_CYCLES, type BillingCycle } from './types';
import { DISCOVERY_SCHEMA, type DiscoveryArtifact } from './discovery';

export interface ValidationCheck {
  /** Stable identifier, so a runbook can point at one check. */
  id: string;
  ok: boolean;
  /** A failed critical check makes the artifact unusable; a failed warning check does not. */
  critical: boolean;
  detail: string;
}

export interface DiscoveryValidation {
  checks: ValidationCheck[];
  /** Reasons the artifact cannot be used at all. Empty means it can. */
  critical: string[];
  /** Facts a reviewer must read but that do not invalidate the artifact. */
  warnings: string[];
  /** True when no critical check failed. */
  usable: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/i;
const PRICE = /^\d+(\.\d{1,4})?$/;
const CYCLES = new Set<string>(BILLING_CYCLES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a parsed artifact (or anything at all — the input is `unknown` on purpose, because the
 * caller has just run `JSON.parse` over a file).
 */
export function validateDiscoveryArtifact(value: unknown): DiscoveryValidation {
  const checks: ValidationCheck[] = [];
  const add = (id: string, ok: boolean, critical: boolean, detail: string) => {
    checks.push({ id, ok, critical, detail });
    return ok;
  };

  const finish = (): DiscoveryValidation => ({
    checks,
    critical: checks.filter((check) => check.critical && !check.ok).map((check) => `${check.id}: ${check.detail}`),
    warnings: checks.filter((check) => !check.critical && !check.ok).map((check) => `${check.id}: ${check.detail}`),
    usable: checks.every((check) => !check.critical || check.ok),
  });

  if (!isRecord(value)) {
    add('artifact.is-object', false, true, 'the artifact is not a JSON object');
    return finish();
  }
  add('artifact.is-object', true, true, 'the artifact is a JSON object');

  const artifact = value as unknown as DiscoveryArtifact;

  if (!add('artifact.schema', artifact.schema === DISCOVERY_SCHEMA, true,
    artifact.schema === DISCOVERY_SCHEMA
      ? `schema ${DISCOVERY_SCHEMA}`
      : `expected schema ${DISCOVERY_SCHEMA}, found ${JSON.stringify(artifact.schema)}`)) {
    return finish();
  }

  add(
    'artifact.retrieved-at',
    typeof artifact.retrievedAt === 'string' && !Number.isNaN(Date.parse(artifact.retrievedAt)),
    true,
    typeof artifact.retrievedAt === 'string' && !Number.isNaN(Date.parse(artifact.retrievedAt))
      ? `captured ${artifact.retrievedAt}`
      : 'retrievedAt is missing or not an ISO timestamp — the run cannot be dated',
  );

  add(
    'artifact.fingerprint',
    typeof artifact.baseUrlFingerprint === 'string' && HEX64.test(artifact.baseUrlFingerprint),
    true,
    typeof artifact.baseUrlFingerprint === 'string' && HEX64.test(artifact.baseUrlFingerprint)
      ? 'base-URL fingerprint present (install identity recorded)'
      : 'baseUrlFingerprint is missing or not a sha256 — the artifact cannot be tied to one install',
  );

  // ---------------------------------------------------------------------------------------------
  // Currencies
  // ---------------------------------------------------------------------------------------------
  const currencies = Array.isArray(artifact.currencies) ? artifact.currencies : [];
  add('currencies.present', currencies.length > 0, true,
    currencies.length > 0 ? `${currencies.length} currency(ies) reported` : 'the install reported no currencies');

  const codes = currencies.map((currency) => String(currency?.code ?? '').trim()).filter((code) => code !== '');
  add('currencies.codes', codes.length === currencies.length, true,
    codes.length === currencies.length ? 'every currency has a code' : 'a currency is missing its code');
  add('currencies.unique', new Set(codes).size === codes.length, true,
    new Set(codes).size === codes.length ? 'currency codes are unique' : 'a currency code is repeated');

  const defaults = currencies.filter((currency) => currency?.isDefault === true);
  add('currencies.default', defaults.length === 1, true,
    defaults.length === 1
      ? `default currency is ${defaults[0]?.code}`
      : `${defaults.length} currencies are marked default; WHMCS marks exactly one`);

  add(
    'currencies.default-declared',
    typeof artifact.defaultCurrency === 'string' && codes.includes(artifact.defaultCurrency),
    true,
    typeof artifact.defaultCurrency === 'string' && codes.includes(artifact.defaultCurrency)
      ? `defaultCurrency ${artifact.defaultCurrency} is one of the reported currencies`
      : `defaultCurrency ${JSON.stringify(artifact.defaultCurrency)} is not among the reported currencies`,
  );

  // ---------------------------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------------------------
  const groups = Array.isArray(artifact.groups) ? artifact.groups : [];
  const groupIds = new Set<number>();
  let duplicateGroup = false;
  for (const group of groups) {
    if (groupIds.has(group.id)) duplicateGroup = true;
    groupIds.add(group.id);
  }
  add('groups.unique', !duplicateGroup, true,
    duplicateGroup ? 'a product-group id appears twice — the groups response was merged' : 'product-group ids are unique');

  // ---------------------------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------------------------
  const products = Array.isArray(artifact.products) ? artifact.products : [];
  add('products.present', products.length > 0, true,
    products.length > 0 ? `${products.length} product(s) reported` : 'the install reported no products; there is nothing to map');

  const pids = new Set<number>();
  const duplicatePids: number[] = [];
  const danglingGroups: string[] = [];
  const badCycles: string[] = [];
  const badPrices: string[] = [];
  const unknownCurrencies = new Set<string>();
  let hiddenCount = 0;
  let unpricedCount = 0;
  let modulelessCount = 0;

  for (const product of products) {
    if (pids.has(product.pid)) duplicatePids.push(product.pid);
    pids.add(product.pid);

    if (!groupIds.has(product.gid)) danglingGroups.push(`${product.pid} → group ${product.gid}`);
    if (product.hidden) hiddenCount += 1;
    if (!product.module) modulelessCount += 1;

    const pricing = isRecord(product.pricing) ? product.pricing : {};
    let priced = 0;
    for (const [currency, rows] of Object.entries(pricing)) {
      if (!codes.includes(currency)) unknownCurrencies.add(currency);
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!CYCLES.has(String(row?.cycle))) badCycles.push(`${product.pid}/${String(row?.cycle)}`);
        if (typeof row?.price === 'string' && PRICE.test(row.price)) {
          priced += 1;
        } else {
          badPrices.push(`${product.pid}/${String(row?.cycle)}=${JSON.stringify(row?.price)}`);
        }
      }
    }
    if (priced === 0) unpricedCount += 1;
  }

  add('products.unique', duplicatePids.length === 0, true,
    duplicatePids.length === 0 ? 'product ids are unique' : `duplicate product id(s): ${duplicatePids.slice(0, 5).join(', ')}`);
  add('products.groups', danglingGroups.length === 0, true,
    danglingGroups.length === 0
      ? 'every product belongs to a reported product group'
      : `product(s) referencing an absent group: ${danglingGroups.slice(0, 5).join(', ')}`);
  add('pricing.cycles', badCycles.length === 0, true,
    badCycles.length === 0
      ? 'every priced cycle is a real WHMCS billing cycle'
      : `unknown billing cycle(s): ${badCycles.slice(0, 5).join(', ')}`);
  add('pricing.prices', badPrices.length === 0, true,
    badPrices.length === 0
      ? 'every price is a non-negative numeric string'
      : `non-numeric price(s): ${badPrices.slice(0, 5).join(', ')}`);
  add('pricing.currencies', unknownCurrencies.size === 0, true,
    unknownCurrencies.size === 0
      ? 'every pricing currency is a currency the install reports'
      : `pricing in unreported currency(ies): ${[...unknownCurrencies].join(', ')}`);

  // ---------------------------------------------------------------------------------------------
  // Conditions that are facts for the reviewer, not failures of the artifact
  // ---------------------------------------------------------------------------------------------
  add('products.hidden', true, false,
    hiddenCount === 0 ? 'no hidden products' : `${hiddenCount} product(s) are hidden — they cannot be sold from cart.php`);
  add('products.module', true, false,
    modulelessCount === 0
      ? 'every product has a provisioning module'
      : `${modulelessCount} product(s) have no provisioning module — ordering one would invoice for nothing`);
  add('products.priced', true, false,
    unpricedCount === 0 ? 'every product has at least one priced cycle' : `${unpricedCount} product(s) have no priced cycle`);

  const artifactWarnings = Array.isArray(artifact.warnings) ? artifact.warnings : [];
  add('artifact.warnings', true, false,
    artifactWarnings.length === 0
      ? 'the discovery run recorded no warnings'
      : `${artifactWarnings.length} warning(s) recorded by the run: ${artifactWarnings.slice(0, 3).join('; ')}`);

  add('artifact.version', Boolean(artifact.whmcsVersion), false,
    artifact.whmcsVersion ? `WHMCS ${artifact.whmcsVersion}` : 'the WHMCS version was not read (WHMCS_DISCOVERY_VERSION=1)');

  return finish();
}

/**
 * The verdict a command should act on, as data.
 *
 * `validate` already exits non-zero for an unusable artifact, but `review` and `evidence` used to print a normal
 * success line and exit 0 while refusing to classify anything — the safest possible behaviour with the least
 * detectable signal. This is that decision, extracted so it is testable and so all three commands agree.
 */
export function validationVerdict(validation: DiscoveryValidation | null): {
  status: 'no-artifact' | 'usable' | 'unusable';
  exitCode: 0 | 1;
  message: string;
} {
  if (validation === null) {
    return {
      status: 'no-artifact',
      exitCode: 0,
      message: 'no discovery artifact — every advertised service is BLOCKED until one exists',
    };
  }
  if (validation.usable) {
    return {
      status: 'usable',
      exitCode: 0,
      message: `artifact usable — ${validation.warnings.length} warning(s) for the reviewer`,
    };
  }
  return {
    status: 'unusable',
    exitCode: 1,
    message:
      `artifact FAILED validation (${validation.critical.length} critical check(s)) — nothing may be reviewed, ` +
      'approved or bound from it; the report was still written so the failure can be investigated',
  };
}

/** The artifact's cycles as a plain string list — used by reports, never as a price source. */
export function pricedCycles(product: { pricing: Record<string, Array<{ cycle: string }>> }): BillingCycle[] {
  const seen = new Set<string>();
  for (const rows of Object.values(product.pricing)) {
    for (const row of rows) if (CYCLES.has(row.cycle)) seen.add(row.cycle);
  }
  return BILLING_CYCLES.filter((cycle) => seen.has(cycle));
}
