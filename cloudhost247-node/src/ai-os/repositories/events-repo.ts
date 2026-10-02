/** Event bus + workflow persistence. */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { EventRow, WorkflowRow, WorkflowRunRow } from '../types';

/** Emits a platform-meaningful event. Fingerprint dedupe prevents detector loops from
 *  re-emitting the same state inside a suppression window. */
export async function emitEvent(
  db: Queryable,
  input: { eventType: string; source?: string; fingerprint?: string | null; payload?: Record<string, unknown> }
): Promise<{ event: EventRow; created: boolean }> {
  if (input.fingerprint) {
    const { rows: existing } = await db.query<EventRow>(
      `SELECT * FROM ai_events WHERE fingerprint = $1 AND occurred_at > now() - interval '24 hours' LIMIT 1`,
      [input.fingerprint]
    );
    if (existing[0]) return { event: existing[0], created: false };
  }
  const { rows } = await db.query<EventRow>(
    `INSERT INTO ai_events (id, event_type, source, fingerprint, payload) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [randomUUID(), input.eventType, input.source ?? 'platform', input.fingerprint ?? null, JSON.stringify(input.payload ?? {})]
  );
  if (!rows[0]) throw new Error('ai_events: insert returned no row');
  return { event: rows[0], created: true };
}

export async function listEvents(db: Queryable, opts: { eventType?: string; limit?: number } = {}): Promise<EventRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.eventType) {
    params.push(opts.eventType);
    conditions.push(`event_type = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(opts.limit ?? 100, 1), 500));
  const { rows } = await db.query<EventRow>(
    `SELECT * FROM ai_events ${where} ORDER BY occurred_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function listUnprocessedEvents(db: Queryable, limit = 25): Promise<EventRow[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT * FROM ai_events WHERE processed_at IS NULL ORDER BY occurred_at ASC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)]
  );
  return rows;
}

export async function markEventProcessed(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE ai_events SET processed_at = now() WHERE id = $1 AND processed_at IS NULL`, [id]);
}

// ----------------------------------------------------------------------------------------------
// Workflows

export async function listWorkflows(db: Queryable): Promise<WorkflowRow[]> {
  const { rows } = await db.query<WorkflowRow>(`SELECT * FROM ai_workflows ORDER BY slug`);
  return rows;
}

export async function listEnabledWorkflowsForEvent(db: Queryable, eventType: string): Promise<WorkflowRow[]> {
  const { rows } = await db.query<WorkflowRow>(
    `SELECT * FROM ai_workflows WHERE event_type = $1 AND enabled = true ORDER BY slug`,
    [eventType]
  );
  return rows;
}

export async function getWorkflow(db: Queryable, id: string): Promise<WorkflowRow | null> {
  const { rows } = await db.query<WorkflowRow>(`SELECT * FROM ai_workflows WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function setWorkflowEnabled(db: Queryable, id: string, enabled: boolean): Promise<WorkflowRow | null> {
  const { rows } = await db.query<WorkflowRow>(
    `UPDATE ai_workflows SET enabled = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, enabled]
  );
  return rows[0] ?? null;
}

export async function insertWorkflowRun(db: Queryable, workflowId: string, eventId: string | null): Promise<WorkflowRunRow> {
  const { rows } = await db.query<WorkflowRunRow>(
    `INSERT INTO ai_workflow_runs (id, workflow_id, event_id) VALUES ($1,$2,$3) RETURNING *`,
    [randomUUID(), workflowId, eventId]
  );
  if (!rows[0]) throw new Error('ai_workflow_runs: insert returned no row');
  return rows[0];
}

export async function completeWorkflowRun(
  db: Queryable,
  id: string,
  status: 'succeeded' | 'failed' | 'partial',
  steps: unknown[],
  error: string | null
): Promise<void> {
  await db.query(
    `UPDATE ai_workflow_runs SET status = $2, steps = $3, error = $4, completed_at = now() WHERE id = $1`,
    [id, status, JSON.stringify(steps), error]
  );
}

export async function listWorkflowRuns(db: Queryable, opts: { workflowId?: string; limit?: number } = {}): Promise<Array<WorkflowRunRow & { workflow_slug: string }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.workflowId) {
    params.push(opts.workflowId);
    conditions.push(`wr.workflow_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const { rows } = await db.query<WorkflowRunRow & { workflow_slug: string }>(
    `SELECT wr.*, w.slug AS workflow_slug FROM ai_workflow_runs wr JOIN ai_workflows w ON w.id = wr.workflow_id
     ${where} ORDER BY wr.started_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}
