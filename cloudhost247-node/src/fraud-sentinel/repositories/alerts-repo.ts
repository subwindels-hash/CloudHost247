/**
 * Alert storage and lifecycle writes.
 *
 * Duplicate suppression is a DATABASE guarantee, not application care: the partial unique index
 * `fs_alerts_open_dedupe_unique_idx` allows at most one alert per dedupe key while that alert is open
 * (new / under_review / escalated). The upsert below therefore
 *   * updates the existing open alert (new assessment, new score/level, recurrence_count + 1) when the
 *     same underlying condition is detected again, and
 *   * inserts a fresh alert only when no open one exists — including the race where two worker passes
 *     detect it simultaneously, because the INSERT carries `ON CONFLICT … DO NOTHING` against that
 *     same partial index and the loser of the race then takes the update path.
 *
 * A resolved or false_positive alert frees its key, so a genuine recurrence later raises a new alert
 * with its own number and its own timeline. Nothing is ever deleted.
 *
 * No function in this file changes an alert's `status` on its own initiative: transitions come from
 * services/alert-service.ts, which enforces the state machine in rules/transitions.ts and writes the
 * investigation timeline and audit row in the same transaction.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { buildAlertExplanation, buildAlertTitle, primaryRule } from '../rules/engine';
import type {
  AlertStatus,
  AssessmentResult,
  FraudAlertRow,
  FraudCategory,
  FraudScope,
  Paginated,
  RiskLevel,
  SubjectType,
} from '../types';
import { paginate, splitSubjectIdentity } from '../types';

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

export function toAlertRow(row: Record<string, unknown>): FraudAlertRow {
  return {
    id: String(row.id),
    alert_number: String(row.alert_number),
    assessment_id: String(row.assessment_id),
    customer_id: toText(row.customer_id),
    subject_type: row.subject_type as SubjectType,
    subject_id: toText(row.subject_id),
    subject_label: toText(row.subject_label),
    dedupe_key: String(row.dedupe_key),
    category: row.category as FraudCategory,
    risk_level: row.risk_level as RiskLevel,
    risk_score: Number(row.risk_score),
    title: String(row.title),
    explanation: String(row.explanation),
    primary_rule_code: toText(row.primary_rule_code),
    status: row.status as AlertStatus,
    assigned_reviewer_id: toText(row.assigned_reviewer_id),
    assigned_at: toText(row.assigned_at),
    escalated_at: toText(row.escalated_at),
    resolved_at: toText(row.resolved_at),
    resolution_note: toText(row.resolution_note),
    recurrence_count: Number(row.recurrence_count ?? 1),
    detected_at: String(row.detected_at),
    last_assessed_at: String(row.last_assessed_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    customer_email: toText(row.customer_email),
    customer_name: toText(row.customer_name),
    reviewer_name: toText(row.reviewer_name),
  };
}

/**
 * The dedupe key: one open alert per (subject, primary rule).
 *
 * Deliberately NOT keyed on the full triggered-rule set — that would open a new alert every time a
 * second, correlated rule joined the picture, which is exactly the duplicate-alert problem the
 * authorization asks to prevent. The primary rule is the highest-credited rule, so it is stable across
 * re-detections of the same condition.
 */
export function alertDedupeKey(result: AssessmentResult): string {
  const subject = result.subjectId ?? result.customerId ?? 'unattributed';
  const primary = primaryRule(result.triggeredRules)?.code ?? 'general';
  return `${result.subjectType}:${subject}:${primary}`.slice(0, 200);
}

/** A short, human-facing label for the subject of an assessment. */
export function subjectLabel(result: AssessmentResult, accountEmail?: string | null): string {
  switch (result.subjectType) {
    case 'customer':
      return accountEmail
        ? `customer ${accountEmail}`
        : `customer ${result.customerId ?? result.subjectId ?? '—'}`;
    case 'ip':
      return `IP ${result.subjectId ?? '—'}`;
    case 'gateway':
      return `webhook gateway ${result.subjectId ?? '—'}`;
    case 'actor':
      return `staff/administrator account ${result.subjectId ?? '—'}`;
    default:
      return `unknown subject ${result.subjectId ?? '—'}`;
  }
}

