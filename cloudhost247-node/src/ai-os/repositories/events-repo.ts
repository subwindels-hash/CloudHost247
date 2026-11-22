/** Event bus + workflow persistence. */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import type { EventRow, WorkflowRow, WorkflowRunRow } from '../types';

// Never return the claim token through event APIs or audit logs.
const EVENT_COLUMNS = 'id, event_type, source, fingerprint, payload, occurred_at, processed_at, dispatch_claimed_at, created_at';
export interface EventClaim { event: EventRow; token: string }

/** Emits a platform-meaningful event. Fingerprint dedupe prevents detector loops from
 *  re-emitting the same state inside a suppression window. With a fingerprint the check and
 *  insert share one transaction serialized by a per-fingerprint advisory lock, so concurrent
 *  emitters cannot both pass a read-then-write race and double-dispatch the same logical event.
 *  This is a dedupe ledger for emission itself — not an event outbox: it does not make other
 *  state changes atomic with emission, and a fingerprinted emit now requires a
 *  transaction-capable handle (pg Pool or PGlite). */
export async function emitEvent(
  db: Queryable,
  input: { eventType: string; source?: string; fingerprint?: string | null; payload?: Record<string, unknown> }
): Promise<{ event: EventRow; created: boolean }> {
  if (input.fingerprint) {
    return withTransaction(db, async (tx) => {
      // Serialize concurrent emitters of the same fingerprint for the duration of the check.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.fingerprint]);
      const { rows: existing } = await tx.query<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM ai_events WHERE fingerprint = $1 AND occurred_at > now() - interval '24 hours' LIMIT 1`,
        [input.fingerprint]
      );
      if (existing[0]) return { event: existing[0], created: false };
      const { rows } = await tx.query<EventRow>(
        `INSERT INTO ai_events (id, event_type, source, fingerprint, payload) VALUES ($1,$2,$3,$4,$5) RETURNING ${EVENT_COLUMNS}`,
        [randomUUID(), input.eventType, input.source ?? 'platform', input.fingerprint ?? null, JSON.stringify(input.payload ?? {})]
      );
      if (!rows[0]) throw new Error('ai_events: insert returned no row');
      return { event: rows[0], created: true };
    });
  }
  const { rows } = await db.query<EventRow>(
    `INSERT INTO ai_events (id, event_type, source, fingerprint, payload) VALUES ($1,$2,$3,$4,$5) RETURNING ${EVENT_COLUMNS}`,
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
    `SELECT ${EVENT_COLUMNS} FROM ai_events ${where} ORDER BY occurred_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

/** Claim one event in one statement. Claims never expire or automatically trigger a replay. */
export async function claimNextEvent(db: Queryable): Promise<EventClaim | null> {
  const token = randomUUID();
  const { rows } = await db.query<EventRow>(
    `UPDATE ai_events SET dispatch_claim_token = $1, dispatch_claimed_at = now()
     WHERE id = (SELECT id FROM ai_events WHERE processed_at IS NULL AND dispatch_claim_token IS NULL
                 ORDER BY occurred_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
       AND processed_at IS NULL AND dispatch_claim_token IS NULL
     RETURNING ${EVENT_COLUMNS}`,
    [token],
  );
  return rows[0] ? { event: rows[0], token } : null;
}

/** Fenced acknowledgement; failure means ownership is unknown, not that processing failed. */
export async function markEventProcessed(db: Queryable, claim: EventClaim): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE ai_events SET processed_at = now(), dispatch_claim_token = NULL, dispatch_claimed_at = NULL
     WHERE id = $1 AND processed_at IS NULL AND dispatch_claim_token = $2 RETURNING id`,
    [claim.event.id, claim.token],
  );
  if (!rows[0]) throw new Error('Event claim unavailable');
}

/** Must be called inside a transaction; protects task preparation against claim acknowledgement. */
export async function lockEventClaim(db: Queryable, claim: EventClaim): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM ai_events WHERE id = $1 AND processed_at IS NULL AND dispatch_claim_token = $2 FOR UPDATE`,
    [claim.event.id, claim.token],
  );
  if (!rows[0]) throw new Error('Event claim unavailable');
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

export async function insertWorkflowRun(db: Queryable, workflowId: string, claim: EventClaim): Promise<WorkflowRunRow> {
  const { rows } = await db.query<WorkflowRunRow>(
    `INSERT INTO ai_workflow_runs (id, workflow_id, event_id)
     SELECT $1, $2, id FROM ai_events WHERE id = $3 AND processed_at IS NULL AND dispatch_claim_token = $4 RETURNING *`,
    [randomUUID(), workflowId, claim.event.id, claim.token]
  );
  if (!rows[0]) throw new Error('ai_workflow_runs: insert returned no row');
  return rows[0];
}

/** Persist observed step outcomes without claiming the workflow is finished. */
export async function checkpointWorkflowRun(db: Queryable, id: string, claim: EventClaim, steps: unknown[]): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE ai_workflow_runs SET steps = $2 WHERE id = $1 AND status = 'running' AND event_id = $3
     AND EXISTS (SELECT 1 FROM ai_events e WHERE e.id = $3 AND e.processed_at IS NULL AND e.dispatch_claim_token = $4) RETURNING id`,
    [id, JSON.stringify(steps), claim.event.id, claim.token],
  );
  if (!rows[0]) throw new Error('Workflow checkpoint unavailable');
}

export async function completeWorkflowRun(
  db: Queryable,
  id: string,
  claim: EventClaim,
  status: 'succeeded' | 'failed' | 'partial',
  steps: unknown[],
  error: string | null
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE ai_workflow_runs SET status = $2, steps = $3, error = $4, completed_at = now()
     WHERE id = $1 AND status = 'running' AND event_id = $5
       AND EXISTS (SELECT 1 FROM ai_events e WHERE e.id = $5 AND e.processed_at IS NULL AND e.dispatch_claim_token = $6) RETURNING id`,
    [id, status, JSON.stringify(steps), error, claim.event.id, claim.token]
  );
  if (!rows[0]) throw new Error('Workflow completion unavailable');
}

export async function listWorkflowRuns(db: Queryable, opts: { workflowId?: string; eventId?: string; limit?: number } = {}): Promise<Array<WorkflowRunRow & { workflow_slug: string }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.workflowId) {
    params.push(opts.workflowId);
    conditions.push(`wr.workflow_id = $${params.length}`);
  }
  if (opts.eventId) {
    params.push(opts.eventId);
    conditions.push(`wr.event_id = $${params.length}`);
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
