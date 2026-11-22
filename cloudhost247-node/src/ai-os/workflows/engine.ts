/**
 * AI Automation Engine: event → workflow → agent task(s) → run → record.
 *
 * A workflow is successful only when every configured step has succeeded. An incomplete,
 * failed or ambiguous step stops the sequence; it is never treated as a successful skip.
 * Events have non-expiring database claims; interrupted claims remain for investigation rather
 * than being replayed. This is not end-to-end fencing of already dispatched external effects.
 */
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import type { TaskRow, WorkflowRow } from '../types';
import {
  listEnabledWorkflowsForEvent,
  insertWorkflowRun,
  checkpointWorkflowRun,
  lockEventClaim,
  completeWorkflowRun,
  markEventProcessed,
  claimNextEvent,
  emitEvent,
  type EventClaim,
} from '../repositories/events-repo';
import { prepareOrchestratedTask } from '../runtime/task-orchestrator';
import { runTask } from '../runtime/executor';
import { seedAgentRegistry } from '../registry/seed';
import { recordAiAudit } from '../repositories/audit-repo';
import { getAgentBySlug } from '../repositories/registry-repo';
import type { RunTaskFn } from '../board/board-service';
import { prepareWorkflowSteps } from './workflow-contract';
import { authorizeWorkflowCustomerScope } from './customer-scope';

type Rec = Record<string, unknown>;

/**
 * Persist a success checkpoint only after re-reading the prepared task's identity and status.
 * This is an observation, not independent verification of provider effects. The event and task
 * locks serialize this checkpoint with cooperating updates, not arbitrary external side effects.
 */
async function checkpointObservedSuccess(db: Queryable, runId: string, claim: EventClaim, task: TaskRow, outcomes: Rec[], step: string, reused: boolean): Promise<boolean> {
  return withTransaction(db, async (tx) => {
    await lockEventClaim(tx, claim);
    const { rows } = await tx.query<{ id: string }>(
      `SELECT t.id FROM ai_tasks t WHERE t.id = $1 AND t.status = 'succeeded'
       AND t.agent_id = $2 AND t.task_type = $3 AND t.requested_by_type = $4
       AND t.requested_by IS NOT DISTINCT FROM $5::uuid AND t.customer_id IS NOT DISTINCT FROM $6::uuid
       AND t.subject_type IS NOT DISTINCT FROM $7 AND t.subject_id IS NOT DISTINCT FROM $8::uuid
       AND t.context = $9::jsonb AND t.priority = $10 AND t.idempotency_key IS NOT DISTINCT FROM $11
       AND NOT EXISTS (SELECT 1 FROM ai_approvals ap WHERE ap.task_id = t.id)
       FOR UPDATE OF t`,
      [task.id, task.agent_id, task.task_type, task.requested_by_type, task.requested_by, task.customer_id,
        task.subject_type, task.subject_id, JSON.stringify(task.context ?? {}), task.priority, task.idempotency_key],
    );
    const success = rows.length === 1;
    outcomes.push({ step, status: success ? 'succeeded' : 'outcome_unknown', taskId: task.id, ...(reused ? { reused: true } : { pendingApprovals: [] }) });
    await checkpointWorkflowRun(tx, runId, claim, outcomes);
    return success;
  });
}

