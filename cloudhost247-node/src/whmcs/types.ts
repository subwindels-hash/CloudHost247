/**
 * Types shared across the WHMCS integration layer.
 *
 * The billing-cycle names are WHMCS's own column names in `tblpricing`; using them verbatim is
 * deliberate — a translation table between two vocabularies is how a quarterly price ends up quoted
 * as a monthly one.
 */

export const BILLING_CYCLES = [
  'monthly',
  'quarterly',
  'semiannually',
  'annually',
  'biennially',
  'triennially',
] as const;

export type BillingCycle = (typeof BILLING_CYCLES)[number];

export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === 'string' && (BILLING_CYCLES as readonly string[]).includes(value);
}

/** One price for one cycle, exactly as WHMCS reported it (strings, never re-formatted here). */
export interface CyclePrice {
  /** e.g. "9.95" — kept as a string so no floating-point rounding is introduced. */
  price: string;
  /** e.g. "0.00"; reported separately because WHMCS quotes setup fees per cycle. */
  setupFee: string;
}

export interface CurrencyPricing {
  code: string;
  prefix: string;
  suffix: string;
  /** Only cycles WHMCS actually configured for this product. An absent key means "not offered". */
  cycles: Partial<Record<BillingCycle, CyclePrice>>;
}

/** A product as WHMCS described it, bounded to the fields this project may display. */
export interface NormalizedProduct {
  id: number;
  groupId: number;
  name: string;
  description: string;
  /** WHMCS server-module name (`tblproducts.servertypeid` → `tblservers.type`), e.g. "cpanel". */
  module: string | null;
  /** `tblproducts.paytype`: "recurring" | "onetime" | "free". */
  payType: string | null;
  hidden: boolean;
  /** Pricing keyed by currency code. An empty object means WHMCS published no price for it. */
  currencies: Record<string, CurrencyPricing>;
}

export interface NormalizedGroup {
  id: number;
  name: string;
  hidden: boolean;
}

export interface NormalizedCatalogue {
  /** Currency the prices below were selected for. A price from another currency is never shown. */
  currency: string;
  groups: NormalizedGroup[];
  products: NormalizedProduct[];
  /** Products WHMCS returned but which carry no usable price for `currency`. */
  unpricedProductIds: number[];
}
