import { describe, expect, it } from 'vitest';
import {
  BASE_CURRENCY, CURRENCIES, SUPPORTED_CURRENCIES, currencyForCountry, currencyDefinition,
  isSupportedCurrency,
} from '../../src/currency/registry';
import {
  convertCanonicalPrice, formatMoney, fromMinorUnits, parseExactDecimal,
  roundHalfUpDivide, toMinorUnits,
} from '../../src/currency/money';
import {
  FxRateUnavailableError, assertFresh, createFxRateSnapshot, rateFromSnapshot, StaticFxRateSource,
} from '../../src/currency/rates';
import {
  CurrencyMutationError, assertTransactionMoneyUnchanged, freezeTransactionMoney,
  refundMoney, transactionMoneyLabel,
} from '../../src/currency/snapshot';

const NOW = '2026-11-07T12:00:00.000Z';

describe('currency registry', () => {
  it('supports GBP, USD and NGN plus zero-decimal currencies', () => {
    expect(BASE_CURRENCY).toBe('USD');
    for (const code of ['USD', 'GBP', 'EUR', 'NGN']) expect(isSupportedCurrency(code)).toBe(true);
    expect(CURRENCIES.JPY.minorUnits).toBe(0);
    expect(CURRENCIES.NGN.minorUnits).toBe(2);
    expect(SUPPORTED_CURRENCIES.length).toBeGreaterThanOrEqual(10);
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(() => currencyDefinition('XYZ')).toThrow(/Unsupported/);
  });

  it('maps countries to a genuine billing currency and falls back to USD', () => {
    expect(currencyForCountry('GB')).toBe('GBP');
    expect(currencyForCountry('gb')).toBe('GBP');
    expect(currencyForCountry('US')).toBe('USD');
    expect(currencyForCountry('NG')).toBe('NGN');
    expect(currencyForCountry('DE')).toBe('EUR');
    expect(currencyForCountry('JP')).toBe('JPY');
    expect(currencyForCountry(null)).toBe('USD');
    expect(currencyForCountry('ZZ')).toBe('USD');
  });
});

describe('exact money arithmetic (no floating point)', () => {
  it('parses decimals exactly and rejects non-plain values', () => {
    expect(parseExactDecimal('12.99')).toEqual({ mantissa: 1299n, scale: 2 });
    expect(parseExactDecimal('-0.5').mantissa).toBe(-5n);
    for (const bad of ['1e3', 'NaN', 'Infinity', '12,99', '', '0x10']) {
      expect(() => parseExactDecimal(bad)).toThrow(/Not a plain decimal/);
    }
  });

  it('converts major units to minor units with documented HALF_UP rounding', () => {
    expect(toMinorUnits('12.99', 'USD')).toBe('1299');
    expect(toMinorUnits('0.005', 'USD')).toBe('1');
    expect(toMinorUnits('0.004', 'USD')).toBe('0');
    expect(toMinorUnits('1000', 'JPY')).toBe('1000');
    expect(toMinorUnits('1000.5', 'JPY')).toBe('1001');
    expect(toMinorUnits('1500000.00', 'NGN')).toBe('150000000');
    expect(() => toMinorUnits('-1', 'USD')).toThrow(/non-negative/);
  });

  it('round-trips minor units and formats for display only', () => {
    expect(fromMinorUnits('1299', 'USD')).toBe('12.99');
    expect(fromMinorUnits('1000', 'JPY')).toBe('1000');
    expect(formatMoney('1299', 'GBP', 'en-GB')).toContain('12.99');
    expect(roundHalfUpDivide(5n, 2n)).toBe(3n);
    expect(roundHalfUpDivide(4n, 2n)).toBe(2n);
  });

  it('converts a canonical price exactly once, with rate provenance', () => {
    const rate = {
      value: '0.79234', from: 'USD', to: 'GBP', source: 'static-test-feed',
      observedAt: NOW, snapshotId: 'fx-2026-11-07-001',
    };
    // 12.99 USD * 0.79234 = 10.2924966 GBP → 1029 pence (HALF_UP, once).
    expect(convertCanonicalPrice('1299', 'USD', rate, 'GBP')).toBe('1029');
    // Zero-decimal target: 12.99 USD * 151.2 = 1964.088 JPY → 1964 JPY.
    expect(convertCanonicalPrice('1299', 'USD', { ...rate, to: 'JPY', value: '151.2' }, 'JPY')).toBe('1964');
    // Large NGN magnitude stays exact (no float drift).
    expect(convertCanonicalPrice('1299', 'USD', { ...rate, to: 'NGN', value: '1500' }, 'NGN')).toBe('1948500');
    expect(() => convertCanonicalPrice('1299', 'USD', { ...rate, value: '0' }, 'GBP')).toThrow(/positive/);
    expect(() => convertCanonicalPrice('1299', 'USD', { ...rate, from: 'EUR' }, 'GBP')).toThrow(/mismatch/);
  });
});

