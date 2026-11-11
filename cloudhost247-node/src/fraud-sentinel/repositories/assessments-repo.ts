/**
 * Assessment and risk-history storage.
 *
 * An assessment is written once and never edited (except to be marked `superseded` by a later one for
 * the same subject). That immutability is what makes "reproducible from recorded evidence and rule
 * versions" true rather than aspirational: the triggered rules, the weights credited, the evidence
 * pointers, the data-quality flags and the rule-set fingerprint are all frozen on the row.
 *
 * Writing an assessment does three things in the caller's transaction:
 *   1. mark the previous active assessment for the subject `superseded`,
 *   2. insert the new assessment with previous_score / previous_level / previous_assessment_id,
 *   3. append one immutable `fraud_sentinel_risk_history` row (the time series behind the customer
 *      risk profile and the "historical risk changes" requirement).
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type {
  AssessmentResult,
  AssessmentStatus,
  ConfidenceLevel,
  DataQualityFlag,
  EvidenceRef,
  FamilyContribution,
  FraudAssessmentRow,
  FraudRiskHistoryRow,
  FraudScope,
  Paginated,
  RiskLevel,
  SubjectType,
  TriggeredRule,
} from '../types';
import { paginate, splitSubjectIdentity } from '../types';

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function toAssessmentRow(row: Record<string, unknown>): FraudAssessmentRow {
  return {
    id: String(row.id),
    subject_type: row.subject_type as SubjectType,
    subject_id: toText(row.subject_id),
    subject_label: toText(row.subject_label),
    customer_id: toText(row.customer_id),
    risk_score: Number(row.risk_score),
    risk_level: row.risk_level as RiskLevel,
    previous_score: toNumberOrNull(row.previous_score),
    previous_level: (row.previous_level as RiskLevel | null) ?? null,
    previous_assessment_id: toText(row.previous_assessment_id),
    triggered_rules: asArray<TriggeredRule>(row.triggered_rules),
    family_contributions: asArray<FamilyContribution>(row.family_contributions),
    evidence: asArray<EvidenceRef>(row.evidence),
    recommendations: asArray<string>(row.recommendations),
    confidence: row.confidence as ConfidenceLevel,
    data_quality: asArray<DataQualityFlag>(row.data_quality),
    rule_set_version: String(row.rule_set_version),
    scoring_version: Number(row.scoring_version),
    window_started_at: String(row.window_started_at),
    window_ended_at: String(row.window_ended_at),
    events_examined: Number(row.events_examined ?? 0),
    status: row.status as AssessmentStatus,
    ai_summary: toText(row.ai_summary),
    ai_assisted: row.ai_assisted === true,
    ai_engine: toText(row.ai_engine),
    assessed_at: String(row.assessed_at),
    created_at: String(row.created_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface InsertAssessmentResult {
  assessment: FraudAssessmentRow;
  previousAssessmentId: string | null;
  scoreChanged: boolean;
}

/** The most recent ACTIVE assessment for a subject, or null when it has never been assessed. */
export async function findLatestActiveAssessment(
  db: Queryable,
  subject: { subjectType: SubjectType; subjectId: string | null; customerId: string | null }
): Promise<FraudAssessmentRow | null> {
  // A customer subject keys on customer_id, so an assessment survives a subject_id change and the
  // customer risk profile has exactly one active row per customer.
  if (subject.subjectType === 'customer' && subject.customerId) {
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM fraud_sentinel_assessments
       WHERE subject_type = 'customer' AND customer_id = $1::uuid AND status = 'active'
       ORDER BY assessed_at DESC, id DESC
       LIMIT 1`,
      [subject.customerId]
    );
    return rows[0] ? toAssessmentRow(rows[0]) : null;
  }
  const identity = splitSubjectIdentity(subject.subjectType, subject.subjectId);
  const { rows } = await db.query<Record<string, unknown>>(
    identity.subjectId
      ? `SELECT * FROM fraud_sentinel_assessments
         WHERE subject_type = $1 AND subject_id = $2::uuid AND status = 'active'
         ORDER BY assessed_at DESC, id DESC
         LIMIT 1`
      : `SELECT * FROM fraud_sentinel_assessments
         WHERE subject_type = $1 AND subject_label = $2 AND status = 'active'
         ORDER BY assessed_at DESC, id DESC
         LIMIT 1`,
    [subject.subjectType, identity.subjectId ?? identity.subjectLabel]
  );
  return rows[0] ? toAssessmentRow(rows[0]) : null;
}

/**
 * Persists an assessment result: supersedes the previous active one, inserts the new row, and appends
 * the risk-history point. Must be called inside a transaction so the three writes cannot partially
 * apply — a superseded predecessor with no successor would lose the current score entirely.
 */
export async function insertAssessment(
  tx: Queryable,
  result: AssessmentResult,
  options: { assessedAt?: Date; aiSummary?: string | null; aiEngine?: string | null } = {}
): Promise<InsertAssessmentResult> {
  const id = randomUUID();
  const identity = splitSubjectIdentity(result.subjectType, result.subjectId);
  const previous = await findLatestActiveAssessment(tx, {
    subjectType: result.subjectType,
    subjectId: result.subjectId,
    customerId: result.customerId,
  });

  if (previous) {
    await tx.query(
      `UPDATE fraud_sentinel_assessments
       SET status = 'superseded'
       WHERE id = $1::uuid AND status = 'active'`,
      [previous.id]
    );
  }

  const aiSummary = options.aiSummary ?? null;
  const aiEngine = options.aiEngine ?? null;
  // The CHECK constraint requires an engine name whenever ai_assisted is true; an assistant summary
  // with no attributable engine would be an unattributable claim.
  const aiAssisted = aiSummary !== null && aiEngine !== null;

  const { rows } = await tx.query<Record<string, unknown>>(
    `INSERT INTO fraud_sentinel_assessments (
       id, subject_type, subject_id, subject_label, customer_id, risk_score, risk_level,
       previous_score, previous_level, previous_assessment_id,
       triggered_rules, family_contributions, evidence, recommendations, confidence, data_quality,
       rule_set_version, scoring_version, window_started_at, window_ended_at, events_examined,
       status, ai_summary, ai_assisted, ai_engine, assessed_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16::jsonb,
       $17,$18,$19::timestamptz,$20::timestamptz,$21,'active',$22,$23,$24,$25
     ) RETURNING *`,
    [
      id,
      result.subjectType,
      identity.subjectId,
      identity.subjectLabel,
      result.customerId,
      result.riskScore,
      result.riskLevel,
      result.previousScore,
      result.previousLevel,
      previous?.id ?? null,
      JSON.stringify(result.triggeredRules),
      JSON.stringify(result.familyContributions),
      JSON.stringify(result.evidence),
      JSON.stringify(result.recommendations),
      result.confidence,
      JSON.stringify(result.dataQuality),
      result.ruleSetVersion,
      result.scoringVersion,
      result.windowStartedAt,
      result.windowEndedAt,
      result.eventsExamined,
      aiSummary,
      aiAssisted,
      aiEngine,
      (options.assessedAt ?? new Date()).toISOString(),
    ]
  );

  const assessment = toAssessmentRow(rows[0] as Record<string, unknown>);

  const primary = [...result.triggeredRules].sort((a, b) => {
    if (b.cappedWeight !== a.cappedWeight) return b.cappedWeight - a.cappedWeight;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  })[0];

  await tx.query(
    `INSERT INTO fraud_sentinel_risk_history (
       id, customer_id, subject_type, subject_id, subject_label, assessment_id, risk_score, risk_level,
       previous_score, previous_level, primary_reason_code, rule_set_version, recorded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      randomUUID(),
      result.customerId,
      result.subjectType,
      identity.subjectId,
      identity.subjectLabel,
      assessment.id,
      result.riskScore,
      result.riskLevel,
      result.previousScore,
      result.previousLevel,
      primary?.code ?? null,
      result.ruleSetVersion,
      (options.assessedAt ?? new Date()).toISOString(),
    ]
  );

  return {
    assessment,
    previousAssessmentId: previous?.id ?? null,
    scoreChanged: previous ? previous.risk_score !== result.riskScore : true,
  };
}

