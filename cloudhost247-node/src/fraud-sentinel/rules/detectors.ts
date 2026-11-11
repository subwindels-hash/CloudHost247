/**
 * Detection rule evaluators — one pure function per rule code.
 *
 * Contract, enforced by tests/unit/fraud-sentinel-rules.test.ts:
 *   * No I/O. No `Date.now()`, no database, no network, no randomness. The evaluation instant and
 *     every threshold arrive as arguments, so a detector is reproducible by construction.
 *   * No invention. A detector may only report what is present in the SignalBundle, which is built
 *     exclusively from rows CloudHost247 already recorded. Empty bundle ⇒ no hits.
 *   * Every hit carries a stable `reasonCode`, a human-readable `reason` quoting the real numbers,
 *     and `evidence` pointers at the real rows behind it.
 *   * Every hit states its own `confidence`, derived from how much evidence supports it.
 *
 * A detector returning `null` means "not triggered" — it never means "unknown". Genuine unknowns are
 * reported as data-quality flags (see rules/signals.ts), which is the difference between an honest
 * detector and a confident one.
 */
import type { ConfidenceLevel, DataQualityFlag, EvidenceRef, RiskLevel } from '../types';
import {
  EVENT_KINDS,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  capEvidence,
  dedupeEvidence,
  describeAmount,
  distinctValues,
  eventsWithin,
  evidenceNumber,
  evidenceRef,
  evidenceString,
  firstOf,
  haversineKm,
  kindsEvents,
  lastOf,
  loginCoordinate,
  parseInstant,
  windowMs,
  type SignalBundle,
  type SignalEvent,
} from './signals';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface RuleHit {
  reasonCode: string;
  reason: string;
  confidence: ConfidenceLevel;
  evidence: EvidenceRef[];
  dataQuality?: DataQualityFlag[];
  /** The risk level this single rule would justify on its own — used for alert escalation. */
  severityHint?: RiskLevel;
}

export interface DetectorContext {
  bundle: SignalBundle;
  parameters: Record<string, unknown>;
  /** Evaluation instant in epoch ms. Always an argument — never read from the clock. */
  nowMs: number;
  /** The module lookback (fraud_sentinel.lookback_days). Rule windows are clamped to it. */
  lookbackMs: number;
}

export type Detector = (context: DetectorContext) => RuleHit | null;

/* -------------------------------------------------------------------------- */
/* Parameter + window helpers                                                  */
/* -------------------------------------------------------------------------- */

function num(parameters: Record<string, unknown>, key: string, fallback: number): number {
  const raw = parameters[key];
  const parsed = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decimal(parameters: Record<string, unknown>, key: string, fallback: number): number {
  const raw = parameters[key];
  const parsed = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Resolves a rule's own window, clamped to the module lookback.
 *
 * A rule can never look further back than `fraud_sentinel.lookback_days`, which is what keeps a scan
 * bounded no matter how an administrator tunes an individual rule window.
 */
function resolveWindowMs(context: DetectorContext, parts: { days?: number; hours?: number; minutes?: number }): number {
  return Math.min(windowMs(parts), context.lookbackMs);
}

function withinWindow(context: DetectorContext, events: readonly SignalEvent[], window: number): SignalEvent[] {
  return eventsWithin(events, context.nowMs, window);
}

/** Confidence derived from evidence volume: 1–2 rows is weak, 3–7 is moderate, 8+ is strong. */
function confidenceFor(evidenceCount: number): ConfidenceLevel {
  if (evidenceCount >= 8) return 'high';
  if (evidenceCount >= 3) return 'medium';
  return 'low';
}

const EVIDENCE_LIMIT = 6;

function hit(
  reasonCode: string,
  reason: string,
  evidence: readonly EvidenceRef[],
  extra: { dataQuality?: DataQualityFlag[]; severityHint?: RiskLevel } = {}
): RuleHit {
  const deduped = capEvidence(dedupeEvidence(evidence), EVIDENCE_LIMIT);
  return {
    reasonCode,
    reason,
    confidence: confidenceFor(dedupeEvidence(evidence).length),
    evidence: deduped,
    ...extra,
  };
}

function when(condition: boolean): string {
  return condition ? 's' : '';
}

function formatWindow(ms: number): string {
  if (ms % MS_PER_DAY === 0) return `${ms / MS_PER_DAY} day${when(ms !== MS_PER_DAY)}`;
  if (ms % MS_PER_HOUR === 0) return `${ms / MS_PER_HOUR} hour${when(ms !== MS_PER_HOUR)}`;
  return `${Math.round(ms / MS_PER_MINUTE)} minute${when(ms !== MS_PER_MINUTE)}`;
}

function kindList(bundle: SignalBundle, kinds: readonly string[]): SignalEvent[] {
  return kindsEvents(bundle, kinds);
}

/* -------------------------------------------------------------------------- */
/* Sensitive administrative activity — the documented, actually-used vocabulary */
/* -------------------------------------------------------------------------- */

/**
 * `audit_logs.resource_type` values that this codebase genuinely writes for sensitive
 * configuration. Verified against the real `auditRequest`/`recordAudit` call sites, not guessed:
 * a resource type that no route ever writes would make the rule dead code that looks like coverage.
 */
export const SENSITIVE_RESOURCE_TYPES: readonly string[] = [
  'platform_settings',
  'marketing_integration',
  'domain_service_provider',
  'cloudflare_account',
  'tool_provider',
  'ssh_key',
  'infrastructure_provider',
  'control_panel',
];

/** Action substrings that mark an audit_logs row as a sensitive configuration change. */
export const SENSITIVE_ACTION_PATTERN =
  /credential|secret|configuration_saved|configuration_reset|settings\.updated|policy_updated|force_rotat|reinitial|role|status_change|rotated/i;

function isAdminActionSensitive(event: SignalEvent): boolean {
  if (event.kind !== EVENT_KINDS.adminAction) return false;
  const resourceType = evidenceString(event, 'resourceType') ?? '';
  const action = evidenceString(event, 'action') ?? '';
  return SENSITIVE_RESOURCE_TYPES.includes(resourceType) || SENSITIVE_ACTION_PATTERN.test(action);
}

/* -------------------------------------------------------------------------- */
/* Shared sub-signals used by more than one rule                               */
/* -------------------------------------------------------------------------- */

const LOGIN_FAILURE = 'login_failure';

/** Events of `kinds` inside `windowMinutes` strictly before `atMs`. */
function eventsBefore(bundle: SignalBundle, kinds: readonly string[], atMs: number, windowMinutes: number): SignalEvent[] {
  const from = atMs - windowMinutes * MS_PER_MINUTE;
  return kindList(bundle, kinds).filter((event) => {
    const at = parseInstant(event.occurredAt);
    return at !== null && at >= from && at < atMs;
  });
}

/** login_failure rows inside `windowMinutes` before `atMs`. */
function failuresBefore(bundle: SignalBundle, atMs: number, windowMinutes: number): SignalEvent[] {
  return eventsBefore(bundle, [LOGIN_FAILURE], atMs, windowMinutes);
}

/**
 * payments.status = 'failed' rows inside `windowMinutes` before `atMs`.
 *
 * Kept separate from `failuresBefore` on purpose: "declined card then approved card" is about PAYMENT
 * failures, and counting login failures there would both miss the real pattern and fire on an
 * unrelated one. The distinction is the whole rule.
 */
function paymentFailuresBefore(bundle: SignalBundle, atMs: number, windowMinutes: number): SignalEvent[] {
  return eventsBefore(bundle, [EVENT_KINDS.paymentFailed], atMs, windowMinutes);
}

/** Account-information changes. All three are real auth_audit_log event types. */
const ACCOUNT_CHANGE_KINDS = ['profile_update', 'username_changed', 'password_change'] as const;

/** Second-factor removals/rotations. All three are real auth_audit_log event types. */
const MFA_TAMPER_KINDS = ['mfa_disabled', 'passkey_removed', 'security_pin_rotated'] as const;

/** Recovery-path requests. All real auth_audit_log event types. */
const RECOVERY_REQUEST_KINDS = [
  'password_reset_requested',
  'email_verification_requested',
  'account_recovery_requested',
] as const;

/** Recovery-path completions. All real auth_audit_log event types. */
const RECOVERY_COMPLETION_KINDS = ['password_reset_completed', 'account_recovery_approved'] as const;

/** Step-up verification failures recorded in auth_audit_log. */
const STEP_UP_FAILURE_KINDS = ['mfa_login_failure', 'security_pin_view_verification_failed'] as const;

const REFUND_KINDS = [
  EVENT_KINDS.ledgerRefund,
  EVENT_KINDS.ledgerCredit,
  EVENT_KINDS.paymentRefunded,
  EVENT_KINDS.paymentPartiallyRefunded,
  EVENT_KINDS.invoiceRefunded,
  EVENT_KINDS.invoicePartiallyRefunded,
  EVENT_KINDS.invoiceVoid,
] as const;

const PAYMENT_ATTEMPT_KINDS = [
  EVENT_KINDS.paymentPending,
  EVENT_KINDS.paymentSuccessful,
  EVENT_KINDS.paymentFailed,
  EVENT_KINDS.paymentCancelled,
  EVENT_KINDS.paymentExpired,
  EVENT_KINDS.paymentRefunded,
  EVENT_KINDS.paymentPartiallyRefunded,
] as const;

/** A "new context" login: unfamiliar geography or device, or preceded by repeated failures. */
function suspiciousContextLogins(
  bundle: SignalBundle,
  nowMs: number,
  lookbackMs: number,
  failureWindowMinutes: number,
  minFailures: number
): Array<{ event: SignalEvent; why: string }> {
  const out: Array<{ event: SignalEvent; why: string }> = [];
  const seen = new Set<string>();
  for (const unfamiliar of bundle.unfamiliarLogins) {
    const at = parseInstant(unfamiliar.event.occurredAt);
    if (at === null || at < nowMs - lookbackMs || at > nowMs) continue;
    if (seen.has(unfamiliar.event.id)) continue;
    seen.add(unfamiliar.event.id);
    const why = [unfamiliar.newGeo ? `new country (${unfamiliar.country})` : null, unfamiliar.newDevice ? `new device family (${unfamiliar.clientFamily})` : null]
      .filter(Boolean)
      .join(' and ');
    out.push({ event: unfamiliar.event, why });
  }
  for (const login of eventsWithin(kindList(bundle, ['login_success']), nowMs, lookbackMs)) {
    if (seen.has(login.id)) continue;
    const at = parseInstant(login.occurredAt);
    if (at === null) continue;
    const failures = failuresBefore(bundle, at, failureWindowMinutes);
    if (failures.length >= minFailures) {
      seen.add(login.id);
      out.push({ event: login, why: `${failures.length} failed login(s) in the preceding ${failureWindowMinutes} minutes` });
    }
  }
  return out.sort((a, b) => (parseInstant(a.event.occurredAt) ?? 0) - (parseInstant(b.event.occurredAt) ?? 0));
}

/* -------------------------------------------------------------------------- */
/* A. Payment fraud indicators                                                 */
/* -------------------------------------------------------------------------- */

const payRepeatedFailures: Detector = (context) => {
  const window = resolveWindowMs(context, { days: num(context.parameters, 'windowDays', 30) });
  const threshold = num(context.parameters, 'threshold', 3);
  const failures = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.paymentFailed]), window);
  if (failures.length < threshold) return null;
  const invoices = distinctValues(failures, (event) => event.invoiceId);
  return hit(
    'PAY_REPEATED_FAILURES',
    `${failures.length} failed payment attempt${when(failures.length !== 1)} across ${invoices.length} invoice(s) in the last ${formatWindow(window)} ` +
      `(threshold ${threshold}). Most recent ${failures.at(-1)?.occurredAt ?? '—'}.`,
    failures.map((event) =>
      evidenceRef(
        event,
        `payments row ${event.sourceId} status=failed for invoice ${event.invoiceId ?? '—'}, ${describeAmount(event)}` +
          (evidenceString(event, 'failureReason') ? `, recorded reason: ${evidenceString(event, 'failureReason')}` : '')
      )
    )
  );
};

