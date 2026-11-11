/**
 * Signal derivation — a PURE function over recorded events plus a small set of scalar facts.
 *
 * This file performs no I/O and reads no clock: the evaluation instant and the lookback window are
 * arguments. Everything a rule needs is either
 *   (a) an event from `fraud_sentinel_events` — itself a redacted projection of a real row in
 *       payments / invoices / orders / billing_ledger / auth_audit_log / audit_logs / webhook_events /
 *       customer_services / provisioning_jobs / admin_support_sessions / tool_abuse_events, or
 *   (b) a scalar fact read from those same tables by repositories/signals-repo.ts (account age,
 *       median payment, previously-seen countries and client families).
 *
 * Nothing here invents a value. Given an empty event list the bundle is empty, every rule evaluates
 * to "not triggered", and the resulting score is 0 / low — never a fabricated finding.
 *
 * The temporal logic (windows, thresholds) lives in the RULES, not here. This file only organises
 * events into the window-independent structures rules need, so a rule can apply its own configured
 * window without a second pass over the database.
 */
import type { DataQualityFlag, EvidenceRef, FraudCategory, SubjectType } from '../types';

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** One detection event, as loaded from fraud_sentinel_events. */
export interface SignalEvent {
  id: string;
  sourceTable: string;
  sourceId: string;
  /** The normalized event vocabulary — see EVENT_KINDS below and the ingestion mapping. */
  kind: string;
  category: FraudCategory;
  customerId: string | null;
  actorId: string | null;
  orderId: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  serviceId: string | null;
  ipAddress: string | null;
  ipCountryCode: string | null;
  clientFamily: string | null;
  amount: number | null;
  currency: string | null;
  /** Non-uuid label carried by the event: payment provider, webhook gateway, tool slug or the
   * `audit_logs.resource_type` of a sensitive configuration change. NULL where the source has none. */
  channel: string | null;
  occurredAt: string;
  evidence: Record<string, unknown>;
}

/** Scalar facts read from the source tables. Every field is nullable because a thin subject is a
 * legitimate state that must be reported, not guessed around. */
export interface SubjectFacts {
  subjectType: SubjectType;
  /** The uuid of the subject (customer/actor) or the literal string subject for ip/gateway. */
  subjectId: string | null;
  customerId: string | null;
  evaluatedAt: string;
  account: {
    id: string;
    email: string | null;
    fullName: string | null;
    role: string;
    status: string;
    createdAt: string | null;
    ageHoursAtEvaluation: number | null;
    customerNumber: string | null;
  } | null;
  /** Distinct countries resolved from this subject's login_success rows BEFORE the window. */
  baselineCountries: string[];
  /** Distinct client families seen BEFORE the window. */
  baselineClientFamilies: string[];
  /** login_success count before the window — 0 means baselines cannot be trusted. */
  baselineLoginCount: number;
  /** Days spanned by the baseline; null when there is no baseline. */
  baselineSpanDays: number | null;
  /** Median amount of the subject's successful payments before the window; null when too thin. */
  medianSuccessfulPaymentAmount: number | null;
  medianCurrency: string | null;
  successfulPaymentHistoryCount: number;
  /** Distinct currencies across the successful-payment history. >1 makes a single median misleading. */
  successfulPaymentCurrencyCount: number;
  /**
   * CURRENT state read live from `orders`, because "how many orders are still unpaid right now" is
   * a present-tense question the event ledger cannot answer: a ledger event carries the order's state
   * at ingestion time and would go stale. Null for non-customer subjects.
   */
  unpaidOrders: { count: number; totalAmount: number; windowDays: number } | null;
  /** True when the event query hit its LIMIT, so counts are lower bounds. */
  eventBatchLimitReached: boolean;
  /** Oldest row currently in the event ledger; used to report retention truncation honestly. */
  oldestEventInLedger: string | null;
  /** True when the platform's GeoIP lookup produced at least one country for this subject. */
  geoAvailable: boolean;
}

export interface SignalWindow {
  startedAt: string;
  endedAt: string;
  days: number;
}

