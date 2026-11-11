/**
 * Signal loading — the ONLY place in Fraud Sentinel that reads the platform's operational tables.
 *
 * It does two things and nothing else:
 *   1. loads a subject's detection events from the module's own ledger, and
 *   2. loads a small set of scalar FACTS that cannot be derived from the ledger because they are
 *      present-tense questions about live rows (account age, current unpaid orders, the customer's
 *      own median successful payment, previously-seen countries and client families).
 *
 * Every query here is a SELECT with bound parameters against an existing table. There is no INSERT,
 * UPDATE or DELETE in this file, and no import of any payment gateway, billing service or WHMCS
 * client — which is what makes the module's "advisory only" boundary a structural property rather
 * than a promise. tests/integration/fraud-sentinel-detection.test.ts asserts both facts.
 */
import type { Queryable } from '../../db/types';
import { MS_PER_DAY, MS_PER_HOUR, deriveSignals, type SignalBundle, type SignalEvent, type SubjectFacts } from '../rules/signals';
import type { FraudCategory, FraudEventRow } from '../types';
import { listBaselineFacts, listEventsForSubject, oldestLedgerEvent, type SubjectKey } from './events-repo';

/**
 * Tables this module reads for PRESENT-TENSE facts rather than for events.
 *
 * Exported so the rule catalogue's declared `dataSources` can be checked against what is actually
 * queried: a rule may only name a table some part of this module really reads.
 */
export const FACT_SOURCE_TABLES: readonly string[] = ['users', 'orders', 'payments'];

/* -------------------------------------------------------------------------- */
/* Row → signal event                                                          */
/* -------------------------------------------------------------------------- */

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

/**
 * Normalizes a stored timestamp to an ISO string.
 *
 * `FraudEventRow.occurred_at` is typed as a string, but pg returns a Date for `timestamptz` unless the
 * type parser is configured otherwise — so at runtime this value can be either. The runtime check is
 * written against Date explicitly (an `instanceof` on a string-typed value is a compile error, and
 * silently stringifying a Date would produce the same text only by luck of the default format).
 */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Converts a stored ledger row into the pure signal shape the rules consume. */
export function toSignalEvent(row: FraudEventRow): SignalEvent {
  const evidence = (row.evidence && typeof row.evidence === 'object' ? row.evidence : {}) as Record<string, unknown>;
  return {
    id: row.id,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    kind: row.source_event_type,
    category: row.category,
    customerId: row.customer_id,
    actorId: row.actor_id,
    orderId: row.order_id,
    invoiceId: row.invoice_id,
    paymentId: row.payment_id,
    serviceId: row.service_id,
    ipAddress: row.ip_address,
    ipCountryCode: row.ip_country_code,
    clientFamily: row.client_family,
    amount: toNumber(row.amount),
    currency: row.currency,
    channel: row.channel,
    occurredAt: toIso(row.occurred_at),
    evidence,
  };
}

/* -------------------------------------------------------------------------- */
/* Facts                                                                       */
/* -------------------------------------------------------------------------- */

interface AccountRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  status: string;
  created_at: string | Date | null;
  customer_id: string | null;
}

/** Account facts for a customer/actor subject. Null for ip/gateway subjects, which have no account. */
async function loadAccount(db: Queryable, subject: SubjectKey): Promise<AccountRow | null> {
  if (subject.subjectType !== 'customer' && subject.subjectType !== 'actor') return null;
  const { rows } = await db.query<AccountRow>(
    `SELECT id, email, full_name, role, status, created_at, customer_id
     FROM users WHERE id = $1::uuid`,
    [subject.subjectId]
  );
  return rows[0] ?? null;
}

interface MedianRow {
  n: number;
  median: string | number | null;
  currencies: number;
  latest_currency: string | null;
}

/**
 * The customer's own median successful payment, computed from the live `payments` table before the
 * assessment window. Per-customer comparison is the point: an amount that is ordinary for an
 * enterprise account is extraordinary for a $5/month one, and only the customer's own history can say
 * which is which.
 */
async function loadPaymentBaseline(db: Queryable, subject: SubjectKey, beforeIso: string): Promise<MedianRow | null> {
  if (subject.subjectType !== 'customer') return null;
  const { rows } = await db.query<MedianRow>(
    `SELECT count(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS median,
            count(DISTINCT currency)::int AS currencies,
            (array_agg(currency ORDER BY created_at DESC))[1] AS latest_currency
     FROM payments
     WHERE user_id = $1::uuid AND status = 'successful' AND created_at < $2::timestamptz`,
    [subject.subjectId, beforeIso]
  );
  return rows[0] ?? null;
}

interface UnpaidRow {
  n: number;
  total: string | number | null;
}

