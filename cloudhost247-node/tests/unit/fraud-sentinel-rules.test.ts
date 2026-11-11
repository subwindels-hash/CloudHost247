/**
 * Fraud Sentinel — rule catalogue, scoring engine, alert state machine and evidence redaction.
 *
 * These are pure-function tests: no database, no clock, no network. Every evaluation instant is an
 * argument, so the assertions here are reproducible by construction — which is the property the
 * feature's own documentation claims.
 *
 * The two invariants that matter most are asserted first and hardest:
 *   1. PARITY — every rule in the catalogue has an evaluator and every evaluator has a rule. A rule
 *      with no evaluator is dead configuration that silently contributes nothing to a score.
 *   2. NO INVENTION — with an empty bundle, every one of the 40 detectors returns null. A detector
 *      that fires on no data is manufacturing a finding.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAMILY_CAPS,
  DEFAULT_RISK_THRESHOLDS,
  RULE_BY_CODE,
  RULE_CATALOGUE,
  RULE_FAMILIES,
  findRuleDefinition,
} from '../../src/fraud-sentinel/rules/catalogue';
import { DETECTORS, detectorCodes, findDetector } from '../../src/fraud-sentinel/rules/detectors';
import {
  assessSubject,
  applyFamilyCaps,
  buildAlertExplanation,
  buildAlertTitle,
  computeRuleSetVersion,
  deriveConfidence,
  evaluateRules,
  primaryRule,
  type EngineRuleConfig,
} from '../../src/fraud-sentinel/rules/engine';
import {
  EVENT_KINDS,
  deriveSignals,
  firstOf,
  lastOf,
  type SignalBundle,
  type SignalEvent,
  type SubjectFacts,
} from '../../src/fraud-sentinel/rules/signals';
import {
  IllegalTransitionError,
  OPEN_STATUSES,
  REASON_REQUIRED_STATUSES,
  allowedTransitions,
  assertTransition,
  canTransition,
  isOpenStatus,
  isReopen,
  requiresReason,
} from '../../src/fraud-sentinel/rules/transitions';
import { INGESTION_JOINED_TABLES, INGESTION_SOURCE_TABLES } from '../../src/fraud-sentinel/repositories/events-repo';
import { FACT_SOURCE_TABLES } from '../../src/fraud-sentinel/repositories/signals-repo';
import {
  containsPan,
  findUnredactedSecret,
  projectEvidence,
  redactEvidence,
  scrubString,
} from '../../src/fraud-sentinel/utils/redaction';
import { FS_DEFAULT_SETTINGS } from '../../src/fraud-sentinel/utils/settings';
import {
  ADVISORY_ONLY,
  ALERT_STATUSES,
  FALSE_POSITIVE_REASONS,
  INVESTIGATION_ACTIONS,
  SUBJECT_TYPES,
  type AlertStatus,
  type FraudCategory,
} from '../../src/fraud-sentinel/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** A fixed evaluation instant. Nothing in the module reads the clock, so tests pin it. */
const NOW = Date.parse('2026-03-15T12:00:00.000Z');
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';

const iso = (msOffset: number): string => new Date(NOW + msOffset).toISOString();
const minutesAgo = (minutes: number): string => iso(-minutes * 60_000);
const hoursAgo = (hours: number): string => iso(-hours * 3_600_000);
const daysAgo = (days: number): string => iso(-days * 86_400_000);

let eventSequence = 0;

function makeEvent(partial: Partial<SignalEvent> & { kind: string }): SignalEvent {
  eventSequence += 1;
  return {
    id: partial.id ?? `event-${eventSequence}`,
    sourceTable: partial.sourceTable ?? 'fraud_sentinel_events',
    sourceId: partial.sourceId ?? `source-${eventSequence}`,
    category: (partial.category ?? 'payment') as FraudCategory,
    customerId: partial.customerId === undefined ? CUSTOMER_ID : partial.customerId,
    actorId: partial.actorId ?? null,
    orderId: partial.orderId ?? null,
    invoiceId: partial.invoiceId ?? null,
    paymentId: partial.paymentId ?? null,
    serviceId: partial.serviceId ?? null,
    ipAddress: partial.ipAddress ?? null,
    ipCountryCode: partial.ipCountryCode ?? null,
    clientFamily: partial.clientFamily ?? null,
    amount: partial.amount ?? null,
    currency: partial.currency ?? null,
    channel: partial.channel ?? null,
    occurredAt: partial.occurredAt ?? minutesAgo(5),
    evidence: partial.evidence ?? {},
    ...partial,
  };
}

function makeFacts(partial: Partial<SubjectFacts> = {}): SubjectFacts {
  return {
    subjectType: 'customer',
    subjectId: CUSTOMER_ID,
    customerId: CUSTOMER_ID,
    evaluatedAt: new Date(NOW).toISOString(),
    account: null,
    baselineCountries: [],
    baselineClientFamilies: [],
    baselineLoginCount: 0,
    baselineSpanDays: null,
    medianSuccessfulPaymentAmount: null,
    medianCurrency: null,
    successfulPaymentHistoryCount: 0,
    successfulPaymentCurrencyCount: 0,
    unpaidOrders: null,
    eventBatchLimitReached: false,
    oldestEventInLedger: null,
    geoAvailable: false,
    ...partial,
  };
}

function makeBundle(events: readonly SignalEvent[], facts: Partial<SubjectFacts> = {}): SignalBundle {
  return deriveSignals({
    events,
    facts: makeFacts(facts),
    window: { startedAt: daysAgo(30), endedAt: new Date(NOW).toISOString(), days: 30 },
  });
}

/** The whole catalogue as engine configs — what the scan service hands the engine after a DB read. */
function engineRules(codes?: readonly string[]): EngineRuleConfig[] {
  const source = codes ? codes.map((code) => findRuleDefinition(code)).filter(Boolean) : RULE_CATALOGUE;
  return (source as readonly (typeof RULE_CATALOGUE)[number][]).map((rule) => ({
    code: rule.code,
    name: rule.name,
    version: rule.version,
    enabled: rule.enabled,
    weight: rule.weight,
    severity: rule.severity,
    family: rule.family,
    category: rule.category,
    parameters: { ...rule.parameters },
    recommendation: rule.recommendation,
    appliesTo: [...rule.appliesTo],
  }));
}

