/**
 * Canonical currency registry (multi-currency architecture, 2026-11-07).
 *
 * This is the SINGLE source of truth for which currencies CloudHost247 can actually bill in. A
 * currency is only billable when it appears here AND a canonical price row exists for it. Display
 * formatting may use any locale, but a customer is never quoted a converted estimate as a charge.
 */
export type RoundingRule = 'HALF_UP';

export interface CurrencyDefinition {
  /** ISO 4217 alphabetic code, uppercase. */
  readonly code: string;
  /** ISO 4217 minor-unit exponent (2 for USD/GBP/NGN, 0 for JPY/KRW). */
  readonly minorUnits: number;
  /** Display symbol used only after Intl formatting, never in an amount calculation. */
  readonly symbol: string;
  /** Customer-facing price rounding. HALF_UP is applied in exact integer arithmetic. */
  readonly rounding: RoundingRule;
  /** True when the currency has no minor unit and prices must be whole numbers. */
  readonly zeroDecimal?: boolean;
}

const defs: readonly CurrencyDefinition[] = [
  { code: 'USD', minorUnits: 2, symbol: '$', rounding: 'HALF_UP' },
  { code: 'GBP', minorUnits: 2, symbol: '£', rounding: 'HALF_UP' },
  { code: 'EUR', minorUnits: 2, symbol: '€', rounding: 'HALF_UP' },
  { code: 'NGN', minorUnits: 2, symbol: '₦', rounding: 'HALF_UP' },
  { code: 'CAD', minorUnits: 2, symbol: 'CA$', rounding: 'HALF_UP' },
  { code: 'AUD', minorUnits: 2, symbol: 'A$', rounding: 'HALF_UP' },
  { code: 'GHS', minorUnits: 2, symbol: 'GH₵', rounding: 'HALF_UP' },
  { code: 'KES', minorUnits: 2, symbol: 'KSh', rounding: 'HALF_UP' },
  { code: 'ZAR', minorUnits: 2, symbol: 'R', rounding: 'HALF_UP' },
  { code: 'INR', minorUnits: 2, symbol: '₹', rounding: 'HALF_UP' },
  { code: 'JPY', minorUnits: 0, symbol: '¥', rounding: 'HALF_UP', zeroDecimal: true },
  { code: 'KRW', minorUnits: 0, symbol: '₩', rounding: 'HALF_UP', zeroDecimal: true },
];

export const CURRENCIES: Readonly<Record<string, CurrencyDefinition>> = Object.freeze(
  Object.fromEntries(defs.map((d) => [d.code, Object.freeze(d)]))
);

/** Billing base currency. All canonical prices are authored in this currency. */
export const BASE_CURRENCY = 'USD';

export const SUPPORTED_CURRENCIES: readonly string[] = Object.freeze(defs.map((d) => d.code));

/**
 * Country (ISO 3166-1 alpha-2) → default billing currency. Only countries with a genuinely
 * supported currency are listed; anything else falls back to BASE_CURRENCY. This is a DEFAULT,
 * not an override of an existing order or invoice.
 */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = Object.freeze({
  GB: 'GBP', US: 'USD', NG: 'NGN', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
  NL: 'EUR', PT: 'EUR', BE: 'EUR', AT: 'EUR', FI: 'EUR', GR: 'EUR', CA: 'CAD', AU: 'AUD',
  GH: 'GHS', KE: 'KES', ZA: 'ZAR', IN: 'INR', JP: 'JPY', KR: 'KRW',
});

export function isSupportedCurrency(code: unknown): code is string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, code.toUpperCase());
}

export function currencyDefinition(code: string): CurrencyDefinition {
  const def = CURRENCIES[code.toUpperCase()];
  if (!def) throw new Error(`Unsupported billing currency: ${String(code)}`);
  return def;
}

export function currencyForCountry(country: string | null | undefined): string {
  if (!country) return BASE_CURRENCY;
  return COUNTRY_CURRENCY[country.trim().toUpperCase()] ?? BASE_CURRENCY;
}
