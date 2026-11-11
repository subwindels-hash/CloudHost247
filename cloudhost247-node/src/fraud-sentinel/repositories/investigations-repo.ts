/**
 * Investigation timeline and false-positive reports.
 *
 * The investigation table is an append-only log: every status change, assignment, note, escalation and
 * false-positive report on an alert produces exactly one row here, written in the SAME transaction as
 * the alert mutation it describes. That pairing is the audit requirement — an alert whose history says
 * "resolved" with no row explaining who resolved it and why would be an unattributable change.
 *
 * Nothing in this file decides whether a transition is legal. `rules/transitions.ts` owns the state
 * machine and `services/alert-service.ts` calls it; this module only persists what was decided.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type {
  AlertStatus,
  FalsePositiveReason,
  FraudFalsePositiveRow,
  FraudInvestigationRow,
  FraudScope,
  InvestigationAction,
  Paginated,
} from '../types';
import { paginate } from '../types';

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

export function toInvestigationRow(row: Record<string, unknown>): FraudInvestigationRow {
  return {
    id: String(row.id),
    alert_id: String(row.alert_id),
    assessment_id: toText(row.assessment_id),
    actor_id: toText(row.actor_id),
    actor_type: row.actor_type === 'system' ? 'system' : 'staff',
    action: row.action as InvestigationAction,
    from_status: (row.from_status as AlertStatus | null) ?? null,
    to_status: (row.to_status as AlertStatus | null) ?? null,
    note: toText(row.note),
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
    created_at: String(row.created_at),
    ...(row.actor_name !== undefined ? { actor_name: toText(row.actor_name) } : {}),
  };
}

export function toFalsePositiveRow(row: Record<string, unknown>): FraudFalsePositiveRow {
  return {
    id: String(row.id),
    alert_id: String(row.alert_id),
    assessment_id: toText(row.assessment_id),
    rule_codes: Array.isArray(row.rule_codes) ? (row.rule_codes as string[]).map(String) : [],
    reported_by: toText(row.reported_by),
    reason_category: row.reason_category as FalsePositiveReason,
    explanation: String(row.explanation),
    created_at: String(row.created_at),
    ...(row.reported_by_name !== undefined ? { reported_by_name: toText(row.reported_by_name) } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Investigation timeline                                                      */
/* -------------------------------------------------------------------------- */

