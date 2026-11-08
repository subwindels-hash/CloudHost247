import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { requestAuditContext } from '../lib/audit';
import { ValidationError } from '../lib/errors';
import { configurationSchema, pixelIdSchema, domainSchema } from '../marketing/types';
import { getAdminConfiguration, saveConfiguration, testConfiguration, resetConfiguration, importLegacyConfiguration, listActivity, configurationAudit } from '../marketing/config-service';

const ADMIN_ROLES = ['admin', 'super_admin'] as const;
const saveSchema = z.object({
  expectedRevision: z.number().int().min(0), configuration: configurationSchema,
  capiAccessToken: z.string().min(20).max(4096).optional(), removeCapiToken: z.boolean().optional(),
}).strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}

export async function registerAdminMarketingRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);
  const base = '/api/v1/admin/marketing-integrations/meta-pixel';
  app.get(base, async request => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    return { configuration: await getAdminConfiguration(pool) };
  });
  app.put(base, async request => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const input = parse(saveSchema, request.body);
    return { configuration: await saveConfiguration(pool, auth.userId, input, requestAuditContext(request)) };
  });
  app.post(`${base}/test`, async request => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    return testConfiguration(pool, auth.userId, requestAuditContext(request));
  });
  app.post(`${base}/reset`, async request => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const input = parse(z.object({ expectedRevision: z.number().int().min(1), confirmation: z.literal('RESET') }).strict(), request.body);
    return { configuration: await resetConfiguration(pool, auth.userId, input.expectedRevision, requestAuditContext(request)) };
  });
  app.post(`${base}/import-legacy`, async request => {
    const auth = await requireRole(request, env, pool, ADMIN_ROLES);
    const input = parse(z.object({ pixelId: pixelIdSchema, websiteDomain: domainSchema, displayName: z.string().trim().min(1).max(120).optional(), expectedRevision: z.number().int().min(0), confirmImport: z.literal(true) }).strict(), request.body);
    return importLegacyConfiguration(pool, auth.userId, input, requestAuditContext(request));
  });
  app.get(`${base}/activity`, async request => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    const query = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(10000).default(0) }), request.query);
    return { events: await listActivity(pool, query.limit, query.offset), deliveryMeaning: 'delivered means Meta HTTP API acceptance, not Events Manager verification; browser dispatch is not proof of receipt' };
  });
  app.get(`${base}/audit`, async request => {
    await requireRole(request, env, pool, ADMIN_ROLES);
    return { entries: await configurationAudit(pool) };
  });
}
