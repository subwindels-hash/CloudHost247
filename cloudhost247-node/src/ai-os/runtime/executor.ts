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
 *     5. approval policy                        — 'always' tools, or 'policy' tools for
 *        non-automatic agents, never execute: they seal their arguments into a Human Decision
 *        Inbox row and the run pauses at awaiting_approval
 *     6. argument validation                    — against the tool contract
 *     7. execution + timing + verification data — then redacted, audited, recorded
 *
 * runTask(): loads task + agent, resolves the model engine (fail-closed), runs the registered
 * deterministic handler, and completes with real statuses only. A failed agent leaves a failed
 * task with a real error — never a synthetic success.
 */
import type { Queryable } from '../../db/types';
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
import { createApproval, getApproval, markApprovalExecuted } from '../repositories/approvals-repo';
import { createFinding } from '../repositories/findings-repo';
import { recordAiAudit } from '../repositories/audit-repo';
import { getMemory, putMemory } from '../repositories/memory-knowledge-repo';
import { resolveModelForAgent, ModelResolutionError } from '../models/router';
import { executeToolImplementation } from '../tools/implementations';
import { AGENT_HANDLERS } from '../agents/handlers';
import type { AgentRunContext, HandlerResult, ToolCallOutcome } from './types';
import { getAgentBySlug } from '../repositories/registry-repo';
import { createTask } from '../repositories/tasks-repo';

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

  // --- Gate 2: agent registry grants the tool
  const agentTools = (agent.tools as unknown as string[]) ?? [];
  if (!agentTools.includes(name)) {
    await auditDenial(db, handles, name, rawArgs, 'TOOL_NOT_GRANTED');
    return { status: 'denied', errorCode: 'TOOL_NOT_GRANTED', message: `Agent ${agent.slug} is not granted tool '${name}' in the registry` };
  }

  // --- Gate 3: agent holds the tool's permission
  const agentPermissions = (agent.permissions as unknown as string[]) ?? [];
  if (!agentPermissions.includes(tool.permission)) {
    await auditDenial(db, handles, name, rawArgs, 'PERMISSION_DENIED');
    return { status: 'denied', errorCode: 'PERMISSION_DENIED', message: `Agent ${agent.slug} lacks ${tool.permission}` };
  }

  // --- Gate 4: customer workspace scoping
  if (handles.customerScopeUserId && !tool.customerUsable) {
    await auditDenial(db, handles, name, rawArgs, 'NOT_CUSTOMER_USABLE');
    return { status: 'denied', errorCode: 'NOT_CUSTOMER_USABLE', message: `Tool '${name}' is not available inside a customer workspace` };
  }

  // --- Gate 5: approval policy
  const needsApproval =
    tool.approval === 'always' ||
    (tool.approval === 'policy' && agent.approval_policy !== 'automatic');
  if (needsApproval) {
    const approval = await createApproval(db, {
      agentId: agent.id,
      taskId: handles.task.id,
      runId: handles.runId,
      tool: name,
      action: `${name}()`,
      reason: `Agent ${agent.slug} requests ${name} (risk: ${tool.riskLevel}, policy: ${tool.approval === 'always' ? 'always requires human approval' : `agent policy '${agent.approval_policy}'`}).`,
      evidence: [],
      riskLevel: ['medium', 'high', 'critical'].includes(tool.riskLevel) ? tool.riskLevel : 'high',
      affectedCustomerId: typeof rawArgs.userId === 'string' ? rawArgs.userId : handles.task.customer_id,
      affectedResource: null,
      arguments: redactForStorage(rawArgs) as Record<string, unknown>,
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
      arguments: redactForStorage(rawArgs),
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
      arguments: redactForStorage(rawArgs),
      decision: null,
      model: agent.model_tier,
      status: 'pending_approval',
      riskLevel: tool.riskLevel,
      durationMs: Date.now() - startedAt,
    });
    return { status: 'pending_approval', approvalId: approval.id, message: `${name} requires human approval — an approval request was created in the Human Decision Inbox` };
  }

  // --- Gate 6: validate arguments
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

/**
 * Runs a task end-to-end through its registered deterministic handler. Synchronous by design:
 * the native engine is local DB work, so the route/workflow gets the real final status.
 */
