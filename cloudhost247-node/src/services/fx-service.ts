/**
 * Display-only currency conversion, fed by the WHMCS currency addon.
 *
 * What this service does:
 *   - pulls the addon's read-only rate feed (the latest successful run, enabled currencies only),
 *   - validates every value before it is stored (shape, currency codes, positive finite rates),
 *   - keeps each run's rates with their observation time in `display_fx_rates`,
 *   - reports the newest run to the site, or reports that no current rates exist.
 *
 * What it never does:
 *   - invent, interpolate or hard-code a rate,
 *   - change a price, cart line, order, charge or invoice amount: billing stays in DEFAULT_CURRENCY,
 *   - accept a currency or rate from a browser or from any request body.
 *
 * When there is no usable snapshot (never synced, feed down, or older than FX_MAX_AGE_HOURS), the
 * status says `available: false` with an empty list, and the frontend falls back to USD only.
 */
import { z } from 'zod';
import { DEFAULT_CURRENCY } from '../config/billing';
import type { Queryable } from '../db/types';

/** Upper bound on currencies in one feed. The addon enables a handful; this stops a runaway feed. */
export const FX_MAX_FEED_RATES = 200;
/** Upper bound on a feed response body in bytes. */
export const FX_MAX_FEED_BYTES = 256 * 1024;
export const FX_DEFAULT_TIMEOUT_MS = 10_000;

export class FxFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxFeedError';
  }
}

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'currency code must be three uppercase letters');

const feedSchema = z.object({
  base: z.literal(DEFAULT_CURRENCY),
  runId: z.number().int().positive().nullable(),
  rates: z
    .array(
      z.object({
        code: currencyCodeSchema,
        rate: z.number().finite().positive(),
        observedAt: z.string().datetime({ offset: true }),
      })
    )
    .max(FX_MAX_FEED_RATES),
});

export interface FxFeedRate {
  code: string;
  /** Units of `code` that one unit of the base currency buys. */
  rate: number;
  observedAt: Date;
}

export interface FxFeed {
  runId: number | null;
  rates: FxFeedRate[];
}

/** Validates a feed payload. Throws FxFeedError on any unexpected shape, code, rate or duplicate. */
export function parseFxFeed(payload: unknown): FxFeed {
  const parsed = feedSchema.safeParse(payload);
  if (!parsed.success) {
    throw new FxFeedError(`feed is invalid: ${parsed.error.issues[0]?.message ?? 'unexpected shape'}`);
  }
  const seen = new Set<string>();
  const rates: FxFeedRate[] = parsed.data.rates.map((entry) => {
    if (entry.code === DEFAULT_CURRENCY) throw new FxFeedError('feed must not list the base currency');
    if (seen.has(entry.code)) throw new FxFeedError(`feed lists ${entry.code} more than once`);
    seen.add(entry.code);
    return { code: entry.code, rate: entry.rate, observedAt: new Date(entry.observedAt) };
  });
  if (parsed.data.runId === null && rates.length > 0) {
    throw new FxFeedError('feed has rates but no run id');
  }
  return { runId: parsed.data.runId, rates };
}