export interface UpsertAlertOutcome {
  alert: FraudAlertRow;
  created: boolean;
  previousScore: number | null;
  previousLevel: RiskLevel | null;
}

/**
 * Creates or refreshes the open alert for an assessment. Caller supplies the transaction.
 *
 * `accountEmail` is only used to build the title; it is never stored on the alert (the customer id is
 * the reference, and the email is joined in on read).
 */
export async function upsertAlertForAssessment(
  tx: Queryable,
  options: {
    assessmentId: string;
    result: AssessmentResult;
    accountEmail?: string | null;
    detectedAt?: Date;
  }
): Promise<UpsertAlertOutcome> {
  const { result } = options;
  const dedupeKey = alertDedupeKey(result);
  const identity = splitSubjectIdentity(result.subjectType, result.subjectId);
  const primary = primaryRule(result.triggeredRules);
  const title = buildAlertTitle(result, subjectLabel(result, options.accountEmail ?? null)).slice(0, 255);
  const explanation = buildAlertExplanation(result);
  const category = (primary?.category ?? result.triggeredRules[0]?.category ?? 'payment') as FraudCategory;
  const now = (options.detectedAt ?? new Date()).toISOString();

  const existing = await findOpenAlertByDedupeKey(tx, dedupeKey);
  if (existing) {
    const { rows } = await tx.query<Record<string, unknown>>(
      `UPDATE fraud_sentinel_alerts
       SET assessment_id = $2::uuid,
           risk_score = $3,
           risk_level = $4,
           category = $5,
           title = $6,
           explanation = $7,
           primary_rule_code = $8,
           recurrence_count = recurrence_count + 1,
           last_assessed_at = $9::timestamptz,
           updated_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [
        existing.id,
        options.assessmentId,
        result.riskScore,
        result.riskLevel,
        category,
        title,
        explanation,
        primary?.code ?? null,
        now,
      ]
    );
    return {
      alert: toAlertRow(rows[0] as Record<string, unknown>),
      created: false,
      previousScore: existing.risk_score,
      previousLevel: existing.risk_level,
    };
  }

  const { rows } = await tx.query<Record<string, unknown>>(
    `INSERT INTO fraud_sentinel_alerts (
       id, assessment_id, customer_id, subject_type, subject_id, subject_label, dedupe_key, category,
       risk_level, risk_score, title, explanation, primary_rule_code, status,
       recurrence_count, detected_at, last_assessed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'new',1,$14::timestamptz,$14::timestamptz)
     ON CONFLICT (dedupe_key) WHERE status IN ('new', 'under_review', 'escalated') DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      options.assessmentId,
      result.customerId,
      result.subjectType,
      identity.subjectId,
      identity.subjectLabel,
      dedupeKey,
      category,
      result.riskLevel,
      result.riskScore,
      title,
      explanation,
      primary?.code ?? null,
      now,
    ]
  );

  if (rows[0]) {
    return { alert: toAlertRow(rows[0]), created: true, previousScore: null, previousLevel: null };
  }

  // Lost the race with a concurrent insert: the open alert now exists, so take the update path.
  const winner = await findOpenAlertByDedupeKey(tx, dedupeKey);
  if (!winner) {
    throw new Error(
      `upsertAlertForAssessment: no open alert exists for dedupe key '${dedupeKey}' after a conflicting insert`
    );
  }
  return upsertAlertForAssessment(tx, options);
}

