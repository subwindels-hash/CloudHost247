/**
 * Investigation views: history, false-positive feedback, customer risk profiles and the event ledger
 * behind a transaction or order.
 *
 * These are the read models the dashboard's investigative screens are built from. They add no scoring
 * of their own — every number comes from a stored assessment, alert, investigation entry or projected
 * event — and they are all scope-filtered, so the customer-isolation boundary holds on every screen
 * rather than only on the alert list.
 *
 * Evidence returned from here has already been redacted on the way IN (see utils/redaction.ts); the API
 * layer additionally runs `findUnredactedSecret` before responding, so a redaction regression surfaces
 * as a refused response rather than as a leaked secret.
 */
import type { Queryable } from '../../db/types';
import { NotFoundError } from '../../lib/errors';
import { listEventsForCustomer } from '../repositories/events-repo';
import { findAssessmentById, listAssessments, listRiskHistory } from '../repositories/assessments-repo';
import { findAlertById, listAlerts } from '../repositories/alerts-repo';
import {
  falsePositiveCountsByRule,
  listFalsePositives,
  listInvestigations,
  type FalsePositiveFilters,
  type InvestigationFilters,
} from '../repositories/investigations-repo';
import { listRules } from '../repositories/rules-repo';
import { ADVISORY_ONLY, type AdvisoryOnly } from '../types';
import type {
  FraudAlertRow,
  FraudAssessmentRow,
  FraudCategory,
  FraudEventRow,
  FraudFalsePositiveRow,
  FraudInvestigationRow,
  FraudRiskHistoryRow,
  FraudRuleRow,
  FraudScope,
  Paginated,
} from '../types';

/* -------------------------------------------------------------------------- */
/* Investigation history                                                       */
/* -------------------------------------------------------------------------- */

export async function investigationHistory(
  db: Queryable,
  filters: InvestigationFilters
): Promise<Paginated<FraudInvestigationRow>> {
  return listInvestigations(db, filters);
}

export async function falsePositiveReports(
  db: Queryable,
  filters: FalsePositiveFilters
): Promise<Paginated<FraudFalsePositiveRow>> {
  return listFalsePositives(db, filters);
}

/**
 * Which rules reviewers disagree with, and how often.
 *
 * The pair (alerts raised, false positives reported) per rule is the only honest tuning signal this
 * module can produce from its own records: a rule with many alerts and many false positives is noise,
 * and a rule with none of either may simply never fire. Nothing here changes a weight automatically —
 * retuning is a human act through `rule-service`, versioned and audited.
 */
export async function ruleFeedbackReport(
  db: Queryable,
  options: { since: Date; until: Date; scope: FraudScope }
): Promise<{
  window: { since: string; until: string };
  rules: Array<{
    code: string;
    name: string;
    family: string;
    enabled: boolean;
    weight: number;
    version: number;
    alerts: number;
    falsePositives: number;
    falsePositiveRate: number | null;
  }>;
  advisory: AdvisoryOnly;
}> {
  const [rules, fpCounts] = await Promise.all([
    listRules(db),
    falsePositiveCountsByRule(db, options),
  ]);

  // Alert counts per primary rule, in one grouped query rather than one per rule.
  const params: unknown[] = [options.since.toISOString(), options.until.toISOString()];
  let scope = '';
  if (!options.scope.unrestricted) {
    if (options.scope.customerIds.length === 0) {
      return {
        window: { since: options.since.toISOString(), until: options.until.toISOString() },
        rules: [],
        advisory: ADVISORY_ONLY,
      };
    }
    params.push([...options.scope.customerIds]);
    scope = `AND customer_id = ANY($${params.length}::uuid[])`;
  }
  const { rows } = await db.query<{ code: string; alerts: number }>(
    `SELECT primary_rule_code AS code, count(*)::int AS alerts
     FROM fraud_sentinel_alerts
     WHERE detected_at >= $1::timestamptz AND detected_at <= $2::timestamptz
       AND primary_rule_code IS NOT NULL ${scope}
     GROUP BY primary_rule_code`,
    params
  );
  const alertsByCode = new Map(rows.map((row) => [String(row.code), Number(row.alerts)]));
  const fpByCode = new Map(fpCounts.map((entry) => [entry.ruleCode, entry.reports]));

  const ruleById = new Map<string, FraudRuleRow>(rules.map((rule) => [rule.code, rule]));
  const codes = new Set<string>([...alertsByCode.keys(), ...fpByCode.keys(), ...rules.map((rule) => rule.code)]);

  const report = [...codes]
    .map((code) => {
      const rule = ruleById.get(code);
      const alerts = alertsByCode.get(code) ?? 0;
      const falsePositives = fpByCode.get(code) ?? 0;
      return {
        code,
        name: rule?.name ?? '(rule no longer in the catalogue)',
        family: rule?.family ?? 'unknown',
        enabled: rule?.enabled ?? false,
        weight: rule?.weight ?? 0,
        version: rule?.version ?? 0,
        alerts,
        falsePositives,
        // null rather than 0 when the rule produced no alerts: a 0% false-positive rate on zero
        // alerts would read as "this rule is accurate", which nobody has tested.
        falsePositiveRate: alerts === 0 ? null : Number((falsePositives / alerts).toFixed(3)),
      };
    })
    // Noisy rules first, then rules that never fire, then the rest alphabetically.
    .sort((a, b) => {
      if (b.falsePositives !== a.falsePositives) return b.falsePositives - a.falsePositives;
      if (b.alerts !== a.alerts) return b.alerts - a.alerts;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });

  return {
    window: { since: options.since.toISOString(), until: options.until.toISOString() },
    rules: report,
    advisory: ADVISORY_ONLY,
  };
}

