/**
 * Locale-aware formatting. These helpers change only how a value is displayed. They never convert an
 * amount: currency conversion needs a trusted rate, and the server decides which currency a monetary
 * value is stored and charged in.
 *
 * Every helper falls back to a plain rendering rather than throwing, so a bad locale or currency code
 * can never blank a page.
 */
const CURRENCY_CODE = /^[A-Z]{3}$/;

export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Formats a money amount with the currency's own symbol and decimal rules. An invalid code renders
 * the amount followed by the raw code, instead of guessing a symbol.
 */
export function formatCurrency(amount: number, currency: string, locale: string): string {
  if (!CURRENCY_CODE.test(currency)) {
    return `${formatNumber(amount, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Dates are shown in UTC unless a caller passes its own options, so a date never shifts by timezone. */
export function formatDate(value: Date | string | number, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, options ?? { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
