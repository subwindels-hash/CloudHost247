/**
 * Customer Cloudflare API (spec §12–§27, §46, §48, §71).
 *
 * Every endpoint: authenticate → load the service by OUR id → verify the caller owns it →
 * verify service state → verify the plan entitlement → only then talk to Cloudflare using the
 * zone id WE stored. Zone/record identifiers supplied by the browser are only ever used to
 * select rows already scoped to the caller's service — never passed through unverified.
 * CloudflareError is mapped to safe HTTP responses (never raw upstream payloads/secrets).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isIP } from 'node:net';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { HttpError, NotFoundError, ValidationError } from '../lib/errors';
import { recordAuditBestEffort, requestAuditContext } from '../lib/audit';
import { CloudflareError } from '../integrations/cloudflare/errors';
import { resolveCloudflare } from '../integrations/cloudflare/config';
import {
  createDnsRecord,
  deleteDnsRecord,
  updateDnsRecord,
  SUPPORTED_DNS_TYPES,
} from '../integrations/cloudflare/dns';
import {
  ACCESS_RULE_MODES,
  CACHE_SETTING_IDS,
  SCRAPE_SHIELD_SETTING_IDS,
  SECURITY_SETTING_IDS,
  SPEED_SETTING_IDS,
  SSL_SETTING_IDS,
  createAccessRule,
  deleteAccessRule,
  getDnssec,
  listAccessRules,
  purgeCache,
  readSettings,
  setDnssec,
  setZoneSetting,
  updateAccessRule,
} from '../integrations/cloudflare/features';
import { getZoneAnalytics } from '../integrations/cloudflare/analytics';
import { capabilitiesForPlan } from '../integrations/cloudflare/types';
import {
  authorizeCloudflareService,
  createCloudflareOrder,
  requestPlanChange,
  resolveEntitlements,
} from '../services/cloudflare-service';
import {
  deleteCachedDnsRecord,
  enqueueCloudflareJob,
  findCachedDnsRecord,
  listCachedDnsRecords,
  listCloudflareServicesForUser,
  listPlanMappings,
  upsertCachedDnsRecord,
} from '../db/cloudflare';
import { listPublishedPricingForPlan } from '../db/catalog-pricing';

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  return parsed.data;
}

/** Converts provider errors into safe platform HTTP errors (spec §35). */
function rethrowSafe(error: unknown): never {
  if (error instanceof CloudflareError) {
    throw new HttpError(error.statusCode, error.code === 'CLOUDFLARE_VALIDATION_ERROR' ? error.message : error.safeMessage, error.code);
  }
  throw error;
}

const idParam = z.object({ id: z.string().uuid() });
const recordIdParam = z.object({ id: z.string().uuid(), recordId: z.string().min(1).max(64) });
const ruleIdParam = z.object({ id: z.string().uuid(), ruleId: z.string().min(1).max(64) });

const dnsRecordBody = z.object({
  type: z.enum(SUPPORTED_DNS_TYPES),
  name: z.string().min(1).max(255),
  content: z.string().min(1).max(2048),
  ttl: z.number().int().refine((v) => v === 1 || (v >= 60 && v <= 86400), 'ttl must be 1 (auto) or 60–86400'),
  proxied: z.boolean().optional(),
  priority: z.number().int().min(0).max(65535).optional(),
  comment: z.string().max(500).nullable().optional(),
});

const CIDR_RE = /^([0-9a-fA-F:.]+)\/(\d{1,3})$/;

function validateIpOrCidr(value: string): 'ip' | 'ip_range' {
  if (isIP(value)) return 'ip';
  const match = CIDR_RE.exec(value);
  if (match && match[1] && isIP(match[1])) {
    const prefix = Number(match[2]);
    const max = isIP(match[1]) === 6 ? 128 : 32;
    if (prefix >= 0 && prefix <= max) return 'ip_range';
  }
  throw new ValidationError('A valid IP address or CIDR range is required');
}

