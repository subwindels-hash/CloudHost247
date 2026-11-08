/**
 * B2.4 — the public answer to "can this service be bought online, right now, and at what price?".
 *
 * This is the *only* place a page is allowed to learn that. It is deliberately a decision function
 * rather than a lookup: a service is orderable only when all four of the following hold, and each one
 * is checked against live WHMCS data rather than remembered from a build:
 *
 *   1. the service has a **binding** in the checksummed product map (no pid is ever invented);
 *   2. the bound product still exists in `GetProducts` and is not hidden (WHMCS, not the website,
 *      decides what is on sale);
 *   3. WHMCS reports a price for at least one of the binding's cycles **in the requested currency**
 *      (no cross-currency fallback, no computed or defaulted price);
 *   4. a cart URL can be built for that exact cycle from the same binding (`cart.ts`).
 *
 * Everything else is a named non-orderable state with a stable code, so the UI can render an honest
 * "not available online yet" instead of a disabled button with no explanation:
 *
 *   NOT_INTEGRATED          the service is advertised but has no WHMCS product behind it (59 today)
 *   WHMCS_DISABLED          this deployment has no WHMCS credentials
 *   MAP_INVALID             the product map is missing/edited/broken — fail closed
 *   PRODUCT_NOT_IN_CATALOGUE  the bound pid is gone or hidden in WHMCS
 *   NO_CYCLES_OFFERED       the product exists but sells none of the bound cycles in this currency
 *   CURRENCY_UNAVAILABLE    the requested currency is not configured on the install
 *   UPSTREAM_UNAVAILABLE    WHMCS timed out / circuit open — retryable, says so
 *
 * The request can select a currency and which service keys to describe. It cannot select a pid, a
 * price, a cycle list or the verdict: those are computed here and nowhere else.
 */

import { WhmcsError } from './errors';
import { cyclesFor, fetchCatalogue } from './catalogue';
import { buildCartUrl } from './cart';
import { resolveBinding, type ProductMapDocument } from './product-map';
import type { WhmcsClient } from './client';
import type { NormalizedCatalogue } from './types';
import type { BillingCycle } from './types';

export type OrderabilityState = 'orderable' | 'not-integrated' | 'unavailable';

export type OrderabilityReasonCode =
  | 'ORDERABLE'
  | 'NOT_INTEGRATED'
  | 'WHMCS_DISABLED'
  | 'MAP_INVALID'
  | 'PRODUCT_NOT_IN_CATALOGUE'
  | 'NO_CYCLES_OFFERED'
  | 'CURRENCY_UNAVAILABLE'
  | 'UPSTREAM_UNAVAILABLE';

/** Customer-facing wording per state. Written once, so no route invents its own. */
export const ORDERABILITY_MESSAGES: Record<OrderabilityReasonCode, string> = {
  ORDERABLE: 'Available to order online.',
  NOT_INTEGRATED: 'This service is not available to order online yet.',
  WHMCS_DISABLED: 'Online ordering is not connected on this deployment yet.',
  MAP_INVALID: 'Online ordering is temporarily unavailable.',
  PRODUCT_NOT_IN_CATALOGUE: 'This service is not available to order online right now.',
  NO_CYCLES_OFFERED: 'This service has no purchasable billing cycle right now.',
  CURRENCY_UNAVAILABLE: 'This service is not priced in the selected currency.',
  UPSTREAM_UNAVAILABLE: 'Our billing system is temporarily unreachable. Please try again shortly.',
};

export interface OrderabilityCycle {
  cycle: BillingCycle;
  /** Exactly as WHMCS reported it. Never parsed, rounded or reformatted. */
  price: string;
  setupFee: string;
  currency: string;
  cartUrl: string;
}

export interface ServiceOrderability {
  serviceKey: string;
  state: OrderabilityState;
  /** Redundant with `state === 'orderable'` on purpose: a caller that only reads a boolean still
   * cannot be tricked by a missing enum value. */
  orderable: boolean;
  reasonCode: OrderabilityReasonCode;
  reason: string;
  currency: string | null;
  /** The WHMCS product id, or null. It is public anyway — the cart URL the customer clicks
   * contains it — and it is the value support needs to reproduce a report. */
  productId: string | null;
  productName: string | null;
  cycles: OrderabilityCycle[];
}

export interface DecideInput {
  map: ProductMapDocument;
  serviceKey: string;
  /** Live catalogue, or null when it could not be loaded (disabled install / upstream failure). */
  catalogue: NormalizedCatalogue | null;
  /** Why the catalogue is null, when it is. */
  unavailable?: { code: OrderabilityReasonCode; reason?: string } | null;
  cart: { baseUrl: string; cartPath?: string };
}

function notOrderable(
  serviceKey: string,
  reasonCode: Exclude<OrderabilityReasonCode, 'ORDERABLE'>,
  extra: { currency?: string | null; reason?: string } = {},
): ServiceOrderability {
  return {
    serviceKey,
    state: reasonCode === 'NOT_INTEGRATED' ? 'not-integrated' : 'unavailable',
    orderable: false,
    reasonCode,
    reason: extra.reason ?? ORDERABILITY_MESSAGES[reasonCode],
    currency: extra.currency ?? null,
    productId: null,
    productName: null,
    cycles: [],
  };
}

/**
 * The decision, for one service. Pure: no network, no clock, no database. Every input that decides
 * the answer is an argument, which is what makes it testable and what stops a route from quietly
 * adding a "just this once" exception.
 */
