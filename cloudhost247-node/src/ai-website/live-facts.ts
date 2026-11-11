import type { Queryable } from '../db/types';
import { getPublicProductBySlug, getPublicPlansForProduct } from '../services/catalog-service';
import { canonicalPath, foldText, type WebsiteSourceKind } from './types';
import type { RawDocument } from './website-discovery';

/**
 * Live facts.
 *
 * Prices, plans and availability change without a code deploy, so they are never answered from the
 * index. This module reads them from the same catalogue service the public product pages use
 * (`src/services/catalog-service.ts`), which already enforces "published pricing only" and
 * "public visibility only". Nothing here re-implements that rule; duplicating it would be the
 * classic way for an assistant to quote a price the shop will not honour.
 *
 * Two responsibilities:
 *
 *   1. `loadCatalogDocuments()` — turns each publicly listed product into a knowledge document so
 *      the assistant can *explain* an offering and link to it. The document deliberately contains
 *      no amounts: it points at the canonical plan page and says prices are read live.
 *   2. `resolveLiveFacts()` — answere-time read of the authoritative price/plan data.
 */

export interface LivePrice {
  productName: string;
  productSlug: string;
  planName: string;
  planSlug: string;
  amount: string;
  currency: string;
  billingPeriod: string;
  setupFee: string | null;
  url: string;
}

export interface LiveFacts {
  /** True when the catalogue was readable at all. False means "cannot verify", never "none". */
  available: boolean;
  products: Array<{ slug: string; name: string; type: string; url: string; description: string | null; available?: boolean }>;
  prices: LivePrice[];
  /** Products that exist publicly but are not yet purchasable (status = draft). */
  comingSoon: string[];
  /**
   * Domain registration/renewal/transfer prices, read from the same offering tables the domain
   * shop uses. Absent prices mean "cannot verify", never "free".
   */
  domainPrices?: {
    available: boolean;
    extensions: Array<{ extension: string; registration: string | null; renewal: string | null; transfer: string | null }>;
  };
  /** Human-readable reason the catalogue could not be read, for an honest answer. */
  unavailableReason: string | null;
}

const EMPTY_FACTS: LiveFacts = {
  available: false,
  products: [],
  prices: [],
  comingSoon: [],
  unavailableReason: null,
};

/** Canonical, verified plan page for a catalogue product. */
export function planPageUrl(slug: string): string {
  return canonicalPath(`/service-plans/catalog/${encodeURIComponent(slug)}`);
}

/** Normalises a billing period into words a customer would use. */
export function describeBillingPeriod(period: string): string {
  switch (period) {
    case 'one_time':
      return 'one time';
    case 'monthly':
      return 'per month';
    case 'quarterly':
      return 'per quarter';
    case 'semi_annually':
      return 'every six months';
    case 'annually':
      return 'per year';
    default:
      return period.replace(/_/g, ' ');
  }
}

export function formatPrice(price: Pick<LivePrice, 'amount' | 'currency' | 'billingPeriod' | 'setupFee'>): string {
  const amount = Number(price.amount);
  const formatted = Number.isFinite(amount)
    ? amount.toLocaleString('en-US', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })
    : price.amount;
  const setup = price.setupFee && Number(price.setupFee) > 0
    ? ` plus ${price.currency} ${Number(price.setupFee).toLocaleString('en-US')} setup`
    : '';
  return `${price.currency} ${formatted} ${describeBillingPeriod(price.billingPeriod)}${setup}`;
}

/**
 * Formats a bare amount from the domain offering tables, which store plain numeric strings with no
 * currency column of their own. A non-numeric value is passed through rather than shown as "NaN".
 */
export function formatMoney(amount: string, currency = 'USD'): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

/**
 * Reads the public catalogue. Any failure returns `available: false` and the caller must say it
 * cannot verify prices — it must never fall back to a remembered number.
 */
