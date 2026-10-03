/**
 * Tools Center — Super Admin control centre (`/api/admin/tools/*`, mirrored at `/api/v1/...`).
 *
 * Everything here is gated by `requireRole(['admin','super_admin'])` against the *current* database
 * role, not the JWT claim. The module exposes:
 *   • overview      metrics, provider/resolver health, abuse summary, implementation coverage
 *   • tools         per-tool overrides (enable/disable, maintenance, visibility, rate profile…)
 *   • providers     the external-API registry, including encrypted credential storage and a real
 *                   connection test
 *   • resolvers     the DNS resolver registry used by every DNS/IP tool
 *   • operations    cache invalidation, a manual worker sweep, health-check history
 *
 * A secret is never returned: `ProviderView` reports only whether one is stored. Sending
 * `apiKey: null` clears it, omitting the field leaves it untouched.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { ValidationError, NotFoundError } from '../lib/errors';
import { ToolError } from '../tools/core/errors';
import { requireRole } from '../lib/require-role';
import { auditRequest } from '../lib/audit';
import { toolMetrics, listEffectiveTools, upsertToolOverride, resetToolOverride } from '../tools/core/registry';
import { listProviders, toProviderView, saveProvider, deleteProvider, testProviderConnection, providerHealthSummary } from '../tools/core/providers';
import { listResolvers, findResolver, createResolver, updateResolver, deleteResolver, checkResolverHealth } from '../tools/core/resolvers';
import { MissingEncryptionKeyError } from '../lib/crypto';
import { invalidateToolCache } from '../tools/core/cache';
import { abuseSummary } from '../tools/core/rate-limit';
import { providerHealthSweep, resolverHealthSweep, monitorSweep, runToolsSweep } from '../tools/worker/sweep';
import { missingHandlers } from '../tools/handlers';
import { capabilityReport, resetCapabilityCache } from '../tools/core/capabilities';
import { CATEGORY_LABELS } from '../tools/catalog';

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '));
  return result.data;
}

const overrideSchema = z.object({
  name: z.string().min(1).max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().nullable().optional(),
  visibility: z.enum(['public', 'customer', 'admin']).nullable().optional(),
  statusOverride: z.enum(['ACTIVE', 'DISABLED', 'MAINTENANCE', 'CONFIGURATION_REQUIRED', 'SERVICE_UNAVAILABLE']).nullable().optional(),
  maintenanceMessage: z.string().max(500).nullable().optional(),
  providerSlug: z.string().max(80).nullable().optional(),
  rateLimitProfile: z.enum(['light', 'standard', 'heavy', 'restricted']).nullable().optional(),
  timeoutMs: z.number().int().min(500).max(60_000).nullable().optional(),
  cacheSeconds: z.number().int().min(0).max(604_800).nullable().optional(),
  loggingEnabled: z.boolean().nullable().optional(),
  featureFlags: z.record(z.unknown()).optional(),
  abuseThresholds: z.record(z.unknown()).optional(),
});

const providerSchema = z.object({
  slug: z.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, 'Provider slugs are lowercase letters, digits and dashes.'),
  name: z.string().min(1).max(120).optional(),
  kind: z.enum(['DNSBL', 'GEOLOCATION', 'RDAP', 'WHOIS', 'BLACKLIST_API', 'DKIM_VERIFY', 'BIN', 'OCR', 'REVERSE_IP', 'AVAILABILITY', 'SERP', 'AI', 'OBJECT_STORAGE', 'SPEED_TEST', 'OTHER']).optional(),
  description: z.string().max(2000).optional(),
  endpoint: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  needsCredentials: z.boolean().optional(),
  apiKey: z.string().max(2000).nullable().optional(),
  apiSecret: z.string().max(4000).nullable().optional(),
  configuration: z.record(z.unknown()).optional(),
  timeoutMs: z.number().int().min(250).max(60_000).optional(),
  rateLimitPerMinute: z.number().int().min(0).max(100_000).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  quotaNote: z.string().max(500).nullable().optional(),
});

const resolverSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  provider: z.string().min(1).max(120).optional(),
  ipAddress: z.string().min(2).max(60).optional(),
  protocol: z.enum(['UDP', 'TCP', 'DOT', 'DOH']).optional(),
  version: z.enum(['IPv4', 'IPv6']).optional(),
  endpoint: z.string().max(300).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  countryCode: z.string().max(8).nullable().optional(),
  region: z.string().max(80).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  anycast: z.boolean().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
});

export async function registerAdminToolsRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable): Promise<void> {
  const pool = overridePool ?? getPool(env);

  const registerHandlers = (prefix: string): void => {
    const admin = `${prefix}/admin/tools`;

    // --- Overview -------------------------------------------------------------------------------

    app.get(`${admin}/overview`, async (request) => {
      await requireRole(request, env, pool, ['admin', 'super_admin']);
      const [metrics, providers, resolvers, abuse, { tools, masterEnabled, anonymousAccess }] = await Promise.all([
        toolMetrics(pool, 14),
        providerHealthSummary(pool),
        listResolvers(pool),
        abuseSummary(pool, 1440),
        listEffectiveTools(pool),
      ]);
      return {
        success: true,
        generatedAt: new Date().toISOString(),
        masterEnabled,
        anonymousAccess,
        metrics,
        catalog: {
          total: tools.length,
          byStatus: tools.reduce<Record<string, number>>((accumulator, tool) => {
            accumulator[tool.status] = (accumulator[tool.status] ?? 0) + 1;
            return accumulator;
          }, {}),
          byCategory: Object.entries(CATEGORY_LABELS).map(([slug, label]) => ({ slug, label, count: tools.filter((tool) => tool.category === slug).length })),
          customised: tools.filter((tool) => tool.hasOverride).length,
          missingImplementations: missingHandlers(),
        },
        providers,
        resolvers: resolvers.map((resolver) => ({
          id: resolver.id,
          name: resolver.name,
          protocol: resolver.protocol,
          ipAddress: resolver.ip_address,
          endpoint: resolver.endpoint,
          enabled: resolver.enabled,
          healthStatus: resolver.health_status,
          lastCheckedAt: resolver.last_checked_at,
          latencyMs: resolver.last_latency_ms,
        })),
        abuse,
      };
    });

    // --- Tool overrides --------------------------------------------------------------------------

    app.get(`${admin}/tools`, async (request) => {
      await requireRole(request, env, pool, ['admin', 'super_admin']);
      const { tools } = await listEffectiveTools(pool);
      return { success: true, count: tools.length, tools };
    });

    app.patch(`${admin}/tools/:slug`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const slug = (request.params as { slug?: string }).slug ?? '';
      const input = parseOrThrow(overrideSchema, request.body ?? {});
      const row = await upsertToolOverride(pool, {
        slug,
        actorUserId: auth.userId,
        ...input,
      });
      await auditRequest(pool, request, auth.userId, {
        action: 'TOOL_OVERRIDE_UPDATED',
        resourceType: 'tool_definition_override',
        resourceId: row.id,
        metadata: { slug, keys: Object.keys(input) },
      });
      return { success: true, override: row };
    });

    app.delete(`${admin}/tools/:slug/override`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const slug = (request.params as { slug?: string }).slug ?? '';
      const removed = await resetToolOverride(pool, slug);
      if (!removed) throw new NotFoundError('That tool has no override to reset.');
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_OVERRIDE_RESET', resourceType: 'tool_definition_override', resourceId: slug });
      return { success: true, reset: true };
    });

    // --- Providers ---------------------------------------------------------------------------------

    app.get(`${admin}/providers`, async (request) => {
      await requireRole(request, env, pool, ['admin', 'super_admin']);
      const rows = await listProviders(pool);
      return { success: true, providers: rows.map(toProviderView) };
    });

    app.put(`${admin}/providers/:slug`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const slug = (request.params as { slug?: string }).slug ?? '';
      const input = parseOrThrow(providerSchema, { ...(request.body as Record<string, unknown>), slug });
      let row;
      try {
        row = await saveProvider(pool, { ...input, actorUserId: auth.userId });
      } catch (error) {
        if (error instanceof MissingEncryptionKeyError) {
          // Credentials are only ever stored encrypted. Without a key ring the write must fail with
          // an actionable message rather than silently keeping a plaintext secret.
          throw new ToolError(
            'CONFIGURATION_REQUIRED',
            'Provider credentials cannot be stored because this deployment has no encryption key configured. Set CREDENTIAL_ENCRYPTION_KEY (32 bytes, hex or base64) in the environment, then save the provider again.'
          );
        }
        throw error;
      }
      await auditRequest(pool, request, auth.userId, {
        action: 'TOOL_PROVIDER_SAVED',
        resourceType: 'tool_provider',
        resourceId: row.slug,
        metadata: { kind: row.kind, enabled: row.enabled, credentialsChanged: input.apiKey !== undefined || input.apiSecret !== undefined },
      });
      return { success: true, provider: toProviderView(row) };
    });

    app.post(`${admin}/providers/:slug/test`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const slug = (request.params as { slug?: string }).slug ?? '';
      const result = await testProviderConnection(pool, slug, {
        dnsQuery: async (name, type, timeoutMs) => {
          const { queryType } = await import('../tools/dns/common');
          const resolver = (await listResolvers(pool, { enabledOnly: true }))[0];
          if (!resolver) return { ok: false, message: 'No resolver is configured to probe with.', durationMs: 0 };
          const started = Date.now();
          try {
            const answer = await queryType(resolver, name, type, { timeoutMs });
            return { ok: true, message: `Answers: ${answer.records.length}`, durationMs: Date.now() - started };
          } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : 'query failed', durationMs: Date.now() - started };
          }
        },
        fetchProbe: async (url, timeoutMs) => {
          const { fetchWithGuard } = await import('../tools/core/ssrf');
          const started = Date.now();
          const response = await fetchWithGuard(url, { method: 'GET', timeoutMs, maxBytes: 4096, userAgent: 'CloudHost247-ToolsCenter/1.0 (provider test)' });
          return { status: response.status, durationMs: Date.now() - started };
        },
      });
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_PROVIDER_TESTED', resourceType: 'tool_provider', resourceId: slug, metadata: { ok: result.ok, status: result.status } });
      return { success: true, result };
    });

    app.delete(`${admin}/providers/:slug`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const slug = (request.params as { slug?: string }).slug ?? '';
      const removed = await deleteProvider(pool, slug);
      if (!removed) throw new NotFoundError('That provider does not exist.');
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_PROVIDER_DELETED', resourceType: 'tool_provider', resourceId: slug });
      return { success: true, deleted: true };
    });

    // --- Resolvers ---------------------------------------------------------------------------------

    app.get(`${admin}/resolvers`, async (request) => {
      await requireRole(request, env, pool, ['admin', 'super_admin']);
      const resolvers = await listResolvers(pool);
      return { success: true, resolvers };
    });

    app.post(`${admin}/resolvers`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const input = parseOrThrow(resolverSchema, request.body ?? {});
      if (!input.name || !input.ipAddress) throw new ValidationError('A resolver needs a name and the IP address it queries.');
      const resolver = await createResolver(pool, {
        name: input.name,
        provider: input.provider ?? input.name,
        ipAddress: input.ipAddress,
        protocol: input.protocol ?? 'UDP',
        version: input.version ?? 'IPv4',
        ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
        ...(input.country !== undefined ? { country: input.country } : {}),
        ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
        ...(input.region !== undefined ? { region: input.region } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.anycast !== undefined ? { anycast: input.anycast } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      });
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_RESOLVER_CREATED', resourceType: 'tool_resolver', resourceId: resolver.id, metadata: { name: resolver.name, protocol: resolver.protocol } });
      return { success: true, resolver };
    });

    app.patch(`${admin}/resolvers/:id`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = (request.params as { id?: string }).id ?? '';
      const input = parseOrThrow(resolverSchema, request.body ?? {});
      const resolver = await updateResolver(pool, id, input);
      if (!resolver) throw new NotFoundError('That resolver does not exist.');
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_RESOLVER_UPDATED', resourceType: 'tool_resolver', resourceId: id, metadata: { keys: Object.keys(input) } });
      return { success: true, resolver };
    });

    app.delete(`${admin}/resolvers/:id`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = (request.params as { id?: string }).id ?? '';
      const removed = await deleteResolver(pool, id);
      if (!removed) throw new NotFoundError('That resolver does not exist.');
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_RESOLVER_DELETED', resourceType: 'tool_resolver', resourceId: id });
      return { success: true, deleted: true };
    });

    app.post(`${admin}/resolvers/:id/test`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = (request.params as { id?: string }).id ?? '';
      const resolver = await findResolver(pool, id);
      if (!resolver) throw new NotFoundError('That resolver does not exist.');
      const result = await checkResolverHealth(pool, resolver);
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_RESOLVER_TESTED', resourceType: 'tool_resolver', resourceId: id, metadata: { status: result.status, latencyMs: result.latencyMs } });
      return { success: true, result };
    });

    // --- Operations ---------------------------------------------------------------------------------

    app.post(`${admin}/cache/clear`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const slug = typeof body.toolSlug === 'string' && body.toolSlug.length > 0 ? body.toolSlug : undefined;
      const removed = await invalidateToolCache(pool, slug);
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_CACHE_CLEARED', resourceType: 'tool_cache', resourceId: slug ?? 'all', metadata: { removed } });
      return { success: true, removed };
    });

    app.post(`${admin}/capabilities/refresh`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      resetCapabilityCache();
      const keys = ['dns-udp', 'dns-tcp', 'dns-doh', 'dns-dot', 'tcp-connect', 'icmp-ping', 'traceroute', 'tls-client', 'smtp-client', 'http-fetch'];
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_CAPABILITIES_REFRESHED', resourceType: 'tool_capability', resourceId: 'all' });
      return { success: true, capabilities: keys.map((key) => ({ key, ...capabilityReport(key, true) })) };
    });

    app.post(`${admin}/sweep`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const kind = typeof body.kind === 'string' ? body.kind : 'all';
      const provider = kind === 'providers' || kind === 'all' ? await providerHealthSweep(pool) : null;
      const resolver = kind === 'resolvers' || kind === 'all' ? await resolverHealthSweep(pool) : null;
      const monitor = kind === 'monitors' || kind === 'all' ? await monitorSweep(pool) : null;
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_SWEEP_RUN', resourceType: 'tool_worker', resourceId: kind });
      return { success: true, kind, provider, resolver, monitor };
    });

    app.get(`${admin}/health-checks`, async (request) => {
      await requireRole(request, env, pool, ['admin', 'super_admin']);
      const query = request.query as Record<string, unknown> | undefined;
      const limit = Math.min(Math.max(Number(query?.limit ?? 50) || 50, 1), 200);
      const subjectType = query?.subjectType === 'resolver' ? 'resolver' : query?.subjectType === 'provider' ? 'provider' : null;
      const { rows } = await pool.query(
        `SELECT id, subject_type, subject_slug, status, latency_ms, detail, checked_at
           FROM tool_health_checks
          ${subjectType ? 'WHERE subject_type = $2' : ''}
          ORDER BY checked_at DESC LIMIT $1`,
        subjectType ? [limit, subjectType] : [limit]
      );
      return { success: true, checks: rows };
    });

    app.post(`${admin}/run-tools-sweep`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const result = await runToolsSweep(pool);
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_SWEEP_RUN', resourceType: 'tool_worker', resourceId: 'full' });
      return { success: true, result };
    });
  };

  registerHandlers('/api');
  registerHandlers('/api/v1');
}