const payFailureBurst: Detector = (context) => {
  const window = resolveWindowMs(context, { minutes: num(context.parameters, 'windowMinutes', 60) });
  const threshold = num(context.parameters, 'threshold', 3);
  const failures = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.paymentFailed]), window);
  if (failures.length < threshold) return null;
  const first = firstOf(failures);
  const last = lastOf(failures);
  const spanMinutes =
    first && last ? Math.round(((parseInstant(last.occurredAt) ?? 0) - (parseInstant(first.occurredAt) ?? 0)) / MS_PER_MINUTE) : 0;
  return hit(
    'PAY_FAILURE_BURST',
    `${failures.length} failed payment attempt${when(failures.length !== 1)} inside ${spanMinutes} minute(s) ` +
      `(window ${formatWindow(window)}, threshold ${threshold}) — the recorded shape of automated card testing.`,
    failures.map((event) =>
      evidenceRef(event, `payments row ${event.sourceId} status=failed at ${event.occurredAt}, ${describeAmount(event)}`)
    ),
    { severityHint: 'high' }
  );
};

const paySuccessAfterFailures: Detector = (context) => {
  const windowMinutes = num(context.parameters, 'windowHours', 24) * 60;
  const minFailures = num(context.parameters, 'minFailures', 3);
  const successes = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.paymentSuccessful]), context.lookbackMs);
  for (const success of successes) {
    const at = parseInstant(success.occurredAt);
    if (at === null) continue;
    const failures = paymentFailuresBefore(context.bundle, at, windowMinutes);
    if (failures.length < minFailures) continue;
    return hit(
      'PAY_SUCCESS_AFTER_FAILURES',
      `Payment ${success.sourceId} succeeded (${describeAmount(success)}) at ${success.occurredAt} after ${failures.length} failed attempt${when(failures.length !== 1)} ` +
        `in the preceding ${formatWindow(windowMinutes * MS_PER_MINUTE)} (minimum ${minFailures}). Many declines then one approval is the strongest recorded card-testing indicator.`,
      [
        evidenceRef(success, `payments row ${success.sourceId} status=successful at ${success.occurredAt}, ${describeAmount(success)}`),
        ...failures.map((event) =>
          evidenceRef(event, `payments row ${event.sourceId} status=failed at ${event.occurredAt}, ${describeAmount(event)}`)
        ),
      ],
      { severityHint: 'critical' }
    );
  }
  return null;
};

const payDuplicateAttempt: Detector = (context) => {
  const windowMinutes = num(context.parameters, 'windowMinutes', 15);
  const groups = context.bundle.paymentAttempts.filter((group) => group.events.length >= 2);
  for (const group of groups) {
    const inWindow = withinWindow(context, group.events, windowMinutes * MS_PER_MINUTE);
    if (inWindow.length < 2) continue;
    // Distinct payments ROWS, not distinct events: one payment moving pending → successful produces
    // two ledger events for the same amount and must never be reported as a duplicate charge.
    const distinctPayments = distinctValues(inWindow, (event) => event.paymentId ?? event.sourceId);
    if (distinctPayments.length < 2) continue;
    const relevant = inWindow.filter((event) => distinctPayments.includes(event.paymentId ?? event.sourceId));
    const firstEvent = firstOf(relevant);
    const lastEvent = lastOf(relevant);
    if (!firstEvent || !lastEvent) continue;
    const first = parseInstant(firstEvent.occurredAt) ?? 0;
    const last = parseInstant(lastEvent.occurredAt) ?? 0;
    const spanSeconds = Math.round((last - first) / 1000);
    if (spanSeconds > windowMinutes * 60) continue;
    return hit(
      'PAY_DUPLICATE_ATTEMPT',
      `${relevant.length} separate payment attempt${when(relevant.length !== 1)} (${distinctPayments.length} distinct payments rows) against invoice ${group.invoiceId ?? '—'} ` +
        `for the same amount (${group.amount === null ? '—' : group.amount.toFixed(2)} ${group.currency ?? '—'}) and provider (${group.provider ?? '—'}) within ${spanSeconds} second(s).`,
      relevant.map((event) =>
        evidenceRef(
          event,
          `payments row ${event.sourceId} status=${event.kind.replace('payment_', '')} at ${event.occurredAt}, ` +
            `provider_reference ${evidenceString(event, 'providerReference') ?? '—'}`
        )
      )
    );
  }
  return null;
};