export interface NewInvestigationEntry {
  alertId: string;
  assessmentId?: string | null;
  /** Null for system-written entries (the scan job), which set actorType 'system'. */
  actorId?: string | null;
  actorType?: 'staff' | 'system';
  action: InvestigationAction;
  fromStatus?: AlertStatus | null;
  toStatus?: AlertStatus | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Appends one timeline entry. Caller supplies the transaction that also mutates the alert, so the
 * action and its record commit together or not at all.
 *
 * `actorType` defaults to 'system' when no actorId is given: an entry with a staff actor but no actor
 * id would claim a human did something without naming them.
 */
export async function insertInvestigationEntry(
  tx: Queryable,
  entry: NewInvestigationEntry
): Promise<FraudInvestigationRow> {
  const actorId = entry.actorId ?? null;
  const actorType = entry.actorType ?? (actorId ? 'staff' : 'system');
  const { rows } = await tx.query<Record<string, unknown>>(
    `INSERT INTO fraud_sentinel_investigations (
       id, alert_id, assessment_id, actor_id, actor_type, action, from_status, to_status, note, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING *`,
    [
      randomUUID(),
      entry.alertId,
      entry.assessmentId ?? null,
      actorId,
      actorType,
      entry.action,
      entry.fromStatus ?? null,
      entry.toStatus ?? null,
      entry.note ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ]
  );
  return toInvestigationRow(rows[0] as Record<string, unknown>);
}

export async function listInvestigationsForAlert(
  db: Queryable,
  alertId: string,
  options: { limit: number }
): Promise<FraudInvestigationRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT i.*, u.full_name AS actor_name
     FROM fraud_sentinel_investigations i
     LEFT JOIN users u ON u.id = i.actor_id
     WHERE i.alert_id = $1::uuid
     ORDER BY i.created_at ASC, i.id ASC
     LIMIT $2`,
    [alertId, Math.max(1, Math.floor(options.limit))]
  );
  return rows.map(toInvestigationRow);
}

export interface InvestigationFilters {
  page: number;
  limit: number;
  alertId?: string | null;
  actorId?: string | null;
  action?: InvestigationAction | null;
  customerId?: string | null;
  since?: Date | null;
  until?: Date | null;
  scope: FraudScope;
}

/**
 * Investigation history across alerts, for the dashboard's "investigation history" screen.
 *
 * Scoped callers are filtered through the alert's customer_id, so a customer can only ever read the
 * timeline of their own alerts even though investigation rows carry no customer_id themselves.
 */
export async function listInvestigations(
  db: Queryable,
  filters: InvestigationFilters
): Promise<Paginated<FraudInvestigationRow>> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const push = (clause: string, value: unknown) => {
    params.push(value);
    clauses.push(clause.replace('?', `$${params.length}`));
  };

  if (filters.alertId) push('i.alert_id = ?::uuid', filters.alertId);
  if (filters.actorId) push('i.actor_id = ?::uuid', filters.actorId);
  if (filters.action) push('i.action = ?', filters.action);
  if (filters.customerId) push('a.customer_id = ?::uuid', filters.customerId);
  if (filters.since) push('i.created_at >= ?::timestamptz', filters.since.toISOString());
  if (filters.until) push('i.created_at <= ?::timestamptz', filters.until.toISOString());

  if (!filters.scope.unrestricted) {
    if (filters.scope.customerIds.length === 0) {
      // CLOSED SCOPE: an empty customer list matches nothing rather than everything.
      clauses.push('false');
    } else {
      params.push([...filters.scope.customerIds]);
      clauses.push(`a.customer_id = ANY($${params.length}::uuid[])`);
    }
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT i.*, u.full_name AS actor_name, i.note
     FROM fraud_sentinel_investigations i
     INNER JOIN fraud_sentinel_alerts a ON a.id = i.alert_id
     LEFT JOIN users u ON u.id = i.actor_id
     ${whereSql}
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, (filters.page - 1) * filters.limit]
  );
  const { rows: countRows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM fraud_sentinel_investigations i
     INNER JOIN fraud_sentinel_alerts a ON a.id = i.alert_id
     ${whereSql}`,
    params
  );
  return paginate(rows.map(toInvestigationRow), countRows[0]?.total ?? 0, filters.page, filters.limit);
}

/* -------------------------------------------------------------------------- */
/* False-positive reports                                                      */
/* -------------------------------------------------------------------------- */

export interface NewFalsePositiveReport {
  alertId: string;
  assessmentId?: string | null;
  /** The rule codes the reporter is disputing; empty means the whole assessment. */
  ruleCodes: readonly string[];
  reportedBy: string | null;
  reasonCategory: FalsePositiveReason;
  explanation: string;
}

export interface InsertFalsePositiveResult {
  report: FraudFalsePositiveRow;
  /** True when this alert had already been reported before — the UNIQUE index makes that a no-op. */
  alreadyReported: boolean;
}

/**
 * Records a false-positive report.
 *
 * The table has UNIQUE(alert_id), so one alert yields at most one report. Re-reporting returns the
 * existing row instead of failing or silently replacing the reviewer's original reasoning: the first
 * report is the record of why the detection was disputed, and overwriting it would let a later user
 * erase an earlier user's justification.
 */
export async function insertFalsePositiveReport(
  tx: Queryable,
  report: NewFalsePositiveReport
): Promise<InsertFalsePositiveResult> {
  const id = randomUUID();
  const { rows } = await tx.query<Record<string, unknown>>(
    `INSERT INTO fraud_sentinel_false_positives (
       id, alert_id, assessment_id, rule_codes, reported_by, reason_category, explanation
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
     ON CONFLICT (alert_id) DO NOTHING
     RETURNING *`,
    [
      id,
      report.alertId,
      report.assessmentId ?? null,
      JSON.stringify([...report.ruleCodes]),
      report.reportedBy,
      report.reasonCategory,
      report.explanation,
    ]
  );

  if (rows[0]) return { report: toFalsePositiveRow(rows[0]), alreadyReported: false };

  const existing = await findFalsePositiveByAlert(tx, report.alertId);
  if (!existing) {
    throw new Error(
      `insertFalsePositiveReport: conflict on alert ${report.alertId} but no report row exists`
    );
  }
  return { report: existing, alreadyReported: true };
}