async function executeWorkflowForEvent(db: Queryable, workflow: WorkflowRow, claim: EventClaim, steps: ReturnType<typeof prepareWorkflowSteps>, runTaskFn: RunTaskFn): Promise<'succeeded' | 'incomplete'> {
  const event = claim.event;
  const run = await insertWorkflowRun(db, workflow.id, claim);
  const outcomes: Rec[] = [];

  for (const step of steps) {
    let taskId: string | undefined;
    let preparationCommitted = false;
    try {
      const agent = await getAgentBySlug(db, step.agent_slug);
      if (!agent || !agent.enabled || agent.status !== 'active' || !Array.isArray(agent.task_types) || !agent.task_types.includes(step.task_type)) {
        outcomes.push({ step: step.agent_slug, status: 'failed', error: 'Agent or task grant unavailable' });
        break;
      }
      const { task, created } = await withTransaction(db, async (tx) => {
        // The claim lock, task creation and pre-dispatch checkpoint commit together. No external
        // effect runs inside the transaction. A lost commit acknowledgement remains uncertain.
        await lockEventClaim(tx, claim);
        // Recheck and lock the authoritative owner through task/checkpoint commit. This does
        // not fence ownership changes after commit or establish authority for arbitrary inputs.
        if (!await authorizeWorkflowCustomerScope(tx, event, [step], true)) throw new Error('Workflow customer scope unavailable');
        const prepared = await prepareOrchestratedTask(tx, {
          agentId: agent.id,
          taskType: step.task_type,
          subjectType: step.subject_type,
          subjectId: step.subjectId,
          context: step.input,
          priority: step.priority,
          requestedByType: 'workflow',
          customerId: step.customerId,
          entryPoint: 'workflow.event',
          idempotencyKey: `wf:${workflow.slug}:${event.id}:${step.agent_slug}`,
        });
        await checkpointWorkflowRun(tx, run.id, claim, [...outcomes, { step: step.agent_slug, status: 'dispatching', taskId: prepared.task.id }]);
        return prepared;
      });
      taskId = task.id;
      preparationCommitted = true;
      if (!created) {
        // A previously successful task must not advance a workflow after its agent or task grant
        // has been revoked. A queued duplicate is never restarted by this path.
        if (!agent.enabled || agent.status !== 'active' || !Array.isArray(agent.task_types) || !agent.task_types.includes(step.task_type)) {
          outcomes.push({ step: step.agent_slug, status: 'failed', taskId, error: 'Agent or task grant unavailable' });
          break;
        }
        // A duplicate is evidence only of the recorded state, not proof of a new execution.
        if (task.status === 'succeeded') {
          if (!await checkpointObservedSuccess(db, run.id, claim, task, outcomes, step.agent_slug, true)) break;
          continue;
        }
        outcomes.push({ step: step.agent_slug, status: task.status, taskId, reused: true });
        await checkpointWorkflowRun(db, run.id, claim, outcomes);
        break;
      }
      const outcome = await runTaskFn(db, task.id, {});
      // Reject inconsistent or unrecognized observations without disclosing the returned task.
      // Even matching failed/cancelled statuses do not prove absence of external effects.
      const recognized = ['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'].includes(outcome.runStatus);
      const status = !recognized || outcome.task.id !== taskId || outcome.task.status !== outcome.runStatus ||
        (outcome.pendingApprovals.length > 0 && outcome.runStatus !== 'awaiting_approval')
        ? 'outcome_unknown'
        : outcome.runStatus;
      if (status === 'succeeded') {
        if (!await checkpointObservedSuccess(db, run.id, claim, task, outcomes, step.agent_slug, false)) break;
      } else {
        outcomes.push({ step: step.agent_slug, status, taskId, pendingApprovals: outcome.pendingApprovals });
        await checkpointWorkflowRun(db, run.id, claim, outcomes);
        break;
      }
    } catch (error) {
      // A failed preparation transaction (including a lost COMMIT response) has an uncertain
      // outcome. Keep the event claimed rather than acknowledging or retrying it.
      if (!preparationCommitted) throw error;
      // Exceptions after preparation may have had an effect; do not disclose exception text.
      // If a post-dispatch checkpoint failed, replace its in-memory observation rather than
      // recording the same step twice with conflicting statuses.
      if (taskId && outcomes.at(-1)?.taskId === taskId) outcomes.pop();
      outcomes.push({ step: step.agent_slug, status: 'outcome_unknown', ...(taskId ? { taskId } : {}), error: 'Step interrupted; reconciliation required' });
      break;
    }
  }

  const allSucceeded = outcomes.length === steps.length && outcomes.every((outcome) => outcome.status === 'succeeded');
  const hasProgressOrPending = outcomes.some((outcome) => outcome.status !== 'failed');
  await completeWorkflowRun(
    db,
    run.id,
    claim,
    allSucceeded ? 'succeeded' : hasProgressOrPending ? 'partial' : 'failed',
    outcomes,
    allSucceeded ? null : 'Workflow stopped before all steps succeeded; review recorded step status'
  );
  // No non-success status proves the absence of effects, including a paused approval or a
  // failed/cancelled task after earlier steps. Keep the claim and stop later workflows. Invalid
  // definitions and missing agents are held too, an intentional availability tradeoff.
  return allSucceeded ? 'succeeded' : 'incomplete';
}

