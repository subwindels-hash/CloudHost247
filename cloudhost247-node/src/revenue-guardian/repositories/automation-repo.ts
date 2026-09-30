/**
 * Automation rules, run history/locking, activity log, and communication log data access
 * (spec §18–§21, §38–§40).
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { ActivityLogRow, AutomationEventType, AutomationRunRow, CommunicationLogRow, Paginated } from '../types';

// ---------------------------------------------------------------------------------------------
// Automation rules
// ---------------------------------------------------------------------------------------------

export interface AutomationRuleRow {
  id: string;
  name: string;
  description: string | null;
  event_type: AutomationEventType;
  conditions_json: Record<string, unknown>;
  actions_json: unknown[];
  enabled: boolean;
  priority: number;
  last_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAutomationRules(db: Queryable, eventType?: AutomationEventType): Promise<AutomationRuleRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (eventType) {
    params.push(eventType);
    where = 'WHERE event_type = $1';
  }
  const { rows } = await db.query<AutomationRuleRow>(
    `SELECT * FROM revenue_guardian_automation_rules ${where} ORDER BY priority ASC, created_at ASC`,
    params
  );
  return rows;
}

export async function insertAutomationRule(
  db: Queryable,
  input: {
    name: string;
    description?: string | null;
    eventType: AutomationEventType;
    conditions: Record<string, unknown>;
    actions: unknown[];
    enabled?: boolean;
    priority?: number;
    createdBy?: string | null;
  }
): Promise<AutomationRuleRow> {
  const { rows } = await db.query<AutomationRuleRow>(
    `INSERT INTO revenue_guardian_automation_rules
       (id, name, description, event_type, conditions_json, actions_json, enabled, priority, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9) RETURNING *`,
    [
      randomUUID(),
      input.name,
      input.description ?? null,
      input.eventType,
      JSON.stringify(input.conditions),
      JSON.stringify(input.actions),
      input.enabled ?? true,
      input.priority ?? 100,
      input.createdBy ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to insert automation rule');
  return row;
}

export async function updateAutomationRule(
  db: Queryable,
  id: string,
  fields: {
    name?: string;
    description?: string | null;
    conditions?: Record<string, unknown>;
    actions?: unknown[];
    enabled?: boolean;
    priority?: number;
    lastRunAt?: Date;
  }
): Promise<AutomationRuleRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (fields.name !== undefined) sets.push(`name = $${push(fields.name)}`);
  if (fields.description !== undefined) sets.push(`description = $${push(fields.description)}`);
  if (fields.conditions !== undefined) sets.push(`conditions_json = $${push(JSON.stringify(fields.conditions))}::jsonb`);
  if (fields.actions !== undefined) sets.push(`actions_json = $${push(JSON.stringify(fields.actions))}::jsonb`);
  if (fields.enabled !== undefined) sets.push(`enabled = $${push(fields.enabled)}`);
  if (fields.priority !== undefined) sets.push(`priority = $${push(fields.priority)}`);
  if (fields.lastRunAt !== undefined) sets.push(`last_run_at = $${push(fields.lastRunAt)}`);
  const { rows } = await db.query<AutomationRuleRow>(
    `UPDATE revenue_guardian_automation_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Assignment rules
// ---------------------------------------------------------------------------------------------

export interface AssignmentRuleRow {
  id: string;
  name: string;
  description: string | null;
  conditions_json: Record<string, unknown>;
  staff_user_id: string;
  assignment_type: string;
  enabled: boolean;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAssignmentRules(db: Queryable, enabledOnly = false): Promise<AssignmentRuleRow[]> {
  const { rows } = await db.query<AssignmentRuleRow>(
    `SELECT * FROM revenue_guardian_assignment_rules ${enabledOnly ? 'WHERE enabled = true' : ''}
      ORDER BY priority ASC, created_at ASC`
  );
  return rows;
}

export async function insertAssignmentRule(
  db: Queryable,
  input: {
    name: string;
    description?: string | null;
    conditions: Record<string, unknown>;
    staffUserId: string;
    assignmentType: string;
    enabled?: boolean;
    priority?: number;
    createdBy?: string | null;
  }
): Promise<AssignmentRuleRow> {
  const { rows } = await db.query<AssignmentRuleRow>(
    `INSERT INTO revenue_guardian_assignment_rules
       (id, name, description, conditions_json, staff_user_id, assignment_type, enabled, priority, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) RETURNING *`,
    [
      randomUUID(),
      input.name,
      input.description ?? null,
      JSON.stringify(input.conditions),
      input.staffUserId,
      input.assignmentType,
      input.enabled ?? true,
      input.priority ?? 100,
      input.createdBy ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to insert assignment rule');
  return row;
}

export async function updateAssignmentRule(
  db: Queryable,
  id: string,
  fields: { name?: string; description?: string | null; conditions?: Record<string, unknown>; staffUserId?: string; assignmentType?: string; enabled?: boolean; priority?: number }
): Promise<AssignmentRuleRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (fields.name !== undefined) sets.push(`name = $${push(fields.name)}`);
  if (fields.description !== undefined) sets.push(`description = $${push(fields.description)}`);
  if (fields.conditions !== undefined) sets.push(`conditions_json = $${push(JSON.stringify(fields.conditions))}::jsonb`);
  if (fields.staffUserId !== undefined) sets.push(`staff_user_id = $${push(fields.staffUserId)}`);
  if (fields.assignmentType !== undefined) sets.push(`assignment_type = $${push(fields.assignmentType)}`);
  if (fields.enabled !== undefined) sets.push(`enabled = $${push(fields.enabled)}`);
  if (fields.priority !== undefined) sets.push(`priority = $${push(fields.priority)}`);
  const { rows } = await db.query<AssignmentRuleRow>(
    `UPDATE revenue_guardian_assignment_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Automation runs — the run_key UNIQUE index doubles as the concurrency lock (spec §20, §50).
// ---------------------------------------------------------------------------------------------

/**
 * Claims a run. Returns null when another worker already holds/completed this run_key —
 * the caller must then skip the job (never run it twice).
 */