const payMethodChurn: Detector = (context) => {
  const window = resolveWindowMs(context, { days: num(context.parameters, 'windowDays', 7) });
  const threshold = num(context.parameters, 'threshold', 3);
  const attempts = withinWindow(context, kindList(context.bundle, [...PAYMENT_ATTEMPT_KINDS]), window);
  const methods = context.bundle.paymentMethods
    .map((group) => ({ group, events: withinWindow(context, group.events, window) }))
    .filter((entry) => entry.events.length > 0);
  if (methods.length < threshold) return null;
  return hit(
    'PAY_METHOD_CHURN',
    `${methods.length} distinct payment provider/method combination${when(methods.length !== 1)} used across ${attempts.length} attempt(s) ` +
      `in the last ${formatWindow(window)} (threshold ${threshold}): ${methods
        .map((entry) => `${entry.group.provider ?? '—'}/${entry.group.method ?? '—'}`)
        .join(', ')}.`,
    methods.flatMap((entry) =>
      entry.events.slice(0, 2).map((event) =>
        evidenceRef(event, `payments row ${event.sourceId} provider=${entry.group.provider ?? '—'} method=${entry.group.method ?? '—'} at ${event.occurredAt}`)
      )
    )
  );
};

const payUnusualFrequency: Detector = (context) => {
  const window = resolveWindowMs(context, { days: num(context.parameters, 'windowDays', 7) });
  const threshold = num(context.parameters, 'threshold', 10);
  const attempts = withinWindow(context, kindList(context.bundle, [...PAYMENT_ATTEMPT_KINDS]), window);
  // A single payment row can produce more than one ledger event as it moves pending → successful, so
  // ATTEMPTS are counted as distinct payments rows, not distinct events. Counting events would let one
  // legitimate payment inflate the frequency signal.
  const distinctPayments = distinctValues(attempts, (event) => event.paymentId ?? event.sourceId);
  if (distinctPayments.length < threshold) return null;
  return hit(
    'PAY_UNUSUAL_FREQUENCY',
    `${distinctPayments.length} distinct payment attempt${when(distinctPayments.length !== 1)} (${attempts.length} recorded attempt event(s), any status) ` +
      `in the last ${formatWindow(window)} — above the configured ceiling of ${threshold}.`,
    attempts.map((event) =>
      evidenceRef(event, `payments row ${event.sourceId} status=${event.kind.replace('payment_', '')} at ${event.occurredAt}, ${describeAmount(event)}`)
    )
  );
};

const payUnusualValue: Detector = (context) => {
  const multiplier = decimal(context.parameters, 'multiplier', 5);
  const minHistory = num(context.parameters, 'minHistory', 3);
  const floorAmount = decimal(context.parameters, 'floorAmount', 1000);
  const attempts = withinWindow(context, kindList(context.bundle, [...PAYMENT_ATTEMPT_KINDS]), context.lookbackMs);
  const withAmount = attempts.filter((event) => event.amount !== null);
  if (withAmount.length === 0) return null;
  const seed = firstOf(withAmount);
  if (!seed) return null;
  const largest = withAmount.reduce((max, event) => ((event.amount ?? 0) > (max.amount ?? 0) ? event : max), seed);
  // `withAmount` was filtered on `amount !== null`, so this is never the 0 fallback in practice;
  // the fallback is here because the compiler cannot see the filter's promise.
  const amount = largest.amount ?? 0;
  const median = context.bundle.facts.medianSuccessfulPaymentAmount;
  const historyCount = context.bundle.facts.successfulPaymentHistoryCount;

  const dataQuality: DataQualityFlag[] = [];
  let basis: string;
  let triggered = false;
  if (median !== null && historyCount >= minHistory) {
    triggered = amount >= median * multiplier;
    basis = `${multiplier}× the customer's own median successful payment of ${median.toFixed(2)} ${context.bundle.facts.medianCurrency ?? largest.currency ?? ''} (from ${historyCount} prior successful payment(s))`;
  } else {
    triggered = amount >= floorAmount;
    basis = `the absolute configured floor of ${floorAmount.toFixed(2)} — there is not enough payment history (minimum ${minHistory}) for a per-customer comparison`;
    dataQuality.push({
      code: 'NO_PAYMENT_HISTORY',
      severity: 'informational',
      detail: `Only ${historyCount} prior successful payment(s) on record, below the ${minHistory} needed for a per-customer median. The absolute floor was used instead.`,
    });
  }
  if (!triggered) return null;

  return hit(
    'PAY_UNUSUAL_VALUE',
    `Payment ${largest.sourceId} of ${describeAmount(largest)} at ${largest.occurredAt} is at or above ${basis}.`,
    [
      evidenceRef(largest, `payments row ${largest.sourceId} ${describeAmount(largest)} status=${largest.kind.replace('payment_', '')} at ${largest.occurredAt}`),
      ...attempts
        .filter((event) => event.id !== largest.id)
        .slice(-3)
        .map((event) => evidenceRef(event, `payments row ${event.sourceId} ${describeAmount(event)} at ${event.occurredAt}`)),
    ],
    { dataQuality }
  );
};

const payAmountMismatch: Detector = (context) => {
  const tolerance = decimal(context.parameters, 'toleranceAmount', 0.01);
  const mismatches = context.bundle.paymentMismatches.filter(
    (entry) => entry.amountDelta !== null && Math.abs(entry.amountDelta) > tolerance
  );
  if (mismatches.length === 0) return null;
  const first = firstOf(mismatches);
  if (!first) return null;
  return hit(
    'PAY_AMOUNT_MISMATCH',
    `${mismatches.length} settled payment${when(mismatches.length !== 1)} whose amount differs from its invoice total by more than ${tolerance.toFixed(2)}. ` +
      `Example: payment ${first.payment.sourceId} of ${describeAmount(first.payment)} against invoice total ` +
      `${first.invoiceTotal === null ? '—' : first.invoiceTotal.toFixed(2)} ${first.payment.currency ?? ''} (delta ${first.amountDelta}).`,
    mismatches.map((entry) =>
      evidenceRef(
        entry.payment,
        `payments row ${entry.payment.sourceId} amount=${entry.payment.amount?.toFixed(2)} ${entry.payment.currency ?? ''} vs ` +
          `invoices row ${entry.payment.invoiceId ?? '—'} total_amount=${entry.invoiceTotal?.toFixed(2)}`
      )
    )
  );
};

const payCurrencyMismatch: Detector = (context) => {
  const mismatches = context.bundle.paymentMismatches.filter((entry) => entry.currencyMismatch);
  if (mismatches.length === 0) return null;
  const first = firstOf(mismatches);
  if (!first) return null;
  return hit(
    'PAY_CURRENCY_MISMATCH',
    `${mismatches.length} payment${when(mismatches.length !== 1)} with a currency inconsistent across the order → invoice → payment chain. ` +
      `Example: payment ${first.payment.sourceId} in ${first.payment.currency ?? '—'}, invoice in ${first.invoiceCurrency ?? '—'}, order in ${first.orderCurrency ?? '—'}.`,
    mismatches.map((entry) =>
      evidenceRef(
        entry.payment,
        `payments row ${entry.payment.sourceId} currency=${entry.payment.currency ?? '—'} vs invoices row ${entry.payment.invoiceId ?? '—'} ` +
          `currency=${entry.invoiceCurrency ?? '—'} vs orders currency=${entry.orderCurrency ?? '—'}`
      )
    )
  );
};

const payRefundReversal: Detector = (context) => {
  const window = resolveWindowMs(context, { days: num(context.parameters, 'windowDays', 30) });
  const threshold = num(context.parameters, 'threshold', 1);
  const refunds = withinWindow(context, kindList(context.bundle, [...REFUND_KINDS]), window);
  if (refunds.length < threshold) return null;
  const total = refunds.reduce((sum, event) => sum + (event.amount ?? 0), 0);
  return hit(
    'PAY_REFUND_REVERSAL',
    `${refunds.length} recorded money reversal${when(refunds.length !== 1)} (refund/credit/void) totalling ${total.toFixed(2)} in the last ${formatWindow(window)}. ` +
      'SCOPE: these are refunds and credits as chargeback PROXIES — no gateway on this platform records a chargeback event type, so none is claimed.',
    refunds.map((event) =>
      evidenceRef(event, `${event.sourceTable} row ${event.sourceId} (${event.kind}) ${describeAmount(event)} at ${event.occurredAt}`)
    )
  );
};

