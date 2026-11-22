/**
 * Administrative investigation records for held event claims. Opening a record does not change
 * the event, cancel its worker, verify its side effects, release the claim, or notify anyone.
 * Routes must authorize access before calling these helpers.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import { ForbiddenError } from '../../lib/errors';
import { recordAiAudit } from '../repositories/audit-repo';

export interface HeldEventClaim {
  event_id: string;
  event_type: string;
  claimed_at: string;
  delayed: boolean;
  investigation_id: string | null;
  investigation_opened_at: string | null;
  investigation_opened_by: string | null;
}

export interface AcknowledgedIncompleteRun {
  run_id: string;
  workflow_slug: string;
  status: 'running' | 'failed' | 'partial';
  started_at: string;
  event_id: string;
  event_type: string;
  processed_at: string;
  acknowledgement_key: string;
  investigation_id: string | null;
  investigation_opened_at: string | null;
  investigation_observed_status: 'running' | 'failed' | 'partial' | null;
}

/**
 * Recent incomplete runs whose event was acknowledged, including historical dispatch behaviour.
 * This is a bounded visibility aid, not a ledger of resolved cases. Do not return steps, errors,
 * payloads, tokens or task context here. Deleted events and succeeded runs are not represented.
 */
export async function listAcknowledgedIncompleteRuns(db: Queryable, limit = 100): Promise<AcknowledgedIncompleteRun[]> {
  const bounded = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 200) : 100;
  const { rows } = await db.query<AcknowledgedIncompleteRun>(
    `SELECT wr.id AS run_id, w.slug AS workflow_slug, wr.status, wr.started_at,
            e.id AS event_id, e.event_type, e.processed_at,
            to_char(e.processed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acknowledgement_key,
            i.id AS investigation_id, i.opened_at AS investigation_opened_at,
            i.observed_status AS investigation_observed_status
     FROM ai_workflow_runs wr
     JOIN ai_workflows w ON w.id = wr.workflow_id
     JOIN ai_events e ON e.id = wr.event_id
     LEFT JOIN ai_acknowledged_run_investigations i ON i.run_id = wr.id
       AND i.event_id = e.id AND i.acknowledged_at = e.processed_at
     WHERE wr.status IN ('running','failed','partial') AND e.processed_at IS NOT NULL
     ORDER BY wr.started_at DESC, wr.id DESC LIMIT $1`,
    [bounded],
  );
  return rows;
}

export interface AcknowledgedRunInvestigation {
  id: string;
  run_id: string;
  event_id: string;
  acknowledged_at: string;
  observed_status: 'running' | 'failed' | 'partial';
  opened_by: string | null;
  opened_at: string;
}

