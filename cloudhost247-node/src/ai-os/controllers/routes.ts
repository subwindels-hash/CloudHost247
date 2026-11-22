/**
 * AI Control Plane API (spec §32, §33, §34).
 *
 * Admin routes  /api/v1/admin/ai/*   — every route re-verifies the caller's role against the
 *   database and asserts a named AI permission (see permissions.ts). All input is zod-validated;
 *   all SQL stays in repositories.
 *
 * Customer routes /api/v1/account/ai/* — any authenticated customer (or a staff member inside a
 *   genuine delegated support session) can use the Cloud Assistant and inspect AI activity —
 *   HARD-scoped server-side to their own account id. A customer can never read another
 *   customer's data or execute staff-only AI actions.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { getPool } from '../../db/pool';
import type { Queryable } from '../../db/types';
import { ValidationError, NotFoundError, ConflictError, ForbiddenError } from '../../lib/errors';
import { authenticate } from '../../lib/require-auth';
import { recordAudit, requestAuditContext } from '../../lib/audit';
import { requireAiPermission, type AiPermission, type AiRequestContext } from '../permissions';
import { ensureAgentRegistrySeeded } from '../registry/seed';
import { TOOL_CATALOG } from '../registry/tool-catalog';
import { AGENT_CATALOG } from '../registry/agent-catalog';
import {
  getAgentById,
  getAgentBySlug,
  listAgents,
  listAgentVersions,
  listModelConfigs,
  setAgentEnabled,
  upsertModelConfig,
} from '../repositories/registry-repo';
import {
  getTask,
  listRunsForTask,
  listStepsForRun,
  listTasks,
  listToolCalls,
} from '../repositories/tasks-repo';
import {
  countPendingApprovals,
  getApproval,
  listApprovals,
  listDelayedApprovals,
} from '../repositories/approvals-repo';
import { listEvents, listWorkflowRuns, listWorkflows, setWorkflowEnabled, emitEvent } from '../repositories/events-repo';
import {
  appendIncidentTimeline,
  createIncident,
  listFindings,
  listIncidents,
  updateFindingStatus,
} from '../repositories/findings-repo';
import { getObservabilitySummary, getExecutiveReportById, insertEvaluation, listAiAudit, listEvaluations, listExecutiveReports } from '../repositories/audit-repo';
import {
  addKnowledgeChunks,
  createKnowledgeSource,
  getKnowledgeSource,
  listKnowledgeSources,
  searchKnowledge,
} from '../repositories/memory-knowledge-repo';
import { getBoardOverview, generateExecutiveBriefing } from '../board/board-service';
import { runTask, executeApprovedApproval, TaskFailedError } from '../runtime/executor';
import { decideAuthorizedApproval } from '../runtime/approval-decision';
import { approvalReviewFingerprint } from '../runtime/approval-review';
import { dispatchCustomerIntent } from '../runtime/customer-orchestrator';
import { prepareOrchestratedTask } from '../runtime/task-orchestrator';
import { processPendingEvents } from '../workflows/engine';
import { listAcknowledgedIncompleteRuns, listHeldEventClaims, openAcknowledgedRunInvestigation, openHeldEventInvestigation } from '../workflows/event-investigations';
import { listSuspectedInterruptedTasks, openTaskInvestigation } from '../runtime/task-reconciliation';
import { readonlyRetryRefusal } from '../runtime/read-only-retry';
import { listStrandedEffects } from '../repositories/effect-outbox';
import { AI_EVENT_TYPES } from '../types';
import { executeToolImplementation } from '../tools/implementations';

const ADMIN_BASE = '/api/v1/admin/ai';
const CUSTOMER_BASE = '/api/v1/account/ai';

/** z.output<S> preserves .default() results as definite strings; a naive z.ZodType<T> generic
 *  would unify T over input|output and degrade defaulted fields to string|undefined. */
