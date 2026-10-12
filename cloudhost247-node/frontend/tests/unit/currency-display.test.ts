import { describe, expect, it } from 'vitest';
import {
  BASE_CURRENCY,
  UNAVAILABLE_STATUS,
  formatAmountInDisplayCurrency,
  formatRateTimestamp,
  isCurrencyCode,
  rateFor,
  resolveDisplayCurrency,
  selectableCurrencies,
  type DisplayCurrencyStatus,
} from '../../src/currency/display-currency';

const LIVE: DisplayCurrencyStatus = {
  base: 'USD',
  available: true,
  reason: null,
  asOf: '2026-10-12T06:00:00.000Z',
  fetchedAt: '2026-10-12T06:05:00.000Z',
  currencies: [
    { code: 'EUR', rate: 0.9231, observedAt: '2026-10-12T06:00:00.000Z' },
    { code: 'JPY', rate: 150.5, observedAt: '2026-10-12T06:00:00.000Z' },
    { code: 'GBP', rate: 0.7844, observedAt: '2026-10-12T06:00:00.000Z' },
  ],
};

describe('display currency selection', () => {
  it('offers USD first, then only currencies with a valid published rate', () => {
    expect(selectableCurrencies(LIVE)).toEqual(['USD', 'EUR', 'JPY', 'GBP']);
  });

  it('offers only USD when rates are unavailable, stale, or never synced', () => {
    expect(selectableCurrencies(UNAVAILABLE_STATUS)).toEqual(['USD']);
    expect(selectableCurrencies({ ...LIVE, available: false, reason: 'stale', currencies: [] })).toEqual(['USD']);
  });

  it('drops malformed or non-positive rates instead of offering them', () => {
    const bad: DisplayCurrencyStatus = {
      ...LIVE,
      currencies: [
        { code: 'EUR', rate: 0, observedAt: '' },
        { code: 'eur', rate: 1, observedAt: '' },
        { code: '€', rate: 1, observedAt: '' },
        { code: 'CHF', rate: Number.NaN, observedAt: '' },
        { code: 'USD', rate: 1, observedAt: '' },
      ],
    };
    expect(selectableCurrencies(bad)).toEqual(['USD']);
  });

  it('honours a stored or requested code only while the current status still offers it', () => {
    expect(resolveDisplayCurrency('EUR', LIVE)).toBe('EUR');
    expect(resolveDisplayCurrency('CHF', LIVE)).toBe('USD');
    expect(resolveDisplayCurrency('EUR', UNAVAILABLE_STATUS)).toBe('USD');
    expect(resolveDisplayCurrency('eur', LIVE)).toBe('USD');
    expect(resolveDisplayCurrency('<script>', LIVE)).toBe('USD');
    expect(resolveDisplayCurrency(null, LIVE)).toBe('USD');
    expect(resolveDisplayCurrency(42, LIVE)).toBe('USD');
  });

  it('validates currency codes strictly', () => {
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(isCurrencyCode('EURO')).toBe(false);
    expect(isCurrencyCode('eu')).toBe(false);
    expect(isCurrencyCode(undefined)).toBe(false);
  });
});

describe('amount formatting', () => {
  it('converts a USD amount with the published rate and formats it in the target currency', () => {
    const out = formatAmountInDisplayCurrency(10, 'USD', 'EUR', LIVE, 'en-US');
    expect(out).toEqual({ text: '€9.23', converted: true, currency: 'EUR' });
  });

  it('uses the currency’s own minor-unit rules (JPY has none)', () => {
    const out = formatAmountInDisplayCurrency(10, 'USD', 'JPY', LIVE, 'en-US');
    expect(out.converted).toBe(true);
    expect(out.text).toBe('¥1,505');
  });

  it('shows USD unchanged when the display currency is USD', () => {
    expect(formatAmountInDisplayCurrency(9.99, 'USD', 'USD', LIVE, 'en-US')).toEqual({
      text: '$9.99',
      converted: false,
      currency: 'USD',
    });
  });

  it('never converts a non-USD source amount; it keeps its own code', () => {
    const out = formatAmountInDisplayCurrency(50, 'GBP', 'EUR', LIVE, 'en-US');
    expect(out.converted).toBe(false);
    expect(out.currency).toBe('GBP');
    expect(out.text).toBe('£50.00');
  });

  it('falls back to the USD rendering when the chosen currency has no valid rate', () => {
    const out = formatAmountInDisplayCurrency(10, 'USD', 'CHF', LIVE, 'en-US');
    expect(out).toEqual({ text: '$10.00', converted: false, currency: 'USD' });
  });

  it('never renders a bare symbol for an invalid code, and never throws', () => {
    const out = formatAmountInDisplayCurrency(10, 'USD', 'USD', LIVE, 'not a locale!!');
    expect(out.text).toContain('USD');
    expect(formatAmountInDisplayCurrency(Number.NaN, 'USD', 'EUR', LIVE, 'en-US').text).toBe('');
  });

  it('formats numbers with the requested locale separators', () => {
    const out = formatAmountInDisplayCurrency(1234.5, 'USD', 'EUR', LIVE, 'de-DE');
    expect(out.converted).toBe(true);
    expect(out.text).toMatch(/1\.139,57/);
  });

  it('looks up rates from the status, with USD fixed at 1', () => {
    expect(rateFor('USD', UNAVAILABLE_STATUS)).toBe(1);
    expect(rateFor('EUR', LIVE)).toBe(0.9231);
    expect(rateFor('CHF', LIVE)).toBeNull();
  });
});

describe('rate timestamps', () => {
  it('renders the observation time in UTC, so it never shifts with the visitor’s timezone', () => {
    const text = formatRateTimestamp('2026-10-12T06:00:00.000Z', 'en-GB');
    expect(text).toMatch(/12 Oct 2026/);
    expect(text).toMatch(/06:00/);
    expect(text).toMatch(/UTC|GMT/);
  });

  it('returns an empty string for a missing or invalid timestamp', () => {
    expect(formatRateTimestamp(null, 'en')).toBe('');
    expect(formatRateTimestamp('not-a-date', 'en')).toBe('');
  });
});

it('keeps the base currency constant aligned with the server', () => {
  expect(BASE_CURRENCY).toBe('USD');
});