/** Current unpaid/failed orders, read live — see SubjectFacts.unpaidOrders for why not the ledger. */
async function loadUnpaidOrders(
  db: Queryable,
  subject: SubjectKey,
  sinceIso: string,
  windowDays: number
): Promise<{ count: number; totalAmount: number; windowDays: number } | null> {
  if (subject.subjectType !== 'customer') return null;
  const { rows } = await db.query<UnpaidRow>(
    `SELECT count(*)::int AS n, coalesce(sum(total_amount), 0) AS total
     FROM orders
     WHERE user_id = $1::uuid
       AND payment_status IN ('unpaid', 'failed')
       AND created_at >= $2::timestamptz`,
    [subject.subjectId, sinceIso]
  );
  const row = rows[0];
  return {
    count: row?.n ?? 0,
    totalAmount: toNumber(row?.total) ?? 0,
    windowDays,
  };
}

/* -------------------------------------------------------------------------- */
/* Bundle                                                                      */
/* -------------------------------------------------------------------------- */

export interface BuildBundleOptions {
  evaluatedAt: Date;
  lookbackDays: number;
  eventBatchLimit: number;
}

/**
 * Loads a subject's events and facts and derives the pure SignalBundle the rules evaluate against.
 *
 * Data-quality gaps are recorded rather than papered over: a truncated event batch, a window cut short
 * by retention, no login baseline, no payment history, mixed currencies and unavailable GeoIP all
 * surface on the assessment as flags, so a thin assessment never looks as solid as a well-evidenced
 * one.
 */
export async function buildSignalBundle(
  db: Queryable,
  subject: SubjectKey,
  options: BuildBundleOptions
): Promise<SignalBundle> {
  const evaluatedAt = options.evaluatedAt;
  const lookbackMs = Math.max(1, options.lookbackDays) * MS_PER_DAY;
  const windowStart = new Date(evaluatedAt.getTime() - lookbackMs);

  const { events: rows, limitReached } = await listEventsForSubject(db, subject, {
    since: windowStart,
    until: evaluatedAt,
    limit: options.eventBatchLimit,
  });
  const events = rows.map(toSignalEvent);

  const isUserSubject = subject.subjectType === 'customer' || subject.subjectType === 'actor';
  const account = await loadAccount(db, subject);
  const baseline = isUserSubject
    ? await listBaselineFacts(db, subject, windowStart.toISOString())
    : { loginCount: 0, countries: [], clientFamilies: [], firstLoginAt: null, lastLoginAt: null };
  const paymentBaseline = await loadPaymentBaseline(db, subject, windowStart.toISOString());
  const unpaidOrders = await loadUnpaidOrders(db, subject, windowStart.toISOString(), options.lookbackDays);
  const oldest = await oldestLedgerEvent(db);

  const accountCreatedAt = account?.created_at
    ? account.created_at instanceof Date
      ? account.created_at
      : new Date(String(account.created_at))
    : null;
  const ageHoursAtEvaluation =
    accountCreatedAt && Number.isFinite(accountCreatedAt.getTime())
      ? (evaluatedAt.getTime() - accountCreatedAt.getTime()) / MS_PER_HOUR
      : null;

  const loginEvents = events.filter((event) => event.kind === 'login_success');
  const geoAvailable = loginEvents.some((event) => event.ipCountryCode !== null);

  const baselineSpanDays =
    baseline.firstLoginAt && baseline.lastLoginAt
      ? Math.max(
          1,
          Math.round(
            (new Date(baseline.lastLoginAt).getTime() - new Date(baseline.firstLoginAt).getTime()) / MS_PER_DAY
          )
        )
      : null;

  const facts: SubjectFacts = {
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    // An actor subject IS a user; an ip/gateway subject has no customer of its own.
    customerId: subject.subjectType === 'customer' ? subject.subjectId : (account?.id ?? null),
    evaluatedAt: evaluatedAt.toISOString(),
    account: account
      ? {
          id: account.id,
          email: account.email,
          fullName: account.full_name,
          role: account.role,
          status: account.status,
          createdAt: accountCreatedAt ? accountCreatedAt.toISOString() : null,
          ageHoursAtEvaluation,
          customerNumber: account.customer_id,
        }
      : null,
    baselineCountries: baseline.countries,
    baselineClientFamilies: baseline.clientFamilies,
    baselineLoginCount: baseline.loginCount,
    baselineSpanDays,
    medianSuccessfulPaymentAmount: toNumber(paymentBaseline?.median ?? null),
    medianCurrency: paymentBaseline?.latest_currency ?? null,
    successfulPaymentHistoryCount: paymentBaseline?.n ?? 0,
    successfulPaymentCurrencyCount: paymentBaseline?.currencies ?? 0,
    unpaidOrders,
    eventBatchLimitReached: limitReached,
    oldestEventInLedger: oldest,
    geoAvailable,
  };

  return deriveSignals({
    events,
    facts,
    window: {
      startedAt: windowStart.toISOString(),
      endedAt: evaluatedAt.toISOString(),
      days: options.lookbackDays,
    },
  });
}

/** Convenience for the investigation screens: one customer's events, already in signal shape. */
export function toSignalEvents(rows: readonly FraudEventRow[]): SignalEvent[] {
  return rows.map(toSignalEvent);
}

/** The four detection categories, re-exported so route schemas do not import from two places. */
export const SIGNAL_CATEGORIES: readonly FraudCategory[] = ['payment', 'account_security', 'order_service', 'admin_api'];