export async function resolveLiveFacts(
  db: Queryable,
  options: { productSlugs?: readonly string[]; planSlugs?: readonly string[] } = {}
): Promise<LiveFacts> {
  try {
    const { getPublicCatalog } = await import('../services/catalog-service');
    const catalog = await getPublicCatalog(db);
    const products = catalog.products.map((product) => ({
      slug: product.slug,
      name: product.name,
      type: product.productType,
      url: planPageUrl(product.slug),
      description: product.description ?? null,
      available: product.available,
    }));
    const wanted = options.productSlugs && options.productSlugs.length > 0
      ? products.filter((product) => options.productSlugs!.includes(product.slug))
      : products;

    const prices: LivePrice[] = [];
    const comingSoon: string[] = [];
    for (const product of wanted) {
      const detail = await getPublicPlansForProduct(db, product.slug).catch(() => null);
      if (!detail || !Array.isArray(detail.plans) || detail.plans.length === 0) {
        // Public but with no purchasable plans: this is the "coming soon" state the public product
        // page also shows. Recording it here is how the assistant knows not to offer it.
        const summary = await getPublicProductBySlug(db, product.slug).catch(() => null);
        if (summary) comingSoon.push(product.name);
        continue;
      }
      if ((product as { available?: boolean }).available === false) {
        comingSoon.push(product.name);
        continue;
      }
      for (const plan of detail.plans) {
        for (const entry of plan.pricing ?? []) {
          if (entry.amount === null || entry.amount === undefined) continue;
          prices.push({
            productName: product.name,
            productSlug: product.slug,
            planName: plan.name,
            planSlug: plan.slug,
            amount: String(entry.amount),
            currency: String(entry.currency ?? 'USD'),
            billingPeriod: String(entry.billingPeriod ?? 'monthly'),
            setupFee: entry.setupFee === null || entry.setupFee === undefined ? null : String(entry.setupFee),
            url: planPageUrl(product.slug),
          });
        }
      }
    }
    // Domain prices live in their own tables (the domain shop's, not the plan catalogue), so a
    // ".com price" question has nothing to quote without this. Failure here must not fail the whole
    // catalogue read: plans are still answerable, domains just become "cannot verify".
    const domainPrices = await resolveDomainPriceFacts(db).catch(() => ({ available: false, extensions: [] }));
    return { available: true, products, prices, comingSoon, domainPrices, unavailableReason: null };
  } catch (error) {
    return {
      ...EMPTY_FACTS,
      products: [],
      unavailableReason: error instanceof Error ? error.message : 'The catalogue could not be read',
    };
  }
}

/**
 * Catalogue documents for indexing: one per publicly listed product.
 *
 * The body is written to be *useful without being a price list*: what the product is, that the page
 * carries live plans, and where to look. Prices are intentionally absent — a chunk containing
 * "$4.99/month" would still say that a year after the price changed.
 */
export async function loadCatalogDocuments(db: Queryable): Promise<RawDocument[]> {
  let catalog: Awaited<ReturnType<typeof getPublicCatalogSafe>>;
  try {
    catalog = await getPublicCatalogSafe(db);
  } catch {
    return [];
  }
  if (!catalog) return [];

  const documents: RawDocument[] = [];
  for (const product of catalog.products) {
    const url = planPageUrl(product.slug);
    const plans = await getPublicPlansForProduct(db, product.slug).catch(() => null);
    const planNames = (plans?.plans ?? []).map((plan) => plan.name).filter(Boolean);
    const kind: WebsiteSourceKind = product.productType === 'service' ? 'service' : 'product';
    const lines = [
      product.name,
      product.description ?? '',
      `Product type: ${product.productType}`,
      planNames.length > 0 ? `Published plans: ${planNames.join(', ')}.` : '',
      `Current prices and plan resources are shown on the ${url} page and are always quoted from the live catalogue.`,
      'You can order it from the CloudHost247 cart as a signed-in or new customer.',
    ];
    documents.push({
      sourceKey: `catalog:product:${product.slug}`,
      url,
      aliases: ['/hosting', '/cart'],
      title: `${product.name} — plans and pricing`,
      description: `CloudHost247 ${product.name}: published plans, resources and current prices, read live from the catalogue.`,
      kind,
      surface: 'catalog',
      section: 'Products',
      category: product.productType === 'domain' ? 'Domains' : product.productType === 'service' ? 'Services' : 'Hosting',
      related: [{ label: 'Compare all products', url: '/hosting' }],
      faqs: [],
      body: lines.filter(Boolean).join('\n'),
      headings: [product.name, ...planNames.slice(0, 12)],
    });
  }
  return documents;
}