function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`.trim()).join(', '));
  }
  return parsed.data as z.output<S>;
}

const idParam = z.object({ id: z.string().uuid() });
const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function registerAiControlPlaneRoutes(parent: FastifyInstance, env: Env, extPool?: Queryable): Promise<void> {
  // The AI routes live in their own child context so the lazy-seeding hook below applies only to
  // them. Security hooks (helmet/CORS/rate-limit) registered on the parent still apply here.
  await parent.register(async (instance) => registerAiControlPlaneRoutesInContext(instance, env, extPool));
}

async function registerAiControlPlaneRoutesInContext(instance: FastifyInstance, env: Env, extPool?: Queryable): Promise<void> {
  const db = () => extPool ?? getPool(env);

  // Seeding at boot keeps agents/workflows/models present before the first request — but it must
  // NEVER be a boot requirement. Route registration runs while the app is being built, so an
  // `await` here turned "the database is unreachable right now" into "the whole platform fails to
  // start", taking `/health` (contractually database-free), `/ready` and every static/SPA route
  // down with it. onReady runs at the same point in the lifecycle, and a failure is reported
  // instead of thrown: the AI surface stays fail-closed per request, the platform still boots, and
  // the registry self-heals on the next authorized AI request or the next worker sweep.
  instance.addHook('onReady', async () => {
    try {
      await ensureAgentRegistrySeeded(db());
    } catch (error) {
      instance.log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'AI registry seed skipped at boot; the AI Control Plane will retry on the next authorized request and on every worker sweep'
      );
    }
  });

  /**
   * Every admin AI route goes through this: authenticate, re-verify the caller's role against the
   * database, assert the named AI permission — and only then make sure the registry exists. The
   * order matters: `ensureAgentRegistrySeeded` can write, so it must never be reachable before the
   * caller is authorized. It is a WeakSet check once the registry is seeded, so it costs nothing on
   * the normal path, and it is what recovers a boot whose seed failed.
   */
  const authorize = async (request: FastifyRequest, permission: AiPermission): Promise<AiRequestContext> => {
    const context = await requireAiPermission(request, env, db(), permission);
    await ensureAgentRegistrySeeded(db());
    return context;
  };

  // ==============================================================================================
  // Overview + observability
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/overview`, async (request) => {
    await authorize(request, 'ai.view');
    const pool = db();
    const [summary, pendingApprovals, board] = await Promise.all([
      getObservabilitySummary(pool),
      countPendingApprovals(pool),
      getBoardOverview(pool),
    ]);
    return { summary, pendingApprovals, boardSeats: (board.seats as unknown[]).length };
  });

  instance.get(`${ADMIN_BASE}/observability`, async (request) => {
    await authorize(request, 'ai.observability.view');
    const summary = await getObservabilitySummary(db());
    return {
      ...summary,
      note: 'Counts are live aggregates over ai_runs/ai_tool_calls/ai_approvals/ai_findings. Token/cost columns are 0 by design while the deterministic engine is the only enabled engine — an external engine, once configured, reports its own durations.',
    };
  });

  // ==============================================================================================
  // Agent registry
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/agents`, async (request) => {
    await authorize(request, 'ai.view');
    const query = z.object({ category: z.string().max(24).optional(), boardOnly: z.coerce.boolean().optional() }).parse(request.query ?? {});
    const agents = await listAgents(db(), { category: query.category, boardOnly: query.boardOnly });
    return { count: agents.length, agents };
  });

  instance.get(`${ADMIN_BASE}/agents/:id`, async (request) => {
    await authorize(request, 'ai.view');
    const { id } = parseOrThrow(idParam, request.params);
    const agent = await getAgentById(db(), id);
    if (!agent) throw new NotFoundError('Agent not found');
    const [versions, recentTasks, catalogEntry] = await Promise.all([
      listAgentVersions(db(), id),
      listTasks(db(), { agentId: id, limit: 20 }),
      Promise.resolve(AGENT_CATALOG.find((a) => a.slug === agent.slug) ?? null),
    ]);
    return { agent, versions, recentTasks, catalogEntry };
  });

  instance.post(`${ADMIN_BASE}/agents/:id/enabled`, async (request) => {
    const auth = await authorize(request, 'ai.agents.manage');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(z.object({ enabled: z.boolean() }), request.body);
    const agent = await getAgentById(db(), id);
    if (!agent) throw new NotFoundError('Agent not found');
    const updated = await setAgentEnabled(db(), agent.slug, body.enabled);
    await recordAudit(
      db(),
      { actorId: auth.userId, action: 'ai.agent.enabled_changed', resourceType: 'ai_agent', resourceId: id, metadata: { slug: agent.slug, enabled: body.enabled } },
      requestAuditContext(request)
    );
    return { agent: updated };
  });

  instance.get(`${ADMIN_BASE}/tools`, async (request) => {
    await authorize(request, 'ai.view');
    return { count: TOOL_CATALOG.length, tools: TOOL_CATALOG };
  });

  // ==============================================================================================
  // Tasks & runs
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/tasks`, async (request) => {
    await authorize(request, 'ai.view');
    const query = parseOrThrow(
      paginationSchema.extend({ status: z.string().max(20).optional(), agentId: z.string().uuid().optional(), customerId: z.string().uuid().optional() }),
      request.query ?? {}
    );
    const tasks = await listTasks(db(), query);
    return { count: tasks.length, tasks };
  });

  instance.post(`${ADMIN_BASE}/tasks`, async (request) => {
    const auth = await authorize(request, 'ai.tasks.run');
    const body = parseOrThrow(
      z.object({
        agentSlug: z.string().min(1).max(64),
        taskType: z.string().min(1).max(64),
        input: z.record(z.string(), z.unknown()).optional(),
        subjectType: z.string().max(48).optional(),
        subjectId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent'] as const).optional(),
      }),
      request.body
    );
    const pool = db();
    const agent = await getAgentBySlug(pool, body.agentSlug);
    if (!agent) throw new NotFoundError(`Agent '${body.agentSlug}' is not registered`);
    const declared = (agent.task_types as unknown as string[]) ?? [];
    if (!declared.includes(body.taskType)) {
      throw new ValidationError(`Agent ${body.agentSlug} does not declare task type '${body.taskType}' — it cannot be asked to do something outside its registry contract`);
    }
    const { task } = await prepareOrchestratedTask(pool, {
      agentId: agent.id,
      taskType: body.taskType,
      entryPoint: 'admin.task',
      context: body.input ?? {},
      subjectType: body.subjectType ?? null,
      subjectId: body.subjectId ?? null,
      customerId: body.customerId ?? null,
      priority: body.priority ?? 'normal',
      requestedBy: auth.userId,
      requestedByType: 'staff',
    });
    const outcome = await runTask(pool, task.id, { actorUserId: auth.userId });
    return { task: outcome.task, runStatus: outcome.runStatus, pendingApprovals: outcome.pendingApprovals };
  });

  instance.get(`${ADMIN_BASE}/tasks/:id`, async (request) => {
    await authorize(request, 'ai.view');
    const { id } = parseOrThrow(idParam, request.params);
    const task = await getTask(db(), id);
    if (!task) throw new NotFoundError('Task not found');
    const runs = await listRunsForTask(db(), id);
    const steps = runs[0] ? await listStepsForRun(db(), runs[0].id) : [];
    const toolCalls = await listToolCalls(db(), { taskId: id });
    return { task, runs, steps: runs.length > 1 ? undefined : steps, stepsByRun: Object.fromEntries(await Promise.all(runs.map(async (r) => [r.id, await listStepsForRun(db(), r.id)]))), toolCalls };
  });

  // Operator retry of a READ-ONLY task, per the Phase 2 safe-retry specification: dedicated
  // permission, server-declared read-only type, proof the task was never claimed, identity /
  // grant / scope re-verification, mutating tools refused inside the run, audited decision.
  instance.post(`${ADMIN_BASE}/tasks/:id/retry`, async (request) => {
    const auth = await authorize(request, 'ai.tasks.retry');
    const { id } = parseOrThrow(idParam, request.params);
    parseOrThrow(z.object({ confirmed: z.literal(true) }).strict(), request.body);
    const pool = db();
    const task = await getTask(pool, id);
    if (!task) throw new NotFoundError('Task not found');
    const refusal = await readonlyRetryRefusal(pool, task);
    if (refusal) throw new ConflictError(refusal);
    // Decision audit precedes dispatch so a crash after approval of the retry cannot lose it;
    // the run's own step/tool/audit records capture the observed outcome.
    await recordAudit(
      pool,
      {
        actorId: auth.userId,
        action: 'ai.task.readonly_retry',
        resourceType: 'ai_task',
        resourceId: task.id,
        metadata: { taskType: task.task_type, agentId: task.agent_id },
      },
      requestAuditContext(request)
    );
    // Bind the claim to the task snapshot used for eligibility and audit. The executor rechecks
    // the never-claimed conditions atomically at claim and refuses a changed retry identity.
    try {
      const outcome = await runTask(pool, task.id, { readOnlyRetry: true, retryExpectedTask: task, retryOperatorUserId: auth.userId });
      return { task: outcome.task, runStatus: outcome.runStatus, pendingApprovals: outcome.pendingApprovals };
    } catch (error) {
      if (error instanceof TaskFailedError && error.code === 'RETRY_CLAIM_UNAVAILABLE') {
        throw new ConflictError('Retry eligibility changed; execution refused');
      }
      if (error instanceof TaskFailedError && error.code === 'RETRY_OPERATOR_UNAUTHORIZED') {
        throw new ForbiddenError('Retry operator is no longer authorized');
      }
      throw error;
    }
  });

  // ==============================================================================================
  // Human Decision Inbox (approvals)
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/approvals`, async (request) => {
    await authorize(request, 'ai.approvals.view');
    const query = parseOrThrow(paginationSchema.extend({ status: z.string().max(16).optional(), customerId: z.string().uuid().optional() }), request.query ?? {});
    const approvals = await listApprovals(db(), query);
    return { count: approvals.length, approvals: approvals.map((approval) => ({ ...approval, reviewFingerprint: approvalReviewFingerprint(approval) })) };
  });

  // Age alone cannot establish a failed or stopped worker. No action/replay is exposed here.
  instance.get(`${ADMIN_BASE}/approvals/delayed`, async (request) => {
    await authorize(request, 'ai.approvals.view');
    const query = parseOrThrow(z.object({ limit: z.coerce.number().int().positive().max(200).default(100) }).strict(), request.query);
    const approvals = await listDelayedApprovals(db(), query.limit);
    return { count: approvals.length, approvals };
  });

  instance.post(`${ADMIN_BASE}/approvals/:id/decision`, async (request) => {
    const auth = await authorize(request, 'ai.approvals.manage');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(
      z.object({ decision: z.enum(['approved', 'rejected'] as const), reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/), note: z.string().max(2000).optional() }).strict(),
      request.body
    );
    const pool = db();
    // Recheck the actor and commit the one-winner decision together with its audit record.
    // If COMMIT acknowledgement is lost, do not proceed to execution on this request.
    const decided = await decideAuthorizedApproval(pool, {
      id, decision: body.decision, actorId: auth.userId, note: body.note ?? null, reviewFingerprint: body.reviewFingerprint, auditContext: requestAuditContext(request),
    });
    if (!decided) {
      const existing = await getApproval(pool, id);
      if (!existing) throw new NotFoundError('Approval not found');
      throw new ValidationError(`Approval is already '${existing.status}' (or expired) — decisions are single-use`);
    }
    if (body.decision === 'rejected') {
      return { approval: decided, executed: false, note: 'Rejected. The sealed action was never executed.' };
    }
    // Approved: execute the sealed tool call now, with the approver as the acting human.
    const execution = await executeApprovedApproval(pool, id, auth.userId, body.reviewFingerprint);
    const finalApproval = await getApproval(pool, id);
    return { approval: finalApproval, executed: execution.ok, executionError: execution.error ?? null };
  });

  // External-effect outbox: bounded visibility only. No operator action replays or changes an intent.
  instance.get(`${ADMIN_BASE}/effect-outbox`, async (request) => {
    await authorize(request, 'ai.approvals.view');
    const query = parseOrThrow(z.object({ limit: z.coerce.number().int().positive().max(200).default(100) }).strict(), request.query);
    const intents = await listStrandedEffects(db(), { limit: query.limit });
    return {
      count: intents.length,
      intents,
      note: 'Stranded means an intent past the detection window: pending = decided but never started; dispatched = started with no recorded outcome. Neither is proof that an effect happened, and nothing here is replayed automatically.',
    };
  });

  // ==============================================================================================
  // Events & workflows
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/events`, async (request) => {
    await authorize(request, 'ai.events.view');
    const query = parseOrThrow(z.object({ eventType: z.string().max(64).optional(), limit: z.coerce.number().int().positive().max(500).optional() }), request.query ?? {});
    const events = await listEvents(db(), query);
    return { count: events.length, events, knownTypes: AI_EVENT_TYPES };
  });

  instance.get(`${ADMIN_BASE}/event-claims`, async (request) => {
    await authorize(request, 'ai.events.view');
    const query = parseOrThrow(z.object({ limit: z.coerce.number().int().positive().max(200).optional() }).strict(), request.query ?? {});
    const claims = await listHeldEventClaims(db(), query.limit);
    return { count: claims.length, claims, note: 'A delayed claim may still be active. Investigation does not cancel or replay it.' };
  });

  instance.get(`${ADMIN_BASE}/acknowledged-incomplete-workflows`, async (request) => {
    await authorize(request, 'ai.events.view');
    const query = parseOrThrow(z.object({ limit: z.coerce.number().int().positive().max(200).optional() }).strict(), request.query ?? {});
    const runs = await listAcknowledgedIncompleteRuns(db(), query.limit);
    return { count: runs.length, runs, note: 'Recent incomplete workflow runs on acknowledged events. An acknowledgement is not evidence of an external outcome.' };
  });

  instance.get(`${ADMIN_BASE}/suspected-interrupted-tasks`, async (request) => {
    await authorize(request, 'ai.events.view');
    const query = parseOrThrow(z.object({ limit: z.coerce.number().int().positive().max(200).optional() }).strict(), request.query ?? {});
    const tasks = await listSuspectedInterruptedTasks(db(), query.limit);
    return {
      count: tasks.length,
      tasks,
      note: 'A stale heartbeat is an observation, not proof the worker stopped or that any effect is missing. Investigation does not change the task, cancel work or authorize a retry.',
    };
  });

  instance.post(`${ADMIN_BASE}/tasks/:id/interrupted-investigations`, async (request) => {
    const auth = await authorize(request, 'ai.workflows.manage');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(z.object({
      confirmed: z.literal(true),
      observedHeartbeat: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
    }).strict(), request.body);
    const result = await openTaskInvestigation(db(), id, body.observedHeartbeat, auth.userId);
    if (!result) throw new ConflictError('Task is not a suspected-interrupted running task with that observed heartbeat');
    return { ...result, note: 'Recorded for investigation only; the task is unchanged and no retry, replay or verified outcome is implied.' };
  });

  instance.post(`${ADMIN_BASE}/workflow-runs/:id/acknowledged-investigations`, async (request) => {
    const auth = await authorize(request, 'ai.workflows.manage');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(z.object({
      confirmed: z.literal(true), eventId: z.string().uuid(),
      acknowledgementKey: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      observedStatus: z.enum(['running', 'failed', 'partial']),
    }).strict(), request.body);
    const result = await openAcknowledgedRunInvestigation(db(), id, body.eventId, body.acknowledgementKey, body.observedStatus, auth.userId);
    if (!result) throw new ConflictError('Run is not an acknowledged incomplete workflow');
    return { ...result, note: 'Recorded for investigation only; no notification, cancellation, retry or verified outcome is implied.' };
  });

  instance.post(`${ADMIN_BASE}/events/:id/investigations`, async (request) => {
    const auth = await authorize(request, 'ai.workflows.manage');
    const { id } = parseOrThrow(idParam, request.params);
    parseOrThrow(z.object({ confirmed: z.literal(true) }).strict(), request.body);
    const result = await openHeldEventInvestigation(db(), id, auth.userId);
    if (!result) throw new ConflictError('Event has no held claim eligible for investigation');
    return { ...result, note: 'Recorded for investigation only; no notification, cancellation, retry or verified outcome is implied.' };
  });

  instance.post(`${ADMIN_BASE}/events`, async (request) => {
    const auth = await authorize(request, 'ai.workflows.manage');
    const body = parseOrThrow(
      z.object({ eventType: z.enum(AI_EVENT_TYPES), payload: z.record(z.string(), z.unknown()).optional(), processNow: z.boolean().optional() }),
      request.body
    );
    const pool = db();
    const { event, created } = await emitEvent(pool, { eventType: body.eventType, source: 'admin', payload: body.payload ?? {} });
    await recordAudit(
      pool,
      { actorId: auth.userId, action: 'ai.event.emitted', resourceType: 'ai_event', resourceId: event.id, metadata: { eventType: body.eventType } },
      requestAuditContext(request)
    );
    let dispatch = null;
    if (body.processNow !== false) {
      dispatch = await processPendingEvents(pool, runTask, 10);
    }
    return { event, created, dispatch };
  });

  instance.get(`${ADMIN_BASE}/workflows`, async (request) => {
    await authorize(request, 'ai.view');
    const workflows = await listWorkflows(db());
    return { count: workflows.length, workflows };
  });

  instance.patch(`${ADMIN_BASE}/workflows/:id`, async (request) => {
    const auth = await authorize(request, 'ai.workflows.manage');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(z.object({ enabled: z.boolean() }), request.body);
    const workflow = await setWorkflowEnabled(db(), id, body.enabled);
    if (!workflow) throw new NotFoundError('Workflow not found');
    await recordAudit(
      db(),
      { actorId: auth.userId, action: 'ai.workflow.enabled_changed', resourceType: 'ai_workflow', resourceId: id, metadata: { slug: workflow.slug, enabled: body.enabled } },
      requestAuditContext(request)
    );
    return { workflow };
  });

  instance.get(`${ADMIN_BASE}/workflow-runs`, async (request) => {
    await authorize(request, 'ai.view');
    const query = parseOrThrow(paginationSchema.extend({ workflowId: z.string().uuid().optional(), eventId: z.string().uuid().optional() }), request.query ?? {});
    const runs = await listWorkflowRuns(db(), query);
    return { count: runs.length, runs };
  });

  // ==============================================================================================
  // Findings & incidents
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/findings`, async (request) => {
    await authorize(request, 'ai.view');
    const query = parseOrThrow(
      z.object({ status: z.string().max(12).optional(), agentId: z.string().uuid().optional(), severity: z.string().max(8).optional(), limit: z.coerce.number().int().positive().max(200).optional() }),
      request.query ?? {}
    );
    const findings = await listFindings(db(), query);
    return { count: findings.length, findings };
  });

  instance.post(`${ADMIN_BASE}/findings/:id/status`, async (request) => {
    const auth = await authorize(request, 'ai.findings.manage');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(z.object({ status: z.enum(['acknowledged', 'resolved', 'dismissed'] as const) }), request.body);
    const finding = await updateFindingStatus(db(), id, body.status);
    if (!finding) throw new NotFoundError('Finding not found (or already in that status)');
    await recordAudit(
      db(),
      { actorId: auth.userId, action: `ai.finding.${body.status}`, resourceType: 'ai_finding', resourceId: id, metadata: { type: finding.finding_type } },
      requestAuditContext(request)
    );
    return { finding };
  });

  instance.get(`${ADMIN_BASE}/incidents`, async (request) => {
    await authorize(request, 'ai.view');
    const query = parseOrThrow(z.object({ status: z.string().max(14).optional(), limit: z.coerce.number().int().positive().max(200).optional() }), request.query ?? {});
    const incidents = await listIncidents(db(), query);
    return { count: incidents.length, incidents };
  });

  instance.post(`${ADMIN_BASE}/incidents`, async (request) => {
    const auth = await authorize(request, 'ai.incidents.manage');
    const body = parseOrThrow(
      z.object({
        title: z.string().min(3).max(255),
        severity: z.enum(['low', 'medium', 'high', 'critical'] as const),
        summary: z.string().max(10000).default(''),
      }),
      request.body
    );
    const incident = await createIncident(db(), {
      severity: body.severity,
      title: body.title,
      summary: body.summary,
      affected: [],
      openedBy: auth.userId,
      openedByType: 'staff',
      timelineNote: 'Incident opened manually by staff',
    });
    await emitEvent(db(), { eventType: 'incident.created', source: 'admin', fingerprint: `incident.created:${incident.id}`, payload: { incidentId: incident.id } });
    await recordAudit(
      db(),
      { actorId: auth.userId, action: 'ai.incident.created', resourceType: 'ai_incident', resourceId: incident.id, metadata: { incidentNumber: incident.incident_number } },
      requestAuditContext(request)
    );
    return { incident };
  });

  instance.post(`${ADMIN_BASE}/incidents/:id/notes`, async (request) => {
    const auth = await authorize(request, 'ai.incidents.manage');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(
      z.object({ note: z.string().min(1).max(5000), status: z.enum(['open', 'investigating', 'mitigated', 'resolved'] as const).optional() }),
      request.body
    );
    const incident = await appendIncidentTimeline(db(), id, body.note, `staff:${auth.userId}`, body.status);
    if (!incident) throw new NotFoundError('Incident not found');
    if (body.status === 'resolved') {
      await emitEvent(db(), { eventType: 'incident.resolved', source: 'admin', fingerprint: `incident.resolved:${id}`, payload: { incidentId: id } });
    }
    await recordAudit(
      db(),
      { actorId: auth.userId, action: 'ai.incident.updated', resourceType: 'ai_incident', resourceId: id, metadata: { status: body.status ?? 'note_only' } },
      requestAuditContext(request)
    );
    return { incident };
  });

  // ==============================================================================================
  // Audit trail
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/audit`, async (request) => {
    await authorize(request, 'ai.audit.view');
    const query = parseOrThrow(paginationSchema.extend({ agentId: z.string().uuid().optional(), action: z.string().max(120).optional() }), request.query ?? {});
    const entries = await listAiAudit(db(), query);
    return { count: entries.length, entries };
  });

  // ==============================================================================================
  // Evaluations
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/evaluations`, async (request) => {
    await authorize(request, 'ai.evaluations.view');
    const query = parseOrThrow(z.object({ agentId: z.string().uuid().optional(), limit: z.coerce.number().int().positive().max(500).optional() }), request.query ?? {});
    const evaluations = await listEvaluations(db(), query.agentId, query.limit);
    return { count: evaluations.length, evaluations };
  });

  instance.post(`${ADMIN_BASE}/agents/:id/evaluate`, async (request) => {
    const auth = await authorize(request, 'ai.evaluations.write');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(
      z.object({ metric: z.string().min(1).max(40), value: z.coerce.number().min(-1000).max(1000), notes: z.string().max(2000).optional() }),
      request.body
    );
    const agent = await getAgentById(db(), id);
    if (!agent) throw new NotFoundError('Agent not found');
    const evaluationId = await insertEvaluation(db(), { agentId: id, metric: body.metric, value: body.value, raterId: auth.userId, notes: body.notes ?? null });
    return { evaluationId };
  });

  // ==============================================================================================
  // Knowledge base
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/knowledge`, async (request) => {
    await authorize(request, 'ai.knowledge.view');
    const sources = await listKnowledgeSources(db());
    return { count: sources.length, sources };
  });

  instance.post(`${ADMIN_BASE}/knowledge`, async (request) => {
    const auth = await authorize(request, 'ai.knowledge.manage');
    const body = parseOrThrow(
      z.object({
        title: z.string().min(3).max(255),
        sourceType: z.enum(['manual', 'doc', 'faq', 'policy', 'procedure', 'runbook', 'resolution'] as const).default('doc'),
        uri: z.string().url().max(1000).optional(),
        version: z.string().max(32).optional(),
        content: z.string().min(10).max(20000),
        keywords: z.array(z.string().max(60)).max(30).optional(),
      }),
      request.body
    );
    const pool = db();
    const source = await createKnowledgeSource(pool, {
      title: body.title,
      sourceType: body.sourceType,
      uri: body.uri ?? null,
      version: body.version ?? '1',
      createdBy: auth.userId,
    });
    // Single-chunk default: one document adds one searchable chunk. (Chunking long docs into
    // meaningful sections is deliberate future work — retrieval honesty beats volume.)
    await addKnowledgeChunks(pool, source.id, [{ content: body.content, keywords: body.keywords ?? [] }]);
    await recordAudit(
      pool,
      { actorId: auth.userId, action: 'ai.knowledge.source_created', resourceType: 'ai_knowledge_source', resourceId: source.id, metadata: { title: body.title } },
      requestAuditContext(request)
    );
    return { source };
  });

  instance.get(`${ADMIN_BASE}/knowledge/search`, async (request) => {
    await authorize(request, 'ai.knowledge.view');
    const query = parseOrThrow(z.object({ q: z.string().min(2).max(400), limit: z.coerce.number().int().positive().max(10).optional() }), request.query ?? {});
    const hits = await searchKnowledge(db(), query.q, query.limit ?? 5);
    return { query: query.q, count: hits.length, results: hits.map((h) => ({ chunkId: h.chunk.id, content: h.chunk.content, score: h.score, citation: { source: h.source.title, version: h.source.version, type: h.source.source_type, uri: h.source.uri } })) };
  });

  // ==============================================================================================
  // Model router configs
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/models`, async (request) => {
    await authorize(request, 'ai.models.view');
    const models = await listModelConfigs(db());
    return { count: models.length, models, note: 'API keys/credentials are never stored here — only connection metadata. Disabled engines fail closed with CONFIGURATION_REQUIRED.' };
  });

  instance.put(`${ADMIN_BASE}/models/:engine`, async (request) => {
    const auth = await authorize(request, 'ai.models.manage');
    const { engine } = parseOrThrow(z.object({ engine: z.string().min(1).max(32).regex(/^[a-z0-9_]+$/) }), request.params);
    const body = parseOrThrow(
      z.object({
        provider: z.string().max(48).nullish(),
        model: z.string().max(80).nullish(),
        endpoint: z.string().url().max(1000).nullish(),
        enabled: z.boolean(),
        notes: z.string().max(2000).nullish(),
      }),
      request.body
    );
    const pool = db();
    const config = await upsertModelConfig(pool, { engine, provider: body.provider, model: body.model, endpoint: body.endpoint, enabled: body.enabled, notes: body.notes });
    await recordAudit(
      pool,
      { actorId: auth.userId, action: 'ai.model_config.updated', resourceType: 'ai_model_config', resourceId: engine, metadata: { enabled: body.enabled, model: body.model ?? null } },
      requestAuditContext(request)
    );
    return { config };
  });

  // ==============================================================================================
  // Executive Board & briefings
  // ==============================================================================================

  instance.get(`${ADMIN_BASE}/board`, async (request) => {
    await authorize(request, 'ai.board.view');
    const board = await getBoardOverview(db());
    return board;
  });

  instance.post(`${ADMIN_BASE}/board/briefings`, async (request) => {
    const auth = await authorize(request, 'ai.board.briefings');
    const body = parseOrThrow(z.object({ type: z.enum(['daily', 'weekly', 'monthly'] as const) }), request.body);
    const pool = db();
    const outcome = await generateExecutiveBriefing(pool, body.type, auth.userId, runTask);
    if (!outcome.report) {
      throw new ValidationError(`Briefing generation did not complete (CEO task status: ${outcome.runStatus}). Departments that failed are not ghost-written — retry or inspect the task record ${outcome.taskId ?? ''}.`);
    }
    if (outcome.created) {
      await recordAudit(
        pool,
        { actorId: auth.userId, action: 'ai.briefing.generated', resourceType: 'ai_executive_report', resourceId: outcome.report.id, metadata: { type: body.type } },
        requestAuditContext(request)
      );
    }
    return { report: outcome.report, created: outcome.created, taskId: outcome.taskId };
  });

  instance.get(`${ADMIN_BASE}/board/briefings`, async (request) => {
    await authorize(request, 'ai.board.view');
    const reports = await listExecutiveReports(db(), 30);
    return { count: reports.length, reports };
  });

  instance.get(`${ADMIN_BASE}/board/briefings/:id`, async (request) => {
    await authorize(request, 'ai.board.view');
    const { id } = parseOrThrow(idParam, request.params);
    const report = await getExecutiveReportById(db(), id);
    if (!report) throw new NotFoundError('Briefing not found');
    return { report };
  });

  // ==============================================================================================
  // Admin Copilot
  // ==============================================================================================

  instance.post(`${ADMIN_BASE}/copilot`, async (request) => {
    const auth = await authorize(request, 'ai.copilot.execute');
    const body = parseOrThrow(z.object({ command: z.string().min(3).max(1000) }), request.body);
    const pool = db();
    const agent = await getAgentBySlug(pool, 'admin-copilot');
    if (!agent) throw new NotFoundError('Admin Copilot agent is not registered');
    const { task } = await prepareOrchestratedTask(pool, {
      agentId: agent.id,
      taskType: 'copilot.command',
      entryPoint: 'admin.copilot',
      context: { command: body.command },
      requestedBy: auth.userId,
      requestedByType: 'staff',
    });
    const outcome = await runTask(pool, task.id, { actorUserId: auth.userId });
    const result = (outcome.task.result ?? {}) as Record<string, unknown>;
    return {
      taskId: outcome.task.id,
      runStatus: outcome.runStatus,
      answer: typeof result.answer === 'string' ? result.answer : outcome.task.result_summary,
      intent: result.intent ?? null,
      supportedCommands: result.supportedCommands ?? null,
      pendingApprovals: outcome.pendingApprovals,
      note: 'Every copilot command is a fully audited run (task, steps, tool calls) — nothing is outside the registry.',
    };
  });

  // ==============================================================================================
  // Customer Cloud Assistant + AI transparency (spec §33/§34: customer AI pages)
  // ==============================================================================================

  instance.post(`${CUSTOMER_BASE}/assistant`, async (request) => {
    const auth = await authenticate(request, env, db());
    const body = parseOrThrow(z.object({ message: z.string().min(2).max(2000) }), request.body);
    const pool = db();
    // The route authenticates first and constructs the scope from that identity, never the body.
    const outcome = await dispatchCustomerIntent(pool, {
      operation: 'account_assistant', actorUserId: auth.userId, message: body.message,
    });
    const result = (outcome.task.result ?? {}) as Record<string, unknown>;
    return {
      taskId: outcome.task.id,
      runStatus: outcome.runStatus,
      answer: typeof result.answer === 'string' ? result.answer : outcome.task.result_summary,
      intent: result.intent ?? null,
      supported: result.supported ?? null,
      note: 'This assistant reads your own account data. AI Activity shows a bounded list of your assistant requests, not a complete history.',
    };
  });

  instance.get(`${CUSTOMER_BASE}/activity`, async (request) => {
    const auth = await authenticate(request, env, db());
    const pool = db();
    await ensureAgentRegistrySeeded(pool);
    // Server-side scoping: userId is the caller's own id, not a parameter.
    const activity = await executeToolImplementation({ db: pool, customerScopeUserId: auth.userId }, 'get_ai_activity', { userId: auth.userId, limit: 25 });
    if (!activity.ok) throw new ValidationError(activity.message);
    return activity.data as Record<string, unknown>;
  });

  instance.get(`${CUSTOMER_BASE}/profile`, async (request) => {
    const auth = await authenticate(request, env, db());
    const pool = db();
    await ensureAgentRegistrySeeded(pool);
    const profile = await executeToolImplementation({ db: pool, customerScopeUserId: auth.userId }, 'get_customer_profile', { userId: auth.userId });
    if (!profile.ok) throw new ValidationError(profile.message);
    return profile.data as Record<string, unknown>;
  });
}