const payRefundVelocity: Detector = (context) => {
  const maxDays = decimal(context.parameters, 'maxDaysBetweenPaymentAndRefund', 7);
  const pairs = context.bundle.refundPairs.filter(
    (pair) => pair.daysBetween !== null && pair.daysBetween <= maxDays && parseInstant(pair.refund.occurredAt) !== null
  );
  const relevant = pairs.filter((pair) => {
    const at = parseInstant(pair.refund.occurredAt);
    return at !== null && at >= context.nowMs - context.lookbackMs && at <= context.nowMs;
  });
  if (relevant.length === 0) return null;
  const first = firstOf(relevant);
  if (!first) return null;
  return hit(
    'PAY_REFUND_VELOCITY',
    `${relevant.length} refund${when(relevant.length !== 1)} recorded within ${maxDays} day(s) of the payment it reverses. ` +
      `Fastest example: ${first.daysBetween?.toFixed(2)} day(s) between payment ${first.payment?.sourceId ?? '—'} and ${first.refund.sourceTable} row ${first.refund.sourceId}.`,
    relevant.flatMap((pair) => [
      ...(pair.payment ? [evidenceRef(pair.payment, `payments row ${pair.payment.sourceId} status=successful ${describeAmount(pair.payment)} at ${pair.payment.occurredAt}`)] : []),
      evidenceRef(pair.refund, `${pair.refund.sourceTable} row ${pair.refund.sourceId} (${pair.refund.kind}) ${describeAmount(pair.refund)} at ${pair.refund.occurredAt}`),
    ]),
    { severityHint: 'high' }
  );
};

/* -------------------------------------------------------------------------- */
/* B. Account security indicators                                              */
/* -------------------------------------------------------------------------- */

const accLoginFailureCluster: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 5);
  const failures = withinWindow(context, kindList(context.bundle, [LOGIN_FAILURE]), window);
  if (failures.length < threshold) return null;
  const ips = distinctValues(failures, (event) => event.ipAddress);
  return hit(
    'ACC_LOGIN_FAILURE_CLUSTER',
    `${failures.length} failed login${when(failures.length !== 1)} on this account in the last ${formatWindow(window)} (threshold ${threshold}), ` +
      `from ${ips.length} distinct IP address(es). This detector does not decide between brute force and a forgotten password, and performs no lockout.`,
    failures.map((event) =>
      evidenceRef(event, `auth_audit_log row ${event.sourceId} login_failure at ${event.occurredAt} from ${event.ipAddress ?? 'an unrecorded IP'}`)
    )
  );
};

const accIpFailureSpray: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const minFailures = num(context.parameters, 'minFailures', 10);
  const minAccounts = num(context.parameters, 'minAccounts', 3);
  const failures = withinWindow(context, kindList(context.bundle, [LOGIN_FAILURE]), window);
  const accounts = distinctValues(failures, (event) => event.customerId);
  if (failures.length < minFailures || accounts.length < minAccounts) return null;
  return hit(
    'ACC_IP_FAILURE_SPRAY',
    `IP ${context.bundle.subjectId ?? '—'} recorded ${failures.length} failed login${when(failures.length !== 1)} targeting ${accounts.length} distinct account(s) ` +
      `in the last ${formatWindow(window)} (minimum ${minFailures} failures across ${minAccounts} accounts). Cross-account fan-out from one source.`,
    failures.map((event) =>
      evidenceRef(
        event,
        `auth_audit_log row ${event.sourceId} login_failure at ${event.occurredAt} against account ${event.customerId ?? '—'} from ${event.ipAddress ?? '—'}`
      )
    ),
    { severityHint: 'high' }
  );
};

const accNewGeoLogin: Detector = (context) => {
  const baselineDays = num(context.parameters, 'baselineDays', 90);
  const window = resolveWindowMs(context, { days: baselineDays });
  const candidates = context.bundle.unfamiliarLogins.filter((entry) => entry.newGeo);
  const inWindow = candidates.filter((entry) => {
    const at = parseInstant(entry.event.occurredAt);
    return at !== null && at >= context.nowMs - window && at <= context.nowMs;
  });
  if (inWindow.length === 0) return null;
  const first = firstOf(inWindow);
  if (!first) return null;
  return hit(
    'ACC_NEW_GEO_LOGIN',
    `${inWindow.length} successful login${when(inWindow.length !== 1)} from a country this account had not used in its recorded baseline ` +
      `(${context.bundle.facts.baselineCountries.length} prior countr${when(context.bundle.facts.baselineCountries.length !== 1)} over ${context.bundle.facts.baselineLoginCount} login(s)). ` +
      `First: ${first.country ?? '—'} at ${first.event.occurredAt}. Geography is GeoIP city-centre accuracy, not a verified location.`,
    inWindow.map((entry) =>
      evidenceRef(
        entry.event,
        `auth_audit_log row ${entry.event.sourceId} login_success at ${entry.event.occurredAt} from ${entry.event.ipAddress ?? '—'} resolved to ${entry.country ?? '—'}`
      )
    )
  );
};

const accNewDeviceLogin: Detector = (context) => {
  const baselineDays = num(context.parameters, 'baselineDays', 90);
  const window = resolveWindowMs(context, { days: baselineDays });
  const candidates = context.bundle.unfamiliarLogins.filter((entry) => entry.newDevice);
  const inWindow = candidates.filter((entry) => {
    const at = parseInstant(entry.event.occurredAt);
    return at !== null && at >= context.nowMs - window && at <= context.nowMs;
  });
  if (inWindow.length === 0) return null;
  const first = firstOf(inWindow);
  if (!first) return null;
  return hit(
    'ACC_NEW_DEVICE_LOGIN',
    `${inWindow.length} successful login${when(inWindow.length !== 1)} from a client family not in this account's recorded baseline ` +
      `(${context.bundle.facts.baselineClientFamilies.length} prior famil${context.bundle.facts.baselineClientFamilies.length === 1 ? 'y' : 'ies'}). ` +
      `First: ${first.clientFamily ?? '—'} at ${first.event.occurredAt}. LIMITATION: this platform records no device fingerprint, so this is a coarse browser+OS family comparison.`,
    inWindow.map((entry) =>
      evidenceRef(entry.event, `auth_audit_log row ${entry.event.sourceId} login_success at ${entry.event.occurredAt}, client family ${entry.clientFamily ?? '—'}`)
    ),
    {
      dataQuality: [
        {
          code: 'COARSE_DEVICE_SIGNAL',
          severity: 'informational',
          detail:
            'Device detection is a browser+OS family comparison derived from auth_audit_log.user_agent, not a device fingerprint. ' +
            'A browser or OS upgrade produces this legitimately.',
        },
      ],
    }
  );
};

const accImpossibleTravel: Detector = (context) => {
  const maxHours = decimal(context.parameters, 'maxHours', 6);
  const maxSpeedKmh = decimal(context.parameters, 'maxSpeedKmh', 900);
  const logins = withinWindow(context, kindList(context.bundle, ['login_success']), context.lookbackMs).filter(
    (event) => event.ipCountryCode !== null
  );
  for (let i = 1; i < logins.length; i += 1) {
    const previous = logins[i - 1];
    const current = logins[i];
    if (!previous || !current) continue;
    if (previous.ipCountryCode === current.ipCountryCode) continue;
    const previousAt = parseInstant(previous.occurredAt);
    const currentAt = parseInstant(current.occurredAt);
    if (previousAt === null || currentAt === null) continue;
    const hours = (currentAt - previousAt) / MS_PER_HOUR;
    if (hours <= 0 || hours > maxHours) continue;
    const from = loginCoordinate(previous);
    const to = loginCoordinate(current);
    if (!from || !to) continue;
    const distance = haversineKm(from, to);
    const speed = distance / hours;
    if (speed <= maxSpeedKmh) continue;
    return hit(
      'ACC_IMPOSSIBLE_TRAVEL',
      `Two successful logins ${Math.round(distance)} km apart (${previous.ipCountryCode} → ${current.ipCountryCode}) ` +
        `${hours.toFixed(2)} hour(s) apart implies ~${Math.round(speed)} km/h, above the ${maxSpeedKmh} km/h plausibility ceiling.`,
      [
        evidenceRef(previous, `auth_audit_log row ${previous.sourceId} login_success at ${previous.occurredAt} from ${previous.ipAddress ?? '—'} (${previous.ipCountryCode})`),
        evidenceRef(current, `auth_audit_log row ${current.sourceId} login_success at ${current.occurredAt} from ${current.ipAddress ?? '—'} (${current.ipCountryCode})`),
      ],
      {
        severityHint: 'high',
        dataQuality: [
          {
            code: 'GEOIP_CITY_CENTRE_ACCURACY',
            severity: 'informational',
            detail:
              'Distance is computed between GeoIP city-centre coordinates, which are approximate, and a VPN or proxy exit node produces this ' +
              'pattern innocently. Verify with the customer before treating it as conclusive.',
          },
        ],
      }
    );
  }
  return null;
};