export async function claimRun(
  db: Queryable,
  jobName: string,
  runKey: string,
  trigger: 'schedule' | 'manual',
  triggeredBy: string | null
): Promise<AutomationRunRow | null> {
  const { rows } = await db.query<AutomationRunRow>(
    `INSERT INTO revenue_guardian_automation_runs (id, job_name, run_key, trigger, triggered_by, status)
     VALUES ($1,$2,$3,$4,$5,'running')
     ON CONFLICT (run_key) DO NOTHING
     RETURNING *`,
    [randomUUID(), jobName, runKey, trigger, triggeredBy]
  );
  return rows[0] ?? null;
}

export async function finishRun(
  db: Queryable,
  runId: string,
  outcome: {
    status: 'completed' | 'failed';
    processed: number;
    created: number;
    skipped: number;
    failed: number;
    notificationsSent: number;
    error?: string | null;
    durationMs: number;
  }
): Promise<void> {
  await db.query(
    `UPDATE revenue_guardian_automation_runs
        SET status = $2, finished_at = now(), duration_ms = $3, processed_count = $4,
            created_count = $5, skipped_count = $6, failed_count = $7, notifications_sent = $8,
            error = $9
      WHERE id = $1`,
    [
      runId,
      outcome.status,
      outcome.durationMs,
      outcome.processed,
      outcome.created,
      outcome.skipped,
      outcome.failed,
      outcome.notificationsSent,
      outcome.error ?? null,
    ]
  );
}

export async function listRuns(
  db: Queryable,
  filters: { page?: number; limit?: number; jobName?: string; status?: string }
): Promise<Paginated<AutomationRunRow>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (filters.jobName) where.push(`job_name = $${push(filters.jobName)}`);
  if (filters.status) where.push(`status = $${push(filters.status)}`);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM revenue_guardian_automation_runs ${whereSql}`,
    params
  );
  const { rows } = await db.query<AutomationRunRow>(
    `SELECT * FROM revenue_guardian_automation_runs ${whereSql}
      ORDER BY started_at DESC LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}

/** Marks long-running 'running' rows as failed (crashed worker) so locks don't wedge forever. */
export async function failStaleRuns(db: Queryable, olderThanMinutes = 60): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE revenue_guardian_automation_runs
        SET status = 'failed', finished_at = now(), error = 'Run did not complete (stale lock reclaimed)'
      WHERE status = 'running' AND started_at < now() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(olderThanMinutes)]
  );
  return rows.length;
}

// ---------------------------------------------------------------------------------------------
// Activity log (append-only)
// ---------------------------------------------------------------------------------------------

