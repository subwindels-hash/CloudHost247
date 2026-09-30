/**
 * Revenue Guardian admin API (spec §41–§42) — /api/admin/revenue-guardian/*
 *
 * Every route authenticates, re-verifies the caller's role against the database, and asserts an
 * explicit module permission (permissions.ts). Staff accounts without
 * revenue_guardian.view_all_customers are automatically scoped to their own portfolio by the
 * repositories. All input is zod-validated; all SQL is parameterized.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { getPool } from '../../db/pool';
import type { Queryable } from '../../db/types';
import { ValidationError, NotFoundError, ForbiddenError } from '../../lib/errors';
import { requestAuditContext } from '../../lib/audit';
import { authenticate } from '../../lib/require-auth';
import { requireRgPermission, roleHasPermission, permissionsForRole } from '../permissions';
import {
  CASE_STATUSES,
  CASE_PRIORITIES,
  RISK_LEVELS,
  FOLLOW_UP_TYPES,
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_CHANNELS,
  ASSIGNMENT_TYPES,
  AUTOMATION_EVENT_TYPES,
} from '../types';
import { listCases, findCaseById } from '../repositories/cases-repo';
import { listFollowUps, findFollowUpById } from '../repositories/follow-ups-repo';
import { listPromises, findPromiseById } from '../repositories/promises-repo';
import { listAssignments } from '../repositories/assignments-repo';
import {
  listAutomationRules,
  insertAutomationRule,
  updateAutomationRule,
  listAssignmentRules,
  insertAssignmentRule,
  updateAssignmentRule,
  listRuns,
  listActivities,
  listCommunications,
} from '../repositories/automation-repo';
import {
  getDashboardMetrics,
  listAtRiskCustomers,
  listUpcomingRenewals,
  listLifecycleRisk,
  listOrderCollections,
  getAgingBuckets,
  getForecast,
  listHighValueCustomers,
  getStaffPerformance,
} from '../repositories/insights-repo';
import { getCustomerProfile } from '../repositories/customer-profile-repo';
import { createRecoveryCase, transitionCase, updateCaseDetails, addCaseNote } from '../services/case-service';
import { createFollowUp, changeFollowUp } from '../services/follow-up-service';
import { createPaymentPromise, cancelPromise, reconcilePromise } from '../services/promise-service';
import { assignCustomer, unassignCustomer } from '../services/assignment-service';
import { getModuleHealth } from '../services/health-service';
import { assessRisk } from '../rules/risk';
import { allowedTransitions } from '../rules/transitions';
import { assignmentConditionsSchema, automationConditionsSchema, automationActionsSchema } from '../rules/rule-schemas';
import { loadRgSettings, setRgSetting, RG_DEFAULT_SETTINGS, type RgSettings } from '../utils/settings';
import { RG_JOBS, findJob } from '../jobs/definitions';
import { executeJobManually } from '../jobs/runner';
import { buildReport, reportToCsv, REPORT_TYPES } from '../reports/report-service';
import { getWhatsAppStatus } from '../notifications/whatsapp';
import { RG_DEFAULT_TEMPLATES, resolveTemplate, renderTemplate } from '../notifications/email';
import { getSetting } from '../../db/ops-tables';

const BASE = '/api/admin/revenue-guardian';

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`.trim()).join(', '));
  }
  return parsed.data;
}

const idParam = z.object({ id: z.string().uuid() });
const pagination = { page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional() };

const listCasesQuery = z.object({
  ...pagination,
  status: z.enum([...CASE_STATUSES, 'open'] as [string, ...string[]]).optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  customerId: z.string().uuid().optional(),
  assignedStaffId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  search: z.string().max(120).optional(),
  sortBy: z.enum(['opened_at', 'amount_outstanding', 'next_follow_up_at', 'risk_score', 'days_overdue']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

const createCaseBody = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  domainId: z.string().uuid().optional(),
  subscriptionId: z.string().uuid().optional(),
  assignedStaffId: z.string().uuid().optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
});

const patchCaseBody = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  reason: z.string().max(2000).optional(),
  assignedStaffId: z.string().uuid().nullable().optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  escalationLevel: z.number().int().min(0).max(4).optional(),
  note: z.string().max(4000).optional(),
});

const createFollowUpBody = z.object({
  customerId: z.string().uuid(),
  caseId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  assignedStaffId: z.string().uuid().optional(),
  type: z.enum(FOLLOW_UP_TYPES),
  priority: z.enum(CASE_PRIORITIES).optional(),
  channel: z.enum(FOLLOW_UP_CHANNELS).optional(),
  scheduledAt: z.string().datetime(),
  notes: z.string().max(4000).optional(),
});

const patchFollowUpBody = z.object({
  status: z.enum(FOLLOW_UP_STATUSES).optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  scheduledAt: z.string().datetime().optional(),
  assignedStaffId: z.string().uuid().nullable().optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  outcome: z.string().max(4000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const createPromiseBody = z.object({
  customerId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  caseId: z.string().uuid().optional(),
  promisedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'must be a decimal amount'),
  promisedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  assignedStaffId: z.string().uuid().optional(),
  notes: z.string().max(4000).optional(),
});

const patchPromiseBody = z.object({
  action: z.enum(['cancel', 'reconcile', 'reassign']),
  reason: z.string().max(2000).optional(),
  assignedStaffId: z.string().uuid().optional(),
});

const createAssignmentBody = z.object({
  customerIds: z.array(z.string().uuid()).min(1).max(200),
  staffUserId: z.string().uuid(),
  assignmentType: z.enum(ASSIGNMENT_TYPES),
  reason: z.string().max(2000).optional(),
});

export async function registerRevenueGuardianRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // ------------------------------------------------------------------ dashboard & monitors ---
  app.get(`${BASE}/dashboard`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const metrics = await getDashboardMetrics(pool, ctx.scopeStaffId);
    return { metrics, permissions: ctx.permissions };
  });

  app.get(`${BASE}/revenue-at-risk`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const settings = await loadRgSettings(pool);
    const rows = await listAtRiskCustomers(pool, { scopeStaffId: ctx.scopeStaffId });
    const items = rows.map((row) => {
      const risk = assessRisk(
        {
          maxOverdueDays: row.max_overdue_days,
          overdueInvoiceCount: row.overdue_invoice_count,
          outstandingCents: Math.round(Number(row.outstanding) * 100),
          failedPaymentCount: row.failed_payments,
          brokenPromiseCount: row.broken_promises,
          hasPastDueSubscription: row.past_due_subscriptions > 0,
          hasSuspendedSubscription: row.suspended_subscriptions > 0,
          daysToNextRenewal: row.days_to_renewal,
          recurringRevenueCents: Math.round(Number(row.recurring_revenue) * 100),
        },
        settings.riskThresholds
      );
      return { ...row, risk_score: risk.score, risk_level: risk.level, risk_reasons: risk.reasons };
    });
    items.sort((a, b) => b.risk_score - a.risk_score);
    return { items, total: items.length };
  });

  app.get(`${BASE}/customer-health`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const settings = await loadRgSettings(pool);
    const rows = await listAtRiskCustomers(pool, { scopeStaffId: ctx.scopeStaffId });
    const items = rows.map((row) => {
      const risk = assessRisk(
        {
          maxOverdueDays: row.max_overdue_days,
          overdueInvoiceCount: row.overdue_invoice_count,
          outstandingCents: Math.round(Number(row.outstanding) * 100),
          failedPaymentCount: row.failed_payments,
          brokenPromiseCount: row.broken_promises,
          hasPastDueSubscription: row.past_due_subscriptions > 0,
          hasSuspendedSubscription: row.suspended_subscriptions > 0,
          daysToNextRenewal: row.days_to_renewal,
          recurringRevenueCents: Math.round(Number(row.recurring_revenue) * 100),
        },
        settings.riskThresholds
      );
      const health = risk.level === 'critical' ? 'CRITICAL' : risk.level === 'high' ? 'AT_RISK' : risk.level === 'medium' ? 'WATCH' : 'HEALTHY';
      return { ...row, health, risk_score: risk.score, risk_level: risk.level, reasons: risk.reasons };
    });
    return { items, total: items.length };
  });

  app.get(`${BASE}/renewals`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const query = parseOrThrow(z.object({ withinDays: z.coerce.number().int().positive().max(365).optional() }), request.query);
    const items = await listUpcomingRenewals(pool, { withinDays: query.withinDays ?? 60, scopeStaffId: ctx.scopeStaffId });
    const settings = await loadRgSettings(pool);
    return { items, total: items.length, reminderWindows: settings.renewalReminderDays };
  });

  app.get(`${BASE}/expiring-services`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const query = parseOrThrow(z.object({ withinDays: z.coerce.number().int().positive().max(365).optional() }), request.query);
    const items = await listUpcomingRenewals(pool, {
      withinDays: query.withinDays ?? 90,
      includePast: true,
      scopeStaffId: ctx.scopeStaffId,
      limit: 500,
    });
    return { items, total: items.length };
  });

  async function lifecycleConfig(db: Queryable) {
    const settings = await loadRgSettings(db);
    return {
      graceDays: await getSetting<number>(db, 'subscription.grace_period_days', 7),
      suspendAfterDays: await getSetting<number>(db, 'subscription.suspend_after_days', 7),
      terminateAfterDays: settings.terminateAfterSuspensionDays,
    };
  }

  app.get(`${BASE}/pre-suspension`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const items = await listLifecycleRisk(pool, 'pre_suspension', await lifecycleConfig(pool), ctx.scopeStaffId);
    return { items, total: items.length };
  });

  app.get(`${BASE}/pre-termination`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const items = await listLifecycleRisk(pool, 'pre_termination', await lifecycleConfig(pool), ctx.scopeStaffId);
    return { items, total: items.length };
  });

  app.get(`${BASE}/orders`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const query = parseOrThrow(
      z.object({
        ...pagination,
        paymentStatus: z.string().max(24).optional(),
        orderStatus: z.string().max(24).optional(),
        customerType: z.enum(['new', 'existing']).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        search: z.string().max(120).optional(),
      }),
      request.query
    );
    return listOrderCollections(pool, { ...query, scopeStaffId: ctx.scopeStaffId });
  });

  app.get(`${BASE}/risk-analysis`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const settings = await loadRgSettings(pool);
    const buckets = await getAgingBuckets(pool, settings.agingBuckets, ctx.scopeStaffId);
    return { buckets, boundaries: settings.agingBuckets };
  });

  app.get(`${BASE}/forecast`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view_financials');
    return getForecast(pool, ctx.scopeStaffId);
  });

  app.get(`${BASE}/high-value`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const settings = await loadRgSettings(pool);
    const items = await listHighValueCustomers(pool, settings.highValueThresholds, ctx.scopeStaffId);
    return { items, total: items.length, thresholds: settings.highValueThresholds };
  });

  // ------------------------------------------------------------------------- recovery cases ---
  app.get(`${BASE}/recovery-cases`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const query = parseOrThrow(listCasesQuery, request.query);
    return listCases(pool, { ...query, scopeStaffId: ctx.scopeStaffId } as Parameters<typeof listCases>[1]);
  });

  app.post(`${BASE}/recovery-cases`, async (request, reply) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.manage');
    const body = parseOrThrow(createCaseBody, request.body);
    const { recoveryCase, created } = await createRecoveryCase(
      pool,
      { ...body, source: 'manual' },
      { userId: ctx.userId, audit: requestAuditContext(request) }
    );
    reply.code(created ? 201 : 200);
    return { recoveryCase, created };
  });

  app.get<{ Params: { id: string } }>(`${BASE}/recovery-cases/:id`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const { id } = parseOrThrow(idParam, request.params);
    const recoveryCase = await findCaseById(pool, id);
    if (!recoveryCase) throw new NotFoundError('Recovery case not found');
    if (ctx.scopeStaffId) {
      const scoped = await listCases(pool, { scopeStaffId: ctx.scopeStaffId, invoiceId: recoveryCase.invoice_id ?? undefined, customerId: recoveryCase.customer_id, limit: 100 });
      if (!scoped.items.some((c) => c.id === id)) throw new ForbiddenError('This case is outside your portfolio');
    }
    const [followUps, promises, activities] = await Promise.all([
      listFollowUps(pool, { caseId: id, limit: 100 }),
      listPromises(pool, { caseId: id, limit: 100 }),
      listActivities(pool, { caseId: id, limit: 100 }),
    ]);
    return {
      recoveryCase,
      allowedTransitions: allowedTransitions(recoveryCase.status),
      followUps: followUps.items,
      promises: promises.items,
      activities: activities.items,
    };
  });

  app.patch<{ Params: { id: string } }>(`${BASE}/recovery-cases/:id`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.manage');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(patchCaseBody, request.body);
    const actor = { userId: ctx.userId, audit: requestAuditContext(request) };

    if (body.note) await addCaseNote(pool, id, body.note, actor);

    if (body.status) {
      const writeOffPermitted = ctx.permissions.includes('revenue_guardian.write_off');
      await transitionCase(pool, id, body.status, actor, { reason: body.reason ?? null, writeOffPermitted });
    }
    if (body.assignedStaffId !== undefined || body.priority !== undefined || body.nextFollowUpAt !== undefined || body.escalationLevel !== undefined) {
      await updateCaseDetails(
        pool,
        id,
        {
          assignedStaffId: body.assignedStaffId,
          priority: body.priority,
          nextFollowUpAt: body.nextFollowUpAt === undefined ? undefined : body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null,
          escalationLevel: body.escalationLevel,
        },
        actor
      );
    }
    const recoveryCase = await findCaseById(pool, id);
    if (!recoveryCase) throw new NotFoundError('Recovery case not found');
    return { recoveryCase, allowedTransitions: allowedTransitions(recoveryCase.status) };
  });

  // ----------------------------------------------------------------------------- follow-ups ---
  app.get(`${BASE}/follow-ups`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.followups');
    const query = parseOrThrow(
      z.object({
        ...pagination,
        status: z.enum([...FOLLOW_UP_STATUSES, 'overdue', 'due_today'] as [string, ...string[]]).optional(),
        type: z.enum(FOLLOW_UP_TYPES).optional(),
        customerId: z.string().uuid().optional(),
        caseId: z.string().uuid().optional(),
        assignedStaffId: z.string().uuid().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
      request.query
    );
    return listFollowUps(pool, { ...query, scopeStaffId: ctx.scopeStaffId } as Parameters<typeof listFollowUps>[1]);
  });

  app.post(`${BASE}/follow-ups`, async (request, reply) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.followups');
    const body = parseOrThrow(createFollowUpBody, request.body);
    const followUp = await createFollowUp(
      pool,
      { ...body, scheduledAt: new Date(body.scheduledAt), assignedStaffId: body.assignedStaffId ?? ctx.userId },
      { userId: ctx.userId, audit: requestAuditContext(request) }
    );
    reply.code(201);
    return { followUp };
  });

  app.patch<{ Params: { id: string } }>(`${BASE}/follow-ups/:id`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.followups');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(patchFollowUpBody, request.body);
    if (ctx.scopeStaffId) {
      const existing = await findFollowUpById(pool, id);
      if (!existing) throw new NotFoundError('Follow-up not found');
      if (existing.assigned_staff_id !== ctx.userId) {
        const scoped = await listFollowUps(pool, { scopeStaffId: ctx.scopeStaffId, customerId: existing.customer_id, limit: 100 });
        if (!scoped.items.some((f) => f.id === id)) throw new ForbiddenError('This follow-up is outside your portfolio');
      }
    }
    const followUp = await changeFollowUp(
      pool,
      id,
      {
        status: body.status,
        snoozedUntil: body.snoozedUntil === undefined ? undefined : body.snoozedUntil ? new Date(body.snoozedUntil) : null,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        assignedStaffId: body.assignedStaffId,
        priority: body.priority,
        outcome: body.outcome,
        notes: body.notes,
      },
      { userId: ctx.userId, audit: requestAuditContext(request) }
    );
    return { followUp };
  });

  // ----------------------------------------------------------------------- payment promises ---
  app.get(`${BASE}/payment-promises`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.promises');
    const query = parseOrThrow(
      z.object({
        ...pagination,
        status: z.enum(['pending', 'fulfilled', 'partially_fulfilled', 'broken', 'cancelled', 'due_today', 'overdue']).optional(),
        customerId: z.string().uuid().optional(),
        caseId: z.string().uuid().optional(),
        invoiceId: z.string().uuid().optional(),
        assignedStaffId: z.string().uuid().optional(),
      }),
      request.query
    );
    return listPromises(pool, { ...query, scopeStaffId: ctx.scopeStaffId } as Parameters<typeof listPromises>[1]);
  });

  app.post(`${BASE}/payment-promises`, async (request, reply) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.promises');
    const body = parseOrThrow(createPromiseBody, request.body);
    const promise = await createPaymentPromise(
      pool,
      { ...body, assignedStaffId: body.assignedStaffId ?? ctx.userId },
      { userId: ctx.userId, audit: requestAuditContext(request) }
    );
    reply.code(201);
    return { promise };
  });

  app.patch<{ Params: { id: string } }>(`${BASE}/payment-promises/:id`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.promises');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(patchPromiseBody, request.body);
    const actor = { userId: ctx.userId, audit: requestAuditContext(request) };
    if (body.action === 'cancel') {
      const promise = await cancelPromise(pool, id, body.reason ?? '', actor);
      return { promise };
    }
    if (body.action === 'reconcile') {
      // On-demand ledger reconciliation — the ledger decides, never the caller (spec §10, §52).
      const existing = await findPromiseById(pool, id);
      if (!existing) throw new NotFoundError('Payment promise not found');
      await reconcilePromise(pool, existing);
      const promise = await findPromiseById(pool, id);
      return { promise };
    }
    // reassign
    if (!body.assignedStaffId) throw new ValidationError('assignedStaffId is required to reassign');
    await pool.query(`UPDATE revenue_guardian_payment_promises SET assigned_staff_id = $2, updated_at = now() WHERE id = $1`, [
      id,
      body.assignedStaffId,
    ]);
    const promise = await findPromiseById(pool, id);
    if (!promise) throw new NotFoundError('Payment promise not found');
    return { promise };
  });

  // -------------------------------------------------------------------------- assignments ---
  app.get(`${BASE}/assignments`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const query = parseOrThrow(
      z.object({
        ...pagination,
        customerId: z.string().uuid().optional(),
        staffUserId: z.string().uuid().optional(),
        assignmentType: z.enum(ASSIGNMENT_TYPES).optional(),
        includeEnded: z.coerce.boolean().optional(),
      }),
      request.query
    );
    return listAssignments(pool, query);
  });

  app.post(`${BASE}/assignments`, async (request, reply) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.assign');
    const body = parseOrThrow(createAssignmentBody, request.body);
    const actor = { userId: ctx.userId, audit: requestAuditContext(request) };
    const assignments = [];
    for (const customerId of body.customerIds) {
      assignments.push(
        await assignCustomer(
          pool,
          { customerId, staffUserId: body.staffUserId, assignmentType: body.assignmentType, reason: body.reason ?? null },
          actor
        )
      );
    }
    reply.code(201);
    return { assignments };
  });

  app.patch<{ Params: { id: string } }>(`${BASE}/assignments/:id`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.assign');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(z.object({ action: z.literal('end'), reason: z.string().min(1).max(2000) }), request.body);
    const assignment = await unassignCustomer(pool, id, body.reason, { userId: ctx.userId, audit: requestAuditContext(request) });
    return { assignment };
  });

  app.get(`${BASE}/assignment-rules`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.assign');
    return { rules: await listAssignmentRules(pool) };
  });

  app.post(`${BASE}/assignment-rules`, async (request, reply) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.assign');
    const body = parseOrThrow(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        conditions: assignmentConditionsSchema,
        staffUserId: z.string().uuid(),
        assignmentType: z.enum(ASSIGNMENT_TYPES),
        enabled: z.boolean().optional(),
        priority: z.number().int().min(0).max(10000).optional(),
      }),
      request.body
    );
    const rule = await insertAssignmentRule(pool, { ...body, createdBy: ctx.userId });
    reply.code(201);
    return { rule };
  });

  app.patch<{ Params: { id: string } }>(`${BASE}/assignment-rules/:id`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.assign');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(
      z.object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        conditions: assignmentConditionsSchema.optional(),
        staffUserId: z.string().uuid().optional(),
        assignmentType: z.enum(ASSIGNMENT_TYPES).optional(),
        enabled: z.boolean().optional(),
        priority: z.number().int().min(0).max(10000).optional(),
      }),
      request.body
    );
    const rule = await updateAssignmentRule(pool, id, body);
    if (!rule) throw new NotFoundError('Assignment rule not found');
    return { rule };
  });

  // ------------------------------------------------------------------------------ customers ---
  app.get<{ Params: { id: string } }>(`${BASE}/customers/:id`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const { id } = parseOrThrow(idParam, request.params);
    if (ctx.scopeStaffId) {
      const { rows } = await pool.query<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM revenue_guardian_assignments a
            WHERE a.customer_id = $1 AND a.staff_user_id = $2 AND a.ended_at IS NULL
           UNION
           SELECT 1 FROM revenue_guardian_recovery_cases c
            WHERE c.customer_id = $1 AND c.assigned_staff_id = $2
         ) AS ok`,
        [id, ctx.scopeStaffId]
      );
      if (!rows[0]?.ok) throw new ForbiddenError('This customer is outside your portfolio');
    }
    const profile = await getCustomerProfile(pool, id);
    if (!profile) throw new NotFoundError('Customer not found');
    const timeline = await listActivities(pool, { customerId: id, limit: 100 });
    const communications = await listCommunications(pool, { customerId: id, limit: 50 });
    return { profile, timeline: timeline.items, communications: communications.items };
  });

  // ----------------------------------------------------------------- staff & my-work views ---
  app.get(`${BASE}/staff-performance`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.staff_performance');
    const query = parseOrThrow(
      z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional(), staffUserId: z.string().uuid().optional() }),
      request.query
    );
    return { items: await getStaffPerformance(pool, query) };
  });

  app.get(`${BASE}/my-work`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const staffId = ctx.userId;
    const [cases, followUpsToday, followUpsOverdue, promises, assignments] = await Promise.all([
      listCases(pool, { assignedStaffId: staffId, status: 'open', limit: 50 }),
      listFollowUps(pool, { assignedStaffId: staffId, status: 'due_today', limit: 50 }),
      listFollowUps(pool, { assignedStaffId: staffId, status: 'overdue', limit: 50 }),
      listPromises(pool, { assignedStaffId: staffId, status: 'pending', limit: 50 }),
      listAssignments(pool, { staffUserId: staffId, limit: 100 }),
    ]);
    const myPerformance = await getStaffPerformance(pool, { staffUserId: staffId });
    return {
      cases: cases.items,
      followUpsToday: followUpsToday.items,
      followUpsOverdue: followUpsOverdue.items,
      promises: promises.items,
      customers: assignments.items,
      performance: myPerformance[0] ?? null,
    };
  });

  /** Staff directory for assignment dropdowns (id/name/email only — no sensitive fields). */
  app.get(`${BASE}/staff`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const { rows } = await pool.query<{ id: string; email: string; full_name: string; role: string }>(
      `SELECT id, email, full_name, role FROM users
        WHERE role IN ('staff','admin','super_admin') AND status = 'active' ORDER BY full_name ASC`
    );
    return { staff: rows };
  });

  // -------------------------------------------------------------------------------- reports ---
  app.get(`${BASE}/reports`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.reports');
    return { reportTypes: REPORT_TYPES };
  });

  const reportQuery = z.object({
    reportType: z.enum(REPORT_TYPES),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    staffUserId: z.string().uuid().optional(),
  });

  app.post(`${BASE}/reports/run`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.reports');
    const body = parseOrThrow(reportQuery, request.body);
    if (body.reportType === 'staff_performance' && !ctx.permissions.includes('revenue_guardian.staff_performance')) {
      throw new ForbiddenError('Missing permission: revenue_guardian.staff_performance');
    }
    return buildReport(pool, { ...body, scopeStaffId: ctx.scopeStaffId, generatedByEmail: ctx.email ?? ctx.userId });
  });

  app.post(`${BASE}/reports/export`, async (request, reply) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.export');
    const body = parseOrThrow(reportQuery.extend({ format: z.enum(['csv']).default('csv') }), request.body);
    if (body.reportType === 'staff_performance' && !ctx.permissions.includes('revenue_guardian.staff_performance')) {
      throw new ForbiddenError('Missing permission: revenue_guardian.staff_performance');
    }
    const report = await buildReport(pool, { ...body, scopeStaffId: ctx.scopeStaffId, generatedByEmail: ctx.email ?? ctx.userId });
    const csv = reportToCsv(report);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="revenue-guardian-${body.reportType}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

  // ------------------------------------------------------------------------------ automation ---
  app.get(`${BASE}/automation/jobs`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.automation');
    const { rows } = await pool.query<{ job_name: string; last_success: string | null; last_failed: string | null }>(
      `SELECT job_name,
              max(finished_at) FILTER (WHERE status = 'completed')::text AS last_success,
              max(finished_at) FILTER (WHERE status = 'failed')::text AS last_failed
         FROM revenue_guardian_automation_runs GROUP BY job_name`
    );
    const byJob = new Map(rows.map((r) => [r.job_name, r]));
    const settings = await loadRgSettings(pool);
    return {
      jobs: RG_JOBS.map((j) => ({
        name: j.name,
        description: j.description,
        lastSuccessfulRun: byJob.get(j.name)?.last_success ?? null,
        lastFailedRun: byJob.get(j.name)?.last_failed ?? null,
      })),
      schedulerIntervalMinutes: settings.schedulerIntervalMinutes,
      enabled: settings.enabled,
      timezone: settings.timezone,
    };
  });

  app.post<{ Params: { name: string } }>(`${BASE}/automation/jobs/:name/run`, async (request, reply) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.manual_run');
    const { name } = parseOrThrow(z.object({ name: z.string().max(64) }), request.params);
    if (!findJob(name)) throw new NotFoundError('Unknown automation job');
    const outcome = await executeJobManually(pool, name, ctx.userId);
    if (outcome.status === 'locked') {
      reply.code(409);
      return { error: 'RUN_IN_PROGRESS', message: 'This automation was already executed in the last minute or is currently running' };
    }
    return outcome;
  });

  app.get(`${BASE}/automation/rules`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.automation');
    return { rules: await listAutomationRules(pool) };
  });

  app.post(`${BASE}/automation/rules`, async (request, reply) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.automation');
    const body = parseOrThrow(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        eventType: z.enum(AUTOMATION_EVENT_TYPES),
        conditions: automationConditionsSchema.default({}),
        actions: automationActionsSchema.default([]),
        enabled: z.boolean().optional(),
        priority: z.number().int().min(0).max(10000).optional(),
      }),
      request.body
    );
    const rule = await insertAutomationRule(pool, {
      ...body,
      conditions: body.conditions ?? {},
      actions: body.actions ?? [],
      createdBy: ctx.userId,
    });
    reply.code(201);
    return { rule };
  });

  app.patch<{ Params: { id: string } }>(`${BASE}/automation/rules/:id`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.automation');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(
      z.object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        conditions: automationConditionsSchema.optional(),
        actions: automationActionsSchema.optional(),
        enabled: z.boolean().optional(),
        priority: z.number().int().min(0).max(10000).optional(),
      }),
      request.body
    );
    const rule = await updateAutomationRule(pool, id, body);
    if (!rule) throw new NotFoundError('Automation rule not found');
    return { rule };
  });

  app.get(`${BASE}/automation/runs`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.automation');
    const query = parseOrThrow(
      z.object({ ...pagination, jobName: z.string().max(64).optional(), status: z.enum(['running', 'completed', 'failed']).optional() }),
      request.query
    );
    return listRuns(pool, query);
  });

  // ------------------------------------------------------------------------ logs & health ---
  app.get(`${BASE}/activities`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const query = parseOrThrow(
      z.object({
        ...pagination,
        customerId: z.string().uuid().optional(),
        caseId: z.string().uuid().optional(),
        invoiceId: z.string().uuid().optional(),
        actorId: z.string().uuid().optional(),
        eventType: z.string().max(48).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
      request.query
    );
    return listActivities(pool, query);
  });

  app.get(`${BASE}/email-logs`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.view');
    const query = parseOrThrow(
      z.object({
        ...pagination,
        customerId: z.string().uuid().optional(),
        caseId: z.string().uuid().optional(),
        status: z.string().max(32).optional(),
        channel: z.enum(['email', 'whatsapp']).optional(),
      }),
      request.query
    );
    return listCommunications(pool, query);
  });

  app.get(`${BASE}/health`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.automation');
    return getModuleHealth(pool);
  });

  // ------------------------------------------------------------------------------- settings ---
  app.get(`${BASE}/settings`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.settings');
    const settings = await loadRgSettings(pool);
    // Secrets are write-only: never returned to the browser (spec §49).
    const { whatsapp, ...rest } = settings;
    const safeWhatsapp = { enabled: whatsapp.enabled, provider: whatsapp.provider ?? null };
    return {
      settings: { ...rest, whatsapp: safeWhatsapp },
      whatsappStatus: await getWhatsAppStatus(pool),
      emailTemplateDefaults: RG_DEFAULT_TEMPLATES,
    };
  });

  const settingsPatchSchema = z
    .object({
      enabled: z.boolean().optional(),
      timezone: z.string().max(64).optional(),
      reportingCurrency: z.string().length(3).optional(),
      overdueThresholdDays: z.number().int().min(0).max(365).optional(),
      upcomingInvoiceReminderDays: z.array(z.number().int().min(0).max(365)).max(12).optional(),
      overdueFollowupDays: z.number().int().min(0).max(365).optional(),
      renewalReminderDays: z.array(z.number().int().min(0).max(365)).max(12).optional(),
      preSuspensionAlertDays: z.number().int().min(0).max(365).optional(),
      preTerminationAlertDays: z.number().int().min(0).max(365).optional(),
      terminateAfterSuspensionDays: z.number().int().min(1).max(365).optional(),
      riskThresholds: z.object({ medium: z.number().min(0).max(100), high: z.number().min(0).max(100), critical: z.number().min(0).max(100) }).optional(),
      highValueThresholds: z.object({ lifetimeRevenue: z.number().min(0), recurringRevenue: z.number().min(0), activeServices: z.number().int().min(0) }).optional(),
      agingBuckets: z.array(z.number().int().min(1).max(3650)).min(1).max(10).optional(),
      escalationLevels: z.array(z.object({ level: z.number().int().min(1).max(4), overdueDays: z.number().int().min(0).max(3650) })).max(4).optional(),
      schedulerIntervalMinutes: z.number().int().min(5).max(1440).optional(),
      whatsapp: z.record(z.unknown()).optional(),
      emailTemplates: z.record(z.object({ subject: z.string().max(255).optional(), text: z.string().max(10000).optional(), enabled: z.boolean().optional() })).optional(),
    })
    .strict();

  app.patch(`${BASE}/settings`, async (request) => {
    const ctx = await requireRgPermission(request, env, pool, 'revenue_guardian.settings');
    const body = parseOrThrow(settingsPatchSchema, request.body);
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if (key === 'whatsapp') {
        // Merge to preserve stored credentials the client never sees.
        const current = (await loadRgSettings(pool)).whatsapp;
        await setRgSetting(pool, 'whatsapp', { ...current, ...(value as Record<string, unknown>) } as RgSettings['whatsapp'], ctx.userId);
        continue;
      }
      await setRgSetting(pool, key as keyof typeof RG_DEFAULT_SETTINGS, value as never, ctx.userId);
    }
    return { settings: await loadRgSettings(pool).then(({ whatsapp, ...rest }) => ({ ...rest, whatsapp: { enabled: whatsapp.enabled, provider: whatsapp.provider ?? null } })) };
  });

  /** Preview a rendered email template with sample variables (spec §22 "preview"). */
  app.post(`${BASE}/settings/email-templates/preview`, async (request) => {
    await requireRgPermission(request, env, pool, 'revenue_guardian.settings');
    const body = parseOrThrow(z.object({ templateKey: z.string().max(64) }), request.body);
    const template = await resolveTemplate(pool, body.templateKey);
    if (!template) throw new NotFoundError('Unknown template');
    const sample = {
      customerName: 'Sample Customer',
      invoiceNumber: 'INV-00000001',
      amount: '49.99',
      currency: 'USD',
      dueDate: new Date().toISOString().slice(0, 10),
      promisedDate: new Date().toISOString().slice(0, 10),
      serviceLabel: 'Sample Hosting Plan',
      expiryDate: new Date().toISOString().slice(0, 10),
      daysRemaining: '7',
      staffName: 'Sample Staff',
      caseNumber: 'RG-00000001',
      customerEmail: 'customer@example.com',
      level: '2',
    };
    return {
      subject: renderTemplate(template.subject, sample),
      text: renderTemplate(template.text, sample),
      enabled: template.enabled,
    };
  });

  // -------------------------------------------------------- customer-facing account health ---
  // Spec §45: read-only billing health for the signed-in customer. Never exposes staff notes,
  // internal risk scoring, assignments, or collection commentary.
  app.get('/api/v1/account/revenue-health', async (request) => {
    const auth = await authenticate(request, env, pool);
    const [invoices, renewals, promises] = await Promise.all([
      pool.query(
        `SELECT id, invoice_number, currency, total_amount::text, status, due_date::text,
                (status = 'unpaid' AND due_date < CURRENT_DATE) AS is_overdue
           FROM invoices WHERE user_id = $1 AND status = 'unpaid' ORDER BY due_date ASC LIMIT 50`,
        [auth.userId]
      ),
      pool.query(
        `SELECT 'subscription' AS kind, COALESCE(p.name || ' — ' || pl.name, pl.name) AS label,
                s.current_period_end::text AS expires_at, s.status
           FROM subscriptions s
           JOIN product_plans pl ON pl.id = s.plan_id
           LEFT JOIN products p ON p.id = pl.product_id
          WHERE s.customer_id = $1 AND s.status IN ('active','trialing','past_due','grace_period','suspended')
          ORDER BY s.current_period_end ASC LIMIT 50`,
        [auth.userId]
      ),
      pool.query(
        `SELECT pr.promised_amount::text, pr.currency, pr.promised_date::text, pr.status, i.invoice_number
           FROM revenue_guardian_payment_promises pr
           JOIN invoices i ON i.id = pr.invoice_id
          WHERE pr.customer_id = $1 AND pr.status IN ('pending','partially_fulfilled')
          ORDER BY pr.promised_date ASC LIMIT 20`,
        [auth.userId]
      ),
    ]);
    return {
      outstandingInvoices: invoices.rows,
      services: renewals.rows,
      paymentArrangements: promises.rows,
    };
  });
}