export async function runTask(
  db: Queryable,
  taskId: string,
  opts: { actorUserId?: string | null; customerScopeUserId?: string | null; boardDepth?: number } = {}
): Promise<{ task: TaskRow; runStatus: string; pendingApprovals: string[] }> {
  const task = await getTask(db, taskId);
  if (!task) throw new TaskFailedError('NOT_FOUND', 'Task not found');
  if (!['queued', 'awaiting_approval'].includes(task.status)) {
    return { task, runStatus: task.status, pendingApprovals: [] };
  }
  const agent = await getAgentById(db, task.agent_id);
  if (!agent) throw new TaskFailedError('INTERNAL', 'Agent registry row is missing');
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
    customerScopeUserId: opts.customerScopeUserId ?? null,
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
    },
    async putMemory(key, value, scope = 'operational', expiresAt = null) {
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
      const row = await getMemory(db, scope, scope === 'customer' ? task.customer_id : null, agent.slug, key);
      return row ? { value: row.value as T } : null;
    },
    async runChildAgent(taskType, input, childOpts) {
      // Board coordination: the child agent runs as a REAL task under its own registry identity
      // and permissions — the parent only aggregates what the child itself concluded.
      if ((opts.boardDepth ?? 0) >= 1) {
        await ctx.step('plan', { note: 'runChildAgent refused: board depth limit reached (no recursive board calls)' });
        return { status: 'refused', summary: 'Board recursion depth limit', result: null, agentSlug: childOpts?.agentSlug ?? 'unknown' };
      }
      const childAgent = await getAgentBySlug(db, childOpts?.agentSlug ?? '');
      if (!childAgent) {
        return { status: 'failed', summary: `Child agent '${childOpts?.agentSlug ?? ''}' is not registered`, result: null, agentSlug: childOpts?.agentSlug ?? 'unknown' };
      }
      const { task: childTask } = await createTask(db, {
        agentId: childAgent.id,
        taskType,
        context: input,
        requestedBy: handles.actorUserId,
        requestedByType: 'board',
        customerId: task.customer_id,
        idempotencyKey: childOpts?.idempotencyKey ?? null,
      });
      const outcome = await runTask(db, childTask.id, {
        actorUserId: handles.actorUserId,
        boardDepth: (opts.boardDepth ?? 0) + 1,
      });
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
 * Executes the sealed tool call of an APPROVED approval row. Called by the decision route only
 * after decideApproval() transitioned the row atomically. The redacted-but-complete arguments
 * stored at request time are revalidated against the tool contract before execution — nobody
 * can smuggle changed arguments through the inbox.
 */
export async function executeApprovedApproval(
  db: Queryable,
  approvalId: string,
  decidedByUserId: string
): Promise<{ ok: boolean; approvalStatus: string; error?: string }> {
  const approval = await getApproval(db, approvalId);
  if (!approval) return { ok: false, approvalStatus: 'unknown', error: 'Approval not found' };
  if (approval.status !== 'approved') return { ok: false, approvalStatus: approval.status, error: `Approval is '${approval.status}', expected 'approved'` };
  const agent = await getAgentById(db, approval.agent_id);
  if (!agent) return { ok: false, approvalStatus: approval.status, error: 'Agent registry row is missing' };
  const tool = getToolDefinition(approval.tool);
  if (!tool) {
    await markApprovalExecuted(db, approvalId, false, { error: 'Tool is no longer registered' });
    return { ok: false, approvalStatus: 'failed', error: 'Tool is no longer registered' };
  }
  let validated: Record<string, unknown>;
  try {
    validated = validateToolArguments(tool, (approval.arguments ?? {}) as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sealed arguments failed revalidation';
    await markApprovalExecuted(db, approvalId, false, { error: message });
    return { ok: false, approvalStatus: 'failed', error: message };
  }
  const startedAt = Date.now();
  const handles: RunHandles = {
    task: { id: approval.task_id as string } as TaskRow,
    agent,
    runId: approval.run_id ?? '',
    stepOrder: 0,
    pendingApprovals: [],
    actorUserId: decidedByUserId,
    customerScopeUserId: null,
  };
  const outcome = await executeAndRecordTool(db, handles, approval.tool, validated, startedAt, (approval.arguments ?? {}) as Record<string, unknown>, approvalId);
  const success = outcome.status === 'executed';
  await markApprovalExecuted(db, approvalId, success, outcome.status === 'executed' ? redactForStorage(outcome.data) : { error: outcome.message, code: outcome.errorCode });
  await recordAiAudit(db, {
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
  return { ok: success, approvalStatus: success ? 'executed' : 'failed', error: success ? undefined : outcome.message };
}
