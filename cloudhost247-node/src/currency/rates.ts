/**
 * Reliable exchange-rate sources for canonical multi-currency pricing.
 *
 * A rate becomes usable only as part of an immutable, timestamped snapshot. There is NO silent
 * fallback: if no fresh snapshot exists, price creation fails with a typed error rather than using
 * a stale or invented rate. Live HTTP fetchers are defined here but are NOT invoked by tests or by
 * the preview; activating a real FX feed requires approval (see docs/PROVIDER-COMPARISON.md).
 */
import { isSupportedCurrency, BASE_CURRENCY } from './registry';

export interface RawRate {
  readonly currency: string;
  readonly value: string;
}

export interface FxRateSource {
  readonly name: string;
  readonly base: string;
  readonly endpoint: string;
  /** Implementations may perform network I/O. Callers must gate this on approved configuration. */
  fetchRates(): Promise<{ observedAt: string; rates: readonly RawRate[] }>;
}

export interface FxRateSnapshot {
  readonly id: string;
  readonly source: string;
  readonly observedAt: string;
  readonly base: string;
  /** Currency code → exact decimal rate string relative to `base`. */
  readonly rates: Readonly<Record<string, string>>;
}

export class FxRateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxRateUnavailableError';
  }
}

/** Validate and freeze a rate set. Rejects non-finite, zero, negative and unsupported entries. */
export function createFxRateSnapshot(input: {
  source: string;
  observedAt: string;
  base?: string;
  rates: Readonly<Record<string, string>>;
  id: string;
}): FxRateSnapshot {
  const base = (input.base ?? BASE_CURRENCY).toUpperCase();
  if (!isSupportedCurrency(base)) throw new FxRateUnavailableError(`Unsupported FX base: ${base}`);
  const observed = Date.parse(input.observedAt);
  if (!Number.isFinite(observed)) throw new FxRateUnavailableError('Invalid FX observation timestamp');
  const rates: Record<string, string> = {};
  for (const [code, value] of Object.entries(input.rates)) {
    const upper = code.toUpperCase();
    if (!isSupportedCurrency(upper)) throw new FxRateUnavailableError(`Unsupported FX currency: ${code}`);
    if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0 || !Number.isFinite(Number(value))) {
      throw new FxRateUnavailableError(`Invalid FX rate for ${code}: ${value}`);
    }
    rates[upper] = value;
  }
  rates[base] = '1';
  return Object.freeze({
    id: input.id,
    source: input.source,
    observedAt: new Date(observed).toISOString(),
    base,
    rates: Object.freeze(rates),
  });
}

/** Fail closed on stale rates. `maxAgeMs` is a policy decision, documented per environment. */
export function assertFresh(
  snapshot: FxRateSnapshot,
  maxAgeMs: number,
  now: Date = new Date()
): void {
  const age = now.getTime() - Date.parse(snapshot.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) {
    throw new FxRateUnavailableError(`FX snapshot ${snapshot.id} is stale or invalid (age ${age}ms)`);
  }
}

/** Build a typed rate object for one currency pair from a validated snapshot. */
export function rateFromSnapshot(snapshot: FxRateSnapshot, from: string, to: string) {
  if (from !== snapshot.base || !isSupportedCurrency(to)) {
    throw new FxRateUnavailableError(`FX snapshot cannot price ${from}->${to}`);
  }
  const value = snapshot.rates[to.toUpperCase()];
  if (!value) throw new FxRateUnavailableError(`No FX rate for ${to} in snapshot ${snapshot.id}`);
  return {
    value,
    from,
    to: to.toUpperCase(),
    source: snapshot.source,
    observedAt: snapshot.observedAt,
    snapshotId: snapshot.id,
  };
}

/** Deterministic, offline source for isolated tests and CI. Never used for real charges. */
export class StaticFxRateSource implements FxRateSource {
  readonly name: string;
  readonly base: string;
  readonly endpoint = 'static://test';
  constructor(
    private readonly rates: Readonly<Record<string, string>>,
    private readonly observedAt: string,
    name = 'static-test-feed',
    base = BASE_CURRENCY
  ) { this.name = name; this.base = base; }
  async fetchRates() { return { observedAt: this.observedAt, rates: Object.entries(this.rates).map(([currency, value]) => ({ currency, value })) }; }
}

/** Documented HTTP source shapes. These are NOT activated; no credentials or requests exist here. */
export const DOCUMENTED_FX_ENDPOINTS: Readonly<Record<string, string>> = Object.freeze({
  frankfurter: 'https://api.frankfurter.app/latest?from=USD',
  ecb: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
});