/**
 * Attaches an AI-assisted narrative to an EXISTING assessment.
 *
 * This is the only mutation an assessment ever receives besides being superseded, and it can only
 * touch the three ai_* columns: risk_score, risk_level, triggered_rules and evidence are not in the
 * UPDATE statement at all, so the assistant layer is structurally incapable of changing a finding.
 */
export async function attachAiSummary(
  db: Queryable,
  assessmentId: string,
  summary: string,
  engine: string
): Promise<FraudAssessmentRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE fraud_sentinel_assessments
     SET ai_summary = $2, ai_assisted = true, ai_engine = $3
     WHERE id = $1::uuid
     RETURNING *`,
    [assessmentId, summary, engine]
  );
  return rows[0] ? toAssessmentRow(rows[0]) : null;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface AssessmentFilters {
  page: number;
  limit: number;
  customerId?: string | null;
  subjectType?: SubjectType | null;
  riskLevel?: RiskLevel | null;
  minScore?: number | null;
  status?: AssessmentStatus | null;
  since?: Date | null;
  until?: Date | null;
  ruleCode?: string | null;
  scope: FraudScope;
}

/**
 * The customer-isolation boundary for assessment reads.
 *
 * A scoped (non-admin) caller sees only assessments about their own customer id. Assessments whose
 * subject is an IP, an administrator or a webhook gateway have no customer_id and are therefore
 * invisible to a scoped caller by construction — they are platform-level subjects that only an
 * administrator with an unrestricted scope may investigate.
 * An empty customer list yields `false`, i.e. a CLOSED scope that matches nothing.
 *
 * The column is always qualified with the reading query's alias. `users` also has a `customer_id`
 * (the customer number) and a `status`, so an unqualified reference in a query that joins `users` is
 * ambiguous and Postgres rejects the statement outright — which would break the scoped path for the
 * one caller the scope exists to protect.
 */
function scopeClause(scope: FraudScope, params: unknown[], alias: string): string {
  if (scope.unrestricted) return '';
  if (scope.customerIds.length === 0) return 'AND false';
  params.push([...scope.customerIds]);
  return `AND ${alias}.customer_id = ANY($${params.length}::uuid[])`;
}

export async function listAssessments(db: Queryable, filters: AssessmentFilters): Promise<Paginated<FraudAssessmentRow>> {
  const params: unknown[] = [];
  const clauses: string[] = [];

  const push = (clause: string, value: unknown) => {
    params.push(value);
    clauses.push(clause.replace('?', `$${params.length}`));
  };

  if (filters.customerId) push('a.customer_id = ?::uuid', filters.customerId);
  if (filters.subjectType) push('a.subject_type = ?', filters.subjectType);
  if (filters.riskLevel) push('a.risk_level = ?', filters.riskLevel);
  if (filters.minScore !== null && filters.minScore !== undefined) push('a.risk_score >= ?', filters.minScore);
  if (filters.status) push('a.status = ?', filters.status);
  if (filters.since) push('a.assessed_at >= ?::timestamptz', filters.since.toISOString());
  if (filters.until) push('a.assessed_at <= ?::timestamptz', filters.until.toISOString());
  if (filters.ruleCode) push('a.triggered_rules @> ?::jsonb', JSON.stringify([{ code: filters.ruleCode }]));

  const scope = scopeClause(filters.scope, params, 'a');
  const where = clauses.length > 0 || scope ? `WHERE ${[...clauses, scope.replace(/^AND /, '')].filter(Boolean).join(' AND ')}` : '';

  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT a.*, u.email AS customer_email
     FROM fraud_sentinel_assessments a
     LEFT JOIN users u ON u.id = a.customer_id
     ${where}
     ORDER BY a.assessed_at DESC, a.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, (filters.page - 1) * filters.limit]
  );
  const { rows: countRows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM fraud_sentinel_assessments a ${where}`,
    params
  );
  return paginate(
    rows.map((row) => {
      const assessment = toAssessmentRow(row);
      assessment.customer_email = toText(row.customer_email);
      return assessment;
    }),
    countRows[0]?.total ?? 0,
    filters.page,
    filters.limit
  );
}