const accAccessFrequencyAnomaly: Detector = (context) => {
  const windowHours = num(context.parameters, 'windowHours', 1);
  const multiplier = decimal(context.parameters, 'multiplier', 5);
  const minBaselineSessions = num(context.parameters, 'minBaselineSessions', 10);
  const facts = context.bundle.facts;
  if (facts.baselineLoginCount < minBaselineSessions || !facts.baselineSpanDays || facts.baselineSpanDays <= 0) {
    return null;
  }
  const window = resolveWindowMs(context, { hours: windowHours });
  const recent = withinWindow(context, kindList(context.bundle, ['login_success']), window);
  const baselinePerHour = facts.baselineLoginCount / (facts.baselineSpanDays * 24);
  const expected = baselinePerHour * windowHours;
  if (expected <= 0 || recent.length < expected * multiplier || recent.length < 3) return null;
  return hit(
    'ACC_ACCESS_FREQUENCY_ANOMALY',
    `${recent.length} successful login${when(recent.length !== 1)} in the last ${formatWindow(window)} against a baseline rate of ` +
      `${baselinePerHour.toFixed(2)}/hour (${facts.baselineLoginCount} login(s) over ${facts.baselineSpanDays} day(s)) — ${multiplier}× the expected ${expected.toFixed(1)}.`,
    recent.map((event) => evidenceRef(event, `auth_audit_log row ${event.sourceId} login_success at ${event.occurredAt}`))
  );
};

const accRecoveryRequestBurst: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 3);
  const requests = withinWindow(context, kindList(context.bundle, [...RECOVERY_REQUEST_KINDS]), window);
  if (requests.length < threshold) return null;
  const completed = withinWindow(context, kindList(context.bundle, [...RECOVERY_COMPLETION_KINDS]), window);
  return hit(
    'ACC_RECOVERY_REQUEST_BURST',
    `${requests.length} account-recovery request${when(requests.length !== 1)} (${distinctValues(requests, (event) => event.kind).join(', ')}) ` +
      `in the last ${formatWindow(window)}, threshold ${threshold}. ${completed.length} of them reached a completion event.`,
    requests.map((event) => evidenceRef(event, `auth_audit_log row ${event.sourceId} ${event.kind} at ${event.occurredAt} from ${event.ipAddress ?? '—'}`))
  );
};

const accRecoveryAfterFailures: Detector = (context) => {
  const windowMinutes = num(context.parameters, 'windowMinutes', 60);
  const minFailures = num(context.parameters, 'minFailures', 3);
  const completions = withinWindow(context, kindList(context.bundle, [...RECOVERY_COMPLETION_KINDS]), context.lookbackMs);
  for (const completion of completions) {
    const at = parseInstant(completion.occurredAt);
    if (at === null) continue;
    const failures = failuresBefore(context.bundle, at, windowMinutes);
    if (failures.length < minFailures) continue;
    return hit(
      'ACC_RECOVERY_AFTER_FAILURES',
      `${completion.kind} at ${completion.occurredAt} followed ${failures.length} failed login${when(failures.length !== 1)} within ${windowMinutes} minute(s) ` +
        `(minimum ${minFailures}). Guess → fail → reset → succeed is the recorded takeover sequence.`,
      [
        evidenceRef(completion, `auth_audit_log row ${completion.sourceId} ${completion.kind} at ${completion.occurredAt} from ${completion.ipAddress ?? '—'}`),
        ...failures.map((event) => evidenceRef(event, `auth_audit_log row ${event.sourceId} login_failure at ${event.occurredAt}`)),
      ],
      { severityHint: 'high' }
    );
  }
  return null;
};

const accStepUpVerificationFailures: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 3);
  const fromAuthLog = withinWindow(context, kindList(context.bundle, [...STEP_UP_FAILURE_KINDS]), window);
  // security_number_verification_failed is recorded as an audit_logs ACTION, not an auth_audit_log
  // event type. Reading it from where it actually lives is what keeps this rule honest.
  const fromAuditLog = withinWindow(
    context,
    kindList(context.bundle, [EVENT_KINDS.adminAction]).filter(
      (event) => evidenceString(event, 'action') === 'security_number_verification_failed'
    ),
    window
  );
  const all = [...fromAuthLog, ...fromAuditLog].sort(
    (a, b) => (parseInstant(a.occurredAt) ?? 0) - (parseInstant(b.occurredAt) ?? 0)
  );
  if (all.length < threshold) return null;
  return hit(
    'ACC_STEP_UP_VERIFICATION_FAILURES',
    `${all.length} step-up verification failure${when(all.length !== 1)} (MFA challenge, Security PIN view, or Security Number) in the last ` +
      `${formatWindow(window)}, threshold ${threshold}. Someone holds the password but not the second factor.`,
    all.map((event) =>
      evidenceRef(event, `${event.sourceTable} row ${event.sourceId} (${event.kind}${evidenceString(event, 'action') ? ` action=${evidenceString(event, 'action')}` : ''}) at ${event.occurredAt}`)
    )
  );
};

const accContextChangeAfterNewLogin: Detector = (context) => {
  const windowMinutes = num(context.parameters, 'windowMinutes', 30);
  const suspicious = suspiciousContextLogins(context.bundle, context.nowMs, context.lookbackMs, 60, 3);
  const changes = kindList(context.bundle, [...ACCOUNT_CHANGE_KINDS]);
  for (const login of suspicious) {
    const loginAt = parseInstant(login.event.occurredAt);
    if (loginAt === null) continue;
    const following = changes.filter((event) => {
      const at = parseInstant(event.occurredAt);
      return at !== null && at >= loginAt && at <= loginAt + windowMinutes * MS_PER_MINUTE;
    });
    if (following.length === 0) continue;
    return hit(
      'ACC_CONTEXT_CHANGE_AFTER_NEW_LOGIN',
      `${following.length} account-information change${when(following.length !== 1)} (${following.map((event) => event.kind).join(', ')}) within ` +
        `${windowMinutes} minute(s) of a login that was itself suspicious (${login.why}) at ${login.event.occurredAt}.`,
      [
        evidenceRef(login.event, `auth_audit_log row ${login.event.sourceId} login_success at ${login.event.occurredAt} — ${login.why}`),
        ...following.map((event) => evidenceRef(event, `auth_audit_log row ${event.sourceId} ${event.kind} at ${event.occurredAt} from ${event.ipAddress ?? '—'}`)),
      ],
      { severityHint: 'high' }
    );
  }
  return null;
};

const accMfaTampering: Detector = (context) => {
  const windowMinutes = num(context.parameters, 'windowMinutes', 60);
  const suspicious = suspiciousContextLogins(context.bundle, context.nowMs, context.lookbackMs, windowMinutes, 3);
  const tampers = kindList(context.bundle, [...MFA_TAMPER_KINDS]);
  for (const login of suspicious) {
    const loginAt = parseInstant(login.event.occurredAt);
    if (loginAt === null) continue;
    const following = tampers.filter((event) => {
      const at = parseInstant(event.occurredAt);
      return at !== null && at >= loginAt && at <= loginAt + windowMinutes * MS_PER_MINUTE;
    });
    if (following.length === 0) continue;
    return hit(
      'ACC_MFA_TAMPERING',
      `Second factor ${following.map((event) => event.kind).join(', ')} within ${windowMinutes} minute(s) of a suspicious login (${login.why}) at ` +
        `${login.event.occurredAt}. Removing the second factor is the step that turns a compromised password into a taken-over account.`,
      [
        evidenceRef(login.event, `auth_audit_log row ${login.event.sourceId} login_success at ${login.event.occurredAt} — ${login.why}`),
        ...following.map((event) => evidenceRef(event, `auth_audit_log row ${event.sourceId} ${event.kind} at ${event.occurredAt}`)),
      ],
      { severityHint: 'critical' }
    );
  }
  return null;
};

