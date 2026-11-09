import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { requireRole } from '../lib/require-role';
import { requestAuditContext } from '../lib/audit';
import { ValidationError } from '../lib/errors';
import { getGoogleAdsAdmin, googleAdsAudit, saveGoogleAds, testGoogleAds } from '../marketing/google-ads';
const ROLES=['admin','super_admin'] as const;
function parse<T>(schema:z.ZodType<T>,value:unknown):T { const result=schema.safeParse(value); if(!result.success) throw new ValidationError(result.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')); return result.data; }
export async function registerAdminGoogleAdsRoutes(app:FastifyInstance,env:Env,overridePool?:Queryable) {
 const pool=overridePool??getPool(env); const base='/api/v1/admin/marketing-integrations/google-ads';
 app.get(base,async request=>{await requireRole(request,env,pool,ROLES);return {configuration:await getGoogleAdsAdmin(pool)};});
 app.put(base,async request=>{const auth=await requireRole(request,env,pool,ROLES);const input=parse(z.object({expectedRevision:z.number().int().min(0),configuration:z.unknown()}).strict(),request.body);return {configuration:await saveGoogleAds(pool,auth.userId,input,requestAuditContext(request))};});
 app.post(`${base}/test`,async request=>{const auth=await requireRole(request,env,pool,ROLES);return testGoogleAds(pool,auth.userId,requestAuditContext(request));});
 app.get(`${base}/audit`,async request=>{await requireRole(request,env,pool,ROLES);return {entries:await googleAdsAudit(pool)};});
}
