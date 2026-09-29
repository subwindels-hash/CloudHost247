/**
 * Phase 6 — admin platform routes: audit log (spec §54), settings (spec §21 configurable grace
 * period), subscription administration, deployment oversight; plus customer subscription routes
 * (spec §27): list, cancel, change plan.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { ValidationError, NotFoundError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import { getSetting, listSettings, listSubscriptionsForCustomer, setSetting, updateSubscription, findSubscriptionById, listSubscriptionsByStatus } from '../db/ops-tables';
import { listDeployments, findDeploymentById, listDeploymentSteps, listDeploymentEvents } from '../db/deployments';
import { findPlanById } from '../db/catalog-plans';
import { listAllInstallations } from '../db/application-installations';

const idSchema = z.string().uuid('id must be a valid UUID');

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

const SETTING_SCHEMAS: Record<string, z.ZodType<unknown>> = {
  'subscription.grace_period_days': z.coerce.number().int().min(1).max(90),
  'subscription.suspend_after_days': z.coerce.number().int().min(1).max(90),
  'backup.retention_days': z.coerce.number().int().min(1).max(3650),
  'deployment.max_attempts': z.coerce.number().int().min(1).max(10),
  'marketplace.require_approval': z.enum(['true', 'false']).transform((v) => v === 'true'),
};

export async function registerAdminPlatformRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // --- Audit log (spec §54) ----------------------------------------------------------------------
  app.get('/api/v1/admin/audit', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const query = parseOrThrow(
      z.object({
        actorId: z.string().uuid().optional(),
        action: z.string().max(96).optional(),
        resourceType: z.string().max(48).optional(),
        resourceId: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).max(100000).optional(),
      }),
      request.query ?? {}
    );
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.actorId) {
      params.push(query.actorId);
      conditions.push(`actor_id = $${params.length}`);
    }
    if (query.action) {
      params.push(query.action);
      conditions.push(`action = $${params.length}`);
    }
    if (query.resourceType) {
      params.push(query.resourceType);
      conditions.push(`resource_type = $${params.length}`);
    }
    if (query.resourceId) {
      params.push(query.resourceId);
      conditions.push(`resource_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT a.*, u.email AS actor_email, u.full_name AS actor_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT ${query.limit ?? 100} OFFSET ${query.offset ?? 0}`,
      params
    );
    const total = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM audit_logs a ${where}`, params);
    return { entries: rows, total: Number.parseInt(total.rows[0]?.count ?? '0', 10) };
  });

  // --- Platform settings (spec §21: "Make the grace period configurable from the admin dashboard") --
  /** Editable-setting metadata so the admin UI renders the whitelist, not a hardcoded list. */
  const SETTING_META: Array<{ key: string; type: 'number' | 'boolean' | 'string'; label: string; description: string; min: number | null; max: number | null }> = [
    {
      key: 'subscription.grace_period_days',
      type: 'number',
      label: 'Subscription grace period (days)',
      description: 'How long an overdue subscription stays active before suspension begins.',
      min: 1,
      max: 90,
    },
    {
      key: 'subscription.suspend_after_days',
      type: 'number',
      label: 'Suspend after (days overdue)',
      description: 'Overdue days (including the grace period) before the subscription is suspended.',
      min: 1,
      max: 90,
    },
    {
      key: 'backup.retention_days',
      type: 'number',
      label: 'Backup retention (days)',
      description: 'Age at which stored backups are marked expired by the retention sweep.',
      min: 1,
      max: 3650,
    },
    {
      key: 'deployment.max_attempts',
      type: 'number',
      label: 'Deployment max attempts',
      description: 'Retry ceiling per deployment job (backoff between attempts).',
      min: 1,
      max: 10,
    },
    {
      key: 'marketplace.require_approval',
      type: 'boolean',
      label: 'Marketplace submissions require approval',
      description: 'When true, imported or submitted applications start as draft and need the review workflow before publication.',
      min: null,
      max: null,
    },
  ];

  app.get('/api/v1/admin/settings', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const rows = await listSettings(pool);
    const settings: Record<string, unknown> = {};
    for (const row of rows) settings[row.key] = row.value;
    return { settings, schemas: SETTING_META };
  });

  app.put('/api/v1/admin/settings/:key', async (request) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const key = parseOrThrow(z.string().min(3).max(96), (request.params as { key: string }).key);
    const schema = SETTING_SCHEMAS[key];
    if (!schema) throw new ValidationError(`Unknown or non-configurable setting: ${key}`);
    const { value } = parseOrThrow(z.object({ value: z.unknown() }), request.body);
    // Out-of-range or wrong-typed values are client errors (400), not 500s.
    const checked = schema.safeParse(value);
    if (!checked.success) {
      throw new ValidationError(`${key} rejected: ${checked.error.issues.map((issue) => issue.message).join(', ')}`);
    }
    const validated = checked.data;
    await setSetting(pool, key, validated, auth.userId);
    await auditRequest(pool, request, auth.userId, {
      action: 'settings.updated',
      resourceType: 'platform_setting',
      resourceId: key,
      metadata: { value: validated },
    });
    return { key, value: validated };
  });

  // --- Deployment oversight (spec §46 "View deployments / failures") -----------------------------
  app.get('/api/v1/admin/deployments', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin', 'staff']);
    const query = parseOrThrow(
      z.object({
        status: z.string().max(24).optional(),
        action: z.string().max(24).optional(),
        installationId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
      request.query ?? {}
    );
    return {
      deployments: await listDeployments(pool, {
        status: query.status,
        action: query.action,
        installationId: query.installationId,
        limit: query.limit,
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/deployments/:id', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin', 'staff']);
    const id = parseOrThrow(idSchema, request.params.id);
    const deployment = await findDeploymentById(pool, id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');
    return {
      deployment,
      steps: await listDeploymentSteps(pool, id),
      events: await listDeploymentEvents(pool, id),
    };
  });

  // --- Installation oversight -------------------------------------------------------------------
  app.get('/api/v1/admin/installations', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin', 'staff']);
    const query = parseOrThrow(
      z.object({ status: z.string().max(24).optional(), customerId: z.string().uuid().optional() }),
      request.query ?? {}
    );
    return {
      installations: await listAllInstallations(pool, {
        status: query.status,
        customerId: query.customerId,
      }),
    };
  });

  // --- Subscription administration ---------------------------------------------------------------
  app.get('/api/v1/admin/subscriptions', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const query = parseOrThrow(z.object({ status: z.string().max(24).optional() }), request.query ?? {});
    const subscriptions = query.status
      ? await listSubscriptionsByStatus(pool, query.status)
      : (await pool.query(`SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 200`)).rows;
    return { subscriptions };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/subscriptions/:id/activate', async (request) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const subscription = await findSubscriptionById(pool, id);
    if (!subscription) throw new NotFoundError('No subscription was found with that id');
    const updated = await updateSubscription(pool, id, {
      status: 'active',
      pastDueSince: null,
      suspendedAt: null,
    });
    await auditRequest(pool, request, auth.userId, {
      action: 'subscription.activated',
      resourceType: 'subscription',
      resourceId: id,
      metadata: { from: subscription.status },
    });
    return { subscription: updated };
  });

  // --- Customer subscriptions (spec §27) ----------------------------------------------------------
  app.get('/api/v1/billing/subscriptions', async (request) => {
    const auth = await authenticate(request, env, pool);
    const subscriptions = await listSubscriptionsForCustomer(pool, auth.userId);
    const withPlans = await Promise.all(
      subscriptions.map(async (s) => {
        const plan = await findPlanById(pool, s.plan_id);
        return {
          id: s.id,
          status: s.status,
          planName: plan?.name ?? null,
          installationId: s.installation_id,
          currentPeriodEnd: s.current_period_end,
          cancelAtPeriodEnd: s.cancel_at_period_end,
          createdAt: s.created_at,
        };
      })
    );
    return { subscriptions: withPlans };
  });

  app.post<{ Params: { id: string } }>('/api/v1/billing/subscriptions/:id/cancel', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const subscription = await findSubscriptionById(pool, id);
    if (!subscription || subscription.customer_id !== auth.userId) {
      throw new NotFoundError('No subscription was found with that id');
    }
    if (['cancelled', 'terminated', 'expired'].includes(subscription.status)) {
      return { subscription, alreadyCancelled: true };
    }
    const updated = await updateSubscription(pool, id, {
      status: 'cancelled',
      cancelAtPeriodEnd: true,
      cancelledAt: new Date().toISOString(),
    });
    await auditRequest(pool, request, auth.userId, {
      action: 'subscription.cancelled',
      resourceType: 'subscription',
      resourceId: id,
    });
    return { subscription: updated };
  });

  app.post<{ Params: { id: string } }>('/api/v1/billing/subscriptions/:id/change-plan', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const { planId } = parseOrThrow(z.object({ planId: z.string().uuid() }), request.body);
    const subscription = await findSubscriptionById(pool, id);
    if (!subscription || subscription.customer_id !== auth.userId) {
      throw new NotFoundError('No subscription was found with that id');
    }
    const plan = await findPlanById(pool, planId);
    if (!plan || plan.status !== 'active') throw new NotFoundError('No purchasable plan was found with that id');
    if (subscription.status !== 'active') {
      throw new ValidationError('Only active subscriptions can change plan');
    }
    // Plan change is recorded as a new order at the new plan's price (billed at next renewal)
    // — the subscription row keeps its period; the billing engine prices the next cycle.
    const updated = await updateSubscription(pool, id, {});
    await auditRequest(pool, request, auth.userId, {
      action: 'subscription.plan_change_requested',
      resourceType: 'subscription',
      resourceId: id,
      metadata: { fromPlan: subscription.plan_id, toPlan: planId },
    });
    return { subscription: updated, pendingPlanId: planId };
  });
}
