import { formatCurrency } from '../i18n/format';

/**
 * Display-currency rules. Everything here changes how an amount is SHOWN. It never changes what is
 * charged: every price, cart line and invoice is stored and billed in the base currency (USD), and
 * this module only converts a USD amount for reading.
 */

export const BASE_CURRENCY = 'USD';
/** localStorage key for the visitor's chosen display currency. Independent of the language key. */
export const CURRENCY_STORAGE_KEY = 'ch247.currency';

const CURRENCY_CODE = /^[A-Z]{3}$/;

export interface DisplayRate {
  code: string;
  /** Units of `code` that one USD buys, as published by the rate feed. */
  rate: number;
  observedAt: string;
}

export interface DisplayCurrencyStatus {
  base: string;
  available: boolean;
  reason: 'not_synced' | 'stale' | null;
  asOf: string | null;
  fetchedAt: string | null;
  currencies: DisplayRate[];
}

/** The status used when the rate feed cannot be read. Only the base currency is offered. */
export const UNAVAILABLE_STATUS: DisplayCurrencyStatus = {
  base: BASE_CURRENCY,
  available: false,
  reason: 'not_synced',
  asOf: null,
  fetchedAt: null,
  currencies: [],
};

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY_CODE.test(value);
}

/** The currencies a visitor may choose: always the base currency, then any published rate that is valid. */
export function selectableCurrencies(status: DisplayCurrencyStatus): string[] {
  if (!status.available) return [BASE_CURRENCY];
  const codes = status.currencies
    .filter((r) => isCurrencyCode(r.code) && r.code !== BASE_CURRENCY && Number.isFinite(r.rate) && r.rate > 0)
    .map((r) => r.code);
  return [BASE_CURRENCY, ...Array.from(new Set(codes))];
}

/**
 * Resolves the currency to show. A stored or requested code is honoured only if the current status
 * still offers it. Anything else (unknown, unavailable, rate withdrawn) falls back to the base currency.
 */
export function resolveDisplayCurrency(requested: unknown, status: DisplayCurrencyStatus): string {
  if (!isCurrencyCode(requested)) return BASE_CURRENCY;
  return selectableCurrencies(status).includes(requested) ? requested : BASE_CURRENCY;
}

export function rateFor(code: string, status: DisplayCurrencyStatus): number | null {
  if (code === BASE_CURRENCY) return 1;
  const match = status.currencies.find((r) => r.code === code);
  return match && Number.isFinite(match.rate) && match.rate > 0 ? match.rate : null;
}

/**
 * Formats a USD amount in the display currency. Only the base currency is ever used as the source, so
 * a non-USD `amount` is returned unconverted with its own code. Falls back to USD when no valid rate exists.
 */
export function formatAmountInDisplayCurrency(
  amount: number,
  sourceCurrency: string,
  displayCurrency: string,
  status: DisplayCurrencyStatus,
  locale: string
): { text: string; converted: boolean; currency: string } {
  if (!Number.isFinite(amount)) return { text: '', converted: false, currency: sourceCurrency };
  if (sourceCurrency !== BASE_CURRENCY || displayCurrency === BASE_CURRENCY) {
    return { text: formatCurrency(amount, sourceCurrency, locale), converted: false, currency: sourceCurrency };
  }
  const rate = rateFor(displayCurrency, status);
  if (rate === null) {
    return { text: formatCurrency(amount, BASE_CURRENCY, locale), converted: false, currency: BASE_CURRENCY };
  }
  return { text: formatCurrency(amount * rate, displayCurrency, locale), converted: true, currency: displayCurrency };
}

/** Human-readable rate timestamp, shown next to every converted amount. Always UTC, so it is unambiguous. */
export function formatRateTimestamp(iso: string | null, locale: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