/** Records attention only, once per run and exact event acknowledgement. */
export async function openAcknowledgedRunInvestigation(
  db: Queryable, runId: string, eventId: string, acknowledgementKey: string,
  observedStatus: 'running' | 'failed' | 'partial', operatorId: string,
): Promise<{ investigation: AcknowledgedRunInvestigation; created: boolean } | null> {
  return withTransaction(db, async (tx) => {
    const operator = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND status = 'active' AND role IN ('admin','super_admin') FOR SHARE`, [operatorId],
    );
    if (!operator.rows[0]) throw new ForbiddenError('Operator is no longer authorized');
    // Establish lock order (event, then run) and recheck the association under both locks.
    const association = await tx.query<{ event_id: string | null }>(`SELECT event_id FROM ai_workflow_runs WHERE id = $1`, [runId]);
    if (association.rows[0]?.event_id !== eventId) return null;
    const event = await tx.query<{ id: string }>(
      `SELECT id FROM ai_events WHERE id = $1 AND processed_at IS NOT NULL
       AND to_char(processed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = $2 FOR UPDATE`,
      [eventId, acknowledgementKey],
    );
    if (!event.rows[0]) return null;
    const run = await tx.query<{ id: string }>(
      `SELECT id FROM ai_workflow_runs WHERE id = $1 AND event_id = $2 AND status = $3 AND status IN ('running','failed','partial') FOR UPDATE`,
      [runId, eventId, observedStatus],
    );
    if (!run.rows[0]) return null;
    const existing = await tx.query<AcknowledgedRunInvestigation>(
      `SELECT i.id, i.run_id, i.event_id, i.acknowledged_at, i.observed_status, i.opened_by, i.opened_at
       FROM ai_acknowledged_run_investigations i JOIN ai_events e ON e.id = i.event_id AND e.processed_at = i.acknowledged_at
       WHERE i.run_id = $1 AND i.event_id = $2`, [runId, eventId],
    );
    if (existing.rows[0]) return { investigation: existing.rows[0], created: false };
    // Preserve PostgreSQL microseconds by copying processed_at inside SQL, not through JS Date.
    const inserted = await tx.query<AcknowledgedRunInvestigation>(
      `INSERT INTO ai_acknowledged_run_investigations (id, run_id, event_id, acknowledged_at, observed_status, opened_by)
       SELECT $1, wr.id, e.id, e.processed_at, wr.status, $4 FROM ai_workflow_runs wr
       JOIN ai_events e ON e.id = wr.event_id WHERE wr.id = $2 AND e.id = $3
       RETURNING id, run_id, event_id, acknowledged_at, observed_status, opened_by, opened_at`,
      [randomUUID(), runId, eventId, operatorId],
    );
    const investigation = inserted.rows[0];
    if (!investigation) throw new Error('Acknowledged run investigation could not be recorded');
    await recordAiAudit(tx, {
      userId: operatorId, action: 'ai.workflow.acknowledged_investigation_opened', status: 'ok',
      arguments: { runId, eventId, investigationId: investigation.id, reason: 'acknowledged_incomplete_run' },
      result: { outcomeVerified: false, workerMayStillBeActive: true },
    });
    return { investigation, created: true };
  });
}

export interface EventInvestigation {
  id: string;
  event_id: string;
  claim_observed_at: string;
  opened_by: string | null;
  opened_at: string;
}

/** Minimal, current claims only: never select event payloads or the claim token. */
export async function listHeldEventClaims(db: Queryable, limit = 100): Promise<HeldEventClaim[]> {
  const bounded = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 200) : 100;
  const { rows } = await db.query<HeldEventClaim>(
    `SELECT e.id AS event_id, e.event_type, e.dispatch_claimed_at AS claimed_at,
            (e.dispatch_claimed_at < now() - interval '5 minutes') AS delayed,
            i.id AS investigation_id, i.opened_at AS investigation_opened_at, i.opened_by AS investigation_opened_by
     FROM ai_events e LEFT JOIN ai_event_investigations i
       ON i.event_id = e.id AND i.claim_observed_at = e.dispatch_claimed_at
     WHERE e.processed_at IS NULL AND e.dispatch_claim_token IS NOT NULL
     ORDER BY e.dispatch_claimed_at ASC, e.id ASC LIMIT $1`,
    [bounded],
  );
  return rows;
}

/**
 * Record one investigation per observed claim, with its audit in the same transaction. A five
 * minute age is only a filter, not evidence the worker has died. Lock the event to serialize with
 * acknowledgement; never change the event or infer the state of any external action.
 */
export async function openHeldEventInvestigation(
  db: Queryable, eventId: string, operatorId: string,
): Promise<{ investigation: EventInvestigation; created: boolean } | null> {
  return withTransaction(db, async (tx) => {
    // Recheck and lock the actor's current role for the duration of this mutation.
    const operator = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND status = 'active' AND role IN ('admin','super_admin') FOR SHARE`, [operatorId],
    );
    if (!operator.rows[0]) throw new ForbiddenError('Operator is no longer authorized');
    const event = await tx.query<{ delayed: boolean }>(
      `SELECT (dispatch_claimed_at < now() - interval '5 minutes') AS delayed
       FROM ai_events WHERE id = $1 AND processed_at IS NULL AND dispatch_claim_token IS NOT NULL FOR UPDATE`, [eventId],
    );
    if (!event.rows[0]) return null;
    const existing = await tx.query<EventInvestigation>(
      `SELECT i.id, i.event_id, i.claim_observed_at, i.opened_by, i.opened_at
       FROM ai_event_investigations i JOIN ai_events e ON e.id = i.event_id AND e.dispatch_claimed_at = i.claim_observed_at
       WHERE e.id = $1`, [eventId],
    );
    if (existing.rows[0]) return { investigation: existing.rows[0], created: false };
    if (!event.rows[0].delayed) return null;
    // Use the DB timestamp directly, rather than round-tripping it through a JS Date (which loses
    // PostgreSQL microsecond precision), so idempotency follows the exact observed claim.
    const inserted = await tx.query<EventInvestigation>(
      `INSERT INTO ai_event_investigations (id, event_id, claim_observed_at, opened_by)
       SELECT $1, e.id, e.dispatch_claimed_at, $3 FROM ai_events e WHERE e.id = $2
       RETURNING id, event_id, claim_observed_at, opened_by, opened_at`,
      [randomUUID(), eventId, operatorId],
    );
    const investigation = inserted.rows[0];
    if (!investigation) throw new Error('Event investigation could not be recorded');
    await recordAiAudit(tx, {
      userId: operatorId, action: 'ai.event.investigation_opened', status: 'ok',
      arguments: { eventId, investigationId: investigation.id, reason: 'unverified_delayed_claim' },
      result: { claimRetained: true, workerMayStillBeActive: true },
    });
    return { investigation, created: true };
  });
}
