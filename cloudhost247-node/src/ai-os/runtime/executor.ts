/**
 * Agent runtime executor (spec §1 OBSERVE→UNDERSTAND→PLAN→AUTHORIZE→EXECUTE→VERIFY→REPORT→LEARN).
 *
 * This is the single choke-point through which EVERY agent action flows:
 *
 *   callTool():
 *     1. tool exists in the registry            — else denied
 *     2. agent's registry row grants the tool   — else denied (agents never hard-code access)
 *     3. agent holds the tool's permission      — else denied
 *     4. customer workspace scoping             — non-customerUsable tools denied
 *     5. argument validation and customer scope — before any approval is created
 *     6. approval policy                        — protected actions pause for human approval
 *     7. execution + timing + verification data — then redacted, audited, recorded
 *
 * runTask(): loads task + agent, resolves the model engine (fail-closed), runs the registered
 * deterministic handler, and completes with real statuses only. A failed agent leaves a failed
 * task with a real error — never a synthetic success.
 */
import { isDeepStrictEqual } from 'node:util';
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import type { AgentRow, TaskRow } from '../types';
import { getToolDefinition, validateToolArguments, redactForStorage } from '../registry/tool-catalog';
import { getAgentById } from '../repositories/registry-repo';
import {
  completeRun,
  getTask,
  insertRun,
  insertRunStep,
  insertToolCall,
  updateTaskStatus,
} from '../repositories/tasks-repo';
import { createApproval, getApproval, claimApprovalExecution, markApprovalExecuted } from '../repositories/approvals-repo';
import { approvalEffectKey, claimEffectIntent, recordEffectOutcome } from '../repositories/effect-outbox';
import { createFinding } from '../repositories/findings-repo';
import { recordAiAudit } from '../repositories/audit-repo';
import { getMemory, putMemory } from '../repositories/memory-knowledge-repo';
import { assertRuntimeMemoryAllowed } from './memory-policy';
import { approvalReviewFingerprint } from './approval-review';
import { resolveModelForAgent, ModelResolutionError } from '../models/router';
import { executeToolImplementation } from '../tools/implementations';
import { AGENT_HANDLERS } from '../agents/handlers';
import type { AgentRunContext, HandlerResult, ToolCallOutcome } from './types';
import { getAgentBySlug } from '../repositories/registry-repo';
import { prepareOrchestratedTask } from './task-orchestrator';
import { roleHasPermission, type AiPermission } from '../permissions';
import { READ_ONLY_RETRY_TASK_TYPES } from './read-only-retry';

export class TaskFailedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TaskFailedError';
    this.code = code;
  }
}

export interface RunHandles {
  task: TaskRow;
  agent: AgentRow;
  runId: string;
  stepOrder: number;
  pendingApprovals: string[];
  actorUserId: string | null;
  customerScopeUserId: string | null;
  readOnlyRetry: boolean;
}

