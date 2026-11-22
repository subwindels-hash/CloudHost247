/**
 * Operator retry of a read-only task — specified by the Phase 2 safe-retry specification and
 * implemented here under exactly those constraints:
 *
 *  - a dedicated permission (`ai.tasks.retry`, admin/super_admin) gates the route;
 *  - the task type must be declared read-only in SERVER code (never client input);
 *  - the task must be proven never claimed (queued, no runs, no tool activity) and not early
 *    relative to its scheduled run time;
 *  - persisted identity, agent grant and actor/customer scope are re-verified before dispatch;
 *  - the executor additionally refuses ANY mutating tool during the run (Gate 1b);
 *  - the decision is audited before dispatch.
 *
 * Even then this cannot prove provider-side idempotency — external writes need provider
 * idempotency keys before any write-path retry could be safe, which is why only audited
 * read-only types are admitted.
 */
import type { Queryable } from '../../db/types';
import type { TaskRow } from '../types';
import { assertAgentGrant } from './orchestration-contract';

/**
 * Task types whose registered handler performs only read-only work, audited against the
 * handler and the tool catalog in server code. Extend ONLY after auditing the handler's
 * complete tool and SQL path for mutations — never from client input or configuration.
 *
 * `sales.website_launch` — handler calls exactly one tool, `lookup_launch_orderability`
 * (mutating: false), validates the response and writes only run/step bookkeeping.
 * The account assistant, board digests and scheduled scans are deliberately excluded: their
 * handlers can draft/send notifications, spawn child tasks or take other state-changing paths.
 */
export const READ_ONLY_RETRY_TASK_TYPES: ReadonlySet<string> = new Set(['sales.website_launch']);

/** Returns a refusal reason, or null when the task is eligible for an operator read-only retry. */
export async function readonlyRetryRefusal(db: Queryable, task: TaskRow): Promise<string | null> {
  if (!READ_ONLY_RETRY_TASK_TYPES.has(task.task_type)) {
    return 'Task type is not declared read-only for operator retry';
  }
  if (task.status !== 'queued') {
    return 'Only a queued task can be retried — a claimed or finished task may have produced effects';
  }
  if (new Date(task.run_after).getTime() > Date.now()) {
    return 'Task has not reached its scheduled run time';
  }
  const runs = await db.query<{ id: string }>(`SELECT id FROM ai_runs WHERE task_id = $1 LIMIT 1`, [task.id]);
  if (runs.rows[0]) return 'Task has already been claimed (run history exists)';
  const calls = await db.query<{ id: string }>(`SELECT id FROM ai_tool_calls WHERE task_id = $1 LIMIT 1`, [task.id]);
  if (calls.rows[0]) return 'Task has recorded tool activity';

  // Re-verify the agent grant and actor/customer scope against persisted state.
  try {
    await assertAgentGrant(db, task.agent_id, task.task_type);
  } catch {
    return 'Agent grant unavailable for this task type';
  }
  if (task.requested_by) {
    const actor = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND status = 'active'`, [task.requested_by]);
    if (!actor.rows[0]) return 'Requesting actor is not active';
  }
  if (task.customer_id) {
    const customer = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND status = 'active'`, [task.customer_id]);
    if (!customer.rows[0]) return 'Scoped customer is not active';
  }
  return null;
}
