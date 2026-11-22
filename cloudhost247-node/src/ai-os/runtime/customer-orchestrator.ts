/**
 * Bounded customer-task orchestration over the existing AI-OS registry and executor.
 * This is an internal contract, NOT an authentication/authorization boundary: the calling route
 * must authenticate the account or authorize the support conversation before constructing a
 * request. No HTTP body is accepted as a whole request and no caller-selected agent/tool is run.
 *
 * Two fixed operations are supported. Other entry points use shared task preparation but have
 * separate authorization and dispatch contracts; they must not be assumed to share this one.
 */
import { z } from 'zod';
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import { ensureAgentRegistrySeeded } from '../registry/seed';
import { getAgentBySlug } from '../repositories/registry-repo';
import { prepareOrchestratedTask } from './task-orchestrator';
import { AgentGrantError } from './orchestration-contract';
import { runTask } from './executor';
import { attachLaunchTask } from '../workflows/launch-orchestrator';

const requestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('account_assistant'), actorUserId: z.string().uuid(),
    message: z.string().min(2).max(2000),
  }).strict(),
  z.object({
    operation: z.literal('website_launch'), actorUserId: z.string().uuid().nullable(),
    conversationId: z.string().uuid(), workflowId: z.string().uuid(),
    serviceKey: z.enum(['hosting-web-hosting', 'hosting-business', 'hosting-wordpress']),
  }).strict(),
]);
export type CustomerOrchestrationRequest = z.infer<typeof requestSchema>;

export class CustomerOrchestrationError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'SCOPE_INVALID' | 'AGENT_UNAVAILABLE' | 'TASK_NOT_ATTACHED') {
    super(code);
    this.name = 'CustomerOrchestrationError';
  }
}

/**
 * The identity fields here come exclusively from a prior server-side access check. Schema checks
 * and DB consistency checks are defense in depth; they cannot verify a visitor token or JWT.
 * A duplicate launch never runs again, even when the earlier result is unknown. A new account
 * assistant message deliberately creates a new task, preserving its current API semantics.
 */
export async function dispatchCustomerIntent(db: Queryable, input: CustomerOrchestrationRequest) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new CustomerOrchestrationError('INVALID_REQUEST');
  const request = parsed.data;
  if (request.actorUserId) {
    const account = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND status = 'active'`, [request.actorUserId]);
    if (!account.rows[0]) throw new CustomerOrchestrationError('SCOPE_INVALID');
  }
  await ensureAgentRegistrySeeded(db);
  const agent = await getAgentBySlug(db, request.operation === 'account_assistant' ? 'customer-cloud-assistant' : 'website-launch-assistant');
  if (!agent) throw new CustomerOrchestrationError('AGENT_UNAVAILABLE');

  let task;
  try {
    task = request.operation === 'account_assistant'
    ? (await prepareOrchestratedTask(db, {
      agentId: agent.id, taskType: 'customer.assistant_query', context: { message: request.message },
      requestedBy: request.actorUserId, requestedByType: 'customer', customerId: request.actorUserId,
      entryPoint: 'customer.account_assistant',
    })).task
    : await withTransaction(db, async (tx) => {
      // In addition to route token checks, a named actor must actually own this conversation.
      const conversation = await tx.query<{ user_id: string | null; status: string }>(
        `SELECT user_id, status FROM ai_support_conversations WHERE id = $1 FOR UPDATE`, [request.conversationId],
      );
      const row = conversation.rows[0];
      if (!row || row.status !== 'AI_ACTIVE' || (request.actorUserId !== null && row.user_id !== request.actorUserId)) {
        throw new CustomerOrchestrationError('SCOPE_INVALID');
      }
      const inserted = await prepareOrchestratedTask(tx, {
        agentId: agent.id, taskType: 'sales.website_launch', subjectType: 'ai_support_conversation', subjectId: request.conversationId,
        context: { serviceKey: request.serviceKey }, requestedBy: request.actorUserId,
        requestedByType: request.actorUserId ? 'customer' : 'system', customerId: request.actorUserId,
        entryPoint: 'customer.website_launch',
        idempotencyKey: `launch:${request.workflowId}`,
      });
      // Roll back a newly created task if cancellation, duplicate dispatch or bad scope won.
      if (!inserted.created || !await attachLaunchTask(tx, request.workflowId, inserted.task.id)) {
        throw new CustomerOrchestrationError('TASK_NOT_ATTACHED');
      }
      return inserted.task;
    });
  } catch (err) {
    // Central grant admission (disabled or undeclared agent) surfaces through the existing
    // customer-facing vocabulary; contract violations remain programming errors and propagate.
    if (err instanceof AgentGrantError) throw new CustomerOrchestrationError('AGENT_UNAVAILABLE');
    throw err;
  }

  // The executor independently rechecks agent task grants, customer scope, tool grants and
  // approvals. Cancellation after launch attachment cannot recall an already-dispatched lookup.
  return runTask(db, task.id, { actorUserId: request.actorUserId, customerScopeUserId: request.actorUserId });
}