export interface SyncOptions {
  url: string;
  token: string;
  /** Required in production. Tests may pass plain http. */
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type FxSyncResult =
  | { status: 'stored'; runId: number; count: number }
  | { status: 'unchanged'; runId: number }
  | { status: 'empty' };

/**
 * Fetches the feed once and stores it if its run is new. Idempotent: a run already stored is reported
 * as `unchanged`, and a concurrent insert of the same run is treated the same way.
 */
export async function syncDisplayRates(db: Queryable, options: SyncOptions): Promise<FxSyncResult> {
  const target = new URL(options.url);
  if (target.protocol !== 'https:' && !options.allowInsecureHttp) {
    throw new FxFeedError('FX_FEED_URL must use https');
  }

  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(target.toString(), {
    method: 'GET',
    redirect: 'error',
    headers: { Accept: 'application/json', Authorization: `Bearer ${options.token}` },
    signal: AbortSignal.timeout(options.timeoutMs ?? FX_DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new FxFeedError(`feed responded with HTTP ${response.status}`);

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > FX_MAX_FEED_BYTES) throw new FxFeedError('feed response is too large');

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new FxFeedError('feed is not valid JSON');
  }
  const feed = parseFxFeed(payload);
  if (feed.runId === null) return { status: 'empty' };

  const existing = await db.query<{ present: number }>(
    'SELECT 1 AS present FROM display_fx_rates WHERE source_run_id = $1 LIMIT 1',
    [feed.runId]
  );
  if (existing.rows.length > 0) return { status: 'unchanged', runId: feed.runId };

  try {
    // One statement: every rate of the run is stored, or none is.
    await db.query(
      `INSERT INTO display_fx_rates (source_run_id, base_currency, currency_code, rate, observed_at)
       SELECT $1::bigint, $2::char(3), t.code, t.rate, t.observed
       FROM unnest($3::char(3)[], $4::numeric[], $5::timestamptz[]) AS t(code, rate, observed)`,
      [
        feed.runId,
        DEFAULT_CURRENCY,
        feed.rates.map((r) => r.code),
        feed.rates.map((r) => String(r.rate)),
        feed.rates.map((r) => r.observedAt.toISOString()),
      ]
    );
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'unchanged', runId: feed.runId };
    throw error;
  }
  return { status: 'stored', runId: feed.runId, count: feed.rates.length };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

export interface FxSnapshotRate {
  code: string;
  rate: number;
  observedAt: Date;
}

export interface FxSnapshot {
  runId: number;
  /** Newest observation time among the run's rates. */
  observedAt: Date;
  fetchedAt: Date;
  rates: FxSnapshotRate[];
}

/** Returns the newest stored run (by observation time), or null when nothing has been synced. */
export async function loadLatestDisplaySnapshot(db: Queryable): Promise<FxSnapshot | null> {
  const latest = await db.query<{ source_run_id: string; observed_at: Date; fetched_at: Date }>(
    `SELECT source_run_id, MAX(observed_at) AS observed_at, MAX(fetched_at) AS fetched_at
     FROM display_fx_rates
     GROUP BY source_run_id
     ORDER BY MAX(observed_at) DESC, source_run_id DESC
     LIMIT 1`
  );
  const head = latest.rows[0];
  if (!head) return null;

  const rows = await db.query<{ currency_code: string; rate: string; observed_at: Date }>(
    'SELECT currency_code, rate, observed_at FROM display_fx_rates WHERE source_run_id = $1 ORDER BY currency_code',
    [head.source_run_id]
  );
  return {
    runId: Number(head.source_run_id),
    observedAt: new Date(head.observed_at),
    fetchedAt: new Date(head.fetched_at),
    rates: rows.rows.map((row) => ({
      code: row.currency_code.trim(),
      rate: Number(row.rate),
      observedAt: new Date(row.observed_at),
    })),
  };
}

export interface DisplayCurrencyStatus {
  base: typeof DEFAULT_CURRENCY;
  /** False when no current rates may be offered. The site then shows only the base currency. */
  available: boolean;
  /** Why rates are not offered, when `available` is false. */
  reason: 'not_synced' | 'stale' | null;
  /** When the newest rate was observed (ISO-8601), or null. */
  asOf: string | null;
  fetchedAt: string | null;
  currencies: Array<{ code: string; rate: number; observedAt: string }>;
}

/**
 * Turns the latest snapshot into the public status. A snapshot older than `maxAgeMs` is withheld
 * entirely, so a stale rate is never shown as current.
 */
export function buildDisplayCurrencyStatus(
  snapshot: FxSnapshot | null,
  now: Date,
  maxAgeMs: number
): DisplayCurrencyStatus {
  if (!snapshot || snapshot.rates.length === 0) {
    return { base: DEFAULT_CURRENCY, available: false, reason: 'not_synced', asOf: null, fetchedAt: null, currencies: [] };
  }
  if (now.getTime() - snapshot.observedAt.getTime() > maxAgeMs) {
    return {
      base: DEFAULT_CURRENCY,
      available: false,
      reason: 'stale',
      asOf: snapshot.observedAt.toISOString(),
      fetchedAt: snapshot.fetchedAt.toISOString(),
      currencies: [],
    };
  }
  return {
    base: DEFAULT_CURRENCY,
    available: true,
    reason: null,
    asOf: snapshot.observedAt.toISOString(),
    fetchedAt: snapshot.fetchedAt.toISOString(),
    currencies: snapshot.rates
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((r) => ({ code: r.code, rate: r.rate, observedAt: r.observedAt.toISOString() })),
  };
}