/* -------------------------------------------------------------------------- */
/* Event vocabulary                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The normalized `kind` values ingestion writes into fraud_sentinel_events.source_event_type.
 *
 * For `auth_audit_log` the kind IS the source row's own `event_type` verbatim (the 46-value CHECK
 * constraint vocabulary from migrations 0002/0013/0022/0024/0025/0059/0060/0061/0085) — never
 * renamed, so evidence stays traceable to the row. For every other table the kind is
 * `<entity>_<observable state>`, listed explicitly here so a rule can never match a value that
 * ingestion does not produce.
 */
export const EVENT_KINDS = {
  /* payments.status, verbatim, prefixed */
  paymentPending: 'payment_pending',
  paymentSuccessful: 'payment_successful',
  paymentFailed: 'payment_failed',
  paymentCancelled: 'payment_cancelled',
  paymentExpired: 'payment_expired',
  paymentRefunded: 'payment_refunded',
  paymentPartiallyRefunded: 'payment_partially_refunded',
  /* invoices.status, verbatim, prefixed */
  invoiceUnpaid: 'invoice_unpaid',
  invoicePaid: 'invoice_paid',
  invoiceVoid: 'invoice_void',
  invoiceRefunded: 'invoice_refunded',
  invoicePartiallyRefunded: 'invoice_partially_refunded',
  /* billing_ledger.entry_type, verbatim, prefixed */
  ledgerCharge: 'ledger_charge',
  ledgerPayment: 'ledger_payment',
  ledgerRefund: 'ledger_refund',
  ledgerCredit: 'ledger_credit',
  /* orders — one event per observable state */
  orderCreated: 'order_created',
  /* customer_services.status */
  serviceActive: 'service_active',
  serviceSuspended: 'service_suspended',
  serviceCancelled: 'service_cancelled',
  servicePendingMigration: 'service_pending_migration',
  /* provisioning_jobs.operation, prefixed */
  provisioningJob: 'provisioning_job',
  /* admin_support_sessions */
  supportSessionStarted: 'support_session_started',
  /* tool_abuse_events */
  toolAbuse: 'tool_abuse',
  /* audit_logs — one kind, with action/resource_type carried in evidence */
  adminAction: 'admin_action',
  /* webhook_events.status, prefixed */
  webhookProcessing: 'webhook_processing',
  webhookCompleted: 'webhook_completed',
  webhookFailed: 'webhook_failed',
  webhookRejected: 'webhook_rejected',
  webhookIgnored: 'webhook_ignored',
} as const;

/** auth_audit_log event types this module ingests. Verbatim from the table's CHECK constraint. */
export const AUTH_EVENT_TYPES = [
  'register',
  'login_success',
  'login_failure',
  'logout',
  'token_refresh',
  'profile_update',
  'password_change',
  'admin_status_change',
  'admin_role_change',
  'payment_initiated',
  'manual_payment_confirmed',
  'manual_payment_rejected',
  'webhook_payment_succeeded',
  'webhook_payment_failed',
  'admin_invoice_refunded',
  'admin_invoice_cancelled',
  'email_verification_requested',
  'email_verified',
  'password_reset_requested',
  'password_reset_completed',
  'mfa_enrollment_started',
  'mfa_enabled',
  'mfa_disabled',
  'mfa_login_challenge',
  'mfa_login_failure',
  'mfa_recovery_code_used',
  'passkey_enrollment_started',
  'passkey_added',
  'passkey_removed',
  'passkey_renamed',
  'username_changed',
  'security_pin_rotated',
  'security_pin_view_challenge_requested',
  'security_pin_view_challenge_resent',
  'security_pin_view_verification_failed',
  'security_pin_viewed',
  'account_recovery_requested',
  'account_recovery_cancelled',
  'account_recovery_identity_verified',
  'account_recovery_approved',
  'account_recovery_rejected',
] as const;

/* -------------------------------------------------------------------------- */
/* Evidence accessors                                                          */
/* -------------------------------------------------------------------------- */

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Reads a string out of an event's redacted evidence projection. */
export function evidenceString(event: SignalEvent, key: string): string | null {
  return asString(event.evidence[key]);
}

