import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDate, formatNumber } from '../../src/i18n/format';

/**
 * Locale-aware display. The contract under test: the same value is shown the way each locale
 * expects, an invalid code never produces a guessed symbol, and a bad input never throws.
 */
describe('formatCurrency', () => {
  it('uses the currency symbol and decimal rules of the active locale', () => {
    expect(formatCurrency(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatCurrency(1234.5, 'USD', 'de-DE')).toContain('1.234,50');
  });

  it('renders the code rather than guessing a symbol when the currency code is not an ISO code', () => {
    expect(formatCurrency(12.5, 'usd', 'en')).toBe('12.50 usd');
    expect(formatCurrency(12.5, '$', 'en')).toBe('12.50 $');
    expect(formatCurrency(12.5, '', 'en')).toBe('12.50 ');
  });

  it('keeps the amount when the locale tag is malformed', () => {
    expect(formatCurrency(3, 'USD', 'not a locale!!')).toMatch(/3\.00/);
  });
});

describe('formatNumber', () => {
  it('groups digits according to the locale', () => {
    expect(formatNumber(1234567.891, 'en-US')).toBe('1,234,567.891');
    expect(formatNumber(1234567.891, 'de-DE')).toBe('1.234.567,891');
  });

  it('falls back to a plain rendering for a malformed locale instead of throwing', () => {
    expect(formatNumber(42, 'not a locale!!')).toBe('42');
  });
});

describe('formatDate', () => {
  it('formats a calendar date in the active locale, in UTC so the day never shifts', () => {
    expect(formatDate('2026-10-12T00:00:00Z', 'en-US')).toBe('October 12, 2026');
    expect(formatDate('2026-10-12T23:30:00Z', 'en-US')).toBe('October 12, 2026');
  });

  it('returns an empty string for an invalid date rather than "Invalid Date"', () => {
    expect(formatDate('not a date', 'en-US')).toBe('');
    expect(formatDate(Number.NaN, 'en-US')).toBe('');
  });
});