/* -------------------------------------------------------------------------- */
/* Customer risk profile                                                       */
/* -------------------------------------------------------------------------- */

export interface CustomerRiskProfile {
  customerId: string;
  account: { email: string | null; full_name: string | null; role: string; status: string; created_at: string | null } | null;
  /** The current assessment, or null when this customer has never been assessed. */
  current: FraudAssessmentRow | null;
  history: FraudRiskHistoryRow[];
  openAlerts: FraudAlertRow[];
  closedAlerts: FraudAlertRow[];
  recentEvents: FraudEventRow[];
  assessments: FraudAssessmentRow[];
  advisory: AdvisoryOnly;
}

/**
 * Everything recorded about one customer's risk, for the customer risk profile screen.
 *
 * Throws NotFoundError when the caller's scope does not include this customer — the same
 * "not yours is not distinguishable from not existing" contract the alert detail read uses.
 */
export async function customerRiskProfile(
  db: Queryable,
  customerId: string,
  scope: FraudScope,
  options: { historyLimit?: number; eventLimit?: number } = {}
): Promise<CustomerRiskProfile> {
  const { rows } = await db.query<{ email: string | null; full_name: string | null; role: string; status: string; created_at: string | null }>(
    `SELECT email, full_name, role, status, created_at FROM users WHERE id = $1::uuid`,
    [customerId]
  );
  const account = rows[0] ?? null;
  // A customer outside the caller's scope is indistinguishable from a customer that does not exist,
  // so this is a 404 rather than a 403 (the contract src/email-trace/access-control.ts established).
  if (!scope.unrestricted && !scope.customerIds.includes(customerId)) throw new NotFoundError('Customer not found');

  const [history, openAlerts, closedAlerts, events, assessments] = await Promise.all([
    listRiskHistory(db, {
      customerId,
      limit: Math.min(365, Math.max(1, Math.floor(options.historyLimit ?? 90))),
      scope,
    }),
    listAlerts(db, {
      page: 1,
      limit: 25,
      status: 'open',
      customerId,
      scope,
      sortBy: 'detected_at',
      sortDir: 'desc',
    }),
    listAlerts(db, {
      page: 1,
      limit: 25,
      customerId,
      scope,
      sortBy: 'detected_at',
      sortDir: 'desc',
    }),
    listEventsForCustomer(db, customerId, {
      limit: Math.min(200, Math.max(1, Math.floor(options.eventLimit ?? 50))),
      offset: 0,
    }),
    listAssessments(db, { page: 1, limit: 10, customerId, scope }),
  ]);

  const openStatuses = new Set(['new', 'under_review', 'escalated']);
  return {
    customerId,
    account: account
      ? {
          email: account.email,
          full_name: account.full_name,
          role: account.role,
          status: account.status,
          created_at: account.created_at === null ? null : String(account.created_at),
        }
      : null,
    current: assessments.items.find((assessment) => assessment.status === 'active') ?? assessments.items[0] ?? null,
    history,
    openAlerts: openAlerts.items.filter((alert) => openStatuses.has(alert.status)),
    closedAlerts: closedAlerts.items.filter((alert) => !openStatuses.has(alert.status)),
    recentEvents: events.items,
    assessments: assessments.items,
    advisory: ADVISORY_ONLY,
  };
}

/* -------------------------------------------------------------------------- */
/* Transaction / order investigation                                           */
/* -------------------------------------------------------------------------- */

export interface EventLedgerPage {
  items: FraudEventRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  advisory: AdvisoryOnly;
}

/**
 * The projected event ledger for one customer — the transaction/order investigation screen.
 *
 * Each row names its source table and source id, so a reviewer can go from "this is why the score is
 * what it is" to the authoritative row in one step. This ledger is a projection: it is never the
 * system of record for a payment or an order, and it is pruned on its own retention horizon while the
 * source rows are not.
 */
export async function customerEventLedger(
  db: Queryable,
  customerId: string,
  scope: FraudScope,
  options: { page: number; limit: number; category?: FraudCategory | null }
): Promise<EventLedgerPage> {
  if (!scope.unrestricted && !scope.customerIds.includes(customerId)) throw new NotFoundError('Customer not found');
  const limit = Math.min(200, Math.max(1, Math.floor(options.limit)));
  const page = Math.max(1, Math.floor(options.page));
  const { items, total } = await listEventsForCustomer(db, customerId, {
    limit,
    offset: (page - 1) * limit,
    ...(options.category ? { category: options.category } : {}),
  });
  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)), advisory: ADVISORY_ONLY };
}

/** One alert plus the assessment behind it — the pair a reviewer actually reads. */
export async function alertWithAssessment(
  db: Queryable,
  alertId: string,
  scope: FraudScope
): Promise<{ alert: FraudAlertRow; assessment: FraudAssessmentRow | null } | null> {
  const alert = await findAlertById(db, alertId, scope);
  if (!alert) return null;
  const assessment = await findAssessmentById(db, alert.assessment_id, scope);
  return { alert, assessment };
}