export async function registerCloudflareRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // -------------------------------------------------------------------- catalog & purchase ---

  /** Cloudflare-mapped plans with published pricing — the purchase/upgrade picker. */
  app.get('/api/v1/cloudflare/catalog', async (request) => {
    await authenticate(request, env, pool);
    const mappings = await listPlanMappings(pool);
    const plans = [];
    for (const mapping of mappings.filter((m) => m.plan_status === 'active')) {
      const pricing = await listPublishedPricingForPlan(pool, mapping.plan_id);
      plans.push({
        planId: mapping.plan_id,
        planName: mapping.plan_name,
        productName: mapping.product_name,
        cloudflarePlan: mapping.cloudflare_plan,
        entitlements: resolveEntitlements(mapping, mapping.cloudflare_plan),
        pricing: pricing
          .filter((p) => p.amount !== null)
          .map((p) => ({ billingPeriod: p.billing_period, amount: p.amount, currency: p.currency })),
      });
    }
    return { plans };
  });

  app.post('/api/v1/cloudflare/orders', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const body = parseOrThrow(
      z
        .object({
          planId: z.string().uuid(),
          billingPeriod: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']),
          domainName: z.string().min(3).max(253).optional(),
          customerDomainId: z.string().uuid().optional(),
          hostingServiceId: z.string().uuid().optional(),
        })
        .refine((v) => v.domainName || v.customerDomainId, 'Provide a domainName or customerDomainId'),
      request.body
    );
    const { order, invoice } = await createCloudflareOrder(pool, auth.userId, body);
    await recordAuditBestEffort(
      pool,
      { actorId: auth.userId, action: 'cloudflare.order_created', resourceType: 'order', resourceId: order.id },
      requestAuditContext(request)
    );
    reply.code(201);
    return {
      order: { id: order.id, orderNumber: order.order_number, totalAmount: order.total_amount, currency: order.currency },
      invoice: { id: invoice.id, invoiceNumber: invoice.invoice_number },
      message: 'Order created. The Cloudflare service will be provisioned automatically after payment is confirmed.',
    };
  });

  // ------------------------------------------------------------------------------ services ---

  app.get('/api/v1/cloudflare/services', async (request) => {
    const auth = await authenticate(request, env, pool);
    const services = await listCloudflareServicesForUser(pool, auth.userId);
    return { services };
  });

  app.get<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const { service, entitlements } = await authorizeCloudflareService(pool, auth.userId, id, null);
    return {
      service,
      entitlements,
      capabilities: capabilitiesForPlan(service.cloudflare_plan),
      nameservers: [service.name_server_1, service.name_server_2].filter(Boolean),
      nameserverNotice:
        'Your domain must use these nameservers before Cloudflare can serve DNS traffic. Activation is confirmed by Cloudflare, not by this panel.',
    };
  });

  /** Manual re-sync: queues the durable sync job — never a blocking provider call here. */
  app.post<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/sync', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, null);
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const job = await enqueueCloudflareJob(pool, {
      serviceId: service.id,
      jobType: 'sync_zone',
      idempotencyKey: `cf-manual-sync:${service.id}:${new Date().toISOString().slice(0, 16)}`,
      maxAttempts: 3,
    });
    reply.code(job ? 202 : 200);
    return { queued: Boolean(job), message: job ? 'Synchronization queued' : 'A synchronization was already queued in the last minute' };
  });

  app.get<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/activity', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await authorizeCloudflareService(pool, auth.userId, id, null);
    const { rows } = await pool.query(
      `SELECT action, created_at, metadata FROM audit_logs
        WHERE resource_type IN ('cloudflare_service', 'cloudflare_dns') AND resource_id = $1
        ORDER BY created_at DESC LIMIT 100`,
      [id]
    );
    return { activity: rows };
  });

  // ----------------------------------------------------------------------------------- DNS ---

  app.get<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/dns', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'dns');
    const records = await listCachedDnsRecords(pool, service.id);
    return { records, note: 'Records are a synchronized view; Cloudflare is the source of truth. Use Sync to refresh.' };
  });

  app.post<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/dns', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(dnsRecordBody, request.body);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'dns');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      const record = await createDnsRecord(client, service.zone_id, body);
      const cached = await upsertCachedDnsRecord(pool, {
        serviceId: service.id,
        cloudflareRecordId: record.id,
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: record.ttl,
        proxied: record.proxied ?? false,
        priority: record.priority ?? null,
        comment: record.comment ?? null,
        ownership: 'CUSTOMER_MANAGED',
      });
      await recordAuditBestEffort(
        pool,
        {
          actorId: auth.userId,
          action: 'cloudflare.dns_record_created',
          resourceType: 'cloudflare_dns',
          resourceId: service.id,
          metadata: { recordId: record.id, type: record.type, name: record.name },
        },
        requestAuditContext(request)
      );
      reply.code(201);
      return { record: cached };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  app.patch<{ Params: { id: string; recordId: string } }>('/api/v1/cloudflare/services/:id/dns/:recordId', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id, recordId } = parseOrThrow(recordIdParam, request.params);
    const body = parseOrThrow(dnsRecordBody.partial(), request.body);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'dns');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    // The record must already belong to THIS service's zone cache — a foreign record id 404s.
    const cached = await findCachedDnsRecord(pool, service.id, recordId);
    if (!cached) throw new NotFoundError('No DNS record was found with that id');
    if (cached.ownership === 'SYSTEM_MANAGED') {
      throw new ValidationError('This record is managed by CloudHost247 hosting automation and cannot be edited here');
    }
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      const updated = await updateDnsRecord(client, service.zone_id, cached.cloudflare_record_id, body);
      const refreshed = await upsertCachedDnsRecord(pool, {
        serviceId: service.id,
        cloudflareRecordId: updated.id,
        type: updated.type,
        name: updated.name,
        content: updated.content,
        ttl: updated.ttl,
        proxied: updated.proxied ?? false,
        priority: updated.priority ?? null,
        comment: updated.comment ?? null,
        ownership: cached.ownership,
      });
      await recordAuditBestEffort(
        pool,
        { actorId: auth.userId, action: 'cloudflare.dns_record_updated', resourceType: 'cloudflare_dns', resourceId: service.id, metadata: { recordId: updated.id } },
        requestAuditContext(request)
      );
      return { record: refreshed };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  app.delete<{ Params: { id: string; recordId: string } }>('/api/v1/cloudflare/services/:id/dns/:recordId', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id, recordId } = parseOrThrow(recordIdParam, request.params);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'dns');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    const cached = await findCachedDnsRecord(pool, service.id, recordId);
    if (!cached) throw new NotFoundError('No DNS record was found with that id');
    if (cached.ownership === 'SYSTEM_MANAGED') {
      throw new ValidationError('This record is managed by CloudHost247 hosting automation and cannot be deleted here');
    }
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      await deleteDnsRecord(client, service.zone_id, cached.cloudflare_record_id);
      await deleteCachedDnsRecord(pool, service.id, cached.cloudflare_record_id);
      await recordAuditBestEffort(
        pool,
        { actorId: auth.userId, action: 'cloudflare.dns_record_deleted', resourceType: 'cloudflare_dns', resourceId: service.id, metadata: { recordId: cached.cloudflare_record_id, type: cached.type, name: cached.name } },
        requestAuditContext(request)
      );
      return { deleted: true };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  // -------------------------------------------------------------------------------- DNSSEC ---

  app.get<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/dnssec', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'dnssec');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      return { dnssec: await getDnssec(client, service.zone_id) };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  for (const action of ['enable', 'disable'] as const) {
    app.post<{ Params: { id: string } }>(`/api/v1/cloudflare/services/:id/dnssec/${action}`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const { id } = parseOrThrow(idParam, request.params);
      const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'dnssec');
      if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
      try {
        const { client } = await resolveCloudflare(pool, { serviceId: service.id });
        const dnssec = await setDnssec(client, service.zone_id, action === 'enable');
        await recordAuditBestEffort(
          pool,
          { actorId: auth.userId, action: `cloudflare.dnssec_${action}d`, resourceType: 'cloudflare_service', resourceId: service.id },
          requestAuditContext(request)
        );
        return { dnssec };
      } catch (error) {
        rethrowSafe(error);
      }
    });
  }

  // ------------------------------------------------------------------------------ analytics ---

  app.get<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/analytics', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const query = parseOrThrow(z.object({ range: z.coerce.number().int().min(1).max(30).default(7) }), request.query);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'analytics');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      const analytics = await getZoneAnalytics(client, service.zone_id, query.range ?? 7);
      const unavailable = analytics.totals.requests === null;
      return { analytics, dataStatus: unavailable ? 'DATA_UNAVAILABLE' : 'OK' };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  // ------------------------------------------------------ settings-backed feature sections ---

  interface SettingsSection {
    tab: string;
    feature: 'ssl' | 'firewall' | 'speed' | 'caching' | 'scrape_shield';
    settingIds: string[];
    /** Which settings PATCH may write, with validation. */
    patchSchema: z.ZodType<Record<string, unknown>>;
  }

  const sections: SettingsSection[] = [
    {
      tab: 'ssl',
      feature: 'ssl',
      settingIds: SSL_SETTING_IDS,
      patchSchema: z
        .object({
          ssl: z.enum(['off', 'flexible', 'full', 'strict']).optional(),
          min_tls_version: z.enum(['1.0', '1.1', '1.2', '1.3']).optional(),
          tls_1_3: z.enum(['on', 'off']).optional(),
          always_use_https: z.enum(['on', 'off']).optional(),
          automatic_https_rewrites: z.enum(['on', 'off']).optional(),
        })
        .strict(),
    },
    {
      tab: 'firewall',
      feature: 'firewall',
      settingIds: SECURITY_SETTING_IDS,
      patchSchema: z
        .object({
          security_level: z.enum(['essentially_off', 'low', 'medium', 'high', 'under_attack']).optional(),
          browser_check: z.enum(['on', 'off']).optional(),
          challenge_ttl: z.number().int().min(300).max(31536000).optional(),
        })
        .strict(),
    },
    {
      tab: 'speed',
      feature: 'speed',
      settingIds: SPEED_SETTING_IDS,
      patchSchema: z
        .object({
          rocket_loader: z.enum(['on', 'off']).optional(),
          brotli: z.enum(['on', 'off']).optional(),
          http3: z.enum(['on', 'off']).optional(),
          early_hints: z.enum(['on', 'off']).optional(),
          ip_geolocation: z.enum(['on', 'off']).optional(),
        })
        .strict(),
    },
    {
      tab: 'caching',
      feature: 'caching',
      settingIds: CACHE_SETTING_IDS,
      patchSchema: z
        .object({
          cache_level: z.enum(['aggressive', 'basic', 'simplified']).optional(),
          browser_cache_ttl: z.number().int().min(0).max(31536000).optional(),
          development_mode: z.enum(['on', 'off']).optional(),
        })
        .strict(),
    },
    {
      tab: 'scrape-shield',
      feature: 'scrape_shield',
      settingIds: SCRAPE_SHIELD_SETTING_IDS,
      patchSchema: z
        .object({
          email_obfuscation: z.enum(['on', 'off']).optional(),
          server_side_exclude: z.enum(['on', 'off']).optional(),
          hotlink_protection: z.enum(['on', 'off']).optional(),
        })
        .strict(),
    },
  ];

  for (const section of sections) {
    app.get<{ Params: { id: string } }>(`/api/v1/cloudflare/services/:id/${section.tab}`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const { id } = parseOrThrow(idParam, request.params);
      const { service } = await authorizeCloudflareService(pool, auth.userId, id, section.feature);
      if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
      try {
        const { client } = await resolveCloudflare(pool, { serviceId: service.id });
        const settings = await readSettings(client, service.zone_id, section.settingIds);
        if (section.tab === 'firewall') {
          const rules = await listAccessRules(client, service.zone_id);
          return { settings, rules, modes: ACCESS_RULE_MODES };
        }
        return { settings };
      } catch (error) {
        rethrowSafe(error);
      }
    });

    app.patch<{ Params: { id: string } }>(`/api/v1/cloudflare/services/:id/${section.tab}`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const { id } = parseOrThrow(idParam, request.params);
      const body = parseOrThrow(section.patchSchema, request.body);
      const entries = Object.entries(body).filter(([, v]) => v !== undefined);
      if (entries.length === 0) throw new ValidationError('No settings supplied');
      const { service } = await authorizeCloudflareService(pool, auth.userId, id, section.feature);
      if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
      try {
        const { client } = await resolveCloudflare(pool, { serviceId: service.id });
        const applied: Record<string, unknown> = {};
        for (const [settingId, value] of entries) {
          const result = await setZoneSetting(client, service.zone_id, settingId, value);
          applied[settingId] = result.value;
        }
        if (section.tab === 'ssl' && typeof body['ssl'] === 'string') {
          await pool.query(`UPDATE cloudflare_services SET ssl_mode = $2, updated_at = now() WHERE id = $1`, [service.id, body['ssl']]);
        }
        if (section.tab === 'caching' && typeof body['development_mode'] === 'string') {
          await pool.query(
            `UPDATE cloudflare_services SET development_mode_until = $2, updated_at = now() WHERE id = $1`,
            [service.id, body['development_mode'] === 'on' ? new Date(Date.now() + 3 * 3600_000) : null]
          );
        }
        await recordAuditBestEffort(
          pool,
          { actorId: auth.userId, action: `cloudflare.${section.feature}_updated`, resourceType: 'cloudflare_service', resourceId: service.id, metadata: { settings: Object.keys(applied) } },
          requestAuditContext(request)
        );
        return { settings: applied };
      } catch (error) {
        rethrowSafe(error);
      }
    });
  }

  // ------------------------------------------------------------------------- firewall rules ---

  app.post<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/firewall/rules', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(
      z.object({ value: z.string().min(1).max(64), mode: z.enum(ACCESS_RULE_MODES), notes: z.string().max(500).optional() }),
      request.body
    );
    const target = validateIpOrCidr(body.value);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'firewall');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      const rule = await createAccessRule(client, service.zone_id, { target, value: body.value, mode: body.mode, notes: body.notes });
      await recordAuditBestEffort(
        pool,
        { actorId: auth.userId, action: 'cloudflare.firewall_rule_created', resourceType: 'cloudflare_service', resourceId: service.id, metadata: { ruleId: rule.id, mode: body.mode, value: body.value } },
        requestAuditContext(request)
      );
      reply.code(201);
      return { rule };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  app.patch<{ Params: { id: string; ruleId: string } }>('/api/v1/cloudflare/services/:id/firewall/rules/:ruleId', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id, ruleId } = parseOrThrow(ruleIdParam, request.params);
    const body = parseOrThrow(z.object({ mode: z.enum(ACCESS_RULE_MODES).optional(), notes: z.string().max(500).optional() }), request.body);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'firewall');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      // Rule must exist inside THIS zone — listing scopes the id to the caller's zone.
      const rules = await listAccessRules(client, service.zone_id);
      if (!rules.some((r) => r.id === ruleId)) throw new NotFoundError('No firewall rule was found with that id');
      const rule = await updateAccessRule(client, service.zone_id, ruleId, body);
      await recordAuditBestEffort(
        pool,
        { actorId: auth.userId, action: 'cloudflare.firewall_rule_updated', resourceType: 'cloudflare_service', resourceId: service.id, metadata: { ruleId } },
        requestAuditContext(request)
      );
      return { rule };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  app.delete<{ Params: { id: string; ruleId: string } }>('/api/v1/cloudflare/services/:id/firewall/rules/:ruleId', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id, ruleId } = parseOrThrow(ruleIdParam, request.params);
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'firewall');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      const rules = await listAccessRules(client, service.zone_id);
      if (!rules.some((r) => r.id === ruleId)) throw new NotFoundError('No firewall rule was found with that id');
      await deleteAccessRule(client, service.zone_id, ruleId);
      await recordAuditBestEffort(
        pool,
        { actorId: auth.userId, action: 'cloudflare.firewall_rule_deleted', resourceType: 'cloudflare_service', resourceId: service.id, metadata: { ruleId } },
        requestAuditContext(request)
      );
      return { deleted: true };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  // ---------------------------------------------------------------------------- cache purge ---

  app.post<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/caching/purge', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(
      z
        .object({ everything: z.boolean().optional(), files: z.array(z.string().url().max(2048)).max(30).optional() })
        .refine((v) => v.everything === true || (v.files && v.files.length > 0), 'Choose purge everything or provide URLs'),
      request.body
    );
    const { service } = await authorizeCloudflareService(pool, auth.userId, id, 'cache_purge');
    if (!service.zone_id) throw new ValidationError('This service has no Cloudflare zone yet');
    if (body.files) {
      for (const url of body.files) {
        const host = new URL(url).hostname.toLowerCase();
        if (host !== service.zone_name && !host.endsWith(`.${service.zone_name}`)) {
          throw new ValidationError(`URL host ${host} does not belong to ${service.zone_name}`);
        }
      }
    }
    try {
      const { client } = await resolveCloudflare(pool, { serviceId: service.id });
      await purgeCache(client, service.zone_id, { everything: body.everything, files: body.files });
      await recordAuditBestEffort(
        pool,
        { actorId: auth.userId, action: 'cloudflare.cache_purged', resourceType: 'cloudflare_service', resourceId: service.id, metadata: { everything: body.everything ?? false, files: body.files?.length ?? 0 } },
        requestAuditContext(request)
      );
      return { purged: true };
    } catch (error) {
      rethrowSafe(error);
    }
  });

  // ----------------------------------------------------------------------------------- plan ---

  app.get<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/plan', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const { service, entitlements } = await authorizeCloudflareService(pool, auth.userId, id, null);
    const mappings = await listPlanMappings(pool);
    const options = [];
    for (const mapping of mappings.filter((m) => m.plan_status === 'active' && m.plan_id !== service.plan_id)) {
      const pricing = await listPublishedPricingForPlan(pool, mapping.plan_id);
      options.push({
        planId: mapping.plan_id,
        planName: mapping.plan_name,
        cloudflarePlan: mapping.cloudflare_plan,
        pricing: pricing.filter((p) => p.amount !== null).map((p) => ({ billingPeriod: p.billing_period, amount: p.amount, currency: p.currency })),
      });
    }
    return {
      current: { planId: service.plan_id, planName: service.plan_name, cloudflarePlan: service.cloudflare_plan },
      planChangeAllowed: entitlements.plan_change && service.status === 'active',
      options,
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/cloudflare/services/:id/plan/change', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(
      z.object({
        newPlanId: z.string().uuid(),
        billingPeriod: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']),
      }),
      request.body
    );
    const result = await requestPlanChange(pool, auth.userId, id, body.newPlanId, body.billingPeriod);
    await recordAuditBestEffort(
      pool,
      { actorId: auth.userId, action: 'cloudflare.plan_change_requested', resourceType: 'cloudflare_service', resourceId: id, metadata: { newPlanId: body.newPlanId, mode: result.mode } },
      requestAuditContext(request)
    );
    reply.code(202);
    return {
      ...result,
      message:
        result.mode === 'invoice'
          ? 'An invoice has been issued for the plan change. The Cloudflare plan updates automatically once payment is confirmed.'
          : 'The plan change has been queued and will be applied shortly.',
    };
  });
}
