/**
 * Admin Cloudflare API (spec §3–§4, §28–§29, §49, §69).
 *
 * All routes require admin/super_admin via the existing DB-verified RBAC. Account tokens are
 * write-only: accepted on create/update, encrypted at rest, and never returned by any endpoint.
 * Every manual override is audited.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { HttpError, NotFoundError, ValidationError } from '../lib/errors';
import { recordAuditBestEffort, requestAuditContext } from '../lib/audit';
import { CloudflareError } from '../integrations/cloudflare/errors';
import { encryptApiToken, resolveCloudflare, testCloudflareConnection } from '../integrations/cloudflare/config';
import { purgeCache } from '../integrations/cloudflare/features';
import { CLOUDFLARE_FEATURE_KEYS } from '../integrations/cloudflare/types';
import {
  deletePlanMapping,
  enqueueCloudflareJob,
  insertCloudflareAccount,
  listCloudflareAccounts,
  listCloudflareApiLogs,
  listCloudflareJobs,
  listCloudflareServicesAdmin,
  listPlanMappings,
  toAccountDTO,
  updateCloudflareAccount,
  upsertPlanMapping,
} from '../db/cloudflare';
import { loadCloudflareServiceForAdmin, queueLifecycleAction } from '../services/cloudflare-service';

const ADMIN_ROLES = ['admin', 'super_admin'] as const;

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  return parsed.data;
}

function rethrowSafe(error: unknown): never {
  if (error instanceof CloudflareError) throw new HttpError(error.statusCode, error.safeMessage, error.code);
  throw error;
}

const idParam = z.object({ id: z.string().uuid() });

const accountBody = z.object({
  accountName: z.string().min(1).max(120),
  cloudflareAccountId: z.string().min(1).max(64),
  apiToken: z.string().min(10).max(500),
  apiBaseUrl: z.string().url().max(255).optional(),
  defaultZoneType: z.enum(['full', 'partial']).optional(),
  defaultSslMode: z.enum(['off', 'flexible', 'full', 'strict']).optional(),
  defaultProxied: z.boolean().optional(),
});

const entitlementsBody = z
  .object(Object.fromEntries(CLOUDFLARE_FEATURE_KEYS.map((k) => [k, z.boolean().optional()])))
  .strict();

export async function registerAdminCloudflareRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // ------------------------------------------------------------------------------ overview ---

  app.get('/api/v1/admin/cloudflare', async (request) => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const { rows } = await pool.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM cloudflare_services WHERE status <> 'terminated') AS total_services,
         (SELECT count(*) FROM cloudflare_services WHERE status = 'active') AS active_services,
         (SELECT count(*) FROM cloudflare_services WHERE status = 'active' AND activation_status = 'active') AS active_zones,
         (SELECT count(*) FROM cloudflare_services WHERE status IN ('pending','provisioning')) AS provisioning,
         (SELECT count(*) FROM cloudflare_services WHERE status = 'suspended') AS suspended,
         (SELECT count(*) FROM cloudflare_services WHERE status IN ('provisioning_failed','sync_failed')) AS failed,
         (SELECT count(*) FROM cloudflare_jobs WHERE status = 'queued') AS jobs_queued,
         (SELECT count(*) FROM cloudflare_jobs WHERE status = 'failed' AND created_at > now() - interval '7 days') AS jobs_failed_7d,
         (SELECT count(*) FROM cloudflare_api_logs WHERE success = false AND created_at > now() - interval '24 hours') AS api_errors_24h,
         (SELECT max(last_synced_at)::text FROM cloudflare_services) AS last_sync,
         (SELECT COALESCE(jsonb_object_agg(x.cur, x.amt), '{}'::jsonb) FROM (
            SELECT i.currency AS cur, sum(i.total_amount)::text AS amt
              FROM invoices i
              JOIN orders o ON o.id = i.order_id
              JOIN order_items oi ON oi.order_id = o.id
              JOIN cloudflare_plan_mappings m ON m.plan_id = oi.plan_id
             WHERE i.status = 'paid' AND i.issued_at >= date_trunc('month', now())
             GROUP BY i.currency) x) AS monthly_revenue`
    );
    const accounts = await listCloudflareAccounts(pool);
    const stats = rows[0] ?? {};
    return {
      stats,
      accounts: accounts.map(toAccountDTO),
      planDistribution: (
        await pool.query<{ cloudflare_plan: string; count: string }>(
          `SELECT cloudflare_plan, count(*)::text FROM cloudflare_services WHERE status <> 'terminated' GROUP BY cloudflare_plan`
        )
      ).rows,
    };
  });

  // ------------------------------------------------------------------------------ accounts ---

  app.get('/api/v1/admin/cloudflare/accounts', async (request) => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const accounts = await listCloudflareAccounts(pool);
    return { accounts: accounts.map(toAccountDTO) };
  });

  app.post('/api/v1/admin/cloudflare/accounts', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const body = parseOrThrow(accountBody, request.body);
    const account = await insertCloudflareAccount(pool, {
      accountName: body.accountName,
      cloudflareAccountId: body.cloudflareAccountId,
      apiBaseUrl: body.apiBaseUrl,
      encryptedApiToken: encryptApiToken(body.apiToken),
      defaultZoneType: body.defaultZoneType,
      defaultSslMode: body.defaultSslMode,
      defaultProxied: body.defaultProxied,
      createdBy: auth.userId,
    });
    await recordAuditBestEffort(
      pool,
      { actorId: auth.userId, action: 'cloudflare.account_created', resourceType: 'cloudflare_account', resourceId: account.id },
      requestAuditContext(request)
    );
    reply.code(201);
    return { account: toAccountDTO(account) };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/cloudflare/accounts/:id', async (request) => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(accountBody.partial().extend({ status: z.enum(['active', 'disabled']).optional() }), request.body);
    const account = await updateCloudflareAccount(pool, id, {
      accountName: body.accountName,
      cloudflareAccountId: body.cloudflareAccountId,
      apiBaseUrl: body.apiBaseUrl,
      encryptedApiToken: body.apiToken ? encryptApiToken(body.apiToken) : undefined,
      status: body.status,
      defaultZoneType: body.defaultZoneType,
      defaultSslMode: body.defaultSslMode,
      defaultProxied: body.defaultProxied,
    });
    if (!account) throw new NotFoundError('No Cloudflare account was found with that id');
    await recordAuditBestEffort(
      pool,
      { actorId: auth.userId, action: 'cloudflare.account_updated', resourceType: 'cloudflare_account', resourceId: id, metadata: { tokenRotated: Boolean(body.apiToken), status: body.status ?? null } },
      requestAuditContext(request)
    );
    return { account: toAccountDTO(account) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/cloudflare/accounts/:id/test', async (request) => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const { id } = parseOrThrow(idParam, request.params);
    const result = await testCloudflareConnection(pool, id);
    await recordAuditBestEffort(
      pool,
      { actorId: auth.userId, action: 'cloudflare.connection_tested', resourceType: 'cloudflare_account', resourceId: id, metadata: { status: result.status } },
      requestAuditContext(request)
    );
    return result;
  });

  // ------------------------------------------------------------------------- plan mappings ---

  /** Catalog plans available for mapping (id/name only — the picker for the Products tab). */
  app.get('/api/v1/admin/cloudflare/available-plans', async (request) => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const { rows } = await pool.query<{ id: string; name: string; product_name: string | null; status: string }>(
      `SELECT pl.id, pl.name, p.name AS product_name, pl.status
         FROM product_plans pl LEFT JOIN products p ON p.id = pl.product_id
        ORDER BY p.name NULLS LAST, pl.name`
    );
    return { plans: rows };
  });

  app.get('/api/v1/admin/cloudflare/plan-mappings', async (request) => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    return { mappings: await listPlanMappings(pool), featureKeys: CLOUDFLARE_FEATURE_KEYS };
  });

  app.put('/api/v1/admin/cloudflare/plan-mappings', async (request) => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const body = parseOrThrow(
      z.object({
        planId: z.string().uuid(),
        cloudflarePlan: z.enum(['free', 'pro', 'business', 'enterprise']),
        entitlements: entitlementsBody.default({}),
        maxDomains: z.number().int().min(1).max(100).optional(),
        provisioningMode: z.enum(['automatic', 'manual']).optional(),
        defaultSslMode: z.enum(['off', 'flexible', 'full', 'strict']).nullable().optional(),
        defaultProxied: z.boolean().nullable().optional(),
      }),
      request.body
    );
    const plan = await pool.query<{ id: string }>(`SELECT id FROM product_plans WHERE id = $1`, [body.planId]);
    if (!plan.rows[0]) throw new NotFoundError('No product plan was found with that id');
    const mapping = await upsertPlanMapping(pool, {
      planId: body.planId,
      cloudflarePlan: body.cloudflarePlan,
      entitlements: Object.fromEntries(Object.entries(body.entitlements ?? {}).filter(([, v]) => v !== undefined)) as Record<string, boolean>,
      maxDomains: body.maxDomains,
      provisioningMode: body.provisioningMode,
      defaultSslMode: body.defaultSslMode,
      defaultProxied: body.defaultProxied,
      createdBy: auth.userId,
    });
    await recordAuditBestEffort(
      pool,
      { actorId: auth.userId, action: 'cloudflare.plan_mapping_saved', resourceType: 'cloudflare_plan_mapping', resourceId: mapping.id, metadata: { planId: body.planId, cloudflarePlan: body.cloudflarePlan } },
      requestAuditContext(request)
    );
    return { mapping };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/cloudflare/plan-mappings/:id', async (request) => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const { id } = parseOrThrow(idParam, request.params);
    const deleted = await deletePlanMapping(pool, id);
    if (!deleted) throw new NotFoundError('No plan mapping was found with that id');
    await recordAuditBestEffort(
      pool,
      { actorId: auth.userId, action: 'cloudflare.plan_mapping_deleted', resourceType: 'cloudflare_plan_mapping', resourceId: id },
      requestAuditContext(request)
    );
    return { deleted: true };
  });

  // ------------------------------------------------------------------------------ services ---

  app.get('/api/v1/admin/cloudflare/services', async (request) => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const query = parseOrThrow(
      z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        status: z.string().max(24).optional(),
        search: z.string().max(120).optional(),
      }),
      request.query
    );
    return listCloudflareServicesAdmin(pool, query);
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/cloudflare/services/:id', async (request) => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const { id } = parseOrThrow(idParam, request.params);
    const { service, entitlements } = await loadCloudflareServiceForAdmin(pool, id);
    const jobs = await listCloudflareJobs(pool, { serviceId: id, limit: 20 });
    return { service, entitlements, jobs: jobs.items };
  });

  /** Manual overrides — each queues the durable job and is audited (spec §69). */
  for (const action of ['provision', 'sync', 'suspend', 'unsuspend', 'terminate'] as const) {
    app.post<{ Params: { id: string } }>(`/api/v1/admin/cloudflare/services/:id/${action}`, async (request, reply) => {
      const auth = await requireRole(request, env, pool, ADMIN_ROLES);
      const { id } = parseOrThrow(idParam, request.params);
      const { service } = await loadCloudflareServiceForAdmin(pool, id);
      const audit = requestAuditContext(request);

      if (action === 'provision') {
        if (!['pending', 'provisioning_failed', 'provisioning'].includes(service.status)) {
          throw new ValidationError(`Cannot re-provision a service in '${service.status}' status`);
        }
        await enqueueCloudflareJob(pool, {
          serviceId: service.id,
          jobType: 'provision_zone',
          idempotencyKey: `cf-admin-provision:${service.id}:${new Date().toISOString().slice(0, 16)}`,
        });
        await recordAuditBestEffort(
          pool,
          { actorId: auth.userId, action: 'cloudflare.provision_retried', resourceType: 'cloudflare_service', resourceId: service.id },
          audit
        );
      } else if (action === 'sync') {
        if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
        await enqueueCloudflareJob(pool, {
          serviceId: service.id,
          jobType: 'sync_zone',
          idempotencyKey: `cf-admin-sync:${service.id}:${new Date().toISOString().slice(0, 16)}`,
          maxAttempts: 3,
        });
        await recordAuditBestEffort(
          pool,
          { actorId: auth.userId, action: 'cloudflare.sync_requested', resourceType: 'cloudflare_service', resourceId: service.id },
          audit
        );
      } else {
        await queueLifecycleAction(pool, service, action, auth.userId, audit);
      }
      reply.code(202);
      return { queued: true };
    });
  }

  app.post<{ Params: { id: string } }>('/api/v1/admin/cloudflare/services/:id/purge-cache', async (request) => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const { id } = parseOrThrow(idParam, request.params);
    const { service } = await loadCloudflareServiceForAdmin(pool, id);
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      await purgeCache(client, service.zone_id, { everything: true });
      await recordAuditBestEffort(
        pool,
        { actorId: auth.userId, action: 'cloudflare.cache_purged_admin', resourceType: 'cloudflare_service', resourceId: service.id },
        requestAuditContext(request)
      );
      return { purged: true };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  // ---------------------------------------------------------------------------- jobs & logs ---

  app.get('/api/v1/admin/cloudflare/jobs', async (request) => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const query = parseOrThrow(
      z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
        status: z.enum(['queued', 'running', 'succeeded', 'failed']).optional(),
        serviceId: z.string().uuid().optional(),
      }),
      request.query
    );
    return listCloudflareJobs(pool, query);
  });

  app.get('/api/v1/admin/cloudflare/logs', async (request) => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const query = parseOrThrow(
      z.object({
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
        serviceId: z.string().uuid().optional(),
        success: z.coerce.boolean().optional(),
      }),
      request.query
    );
    return listCloudflareApiLogs(pool, query);
  });
}
