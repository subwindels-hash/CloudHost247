/**
 * Admin control centre for the CloudHost247 platform services added on top of the existing
 * domain/hosting platform: packaged service plans, the expert-services delivery queue, managed
 * digital-marketing campaigns, and the online-store oversight view. The unified inbox has its own
 * role-gated routes in `src/routes/inbox.ts`; the website builder has `src/routes/builder.ts`.
 *
 * Everything here is role-gated (staff for the queues, admin for anything that changes pricing or
 * what the public can buy) and every mutation writes an audit row. Pricing fields are the one place
 * where the admin's exact input is authoritative — an unpriced plan stays unpriced, and the public
 * surfaces keep showing "not published yet" until an operator sets a real price.
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { auditRequest } from '../lib/audit';
import { ValidationError } from '../lib/errors';
import {
  addStaffMessage as addExpertStaffMessage,
  assignRequest,
  getRequestForStaff,
  issueQuote,
  listOfferings as listExpertOfferings,
  listRequestsForStaff,
  updateRequestStatus,
  upsertOffering as upsertExpertOffering,
  type RequestStatus,
} from '../experts/expert-service';
import {
  addStaffCampaignMessage,
  createReportPeriod,
  getCampaignForStaff,
  listCampaignsForStaff,
  listChannelConnections,
  listOfferings as listMarketingOfferings,
  recordMetrics,
  updateCampaignStatus,
  upsertChannelConnection,
  upsertOffering as upsertMarketingOffering,
  configuredProviderKeys,
  requiredEnvFor,
  type CampaignStatus,
} from '../marketing-services/campaign-service';
import {
  createPlan,
  listAllPlans,
  parseLimits,
  updatePlan,
  type BillingPeriod,
  type PlatformServiceKind,
} from '../commerce/platform-plans';

const STAFF = ['staff', 'admin', 'super_admin'] as const;
const ADMIN = ['admin', 'super_admin'] as const;

const SERVICE_KINDS = ['website_builder', 'ai_builder', 'online_store', 'marketing', 'inbox', 'logo_maker'] as const;
const BILLING_PERIODS = ['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually'] as const;

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  return parsed.data;
}

export async function registerAdminPlatformServiceRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  /* ------------------------------------------------------------------------------------------
   * Overview
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/admin/platform-services/overview', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM platform_service_plans) AS plans,
         (SELECT count(*)::int FROM platform_service_plans WHERE status = 'published') AS published_plans,
         (SELECT count(*)::int FROM expert_service_requests) AS expert_requests,
         (SELECT count(*)::int FROM expert_service_requests WHERE status IN ('requested','researching','quoted','approved','in_progress')) AS expert_open,
         (SELECT count(*)::int FROM marketing_campaigns) AS campaigns,
         (SELECT count(*)::int FROM marketing_campaigns WHERE status IN ('requested','planning','active','paused')) AS campaigns_live,
         (SELECT count(*)::int FROM store_stores) AS stores,
         (SELECT count(*)::int FROM store_orders WHERE payment_status = 'paid') AS store_paid_orders,
         (SELECT count(*)::int FROM builder_sites) AS builder_sites,
         (SELECT count(*)::int FROM builder_sites WHERE status = 'published') AS builder_published,
         (SELECT count(*)::int FROM inbox_conversations WHERE status <> 'closed') AS inbox_open,
         (SELECT COALESCE(sum(unread_for_staff), 0)::int FROM inbox_conversations) AS inbox_unread,
         (SELECT count(*)::int FROM logo_projects) AS logo_projects`
    );
    return { overview: rows[0] ?? {} };
  });

  /* ------------------------------------------------------------------------------------------
   * Packaged platform service plans (pricing authority for the new services)
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/admin/platform-services/plans', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const serviceKind = (request.query as { serviceKind?: string }).serviceKind;
    const plans = await listAllPlans(pool, serviceKind as PlatformServiceKind | undefined);
    return {
      plans: plans.map((plan) => ({ ...plan, limits: parseLimits(plan.limits) })),
      serviceKinds: SERVICE_KINDS,
      billingPeriods: BILLING_PERIODS,
    };
  });

  app.post('/api/v1/admin/platform-services/plans', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ADMIN);
    const input = parseOrThrow(
      z.object({
        serviceKind: z.enum(SERVICE_KINDS),
        code: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use lower-case letters, numbers, - or _'),
        name: z.string().min(2).max(160),
        description: z.string().max(2000).nullable().optional(),
        billingPeriod: z.enum(BILLING_PERIODS),
        priceAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a price like 19.00'),
        currency: z.string().length(3).optional(),
        features: z.array(z.string().max(200)).max(30).optional(),
        limits: z.record(z.number().int().min(0)).optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
      }),
      request.body
    );
    const plan = await createPlan(pool, randomUUID(), { ...input, createdBy: auth.userId });
    await auditRequest(pool, request, auth.userId, {
      action: 'platform_plan.created',
      resourceType: 'platform_service_plan',
      resourceId: plan.id,
      metadata: { serviceKind: plan.service_kind, code: plan.code, status: plan.status, price: plan.price_amount },
    });
    reply.code(201);
    return { plan };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/platform-services/plans/:id', async (request) => {
    const auth = await requireRole(request, env, pool, ADMIN);
    const input = parseOrThrow(
      z.object({
        name: z.string().min(2).max(160).optional(),
        description: z.string().max(2000).nullable().optional(),
        priceAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a price like 19.00').optional(),
        features: z.array(z.string().max(200)).max(30).optional(),
        limits: z.record(z.number().int().min(0)).optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
      }),
      request.body
    );
    const plan = await updatePlan(pool, request.params.id, input);
    if (!plan) throw new ValidationError('No plan was found with that id');
    await auditRequest(pool, request, auth.userId, {
      action: 'platform_plan.updated',
      resourceType: 'platform_service_plan',
      resourceId: plan.id,
      metadata: { status: plan.status, price: plan.price_amount, changed: Object.keys(input) },
    });
    return { plan };
  });

  /* ------------------------------------------------------------------------------------------
   * Website Builder oversight
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/admin/website-builder/sites', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.slug, s.status, s.created_at, s.updated_at, u.email AS owner_email,
              (SELECT count(*)::int FROM builder_pages p WHERE p.site_id = s.id AND p.status <> 'archived') AS page_count,
              (SELECT count(*)::int FROM builder_publications b WHERE b.site_id = s.id) AS publication_count,
              (SELECT max(b.created_at) FROM builder_publications b WHERE b.site_id = s.id AND b.unpublished_at IS NULL) AS published_at,
              (SELECT count(*)::int FROM builder_form_submissions f WHERE f.site_id = s.id) AS submission_count
         FROM builder_sites s JOIN users u ON u.id = s.user_id
        ORDER BY s.created_at DESC LIMIT 200`
    );
    return { sites: rows };
  });

  /* ------------------------------------------------------------------------------------------
   * Expert services delivery queue
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/admin/expert-services/offerings', async (request) => {
    await requireRole(request, env, pool, STAFF);
    return { offerings: await listExpertOfferings(pool, true) };
  });

  app.post('/api/v1/admin/expert-services/offerings', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ADMIN);
    const input = parseOrThrow(
      z.object({
        id: z.string().uuid().optional(),
        code: z.string().max(64).optional(),
        name: z.string().min(2).max(160),
        category: z.enum([
          'website_design',
          'website_development',
          'ecommerce',
          'redesign',
          'seo',
          'migration',
          'maintenance',
          'integration',
          'consulting',
        ]),
        summary: z.string().max(500).optional(),
        description: z.string().max(6000).optional(),
        deliverables: z.array(z.string().max(200)).max(20).optional(),
        startingPriceAmount: z.number().min(0).nullable().optional(),
        pricingModel: z.enum(['quoted', 'fixed']).optional(),
        typicalDeliveryDays: z.number().int().min(1).max(365).nullable().optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
      }),
      request.body
    );
    const offering = await upsertExpertOffering(pool, input, input.id);
    await auditRequest(pool, request, auth.userId, {
      action: input.id ? 'expert_service_offering.updated' : 'expert_service_offering.created',
      resourceType: 'expert_service_offering',
      resourceId: (offering as { id?: string }).id ?? null,
      metadata: { name: input.name, status: input.status ?? 'unchanged' },
    });
    reply.code(input.id ? 200 : 201);
    return { offering };
  });

  app.get('/api/v1/admin/expert-services/requests', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const query = request.query as Record<string, string | undefined>;
    return listRequestsForStaff(pool, {
      status: query.status,
      assignedTo: query.assignee ?? undefined,
      search: query.search,
      limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
      offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/expert-services/requests/:id', async (request) => {
    await requireRole(request, env, pool, STAFF);
    return getRequestForStaff(pool, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/expert-services/requests/:id/assign', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(z.object({ staffId: z.string().uuid().nullable() }), request.body);
    const result = await assignRequest(pool, auth.userId, request.params.id, input.staffId);
    await auditRequest(pool, request, auth.userId, {
      action: 'expert_service_request.assigned',
      resourceType: 'expert_service_request',
      resourceId: request.params.id,
      metadata: { staffId: input.staffId },
    });
    return { request: result };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/expert-services/requests/:id/status', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({
        status: z.enum([
          'researching',
          'quoted',
          'approved',
          'in_progress',
          'review',
          'completed',
          'rejected',
          'cancelled',
          'failed',
        ]),
        note: z.string().max(500).nullable().optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      }),
      request.body
    );
    const result = await updateRequestStatus(pool, auth.userId, request.params.id, input.status as RequestStatus, {
      note: input.note ?? null,
      priority: input.priority,
    });
    await auditRequest(pool, request, auth.userId, {
      action: 'expert_service_request.status_changed',
      resourceType: 'expert_service_request',
      resourceId: request.params.id,
      metadata: { status: input.status },
    });
    return result;
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/expert-services/requests/:id/quotes', async (request, reply) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({
        amount: z.number().positive(),
        scope: z.string().min(10).max(4000),
        deliverables: z.array(z.string().max(200)).max(20).optional(),
        deliveryDays: z.number().int().min(1).max(365).nullable().optional(),
        validUntil: z.string().datetime().nullable().optional(),
      }),
      request.body
    );
    const result = await issueQuote(pool, auth.userId, request.params.id, input);
    await auditRequest(pool, request, auth.userId, {
      action: 'expert_service_quote.issued',
      resourceType: 'expert_service_request',
      resourceId: request.params.id,
      metadata: { quoteId: result.quoteId, amount: input.amount.toFixed(2) },
    });
    reply.code(201);
    return result;
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/expert-services/requests/:id/messages', async (request, reply) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({ body: z.string().min(1).max(8000), visibility: z.enum(['customer', 'internal']) }),
      request.body
    );
    const message = await addExpertStaffMessage(pool, auth.userId, request.params.id, input);
    reply.code(201);
    return { message };
  });

  /* ------------------------------------------------------------------------------------------
   * Managed digital marketing
   * ---------------------------------------------------------------------------------------- */

  app.get('/api/v1/admin/marketing-services/offerings', async (request) => {
    await requireRole(request, env, pool, STAFF);
    return { offerings: await listMarketingOfferings(pool, true) };
  });

  app.post('/api/v1/admin/marketing-services/offerings', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ADMIN);
    const input = parseOrThrow(
      z.object({
        id: z.string().uuid().optional(),
        code: z.string().max(64).optional(),
        name: z.string().min(2).max(160),
        channel: z.enum(['seo', 'search_ads', 'social', 'email', 'advertising', 'analytics', 'content', 'conversion']),
        summary: z.string().max(500).optional(),
        description: z.string().max(6000).optional(),
        deliverables: z.array(z.string().max(200)).max(20).optional(),
        startingPriceAmount: z.number().min(0).nullable().optional(),
        billingPeriod: z.enum(BILLING_PERIODS).optional(),
        minTermMonths: z.number().int().min(1).max(36).optional(),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        sortOrder: z.number().int().min(0).max(9999).optional(),
      }),
      request.body
    );
    const offering = await upsertMarketingOffering(pool, input, input.id);
    await auditRequest(pool, request, auth.userId, {
      action: input.id ? 'marketing_offering.updated' : 'marketing_offering.created',
      resourceType: 'marketing_service_offering',
      resourceId: (offering as { id?: string }).id ?? null,
      metadata: { channel: input.channel, status: input.status ?? 'unchanged' },
    });
    reply.code(input.id ? 200 : 201);
    return { offering };
  });

  app.get('/api/v1/admin/marketing-services/channels', async (request) => {
    await requireRole(request, env, pool, STAFF);
    // Each connection is returned with the configuration it still needs, so the console can say
    // which credential is missing instead of showing a channel as usable when it is not.
    const connections = (await listChannelConnections(pool)).map((connection) => ({
      ...connection,
      requiredEnv: requiredEnvFor(connection.provider_key),
    }));
    return { connections };
  });

  app.post('/api/v1/admin/marketing-services/channels', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ADMIN);
    const input = parseOrThrow(
      z.object({
        channel: z.enum(['seo', 'search_ads', 'social', 'email', 'advertising', 'analytics', 'content', 'conversion']),
        name: z.string().max(120).optional(),
        providerKey: z.string().min(2).max(64),
      }),
      request.body
    );
    const registeredProviderKeys = configuredProviderKeys(process.env);
    const connection = await upsertChannelConnection(pool, { ...input, registeredProviderKeys });
    await auditRequest(pool, request, auth.userId, {
      action: 'marketing_channel_connection.saved',
      resourceType: 'marketing_channel_connection',
      resourceId: connection.id,
      metadata: {
        channel: connection.channel,
        providerKey: connection.provider_key,
        status: connection.status,
        requiredEnv: requiredEnvFor(connection.provider_key),
      },
    });
    reply.code(201);
    return { connection };
  });

  app.get('/api/v1/admin/marketing-services/campaigns', async (request) => {
    await requireRole(request, env, pool, STAFF);
    const query = request.query as Record<string, string | undefined>;
    return listCampaignsForStaff(pool, {
      status: query.status,
      search: query.search,
      limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
      offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/marketing-services/campaigns/:id', async (request) => {
    await requireRole(request, env, pool, STAFF);
    return getCampaignForStaff(pool, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/marketing-services/campaigns/:id/status', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({
        status: z.enum(['planning', 'active', 'paused', 'reporting', 'completed', 'rejected', 'cancelled', 'failed']),
        note: z.string().max(500).nullable().optional(),
      }),
      request.body
    );
    const result = await updateCampaignStatus(pool, auth.userId, request.params.id, input.status as CampaignStatus, {
      note: input.note ?? null,
    });
    await auditRequest(pool, request, auth.userId, {
      action: 'marketing_campaign.status_changed',
      resourceType: 'marketing_campaign',
      resourceId: request.params.id,
      metadata: { status: input.status },
    });
    return result;
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/marketing-services/campaigns/:id/reports', async (request, reply) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form'),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form'),
        summary: z.string().max(2000).nullable().optional(),
        status: z.enum(['pending', 'collecting', 'published', 'unavailable']).optional(),
      }),
      request.body
    );
    const period = await createReportPeriod(pool, auth.userId, request.params.id, input);
    reply.code(201);
    return { period };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/marketing-services/reports/:id/metrics', async (request) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({
        metrics: z
          .array(
            z.object({
              key: z.string().min(1).max(60),
              label: z.string().min(1).max(120),
              value: z.number().finite(),
              unit: z.enum(['count', 'currency', 'percent', 'ratio', 'seconds']).optional(),
              source: z.string().min(1).max(60),
              estimated: z.boolean().optional(),
            })
          )
          .min(1)
          .max(60),
      }),
      request.body
    );
    const result = await recordMetrics(pool, auth.userId, request.params.id, input.metrics);
    await auditRequest(pool, request, auth.userId, {
      action: 'marketing_report.metrics_recorded',
      resourceType: 'marketing_report_period',
      resourceId: request.params.id,
      metadata: { metricCount: result.metricCount, sources: [...new Set(input.metrics.map((m) => m.source))] },
    });
    return result;
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/marketing-services/campaigns/:id/messages', async (request, reply) => {
    const auth = await requireRole(request, env, pool, STAFF);
    const input = parseOrThrow(
      z.object({ body: z.string().min(1).max(8000), visibility: z.enum(['customer', 'internal']) }),
      request.body
    );
    const message = await addStaffCampaignMessage(pool, auth.userId, request.params.id, input);
    reply.code(201);
    return { message };
  });
}

