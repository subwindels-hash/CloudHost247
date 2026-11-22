/**
 * A bounded, read-only orchestration state machine for the website-launch flow. Its only action
 * delegates to the existing registered AI task; it has no arbitrary tool or write-action interface.
 *
 * The caller MUST first authorize the conversation using the support route's existing checks.
 * A checking state that survives interruption is deliberately not retried automatically.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import { recordAiAudit } from '../repositories/audit-repo';
import type { LaunchServiceKey } from '../../whmcs/agent-orderability';

export type LaunchStatus = 'awaiting_choice' | 'checking' | 'options_ready' | 'needs_support' | 'cancelled' | 'escalated';
export interface LaunchWorkflow {
  id: string;
  conversation_id: string;
  status: LaunchStatus;
  service_key: LaunchServiceKey | null;
  lookup_task_id: string | null;
  created_at: string;
  updated_at: string;
  delayed?: boolean;
}
export interface LaunchProgress {
  status: LaunchStatus;
  label: string;
  attentionRequired: boolean;
  /** Typed so clients can distinguish an interrupted/reconciliation-needed observation from
   *  normal progress without parsing label text. An age heuristic, never proof of failure. */
  attentionState: 'none' | 'suspected_interrupted';
}

const LABELS: Record<LaunchStatus, string> = {
  awaiting_choice: 'Waiting for website type',
  checking: 'Checking hosting availability',
  options_ready: 'Hosting options checked — no order placed',
  needs_support: 'Could not verify options — support may help',
  cancelled: 'Request cancelled — a lookup already in progress may still finish',
  escalated: 'Launch request stopped for support handoff',
};

export function launchProgress(row: LaunchWorkflow | null): LaunchProgress | null {
  if (!row) return null;
  const attentionRequired = row.status === 'checking' && row.delayed === true;
  return {
    status: row.status,
    label: attentionRequired ? 'This lookup is taking longer than expected and may be interrupted. Please ask support for help.' : LABELS[row.status],
    attentionRequired,
    attentionState: attentionRequired ? 'suspected_interrupted' : 'none',
  };
}

/** Fence a lookup that was attached but not yet dispatched: cancelling the still-queued task
 *  makes the executor's claim fail, so dispatch after a stop/reconcile cannot begin. An
 *  already-running lookup is untouched — its publication is fenced by finishLaunch's status
 *  check. Runs inside the caller's transaction, after the workflow row is locked. */
async function fenceAttachedQueuedTask(tx: Queryable, lookupTaskId: string | null): Promise<void> {
  if (!lookupTaskId) return;
  await tx.query(
    `UPDATE ai_tasks SET status = 'cancelled', completed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'queued'`,
    [lookupTaskId],
  );
}

async function audit(db: Queryable, workflow: LaunchWorkflow, userId: string | null): Promise<void> {
  await recordAiAudit(db, {
    userId, taskId: workflow.lookup_task_id, action: 'ai.launch.transition', status: 'ok',
    arguments: { workflowId: workflow.id, conversationId: workflow.conversation_id },
    result: { status: workflow.status },
  });
}

