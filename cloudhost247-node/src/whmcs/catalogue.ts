/**
 * Turns WHMCS product/group/pricing payloads into the bounded shape a page is allowed to display.
 *
 * The rules encoded here are the ones the site's own catalogue-honesty tests already demand on the
 * PHP side (`tests/website/test_catalogue_honesty.py`), applied to the Node stack:
 *
 *   - a cycle appears **only** if WHMCS configured it for that product and currency (`-1` and an
 *     empty string both mean "not offered" — WHMCS's own convention);
 *   - a product with no price for the selected currency is not silently priced from another
 *     currency; it is reported in `unpricedProductIds` so the caller can say so;
 *   - hidden products and hidden groups are removed, matching WHMCS's own storefront behaviour;
 *   - prices stay strings. Parsing them into a number here would introduce rounding before anyone
 *     has decided how to format them.
 */

import type { WhmcsClient } from './client';
import {
  WhmcsCurrencyUnavailableError,
  WhmcsMalformedResponseError,
  WhmcsSchemaError,
} from './errors';
import {
  CYCLE_SETUP_KEY,
  currencySchema,
  getCurrenciesSchema,
  getProductGroupsSchema,
  getProductsSchema,
  groupSchema,
  pricingSchema,
  productSchema,
  toArray,
} from './schemas';
import { BILLING_CYCLES, type CurrencyPricing, type NormalizedCatalogue, type NormalizedGroup, type NormalizedProduct } from './types';

type RawPricing = Record<string, unknown>;

const CYCLE_KEYS = new Set<string>([...BILLING_CYCLES, ...Object.values(CYCLE_SETUP_KEY), 'prefix', 'suffix']);

