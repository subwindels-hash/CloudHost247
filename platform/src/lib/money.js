/**
 * Currency precision — how many decimal places a currency has, and what the ledger can hold.
 *
 * Two facts, in one place, because they are easy to confuse:
 *
 *   1. **How many decimals a currency has.** A Bitcoin amount has eight (satoshi), the yen has none,
 *      the dollar has two. Every gateway comparison in this platform is done in integer minor units
 *      rather than floating point, so the conversion needs the right scale: `12.34 USD` is `1234`
 *      and `0.00042 BTC` is `42000`. Assuming `× 100` everywhere silently compares satoshis against
 *      cents — which reads as an amount mismatch while refusing every honest Bitcoin payment.
 *
 *   2. **What this ledger can hold.** Money columns are `NUMERIC(16,2)`, and the JSON backend
 *      mirrors that by rounding every `numeric` write to two decimals. That is not an oversight to
 *      paper over here: it is the reason a currency with more precision than two decimals cannot be
 *      *credited* in this build, and callers that would otherwise store `0.00042` as `0` ask
 *      `exceedsLedgerPrecision()` first and refuse by name instead of crediting nothing.
 *
 * `× 100` behaviour is unchanged for every currency the platform has ever settled (the fiat gateway
 * suites pin that).
 */
'use strict';

/** Decimal places per currency. Anything unlisted is a two-decimal currency. */
const MINOR_UNIT_SCALES = Object.freeze({
  BTC: 8,   // satoshis
  JPY: 0,   // the yen has no minor unit
  KRW: 0,
});

/** Decimal places the platform's money columns hold — `NUMERIC(16,2)`, and the JSON store's
 *  `Math.round(n * 100) / 100`. Keep this in step with `src/store/schema.js#TYPES.numeric`. */
const LEDGER_SCALE = 2;

/** Decimal places for `currency` (2 when the currency is unknown, which is the platform's norm). */
function minorUnitScale(currency) {
  const code = String(currency ?? '').trim().toUpperCase();
  return MINOR_UNIT_SCALES[code] ?? 2;
}

/** True when `currency` needs more precision than a money column can store. */
function exceedsLedgerPrecision(currency) {
  return minorUnitScale(currency) > LEDGER_SCALE;
}

/** `amount` (major units, e.g. 12.34 USD or 0.00042 BTC) → integer minor units. */
function toMinorUnits(amount, currency) {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) throw new TypeError(`Cannot convert ${amount} to minor units`);
  return Math.round(value * 10 ** minorUnitScale(currency));
}

/** `amount` → the same value rounded to the currency's own precision (never to a fixed 2dp). */
function roundToMinorUnits(amount, currency) {
  const scale = 10 ** minorUnitScale(currency);
  return Math.round(Number(amount ?? 0) * scale) / scale;
}

module.exports = {
  MINOR_UNIT_SCALES, LEDGER_SCALE, minorUnitScale, exceedsLedgerPrecision, toMinorUnits, roundToMinorUnits,
};