export async function findFalsePositiveByAlert(
  db: Queryable,
  alertId: string
): Promise<FraudFalsePositiveRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT f.*, u.full_name AS reported_by_name
     FROM fraud_sentinel_false_positives f
     LEFT JOIN users u ON u.id = f.reported_by
     WHERE f.alert_id = $1::uuid
     LIMIT 1`,
    [alertId]
  );
  return rows[0] ? toFalsePositiveRow(rows[0]) : null;
}

export interface FalsePositiveFilters {
  page: number;
  limit: number;
  reasonCategory?: FalsePositiveReason | null;
  ruleCode?: string | null;
  reportedBy?: string | null;
  since?: Date | null;
  until?: Date | null;
  scope: FraudScope;
}

/**
 * False-positive reports across alerts — the feedback loop that tells an administrator which rules
 * are producing noise. Scoped through the alert's customer_id, as for investigations.
 */
export async function listFalsePositives(
  db: Queryable,
  filters: FalsePositiveFilters
): Promise<Paginated<FraudFalsePositiveRow>> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const push = (clause: string, value: unknown) => {
    params.push(value);
    clauses.push(clause.replace('?', `$${params.length}`));
  };

  if (filters.reasonCategory) push('f.reason_category = ?', filters.reasonCategory);
  if (filters.ruleCode) push('f.rule_codes @> ?::jsonb', JSON.stringify([filters.ruleCode]));
  if (filters.reportedBy) push('f.reported_by = ?::uuid', filters.reportedBy);
  if (filters.since) push('f.created_at >= ?::timestamptz', filters.since.toISOString());
  if (filters.until) push('f.created_at <= ?::timestamptz', filters.until.toISOString());

  if (!filters.scope.unrestricted) {
    if (filters.scope.customerIds.length === 0) clauses.push('false');
    else {
      params.push([...filters.scope.customerIds]);
      clauses.push(`a.customer_id = ANY($${params.length}::uuid[])`);
    }
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT f.*, u.full_name AS reported_by_name
     FROM fraud_sentinel_false_positives f
     INNER JOIN fraud_sentinel_alerts a ON a.id = f.alert_id
     LEFT JOIN users u ON u.id = f.reported_by
     ${whereSql}
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, (filters.page - 1) * filters.limit]
  );
  const { rows: countRows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM fraud_sentinel_false_positives f
     INNER JOIN fraud_sentinel_alerts a ON a.id = f.alert_id
     ${whereSql}`,
    params
  );
  return paginate(rows.map(toFalsePositiveRow), countRows[0]?.total ?? 0, filters.page, filters.limit);
}

/** False-positive counts per rule code over a window — the "which rules are noisy" signal. */
export async function falsePositiveCountsByRule(
  db: Queryable,
  options: { since: Date; until: Date; scope: FraudScope }
): Promise<Array<{ ruleCode: string; reports: number }>> {
  const params: unknown[] = [options.since.toISOString(), options.until.toISOString()];
  let scope = '';
  if (!options.scope.unrestricted) {
    if (options.scope.customerIds.length === 0) return [];
    params.push([...options.scope.customerIds]);
    scope = `AND a.customer_id = ANY($${params.length}::uuid[])`;
  }
  const { rows } = await db.query<{ rule_code: string; reports: number }>(
    `SELECT code.rule_code, count(*)::int AS reports
     FROM fraud_sentinel_false_positives f
     INNER JOIN fraud_sentinel_alerts a ON a.id = f.alert_id
     CROSS JOIN LATERAL jsonb_array_elements_text(f.rule_codes) AS code(rule_code)
     WHERE f.created_at >= $1::timestamptz AND f.created_at <= $2::timestamptz ${scope}
     GROUP BY code.rule_code
     ORDER BY reports DESC, code.rule_code ASC`,
    params
  );
  return rows.map((row) => ({ ruleCode: String(row.rule_code), reports: Number(row.reports) }));
}
