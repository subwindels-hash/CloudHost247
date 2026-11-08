import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { requestAuditContext } from '../lib/audit';
import { ValidationError } from '../lib/errors';
import { tiktokConfigurationSchema } from '../tiktok/types';
import { getTikTokAdminConfiguration, saveTikTokConfiguration, testTikTokConfiguration, resetTikTokConfiguration, listTikTokActivity, tiktokConfigurationAudit } from '../tiktok/config-service';

const ADMIN_ROLES = ['admin', 'super_admin'] as const;
const saveSchema = z.object({
  expectedRevision: z.number().int().min(0), configuration: tiktokConfigurationSchema,
  eventsApiAccessToken: z.string().min(20).max(4096).optional(), removeEventsApiToken: z.boolean().optional(),
}).strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}

export async function registerAdminTikTokRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);
  const base = '/api/v1/admin/marketing-integrations/tiktok-pixel';
  app.get(base, async request => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    return { configuration: await getTikTokAdminConfiguration(pool) };
  });
  app.put(base, async request => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const input = parse(saveSchema, request.body);
    return { configuration: await saveTikTokConfiguration(pool, auth.userId, input, requestAuditContext(request)) };
  });
  app.post(`${base}/test`, async request => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    return testTikTokConfiguration(pool, auth.userId, requestAuditContext(request));
  });
  app.post(`${base}/reset`, async request => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const input = parse(z.object({ expectedRevision: z.number().int().min(1), confirmation: z.literal('RESET') }).strict(), request.body);
    return { configuration: await resetTikTokConfiguration(pool, auth.userId, input.expectedRevision, requestAuditContext(request)) };
  });
  app.get(`${base}/activity`, async request => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const query = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(10000).default(0) }), request.query);
    return { events: await listTikTokActivity(pool, query.limit, query.offset), deliveryMeaning: 'delivered means TikTok Events API acceptance (code 0), not Events Manager verification; browser dispatch is not proof of receipt' };
  });
  app.get(`${base}/audit`, async request => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    return { entries: await tiktokConfigurationAudit(pool) };
  });
  app.get(`${base}/diagnostics`, async request => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const configuration = await getTikTokAdminConfiguration(pool);
    const { rows } = await pool.query<{ total: string; duplicates: string; last_delivery_status: string | null; last_delivered_at: string | null }>(
      `SELECT (SELECT count(*) FROM marketing_events WHERE provider_key='tiktok_pixel') AS total,
              (SELECT count(*) FROM (SELECT 1 FROM marketing_events WHERE provider_key='tiktok_pixel' GROUP BY pixel_id,event_name,event_id HAVING count(*)>1) d) AS duplicates,
              (SELECT o.status FROM marketing_delivery_outbox o JOIN marketing_events e ON e.id=o.event_id WHERE e.provider_key='tiktok_pixel' ORDER BY o.updated_at DESC LIMIT 1) AS last_delivery_status,
              (SELECT o.delivered_at FROM marketing_delivery_outbox o JOIN marketing_events e ON e.id=o.event_id WHERE e.provider_key='tiktok_pixel' AND o.delivered_at IS NOT NULL ORDER BY o.delivered_at DESC LIMIT 1) AS last_delivered_at`);
    const r = rows[0];
    return {
      configuration,
      diagnostics: {
        pixelId: configuration.pixelId, enabled: configuration.enabled,
        installationStatus: !configuration.pixelId ? 'not_configured' : configuration.enabled ? 'installed_via_central_runtime' : 'configured_disabled',
        pixelInitialization: 'runtime_reports_via_bootstrap_diagnostic',
        consentConfiguration: 'shared_marketing_consent_category_required',
        eventsApiConnection: configuration.eventsApi.enabled ? (configuration.eventsApi.hasToken ? 'configured_not_live_verified' : 'enabled_without_token') : 'disabled',
        enabledEvents: configuration.enabledEvents,
        lastSuccessfulTest: configuration.lastConfigurationTestStatus === 'CONFIGURATION_VALID' ? configuration.lastConfigurationTestAt : null,
        lastServerDeliveryStatus: r?.last_delivery_status ?? null,
        lastServerDeliveredAt: r?.last_delivered_at ?? null,
        eventsRecorded: Number(r?.total ?? 0),
        duplicateEventWarnings: Number(r?.duplicates ?? 0),
      },
    };
  });
}