async function getPublicCatalogSafe(db: Queryable): Promise<Awaited<ReturnType<typeof getPublicCatalog>>> {
  const { getPublicCatalog } = await import('../services/catalog-service');
  return getPublicCatalog(db);
}

/**
 * Picks the products a question is about, using the entity resolution the retriever already did plus
 * a catalogue-name match. This is what makes "what is the cheapest hosting" read the actual hosting
 * products rather than every product in the catalogue.
 */
export function selectRelevantPrices(facts: LiveFacts, terms: readonly string[], limit = 12): LivePrice[] {
  if (facts.prices.length === 0) return [];
  const folded = terms.map((term) => foldText(term)).filter((term) => term.length >= 3);
  const scored = facts.prices.map((price) => {
    const haystack = foldText(`${price.productName} ${price.planName}`);
    let score = 0;
    for (const term of folded) if (haystack.includes(term)) score += 3;
    return { price, score };
  });
  const matched = scored.filter((entry) => entry.score > 0);
  /**
   * No product or plan name matched the question, so there is no price that answers it.
   *
   * This used to fall back to the whole catalogue, cheapest first. With a seeded catalogue,
   * "Do you offer a mobile phone plan?" — a product CloudHost247 does not sell — was answered with
   * a confident price list beginning "Email Hosting — Mail Basic: USD 4.50 per month". That is the
   * one failure the assistant must never have: quoting a real price for the wrong product. An empty
   * list makes the caller say it cannot quote a price instead, which is the honest answer.
   */
  if (matched.length === 0) return [];
  const pool = matched;
  return pool
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const amountA = Number(a.price.amount);
      const amountB = Number(b.price.amount);
      if (Number.isFinite(amountA) && Number.isFinite(amountB) && amountA !== amountB) {
        // Cheapest first: "what is the cheapest hosting" is one of the documented questions, and
        // ordering by price is the only honest way to answer it.
        return amountA - amountB;
      }
      return a.price.planName.localeCompare(b.price.planName);
    })
    .slice(0, limit)
    .map((entry) => entry.price);
}

/** The cheapest genuinely published price, or null when there is nothing to compare. */
export function cheapestPrice(prices: readonly LivePrice[]): LivePrice | null {
  const comparable = prices
    .filter((price) => price.billingPeriod === 'monthly' && Number.isFinite(Number(price.amount)))
    .sort((a, b) => Number(a.amount) - Number(b.amount));
  return comparable[0] ?? null;
}

/** Domain pricing is snapshotted from the connected registrar; it is never invented. */
export async function resolveDomainPriceFacts(db: Queryable): Promise<{
  available: boolean;
  extensions: Array<{ extension: string; registration: string | null; renewal: string | null; transfer: string | null }>;
}> {
  try {
    const { rows } = await db.query<{ extension: string; registration_price: string | null; renewal_price: string | null; transfer_price: string | null }>(
      `SELECT e.extension,
              min(o.registration_price)::text AS registration_price,
              min(o.renewal_price)::text AS renewal_price,
              min(o.transfer_price)::text AS transfer_price
         FROM domain_extensions e
         JOIN domain_provider_extension_offerings o ON o.extension_id = e.id
        WHERE e.status = 'active' AND o.status = 'enabled'
        GROUP BY e.extension
        ORDER BY e.extension ASC
        LIMIT 120`
    );
    return {
      available: rows.length > 0,
      extensions: rows.map((row) => ({
        extension: row.extension,
        registration: row.registration_price,
        renewal: row.renewal_price,
        transfer: row.transfer_price,
      })),
    };
  } catch {
    return { available: false, extensions: [] };
  }
}