const accSharedRegistrationCluster: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 3);
  const registrations = withinWindow(context, kindList(context.bundle, ['register']), window);
  const accounts = distinctValues(registrations, (event) => event.customerId);
  if (registrations.length < threshold) return null;
  return hit(
    'ACC_SHARED_REGISTRATION_CLUSTER',
    `${registrations.length} account registration${when(registrations.length !== 1)} from IP ${context.bundle.subjectId ?? '—'} in the last ${formatWindow(window)} ` +
      `(threshold ${threshold}), creating ${accounts.length} distinct account(s). Bulk registration from one source precedes payment fraud and trial abuse — but NAT and corporate proxies produce it innocently.`,
    registrations.map((event) =>
      evidenceRef(event, `auth_audit_log row ${event.sourceId} register at ${event.occurredAt} → account ${event.customerId ?? '—'} from ${event.ipAddress ?? '—'}`)
    ),
    { severityHint: 'high' }
  );
};

/* -------------------------------------------------------------------------- */
/* C. Order and service abuse                                                  */
/* -------------------------------------------------------------------------- */

const ordOrderVelocity: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 5);
  const orders = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.orderCreated]), window);
  if (orders.length < threshold) return null;
  const total = orders.reduce((sum, event) => sum + (event.amount ?? 0), 0);
  return hit(
    'ORD_ORDER_VELOCITY',
    `${orders.length} order${when(orders.length !== 1)} placed in the last ${formatWindow(window)} (threshold ${threshold}), totalling ${total.toFixed(2)}.`,
    orders.map((event) =>
      evidenceRef(
        event,
        `orders row ${event.sourceId} (${evidenceString(event, 'orderNumber') ?? '—'}) ${describeAmount(event)} ` +
          `status=${evidenceString(event, 'status') ?? '—'} payment_status=${evidenceString(event, 'paymentStatus') ?? '—'} at ${event.occurredAt}`
      )
    )
  );
};

const ordRepeatIdenticalPurchase: Detector = (context) => {
  const window = resolveWindowMs(context, { days: num(context.parameters, 'windowDays', 7) });
  const threshold = num(context.parameters, 'threshold', 3);
  for (const group of context.bundle.orderItems) {
    const orders = withinWindow(context, group.events, window);
    if (orders.length < threshold) continue;
    return hit(
      'ORD_REPEAT_IDENTICAL_PURCHASE',
      `${orders.length} separate order${when(orders.length !== 1)} for the identical line "${group.productName} / ${group.planName} / ${group.billingPeriod}" ` +
        `in the last ${formatWindow(window)} (threshold ${threshold}).`,
      orders.map((event) =>
        evidenceRef(event, `orders row ${event.sourceId} (${evidenceString(event, 'orderNumber') ?? '—'}) containing ${group.productName} / ${group.planName} at ${event.occurredAt}`)
      )
    );
  }
  return null;
};

const ordHighValueNewAccount: Detector = (context) => {
  const accountAgeHours = num(context.parameters, 'accountAgeHours', 72);
  const minAmount = decimal(context.parameters, 'minAmount', 500);
  const createdAt = parseInstant(context.bundle.facts.account?.createdAt ?? null);
  if (createdAt === null) return null;
  const orders = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.orderCreated]), context.lookbackMs);
  for (const order of orders) {
    const at = parseInstant(order.occurredAt);
    if (at === null || (order.amount ?? 0) < minAmount) continue;
    const ageHours = (at - createdAt) / MS_PER_HOUR;
    if (ageHours < 0 || ageHours > accountAgeHours) continue;
    return hit(
      'ORD_HIGH_VALUE_NEW_ACCOUNT',
      `Order ${evidenceString(order, 'orderNumber') ?? order.sourceId} of ${describeAmount(order)} (at or above ${minAmount.toFixed(2)}) placed ` +
        `${ageHours.toFixed(1)} hour(s) after the account was created — inside the ${accountAgeHours}-hour new-account window. ` +
        'Register → buy big → disappear is the most reliable hosting-fraud pattern.',
      [
        evidenceRef(order, `orders row ${order.sourceId} ${describeAmount(order)} at ${order.occurredAt}, payment_status=${evidenceString(order, 'paymentStatus') ?? '—'}`),
        {
          table: 'users',
          id: context.bundle.facts.account?.id ?? null,
          description: `Account created ${context.bundle.facts.account?.createdAt ?? '—'} (role ${context.bundle.facts.account?.role ?? '—'}, status ${context.bundle.facts.account?.status ?? '—'})`,
          occurredAt: context.bundle.facts.account?.createdAt ?? null,
        },
      ],
      { severityHint: 'critical' }
    );
  }
  return null;
};

const ordUnpaidAccumulation: Detector = (context) => {
  const windowDays = num(context.parameters, 'windowDays', 30);
  const threshold = num(context.parameters, 'threshold', 5);
  // Read from the LIVE orders table via facts, not from the event ledger: "how many orders are
  // unpaid right now" is present tense, and a ledger event only carries the state at ingestion.
  const unpaid = context.bundle.facts.unpaidOrders;
  if (!unpaid || unpaid.count < threshold) return null;
  const orders = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.orderCreated]), resolveWindowMs(context, { days: windowDays }));
  return hit(
    'ORD_UNPAID_ACCUMULATION',
    `${unpaid.count} order${when(unpaid.count !== 1)} currently carrying payment_status unpaid or failed in the last ${unpaid.windowDays} day(s) ` +
      `(threshold ${threshold}), totalling ${unpaid.totalAmount.toFixed(2)} of capacity requested without payment. Read live from the orders table.`,
    orders.map((event) =>
      evidenceRef(
        event,
        `orders row ${event.sourceId} (${evidenceString(event, 'orderNumber') ?? '—'}) ${describeAmount(event)}; payment_status recorded as ` +
          `${evidenceString(event, 'paymentStatus') ?? '—'} at ingestion (${evidenceString(event, 'snapshotAt') ?? '—'})`
      )
    ),
    {
      dataQuality: [
        {
          code: 'SNAPSHOT_VS_LIVE_STATE',
          severity: 'informational',
          detail:
            'The COUNT comes from the live orders table; the listed evidence rows carry each order\'s payment_status as recorded when it was ' +
            'ingested, which may since have changed. Re-read the orders row for the current status before acting.',
        },
      ],
    }
  );
};

const ordProvisioningBurst: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 5);
  const jobs = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.provisioningJob]), window);
  if (jobs.length < threshold) return null;
  const operations = distinctValues(jobs, (event) => evidenceString(event, 'operation'));
  return hit(
    'ORD_PROVISIONING_BURST',
    `${jobs.length} provisioning job${when(jobs.length !== 1)} (${operations.join(', ') || 'operations unrecorded'}) in the last ${formatWindow(window)}, threshold ${threshold}.`,
    jobs.map((event) =>
      evidenceRef(
        event,
        `provisioning_jobs row ${event.sourceId} operation=${evidenceString(event, 'operation') ?? '—'} status=${evidenceString(event, 'status') ?? '—'} ` +
          `attempts=${evidenceNumber(event, 'attempts') ?? '—'} at ${event.occurredAt}`
      )
    )
  );
};

const ordCancelRefundPattern: Detector = (context) => {
  const window = resolveWindowMs(context, { days: num(context.parameters, 'windowDays', 30) });
  const minCancellations = num(context.parameters, 'minCancellations', 2);
  const minRefunds = num(context.parameters, 'minRefunds', 1);
  const cancellations = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.serviceCancelled]), window);
  const refunds = withinWindow(context, kindList(context.bundle, [...REFUND_KINDS]), window);
  if (cancellations.length < minCancellations || refunds.length < minRefunds) return null;
  return hit(
    'ORD_CANCEL_REFUND_PATTERN',
    `${cancellations.length} service cancellation${when(cancellations.length !== 1)} together with ${refunds.length} recorded refund/credit reversal${when(refunds.length !== 1)} ` +
      `in the last ${formatWindow(window)} (minimum ${minCancellations} cancellation(s) and ${minRefunds} refund(s)). Buy → use → cancel → refund is a service-abuse cycle.`,
    [
      ...cancellations.map((event) =>
        evidenceRef(event, `customer_services row ${event.sourceId} status=cancelled (${evidenceString(event, 'label') ?? '—'}) at ${event.occurredAt}`)
      ),
      ...refunds.map((event) => evidenceRef(event, `${event.sourceTable} row ${event.sourceId} (${event.kind}) ${describeAmount(event)} at ${event.occurredAt}`)),
    ],
    { severityHint: 'high' }
  );
};

