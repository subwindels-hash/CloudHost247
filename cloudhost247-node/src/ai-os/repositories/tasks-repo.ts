/** Tasks / runs / steps / tool-call persistence — the observable execution spine. */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { RunPhase, RunRow, RunStatus, RunStepRow, TaskRow, ToolCallRow } from '../types';

export interface CreateTaskInput {
  agentId: string;
  taskType: string;
  subjectType?: string | null;
  subjectId?: string | null;
  context?: Record<string, unknown>;
  priority?: string;
  requestedBy?: string | null;
  requestedByType: 'staff' | 'customer' | 'system' | 'schedule' | 'workflow' | 'board';
  customerId?: string | null;
  idempotencyKey?: string | null;
}

/** Idempotent insert: a repeated idempotency key returns the existing task, created=false. */
export async function createTask(db: Queryable, input: CreateTaskInput): Promise<{ task: TaskRow; created: boolean }> {
  const id = randomUUID();
  const { rows } = await db.query<TaskRow>(
    `INSERT INTO ai_tasks (id, agent_id, task_type, subject_type, subject_id, context, priority,
                           requested_by, requested_by_type, customer_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      id,
      input.agentId,
      input.taskType,
      input.subjectType ?? null,
      input.subjectId ?? null,
      JSON.stringify(input.context ?? {}),
      input.priority ?? 'normal',
      input.requestedBy ?? null,
      input.requestedByType,
      input.customerId ?? null,
      input.idempotencyKey ?? null,
    ]
  );
  if (rows[0]) return { task: rows[0], created: true };
  const { rows: existing } = await db.query<TaskRow>(`SELECT * FROM ai_tasks WHERE idempotency_key = $1`, [input.idempotencyKey]);
  if (!existing[0]) throw new Error('ai_tasks: idempotency conflict path found no row');
  return { task: existing[0], created: false };
}

export async function getTask(db: Queryable, id: string): Promise<TaskRow | null> {
  const { rows } = await db.query<TaskRow>(`SELECT * FROM ai_tasks WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listTasks(
  db: Queryable,
  opts: { status?: string; agentId?: string; customerId?: string; limit?: number; offset?: number } = {}
): Promise<Array<TaskRow & { agent_slug: string; agent_name: string }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    params.push(opts.status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (opts.agentId) {
    params.push(opts.agentId);
    conditions.push(`t.agent_id = $${params.length}`);
  }
  if (opts.customerId) {
    params.push(opts.customerId);
    conditions.push(`t.customer_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const limitPos = params.length;
  params.push(Math.max(opts.offset ?? 0, 0));
  const { rows } = await db.query<TaskRow & { agent_slug: string; agent_name: string }>(
    `SELECT t.*, a.slug AS agent_slug, a.name AS agent_name
     FROM ai_tasks t JOIN ai_agents a ON a.id = t.agent_id
     ${where}
     ORDER BY t.created_at DESC LIMIT $${limitPos} OFFSET $${params.length}`,
    params
  );
  return rows;
}

export async function updateTaskStatus(
  db: Queryable,
  id: string,
  status: TaskRow['status'],
  patch: { resultSummary?: string | null; result?: Record<string, unknown> | null; errorCode?: string | null; errorMessage?: string | null; completed?: boolean } = {}
): Promise<void> {
  await db.query(
    `UPDATE ai_tasks SET status = $2,
       result_summary = COALESCE($3, result_summary),
       result = COALESCE($4, result),
       error_code = COALESCE($5, error_code),
       error_message = COALESCE($6, error_message),
       completed_at = CASE WHEN $7 THEN now() ELSE completed_at END,
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      status,
      patch.resultSummary ?? null,
      patch.result !== undefined && patch.result !== null ? JSON.stringify(patch.result) : null,
      patch.errorCode ?? null,
      patch.errorMessage ?? null,
      patch.completed === true,
    ]
  );
}

export async function insertRun(db: Queryable, input: { taskId: string; agentId: string; engine: string; model: string; input: Record<string, unknown> }): Promise<RunRow> {
  const { rows } = await db.query<RunRow>(
    `INSERT INTO ai_runs (id, task_id, agent_id, attempt, engine, model, input)
     VALUES ($1,$2,$3,
             COALESCE((SELECT MAX(attempt) + 1 FROM ai_runs WHERE task_id = $2), 1),
             $4,$5,$6)
     RETURNING *`,
    [randomUUID(), input.taskId, input.agentId, input.engine, input.model, JSON.stringify(input.input)]
  );
  if (!rows[0]) throw new Error('ai_runs: insert returned no row');
  return rows[0];
}

export async function completeRun(
  db: Queryable,
  id: string,
  status: RunStatus,
  patch: { output?: Record<string, unknown> | null; verification?: Record<string, unknown> | null; errorCode?: string | null; errorMessage?: string | null; durationMs?: number } = {}
): Promise<void> {
  await db.query(
    `UPDATE ai_runs SET status = $2,
       output = COALESCE($3, output),
       verification = COALESCE($4, verification),
       error_code = COALESCE($5, error_code),
       error_message = COALESCE($6, error_message),
       duration_ms = COALESCE($7, duration_ms),
       completed_at = now()
     WHERE id = $1`,
    [
      id,
      status,
      patch.output !== undefined && patch.output !== null ? JSON.stringify(patch.output) : null,
      patch.verification !== undefined && patch.verification !== null ? JSON.stringify(patch.verification) : null,
      patch.errorCode ?? null,
      patch.errorMessage ?? null,
      patch.durationMs ?? null,
    ]
  );
}

export async function insertRunStep(db: Queryable, runId: string, stepOrder: number, phase: RunPhase, detail: Record<string, unknown>, status = 'completed'): Promise<void> {
  await db.query(
    `INSERT INTO ai_run_steps (id, run_id, step_order, phase, status, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), runId, stepOrder, phase, status, JSON.stringify(detail)]
  );
}

export async function listRunsForTask(db: Queryable, taskId: string): Promise<RunRow[]> {
  const { rows } = await db.query<RunRow>(`SELECT * FROM ai_runs WHERE task_id = $1 ORDER BY started_at DESC`, [taskId]);
  return rows;
}

export async function listStepsForRun(db: Queryable, runId: string): Promise<RunStepRow[]> {
  const { rows } = await db.query<RunStepRow>(`SELECT * FROM ai_run_steps WHERE run_id = $1 ORDER BY step_order`, [runId]);
  return rows;
}

export async function listToolCalls(db: Queryable, opts: { runId?: string; taskId?: string; limit?: number } = {}): Promise<ToolCallRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.runId) {
    params.push(opts.runId);
    conditions.push(`run_id = $${params.length}`);
  }
  if (opts.taskId) {
    params.push(opts.taskId);
    conditions.push(`task_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  const { rows } = await db.query<ToolCallRow>(
    `SELECT * FROM ai_tool_calls ${where} ORDER BY created_at ASC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function insertToolCall(
  db: Queryable,
  input: {
    runId: string | null;
    taskId: string | null;
    agentId: string | null;
    approvalId?: string | null;
    tool: string;
    permission: string;
    riskLevel: string;
    arguments: unknown;
    result: unknown;
    success: boolean;
    errorCode: string | null;
    durationMs: number;
  }
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO ai_tool_calls (id, run_id, task_id, agent_id, approval_id, tool, permission, risk_level,
                                arguments, result, success, error_code, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      input.runId,
      input.taskId,
      input.agentId,
      input.approvalId ?? null,
      input.tool,
      input.permission,
      input.riskLevel,
      JSON.stringify(input.arguments ?? {}),
      input.result === undefined ? null : JSON.stringify(input.result),
      input.success,
      input.errorCode,
      input.durationMs,
    ]
  );
  return id;
}