export function decideOrderability(input: DecideInput): ServiceOrderability {
  const { map, serviceKey, catalogue, cart } = input;

  const binding = resolveBinding(map, serviceKey);
  if (!binding) {
    // No verified mapping → never orderable. The operator's note in `map.unmapped` is internal
    // wording and is not echoed to a browser.
    //
    // Precedence note: this is answered *before* the catalogue state, on purpose. "Not integrated"
    // is the permanent, credential-independent truth about an unbound service — it stays the same
    // whether WHMCS is configured, down, or unreachable, and it is the fact a product manager needs
    // to see. Environment failures are reported for the services that *would* be orderable, where
    // they actually change the answer.
    return notOrderable(serviceKey, 'NOT_INTEGRATED');
  }

  if (!catalogue) {
    const code = input.unavailable?.code ?? 'UPSTREAM_UNAVAILABLE';
    return notOrderable(serviceKey, code === 'ORDERABLE' ? 'UPSTREAM_UNAVAILABLE' : code, {
      reason: input.unavailable?.reason,
    });
  }

  const currency = catalogue.currency;
  const product = catalogue.products.find((candidate) => candidate.id === binding.productId);
  if (!product) {
    return notOrderable(serviceKey, 'PRODUCT_NOT_IN_CATALOGUE', { currency });
  }

  // Live availability ∩ what the binding promised. The binding may list cycles the product no
  // longer offers; only the intersection is sellable.
  const liveCycles = cyclesFor(product, currency).filter((cycle) => binding.billingCycles.includes(cycle));
  if (liveCycles.length === 0) {
    return notOrderable(serviceKey, 'NO_CYCLES_OFFERED', { currency });
  }

  const pricing = product.currencies[currency];
  const cycles: OrderabilityCycle[] = [];
  for (const cycle of liveCycles) {
    const price = pricing?.cycles[cycle];
    if (!price) continue; // defensive: cyclesFor already proved it exists
    let cartUrl: string;
    try {
      cartUrl = buildCartUrl(map, cart, { serviceKey, billingCycle: cycle });
    } catch {
      // The cart module refused — that is a map inconsistency, not a customer problem. Skip the
      // cycle rather than render a broken link; if none survive, the service is unavailable.
      continue;
    }
    cycles.push({ cycle, price: price.price, setupFee: price.setupFee, currency, cartUrl });
  }

  if (cycles.length === 0) {
    return notOrderable(serviceKey, 'NO_CYCLES_OFFERED', { currency });
  }

  return {
    serviceKey,
    state: 'orderable',
    orderable: true,
    reasonCode: 'ORDERABLE',
    reason: ORDERABILITY_MESSAGES.ORDERABLE,
    currency,
    productId: String(product.id),
    productName: product.name,
    cycles,
  };
}

/** Every requested service, in a stable order. Duplicates and unknown keys are handled calmly. */
export function decideMany(input: Omit<DecideInput, 'serviceKey'> & { serviceKeys: string[] }): ServiceOrderability[] {
  const seen = new Set<string>();
  const results: ServiceOrderability[] = [];
  for (const serviceKey of input.serviceKeys) {
    if (seen.has(serviceKey)) continue;
    seen.add(serviceKey);
    results.push(decideOrderability({ ...input, serviceKey }));
  }
  return results;
}

/**
 * Maps a catalogue-loading failure onto the state a page should render. Never a 500: a page that
 * cannot reach WHMCS still renders, without a buy button and with the reason.
 */
export function catalogueFailure(error: unknown): { code: OrderabilityReasonCode; reason?: string } {
  const code = error instanceof WhmcsError ? error.code : null;
  switch (code) {
    case 'WHMCS_CURRENCY_UNAVAILABLE':
      return { code: 'CURRENCY_UNAVAILABLE' };
    case 'WHMCS_MAP_INVALID':
    case 'WHMCS_MAP_CHECKSUM_MISMATCH':
      return { code: 'MAP_INVALID' };
    default:
      // Timeouts, breaker-open, HTTP failures, malformed payloads: all "ask again shortly", never a
      // reason to show a price from a cached or invented catalogue.
      return { code: 'UPSTREAM_UNAVAILABLE' };
  }
}

export interface CatalogueLoader {
  load(currency?: string): Promise<NormalizedCatalogue>;
}

/**
 * A short-lived, single-flight cache in front of `fetchCatalogue`.
 *
 * Why it exists: the plan block asks for orderability on page view, and each miss is three WHMCS
 * calls. Sixty seconds of sharing turns a busy page into one refresh per minute, and single-flight
 * means ten simultaneous visitors cost one refresh rather than ten.
 *
 * Why it is this small: caching is only safe because a stale answer can at worst show yesterday's
 * *price*, never a wrong *verdict* — WHMCS re-validates the product and price again in the cart.
 * Failures are never cached.
 */
export function createCatalogueLoader(
  client: WhmcsClient,
  options: { ttlMs?: number; now?: () => number } = {},
): CatalogueLoader {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; value: NormalizedCatalogue }>();
  const inFlight = new Map<string, Promise<NormalizedCatalogue>>();

  return {
    async load(currency) {
      const key = (currency ?? 'default').trim().toUpperCase() || 'DEFAULT';

      const cached = entries.get(key);
      if (cached && now() - cached.at < ttlMs) return cached.value;

      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = fetchCatalogue(client, currency ? { currency } : {})
        .then((value) => {
          entries.set(key, { at: now(), value });
          return value;
        })
        .finally(() => {
          // A failure is not cached: the next view retries, and the circuit breaker in the client
          // is what protects WHMCS from a page under load.
          inFlight.delete(key);
        });

      inFlight.set(key, promise);
      return promise;
    },
  };
}