describe('reliable FX snapshots (fail closed, never a silent fallback)', () => {
  const snapshot = createFxRateSnapshot({
    id: 'fx-2026-11-07-001', source: 'static-test-feed', observedAt: NOW,
    rates: { GBP: '0.79234', EUR: '0.92', NGN: '1500', JPY: '151.2' },
  });

  it('freezes a validated snapshot and injects the base rate', () => {
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.rates)).toBe(true);
    expect(snapshot.rates.USD).toBe('1');
  });

  it('rejects invalid rates, currencies and timestamps', () => {
    expect(() => createFxRateSnapshot({ id: 'x', source: 's', observedAt: NOW, rates: { GBP: '0' } })).toThrow(FxRateUnavailableError);
    expect(() => createFxRateSnapshot({ id: 'x', source: 's', observedAt: NOW, rates: { GBP: '-1' } })).toThrow(FxRateUnavailableError);
    expect(() => createFxRateSnapshot({ id: 'x', source: 's', observedAt: NOW, rates: { GBP: 'NaN' } })).toThrow(FxRateUnavailableError);
    expect(() => createFxRateSnapshot({ id: 'x', source: 's', observedAt: 'not-a-date', rates: { GBP: '0.8' } })).toThrow(FxRateUnavailableError);
    expect(() => createFxRateSnapshot({ id: 'x', source: 's', observedAt: NOW, rates: { XYZ: '0.8' } })).toThrow(FxRateUnavailableError);
  });

  it('fails closed on stale or missing rates', () => {
    expect(() => assertFresh(snapshot, 86_400_000, new Date('2026-11-07T13:00:00Z'))).not.toThrow();
    expect(() => assertFresh(snapshot, 3_600_000, new Date('2026-11-07T14:00:00Z'))).toThrow(FxRateUnavailableError);
    expect(() => rateFromSnapshot(snapshot, 'USD', 'CAD')).toThrow(FxRateUnavailableError);
    expect(() => rateFromSnapshot(snapshot, 'EUR', 'GBP')).toThrow(FxRateUnavailableError);
  });

  it('exposes a deterministic offline source for isolated tests', async () => {
    const source = new StaticFxRateSource({ GBP: '0.79234' }, NOW);
    const fetched = await source.fetchRates();
    expect(fetched.rates).toEqual([{ currency: 'GBP', value: '0.79234' }]);
    expect(rateFromSnapshot(snapshot, 'USD', 'GBP').value).toBe('0.79234');
  });
});

describe('immutable transaction currency and price snapshots', () => {
  const usd = freezeTransactionMoney({
    currency: 'USD', amountMinor: '1299', pricingId: 'price-1',
    canonicalCurrency: 'USD', canonicalAmountMinor: '1299', frozenAt: NOW,
  });
  const gbp = freezeTransactionMoney({
    currency: 'GBP', amountMinor: '1029', pricingId: 'price-1-gbp',
    canonicalCurrency: 'USD', canonicalAmountMinor: '1299',
    fx: { rate: '0.79234', source: 'static-test-feed', observedAt: NOW, snapshotId: 'fx-2026-11-07-001' },
    frozenAt: NOW,
  });

  it('freezes the charge currency and amount', () => {
    expect(Object.isFrozen(usd)).toBe(true);
    expect(usd.fx).toBeNull();
    expect(gbp.fx?.roundingRule).toBe('HALF_UP');
    expect(gbp.fx?.snapshotId).toBe('fx-2026-11-07-001');
    expect(transactionMoneyLabel(gbp, 'en-GB')).toContain('10.29');
  });

  it('requires FX provenance for a converted price and forbids it for a canonical price', () => {
    expect(() => freezeTransactionMoney({
      currency: 'GBP', amountMinor: '1029', pricingId: 'p', canonicalCurrency: 'USD', canonicalAmountMinor: '1299',
    })).toThrow(CurrencyMutationError);
    expect(() => freezeTransactionMoney({
      currency: 'USD', amountMinor: '1299', pricingId: 'p', canonicalCurrency: 'USD', canonicalAmountMinor: '1299',
      fx: { rate: '1', source: 'x', observedAt: NOW, snapshotId: 'x' },
    })).toThrow(CurrencyMutationError);
  });

  it('never silently changes an existing order or invoice currency/amount', () => {
    expect(() => assertTransactionMoneyUnchanged(gbp, { currency: 'GBP', amountMinor: '1029' })).not.toThrow();
    // A later country detection returns NGN, and a later FX feed changes the rate: neither may
    // rewrite the frozen GBP price.
    expect(() => assertTransactionMoneyUnchanged(gbp, { currency: 'NGN', amountMinor: '1948500' })).toThrow(CurrencyMutationError);
    expect(() => assertTransactionMoneyUnchanged(gbp, { currency: 'GBP', amountMinor: '1035' })).toThrow(CurrencyMutationError);
    expect(() => assertTransactionMoneyUnchanged(usd, { currency: currencyForCountry('GB'), amountMinor: '1299' })).toThrow(CurrencyMutationError);
  });

  it('refunds in the original currency without re-conversion', () => {
    const full = refundMoney(gbp);
    expect(full.currency).toBe('GBP');
    expect(full.amountMinor).toBe('1029');
    expect(full.fx?.snapshotId).toBe('fx-2026-11-07-001');
    const partial = refundMoney(gbp, '500');
    expect(partial.currency).toBe('GBP');
    expect(partial.amountMinor).toBe('500');
    expect(() => refundMoney(gbp, '1030')).toThrow(CurrencyMutationError);
    expect(() => refundMoney(gbp, '0')).toThrow(CurrencyMutationError);
  });
});