export async function latestLaunch(db: Queryable, conversationId: string): Promise<LaunchWorkflow | null> {
  const { rows } = await db.query<LaunchWorkflow>(
    `SELECT *, (status = 'checking' AND updated_at < now() - interval '5 minutes') AS delayed
     FROM ai_launch_workflows WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [conversationId]
  );
  return rows[0] ?? null;
}

export async function beginLaunch(db: Queryable, conversationId: string, userId: string | null): Promise<LaunchWorkflow> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<LaunchWorkflow>(
      `INSERT INTO ai_launch_workflows (id, conversation_id) VALUES ($1,$2)
       ON CONFLICT (conversation_id) WHERE status IN ('awaiting_choice','checking') DO NOTHING RETURNING *`,
      [randomUUID(), conversationId]
    );
    if (rows[0]) { await audit(tx, rows[0], userId); return rows[0]; }
    const existing = await tx.query<LaunchWorkflow>(
      `SELECT * FROM ai_launch_workflows WHERE conversation_id = $1 AND status IN ('awaiting_choice','checking') LIMIT 1`, [conversationId]
    );
    if (!existing.rows[0]) throw new Error('Launch workflow could not be started');
    return existing.rows[0];
  });
}

export async function claimLaunchChoice(db: Queryable, conversationId: string, serviceKey: LaunchServiceKey, userId: string | null): Promise<LaunchWorkflow | null> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<LaunchWorkflow>(
      `UPDATE ai_launch_workflows SET status = 'checking', service_key = $2, updated_at = now()
       WHERE conversation_id = $1 AND status = 'awaiting_choice' RETURNING *`, [conversationId, serviceKey]
    );
    if (!rows[0]) return null;
    await audit(tx, rows[0], userId);
    return rows[0];
  });
}

/** Link the task before dispatch. Returning false means cancellation/escalation won the race. */
export async function attachLaunchTask(db: Queryable, workflowId: string, taskId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE ai_launch_workflows w SET lookup_task_id = $2, updated_at = now()
     WHERE w.id = $1 AND w.status = 'checking' AND w.lookup_task_id IS NULL
       AND EXISTS (SELECT 1 FROM ai_tasks t WHERE t.id = $2 AND t.status = 'queued'
         AND t.task_type = 'sales.website_launch' AND t.subject_type = 'ai_support_conversation'
         AND t.subject_id = w.conversation_id AND t.idempotency_key = 'launch:' || w.id::text
         AND t.context->>'serviceKey' = w.service_key)
     RETURNING w.id`,
    [workflowId, taskId]
  );
  return rows.length === 1;
}

/** Transition and publish in one transaction. The callback must only use tx, never an external call. */
export async function finishLaunch<T>(
  db: Queryable, workflowId: string, conversationId: string,
  status: 'options_ready' | 'needs_support', userId: string | null,
  publish: (tx: Queryable) => Promise<T>,
): Promise<{ workflow: LaunchWorkflow; response: T } | null> {
  return withTransaction(db, async (tx) => {
    // Conversation first: staff status changes and message publication use the same row lock.
    const conversation = await tx.query<{ status: string }>(
      `SELECT status FROM ai_support_conversations WHERE id = $1 FOR UPDATE`, [conversationId]
    );
    if (conversation.rows[0]?.status !== 'AI_ACTIVE') return null;
    const { rows } = await tx.query<LaunchWorkflow>(
      `UPDATE ai_launch_workflows SET status = $3, updated_at = now()
       WHERE id = $1 AND conversation_id = $2 AND status = 'checking' RETURNING *`, [workflowId, conversationId, status]
    );
    if (!rows[0]) return null;
    await audit(tx, rows[0], userId);
    const response = await publish(tx);
    return { workflow: rows[0], response };
  });
}

/** Operator-only recovery primitive; caller must authorize the operator. It fences late publication,
 * not an already-started lookup, and never asserts the upstream result or resumes the task. */
export async function reconcileDelayedLaunch(db: Queryable, conversationId: string, workflowId: string, operatorId: string): Promise<LaunchWorkflow | null> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<LaunchWorkflow>(
      `UPDATE ai_launch_workflows SET status = 'needs_support', updated_at = now()
       WHERE id = $1 AND conversation_id = $2 AND status = 'checking'
         AND updated_at < now() - interval '5 minutes' RETURNING *`, [workflowId, conversationId]
    );
    const workflow = rows[0];
    if (!workflow) return null;
    await fenceAttachedQueuedTask(tx, workflow.lookup_task_id);
    await recordAiAudit(tx, {
      userId: operatorId, taskId: workflow.lookup_task_id, action: 'ai.launch.operator_reconciled', status: 'ok',
      arguments: { workflowId: workflow.id, conversationId: workflow.conversation_id, reason: 'unverified_delayed_lookup' },
      result: { status: 'needs_support', lookupMayStillComplete: true },
    });
    return workflow;
  });
}

export async function stopLaunch(db: Queryable, conversationId: string, status: 'cancelled' | 'escalated', userId: string | null): Promise<LaunchWorkflow | null> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<LaunchWorkflow>(
      `UPDATE ai_launch_workflows SET status = $2, updated_at = now()
       WHERE conversation_id = $1 AND status IN ('awaiting_choice','checking') RETURNING *`, [conversationId, status]
    );
    if (!rows[0]) return null;
    await fenceAttachedQueuedTask(tx, rows[0].lookup_task_id);
    await audit(tx, rows[0], userId);
    return rows[0];
  });
}