const svcToolAbuse: Detector = (context) => {
  const window = resolveWindowMs(context, { days: num(context.parameters, 'windowDays', 7) });
  const threshold = num(context.parameters, 'threshold', 3);
  const abuse = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.toolAbuse]), window);
  if (abuse.length < threshold) return null;
  const tools = distinctValues(abuse, (event) => evidenceString(event, 'toolSlug'));
  return hit(
    'SVC_TOOL_ABUSE',
    `${abuse.length} recorded service/tool abuse event${when(abuse.length !== 1)} in the last ${formatWindow(window)} (threshold ${threshold})` +
      `${tools.length > 0 ? ` across ${tools.join(', ')}` : ''}. This is the only per-actor service-usage telemetry this platform records; SMTP-relay and proxy abuse have none and are not detected.`,
    abuse.map((event) =>
      evidenceRef(
        event,
        `tool_abuse_events row ${event.sourceId} kind=${evidenceString(event, 'kind') ?? '—'} tool=${evidenceString(event, 'toolSlug') ?? '—'} at ${event.occurredAt}`
      )
    )
  );
};

/* -------------------------------------------------------------------------- */
/* D. Administrative and API activity                                          */
/* -------------------------------------------------------------------------- */

const admPrivilegedActionBurst: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 1) });
  const threshold = num(context.parameters, 'threshold', 25);
  const actions = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.adminAction]), window);
  if (actions.length < threshold) return null;
  const distinctActions = distinctValues(actions, (event) => evidenceString(event, 'action'));
  return hit(
    'ADM_PRIVILEGED_ACTION_BURST',
    `${actions.length} privileged action${when(actions.length !== 1)} written to audit_logs by this actor in the last ${formatWindow(window)} (threshold ${threshold}), ` +
      `spanning ${distinctActions.length} distinct action type(s).`,
    actions.map((event) =>
      evidenceRef(
        event,
        `audit_logs row ${event.sourceId} action=${evidenceString(event, 'action') ?? '—'} resource=${evidenceString(event, 'resourceType') ?? '—'} at ${event.occurredAt}`
      )
    )
  );
};

const PERMISSION_CHANGE_KINDS = ['admin_role_change', 'admin_status_change'] as const;

const admPermissionChange: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 1);
  const changes = withinWindow(context, kindList(context.bundle, [...PERMISSION_CHANGE_KINDS]), window);
  if (changes.length < threshold) return null;
  return hit(
    'ADM_PERMISSION_CHANGE',
    `${changes.length} permission or account-status change${when(changes.length !== 1)} (${changes.map((event) => event.kind).join(', ')}) in the last ${formatWindow(window)}. ` +
      'Privilege changes are rare and always worth a second pair of eyes, including when legitimate.',
    changes.map((event) =>
      evidenceRef(
        event,
        `auth_audit_log row ${event.sourceId} ${event.kind} at ${event.occurredAt} by actor ${event.actorId ?? '—'} affecting account ${event.customerId ?? '—'}` +
          (evidenceString(event, 'targetRole') ? ` → role ${evidenceString(event, 'targetRole')}` : '')
      )
    ),
    { severityHint: 'high' }
  );
};

const admPermissionChangeBurst: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 3);
  const changes = withinWindow(context, kindList(context.bundle, [...PERMISSION_CHANGE_KINDS]), window);
  if (changes.length < threshold) return null;
  const targets = distinctValues(changes, (event) => event.customerId);
  return hit(
    'ADM_PERMISSION_CHANGE_BURST',
    `${changes.length} permission/status change${when(changes.length !== 1)} by one actor in the last ${formatWindow(window)} (threshold ${threshold}), ` +
      `affecting ${targets.length} distinct account(s). Mass privilege manipulation is how a compromised admin account establishes persistence.`,
    changes.map((event) =>
      evidenceRef(event, `auth_audit_log row ${event.sourceId} ${event.kind} at ${event.occurredAt} affecting account ${event.customerId ?? '—'}`)
    ),
    { severityHint: 'critical' }
  );
};

const admStaffAuthFailures: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 3);
  const role = context.bundle.facts.account?.role;
  if (!role || !['staff', 'admin', 'super_admin'].includes(role)) return null;
  const failures = withinWindow(context, kindList(context.bundle, [LOGIN_FAILURE]), window);
  if (failures.length < threshold) return null;
  const ips = distinctValues(failures, (event) => event.ipAddress);
  return hit(
    'ADM_STAFF_AUTH_FAILURES',
    `${failures.length} failed login${when(failures.length !== 1)} against a PRIVILEGED account (role ${role}) in the last ${formatWindow(window)} ` +
      `(threshold ${threshold}), from ${ips.length} distinct IP address(es).`,
    failures.map((event) =>
      evidenceRef(event, `auth_audit_log row ${event.sourceId} login_failure at ${event.occurredAt} from ${event.ipAddress ?? '—'} against role=${role} account`)
    ),
    { severityHint: 'high' }
  );
};

const admSupportSessionFanout: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 5);
  const minDistinctCustomers = num(context.parameters, 'minDistinctCustomers', 3);
  const sessions = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.supportSessionStarted]), window);
  const customers = distinctValues(sessions, (event) => evidenceString(event, 'targetCustomerId'));
  if (sessions.length < threshold || customers.length < minDistinctCustomers) return null;
  return hit(
    'ADM_SUPPORT_SESSION_FANOUT',
    `${sessions.length} delegated support session${when(sessions.length !== 1)} opened across ${customers.length} distinct customer(s) in the last ${formatWindow(window)} ` +
      `(minimum ${threshold} sessions over ${minDistinctCustomers} customers). Delegated access is legitimate one customer at a time.`,
    sessions.map((event) =>
      evidenceRef(
        event,
        `admin_support_sessions row ${event.sourceId} opened at ${event.occurredAt} for customer ${evidenceString(event, 'targetCustomerId') ?? '—'}` +
          (evidenceString(event, 'reason') ? `, recorded reason: ${evidenceString(event, 'reason')}` : ', no reason recorded')
      )
    )
  );
};

const admOffHoursSensitive: Detector = (context) => {
  const startHourUtc = num(context.parameters, 'startHourUtc', 22);
  const endHourUtc = num(context.parameters, 'endHourUtc', 6);
  const sensitive = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.adminAction]), context.lookbackMs).filter(
    isAdminActionSensitive
  );
  const offHours = sensitive.filter((event) => {
    const at = parseInstant(event.occurredAt);
    if (at === null) return false;
    const hour = new Date(at).getUTCHours();
    return startHourUtc <= endHourUtc ? hour >= startHourUtc && hour < endHourUtc : hour >= startHourUtc || hour < endHourUtc;
  });
  if (offHours.length === 0) return null;
  const first = firstOf(offHours);
  if (!first) return null;
  return hit(
    'ADM_OFF_HOURS_SENSITIVE',
    `${offHours.length} sensitive administrative action${when(offHours.length !== 1)} inside the configured off-hours band ` +
      `(${startHourUtc}:00–${endHourUtc}:00 UTC). Example: ${evidenceString(first, 'action') ?? '—'} on ${evidenceString(first, 'resourceType') ?? '—'} at ${first.occurredAt}.`,
    offHours.map((event) =>
      evidenceRef(
        event,
        `audit_logs row ${event.sourceId} action=${evidenceString(event, 'action') ?? '—'} resource=${evidenceString(event, 'resourceType') ?? '—'} at ${event.occurredAt} (UTC hour ${new Date(parseInstant(event.occurredAt) ?? 0).getUTCHours()})`
      )
    ),
    {
      dataQuality: [
        {
          code: 'UTC_OFF_HOURS_BAND',
          severity: 'informational',
          detail:
            'The off-hours band is evaluated in UTC because the platform stores timestamptz and this module does not know the actor\'s timezone. ' +
            'An administrator legitimately working their local evening will appear here.',
        },
      ],
    }
  );
};

const admSensitiveConfigChange: Detector = (context) => {
  const window = resolveWindowMs(context, { days: num(context.parameters, 'windowDays', 7) });
  const threshold = num(context.parameters, 'threshold', 3);
  const sensitive = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.adminAction]), window).filter(
    isAdminActionSensitive
  );
  if (sensitive.length < threshold) return null;
  const resources = distinctValues(sensitive, (event) => evidenceString(event, 'resourceType'));
  return hit(
    'ADM_SENSITIVE_CONFIG_CHANGE',
    `${sensitive.length} sensitive configuration change${when(sensitive.length !== 1)} in the last ${formatWindow(window)} (threshold ${threshold}) ` +
      `across ${resources.length} resource type(s): ${resources.join(', ') || '—'}.`,
    sensitive.map((event) =>
      evidenceRef(
        event,
        `audit_logs row ${event.sourceId} action=${evidenceString(event, 'action') ?? '—'} resource_type=${evidenceString(event, 'resourceType') ?? '—'} at ${event.occurredAt}`
      )
    )
  );
};