function assess(
  events: readonly SignalEvent[],
  options: {
    facts?: Partial<SubjectFacts>;
    subjectType?: SubjectFacts['subjectType'];
    subjectId?: string | null;
    customerId?: string | null;
    rules?: EngineRuleConfig[];
    thresholds?: typeof DEFAULT_RISK_THRESHOLDS;
    familyCaps?: typeof DEFAULT_FAMILY_CAPS;
    previous?: { score: number | null; level: 'low' | 'medium' | 'high' | 'critical' | null };
  } = {}
) {
  const subjectType = options.subjectType ?? 'customer';
  const facts: Partial<SubjectFacts> = {
    subjectType,
    subjectId: options.subjectId === undefined ? (subjectType === 'customer' ? CUSTOMER_ID : options.subjectId ?? null) : options.subjectId,
    customerId: options.customerId === undefined ? (subjectType === 'customer' ? CUSTOMER_ID : null) : options.customerId,
    ...options.facts,
  };
  return assessSubject({
    bundle: makeBundle(events, facts),
    rules: options.rules ?? engineRules(),
    thresholds: options.thresholds ?? { ...DEFAULT_RISK_THRESHOLDS },
    familyCaps: options.familyCaps ?? { ...DEFAULT_FAMILY_CAPS },
    previous: {
      score: options.previous?.score ?? null,
      level: options.previous?.level ?? null,
      assessmentId: null,
    },
    nowMs: NOW,
    lookbackDays: 30,
  });
}

/**
 * Three declined card attempts 20 minutes apart, then one approval — the card-testing shape.
 *
 * Ids are explicit rather than generated: the determinism assertions rebuild this fixture and compare
 * the assessments, and a counter-derived sourceId would differ between builds and make the comparison
 * meaningless (it would test that two DIFFERENT inputs give different text).
 */
function cardTestingEvents(): SignalEvent[] {
  const attempt = (index: number, minutes: number, kind: string): SignalEvent =>
    makeEvent({
      id: `ev-card-${index}`,
      sourceId: `pay-card-${index}`,
      kind,
      occurredAt: minutesAgo(minutes),
      amount: 49.99,
      currency: 'USD',
      paymentId: `p-card-${index}`,
      invoiceId: 'i-card-1',
      sourceTable: 'payments',
      ...(kind === EVENT_KINDS.paymentFailed ? { evidence: { failureReason: 'card_declined' } } : {}),
    });
  return [attempt(1, 60, EVENT_KINDS.paymentFailed), attempt(2, 40, EVENT_KINDS.paymentFailed), attempt(3, 20, EVENT_KINDS.paymentFailed), attempt(4, 10, EVENT_KINDS.paymentSuccessful)];
}

/* -------------------------------------------------------------------------- */
/* 1. Catalogue ↔ evaluator parity                                             */
/* -------------------------------------------------------------------------- */

describe('Fraud Sentinel rule catalogue', () => {
  it('has an evaluator for every rule and a rule for every evaluator', () => {
    const catalogueCodes = RULE_CATALOGUE.map((rule) => rule.code);
    const evaluatorCodes = detectorCodes();

    const missingEvaluators = catalogueCodes.filter((code) => !findDetector(code));
    const orphanEvaluators = evaluatorCodes.filter((code) => !RULE_BY_CODE.has(code));

    // A rule with no evaluator contributes nothing while still appearing configured; an evaluator
    // with no rule can never run. Both are defects, so both directions are asserted.
    expect(missingEvaluators).toEqual([]);
    expect(orphanEvaluators).toEqual([]);
    expect(new Set(evaluatorCodes).size).toBe(evaluatorCodes.length);
    expect(evaluatorCodes.length).toBe(catalogueCodes.length);
    expect(Object.keys(DETECTORS).sort()).toEqual([...catalogueCodes].sort());
  });

  it('uses unique codes, known families, bounded weights and real subject types', () => {
    const codes = new Set<string>();
    for (const rule of RULE_CATALOGUE) {
      expect(codes.has(rule.code)).toBe(false);
      codes.add(rule.code);
      expect(RULE_FAMILIES).toContain(rule.family);
      expect(SUBJECT_TYPES.some((type) => rule.appliesTo.includes(type))).toBe(true);
      for (const subjectType of rule.appliesTo) expect(SUBJECT_TYPES).toContain(subjectType);
      expect(rule.weight).toBeGreaterThan(0);
      expect(rule.weight).toBeLessThanOrEqual(30);
      expect(Number.isInteger(rule.version)).toBe(true);
      expect(rule.version).toBeGreaterThanOrEqual(1);
      expect(rule.name.trim().length).toBeGreaterThan(3);
      expect(rule.description.trim().length).toBeGreaterThan(20);
      expect(rule.recommendation.trim().length).toBeGreaterThan(20);
      expect(RULE_BY_CODE.get(rule.code)).toBe(rule);
    }
    expect(codes.size).toBe(RULE_CATALOGUE.length);
  });

  it('only ever names source tables this module actually reads', () => {
    // The "no invented telemetry" rule, asserted structurally: a data source that is not one of the
    // ingested tables (or the module's own ledger) would be a claim about data nobody collects.
    const allowed = new Set<string>([
      ...INGESTION_SOURCE_TABLES,
      ...INGESTION_JOINED_TABLES,
      ...FACT_SOURCE_TABLES,
      'fraud_sentinel_events',
    ]);
    for (const rule of RULE_CATALOGUE) {
      expect(rule.dataSources.length).toBeGreaterThan(0);
      for (const source of rule.dataSources) {
        expect(allowed.has(source), `${rule.code} names unknown data source ${source}`).toBe(true);
      }
    }
  });

  it('caps every family it uses, and uses every family it caps', () => {
    const usedFamilies = new Set(RULE_CATALOGUE.map((rule) => rule.family));
    for (const family of RULE_FAMILIES) {
      expect(DEFAULT_FAMILY_CAPS[family], `family ${family} has no cap`).toBeGreaterThan(0);
      expect(usedFamilies.has(family), `family ${family} has no rules`).toBe(true);
    }
    for (const family of usedFamilies) expect(RULE_FAMILIES).toContain(family);
  });

  it('documents thresholds in ascending order and default settings consistently', () => {
    const { medium, high, critical } = DEFAULT_RISK_THRESHOLDS;
    expect(medium).toBeLessThan(high);
    expect(high).toBeLessThan(critical);
    expect(critical).toBeLessThanOrEqual(100);
    expect(FS_DEFAULT_SETTINGS.riskThresholds).toEqual({ medium, high, critical });
    expect(FS_DEFAULT_SETTINGS.familyCaps).toEqual({ ...DEFAULT_FAMILY_CAPS });
  });
});

