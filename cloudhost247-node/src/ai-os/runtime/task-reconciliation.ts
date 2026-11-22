/**
 * Suspected-interrupted running tasks: bounded visibility and operator attention records only.
 *
 * A stale heartbeat means no progress has been observed for the threshold window. It does NOT
 * prove the worker died, that an effect did or did not happen, or that any retry is safe. These
 * helpers never change task state, never dispatch or replay work, and never release ownership.
 * Routes must authorize access before calling them.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import { ForbiddenError } from '../../lib/errors';
import { recordAiAudit } from '../repositories/audit-repo';

/** Progress older than this is only *suspected* interruption. A heuristic, not a lease. */
export const SUSPECTED_INTERRUPTED_AFTER_MINUTES = 15;

const OBSERVED_KEY_SQL = `to_char(COALESCE(t.heartbeat_at, t.updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const STALE_PREDICATE = `COALESCE(t.heartbeat_at, t.updated_at) < now() - interval '${SUSPECTED_INTERRUPTED_AFTER_MINUTES} minutes'`;

export interface SuspectedInterruptedTask {
  task_id: string;
  agent_slug: string;
  task_type: string;
  status: string;
  observed_heartbeat_at: string;
  investigation_id: string | null;
  investigation_opened_at: string | null;
  investigation_opened_by: string | null;
}

/**
 * Bounded visibility aid, oldest observation first. Returns no task context, results, errors,
 * payloads or caller identity. Legacy running tasks without a heartbeat are observed through
 * their last status-change timestamp. A limit bounds rows, not query work.
 */
export async function listSuspectedInterruptedTasks(db: Queryable, limit = 100): Promise<SuspectedInterruptedTask[]> {
  const bounded = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 200) : 100;
  const { rows } = await db.query<SuspectedInterruptedTask>(
    `SELECT t.id AS task_id, a.slug AS agent_slug, t.task_type, t.status,
            ${OBSERVED_KEY_SQL} AS observed_heartbeat_at,
            i.id AS investigation_id, i.opened_at AS investigation_opened_at, i.opened_by AS investigation_opened_by
     FROM ai_tasks t
     JOIN ai_agents a ON a.id = t.agent_id
     LEFT JOIN ai_task_investigations i ON i.task_id = t.id
       AND i.observed_heartbeat_at = COALESCE(t.heartbeat_at, t.updated_at)
     WHERE t.status = 'running' AND ${STALE_PREDICATE}
     ORDER BY COALESCE(t.heartbeat_at, t.updated_at) ASC, t.id ASC LIMIT $1`,
    [bounded],
  );
  return rows;
}

/** Read-only count for sweep visibility. Detection only — never writes or changes tasks. */
export async function countSuspectedInterruptedTasks(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ai_tasks t WHERE t.status = 'running' AND ${STALE_PREDICATE}`,
  );
  return Number(rows[0]?.count ?? 0);
}

export interface TaskInvestigation {
  id: string;
  task_id: string;
  observed_heartbeat_at: string;
  opened_by: string | null;
  opened_at: string;
}

/**
 * Record attention for one observed stale heartbeat, with its minimal audit in the same
 * transaction. The task row lock rechecks that the task is still running, still stale, and still
 * shows exactly the observed heartbeat; a progressed, finished or re-heartbeated task returns
 * null so a stale view fails closed. Idempotent per (task, observed heartbeat): parallel
 * submissions return the same record and only the first records the audit. Never changes the
 * task, dispatches work, or authorizes a retry.
 */
export async function openTaskInvestigation(
  db: Queryable, taskId: string, observedHeartbeat: string, operatorId: string,
): Promise<{ investigation: TaskInvestigation; created: boolean } | null> {
  return withTransaction(db, async (tx) => {
    // Recheck and lock the actor's current role for the duration of this mutation.
    const operator = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND status = 'active' AND role IN ('admin','super_admin') FOR SHARE`, [operatorId],
    );
    if (!operator.rows[0]) throw new ForbiddenError('Operator is no longer authorized');
    const task = await tx.query<{ id: string }>(
      `SELECT id FROM ai_tasks t WHERE t.id = $1 AND t.status = 'running' AND ${STALE_PREDICATE}
         AND ${OBSERVED_KEY_SQL} = $2 FOR UPDATE`,
      [taskId, observedHeartbeat],
    );
    if (!task.rows[0]) return null;
    const existing = await tx.query<TaskInvestigation>(
      `SELECT i.id, i.task_id,
              to_char(i.observed_heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_heartbeat_at,
              i.opened_by, i.opened_at
       FROM ai_task_investigations i
       WHERE i.task_id = $1
         AND to_char(i.observed_heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = $2`,
      [taskId, observedHeartbeat],
    );
    if (existing.rows[0]) return { investigation: existing.rows[0], created: false };
    // Copy the exact observed timestamp inside SQL, not through a JS Date, so idempotency
    // follows the microsecond-precise observation the operator was shown.
    const inserted = await tx.query<TaskInvestigation>(
      `INSERT INTO ai_task_investigations (id, task_id, observed_heartbeat_at, opened_by)
       SELECT $1, t.id, COALESCE(t.heartbeat_at, t.updated_at), $4 FROM ai_tasks t
       WHERE t.id = $2 AND t.status = 'running' AND ${STALE_PREDICATE} AND ${OBSERVED_KEY_SQL} = $3
       RETURNING id, task_id, to_char(observed_heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_heartbeat_at,
                 opened_by, opened_at`,
      [randomUUID(), taskId, observedHeartbeat, operatorId],
    );
    const investigation = inserted.rows[0];
    if (!investigation) throw new Error('Task investigation could not be recorded');
    await recordAiAudit(tx, {
      userId: operatorId, action: 'ai.task.interrupted_investigation_opened', status: 'ok',
      arguments: { taskId, investigationId: investigation.id, reason: 'suspected_interrupted_running_task' },
      result: { taskStateChanged: false, replayAuthorized: false, outcomeVerified: false, workerMayStillBeActive: true },
    });
    return { investigation, created: true };
  });
}
