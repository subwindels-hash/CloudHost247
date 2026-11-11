/**
 * Alert queries and lifecycle changes.
 *
 * Every write here does three things in ONE transaction: mutate the alert, append the investigation
 * timeline entry that explains the mutation, and write the `audit_logs` row that attributes it. An
 * alert that changed without a timeline entry, or a timeline entry without an actor, is exactly the
 * unattributable change this module exists to prevent.
 *
 * Two authorization details matter:
 *
 *  * A caller who may not see an alert gets `null` from the detail read, which the route turns into
 *    404 — not 403. "This alert exists but is not yours" is itself a disclosure (the contract
 *    `src/email-trace/access-control.ts` established).
 *  * The state machine lives in `rules/transitions.ts` and is asserted here before any write, so an
 *    illegal transition (resolved → escalated, or any status → itself) cannot reach the database even
 *    from a hand-crafted request.
 *
 * Nothing in this file touches payments, orders, invoices, balances or entitlements. Closing an alert
 * as a false positive records that a human disagreed with a detection; it does not undo anything,
 * because nothing was ever done.
 */
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import { recordAudit, type AuditContext } from '../../lib/audit';
import { ConflictError, HttpError, NotFoundError, ValidationError } from '../../lib/errors';
import {
  applyAlertTransition,
  findAlertById,
  listAlerts,
  setAlertReviewer,
  toAlertRow,
  type AlertFilters,
} from '../repositories/alerts-repo';
import { findAssessmentById, listRiskHistory } from '../repositories/assessments-repo';
import {
  findFalsePositiveByAlert,
  insertFalsePositiveReport,
  insertInvestigationEntry,
  listInvestigationsForAlert,
} from '../repositories/investigations-repo';
import { IllegalTransitionError, assertTransition, isReopen, requiresReason } from '../rules/transitions';
import { scopeAllowsRead } from '../permissions';
import { ADVISORY_ONLY, FALSE_POSITIVE_REASONS, type AdvisoryOnly } from '../types';
import type {
  AlertStatus,
  ConfidenceLevel,
  FraudAlertRow,
  FraudAssessmentRow,
  FraudCategory,
  FraudFalsePositiveRow,
  FraudInvestigationRow,
  FraudRiskHistoryRow,
  FraudScope,
  FalsePositiveReason,
  Paginated,
  RiskLevel,
} from '../types';

/** Who is acting, and the request context to attribute it to. Mirrors revenue-guardian's Actor. */
export interface Actor {
  userId: string | null;
  audit?: AuditContext;
  /** 'system' when a background job acts rather than a person. */
  actorType?: 'staff' | 'system';
}

/** Everything the alert detail screen needs, in one round trip set. */
export interface AlertDetail {
  alert: FraudAlertRow;
  /** The assessment currently behind the alert, with its evidence and rule derivation. */
  assessment: FraudAssessmentRow | null;
  investigations: FraudInvestigationRow[];
  falsePositive: FraudFalsePositiveRow | null;
  riskHistory: FraudRiskHistoryRow[];
  advisory: AdvisoryOnly;
}

const TIMELINE_LIMIT = 200;
const RISK_HISTORY_LIMIT = 90;

/** Minimum length for a note that closes an alert: a resolution has to say something. */
export const MIN_RESOLUTION_NOTE = 10;
/** Minimum length for a false-positive explanation (the table CHECK is 3..4000; this is stricter). */
export const MIN_FALSE_POSITIVE_EXPLANATION = 15;

/**
 * Asserts the alert state machine and translates a refusal into a 409.
 *
 * `IllegalTransitionError` is a plain `Error`: left as-is it reaches the application error handler with
 * no `statusCode` and is answered as `INTERNAL_ERROR` 500 — telling a reviewer the server broke when
 * what actually happened is that they asked for a move the state machine does not allow, and logging an
 * incident for ordinary user error. The 409 keeps the machine's own `code` so a UI can distinguish
 * "not an allowed move" from an unrelated conflict.
 */