export async function findOpenAlertByDedupeKey(db: Queryable, dedupeKey: string): Promise<FraudAlertRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM fraud_sentinel_alerts
     WHERE dedupe_key = $1 AND status IN ('new', 'under_review', 'escalated')
     ORDER BY detected_at ASC, id ASC
     LIMIT 1`,
    [dedupeKey]
  );
  return rows[0] ? toAlertRow(rows[0]) : null;
}

export async function findAlertById(db: Queryable, id: string, scope: FraudScope): Promise<FraudAlertRow | null> {
  const params: unknown[] = [id];
  const scopeClause = scopeFilter(scope, params);
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT a.*, c.email AS customer_email, c.full_name AS customer_name, r.full_name AS reviewer_name
     FROM fraud_sentinel_alerts a
     LEFT JOIN users c ON c.id = a.customer_id
     LEFT JOIN users r ON r.id = a.assigned_reviewer_id
     WHERE a.id = $1::uuid ${scopeClause}`,
    params
  );
  return rows[0] ? toAlertRow(rows[0]) : null;
}

/** See assessments-repo.scopeClause — same closed-scope contract, same rationale. */
function scopeFilter(scope: FraudScope, params: unknown[]): string {
  if (scope.unrestricted) return '';
  if (scope.customerIds.length === 0) return 'AND false';
  params.push([...scope.customerIds]);
  return `AND a.customer_id = ANY($${params.length}::uuid[])`;
}

export const ALERT_SORT_COLUMNS = ['detected_at', 'last_assessed_at', 'risk_score', 'status', 'alert_number'] as const;
export type AlertSortColumn = (typeof ALERT_SORT_COLUMNS)[number];

export interface AlertFilters {
  page: number;
  limit: number;
  status?: AlertStatus | 'open' | null;
  riskLevel?: RiskLevel | null;
  category?: FraudCategory | null;
  customerId?: string | null;
  subjectType?: SubjectType | null;
  /** The IP address or gateway name, for alerts about platform-level (non-customer) subjects. */
  subjectLabel?: string | null;
  reviewerId?: string | null;
  /**
   * Three states, because the parameter says something either way: `true` is only unassigned alerts,
   * `false` is only assigned ones, and `undefined` is no assignment filter at all. Treating `false` as
   * "no filter" would make `?unassigned=false` return exactly the rows the caller asked to exclude.
   */
  unassigned?: boolean;
  ruleCode?: string | null;
  search?: string | null;
  since?: Date | null;
  until?: Date | null;
  sortBy?: AlertSortColumn;
  sortDir?: 'asc' | 'desc';
  scope: FraudScope;
}

