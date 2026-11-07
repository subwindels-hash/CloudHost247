/**
 * Exact decimal money arithmetic for multi-currency pricing.
 *
 * Rules (documented, not implicit):
 *  - All amounts are stored and transmitted as DECIMAL STRINGS of minor units (e.g. "1299" = 12.99
 *    USD). No JS float is ever used for an amount, and BigInt is never JSON-serialised.
 *  - Conversion is: targetMinor = HALF_UP(sourceMinor / 10^sourceScale * rate * 10^targetScale).
 *    HALF_UP is "round half away from zero"; amounts are non-negative magnitudes, so that is a
 *    plain half-up. Every step uses exact BigInt rational arithmetic — no floating point.
 *  - A rate is a decimal string parsed into an exact rational (numerator/denominator). Rates must
 *    be finite, positive and have come from a recorded, timestamped FX snapshot.
 *  - Rounding is applied ONCE, at the point a canonical price is created for a currency. Cart,
 *    checkout, invoice, dashboard and refund surfaces reuse that frozen price; they never
 *    re-convert at display time.
 */
import { currencyDefinition, type CurrencyDefinition } from './registry';

export interface ExactDecimal {
  /** Exact value = mantissa / 10^scale, with mantissa >= 0 for money amounts. */
  readonly mantissa: bigint;
  readonly scale: number;
}

/** Parse a plain decimal string into an exact rational. Rejects exponent/NaN/Infinity. */
export function parseExactDecimal(input: string | number): ExactDecimal {
  const text = typeof input === 'number' ? String(input) : input;
  if (!/^-?\d+(?:\.\d+)?$/.test(text.trim())) {
    throw new Error(`Not a plain decimal: ${String(input)}`);
  }
  const negative = text.trim().startsWith('-');
  const body = text.trim().replace(/^-/, '');
  const [whole, fraction = ''] = body.split('.');
  const mantissa = BigInt(`${whole}${fraction}` || '0') * (negative ? -1n : 1n);
  return { mantissa, scale: fraction.length };
}

/** Convert a major-unit decimal string ("12.99") to exact minor-unit string ("1299"). */
export function toMinorUnits(amount: string | number, currency: string): string {
  const def = currencyDefinition(currency);
  const parsed = parseExactDecimal(amount);
  if (parsed.mantissa < 0n) throw new Error('Money amounts are non-negative magnitudes');
  const targetScale = def.minorUnits;
  let minor: bigint;
  if (targetScale >= parsed.scale) {
    // Scale UP: exact multiplication, no rounding needed.
    minor = parsed.mantissa * 10n ** BigInt(targetScale - parsed.scale);
  } else {
    // Scale DOWN: round HALF_UP exactly once. A negative BigInt exponent is illegal, hence the
    // positive divisor here rather than a single factor computed unconditionally.
    const divisor = 10n ** BigInt(parsed.scale - targetScale);
    minor = roundHalfUpDivide(parsed.mantissa, divisor);
  }
  return minor.toString();
}

/** Convert a minor-unit string back to a plain decimal major-unit string. */
export function fromMinorUnits(minor: string | bigint, currency: string): string {
  const def = currencyDefinition(currency);
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);
  if (value < 0n) throw new Error('Money amounts are non-negative magnitudes');
  if (def.minorUnits === 0) return value.toString();
  const divisor = 10n ** BigInt(def.minorUnits);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(def.minorUnits, '0');
  return `${whole}.${fraction}`;
}

/** HALF_UP integer division for non-negative numerators (half away from zero). */
export function roundHalfUpDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Denominator must be positive');
  if (numerator < 0n) throw new Error('Money rounding expects a non-negative numerator');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export interface FxRate {
  /** Exact decimal string, e.g. "0.79234"; must be finite and > 0. */
  readonly value: string;
  /** Currency the rate is expressed FROM. */
  readonly from: string;
  /** Currency the rate is expressed TO. */
  readonly to: string;
  /** Source identifier (ECB / Frankfurter / approved provider) — for the audit trail. */
  readonly source: string;
  /** ISO timestamp when the provider observed the rate. */
  readonly observedAt: string;
  /** Immutable snapshot id used on the transaction record. */
  readonly snapshotId: string;
}

/**
 * Convert an exact canonical price into a target currency, rounding ONCE and returning only the
 * frozen minor-unit string. Never returns an estimate the caller could mistake for a charge.
 */
export function convertCanonicalPrice(
  sourceMinor: string | bigint,
  sourceCurrency: string,
  rate: FxRate,
  targetCurrency: string
): string {
  const fromDef = currencyDefinition(sourceCurrency);
  const toDef = currencyDefinition(targetCurrency);
  if (rate.from !== sourceCurrency || rate.to !== targetCurrency) {
    throw new Error(`FX rate currency mismatch: ${rate.from}->${rate.to} for ${sourceCurrency}->${targetCurrency}`);
  }
  const parsedRate = parseExactDecimal(rate.value);
  if (parsedRate.mantissa <= 0n) throw new Error('FX rate must be positive');
  const source = typeof sourceMinor === 'bigint' ? sourceMinor : BigInt(sourceMinor);
  if (source < 0n) throw new Error('Money amounts are non-negative magnitudes');

  // targetMinor = HALF_UP( sourceMinor * rate * 10^toScale / (10^fromScale * 10^rateScale) )
  const numerator = source * parsedRate.mantissa * 10n ** BigInt(toDef.minorUnits);
  const denominator = 10n ** BigInt(fromDef.minorUnits) * 10n ** BigInt(parsedRate.scale);
  return roundHalfUpDivide(numerator, denominator).toString();
}

/** Intl formatting for display only. The charge currency/amount come from the frozen snapshot. */
export function formatMoney(minor: string | bigint, currency: string, locale = 'en'): string {
  const def: CurrencyDefinition = currencyDefinition(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: def.code,
    minimumFractionDigits: def.minorUnits,
    maximumFractionDigits: def.minorUnits,
  }).format(Number(fromMinorUnits(minor, def.code)));
}