function assertAlertTransition(from: AlertStatus, to: AlertStatus): void {
  try {
    assertTransition(from, to);
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      throw new HttpError(409, error.message, error.code);
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listAlertsForRequest(
  db: Queryable,
  filters: AlertFilters
): Promise<Paginated<FraudAlertRow>> {
  return listAlerts(db, filters);
}

/**
 * One alert with everything a reviewer needs. Returns null when it does not exist OR is outside the
 * caller's scope — deliberately indistinguishable, so the route can answer 404 for both.
 */
export async function getAlertDetail(db: Queryable, alertId: string, scope: FraudScope): Promise<AlertDetail | null> {
  const alert = await findAlertById(db, alertId, scope);
  if (!alert) return null;
  // Defence in depth: the SQL already filtered, but a repository bug must not become a disclosure.
  if (!scopeAllowsRead(scope, alert.customer_id)) return null;

  const [assessment, investigations, falsePositive, riskHistory] = await Promise.all([
    findAssessmentById(db, alert.assessment_id, scope),
    listInvestigationsForAlert(db, alert.id, { limit: TIMELINE_LIMIT }),
    findFalsePositiveByAlert(db, alert.id),
    alert.customer_id
      ? listRiskHistory(db, { customerId: alert.customer_id, limit: RISK_HISTORY_LIMIT, scope })
      : listRiskHistory(db, {
          subjectType: alert.subject_type,
          ...(alert.subject_id ? { subjectId: alert.subject_id } : {}),
          ...(alert.subject_label ? { subjectLabel: alert.subject_label } : {}),
          limit: RISK_HISTORY_LIMIT,
          scope,
        }),
  ]);

  return { alert, assessment, investigations, falsePositive, riskHistory, advisory: ADVISORY_ONLY };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

export interface TransitionInput {
  alertId: string;
  toStatus: AlertStatus;
  /** Required for resolved / false_positive; recorded on the timeline for every transition. */
  note?: string | null;
  scope: FraudScope;
}

/**
 * Moves an alert to a new status.
 *
 * Auto-assignment: taking an unassigned alert `new → under_review` (or escalating it) assigns it to
 * the actor, because "under review" with no reviewer named is a claim nobody can check. An explicit
 * `assignAlert` call can still move it later, and unassigning is allowed.
 */
export async function transitionAlert(
  db: Queryable,
  input: TransitionInput,
  actor: Actor
): Promise<AlertDetail> {
  const note = input.note?.trim() ?? null;
  if (requiresReason(input.toStatus)) {
    if (!note || note.length < MIN_RESOLUTION_NOTE) {
      throw new ValidationError(
        `A note of at least ${MIN_RESOLUTION_NOTE} characters is required to mark an alert ${input.toStatus.replace('_', ' ')}`
      );
    }
  }

  const detail = await withTransaction(db, async (tx) => {
    const current = await findAlertById(tx, input.alertId, input.scope);
    if (!current) throw new NotFoundError('Alert not found');
    if (!scopeAllowsRead(input.scope, current.customer_id)) throw new NotFoundError('Alert not found');

    // The state machine is asserted BEFORE any write, so an illegal transition cannot half-apply.
    assertAlertTransition(current.status, input.toStatus);

    const autoAssign =
      current.assigned_reviewer_id === null &&
      actor.userId !== null &&
      (input.toStatus === 'under_review' || input.toStatus === 'escalated');

    const updated = await applyAlertTransition(tx, current.id, {
      status: input.toStatus,
      resolutionNote: note,
      escalated: input.toStatus === 'escalated',
      ...(autoAssign ? { assignedReviewerId: actor.userId } : {}),
    });
    if (!updated) throw new NotFoundError('Alert not found');

    await insertInvestigationEntry(tx, {
      alertId: updated.id,
      assessmentId: updated.assessment_id,
      actorId: actor.userId,
      actorType: actor.actorType ?? (actor.userId ? 'staff' : 'system'),
      action:
        input.toStatus === 'escalated'
          ? 'escalated'
          : input.toStatus === 'resolved'
            ? 'resolved'
            : input.toStatus === 'false_positive'
              ? 'false_positive_reported'
              : 'status_changed',
      fromStatus: current.status,
      toStatus: input.toStatus,
      note,
      metadata: {
        reopened: isReopen(current.status, input.toStatus),
        autoAssigned: autoAssign ? actor.userId : null,
        recurrenceCount: updated.recurrence_count,
        riskScore: updated.risk_score,
        riskLevel: updated.risk_level,
      },
    });

    if (actor.userId) {
      await recordAudit(
        tx,
        {
          actorId: actor.userId,
          action: `fraud_sentinel.alert_${input.toStatus}`,
          resourceType: 'fraud_sentinel_alert',
          resourceId: updated.id,
          metadata: {
            alertNumber: updated.alert_number,
            from: current.status,
            to: input.toStatus,
            note: note ?? null,
            reopened: isReopen(current.status, input.toStatus),
          },
        },
        actor.audit ?? {}
      );
    }

    return getAlertDetail(tx, updated.id, input.scope);
  });

  if (!detail) throw new NotFoundError('Alert not found');
  return detail;
}

export interface AssignInput {
  alertId: string;
  /** Null unassigns. */
  reviewerId: string | null;
  note?: string | null;
  scope: FraudScope;
}

/** Assigns (or unassigns) the reviewer named on an alert. Never changes the alert's status. */
export async function assignAlert(db: Queryable, input: AssignInput, actor: Actor): Promise<AlertDetail> {
  const note = input.note?.trim() ?? null;

  const detail = await withTransaction(db, async (tx) => {
    const current = await findAlertById(tx, input.alertId, input.scope);
    if (!current) throw new NotFoundError('Alert not found');
    if (!scopeAllowsRead(input.scope, current.customer_id)) throw new NotFoundError('Alert not found');

    if (input.reviewerId) {
      const { rows } = await tx.query<{ id: string; role: string; status: string }>(
        `SELECT id, role, status FROM users WHERE id = $1::uuid`,
        [input.reviewerId]
      );
      const reviewer = rows[0];
      if (!reviewer || reviewer.status !== 'active') throw new ValidationError('Reviewer not found or not active');
      // A reviewer must hold an administrative role: assigning a customer to investigate fraud
      // alerts would hand them the platform's fraud view.
      if (reviewer.role !== 'admin' && reviewer.role !== 'super_admin') {
        throw new ValidationError('A reviewer must hold the admin or super_admin role');
      }
    }

    const updated = await setAlertReviewer(tx, current.id, input.reviewerId);
    if (!updated) throw new NotFoundError('Alert not found');

    await insertInvestigationEntry(tx, {
      alertId: updated.id,
      assessmentId: updated.assessment_id,
      actorId: actor.userId,
      actorType: actor.actorType ?? (actor.userId ? 'staff' : 'system'),
      action: input.reviewerId ? 'assigned' : 'unassigned',
      note,
      metadata: { from: current.assigned_reviewer_id, to: input.reviewerId },
    });

    if (actor.userId) {
      await recordAudit(
        tx,
        {
          actorId: actor.userId,
          action: input.reviewerId ? 'fraud_sentinel.alert_assigned' : 'fraud_sentinel.alert_unassigned',
          resourceType: 'fraud_sentinel_alert',
          resourceId: updated.id,
          metadata: { alertNumber: updated.alert_number, reviewerId: input.reviewerId, note: note ?? null },
        },
        actor.audit ?? {}
      );
    }

    return getAlertDetail(tx, updated.id, input.scope);
  });

  if (!detail) throw new NotFoundError('Alert not found');
  return detail;
}

export interface FalsePositiveInput {
  alertId: string;
  reasonCategory: FalsePositiveReason;
  explanation: string;
  /** The rules being disputed; empty means the whole assessment. */
  ruleCodes?: readonly string[];
  scope: FraudScope;
}

/**
 * Reports an alert as a false positive.
 *
 * The alert moves to `false_positive`, the report row is written once (UNIQUE per alert), and both are
 * attributed. This is feedback for whoever tunes the rules — it changes no customer state, because
 * the detection never changed any.
 */
export async function reportFalsePositive(
  db: Queryable,
  input: FalsePositiveInput,
  actor: Actor
): Promise<AlertDetail> {
  const explanation = input.explanation?.trim() ?? '';
  if (explanation.length < MIN_FALSE_POSITIVE_EXPLANATION) {
    throw new ValidationError(
      `A false-positive report needs an explanation of at least ${MIN_FALSE_POSITIVE_EXPLANATION} characters`
    );
  }
  if (!FALSE_POSITIVE_REASONS.includes(input.reasonCategory)) {
    throw new ValidationError(`Unknown false-positive reason: ${String(input.reasonCategory)}`);
  }
  const ruleCodes = [...(input.ruleCodes ?? [])].filter((code) => typeof code === 'string' && code.length > 0);

  const detail = await withTransaction(db, async (tx) => {
    const current = await findAlertById(tx, input.alertId, input.scope);
    if (!current) throw new NotFoundError('Alert not found');
    if (!scopeAllowsRead(input.scope, current.customer_id)) throw new NotFoundError('Alert not found');

    // Reporting an already-closed alert as a false positive is a contradiction the caller must resolve
    // by reopening it first: a resolved alert says someone confirmed it, and silently overwriting that
    // with "nothing happened" would erase their finding.
    assertAlertTransition(current.status, 'false_positive');

    const disputedCodes = ruleCodes.length > 0
      ? ruleCodes
      : current.primary_rule_code
        ? [current.primary_rule_code]
        : [];

    const report = await insertFalsePositiveReport(tx, {
      alertId: current.id,
      assessmentId: current.assessment_id,
      ruleCodes: disputedCodes,
      reportedBy: actor.userId,
      reasonCategory: input.reasonCategory,
      explanation,
    });
    if (report.alreadyReported) {
      throw new ConflictError(`Alert ${current.alert_number} already has a false-positive report`);
    }

    const updated = await applyAlertTransition(tx, current.id, {
      status: 'false_positive',
      resolutionNote: explanation,
    });
    if (!updated) throw new NotFoundError('Alert not found');

    await insertInvestigationEntry(tx, {
      alertId: updated.id,
      assessmentId: updated.assessment_id,
      actorId: actor.userId,
      actorType: actor.actorType ?? (actor.userId ? 'staff' : 'system'),
      action: 'false_positive_reported',
      fromStatus: current.status,
      toStatus: 'false_positive',
      note: explanation,
      metadata: { reasonCategory: input.reasonCategory, ruleCodes: disputedCodes, reportId: report.report.id },
    });

    if (actor.userId) {
      await recordAudit(
        tx,
        {
          actorId: actor.userId,
          action: 'fraud_sentinel.alert_false_positive',
          resourceType: 'fraud_sentinel_alert',
          resourceId: updated.id,
          metadata: {
            alertNumber: updated.alert_number,
            from: current.status,
            reasonCategory: input.reasonCategory,
            ruleCodes: disputedCodes,
          },
        },
        actor.audit ?? {}
      );
    }

    return getAlertDetail(tx, updated.id, input.scope);
  });

  if (!detail) throw new NotFoundError('Alert not found');
  return detail;
}

/** Appends a reviewer note without changing status — "evidence reviewed", questions, decisions. */
export async function addAlertNote(
  db: Queryable,
  input: { alertId: string; note: string; scope: FraudScope; action?: 'note_added' | 'evidence_reviewed' },
  actor: Actor
): Promise<AlertDetail> {
  const note = input.note?.trim() ?? '';
  if (note.length < 3) throw new ValidationError('A note must be at least 3 characters');

  const detail = await withTransaction(db, async (tx) => {
    const current = await findAlertById(tx, input.alertId, input.scope);
    if (!current) throw new NotFoundError('Alert not found');
    if (!scopeAllowsRead(input.scope, current.customer_id)) throw new NotFoundError('Alert not found');

    const entry = await insertInvestigationEntry(tx, {
      alertId: current.id,
      assessmentId: current.assessment_id,
      actorId: actor.userId,
      actorType: actor.actorType ?? (actor.userId ? 'staff' : 'system'),
      action: input.action ?? 'note_added',
      note,
    });

    if (actor.userId) {
      await recordAudit(
        tx,
        {
          actorId: actor.userId,
          action: `fraud_sentinel.alert_${entry.action}`,
          resourceType: 'fraud_sentinel_alert',
          resourceId: current.id,
          metadata: { alertNumber: current.alert_number, noteLength: note.length },
        },
        actor.audit ?? {}
      );
    }

    return getAlertDetail(tx, current.id, input.scope);
  });

  if (!detail) throw new NotFoundError('Alert not found');
  return detail;
}

/* -------------------------------------------------------------------------- */
/* Dashboard overview                                                          */
/* -------------------------------------------------------------------------- */

export interface OverviewOptions {
  scope: FraudScope;
  since: Date;
  until: Date;
  recentLimit?: number;
}

export interface DashboardOverview {
  window: { since: string; until: string };
  alerts: {
    total: number;
    open: number;
    new: number;
    underReview: number;
    escalated: number;
    resolved: number;
    falsePositive: number;
    highOrCritical: number;
    unassigned: number;
  };
  /** Active assessments per level — the platform's current risk distribution. */
  riskDistribution: Array<{ level: RiskLevel; subjects: number }>;
  byCategory: Array<{ category: FraudCategory; alerts: number }>;
  /** Which rules are producing alerts, and how often a reviewer disagreed. */
  topRules: Array<{ code: string; alerts: number; falsePositives: number }>;
  confidenceBreakdown: Array<{ confidence: ConfidenceLevel; assessments: number }>;
  recentAlerts: FraudAlertRow[];
  highestRiskCustomers: Array<{
    customer_id: string;
    email: string | null;
    full_name: string | null;
    risk_score: number;
    risk_level: RiskLevel;
    assessed_at: string;
    open_alerts: number;
  }>;
  lastRun: { job_name: string; status: string; started_at: string; finished_at: string | null } | null;
  advisory: AdvisoryOnly;
}

/**
 * Aggregates for the dashboard's first screen.
 *
 * Every number here is derived from stored rows — counts of alerts, assessments and false-positive
 * reports. None of it is modelled, estimated or extrapolated, and the payload carries the advisory
 * contract so the UI can state it next to the numbers rather than in a footnote.
 */
export async function dashboardOverview(db: Queryable, options: OverviewOptions): Promise<DashboardOverview> {
  const since = options.since.toISOString();
  const until = options.until.toISOString();
  const recentLimit = Math.min(50, Math.max(1, Math.floor(options.recentLimit ?? 10)));

  // Scope is bound once and reused: an unrestricted caller passes no customer filter, a scoped caller
  // passes their ids, and a closed scope short-circuits to zero rows rather than to everything.
  const alertScopeParams: unknown[] = [];
  const alertScope = alertScopeSql(options.scope, alertScopeParams, 'a');
  const assessmentScopeParams: unknown[] = [];
  const assessmentScope = alertScopeSql(options.scope, assessmentScopeParams, 's');

  const [statusRows, levelRows, categoryRows, ruleRows, confidenceRows, recentRows, customerRows, distributionRows, lastRunRows] =
    await Promise.all([
      db.query<Record<string, unknown>>(
        `SELECT a.status, count(*)::int AS n
         FROM fraud_sentinel_alerts a
         WHERE a.detected_at >= $1::timestamptz AND a.detected_at <= $2::timestamptz ${alertScope}
         GROUP BY a.status`,
        [since, until, ...alertScopeParams]
      ),
      db.query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM fraud_sentinel_alerts a
         WHERE a.detected_at >= $1::timestamptz AND a.detected_at <= $2::timestamptz
           AND a.risk_level IN ('high', 'critical') ${alertScope}`,
        [since, until, ...alertScopeParams]
      ),
      db.query<Record<string, unknown>>(
        `SELECT a.category, count(*)::int AS n
         FROM fraud_sentinel_alerts a
         WHERE a.detected_at >= $1::timestamptz AND a.detected_at <= $2::timestamptz ${alertScope}
         GROUP BY a.category`,
        [since, until, ...alertScopeParams]
      ),
      db.query<{ code: string; alerts: number; false_positives: number }>(
        `SELECT a.primary_rule_code AS code,
                count(*)::int AS alerts,
                count(f.id)::int AS false_positives
         FROM fraud_sentinel_alerts a
         LEFT JOIN fraud_sentinel_false_positives f ON f.alert_id = a.id
         WHERE a.detected_at >= $1::timestamptz AND a.detected_at <= $2::timestamptz
           AND a.primary_rule_code IS NOT NULL ${alertScope}
         GROUP BY a.primary_rule_code
         ORDER BY alerts DESC, a.primary_rule_code ASC
         LIMIT 12`,
        [since, until, ...alertScopeParams]
      ),
      db.query<{ confidence: ConfidenceLevel; n: number }>(
        `SELECT s.confidence, count(*)::int AS n
         FROM fraud_sentinel_assessments s
         WHERE s.status = 'active' AND s.assessed_at >= $1::timestamptz AND s.assessed_at <= $2::timestamptz ${assessmentScope}
         GROUP BY s.confidence`,
        [since, until, ...assessmentScopeParams]
      ),
      db.query<Record<string, unknown>>(
        `SELECT a.*, c.email AS customer_email, c.full_name AS customer_name, r.full_name AS reviewer_name
         FROM fraud_sentinel_alerts a
         LEFT JOIN users c ON c.id = a.customer_id
         LEFT JOIN users r ON r.id = a.assigned_reviewer_id
         WHERE a.detected_at >= $1::timestamptz AND a.detected_at <= $2::timestamptz ${alertScope}
         ORDER BY a.detected_at DESC, a.id DESC
         LIMIT $${3 + alertScopeParams.length}`,
        [since, until, ...alertScopeParams, recentLimit]
      ),
      db.query<Record<string, unknown>>(
        `SELECT s.customer_id, u.email, u.full_name, s.risk_score, s.risk_level, s.assessed_at,
                (SELECT count(*)::int FROM fraud_sentinel_alerts a
                  WHERE a.customer_id = s.customer_id AND a.status IN ('new', 'under_review', 'escalated')) AS open_alerts
         FROM fraud_sentinel_assessments s
         LEFT JOIN users u ON u.id = s.customer_id
         WHERE s.status = 'active' AND s.customer_id IS NOT NULL
           AND s.assessed_at >= $1::timestamptz AND s.assessed_at <= $2::timestamptz ${assessmentScope}
         ORDER BY s.risk_score DESC, s.assessed_at DESC
         LIMIT $${3 + assessmentScopeParams.length}`,
        [since, until, ...assessmentScopeParams, 10]
      ),
      db.query<{ risk_level: RiskLevel; n: number }>(
        `SELECT s.risk_level, count(*)::int AS n
         FROM fraud_sentinel_assessments s
         WHERE s.status = 'active' AND s.assessed_at >= $1::timestamptz AND s.assessed_at <= $2::timestamptz ${assessmentScope}
         GROUP BY s.risk_level`,
        [since, until, ...assessmentScopeParams]
      ),
      db.query<Record<string, unknown>>(
        `SELECT job_name, status, started_at, finished_at
         FROM fraud_sentinel_runs
         ORDER BY started_at DESC, id DESC
         LIMIT 1`
      ),
    ]);

  const byStatus = new Map<string, number>(statusRows.rows.map((row) => [String(row.status), Number(row.n)]));
  const count = (status: AlertStatus) => byStatus.get(status) ?? 0;
  const total = [...byStatus.values()].reduce((sum, value) => sum + value, 0);
  const open = count('new') + count('under_review') + count('escalated');

  const unassignedRows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM fraud_sentinel_alerts a
     WHERE a.detected_at >= $1::timestamptz AND a.detected_at <= $2::timestamptz
       AND a.assigned_reviewer_id IS NULL
       AND a.status IN ('new', 'under_review', 'escalated') ${alertScope}`,
    [since, until, ...alertScopeParams]
  );

  const distributionCounts = new Map<string, number>(distributionRows.rows.map((row) => [String(row.risk_level), Number(row.n)]));
  const lastRun = lastRunRows.rows[0];

  return {
    window: { since, until },
    alerts: {
      total,
      open,
      new: count('new'),
      underReview: count('under_review'),
      escalated: count('escalated'),
      resolved: count('resolved'),
      falsePositive: count('false_positive'),
      highOrCritical: Number(levelRows.rows[0]?.n ?? 0),
      unassigned: Number(unassignedRows.rows[0]?.n ?? 0),
    },
    riskDistribution: (['low', 'medium', 'high', 'critical'] as const).map((level) => ({
      level,
      subjects: distributionCounts.get(level) ?? 0,
    })),
    byCategory: categoryRows.rows.map((row) => ({
      category: String(row.category) as FraudCategory,
      alerts: Number(row.n),
    })),
    topRules: ruleRows.rows.map((row) => ({
      code: String(row.code),
      alerts: Number(row.alerts),
      falsePositives: Number(row.false_positives),
    })),
    confidenceBreakdown: confidenceRows.rows.map((row) => ({
      confidence: row.confidence,
      assessments: Number(row.n),
    })),
    recentAlerts: recentRows.rows.map(toAlertRow),
    highestRiskCustomers: customerRows.rows.map((row) => ({
      customer_id: String(row.customer_id),
      email: row.email === null ? null : String(row.email),
      full_name: row.full_name === null ? null : String(row.full_name),
      risk_score: Number(row.risk_score),
      risk_level: row.risk_level as RiskLevel,
      assessed_at: String(row.assessed_at),
      open_alerts: Number(row.open_alerts),
    })),
    lastRun: lastRun
      ? {
          job_name: String(lastRun.job_name),
          status: String(lastRun.status),
          started_at: String(lastRun.started_at),
          finished_at: lastRun.finished_at === null ? null : String(lastRun.finished_at),
        }
      : null,
    advisory: ADVISORY_ONLY,
  };
}

function alertScopeSql(scope: FraudScope, params: unknown[], alias: string): string {
  if (scope.unrestricted) return '';
  if (scope.customerIds.length === 0) return 'AND false';
  params.push([...scope.customerIds]);
  return `AND ${alias}.customer_id = ANY($${params.length + 2}::uuid[])`;
}