export async function listAlerts(db: Queryable, filters: AlertFilters): Promise<Paginated<FraudAlertRow>> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const push = (clause: string, value: unknown) => {
    params.push(value);
    clauses.push(clause.replace('?', `$${params.length}`));
  };

  if (filters.status === 'open') clauses.push("a.status IN ('new', 'under_review', 'escalated')");
  else if (filters.status) push('a.status = ?', filters.status);
  if (filters.riskLevel) push('a.risk_level = ?', filters.riskLevel);
  if (filters.category) push('a.category = ?', filters.category);
  if (filters.customerId) push('a.customer_id = ?::uuid', filters.customerId);
  if (filters.subjectType) push('a.subject_type = ?', filters.subjectType);
  if (filters.subjectLabel) push('a.subject_label = ?', filters.subjectLabel);
  if (filters.reviewerId) push('a.assigned_reviewer_id = ?::uuid', filters.reviewerId);
  if (filters.unassigned === true) clauses.push('a.assigned_reviewer_id IS NULL');
  else if (filters.unassigned === false) clauses.push('a.assigned_reviewer_id IS NOT NULL');
  if (filters.ruleCode) push('a.primary_rule_code = ?', filters.ruleCode);
  if (filters.since) push('a.detected_at >= ?::timestamptz', filters.since.toISOString());
  if (filters.until) push('a.detected_at <= ?::timestamptz', filters.until.toISOString());
  if (filters.search) {
    // Search covers the alert's own text plus the customer's email/name and the alert number. One
    // pattern parameter is bound once and referenced by every ILIKE, so the search string can never
    // become SQL and is never interpolated.
    params.push(`%${filters.search}%`);
    const pattern = `$${params.length}`;
    clauses.push(
      `(a.alert_number ILIKE ${pattern} OR a.title ILIKE ${pattern} OR a.explanation ILIKE ${pattern}
        OR a.primary_rule_code ILIKE ${pattern} OR c.email ILIKE ${pattern} OR c.full_name ILIKE ${pattern})`
    );
  }

  const scope = scopeFilter(filters.scope, params);
  const where = [...clauses, scope.replace(/^AND /, '')].filter(Boolean);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sortBy = ALERT_SORT_COLUMNS.includes(filters.sortBy as AlertSortColumn)
    ? (filters.sortBy as AlertSortColumn)
    : 'detected_at';
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT a.*, c.email AS customer_email, c.full_name AS customer_name, r.full_name AS reviewer_name
     FROM fraud_sentinel_alerts a
     LEFT JOIN users c ON c.id = a.customer_id
     LEFT JOIN users r ON r.id = a.assigned_reviewer_id
     ${whereSql}
     ORDER BY a.${sortBy} ${sortDir}, a.id ${sortDir}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, (filters.page - 1) * filters.limit]
  );
  const { rows: countRows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM fraud_sentinel_alerts a
     LEFT JOIN users c ON c.id = a.customer_id
     ${whereSql}`,
    params
  );
  return paginate(rows.map(toAlertRow), countRows[0]?.total ?? 0, filters.page, filters.limit);
}

/**
 * Applies a lifecycle transition. The caller (alert-service) has already asserted the state machine,
 * the permission and the reason requirement; this function only writes the row.
 */
export async function applyAlertTransition(
  tx: Queryable,
  alertId: string,
  patch: {
    status: AlertStatus;
    assignedReviewerId?: string | null;
    resolutionNote?: string | null;
    escalated?: boolean;
  }
): Promise<FraudAlertRow | null> {
  const sets: string[] = ['status = $2', 'updated_at = now()'];
  const params: unknown[] = [alertId, patch.status];

  if (patch.status === 'resolved' || patch.status === 'false_positive') {
    sets.push('resolved_at = now()');
    params.push(patch.resolutionNote ?? null);
    sets.push(`resolution_note = $${params.length}`);
  } else {
    sets.push('resolved_at = NULL', 'resolution_note = NULL');
  }

  if (patch.escalated) sets.push('escalated_at = now()');

  if (patch.assignedReviewerId !== undefined) {
    if (patch.assignedReviewerId === null) {
      sets.push('assigned_reviewer_id = NULL', 'assigned_at = NULL');
    } else {
      params.push(patch.assignedReviewerId);
      sets.push(`assigned_reviewer_id = $${params.length}`, 'assigned_at = now()');
    }
  }

  const { rows } = await tx.query<Record<string, unknown>>(
    `UPDATE fraud_sentinel_alerts SET ${sets.join(', ')} WHERE id = $1::uuid RETURNING *`,
    params
  );
  return rows[0] ? toAlertRow(rows[0]) : null;
}

/** Assigns or unassigns a reviewer without changing status. */
export async function setAlertReviewer(
  tx: Queryable,
  alertId: string,
  reviewerId: string | null
): Promise<FraudAlertRow | null> {
  const { rows } = await tx.query<Record<string, unknown>>(
    reviewerId
      ? `UPDATE fraud_sentinel_alerts
         SET assigned_reviewer_id = $2::uuid, assigned_at = now(), updated_at = now()
         WHERE id = $1::uuid RETURNING *`
      : `UPDATE fraud_sentinel_alerts
         SET assigned_reviewer_id = NULL, assigned_at = NULL, updated_at = now()
         WHERE id = $1::uuid RETURNING *`,
    reviewerId ? [alertId, reviewerId] : [alertId]
  );
  return rows[0] ? toAlertRow(rows[0]) : null;
}