/** Gated tool call — the function every handler receives as ctx.callTool. */
export async function gatedToolCall(
  db: Queryable,
  handles: RunHandles,
  name: string,
  rawArgs: Record<string, unknown>
): Promise<ToolCallOutcome> {
  const startedAt = Date.now();
  const agent = handles.agent;

  // --- Gate 1: registered tool
  const tool = getToolDefinition(name);
  if (!tool) {
    await auditDenial(db, handles, name, rawArgs, 'UNKNOWN_TOOL');
    return { status: 'denied', errorCode: 'UNKNOWN_TOOL', message: `Tool '${name}' is not registered` };
  }

  // --- Gate 1b: operator read-only retry refuses any tool that can write, before anything else
  if (handles.readOnlyRetry && tool.mutating) {
    await auditDenial(db, handles, name, rawArgs, 'READ_ONLY_RETRY_MUTATING_TOOL');
    return { status: 'denied', errorCode: 'READ_ONLY_RETRY_MUTATING_TOOL', message: `Tool '${name}' mutates state and cannot run during an operator read-only retry` };
  }

  // --- Gate 2: agent registry grants the tool
  const agentTools = agent.tools;
  if (!Array.isArray(agentTools) || !agentTools.includes(name)) {
    await auditDenial(db, handles, name, rawArgs, 'TOOL_NOT_GRANTED');
    return { status: 'denied', errorCode: 'TOOL_NOT_GRANTED', message: `Agent ${agent.slug} is not granted tool '${name}' in the registry` };
  }

  // --- Gate 3: agent holds the tool's permission
  const agentPermissions = agent.permissions;
  if (!Array.isArray(agentPermissions) || !agentPermissions.includes(tool.permission)) {
    await auditDenial(db, handles, name, rawArgs, 'PERMISSION_DENIED');
    return { status: 'denied', errorCode: 'PERMISSION_DENIED', message: `Agent ${agent.slug} lacks ${tool.permission}` };
  }

  // --- Gate 4: customer workspace scoping
  if (handles.customerScopeUserId && !tool.customerUsable) {
    await auditDenial(db, handles, name, rawArgs, 'NOT_CUSTOMER_USABLE');
    return { status: 'denied', errorCode: 'NOT_CUSTOMER_USABLE', message: `Tool '${name}' is not available inside a customer workspace` };
  }

  // --- Gate 5: validate arguments before constructing an approval
  let validated: Record<string, unknown>;
  try {
    validated = validateToolArguments(tool, rawArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid arguments';
    await insertToolCall(db, {
      runId: handles.runId, taskId: handles.task.id, agentId: agent.id, tool: name,
      permission: tool.permission, riskLevel: tool.riskLevel, arguments: redactForStorage(rawArgs),
      result: { error: message }, success: false, errorCode: 'INVALID_ARGUMENTS', durationMs: Date.now() - startedAt,
    });
    await recordAiAudit(db, {
      agentId: agent.id, userId: handles.actorUserId, taskId: handles.task.id, runId: handles.runId,
      action: 'ai.tool.invalid_arguments', tool: name, arguments: redactForStorage(rawArgs),
      model: agent.model_tier, status: 'error', riskLevel: tool.riskLevel, errorCode: 'INVALID_ARGUMENTS', durationMs: Date.now() - startedAt,
    });
    return { status: 'failed', errorCode: 'INVALID_ARGUMENTS', message };
  }

  // Never seal a proposal that names a different customer than the authenticated workspace.
  if (handles.customerScopeUserId && typeof validated.userId === 'string' && validated.userId !== handles.customerScopeUserId) {
    await auditDenial(db, handles, name, validated, 'CUSTOMER_SCOPE_MISMATCH');
    return { status: 'denied', errorCode: 'CUSTOMER_SCOPE_MISMATCH', message: 'Customer scope does not match the request' };
  }

  // --- Gate 6: approval policy
  const needsApproval =
    tool.approval === 'always' ||
    (tool.approval === 'policy' && agent.approval_policy !== 'automatic');
  if (needsApproval) {
    const stored = redactForStorage(validated);
    // A reviewer must not approve an action silently changed by coercion, trimming, truncation,
    // dropping unknown keys or redaction. Do not persist the rejected input in this denial audit.
    const containsPlaceholder = Object.values(validated).some((value) => typeof value === 'string' && (value.includes('[redacted]') || value.includes('[truncated]')));
    if (!isDeepStrictEqual(rawArgs, validated) || !isDeepStrictEqual(validated, stored) || containsPlaceholder) {
      await auditDenial(db, handles, name, {}, 'APPROVAL_ARGUMENTS_NOT_PRESERVABLE');
      return { status: 'denied', errorCode: 'APPROVAL_ARGUMENTS_NOT_PRESERVABLE', message: 'Approval cannot safely preserve these arguments' };
    }
    const approval = await createApproval(db, {
      agentId: agent.id,
      taskId: handles.task.id,
      runId: handles.runId,
      tool: name,
      action: `${name}()`,
      reason: `Agent ${agent.slug} requests ${name} (risk: ${tool.riskLevel}, policy: ${tool.approval === 'always' ? 'always requires human approval' : `agent policy '${agent.approval_policy}'`}).`,
      evidence: [],
      riskLevel: ['medium', 'high', 'critical'].includes(tool.riskLevel) ? tool.riskLevel : 'high',
      affectedCustomerId: handles.customerScopeUserId ?? (typeof validated.userId === 'string' ? validated.userId : handles.task.customer_id),
      affectedResource: null,
      arguments: stored as Record<string, unknown>,
      argumentsVerified: true,
    });
    handles.pendingApprovals.push(approval.id);
    await insertToolCall(db, {
      runId: handles.runId,
      taskId: handles.task.id,
      agentId: agent.id,
      approvalId: approval.id,
      tool: name,
      permission: tool.permission,
      riskLevel: tool.riskLevel,
      arguments: redactForStorage(validated),
      result: { status: 'pending_approval', approvalId: approval.id },
      success: false,
      errorCode: 'PENDING_APPROVAL',
      durationMs: Date.now() - startedAt,
    });
    await recordAiAudit(db, {
      agentId: agent.id,
      userId: handles.actorUserId,
      taskId: handles.task.id,
      runId: handles.runId,
      approvalId: approval.id,
      action: 'ai.tool.pending_approval',
      tool: name,
      arguments: redactForStorage(validated),
      decision: null,
      model: agent.model_tier,
      status: 'pending_approval',
      riskLevel: tool.riskLevel,
      durationMs: Date.now() - startedAt,
    });
    return { status: 'pending_approval', approvalId: approval.id, message: `${name} requires human approval — an approval request was created in the Human Decision Inbox` };
  }

  // --- Gate 7: execute
  return executeAndRecordTool(db, handles, name, validated, startedAt, redactForStorage(rawArgs) as Record<string, unknown>, null);
}

async function executeAndRecordTool(
  db: Queryable,
  handles: RunHandles,
  name: string,
  validatedArgs: Record<string, unknown>,
  startedAt: number,
  storedArgs: Record<string, unknown>,
  approvalId: string | null
): Promise<ToolCallOutcome> {
  const agent = handles.agent;
  const tool = getToolDefinition(name)!;
  // Liveness observation immediately before dispatch — narrows the blind window around a long
  // tool call. It does not fence the effect itself or certify any provider outcome.
  await db.query(`UPDATE ai_tasks SET heartbeat_at = now() WHERE id = $1`, [handles.task.id]);
  const result = await executeToolImplementation(
    {
      db,
      customerScopeUserId: handles.customerScopeUserId,
      actorUserId: handles.actorUserId,
      executionId: approvalId ?? handles.runId,
      agentId: agent.id,
    },
    name,
    validatedArgs
  );
  const durationMs = Date.now() - startedAt;
  await insertToolCall(db, {
    runId: handles.runId,
    taskId: handles.task.id,
    agentId: agent.id,
    approvalId,
    tool: name,
    permission: tool.permission,
    riskLevel: tool.riskLevel,
    arguments: storedArgs,
    result: result.ok ? redactForStorage(result.data) : { error: result.message, code: result.code },
    success: result.ok,
    errorCode: result.ok ? null : result.code,
    durationMs,
  });
  await recordAiAudit(db, {
    agentId: agent.id,
    userId: handles.actorUserId,
    taskId: handles.task.id,
    runId: handles.runId,
    approvalId,
    action: result.ok ? 'ai.tool.executed' : 'ai.tool.failed',
    tool: name,
    arguments: storedArgs,
    result: result.ok ? redactForStorage(result.data) : { error: result.message },
    model: agent.model_tier,
    status: result.ok ? 'ok' : 'error',
    riskLevel: tool.riskLevel,
    durationMs,
    errorCode: result.ok ? null : result.code,
  });
  if (!result.ok) {
    return { status: 'failed', errorCode: result.code, message: result.message };
  }
  return { status: 'executed', data: result.data, evidence: result.evidence };
}

async function auditDenial(db: Queryable, handles: RunHandles, name: string, args: Record<string, unknown>, code: string): Promise<void> {
  await recordAiAudit(db, {
    agentId: handles.agent.id,
    userId: handles.actorUserId,
    taskId: handles.task.id,
    runId: handles.runId,
    action: 'ai.tool.denied',
    tool: name,
    arguments: redactForStorage(args),
    decision: 'blocked',
    model: handles.agent.model_tier,
    status: 'denied',
    errorCode: code,
  });
}

type RunTaskOptions = {
  actorUserId?: string | null;
  customerScopeUserId?: string | null;
  boardDepth?: number;
  /** Operator retry must carry the task snapshot whose eligibility was audited. */
  readOnlyRetry?: boolean;
  retryExpectedTask?: TaskRow;
  /** Authenticated operator, distinct from the task's original requester. */
  retryOperatorUserId?: string;
};

/** This is a consistency check, not caller authentication; entry points must authorize first. */
async function assertRunScope(db: Queryable, task: TaskRow, opts: RunTaskOptions): Promise<void> {
  const customerTask = task.requested_by_type === 'customer';
  let invalid = customerTask
    ? !task.customer_id || task.requested_by !== task.customer_id ||
      (opts.customerScopeUserId != null && opts.customerScopeUserId !== task.customer_id)
    : opts.customerScopeUserId != null;
  if (opts.actorUserId != null && opts.actorUserId !== task.requested_by) invalid = true;
  if (!invalid && customerTask) {
    const active = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND status = 'active'`, [task.customer_id]);
    invalid = !active.rows[0];
  }
  if (invalid) {
    // No caller-supplied identity or task data in the denial response or audit arguments.
    await recordAiAudit(db, { agentId: task.agent_id, taskId: task.id, action: 'ai.run.blocked', status: 'denied', decision: 'blocked', errorCode: 'CUSTOMER_SCOPE_INVALID' });
    throw new TaskFailedError('CUSTOMER_SCOPE_INVALID', 'Task scope is invalid');
  }
}

function sameRunIdentity(a: TaskRow, b: TaskRow): boolean {
  return a.agent_id === b.agent_id && a.task_type === b.task_type && a.requested_by_type === b.requested_by_type &&
    a.requested_by === b.requested_by && a.customer_id === b.customer_id && a.entry_point === b.entry_point;
}

/** Only these server-derived human entry points have a known governance permission. */
function claimPermission(entryPoint: string | null): AiPermission | null {
  switch (entryPoint) {
    case 'admin.task': return 'ai.tasks.run';
    case 'admin.copilot': return 'ai.copilot.execute';
    case 'admin.board.briefing': return 'ai.board.briefings';
    default: return null;
  }
}

/**
 * Runs a task end-to-end through its registered deterministic handler. Synchronous by design:
 * the native engine is local DB work, so the route/workflow gets the real final status.
 */
export async function runTask(
  db: Queryable,
  taskId: string,
  opts: RunTaskOptions = {}
): Promise<{ task: TaskRow; runStatus: string; pendingApprovals: string[] }> {
  const initialTask = await getTask(db, taskId);
  if (!initialTask) throw new TaskFailedError('NOT_FOUND', 'Task not found');
  // Reject mismatches before claiming or returning a task, including already-finished tasks.
  // Caller authentication remains the entry point's responsibility.
  await assertRunScope(db, initialTask, opts);
  const retryExpected = opts.readOnlyRetry ? opts.retryExpectedTask : undefined;
  if (opts.readOnlyRetry && (!retryExpected || retryExpected.id !== taskId ||
      !READ_ONLY_RETRY_TASK_TYPES.has(retryExpected.task_type) || !READ_ONLY_RETRY_TASK_TYPES.has(initialTask.task_type))) {
    throw new TaskFailedError('RETRY_CLAIM_UNAVAILABLE', 'Retry eligibility changed; execution refused');
  }
  // Claim once, but only if the previously checked scope and routing identity still match and
  // the customer is still active. This guards the read→claim race, not effects already dispatched.
  const claim = async (handle: Queryable): Promise<TaskRow | undefined> => {
    const { rows } = await handle.query<TaskRow>(
      `UPDATE ai_tasks SET status = 'running', heartbeat_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'queued' AND agent_id = $2 AND task_type = $3
         AND requested_by_type = $4 AND requested_by IS NOT DISTINCT FROM $5::uuid
         AND customer_id IS NOT DISTINCT FROM $6::uuid AND entry_point IS NOT DISTINCT FROM $7
         AND (requested_by_type <> 'customer' OR EXISTS (SELECT 1 FROM users u WHERE u.id = ai_tasks.customer_id AND u.status = 'active'))
         ${retryExpected ? `AND agent_id = $8 AND task_type = $9 AND requested_by_type = $10
         AND requested_by IS NOT DISTINCT FROM $11::uuid AND customer_id IS NOT DISTINCT FROM $12::uuid
         AND entry_point IS NOT DISTINCT FROM $13 AND subject_type IS NOT DISTINCT FROM $14::text
         AND subject_id IS NOT DISTINCT FROM $15::uuid AND context = $16::jsonb AND priority = $17
         AND run_after <= now()
         AND NOT EXISTS (SELECT 1 FROM ai_runs r WHERE r.task_id = ai_tasks.id)
         AND NOT EXISTS (SELECT 1 FROM ai_tool_calls c WHERE c.task_id = ai_tasks.id)` : ''}
       RETURNING *`,
      [taskId, initialTask.agent_id, initialTask.task_type, initialTask.requested_by_type, initialTask.requested_by, initialTask.customer_id, initialTask.entry_point,
        ...(retryExpected ? [retryExpected.agent_id, retryExpected.task_type, retryExpected.requested_by_type, retryExpected.requested_by,
          retryExpected.customer_id, retryExpected.entry_point, retryExpected.subject_type, retryExpected.subject_id,
          JSON.stringify(retryExpected.context), retryExpected.priority] : [])],
    );
    return rows[0];
  };
  const permission = claimPermission(initialTask.entry_point);
  const customerTask = initialTask.requested_by_type === 'customer';
  const claimResult = permission || customerTask || opts.readOnlyRetry
    ? await withTransaction(db, async (tx) => {
      // Lock the retry operator separately from the original requester. Both must retain
      // their applicable permissions through claim; neither lock fences post-commit effects.
      if (opts.readOnlyRetry) {
        if (!opts.retryOperatorUserId) return { denied: 'RETRY_OPERATOR_UNAUTHORIZED' as const };
        const { rows } = await tx.query<{ role: string }>(
          `SELECT role FROM users WHERE id = $1 AND status = 'active' FOR SHARE`, [opts.retryOperatorUserId],
        );
        if (!rows[0] || !roleHasPermission(rows[0].role, 'ai.tasks.retry')) return { denied: 'RETRY_OPERATOR_UNAUTHORIZED' as const };
      }
      // Serialize original actor status (and admin permission where applicable) with claim.
      if (permission) {
        if (initialTask.requested_by_type !== 'staff' || !initialTask.requested_by) return { denied: 'REQUESTER_AUTHORIZATION_UNAVAILABLE' as const };
        const { rows } = await tx.query<{ role: string }>(
          `SELECT role FROM users WHERE id = $1 AND status = 'active' FOR SHARE`, [initialTask.requested_by],
        );
        if (!rows[0] || !roleHasPermission(rows[0].role, permission)) return { denied: 'REQUESTER_AUTHORIZATION_UNAVAILABLE' as const };
      }
      if (customerTask) {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR SHARE`, [initialTask.customer_id],
        );
        if (!rows[0]) return { denied: 'CUSTOMER_SCOPE_INVALID' as const };
      }
      return { denied: null, task: await claim(tx) };
    })
    : { denied: null, task: await claim(db) };
  if (claimResult.denied) {
    await recordAiAudit(db, { agentId: initialTask.agent_id, taskId, action: 'ai.run.blocked', status: 'denied', decision: 'blocked', errorCode: claimResult.denied });
    const message = claimResult.denied === 'CUSTOMER_SCOPE_INVALID' ? 'Task scope is invalid'
      : claimResult.denied === 'RETRY_OPERATOR_UNAUTHORIZED' ? 'Retry operator is no longer authorized'
        : 'Task requester is no longer authorized';
    throw new TaskFailedError(claimResult.denied, message);
  }
  const task = claimResult.task;
  if (!task) {
    // The audited retry snapshot or never-claimed proof may have changed after preflight.
    // Do not run or present a different task as the result of this operator decision.
    if (retryExpected) throw new TaskFailedError('RETRY_CLAIM_UNAVAILABLE', 'Retry eligibility changed; execution refused');
    const current = await getTask(db, taskId);
    if (!current) throw new TaskFailedError('NOT_FOUND', 'Task not found');
    await assertRunScope(db, current, opts);
    if (!sameRunIdentity(initialTask, current)) throw new TaskFailedError('TASK_IDENTITY_CHANGED', 'Task identity changed; execution refused');
    if (current.status === 'queued') throw new TaskFailedError('TASK_CLAIM_UNAVAILABLE', 'Task claim unavailable');
    return { task: current, runStatus: current.status, pendingApprovals: [] };
  }
  const agent = await getAgentById(db, task.agent_id);
  if (!agent) throw new TaskFailedError('INTERNAL', 'Agent registry row is missing');
  const executionCustomerScope = task.requested_by_type === 'customer' ? task.customer_id : null;
  if (!agent.enabled || agent.status !== 'active') {
    await updateTaskStatus(db, taskId, 'failed', {
      errorCode: 'AGENT_DISABLED',
      errorMessage: `Agent ${agent.slug} is disabled — tasks are not executed by disabled agents.`,
      completed: true,
    });
    await recordAiAudit(db, {
      agentId: agent.id, taskId, action: 'ai.run.blocked', status: 'denied', decision: 'blocked',
      errorCode: 'AGENT_DISABLED', model: agent.model_tier,
    });
    const refreshed = await getTask(db, taskId);
    return { task: refreshed ?? task, runStatus: 'failed', pendingApprovals: [] };
  }

  if (!Array.isArray(agent.task_types) || !agent.task_types.includes(task.task_type)) {
    await updateTaskStatus(db, taskId, 'failed', {
      errorCode: 'TASK_NOT_GRANTED', errorMessage: 'Task type is not granted to this agent.', completed: true,
    });
    await recordAiAudit(db, {
      agentId: agent.id, taskId, action: 'ai.run.blocked', status: 'denied', decision: 'blocked',
      errorCode: 'TASK_NOT_GRANTED', model: agent.model_tier,
    });
    const refreshed = await getTask(db, taskId);
    return { task: refreshed ?? task, runStatus: 'failed', pendingApprovals: [] };
  }

  // Model routing — fail-closed (§37). A disabled/misconfigured engine fails the task loudly.
  let model;
  try {
    model = await resolveModelForAgent(db, agent);
  } catch (err) {
    if (err instanceof ModelResolutionError) {
      await updateTaskStatus(db, taskId, 'failed', { errorCode: err.code, errorMessage: err.message, completed: true });
      await recordAiAudit(db, {
        agentId: agent.id, taskId, action: 'ai.run.configuration_required', model: agent.model_tier,
        status: 'error', errorCode: err.code, errorMessage: err.message,
      });
      const refreshed = await getTask(db, taskId);
      return { task: refreshed ?? task, runStatus: 'failed', pendingApprovals: [] };
    }
    throw err;
  }

  const run = await insertRun(db, {
    taskId,
    agentId: agent.id,
    engine: model.engine,
    model: model.model,
    input: (task.context ?? {}) as Record<string, unknown>,
  });

  const handles: RunHandles = {
    task,
    agent,
    runId: run.id,
    stepOrder: 0,
    pendingApprovals: [],
    actorUserId: opts.actorUserId ?? task.requested_by,
    customerScopeUserId: executionCustomerScope,
    readOnlyRetry: opts.readOnlyRetry === true,
  };

  const startedAt = Date.now();
  const ctx: AgentRunContext = {
    db,
    agent,
    task,
    runId: run.id,
    actorUserId: handles.actorUserId,
    customerScopeUserId: handles.customerScopeUserId,
    async callTool(name, args) {
      return gatedToolCall(db, handles, name, args);
    },
    async emitFinding(input) {
      const { finding, created } = await createFinding(db, {
        agentId: agent.id,
        runId: run.id,
        taskId: task.id,
        findingType: input.findingType,
        severity: input.severity,
        title: input.title,
        summary: input.summary,
        evidence: input.evidence,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        recommendation: input.recommendation ?? null,
        dedupeOpen: input.dedupeOpen,
      });
      return { id: finding.id, created };
    },
    async step(phase, detail) {
      handles.stepOrder += 1;
      await insertRunStep(db, run.id, handles.stepOrder, phase, redactForStorage(detail) as Record<string, unknown>);
      // Liveness observation for interrupted-state detection. Not a lease, fence or replay
      // signal: a stale value only means no progress has been observed recently.
      await db.query(`UPDATE ai_tasks SET heartbeat_at = now() WHERE id = $1`, [handles.task.id]);
    },
    async putMemory(key, value, scope = 'operational', expiresAt = null) {
      assertRuntimeMemoryAllowed(task, scope);
      await putMemory(db, {
        scope,
        customerId: scope === 'customer' ? task.customer_id : null,
        agentSlug: agent.slug,
        key,
        value: redactForStorage(value),
        expiresAt,
      });
    },
    async getMemory<T = unknown>(key: string, scope: 'short' | 'customer' | 'operational' | 'organizational' | 'executive' = 'operational') {
      assertRuntimeMemoryAllowed(task, scope);
      const row = await getMemory(db, scope, scope === 'customer' ? task.customer_id : null, agent.slug, key);
      return row ? { value: row.value as T } : null;
    },
    async runChildAgent(taskType, input, childOpts) {
      // Board coordination: the child agent runs as a REAL task under its own registry identity
      // and permissions — the parent only aggregates what the child itself concluded.
      // A retry's audited read-only allowlist applies to the parent handler only. A child
      // could use another task type and lose the retry's tool gate, so do not dispatch one.
      if (handles.readOnlyRetry) {
        await ctx.step('plan', { note: 'runChildAgent refused during read-only retry' });
        return { status: 'refused', summary: 'Child dispatch unavailable during read-only retry', result: null, agentSlug: childOpts?.agentSlug ?? 'unknown' };
      }
      // The in-memory depth is lost if a queued child is later run by another caller.
      // Its persisted entry point is an additional recursion guard, not proof of parent
      // provenance or authority (legacy rows without an entry point remain unresolved).
      if (task.entry_point === 'board.child' || (opts.boardDepth ?? 0) >= 1) {
        await ctx.step('plan', { note: 'runChildAgent refused: board depth limit reached (no recursive board calls)' });
        return { status: 'refused', summary: 'Board recursion depth limit', result: null, agentSlug: childOpts?.agentSlug ?? 'unknown' };
      }
      const childAgent = await getAgentBySlug(db, childOpts?.agentSlug ?? '');
      if (!childAgent) {
        return { status: 'failed', summary: `Child agent '${childOpts?.agentSlug ?? ''}' is not registered`, result: null, agentSlug: childOpts?.agentSlug ?? 'unknown' };
      }
      const { task: childTask, created } = await prepareOrchestratedTask(db, {
        agentId: childAgent.id,
        taskType,
        context: input,
        requestedBy: handles.customerScopeUserId ?? handles.actorUserId,
        requestedByType: handles.customerScopeUserId ? 'customer' : 'board',
        customerId: task.customer_id,
        entryPoint: 'board.child',
        idempotencyKey: childOpts?.idempotencyKey ?? null,
      });
      if (!created && (!childAgent.enabled || childAgent.status !== 'active' || !Array.isArray(childAgent.task_types) || !childAgent.task_types.includes(taskType))) {
        return { status: 'refused', summary: 'Child agent or task grant unavailable', result: null, agentSlug: childAgent.slug };
      }
      const outcome = created
        ? await runTask(db, childTask.id, {
          actorUserId: handles.customerScopeUserId ?? handles.actorUserId,
          customerScopeUserId: handles.customerScopeUserId,
          boardDepth: (opts.boardDepth ?? 0) + 1,
        })
        : { task: childTask, runStatus: childTask.status, pendingApprovals: [] };
      return {
        status: outcome.runStatus,
        summary: outcome.task.result_summary,
        result: (outcome.task.result ?? null) as Record<string, unknown> | null,
        agentSlug: childAgent.slug,
      };
    },
  };

  const handler = AGENT_HANDLERS[task.task_type];
  await ctx.step('observe', { taskType: task.task_type, subject: [task.subject_type, task.subject_id].filter(Boolean).join(':') || null });

  if (!handler) {
    const message = `No handler registered for task type '${task.task_type}'. The task fails honestly instead of producing synthetic output.`;
    await ctx.step('understand', { error: message });
    await completeRun(db, run.id, 'failed', { errorCode: 'NO_HANDLER', errorMessage: message, durationMs: Date.now() - startedAt });
    await updateTaskStatus(db, taskId, 'failed', { errorCode: 'NO_HANDLER', errorMessage: message, completed: true });
    await recordAiAudit(db, { agentId: agent.id, taskId, runId: run.id, action: 'ai.run.failed', model: model.model, status: 'error', errorCode: 'NO_HANDLER', durationMs: Date.now() - startedAt });
    const refreshed = await getTask(db, taskId);
    return { task: refreshed ?? task, runStatus: 'failed', pendingApprovals: [] };
  }

  let handlerResult: HandlerResult;
  try {
    handlerResult = await handler(ctx, (task.context ?? {}) as Record<string, unknown>);
  } catch (err) {
    const code = err instanceof TaskFailedError ? err.code : 'HANDLER_ERROR';
    const message = err instanceof Error ? err.message : 'Unknown handler failure';
    await completeRun(db, run.id, 'failed', { errorCode: code, errorMessage: message, durationMs: Date.now() - startedAt });
    await updateTaskStatus(db, taskId, 'failed', { errorCode: code, errorMessage: message, completed: true });
    await recordAiAudit(db, { agentId: agent.id, taskId, runId: run.id, action: 'ai.run.failed', model: model.model, status: 'error', errorCode: code, errorMessage: message, durationMs: Date.now() - startedAt });
    const refreshed = await getTask(db, taskId);
    return { task: refreshed ?? task, runStatus: 'failed', pendingApprovals: handles.pendingApprovals };
  }

  if (handles.pendingApprovals.length > 0) {
    // Runs pause instead of lying: the action components are sealed in approval requests.
    await ctx.step('authorize', { pendingApprovals: handles.pendingApprovals });
    await completeRun(db, run.id, 'awaiting_approval', {
      output: { summary: handlerResult.summary, pendingApprovals: handles.pendingApprovals },
      verification: handlerResult.verification ?? null,
      durationMs: Date.now() - startedAt,
    });
    await updateTaskStatus(db, taskId, 'awaiting_approval', {
      resultSummary: `${handlerResult.summary} (${handles.pendingApprovals.length} action(s) awaiting human approval)`,
      result: { pendingApprovals: handles.pendingApprovals },
    });
    await recordAiAudit(db, {
      agentId: agent.id, taskId, runId: run.id, action: 'ai.run.awaiting_approval', model: model.model,
      status: 'pending_approval', riskLevel: agent.risk_level, durationMs: Date.now() - startedAt,
    });
    const refreshed = await getTask(db, taskId);
    return { task: refreshed ?? task, runStatus: 'awaiting_approval', pendingApprovals: handles.pendingApprovals };
  }

  await ctx.step('report', { summary: handlerResult.summary });
  await completeRun(db, run.id, 'succeeded', {
    output: { summary: handlerResult.summary, ...(handlerResult.result ?? {}) },
    verification: handlerResult.verification ?? null,
    durationMs: Date.now() - startedAt,
  });
  await updateTaskStatus(db, taskId, 'succeeded', {
    resultSummary: handlerResult.summary,
    result: handlerResult.result ?? {},
    completed: true,
  });
  await recordAiAudit(db, {
    agentId: agent.id, taskId, runId: run.id, action: 'ai.run.succeeded', model: model.model,
    status: 'ok', riskLevel: agent.risk_level, durationMs: Date.now() - startedAt,
    result: { summary: handlerResult.summary },
  });
  const refreshed = await getTask(db, taskId);
  return { task: refreshed ?? task, runStatus: 'succeeded', pendingApprovals: [] };
}