export async function findAssessmentById(db: Queryable, id: string, scope: FraudScope): Promise<FraudAssessmentRow | null> {
  const params: unknown[] = [id];
  const scopeFilter = scopeClause(scope, params, 'a');
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT a.*, u.email AS customer_email, u.full_name AS customer_name
     FROM fraud_sentinel_assessments a
     LEFT JOIN users u ON u.id = a.customer_id
     WHERE a.id = $1::uuid ${scopeFilter}`,
    params
  );
  const row = rows[0];
  if (!row) return null;
  const assessment = toAssessmentRow(row);
  assessment.customer_email = toText(row.customer_email);
  return assessment;
}

/** The risk-score time series for one subject — "historical risk changes". */
export async function listRiskHistory(
  db: Queryable,
  options: {
    customerId?: string | null;
    subjectType?: SubjectType | null;
    subjectId?: string | null;
    /** The IP address or gateway name for non-uuid subjects. */
    subjectLabel?: string | null;
    limit: number;
    scope: FraudScope;
  }
): Promise<FraudRiskHistoryRow[]> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const push = (clause: string, value: unknown) => {
    params.push(value);
    clauses.push(clause.replace('?', `$${params.length}`));
  };
  if (options.customerId) push('h.customer_id = ?::uuid', options.customerId);
  if (options.subjectType) push('h.subject_type = ?', options.subjectType);
  if (options.subjectId) push('h.subject_id = ?::uuid', options.subjectId);
  if (options.subjectLabel) push('h.subject_label = ?', options.subjectLabel);
  const scope = scopeClause(options.scope, params, 'h');
  const where = [...clauses, scope.replace(/^AND /, '')].filter(Boolean);
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT h.* FROM fraud_sentinel_risk_history h
     ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY h.recorded_at DESC, h.id DESC
     LIMIT $${params.length + 1}`,
    [...params, options.limit]
  );
  return rows.map((row) => ({
    id: String(row.id),
    customer_id: toText(row.customer_id),
    subject_type: row.subject_type as SubjectType,
    subject_id: toText(row.subject_id),
    subject_label: toText(row.subject_label),
    assessment_id: toText(row.assessment_id),
    risk_score: Number(row.risk_score),
    risk_level: row.risk_level as RiskLevel,
    previous_score: toNumberOrNull(row.previous_score),
    previous_level: (row.previous_level as RiskLevel | null) ?? null,
    primary_reason_code: toText(row.primary_reason_code),
    rule_set_version: String(row.rule_set_version),
    recorded_at: String(row.recorded_at),
  }));
}

/* -------------------------------------------------------------------------- */
/* Retention                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Prunes superseded assessments older than the retention horizon.
 *
 * Two protections: an assessment an alert still points at is excluded here AND backed by
 * ON DELETE RESTRICT, so the evidence basis of every alert — open or closed — always survives. The
 * risk-history point keeps its score and level but loses its assessment_id (ON DELETE SET NULL):
 * pruning the bulky superseded payload must not erase the fact that the score existed.
 */
export async function pruneSupersededAssessments(db: Queryable, olderThan: Date): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM fraud_sentinel_assessments a
     WHERE a.status = 'superseded'
       AND a.assessed_at < $1::timestamptz
       AND NOT EXISTS (SELECT 1 FROM fraud_sentinel_alerts al WHERE al.assessment_id = a.id)
     RETURNING a.id`,
    [olderThan.toISOString()]
  );
  return rows.length;
}

/** Prunes risk-history points older than the retention horizon. */
export async function pruneRiskHistory(db: Queryable, olderThan: Date): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM fraud_sentinel_risk_history WHERE recorded_at < $1::timestamptz RETURNING id`,
    [olderThan.toISOString()]
  );
  return rows.length;
}
