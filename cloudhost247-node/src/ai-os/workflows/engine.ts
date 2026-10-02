/**
 * AI Automation Engine (spec §24, §25): event → workflow → agent task(s) → run → record.
 *
 * No polling loops: events are emitted by platform interactions (routes/services) or by the
 * detection emitter in the worker sweep (which inspects real state changes like "this invoice
 * just became overdue" with a 24h fingerprint dedupe), and processed here exactly once.
 */
import type { Queryable } from '../../db/types';
import type { EventRow, WorkflowRow } from '../types';
import {
  listEnabledWorkflowsForEvent,
  insertWorkflowRun,
  completeWorkflowRun,
  markEventProcessed,
  listUnprocessedEvents,
  emitEvent,
} from '../repositories/events-repo';
import { createTask } from '../repositories/tasks-repo';
import { runTask } from '../runtime/executor';
import { seedAgentRegistry } from '../registry/seed';
import { recordAiAudit } from '../repositories/audit-repo';
import { getAgentBySlug } from '../repositories/registry-repo';
import type { RunTaskFn } from '../board/board-service';

type Rec = Record<string, unknown>;

interface WorkflowStep {
  agent_slug: string;
  task_type: string;
  subject_from?: string;
  subject_type?: string;
  customer_from?: string;
  input?: Rec;
  priority?: string;
}

/** Resolves "{{payloadKey}}" placeholders in a step input template against the event payload. */
function resolveTemplate(template: Rec | undefined, payload: Rec): Rec {
  const out: Rec = {};
  for (const [key, value] of Object.entries(template ?? {})) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const payloadKey = value.slice(2, -2);
      out[key] = payload[payloadKey];
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function executeWorkflowForEvent(db: Queryable, workflow: WorkflowRow, event: EventRow, runTaskFn: RunTaskFn): Promise<void> {
  const run = await insertWorkflowRun(db, workflow.id, event.id);
  const steps = (Array.isArray(workflow.definition) ? workflow.definition : []) as unknown as WorkflowStep[];
  const outcomes: Rec[] = [];
  let failures = 0;
  for (const step of steps) {
    const payload = event.payload as Rec;
    const agent = await getAgentBySlug(db, step.agent_slug);
    if (!agent) {
      outcomes.push({ step: step.agent_slug, status: 'failed', error: 'agent not registered' });
      failures += 1;
      continue;
    }
    const input = resolveTemplate(step.input, payload);
    const subjectId = step.subject_from && typeof payload[step.subject_from] === 'string' ? (payload[step.subject_from] as string) : null;
    const customerId = step.customer_from && typeof payload[step.customer_from] === 'string' ? (payload[step.customer_from] as string) : null;
    const { task, created } = await createTask(db, {
      agentId: agent.id,
      taskType: step.task_type,
      subjectType: step.subject_type ?? null,
      subjectId,
      context: input,
      priority: step.priority ?? 'normal',
      requestedByType: 'workflow',
      customerId,
      idempotencyKey: `wf:${workflow.slug}:${event.id}:${step.agent_slug}`,
    });
    if (!created && task.status !== 'queued') {
      outcomes.push({ step: step.agent_slug, status: 'skipped', reason: 'same workflow event already executed (idempotent)', taskId: task.id });
      continue;
    }
    const outcome = await runTaskFn(db, task.id, {});
    outcomes.push({ step: step.agent_slug, status: outcome.runStatus, taskId: task.id, pendingApprovals: outcome.pendingApprovals });
    if (outcome.runStatus === 'failed') failures += 1;
  }
  await completeWorkflowRun(
    db,
    run.id,
    failures === 0 ? 'succeeded' : outcomes.every((o) => o.status === 'failed') ? 'failed' : 'partial',
    outcomes,
    failures === 0 ? null : `${failures} step(s) failed`
  );
}

/** Drains the unprocessed event queue (bounded batch). Called by the worker sweep. */
export async function processPendingEvents(db: Queryable, runTaskFn: RunTaskFn = runTask, batchSize = 25): Promise<{ processed: number; dispatched: number }> {
  await seedAgentRegistry(db);
  const events = await listUnprocessedEvents(db, batchSize);
  let dispatched = 0;
  for (const event of events) {
    const workflows = await listEnabledWorkflowsForEvent(db, event.event_type);
    for (const workflow of workflows) {
      try {
        await executeWorkflowForEvent(db, workflow, event, runTaskFn);
        dispatched += 1;
      } catch (err) {
        // One workflow failing must not block the queue; the run row stays for diagnosis.
        await recordAiAudit(db, {
          action: 'ai.workflow.failed',
          status: 'error',
          errorCode: 'WORKFLOW_EXECUTION_ERROR',
          arguments: { workflow: workflow.slug, event: event.id, error: err instanceof Error ? err.message : 'unknown' },
        }).catch(() => undefined);
      }
    }
    await markEventProcessed(db, event.id);
  }
  return { processed: events.length, dispatched };
}

export { emitEvent };