/**
 * Atomically claims an approved action before execution. A claimed action is never automatically
 * retried after interruption. Re-check the current agent, human, task and tool grants and restore
 * customer scope before executing; an approval is not a permanent authorization bypass.
 */
export async function executeApprovedApproval(
  db: Queryable,
  approvalId: string,
  decidedByUserId: string,
  reviewFingerprint: string
): Promise<{ ok: boolean; approvalStatus: string; error?: string }> {
  // Pair the effect-intent claim with the approval execution claim in one transaction: either
  // both are claimed or neither is, so a crash can never leave 'executing' beside 'pending'.
  const approval = await withTransaction(db, async (tx) => {
    const claimed = await claimApprovalExecution(tx, approvalId, decidedByUserId);
    if (claimed && !(await claimEffectIntent(tx, approvalEffectKey(approvalId)))) {
      // Only approvals predating the outbox may lack a row. An existing non-pending row
      // means the execution is fenced: throw to roll back the approval claim as well.
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM ai_effect_outbox WHERE approval_id = $1`, [approvalId],
      );
      if (existing.rows[0]) throw new Error('Effect intent cannot be claimed; reconciliation required');
    }
    return claimed;
  });
  if (!approval) {
    const existing = await getApproval(db, approvalId);
    return { ok: false, approvalStatus: existing?.status ?? 'unknown', error: 'Approval cannot be claimed for execution' };
  }
  const deny = async (message: string) => {
    await withTransaction(db, async (tx) => {
      await markApprovalExecuted(tx, approvalId, false, { error: message });
      // The effect never ran, but the approval is terminal — close the intent with the reason
      // so it does not strand as a pending/dispatched row.
      await recordEffectOutcome(tx, approvalEffectKey(approvalId), 'failed', message);
      await recordAiAudit(tx, {
        agentId: approval.agent_id, userId: decidedByUserId, taskId: approval.task_id, runId: approval.run_id,
        approvalId, action: 'ai.approval.execution_denied', tool: approval.tool,
        status: 'denied', decision: 'blocked', errorCode: 'APPROVAL_REAUTHORIZATION_FAILED',
      });
    });
    return { ok: false, approvalStatus: 'failed', error: message };
  };
  if (approvalReviewFingerprint(approval) !== reviewFingerprint) return deny('Approval changed after review');
  if (approval.arguments_verified !== true) return deny('Approval arguments lack preservation evidence');
  const { rows: approvers } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 AND status = 'active' AND role IN ('admin', 'super_admin')`,
    [decidedByUserId]
  );
  if (!approvers[0]) return deny('Approver is no longer authorized');
  const agent = await getAgentById(db, approval.agent_id);
  if (!agent || !agent.enabled || agent.status !== 'active') return deny('Agent is unavailable or disabled');
  const tool = getToolDefinition(approval.tool);
  if (!tool || !Array.isArray(agent.tools) || !agent.tools.includes(approval.tool) ||
      !Array.isArray(agent.permissions) || !agent.permissions.includes(tool.permission)) {
    return deny('Tool or agent permission is no longer granted');
  }
  if (!approval.task_id || !approval.run_id) return deny('Original task or run is unavailable');
  const task = await getTask(db, approval.task_id);
  if (!task || task.agent_id !== agent.id || task.status !== 'awaiting_approval' ||
      !Array.isArray(agent.task_types) || !agent.task_types.includes(task.task_type)) {
    return deny('Original task is no longer eligible');
  }
  const { rows: runs } = await db.query<{ id: string }>(
    `SELECT id FROM ai_runs WHERE id = $1 AND task_id = $2 AND agent_id = $3 AND status = 'awaiting_approval'`,
    [approval.run_id, task.id, agent.id]
  );
  if (!runs[0]) return deny('Original run is no longer eligible');
  const customerScopeUserId = task.requested_by_type === 'customer' ? task.customer_id : null;
  if (task.requested_by_type === 'customer' && (!customerScopeUserId || task.requested_by !== customerScopeUserId ||
      approval.affected_customer_id !== customerScopeUserId || !tool.customerUsable)) {
    return deny('Customer scope is unavailable or inconsistent');
  }
  if (customerScopeUserId) {
    const active = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND status = 'active'`, [customerScopeUserId]);
    if (!active.rows[0]) return deny('Customer account is unavailable');
  }
  let validated: Record<string, unknown>;
  try {
    validated = validateToolArguments(tool, (approval.arguments ?? {}) as Record<string, unknown>);
  } catch {
    return deny('Sealed arguments failed revalidation');
  }
  if (!isDeepStrictEqual(approval.arguments, validated) || !isDeepStrictEqual(validated, redactForStorage(validated)) ||
      Object.values(validated).some((value) => typeof value === 'string' && (value.includes('[redacted]') || value.includes('[truncated]')))) {
    return deny('Approval arguments cannot be preserved');
  }
  if (customerScopeUserId && typeof validated.userId === 'string' && validated.userId !== customerScopeUserId) {
    return deny('Sealed arguments do not match customer scope');
  }
  const startedAt = Date.now();
  const handles: RunHandles = {
    task,
    agent,
    runId: approval.run_id,
    stepOrder: 0,
    pendingApprovals: [],
    actorUserId: decidedByUserId,
    customerScopeUserId,
    // Approved-effect execution is never a read-only retry; its own claim (0108) gates it.
    readOnlyRetry: false,
  };
  const outcome = await executeAndRecordTool(db, handles, approval.tool, validated, startedAt, (approval.arguments ?? {}) as Record<string, unknown>, approvalId);
  const success = outcome.status === 'executed';
  // This transaction does not include the tool effect; audit/commit failures after an effect
  // leave the non-expiring executing claim for investigation, never automatic replay.
  await withTransaction(db, async (tx) => {
    await markApprovalExecuted(tx, approvalId, success, outcome.status === 'executed' ? redactForStorage(outcome.data) : { error: outcome.message, code: outcome.errorCode });
    // Outcome commits atomically with the approval finalization.
    await recordEffectOutcome(
      tx, approvalEffectKey(approvalId), success ? 'succeeded' : 'failed',
      success ? null : (outcome.errorCode ?? 'execution failed'),
    );
    await recordAiAudit(tx, {
      agentId: agent.id,
      userId: decidedByUserId,
      taskId: approval.task_id,
      runId: approval.run_id,
      approvalId,
      action: success ? 'ai.approval.executed' : 'ai.approval.execution_failed',
      tool: approval.tool,
      model: agent.model_tier,
      status: success ? 'ok' : 'error',
      riskLevel: approval.risk_level,
      durationMs: Date.now() - startedAt,
      errorCode: success ? null : outcome.errorCode ?? null,
    });
  });
  return { ok: success, approvalStatus: success ? 'executed' : 'failed', error: success ? undefined : outcome.message };
}