/** Drains a bounded batch. A processed event is not proof that its workflow succeeded. */
export async function processPendingEvents(db: Queryable, runTaskFn: RunTaskFn = runTask, batchSize = 25): Promise<{ processed: number; dispatched: number }> {
  await seedAgentRegistry(db);
  const limit = Number.isFinite(batchSize) ? Math.min(Math.max(Math.floor(batchSize), 1), 100) : 25;
  let processed = 0;
  let dispatched = 0;
  for (let i = 0; i < limit; i += 1) {
    const claim = await claimNextEvent(db);
    if (!claim) break;
    const { event } = claim;
    const workflows = await listEnabledWorkflowsForEvent(db, event.event_type);
    // Validate the captured set before dispatching any workflow. This is a snapshot, not a
    // lock on later configuration changes, nor an authorization check on event payloads.
    const prepared: Array<{ workflow: WorkflowRow; steps: ReturnType<typeof prepareWorkflowSteps> }> = [];
    let invalidWorkflow: WorkflowRow | undefined;
    for (const workflow of workflows) {
      try {
        prepared.push({ workflow, steps: prepareWorkflowSteps(workflow.definition, event.payload) });
      } catch {
        invalidWorkflow = workflow;
        break;
      }
    }
    if (invalidWorkflow) {
      try {
        const run = await insertWorkflowRun(db, invalidWorkflow.id, claim);
        await completeWorkflowRun(db, run.id, claim, 'failed', [], 'Invalid workflow definition or event input');
        dispatched += 1;
      } catch {
        await recordAiAudit(db, {
          action: 'ai.workflow.failed', status: 'error', errorCode: 'WORKFLOW_EXECUTION_ERROR',
          arguments: { workflow: invalidWorkflow.slug, event: event.id },
        }).catch(() => undefined);
      }
      // Retain the claim even if the failure record cannot be persisted.
      continue;
    }
    // Customer tags are not authority. Before dispatching any captured workflow, bind the
    // currently supported customer-tagged event types to their real invoice/payment owner.
    // Unsupported or mismatched scopes hold the event; input and provider effects remain outside
    // this narrow check. Recheck under row locks during each task preparation below.
    let unboundWorkflow: WorkflowRow | undefined;
    try {
      for (const item of prepared) {
        if (!await authorizeWorkflowCustomerScope(db, event, item.steps)) { unboundWorkflow = item.workflow; break; }
      }
    } catch {
      await recordAiAudit(db, { action: 'ai.workflow.failed', status: 'error', errorCode: 'WORKFLOW_SCOPE_PREFLIGHT_ERROR', arguments: { event: event.id } }).catch(() => undefined);
      continue;
    }
    if (unboundWorkflow) {
      try {
        const run = await insertWorkflowRun(db, unboundWorkflow.id, claim);
        await completeWorkflowRun(db, run.id, claim, 'failed', [], 'Workflow customer scope unavailable');
        dispatched += 1;
      } catch {
        await recordAiAudit(db, { action: 'ai.workflow.failed', status: 'error', errorCode: 'WORKFLOW_SCOPE_PREFLIGHT_ERROR', arguments: { event: event.id } }).catch(() => undefined);
      }
      continue;
    }
    // Check every captured step's current registry admission before any task dispatch. Keep the
    // per-step and executor checks too: this snapshot cannot fence a later grant change.
    let unavailableWorkflow: WorkflowRow | undefined;
    try {
      const agents = new Map<string, Awaited<ReturnType<typeof getAgentBySlug>>>();
      for (const { workflow, steps } of prepared) {
        for (const step of steps) {
          if (!agents.has(step.agent_slug)) agents.set(step.agent_slug, await getAgentBySlug(db, step.agent_slug));
          const agent = agents.get(step.agent_slug);
          if (!agent || !agent.enabled || agent.status !== 'active' || !Array.isArray(agent.task_types) || !agent.task_types.includes(step.task_type)) {
            unavailableWorkflow = workflow;
            break;
          }
        }
        if (unavailableWorkflow) break;
      }
    } catch {
      await recordAiAudit(db, {
        action: 'ai.workflow.failed', status: 'error', errorCode: 'WORKFLOW_PREFLIGHT_ERROR',
        arguments: { event: event.id },
      }).catch(() => undefined);
      continue;
    }
    if (unavailableWorkflow) {
      try {
        const run = await insertWorkflowRun(db, unavailableWorkflow.id, claim);
        await completeWorkflowRun(db, run.id, claim, 'failed', [], 'Agent or task grant unavailable');
        dispatched += 1;
      } catch {
        await recordAiAudit(db, {
          action: 'ai.workflow.failed', status: 'error', errorCode: 'WORKFLOW_EXECUTION_ERROR',
          arguments: { workflow: unavailableWorkflow.slug, event: event.id },
        }).catch(() => undefined);
      }
      continue;
    }
    let interrupted = false;
    for (const { workflow, steps } of prepared) {
      try {
        const outcome = await executeWorkflowForEvent(db, workflow, claim, steps, runTaskFn);
        dispatched += 1;
        if (outcome === 'incomplete') {
          interrupted = true;
          break;
        }
      } catch {
        // Do not acknowledge an event when run persistence failed. Retain its non-expiring
        // claim; a later worker must not infer whether a side effect was dispatched.
        interrupted = true;
        await recordAiAudit(db, {
          action: 'ai.workflow.failed',
          status: 'error',
          errorCode: 'WORKFLOW_EXECUTION_ERROR',
          arguments: { workflow: workflow.slug, event: event.id },
        }).catch(() => undefined);
        break;
      }
    }
    if (!interrupted) {
      await markEventProcessed(db, claim);
      processed += 1;
    }
  }
  return { processed, dispatched };
}

export { emitEvent };