/** Reads a number out of an event's redacted evidence projection. */
export function evidenceNumber(event: SignalEvent, key: string): number | null {
  return asNumber(event.evidence[key]);
}

/** A pointer at the real source row behind an event, with a reviewer-readable description. */
export function evidenceRef(event: SignalEvent, description: string): EvidenceRef {
  return {
    table: event.sourceTable,
    id: event.sourceId,
    description,
    occurredAt: event.occurredAt,
  };
}

export function describeAmount(event: SignalEvent): string {
  if (event.amount === null) return 'an unrecorded amount';
  return `${event.amount.toFixed(2)} ${event.currency ?? '—'}`;
}

/* -------------------------------------------------------------------------- */
/* Time helpers (pure — the instant is always an argument)                     */
/* -------------------------------------------------------------------------- */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export function parseInstant(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Events whose occurredAt is within `windowMs` before `nowMs`, ascending by time. */
export function eventsWithin(events: readonly SignalEvent[], nowMs: number, windowMs: number): SignalEvent[] {
  const from = nowMs - windowMs;
  return events
    .filter((event) => {
      const at = parseInstant(event.occurredAt);
      return at !== null && at >= from && at <= nowMs;
    })
    .sort((a, b) => (parseInstant(a.occurredAt) ?? 0) - (parseInstant(b.occurredAt) ?? 0));
}

export function windowMs(parts: { days?: number; hours?: number; minutes?: number }): number {
  return (
    (parts.days ?? 0) * MS_PER_DAY + (parts.hours ?? 0) * MS_PER_HOUR + (parts.minutes ?? 0) * MS_PER_MINUTE
  );
}

/** Deterministic dedupe of evidence references, preserving first-seen order. */
/**
 * Collapses evidence to one entry per ROW.
 *
 * Two rules that fire on the same payments row describe it in different words; keeping both would
 * make the evidence list look like two facts where there is one, and would inflate the distinct-row
 * count `deriveConfidence` uses. So when a ref points at a real row (non-null id) the identity is
 * `table|id` and the FIRST description wins — which is the highest-credited rule's, because callers
 * pass evaluations in credited-weight order. Refs with no id (the "N further rows omitted" notes
 * `capEvidence` appends) keep their description in the key, since they are prose rather than a row.
 */
export function dedupeEvidence(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = ref.id === null || ref.id === undefined
      ? `${ref.table}||${ref.description}`
      : `${ref.table}|${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/** Caps an evidence list for storage, keeping the most recent rows and saying how many were dropped. */
export function capEvidence(refs: readonly EvidenceRef[], limit: number): EvidenceRef[] {
  if (refs.length <= limit) return [...refs];
  const sorted = [...refs].sort(
    (a, b) => (parseInstant(b.occurredAt) ?? 0) - (parseInstant(a.occurredAt) ?? 0)
  );
  const kept = sorted.slice(0, limit);
  kept.push({
    table: refs[0]?.table ?? 'fraud_sentinel_events',
    id: null,
    description: `${refs.length - limit} further matching row(s) exist and were omitted from this evidence list`,
    occurredAt: null,
  });
  return kept;
}

/**
 * First element of a readonly list, or null.
 *
 * This repo compiles with `noUncheckedIndexedAccess`, so `events[0]` is `T | undefined` even after a
 * length check the compiler cannot see through a `.filter()`. Detectors read these helpers and guard
 * the result rather than casting: a detector that threw on an empty window would take the whole scan
 * pass down with it, and a cast would hide exactly the case worth handling.
 */
export function firstOf<T>(events: readonly T[]): T | null {
  return events[0] ?? null;
}

/** Last element of a readonly list, or null. See `firstOf` for why this exists. */
export function lastOf<T>(events: readonly T[]): T | null {
  return events.length === 0 ? null : (events[events.length - 1] ?? null);
}

export function distinctValues<T>(events: readonly SignalEvent[], pick: (event: SignalEvent) => T | null): T[] {
  const out: T[] = [];
  const seen = new Set<unknown>();
  for (const event of events) {
    const value = pick(event);
    if (value === null || value === undefined) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Groupings                                                                   */
/* -------------------------------------------------------------------------- */

export interface PaymentAttemptGroup {
  key: string;
  invoiceId: string | null;
  amount: number | null;
  currency: string | null;
  provider: string | null;
  events: SignalEvent[];
}

export interface PaymentMethodGroup {
  key: string;
  provider: string | null;
  method: string | null;
  events: SignalEvent[];
}

export interface OrderItemGroup {
  key: string;
  productName: string;
  planName: string;
  billingPeriod: string;
  events: SignalEvent[];
}

export interface WebhookPayloadGroup {
  key: string;
  gateway: string | null;
  payloadHash: string | null;
  events: SignalEvent[];
}

export interface SupportSessionGroup {
  key: string;
  targetCustomerId: string | null;
  events: SignalEvent[];
}

export interface RefundPair {
  refund: SignalEvent;
  /** The most recent successful payment before the refund for the same invoice (or same customer). */
  payment: SignalEvent | null;
  daysBetween: number | null;
}

export interface UnfamiliarLogin {
  event: SignalEvent;
  newGeo: boolean;
  newDevice: boolean;
  country: string | null;
  clientFamily: string | null;
}

export interface PaymentMismatch {
  payment: SignalEvent;
  invoiceTotal: number | null;
  invoiceCurrency: string | null;
  orderCurrency: string | null;
  amountDelta: number | null;
  currencyMismatch: boolean;
}

/* -------------------------------------------------------------------------- */
/* The bundle                                                                  */
/* -------------------------------------------------------------------------- */

export interface SignalBundle {
  subjectType: SubjectType;
  subjectId: string | null;
  customerId: string | null;
  evaluatedAt: string;
  window: SignalWindow;
  facts: SubjectFacts;
  /** Every event examined, ascending by time. Bounded by fraud_sentinel.event_batch_limit. */
  events: SignalEvent[];
  /** Events indexed by kind, ascending by time. The primary structure rules read. */
  byKind: ReadonlyMap<string, SignalEvent[]>;
  paymentAttempts: PaymentAttemptGroup[];
  paymentMethods: PaymentMethodGroup[];
  paymentMismatches: PaymentMismatch[];
  orderItems: OrderItemGroup[];
  webhookPayloads: WebhookPayloadGroup[];
  supportSessions: SupportSessionGroup[];
  refundPairs: RefundPair[];
  unfamiliarLogins: UnfamiliarLogin[];
  dataQuality: DataQualityFlag[];
}

function groupBy<T extends { key: string }>(
  events: readonly SignalEvent[],
  keyOf: (event: SignalEvent) => string | null,
  build: (key: string, events: SignalEvent[]) => T
): T[] {
  const map = new Map<string, SignalEvent[]>();
  for (const event of events) {
    const key = keyOf(event);
    if (key === null) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(event);
    else map.set(key, [event]);
  }
  return [...map.entries()]
    .map(([key, bucket]) =>
      build(
        key,
        bucket.sort((a, b) => (parseInstant(a.occurredAt) ?? 0) - (parseInstant(b.occurredAt) ?? 0))
      )
    )
    // Deterministic ordering for a deterministic assessment.
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const PAYMENT_ATTEMPT_KINDS = new Set<string>([
  EVENT_KINDS.paymentPending,
  EVENT_KINDS.paymentSuccessful,
  EVENT_KINDS.paymentFailed,
  EVENT_KINDS.paymentCancelled,
  EVENT_KINDS.paymentExpired,
  EVENT_KINDS.paymentRefunded,
  EVENT_KINDS.paymentPartiallyRefunded,
]);

const REFUND_KINDS = new Set<string>([
  EVENT_KINDS.ledgerRefund,
  EVENT_KINDS.ledgerCredit,
  EVENT_KINDS.paymentRefunded,
  EVENT_KINDS.paymentPartiallyRefunded,
  EVENT_KINDS.invoiceRefunded,
  EVENT_KINDS.invoicePartiallyRefunded,
  EVENT_KINDS.invoiceVoid,
]);

/** Great-circle distance in km between two GeoIP city centres. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function coordinate(event: SignalEvent): { lat: number; lon: number } | null {
  const lat = evidenceNumber(event, 'latitude');
  const lon = evidenceNumber(event, 'longitude');
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * Builds the signal bundle. Pure: same events + same facts ⇒ same bundle, byte for byte.
 */
export function deriveSignals(input: {
  events: readonly SignalEvent[];
  facts: SubjectFacts;
  window: SignalWindow;
}): SignalBundle {
  const events = [...input.events].sort(
    (a, b) => (parseInstant(a.occurredAt) ?? 0) - (parseInstant(b.occurredAt) ?? 0)
  );
  const facts = input.facts;

  const byKind = new Map<string, SignalEvent[]>();
  for (const event of events) {
    const bucket = byKind.get(event.kind);
    if (bucket) bucket.push(event);
    else byKind.set(event.kind, [event]);
  }

  const dataQuality: DataQualityFlag[] = [];

  if (facts.eventBatchLimitReached) {
    dataQuality.push({
      code: 'EVENT_BATCH_LIMIT_REACHED',
      severity: 'material',
      detail:
        'The event batch limit was reached for this subject, so every count in this assessment is a LOWER BOUND. ' +
        'Raise fraud_sentinel.event_batch_limit or narrow fraud_sentinel.lookback_days to see the full picture.',
    });
  }

  const windowStartMs = parseInstant(input.window.startedAt);
  const oldestMs = parseInstant(facts.oldestEventInLedger);
  if (windowStartMs !== null && oldestMs !== null && oldestMs > windowStartMs) {
    dataQuality.push({
      code: 'WINDOW_TRUNCATED_BY_RETENTION',
      severity: 'material',
      detail:
        `The requested lookback starts ${input.window.startedAt} but the oldest retained detection event is ` +
        `${facts.oldestEventInLedger}. Older activity has been pruned by the retention policy; counts cover the ` +
        'retained period only. The authoritative rows remain in their own source tables.',
    });
  }

  const loginSuccesses = byKind.get('login_success') ?? [];
  if (facts.baselineLoginCount === 0) {
    dataQuality.push({
      code: 'NO_LOGIN_BASELINE',
      severity: 'material',
      detail:
        'This subject has no login history before the assessment window, so "new country" and "new device" ' +
        'comparisons have nothing to compare against and those rules cannot fire. The account may be new, or its ' +
        'history may predate the detection ledger.',
    });
  }
  if (loginSuccesses.some((event) => event.ipAddress && !event.ipCountryCode)) {
    dataQuality.push({
      code: 'GEO_UNAVAILABLE',
      severity: 'informational',
      detail:
        'At least one login IP could not be resolved to a country by the platform GeoIP database, so geography-based ' +
        'rules saw less than the full set of logins. Absence of a geo finding is not evidence of absence.',
    });
  }
  if (facts.successfulPaymentCurrencyCount > 1) {
    dataQuality.push({
      code: 'MIXED_PAYMENT_CURRENCIES',
      severity: 'material',
      detail:
        `This subject has successful payments in ${facts.successfulPaymentCurrencyCount} different currencies, so a single median amount ` +
        'compares unlike with unlike. Unusual-value detection on this subject is indicative only; convert to one reporting currency before drawing a conclusion.',
    });
  }
  if (facts.medianSuccessfulPaymentAmount === null) {
    dataQuality.push({
      code: 'NO_PAYMENT_HISTORY',
      severity: 'informational',
      detail:
        'There is not enough successful-payment history to compute a per-customer median, so unusual-value detection ' +
        'falls back to the absolute configured floor. A large first order is therefore weaker evidence than a large ' +
        'order from an established customer.',
    });
  }

  /* ---- payment attempt groups (duplicate detection) -------------------------------- */
  const paymentAttempts = groupBy<PaymentAttemptGroup>(
    events.filter((event) => PAYMENT_ATTEMPT_KINDS.has(event.kind)),
    (event) => {
      // A group needs an invoice to be meaningful; amount and provider may legitimately be null.
      if (!event.invoiceId) return null;
      const provider = evidenceString(event, 'provider') ?? 'unknown';
      const amount = event.amount === null ? 'null' : event.amount.toFixed(2);
      return `inv:${event.invoiceId}|amt:${amount}|cur:${event.currency ?? 'null'}|prov:${provider}`;
    },
    (key, bucket) => ({
      key,
      invoiceId: bucket[0]?.invoiceId ?? null,
      amount: bucket[0]?.amount ?? null,
      currency: bucket[0]?.currency ?? null,
      provider: evidenceString(bucket[0] as SignalEvent, 'provider'),
      events: bucket,
    })
  );

  /* ---- distinct (provider, method) pairs ------------------------------------------- */
  const paymentMethods = groupBy<PaymentMethodGroup>(
    events.filter((event) => PAYMENT_ATTEMPT_KINDS.has(event.kind)),
    (event) => {
      const provider = evidenceString(event, 'provider');
      const method = evidenceString(event, 'method');
      if (!provider && !method) return null;
      return `${provider ?? 'unknown'}|${method ?? 'unknown'}`;
    },
    (key, bucket) => ({
      key,
      provider: evidenceString(bucket[0] as SignalEvent, 'provider'),
      method: evidenceString(bucket[0] as SignalEvent, 'method'),
      events: bucket,
    })
  );

  /* ---- payment amount / currency consistency --------------------------------------- */
  const SETTLED_PAYMENT_KINDS = new Set<string>([
    EVENT_KINDS.paymentSuccessful,
    EVENT_KINDS.paymentPartiallyRefunded,
    EVENT_KINDS.paymentRefunded,
  ]);
  const paymentMismatches: PaymentMismatch[] = [];
  for (const event of events.filter((candidate) => SETTLED_PAYMENT_KINDS.has(candidate.kind))) {
    const invoiceTotal = evidenceNumber(event, 'invoiceTotal');
    const invoiceCurrency = evidenceString(event, 'invoiceCurrency');
    const orderCurrency = evidenceString(event, 'orderCurrency');
    const amountDelta =
      event.amount !== null && invoiceTotal !== null ? Math.round((event.amount - invoiceTotal) * 100) / 100 : null;
    const currencyMismatch =
      (invoiceCurrency !== null && event.currency !== null && invoiceCurrency !== event.currency) ||
      (orderCurrency !== null && invoiceCurrency !== null && orderCurrency !== invoiceCurrency);
    if ((amountDelta !== null && amountDelta !== 0) || currencyMismatch) {
      paymentMismatches.push({ payment: event, invoiceTotal, invoiceCurrency, orderCurrency, amountDelta, currencyMismatch });
    }
  }

  /* ---- repeated identical order lines ---------------------------------------------- */
  const orderItems = groupBy<OrderItemGroup>(
    byKind.get(EVENT_KINDS.orderCreated) ?? [],
    (event) => {
      const items = asArray(event.evidence.items);
      if (items.length === 0) return null;
      // One key per distinct (product, plan, period) line the order contains.
      const first = items[0] as Record<string, unknown>;
      const productName = asString(first.productName) ?? 'unknown product';
      const planName = asString(first.planName) ?? 'unknown plan';
      const billingPeriod = asString(first.billingPeriod) ?? 'unknown period';
      return `${productName}|${planName}|${billingPeriod}`;
    },
    (key, bucket) => {
      const first = asArray(bucket[0]?.evidence.items)[0] as Record<string, unknown> | undefined;
      return {
        key,
        productName: asString(first?.productName) ?? 'unknown product',
        planName: asString(first?.planName) ?? 'unknown plan',
        billingPeriod: asString(first?.billingPeriod) ?? 'unknown period',
        events: bucket,
      };
    }
  );

  /* ---- webhook payload replays ------------------------------------------------------ */
  const webhookPayloads = groupBy<WebhookPayloadGroup>(
    events.filter((event) => event.sourceTable === 'webhook_events'),
    (event) => {
      const hash = evidenceString(event, 'payloadHash');
      const gateway = evidenceString(event, 'gateway');
      if (!hash || !gateway) return null;
      return `${gateway}|${hash}`;
    },
    (key, bucket) => ({
      key,
      gateway: evidenceString(bucket[0] as SignalEvent, 'gateway'),
      payloadHash: evidenceString(bucket[0] as SignalEvent, 'payloadHash'),
      events: bucket,
    })
  );

  /* ---- delegated support session fan-out -------------------------------------------- */
  const supportSessions = groupBy<SupportSessionGroup>(
    byKind.get(EVENT_KINDS.supportSessionStarted) ?? [],
    (event) => asString(event.evidence.targetCustomerId) ?? null,
    (key, bucket) => ({ key, targetCustomerId: key, events: bucket })
  );

  /* ---- refund → preceding payment pairing ------------------------------------------- */
  const refundPairs: RefundPair[] = [];
  const successfulPayments = byKind.get(EVENT_KINDS.paymentSuccessful) ?? [];
  for (const refund of events.filter((event) => REFUND_KINDS.has(event.kind))) {
    const refundMs = parseInstant(refund.occurredAt);
    if (refundMs === null) continue;
    let best: SignalEvent | null = null;
    let bestMs = -Infinity;
    for (const payment of successfulPayments) {
      const paymentMs = parseInstant(payment.occurredAt);
      if (paymentMs === null || paymentMs > refundMs) continue;
      // Prefer the same invoice; otherwise the same customer's most recent successful payment.
      if (refund.invoiceId && payment.invoiceId && refund.invoiceId !== payment.invoiceId) continue;
      if (paymentMs > bestMs) {
        best = payment;
        bestMs = paymentMs;
      }
    }
    refundPairs.push({
      refund,
      payment: best,
      daysBetween: best && bestMs > -Infinity ? (refundMs - bestMs) / MS_PER_DAY : null,
    });
  }

  /* ---- unfamiliar logins (needs the baseline facts) ---------------------------------- */
  const baselineCountries = new Set(facts.baselineCountries.map((code) => code.toUpperCase()));
  const baselineFamilies = new Set(facts.baselineClientFamilies);
  const unfamiliarLogins: UnfamiliarLogin[] = [];
  for (const event of loginSuccesses) {
    const country = event.ipCountryCode ? event.ipCountryCode.toUpperCase() : null;
    const newGeo = country !== null && facts.baselineLoginCount > 0 && !baselineCountries.has(country);
    const newDevice =
      event.clientFamily !== null && facts.baselineLoginCount > 0 && !baselineFamilies.has(event.clientFamily);
    if (newGeo || newDevice) {
      unfamiliarLogins.push({ event, newGeo, newDevice, country, clientFamily: event.clientFamily });
    }
  }

  return {
    subjectType: facts.subjectType,
    subjectId: facts.subjectId,
    customerId: facts.customerId,
    evaluatedAt: facts.evaluatedAt,
    window: input.window,
    facts,
    events,
    byKind,
    paymentAttempts,
    paymentMethods,
    paymentMismatches,
    orderItems,
    webhookPayloads,
    supportSessions,
    refundPairs,
    unfamiliarLogins,
    dataQuality,
  };
}

/** Convenience: all events of a kind, ascending. */
export function kindEvents(bundle: SignalBundle, kind: string): SignalEvent[] {
  return bundle.byKind.get(kind) ?? [];
}

/** Convenience: all events of several kinds, ascending. */
export function kindsEvents(bundle: SignalBundle, kinds: readonly string[]): SignalEvent[] {
  const out: SignalEvent[] = [];
  for (const kind of kinds) out.push(...kindEvents(bundle, kind));
  return out.sort((a, b) => (parseInstant(a.occurredAt) ?? 0) - (parseInstant(b.occurredAt) ?? 0));
}

/** Coordinates of a login event, when GeoIP resolved them. */
export function loginCoordinate(event: SignalEvent): { lat: number; lon: number } | null {
  return coordinate(event);
}