export interface RecordActivityInput {
  customerId?: string | null;
  caseId?: string | null;
  invoiceId?: string | null;
  followUpId?: string | null;
  promiseId?: string | null;
  actorId?: string | null;
  actorType?: 'staff' | 'system' | 'customer';
  eventType: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export async function recordActivity(db: Queryable, input: RecordActivityInput): Promise<void> {
  await db.query(
    `INSERT INTO revenue_guardian_activity_log
       (id, customer_id, case_id, invoice_id, follow_up_id, promise_id, actor_id, actor_type, event_type, description, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      randomUUID(),
      input.customerId ?? null,
      input.caseId ?? null,
      input.invoiceId ?? null,
      input.followUpId ?? null,
      input.promiseId ?? null,
      input.actorId ?? null,
      input.actorType ?? (input.actorId ? 'staff' : 'system'),
      input.eventType,
      input.description,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}

export interface ActivityWithContext extends ActivityLogRow {
  actor_email: string | null;
  customer_email: string | null;
  case_number: string | null;
}

export async function listActivities(
  db: Queryable,
  filters: {
    page?: number;
    limit?: number;
    customerId?: string;
    caseId?: string;
    invoiceId?: string;
    actorId?: string;
    eventType?: string;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<Paginated<ActivityWithContext>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (filters.customerId) where.push(`a.customer_id = $${push(filters.customerId)}`);
  if (filters.caseId) where.push(`a.case_id = $${push(filters.caseId)}`);
  if (filters.invoiceId) where.push(`a.invoice_id = $${push(filters.invoiceId)}`);
  if (filters.actorId) where.push(`a.actor_id = $${push(filters.actorId)}`);
  if (filters.eventType) where.push(`a.event_type = $${push(filters.eventType)}`);
  if (filters.dateFrom) where.push(`a.created_at >= $${push(filters.dateFrom)}`);
  if (filters.dateTo) where.push(`a.created_at <= $${push(filters.dateTo)}`);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM revenue_guardian_activity_log a ${whereSql}`,
    params
  );
  const { rows } = await db.query<ActivityWithContext>(
    `SELECT a.*, au.email AS actor_email, cu.email AS customer_email, c.case_number
       FROM revenue_guardian_activity_log a
       LEFT JOIN users au ON au.id = a.actor_id
       LEFT JOIN users cu ON cu.id = a.customer_id
       LEFT JOIN revenue_guardian_recovery_cases c ON c.id = a.case_id
      ${whereSql} ORDER BY a.created_at DESC LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}

// ---------------------------------------------------------------------------------------------
// Communication log
// ---------------------------------------------------------------------------------------------

export interface RecordCommunicationInput {
  customerId?: string | null;
  caseId?: string | null;
  invoiceId?: string | null;
  channel: 'email' | 'whatsapp';
  recipient: string;
  templateKey: string;
  subject: string;
  body?: string | null;
  provider?: string | null;
  status: string;
  failureReason?: string | null;
  notificationId?: string | null;
  dedupeKey?: string | null;
  createdBy?: string | null;
}

/** Returns null on a dedupe_key conflict — the communication was already queued (spec §75). */
export async function recordCommunication(db: Queryable, input: RecordCommunicationInput): Promise<CommunicationLogRow | null> {
  const { rows } = await db.query<CommunicationLogRow>(
    `INSERT INTO revenue_guardian_communication_log
       (id, customer_id, case_id, invoice_id, channel, recipient, template_key, subject, body,
        provider, status, failure_reason, notification_id, dedupe_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      input.customerId ?? null,
      input.caseId ?? null,
      input.invoiceId ?? null,
      input.channel,
      input.recipient,
      input.templateKey,
      input.subject,
      input.body ?? null,
      input.provider ?? null,
      input.status,
      input.failureReason ?? null,
      input.notificationId ?? null,
      input.dedupeKey ?? null,
      input.createdBy ?? null,
    ]
  );
  return rows[0] ?? null;
}

export interface CommunicationWithContext extends CommunicationLogRow {
  customer_email: string | null;
  case_number: string | null;
  /** Honest delivery state read from the notification pipeline when this row rode it. */
  outbox_status: string | null;
  outbox_error: string | null;
}

export async function listCommunications(
  db: Queryable,
  filters: { page?: number; limit?: number; customerId?: string; caseId?: string; status?: string; channel?: string }
): Promise<Paginated<CommunicationWithContext>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (filters.customerId) where.push(`m.customer_id = $${push(filters.customerId)}`);
  if (filters.caseId) where.push(`m.case_id = $${push(filters.caseId)}`);
  if (filters.status) where.push(`m.status = $${push(filters.status)}`);
  if (filters.channel) where.push(`m.channel = $${push(filters.channel)}`);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM revenue_guardian_communication_log m ${whereSql}`,
    params
  );
  const { rows } = await db.query<CommunicationWithContext>(
    `SELECT m.*, cu.email AS customer_email, c.case_number,
            o.status AS outbox_status, o.last_error AS outbox_error
       FROM revenue_guardian_communication_log m
       LEFT JOIN users cu ON cu.id = m.customer_id
       LEFT JOIN revenue_guardian_recovery_cases c ON c.id = m.case_id
       LEFT JOIN notification_outbox o ON o.notification_id = m.notification_id
      ${whereSql} ORDER BY m.created_at DESC LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}