const admManualPaymentBurst: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 24) });
  const threshold = num(context.parameters, 'threshold', 3);
  const confirmations = withinWindow(context, kindList(context.bundle, ['manual_payment_confirmed']), window);
  if (confirmations.length < threshold) return null;
  const total = confirmations.reduce((sum, event) => sum + (event.amount ?? 0), 0);
  return hit(
    'ADM_MANUAL_PAYMENT_BURST',
    `${confirmations.length} manual payment confirmation${when(confirmations.length !== 1)} by one actor in the last ${formatWindow(window)} (threshold ${threshold})` +
      `${total > 0 ? `, totalling ${total.toFixed(2)}` : ''}. Manual confirmation is the one place money can be marked received without a gateway.`,
    confirmations.map((event) =>
      evidenceRef(
        event,
        `auth_audit_log row ${event.sourceId} manual_payment_confirmed at ${event.occurredAt} for invoice ${event.invoiceId ?? '—'}` +
          (event.amount !== null ? `, ${describeAmount(event)}` : '')
      )
    ),
    { severityHint: 'critical' }
  );
};

const apiWebhookRejectBurst: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 1) });
  const threshold = num(context.parameters, 'threshold', 5);
  const rejected = withinWindow(context, kindList(context.bundle, [EVENT_KINDS.webhookRejected, EVENT_KINDS.webhookFailed]), window);
  if (rejected.length < threshold) return null;
  const types = distinctValues(rejected, (event) => evidenceString(event, 'eventType'));
  // The gateway is read from the rows themselves (webhook_events.gateway → the event's channel),
  // not from the subject identity, so the sentence stays true even if the bundle was built for a
  // customer subject that happens to carry webhook events.
  const gateways = distinctValues(rejected, (event) => evidenceString(event, 'gateway') ?? event.channel);
  const gatewayText = gateways.length > 0 ? gateways.join(', ') : (context.bundle.subjectId ?? '—');
  return hit(
    'API_WEBHOOK_REJECT_BURST',
    `${rejected.length} webhook delivery record${when(rejected.length !== 1)} rejected or failed for gateway ${gatewayText} ` +
      `in the last ${formatWindow(window)} (threshold ${threshold})${types.length > 0 ? `, event type(s): ${types.join(', ')}` : ''}.`,
    rejected.map((event) =>
      evidenceRef(
        event,
        `webhook_events row ${event.sourceId} status=${evidenceString(event, 'status') ?? event.kind} gateway=${evidenceString(event, 'gateway') ?? '—'} ` +
          `event_id=${evidenceString(event, 'eventId') ?? '—'} at ${event.occurredAt}`
      )
    ),
    { severityHint: 'high' }
  );
};

const apiWebhookReplay: Detector = (context) => {
  const window = resolveWindowMs(context, { hours: num(context.parameters, 'windowHours', 1) });
  const threshold = num(context.parameters, 'threshold', 3);
  for (const group of context.bundle.webhookPayloads) {
    const deliveries = withinWindow(context, group.events, window);
    if (deliveries.length < threshold) continue;
    const firstDelivery = firstOf(deliveries);
    const lastDelivery = lastOf(deliveries);
    if (!firstDelivery || !lastDelivery) continue;
    const first = parseInstant(firstDelivery.occurredAt) ?? 0;
    const last = parseInstant(lastDelivery.occurredAt) ?? 0;
    return hit(
      'API_WEBHOOK_REPLAY',
      `The same webhook payload (sha256 ${group.payloadHash ?? '—'}) is recorded on ${deliveries.length} distinct webhook_events rows for gateway ${group.gateway ?? '—'} ` +
        `spanning ${Math.round((last - first) / 1000)} second(s) (threshold ${threshold} in ${formatWindow(window)}). ` +
        'Either a provider retry storm or one payload presented under several event ids. A byte-identical replay of the SAME event id is refused by UNIQUE(gateway, event_id) before any row is written and is not visible here.',
      deliveries.map((event) =>
        evidenceRef(
          event,
          `webhook_events row ${event.sourceId} event_id=${evidenceString(event, 'eventId') ?? '—'} status=${evidenceString(event, 'status') ?? '—'} ` +
            `payload_hash=${group.payloadHash ?? '—'} at ${event.occurredAt}`
        )
      ),
      { severityHint: 'critical' }
    );
  }
  return null;
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export const DETECTORS: Readonly<Record<string, Detector>> = Object.freeze({
  PAY_REPEATED_FAILURES: payRepeatedFailures,
  PAY_FAILURE_BURST: payFailureBurst,
  PAY_SUCCESS_AFTER_FAILURES: paySuccessAfterFailures,
  PAY_DUPLICATE_ATTEMPT: payDuplicateAttempt,
  PAY_METHOD_CHURN: payMethodChurn,
  PAY_UNUSUAL_FREQUENCY: payUnusualFrequency,
  PAY_UNUSUAL_VALUE: payUnusualValue,
  PAY_AMOUNT_MISMATCH: payAmountMismatch,
  PAY_CURRENCY_MISMATCH: payCurrencyMismatch,
  PAY_REFUND_REVERSAL: payRefundReversal,
  PAY_REFUND_VELOCITY: payRefundVelocity,

  ACC_LOGIN_FAILURE_CLUSTER: accLoginFailureCluster,
  ACC_IP_FAILURE_SPRAY: accIpFailureSpray,
  ACC_NEW_GEO_LOGIN: accNewGeoLogin,
  ACC_NEW_DEVICE_LOGIN: accNewDeviceLogin,
  ACC_IMPOSSIBLE_TRAVEL: accImpossibleTravel,
  ACC_ACCESS_FREQUENCY_ANOMALY: accAccessFrequencyAnomaly,
  ACC_RECOVERY_REQUEST_BURST: accRecoveryRequestBurst,
  ACC_RECOVERY_AFTER_FAILURES: accRecoveryAfterFailures,
  ACC_STEP_UP_VERIFICATION_FAILURES: accStepUpVerificationFailures,
  ACC_CONTEXT_CHANGE_AFTER_NEW_LOGIN: accContextChangeAfterNewLogin,
  ACC_MFA_TAMPERING: accMfaTampering,
  ACC_SHARED_REGISTRATION_CLUSTER: accSharedRegistrationCluster,

  ORD_ORDER_VELOCITY: ordOrderVelocity,
  ORD_REPEAT_IDENTICAL_PURCHASE: ordRepeatIdenticalPurchase,
  ORD_HIGH_VALUE_NEW_ACCOUNT: ordHighValueNewAccount,
  ORD_UNPAID_ACCUMULATION: ordUnpaidAccumulation,
  ORD_PROVISIONING_BURST: ordProvisioningBurst,
  ORD_CANCEL_REFUND_PATTERN: ordCancelRefundPattern,
  SVC_TOOL_ABUSE: svcToolAbuse,

  ADM_PRIVILEGED_ACTION_BURST: admPrivilegedActionBurst,
  ADM_PERMISSION_CHANGE: admPermissionChange,
  ADM_PERMISSION_CHANGE_BURST: admPermissionChangeBurst,
  ADM_STAFF_AUTH_FAILURES: admStaffAuthFailures,
  ADM_SUPPORT_SESSION_FANOUT: admSupportSessionFanout,
  ADM_OFF_HOURS_SENSITIVE: admOffHoursSensitive,
  ADM_SENSITIVE_CONFIG_CHANGE: admSensitiveConfigChange,
  ADM_MANUAL_PAYMENT_BURST: admManualPaymentBurst,
  API_WEBHOOK_REJECT_BURST: apiWebhookRejectBurst,
  API_WEBHOOK_REPLAY: apiWebhookReplay,
});

export function findDetector(code: string): Detector | undefined {
  return DETECTORS[code];
}

/** Exposed for tests and for the rule-management screen: a rule with no evaluator is dead config. */
export function detectorCodes(): string[] {
  return Object.keys(DETECTORS);
}