/* -------------------------------------------------------------------------- */
/* 2. No invention                                                             */
/* -------------------------------------------------------------------------- */

describe('Fraud Sentinel detectors on empty data', () => {
  it('never fire for any subject type when there is nothing recorded', () => {
    for (const subjectType of SUBJECT_TYPES) {
      const bundle = makeBundle([], { subjectType, subjectId: subjectType === 'customer' ? CUSTOMER_ID : 'x', customerId: null });
      expect(bundle.events).toHaveLength(0);
      for (const code of detectorCodes()) {
        const detector = findDetector(code);
        expect(detector, `${code} has no evaluator`).toBeTypeOf('function');
        const hit = detector?.({ bundle, parameters: {}, nowMs: NOW, lookbackMs: 30 * 86_400_000 });
        expect(hit, `${code} fired on an empty bundle for a ${subjectType} subject`).toBeNull();
      }
    }
  });

  it('report the empty window as a data-quality fact, not as a clean score', () => {
    const result = assess([]);
    expect(result.riskScore).toBe(0);
    expect(result.riskLevel).toBe('low');
    expect(result.triggeredRules).toEqual([]);
    const flag = result.dataQuality.find((entry) => entry.code === 'NO_EVENTS_IN_WINDOW');
    expect(flag, 'a zero score on no data must say so').toBeDefined();
    expect(flag?.severity).toBe('informational');
    expect(flag?.detail).toContain('not "verified safe"');
    expect(result.confidence).toBe('low');
  });

  it('surface an enabled rule with no evaluator as a material defect', () => {
    const rules = engineRules();
    rules.push({
      code: 'PAY_RULE_FROM_A_NEWER_BUILD',
      name: 'Not implemented here',
      version: 1,
      enabled: true,
      weight: 12,
      severity: 'medium',
      family: 'payment_failures',
      category: 'payment',
      parameters: {},
      recommendation: 'n/a',
      appliesTo: ['customer'],
    });
    const result = assess([], { rules });
    const flag = result.dataQuality.find((entry) => entry.code === 'RULE_WITHOUT_EVALUATOR');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('material');
    expect(flag?.detail).toContain('PAY_RULE_FROM_A_NEWER_BUILD');
    // A material gap downgrades confidence rather than being decoration.
    expect(result.confidence).toBe('low');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Detection on recorded shapes                                             */
/* -------------------------------------------------------------------------- */

describe('Fraud Sentinel payment detection', () => {
  it('counts repeated declines and quotes the real rows', () => {
    const result = assess(cardTestingEvents());
    const rule = result.triggeredRules.find((entry) => entry.code === 'PAY_REPEATED_FAILURES');
    expect(rule).toBeDefined();
    expect(rule?.reason).toContain('3 failed payment attempt');
    expect(rule?.evidence).toHaveLength(3);
    for (const ref of rule?.evidence ?? []) {
      expect(ref.table).toBe('payments');
      expect(ref.id).toBeTruthy();
      expect(ref.description).toContain('status=failed');
      expect(ref.occurredAt).toBeTruthy();
    }
  });

  it('flags many declines followed by one approval, with critical severity', () => {
    const result = assess(cardTestingEvents());
    const rule = result.triggeredRules.find((entry) => entry.code === 'PAY_SUCCESS_AFTER_FAILURES');
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe('critical');
    expect(rule?.reason).toContain('after 3 failed attempt');
    // The successful payment and the three declines are all cited — four distinct rows.
    expect(rule?.evidence).toHaveLength(4);
  });

  it('treats one payment moving pending → successful as ONE attempt, never a duplicate', () => {
    const onePayment = [
      makeEvent({ kind: EVENT_KINDS.paymentPending, occurredAt: minutesAgo(9), amount: 120, currency: 'USD', paymentId: 'p-1', invoiceId: 'i-1', sourceTable: 'payments' }),
      makeEvent({ kind: EVENT_KINDS.paymentSuccessful, occurredAt: minutesAgo(8), amount: 120, currency: 'USD', paymentId: 'p-1', invoiceId: 'i-1', sourceTable: 'payments' }),
    ];
    const result = assess(onePayment);
    expect(result.triggeredRules.map((entry) => entry.code)).not.toContain('PAY_DUPLICATE_ATTEMPT');
    expect(result.triggeredRules.map((entry) => entry.code)).not.toContain('PAY_UNUSUAL_FREQUENCY');
  });

  it('flags two distinct payments rows for the same invoice and amount inside 15 minutes', () => {
    const duplicate = [
      makeEvent({ kind: EVENT_KINDS.paymentSuccessful, occurredAt: minutesAgo(12), amount: 89.5, currency: 'USD', paymentId: 'p-1', invoiceId: 'i-9', sourceTable: 'payments', evidence: { provider: 'paystack' } }),
      makeEvent({ kind: EVENT_KINDS.paymentSuccessful, occurredAt: minutesAgo(10), amount: 89.5, currency: 'USD', paymentId: 'p-2', invoiceId: 'i-9', sourceTable: 'payments', evidence: { provider: 'paystack' } }),
    ];
    const result = assess(duplicate);
    const rule = result.triggeredRules.find((entry) => entry.code === 'PAY_DUPLICATE_ATTEMPT');
    expect(rule).toBeDefined();
    expect(rule?.reason).toContain('2 distinct payments rows');
    expect(rule?.evidence).toHaveLength(2);
  });

  it('does not flag two attempts on the same invoice that are far apart', () => {
    const spread = [
      makeEvent({ kind: EVENT_KINDS.paymentSuccessful, occurredAt: daysAgo(9), amount: 89.5, currency: 'USD', paymentId: 'p-1', invoiceId: 'i-9', sourceTable: 'payments', evidence: { provider: 'paystack' } }),
      makeEvent({ kind: EVENT_KINDS.paymentSuccessful, occurredAt: daysAgo(2), amount: 89.5, currency: 'USD', paymentId: 'p-2', invoiceId: 'i-9', sourceTable: 'payments', evidence: { provider: 'paystack' } }),
    ];
    const result = assess(spread);
    expect(result.triggeredRules.map((entry) => entry.code)).not.toContain('PAY_DUPLICATE_ATTEMPT');
  });

  it('compares an outlier amount against the customer\'s own median, and says so', () => {
    const outlier = [
      makeEvent({ kind: EVENT_KINDS.paymentSuccessful, occurredAt: hoursAgo(3), amount: 9_000, currency: 'USD', paymentId: 'p-77', invoiceId: 'i-77', sourceTable: 'payments' }),
    ];
    const result = assess(outlier, {
      facts: {
        medianSuccessfulPaymentAmount: 45.5,
        medianCurrency: 'USD',
        successfulPaymentHistoryCount: 12,
        successfulPaymentCurrencyCount: 1,
      },
    });
    const rule = result.triggeredRules.find((entry) => entry.code === 'PAY_UNUSUAL_VALUE');
    expect(rule).toBeDefined();
    expect(rule?.reason).toContain('45.50 USD');
    expect(rule?.reason).toContain('12 prior successful payment');
  });

  it('falls back to the absolute floor when there is no payment history, and flags the gap', () => {
    const outlier = [
      makeEvent({ kind: EVENT_KINDS.paymentSuccessful, occurredAt: hoursAgo(3), amount: 9_000, currency: 'USD', paymentId: 'p-78', invoiceId: 'i-78', sourceTable: 'payments' }),
    ];
    const result = assess(outlier, { facts: { successfulPaymentHistoryCount: 0 } });
    const rule = result.triggeredRules.find((entry) => entry.code === 'PAY_UNUSUAL_VALUE');
    expect(rule).toBeDefined();
    expect(rule?.reason).toContain('absolute configured floor');
    expect(result.dataQuality.some((flag) => flag.code === 'NO_PAYMENT_HISTORY')).toBe(true);
  });

  it('flags a mixed-currency history as material, because one median would compare unlike with unlike', () => {
    const result = assess(
      [makeEvent({ kind: EVENT_KINDS.paymentSuccessful, occurredAt: hoursAgo(2), amount: 500, currency: 'USD', paymentId: 'p-80', sourceTable: 'payments' })],
      {
        facts: {
          medianSuccessfulPaymentAmount: 100,
          medianCurrency: 'NGN',
          successfulPaymentHistoryCount: 6,
          successfulPaymentCurrencyCount: 2,
        },
      }
    );
    const flag = result.dataQuality.find((entry) => entry.code === 'MIXED_PAYMENT_CURRENCIES');
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe('material');
  });
});

describe('Fraud Sentinel account-security detection', () => {
  it('counts a login-failure cluster on one account', () => {
    const events = Array.from({ length: 6 }, (_, index) =>
      makeEvent({
        kind: 'login_failure',
        category: 'account_security',
        occurredAt: minutesAgo(30 - index),
        sourceTable: 'auth_audit_log',
        ipAddress: '203.0.113.9',
        ipCountryCode: 'NG',
      })
    );
    const result = assess(events);
    const rule = result.triggeredRules.find((entry) => entry.code === 'ACC_LOGIN_FAILURE_CLUSTER');
    expect(rule).toBeDefined();
    expect(rule?.reason).toContain('6');
    expect(rule?.evidence.length).toBeGreaterThanOrEqual(6);
  });

  it('counts a failure spray across several accounts from one IP, for an IP subject', () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      makeEvent({
        kind: 'login_failure',
        category: 'account_security',
        occurredAt: minutesAgo(60 - index),
        sourceTable: 'auth_audit_log',
        ipAddress: '198.51.100.7',
        customerId: `customer-${index % 4}`,
      })
    );
    const result = assess(events, { subjectType: 'ip', subjectId: '198.51.100.7', customerId: null });
    const rule = result.triggeredRules.find((entry) => entry.code === 'ACC_IP_FAILURE_SPRAY');
    expect(rule).toBeDefined();
    expect(rule?.reason).toMatch(/4 (distinct )?account/);
  });

  it('reports a login from a country outside the recorded baseline, with the GeoIP caveat', () => {
    const events = [
      makeEvent({
        kind: 'login_success',
        category: 'account_security',
        occurredAt: hoursAgo(2),
        sourceTable: 'auth_audit_log',
        ipAddress: '203.0.113.44',
        ipCountryCode: 'RU',
        clientFamily: 'Chrome/Windows',
      }),
    ];
    const result = assess(events, {
      facts: { baselineCountries: ['NG'], baselineClientFamilies: ['Chrome/Windows'], baselineLoginCount: 40, geoAvailable: true },
    });
    const rule = result.triggeredRules.find((entry) => entry.code === 'ACC_NEW_GEO_LOGIN');
    expect(rule).toBeDefined();
    expect(rule?.reason).toContain('RU');
    expect(rule?.reason).toContain('GeoIP city-centre accuracy');
    // The same login is NOT a new device: the client family is in the baseline.
    expect(result.triggeredRules.map((entry) => entry.code)).not.toContain('ACC_NEW_DEVICE_LOGIN');
  });

  it('labels a new client family as a coarse signal rather than a device identification', () => {
    const events = [
      makeEvent({
        kind: 'login_success',
        category: 'account_security',
        occurredAt: hoursAgo(2),
        sourceTable: 'auth_audit_log',
        ipAddress: '203.0.113.44',
        ipCountryCode: 'NG',
        clientFamily: 'Safari/iOS',
      }),
    ];
    const result = assess(events, {
      facts: { baselineCountries: ['NG'], baselineClientFamilies: ['Chrome/Windows'], baselineLoginCount: 40 },
    });
    const rule = result.triggeredRules.find((entry) => entry.code === 'ACC_NEW_DEVICE_LOGIN');
    expect(rule).toBeDefined();
    expect(result.dataQuality.some((flag) => flag.code === 'COARSE_DEVICE_SIGNAL')).toBe(true);
    expect(rule?.reason).toContain('no device fingerprint');
  });

  it('flags second-factor removal shortly after a login from a new context', () => {
    const events = [
      makeEvent({ kind: 'login_success', category: 'account_security', occurredAt: minutesAgo(50), sourceTable: 'auth_audit_log', ipCountryCode: 'RU', ipAddress: '203.0.113.9' }),
      makeEvent({ kind: 'mfa_disabled', category: 'account_security', occurredAt: minutesAgo(45), sourceTable: 'auth_audit_log' }),
    ];
    const result = assess(events, {
      facts: { baselineCountries: ['NG'], baselineLoginCount: 30, geoAvailable: true },
    });
    const rule = result.triggeredRules.find((entry) => entry.code === 'ACC_MFA_TAMPERING');
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe('critical');
    expect(rule?.weight).toBe(22);
  });
});

describe('Fraud Sentinel order and webhook detection', () => {
  it('reads current unpaid orders from live state, and flags the snapshot difference', () => {
    const events = [
      makeEvent({ kind: EVENT_KINDS.orderCreated, category: 'order_service', occurredAt: daysAgo(4), sourceTable: 'orders', evidence: { orderNumber: 'ORD-1', paymentStatus: 'unpaid', snapshotAt: daysAgo(4) } }),
    ];
    const result = assess(events, { facts: { unpaidOrders: { count: 7, totalAmount: 2_340.5, windowDays: 30 } } });
    const rule = result.triggeredRules.find((entry) => entry.code === 'ORD_UNPAID_ACCUMULATION');
    expect(rule).toBeDefined();
    // The COUNT comes from the live orders table, not from the one ledger event.
    expect(rule?.reason).toContain('7 order');
    expect(rule?.reason).toContain('2340.50');
    expect(result.dataQuality.some((flag) => flag.code === 'SNAPSHOT_VS_LIVE_STATE')).toBe(true);
  });

  it('does not report unpaid accumulation when live state says otherwise', () => {
    const events = [
      makeEvent({ kind: EVENT_KINDS.orderCreated, category: 'order_service', occurredAt: daysAgo(4), sourceTable: 'orders', evidence: { paymentStatus: 'unpaid' } }),
    ];
    const result = assess(events, { facts: { unpaidOrders: { count: 1, totalAmount: 10, windowDays: 30 } } });
    expect(result.triggeredRules.map((entry) => entry.code)).not.toContain('ORD_UNPAID_ACCUMULATION');
  });

  it('flags one webhook payload recorded under several distinct event ids', () => {
    const events = Array.from({ length: 3 }, (_, index) =>
      makeEvent({
        kind: EVENT_KINDS.webhookCompleted,
        category: 'admin_api',
        occurredAt: minutesAgo(9 - index),
        sourceTable: 'webhook_events',
        customerId: null,
        channel: 'paystack',
        evidence: {
          gateway: 'paystack',
          payloadHash: 'a'.repeat(64),
          eventId: `evt-${index}`,
          status: 'completed',
        },
      })
    );
    const result = assess(events, { subjectType: 'gateway', subjectId: 'paystack', customerId: null });
    const rule = result.triggeredRules.find((entry) => entry.code === 'API_WEBHOOK_REPLAY');
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe('critical');
    expect(rule?.reason).toContain('3 distinct webhook_events rows');
    // The rule states what it cannot see, rather than implying it caught every replay.
    expect(rule?.reason).toContain('is not visible here');
    expect(rule?.reason).toContain('UNIQUE(gateway, event_id)');
  });

  it('does not flag three webhook deliveries carrying three different payloads', () => {
    const events = Array.from({ length: 3 }, (_, index) =>
      makeEvent({
        kind: EVENT_KINDS.webhookCompleted,
        category: 'admin_api',
        occurredAt: minutesAgo(9 - index),
        sourceTable: 'webhook_events',
        customerId: null,
        channel: 'paystack',
        evidence: { gateway: 'paystack', payloadHash: `${index}`.padStart(64, '0'), eventId: `evt-${index}`, status: 'completed' },
      })
    );
    const result = assess(events, { subjectType: 'gateway', subjectId: 'paystack', customerId: null });
    expect(result.triggeredRules.map((entry) => entry.code)).not.toContain('API_WEBHOOK_REPLAY');
  });
});

describe('Fraud Sentinel administrative detection', () => {
  it('flags a burst of permission changes by one administrator', () => {
    const events = Array.from({ length: 3 }, (_, index) =>
      makeEvent({
        kind: 'admin_role_change',
        category: 'admin_api',
        occurredAt: hoursAgo(3 - index),
        sourceTable: 'auth_audit_log',
        customerId: null,
        actorId: ACTOR_ID,
      })
    );
    const result = assess(events, { subjectType: 'actor', subjectId: ACTOR_ID, customerId: null });
    const rule = result.triggeredRules.find((entry) => entry.code === 'ADM_PERMISSION_CHANGE_BURST');
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe('critical');
    expect(rule?.weight).toBe(22);
  });

  it('flags manual payment confirmations, the one place money moves without a gateway', () => {
    const events = Array.from({ length: 3 }, (_, index) =>
      makeEvent({
        kind: 'manual_payment_confirmed',
        category: 'admin_api',
        occurredAt: hoursAgo(4 - index),
        sourceTable: 'auth_audit_log',
        customerId: null,
        actorId: ACTOR_ID,
        invoiceId: `inv-${index}`,
        amount: 500 + index,
        currency: 'USD',
      })
    );
    const result = assess(events, { subjectType: 'actor', subjectId: ACTOR_ID, customerId: null });
    const rule = result.triggeredRules.find((entry) => entry.code === 'ADM_MANUAL_PAYMENT_BURST');
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe('critical');
    expect(rule?.reason).toContain('without a gateway');
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Scoring: caps, clamping, thresholds, determinism                         */
/* -------------------------------------------------------------------------- */

describe('Fraud Sentinel scoring engine', () => {
  it('caps a family so correlated rules cannot double-count', () => {
    // cardTestingEvents fires all three payment_failures rules: 12 + 18 + 22 = 52 raw against a cap of 30.
    const result = assess(cardTestingEvents());
    const family = result.familyContributions.find((entry) => entry.family === 'payment_failures');
    expect(family).toBeDefined();
    expect(family?.raw).toBe(52);
    expect(family?.cap).toBe(DEFAULT_FAMILY_CAPS.payment_failures);
    expect(family?.capped).toBe(DEFAULT_FAMILY_CAPS.payment_failures);

    const credited = result.triggeredRules
      .filter((rule) => rule.family === 'payment_failures')
      .map((rule) => ({ code: rule.code, weight: rule.weight, capped: rule.cappedWeight }));
    expect(credited.reduce((sum, rule) => sum + rule.capped, 0)).toBe(DEFAULT_FAMILY_CAPS.payment_failures);
    // Heaviest rule first, credited in full; the rule that crosses the cap gets the remainder; the
    // rest get nothing. That ordering is what makes the capped total reproducible.
    expect(credited[0]).toEqual({ code: 'PAY_SUCCESS_AFTER_FAILURES', weight: 22, capped: 22 });
    expect(credited[1]).toEqual({ code: 'PAY_FAILURE_BURST', weight: 18, capped: 8 });
    expect(credited[2]).toEqual({ code: 'PAY_REPEATED_FAILURES', weight: 12, capped: 0 });
  });

  it('sums capped family contributions and clamps the score into 0..100', () => {
    const result = assess(cardTestingEvents());
    const expected = Math.max(
      0,
      Math.min(100, Math.round(result.familyContributions.reduce((sum, entry) => sum + entry.capped, 0)))
    );
    expect(result.riskScore).toBe(expected);
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it('maps the score onto the documented level bands', () => {
    const expectedLevel = (score: number, bands: { medium: number; high: number; critical: number }) =>
      score >= bands.critical ? 'critical' : score >= bands.high ? 'high' : score >= bands.medium ? 'medium' : 'low';

    const result = assess(cardTestingEvents());
    expect(result.riskLevel).toBe(expectedLevel(result.riskScore, DEFAULT_RISK_THRESHOLDS));

    // Retuning the thresholds moves the level without touching the score — the two are independent.
    const relaxedBands = { medium: 90, high: 95, critical: 99 };
    const relaxed = assess(cardTestingEvents(), { thresholds: relaxedBands });
    expect(relaxed.riskScore).toBe(result.riskScore);
    expect(relaxed.riskLevel).toBe(expectedLevel(relaxed.riskScore, relaxedBands));
    expect(relaxed.riskLevel).not.toBe(result.riskLevel);

    // The shipped bands are the documented ones.
    expect(DEFAULT_RISK_THRESHOLDS).toEqual({ medium: 25, high: 50, critical: 75 });
  });

  it('is deterministic: the same input produces a byte-identical assessment', () => {
    const events = cardTestingEvents();
    const first = assess(events);
    const second = assess(events);
    expect(second).toEqual(first);
    expect(second.ruleSetVersion).toBe(first.ruleSetVersion);
  });

  it('is order-independent: shuffling the rule list does not change the fingerprint or the score', () => {
    const events = cardTestingEvents();
    const baseline = assess(events);
    const shuffled = assess(events, { rules: [...engineRules()].reverse() });
    expect(shuffled.ruleSetVersion).toBe(baseline.ruleSetVersion);
    expect(shuffled.riskScore).toBe(baseline.riskScore);
    expect(shuffled.triggeredRules.map((rule) => rule.code)).toEqual(baseline.triggeredRules.map((rule) => rule.code));
  });

  it('changes the rule-set fingerprint when a weight, an enablement, a threshold or a cap changes', () => {
    const base = computeRuleSetVersion(engineRules(), { ...DEFAULT_RISK_THRESHOLDS }, { ...DEFAULT_FAMILY_CAPS });
    expect(base).toMatch(/^[0-9a-f]{16}$/);

    const retuned = engineRules();
    const target = retuned.find((rule) => rule.code === 'PAY_REPEATED_FAILURES');
    expect(target).toBeDefined();
    if (target) target.weight += 1;
    expect(computeRuleSetVersion(retuned, { ...DEFAULT_RISK_THRESHOLDS }, { ...DEFAULT_FAMILY_CAPS })).not.toBe(base);

    const disabled = engineRules();
    const other = disabled.find((rule) => rule.code === 'PAY_REPEATED_FAILURES');
    if (other) other.enabled = false;
    expect(computeRuleSetVersion(disabled, { ...DEFAULT_RISK_THRESHOLDS }, { ...DEFAULT_FAMILY_CAPS })).not.toBe(base);

    expect(computeRuleSetVersion(engineRules(), { medium: 26, high: 50, critical: 75 }, { ...DEFAULT_FAMILY_CAPS })).not.toBe(base);
    expect(
      computeRuleSetVersion(engineRules(), { ...DEFAULT_RISK_THRESHOLDS }, { ...DEFAULT_FAMILY_CAPS, payment_failures: 31 })
    ).not.toBe(base);

    // Same configuration, different array order → same fingerprint.
    expect(computeRuleSetVersion([...engineRules()].reverse(), { ...DEFAULT_RISK_THRESHOLDS }, { ...DEFAULT_FAMILY_CAPS })).toBe(base);
  });

  it('carries the previous score and level forward for historical comparison', () => {
    const result = assess(cardTestingEvents(), { previous: { score: 12, level: 'low' } });
    expect(result.previousScore).toBe(12);
    expect(result.previousLevel).toBe('low');
    expect(result.riskScore).toBeGreaterThan(12);
  });

  it('records the window bounds, the scoring version and how many events were examined', () => {
    const events = cardTestingEvents();
    const result = assess(events);
    expect(result.eventsExamined).toBe(events.length);
    expect(result.scoringVersion).toBeGreaterThanOrEqual(1);
    expect(Date.parse(result.windowStartedAt)).toBeLessThanOrEqual(Date.parse(result.windowEndedAt));
  });

  it('derives confidence from evidence volume and downgrades it on a material gap', () => {
    const evidence = Array.from({ length: 9 }, (_, index) => ({
      table: 'payments',
      id: `row-${index}`,
      description: `payments row ${index}`,
      occurredAt: minutesAgo(index),
    }));
    const triggered = Array.from({ length: 3 }, (_, index) => ({
      code: `RULE_${index}`,
      version: 1,
      family: 'payment_failures',
      category: 'payment' as FraudCategory,
      severity: 'medium' as const,
      weight: 10,
      cappedWeight: 10,
      reasonCode: `RULE_${index}`,
      reason: 'x',
      confidence: 'medium' as const,
      evidence: [],
    }));
    expect(deriveConfidence(evidence, triggered, [])).toBe('high');
    expect(deriveConfidence(evidence, triggered, [{ code: 'GAP', severity: 'material', detail: 'x' }])).toBe('medium');
    expect(deriveConfidence(evidence.slice(0, 3), triggered, [])).toBe('medium');
    expect(deriveConfidence(evidence.slice(0, 1), triggered.slice(0, 1), [])).toBe('low');
    // An informational gap is a caveat, not a reason to distrust the evidence.
    expect(deriveConfidence(evidence, triggered, [{ code: 'NOTE', severity: 'informational', detail: 'x' }])).toBe('high');
  });

  it('caps and dedupes stored evidence', () => {
    const events = Array.from({ length: 60 }, (_, index) =>
      makeEvent({
        kind: EVENT_KINDS.paymentFailed,
        occurredAt: minutesAgo(200 - index),
        amount: 10,
        currency: 'USD',
        paymentId: `p-${index}`,
        invoiceId: 'i-1',
        sourceTable: 'payments',
        // Two rules cite the same rows: PAY_REPEATED_FAILURES and PAY_FAILURE_BURST overlap.
      })
    );
    const result = assess(events);
    expect(result.evidence.length).toBeLessThanOrEqual(40);
    // One entry per ROW: two rules citing the same payments row must not double the evidence list.
    const rowKeys = result.evidence.filter((ref) => ref.id !== null).map((ref) => `${ref.table}:${ref.id}`);
    expect(new Set(rowKeys).size).toBe(rowKeys.length);
    // The omitted-row note is prose, not a row, and is kept at most once per distinct message.
    const notes = result.evidence.filter((ref) => ref.id === null).map((ref) => ref.description);
    expect(new Set(notes).size).toBe(notes.length);
  });

  it('prefixes every recommendation with its rule code and always ends with the advisory boundary', () => {
    const result = assess(cardTestingEvents());
    expect(result.recommendations.length).toBeGreaterThan(1);
    const last = lastOf(result.recommendations);
    expect(last?.startsWith('[BOUNDARY]')).toBe(true);
    expect(last).toContain('has taken no action');
    expect(last).toContain('human approval');
    const body = result.recommendations.slice(0, -1);
    expect(new Set(body).size).toBe(body.length);
    for (const line of body) expect(line).toMatch(/^\[[A-Z_]+\] /);
    // The heaviest credited rule speaks first.
    expect(body[0]?.startsWith('[PAY_SUCCESS_AFTER_FAILURES]')).toBe(true);
  });

  it('names the primary rule consistently and builds a deterministic title and explanation', () => {
    const result = assess(cardTestingEvents());
    const primary = primaryRule(result.triggeredRules);
    expect(primary?.code).toBe('PAY_SUCCESS_AFTER_FAILURES');

    const title = buildAlertTitle(result, 'customer fraud@example.test');
    expect(title).toContain('PAY_SUCCESS_AFTER_FAILURES');
    expect(title).toContain(`${result.riskScore}/100`);
    expect(title).toContain('customer fraud@example.test');
    expect(title).toContain('other signal');
    expect(title.length).toBeLessThanOrEqual(255);

    const explanation = buildAlertExplanation(result);
    for (const rule of result.triggeredRules) expect(explanation).toContain(rule.code);
    expect(explanation).toContain('Family contributions');
    expect(explanation).toContain('payment_failures 30/52 (cap 30)');
    expect(explanation).toContain('family cap');
    // Reproducibility: the same assessment always explains itself identically.
    expect(buildAlertExplanation(assess(cardTestingEvents()))).toBe(explanation);
  });

  it('applies family caps to an evaluation list without mutating it', () => {
    const input = {
      bundle: makeBundle(cardTestingEvents()),
      rules: engineRules(),
      thresholds: { ...DEFAULT_RISK_THRESHOLDS },
      familyCaps: { ...DEFAULT_FAMILY_CAPS },
      previous: { score: null, level: null, assessmentId: null },
      nowMs: NOW,
      lookbackDays: 30,
    };
    const evaluations = evaluateRules(input);
    const snapshot = evaluations.map((evaluation) => evaluation.rule.weight);
    const capped = applyFamilyCaps(evaluations, input.familyCaps);
    expect(evaluations.map((evaluation) => evaluation.rule.weight)).toEqual(snapshot);
    expect(capped.contributions.every((entry) => entry.capped <= entry.cap)).toBe(true);
    expect(capped.contributions.every((entry) => entry.capped <= entry.raw)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Alert lifecycle                                                          */
/* -------------------------------------------------------------------------- */

describe('Fraud Sentinel alert state machine', () => {
  const matrix: Record<AlertStatus, readonly AlertStatus[]> = {
    new: ['under_review', 'escalated', 'resolved', 'false_positive'],
    under_review: ['escalated', 'resolved', 'false_positive', 'new'],
    escalated: ['under_review', 'resolved', 'false_positive'],
    resolved: ['under_review', 'new'],
    false_positive: ['under_review', 'new'],
  };

  it('allows exactly the documented transitions and rejects every other pair', () => {
    for (const from of ALERT_STATUSES) {
      expect([...allowedTransitions(from)].sort()).toEqual([...matrix[from]].sort());
      for (const to of ALERT_STATUSES) {
        const expected = matrix[from].includes(to);
        expect(canTransition(from, to), `${from} → ${to}`).toBe(expected);
        if (expected) expect(() => assertTransition(from, to)).not.toThrow();
        else {
          let caught: unknown = null;
          try {
            assertTransition(from, to);
          } catch (error) {
            caught = error;
          }
          expect(caught).toBeInstanceOf(IllegalTransitionError);
          expect((caught as IllegalTransitionError).code).toBe('ILLEGAL_ALERT_TRANSITION');
          expect((caught as Error).message).toContain(from);
          expect((caught as Error).message).toContain(to);
        }
      }
    }
  });

  it('never allows a status to transition to itself', () => {
    for (const status of ALERT_STATUSES) expect(canTransition(status, status)).toBe(false);
  });

  it('treats new, under_review and escalated as open — the statuses a dedupe key may hold', () => {
    expect([...OPEN_STATUSES].sort()).toEqual(['escalated', 'new', 'under_review']);
    for (const status of ALERT_STATUSES) expect(isOpenStatus(status)).toBe(OPEN_STATUSES.includes(status));
  });

  it('requires a written reason to close an alert as resolved or false positive', () => {
    expect([...REASON_REQUIRED_STATUSES].sort()).toEqual(['false_positive', 'resolved']);
    for (const status of ALERT_STATUSES) expect(requiresReason(status)).toBe(status === 'resolved' || status === 'false_positive');
  });

  it('recognises reopening a closed alert', () => {
    expect(isReopen('resolved', 'under_review')).toBe(true);
    expect(isReopen('false_positive', 'new')).toBe(true);
    expect(isReopen('new', 'under_review')).toBe(false);
    expect(isReopen('under_review', 'escalated')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. Evidence redaction                                                       */
/* -------------------------------------------------------------------------- */

describe('Fraud Sentinel evidence redaction', () => {
  // 4242 4242 4242 4242 is Luhn-valid; 4242 4242 4242 4243 is not.
  const PAN = '4242424242424242';
  const NOT_A_PAN = '4242424242424243';

  it('masks card numbers and only card numbers', () => {
    expect(containsPan(PAN)).toBe(true);
    expect(containsPan(`card ${PAN} declined`)).toBe(true);
    // A 16-digit run that fails Luhn is a reference number, not a PAN, and must survive: masking it
    // would destroy provider_reference values the evidence needs.
    expect(containsPan(NOT_A_PAN)).toBe(false);
    expect(scrubString(PAN)).not.toContain(PAN);
    expect(scrubString(NOT_A_PAN)).toContain(NOT_A_PAN);
  });

  it('keeps a webhook payload hash and expiry timestamps, which are not credentials', () => {
    const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(scrubString(payloadHash)).toBe(payloadHash);
    const redacted = redactEvidence({ payload_hash: payloadHash, expires_at: '2026-04-01T00:00:00.000Z' }) as Record<string, unknown>;
    expect(redacted.payload_hash).toBe(payloadHash);
    expect(redacted.expires_at).toBe('2026-04-01T00:00:00.000Z');
  });

  it('removes secret-bearing keys whatever their value looks like', () => {
    const redacted = redactEvidence({
      password_hash: '$2b$12$abcdefghijklmnopqrstuv',
      api_key: 'sk_test_abcdef',
      mfa_secret: 'JBSWY3DPEHPK3PXP',
      authorization: 'Bearer abc.def.ghi',
      card_number: PAN,
      cvv: '123',
      status: 'failed',
      failure_reason: `declined for card ${PAN}`,
    }) as Record<string, unknown>;

    for (const key of ['password_hash', 'api_key', 'mfa_secret', 'authorization', 'card_number', 'cvv']) {
      expect(redacted[key] === undefined || redacted[key] === '[REDACTED]', `${key} survived redaction`).toBe(true);
    }
    // Non-secret fields survive, and a PAN inside free text is masked in place.
    expect(redacted.status).toBe('failed');
    expect(String(redacted.failure_reason)).not.toContain(PAN);
  });

  it('projects only allowlisted keys out of a source row', () => {
    const projected = projectEvidence(
      { id: 'p-1', status: 'failed', amount: '49.99', card_number: PAN, password_hash: 'x', failure_reason: 'insufficient_funds' },
      ['id', 'status', 'amount', 'failure_reason', 'card_number']
    ) as Record<string, unknown>;
    expect(projected.id).toBe('p-1');
    expect(projected.status).toBe('failed');
    expect(projected.failure_reason).toBe('insufficient_funds');
    // A denied key is dropped even when explicitly requested.
    expect(projected.card_number === undefined || projected.card_number === '[REDACTED]').toBe(true);
    expect('password_hash' in projected).toBe(false);
  });

  it('finds an unredacted secret in evidence that slipped through', () => {
    expect(findUnredactedSecret({ status: 'failed', amount: '49.99' })).toBeNull();
    expect(findUnredactedSecret({ note: PAN })).not.toBeNull();
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(findUnredactedSecret({ nested: { deep: [jwt] } })).not.toBeNull();
    const pem = `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----`;
    expect(findUnredactedSecret({ key: pem })).not.toBeNull();
    // Calling it twice must give the same answer: the probes are non-global so no lastIndex carries over.
    expect(findUnredactedSecret({ nested: { deep: [jwt] } })).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Advisory-only contract and vocabularies                                  */
/* -------------------------------------------------------------------------- */

describe('Fraud Sentinel advisory-only contract', () => {
  it('declares itself advisory and lists every forbidden enforcement action', () => {
    expect(ADVISORY_ONLY.advisoryOnly).toBe(true);
    expect(ADVISORY_ONLY.performsNoEnforcement).toBe(true);
    expect(ADVISORY_ONLY.forbiddenActions).toEqual([
      'approve_or_reject_payments',
      'issue_refunds',
      'transfer_money',
      'change_customer_balances',
      'seize_customer_funds',
      'suspend_accounts',
      'change_service_entitlements',
      'bypass_whmcs_authorization',
      'override_financial_controls',
    ]);
    expect(ADVISORY_ONLY.statement).toContain('human approval');
  });

  it('keeps the stored vocabularies aligned with the migration CHECK constraints', () => {
    // These literals are duplicated in database/migrations/0101_create_fraud_sentinel.sql; the
    // integration test asserts the database side, this asserts the code side has not drifted.
    expect([...ALERT_STATUSES]).toEqual(['new', 'under_review', 'escalated', 'resolved', 'false_positive']);
    expect([...SUBJECT_TYPES]).toEqual(['customer', 'ip', 'actor', 'gateway']);
    expect([...FALSE_POSITIVE_REASONS]).toEqual([
      'legitimate_customer',
      'expected_behaviour',
      'insufficient_evidence',
      'duplicate_signal',
      'rule_misconfiguration',
      'other',
    ]);
    expect([...INVESTIGATION_ACTIONS]).toContain('false_positive_reported');
    expect(new Set(INVESTIGATION_ACTIONS).size).toBe(INVESTIGATION_ACTIONS.length);
  });

  it('exposes first/last helpers that never throw on an empty list', () => {
    expect(firstOf([])).toBeNull();
    expect(lastOf([])).toBeNull();
    expect(firstOf([1, 2, 3])).toBe(1);
    expect(lastOf([1, 2, 3])).toBe(3);
  });
});