function isHidden(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/** WHMCS says "-1" for a cycle it does not offer; "" and null appear on partially configured rows. */
function cyclePrice(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (text === '' || text === '-1' || text === '-1.00') return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return text;
}

function looksLikeSinglePricingObject(value: RawPricing): boolean {
  return Object.keys(value).some((key) => CYCLE_KEYS.has(key.toLowerCase()));
}

function normalizePricing(raw: RawPricing, defaultCurrency: string): Record<string, CurrencyPricing> {
  const parsed = pricingSchema.parse(raw);
  const out: Record<string, CurrencyPricing> = {};
  const cycles: CurrencyPricing['cycles'] = {};
  for (const cycle of BILLING_CYCLES) {
    const price = cyclePrice(parsed[cycle]);
    if (price === null) continue;
    const setupRaw = parsed[CYCLE_SETUP_KEY[cycle]];
    const setup = setupRaw === undefined || setupRaw === null ? '0.00' : String(setupRaw).trim();
    cycles[cycle] = { price, setupFee: setup === '' || Number(setup) < 0 ? '0.00' : setup };
  }
  out[defaultCurrency] = {
    code: defaultCurrency,
    prefix: parsed.prefix ?? '',
    suffix: parsed.suffix ?? '',
    cycles,
  };
  return out;
}

export interface NormalizeOptions {
  /**
   * The currency the caller intends to display. Prices for any other currency are dropped.
   * When omitted, the first currency WHMCS returns for a product is used.
   */
  currency?: string;
}

export function normalizeProducts(
  rawProducts: unknown,
  options: NormalizeOptions = {},
): { products: NormalizedProduct[]; unpricedProductIds: number[]; currency: string | null } {
  const rows = toArray(rawProducts as unknown[] | Record<string, unknown> | undefined);
  const products: NormalizedProduct[] = [];
  const unpriced: number[] = [];
  let discoveredCurrency: string | null = null;

  for (const row of rows) {
    const parsed = productSchema.safeParse(row);
    if (!parsed.success) {
      // One malformed row must not blank the whole catalogue, but it must not be guessed at either.
      continue;
    }
    const data = parsed.data;
    const id = Number(data.pid);
    const groupId = Number(data.gid);
    if (!Number.isInteger(id) || id <= 0) continue;

    const pricingRaw = data.pricing as unknown;
    let byCurrency: Record<string, CurrencyPricing>;
    if (pricingRaw && typeof pricingRaw === 'object' && !Array.isArray(pricingRaw) && looksLikeSinglePricingObject(pricingRaw as RawPricing)) {
      // Legacy single-currency shape: prices belong to the requested/default currency.
      byCurrency = normalizePricing(pricingRaw as RawPricing, options.currency ?? 'USD');
    } else if (pricingRaw && typeof pricingRaw === 'object') {
      const entries = Object.entries(pricingRaw as Record<string, unknown>).filter(
        ([, value]) => value && typeof value === 'object' && !Array.isArray(value),
      );
      byCurrency = {};
      for (const [code, value] of entries) {
        Object.assign(byCurrency, normalizePricing(value as RawPricing, code.toUpperCase()));
      }
    } else {
      byCurrency = {};
    }

    const availableCurrencies = Object.keys(byCurrency);
    if (discoveredCurrency === null && availableCurrencies.length > 0) {
      discoveredCurrency = availableCurrencies[0] ?? null;
    }

    const product: NormalizedProduct = {
      id,
      groupId: Number.isInteger(groupId) ? groupId : 0,
      name: data.name,
      description: data.description ?? '',
      module: (data.module ?? '').trim() === '' ? null : (data.module ?? '').trim(),
      payType: (data.paytype ?? '').trim() === '' ? null : (data.paytype ?? '').trim(),
      hidden: isHidden(data.hidden),
      currencies: byCurrency,
    };

    const wanted = options.currency?.toUpperCase();
    if (wanted) {
      const priced = product.currencies[wanted];
      if (!priced || Object.keys(priced.cycles).length === 0) unpriced.push(id);
    } else if (Object.keys(byCurrency).length === 0) {
      unpriced.push(id);
    }

    products.push(product);
  }

  return { products, unpricedProductIds: unpriced, currency: discoveredCurrency };
}

export function normalizeGroups(rawGroups: unknown): NormalizedGroup[] {
  return toArray(rawGroups as unknown[] | Record<string, unknown> | undefined)
    .map((row) => {
      const parsed = groupSchema.safeParse(row);
      if (!parsed.success) return null;
      const id = Number(parsed.data.id);
      if (!Number.isInteger(id) || id <= 0) return null;
      return { id, name: parsed.data.name, hidden: isHidden(parsed.data.hidden) };
    })
    .filter((group): group is NormalizedGroup => group !== null)
    .sort((a, b) => a.id - b.id);
}

/**
 * Builds the view model a service page may render.
 *
 * Throws `WhmcsCurrencyUnavailableError` when the requested currency has no price for any product —
 * the caller must then say "not priced in this currency" rather than fall back to another one.
 */
export function buildCatalogue(
  rawGroups: unknown,
  rawProducts: unknown,
  options: NormalizeOptions = {},
): NormalizedCatalogue {
  const groups = normalizeGroups(rawGroups);
  const hiddenGroupIds = new Set(groups.filter((g) => g.hidden).map((g) => g.id));
  const normalized = normalizeProducts(rawProducts, options);

  const currency = (options.currency ?? normalized.currency ?? '').toUpperCase();
  if (!currency) {
    throw new WhmcsMalformedResponseError('GetProducts', 'no currency could be determined for the catalogue');
  }

  const visibleGroups = groups.filter((g) => !g.hidden);
  const products = normalized.products.filter(
    (product) => !product.hidden && !hiddenGroupIds.has(product.groupId),
  );

  const pricedSomewhere = products.some((product) => product.currencies[currency]);
  if (!pricedSomewhere && products.length > 0) {
    throw new WhmcsCurrencyUnavailableError(
      currency,
      [...new Set(products.flatMap((product) => Object.keys(product.currencies)))],
    );
  }

  return {
    currency,
    groups: visibleGroups,
    products,
    unpricedProductIds: products
      .filter((product) => !product.currencies[currency] || Object.keys(product.currencies[currency]?.cycles ?? {}).length === 0)
      .map((product) => product.id),
  };
}

/** Cycles offered for one product in one currency, in WHMCS's canonical order. */
export function cyclesFor(
  product: NormalizedProduct,
  currency: string,
): Array<(typeof BILLING_CYCLES)[number]> {
  const pricing = product.currencies[currency.toUpperCase()];
  if (!pricing) return [];
  return BILLING_CYCLES.filter((cycle) => pricing.cycles[cycle] !== undefined);
}

/**
 * Reads a full catalogue from WHMCS: groups, products and the currency to price them in.
 *
 * The currency is resolved against `GetCurrencies` rather than assumed — a page that asked for `EUR`
 * on an install that only sells `USD` gets `WhmcsCurrencyUnavailableError`, not a dollar price with
 * a euro sign. When no currency is requested the install's own default is used.
 *
 * Two reads run in parallel; both are idempotent reads, so the client's retry policy applies.
 */
export async function fetchCatalogue(
  client: WhmcsClient,
  options: { currency?: string } = {},
): Promise<NormalizedCatalogue> {
  const [groupsPayload, productsPayload, currenciesPayload] = await Promise.all([
    client.call('GetProductGroups', {}, getProductGroupsSchema),
    client.call('GetProducts', {}, getProductsSchema),
    client.call('GetCurrencies', {}, getCurrenciesSchema),
  ]);

  const currencies = toArray(currenciesPayload.currencies).map((raw) => {
    const parsed = currencySchema.safeParse(raw);
    if (!parsed.success) {
      throw new WhmcsSchemaError(
        'GetCurrencies',
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      );
    }
    return parsed.data;
  });

  const requested = (options.currency ?? '').trim().toUpperCase();
  let currency = requested;
  if (!currency) {
    const preferred = currencies.find((c) => String(c.default ?? '') === '1' || c.default === true) ?? currencies[0];
    if (!preferred) {
      throw new WhmcsMalformedResponseError('GetCurrencies', 'WHMCS returned no currencies');
    }
    currency = preferred.code.toUpperCase();
  } else if (currencies.length > 0 && !currencies.some((c) => c.code.toUpperCase() === currency)) {
    // Never fall back to another currency: say which ones exist and let the caller decide.
    throw new WhmcsCurrencyUnavailableError(
      currency,
      currencies.map((c) => c.code.toUpperCase()),
    );
  }

  return buildCatalogue(groupsPayload.productgroups ?? [], productsPayload.products ?? [], { currency });
}
