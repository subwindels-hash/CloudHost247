import { z } from 'zod';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { recordAudit, type AuditContext } from '../lib/audit';
import { ConflictError, ValidationError } from '../lib/errors';
import { domainSchema } from './types';

const PROVIDER = 'google_analytics';
export const ga4Schema = z.object({
  displayName: z.string().trim().min(1).max(120),
  websiteDomain: z.union([z.literal(''), domainSchema]),
  enabled: z.boolean(),
  measurementId: z.union([z.string().regex(/^G-[A-Z0-9]{10}$/, 'Use a GA4 ID in the form G-XXXXXXXXXX'), z.null()]),
  testMode: z.boolean(),
  streamReviewed: z.boolean().default(false),
  userDataReviewed: z.boolean().default(false),
}).strict().superRefine((config, ctx) => {
  if (config.enabled && (!config.measurementId || !config.websiteDomain || !config.streamReviewed || !config.userDataReviewed)) ctx.addIssue({ code: 'custom', path: ['enabled'], message: 'A Measurement ID, website domain, stream privacy review and user-provided data review are required before enabling' });
});
export type Ga4Configuration = z.infer<typeof ga4Schema>;
export const defaultGa4: Ga4Configuration = { displayName: 'CloudHost247 Google Analytics', websiteDomain: '', enabled: false, measurementId: null, testMode: false, streamReviewed: false, userDataReviewed: false };
interface Row {
  configuration: Ga4Configuration; enabled: boolean; website_domain: string; revision: number; last_configuration_update: string | null;
  last_configuration_test_at: string | null; last_configuration_test_status: string | null;
}
function dto(row: Row) {
  return { providerKey: PROVIDER, ...row.configuration, revision: row.revision,
    lastConfigurationUpdate: row.last_configuration_update, lastConfigurationTestAt: row.last_configuration_test_at,
    lastConfigurationTestStatus: row.last_configuration_test_status,
    installationStatus: 'code_installed', connectionStatus: 'not_verified', lastSuccessfulLocalTestAt: null as string | null };
}
async function getRow(db: Queryable, lock = false) {
  const row = (await db.query<Row>(`SELECT configuration,enabled,website_domain,revision,last_configuration_update,last_configuration_test_at,last_configuration_test_status FROM marketing_integrations WHERE provider_key=$1${lock ? ' FOR UPDATE' : ''}`, [PROVIDER])).rows[0];
  if (!row) throw new Error('GA4 configuration unavailable; apply database migrations');
  return row;
}
export async function getGa4(db: Queryable) {
  const row = await getRow(db);
  // A local validation belongs only to the exact configuration revision tested.
  // It is never a Google network or event-delivery verification.
  const latest = (await db.query<{ created_at: string }>(`SELECT created_at FROM audit_logs
    WHERE resource_type='marketing_integration' AND resource_id=$1
      AND action='marketing.google_analytics.configuration_tested'
      AND metadata->>'status'='configuration_valid_only' AND metadata->>'revision'=$2
    ORDER BY created_at DESC, id DESC LIMIT 1`, [PROVIDER, String(row.revision)])).rows[0];
  return { ...dto(row), lastSuccessfulLocalTestAt: latest?.created_at ?? null };
}
/** Limited administrative history: omit request IPs, user agents and raw metadata. */
export async function ga4Audit(db: Queryable) {
  return (await db.query<{ id: string; action: string; actor_id: string | null; created_at: string }>(`SELECT id,action,actor_id,created_at FROM audit_logs
    WHERE resource_type='marketing_integration' AND resource_id=$1 AND action IN
      ('marketing.google_analytics.configuration_saved','marketing.google_analytics.configuration_reset','marketing.google_analytics.configuration_tested')
    ORDER BY created_at DESC, id DESC LIMIT 50`, [PROVIDER])).rows;
}
/** Public bootstrap: hostname-bound and strictly validated; no administrative diagnostics. */
export async function ga4Runtime(db: Queryable, hostname: string) {
  const row = await getRow(db);
  const result = ga4Schema.safeParse(row.configuration);
  const config = result.success ? result.data : null;
  const matches = config && config.websiteDomain === row.website_domain && row.website_domain === hostname.toLowerCase().replace(/^www\./, '');
  const enabled = Boolean(row.enabled && config?.enabled && config.measurementId && matches);
  return { enabled, measurementId: enabled ? config!.measurementId : null, testMode: Boolean(enabled && config!.testMode), revision: row.revision };
}
export async function saveGa4(db: Queryable, actorId: string, expectedRevision: number, raw: unknown, context: AuditContext, reset = false) {
  const parsed = ga4Schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const config = parsed.data;
  return withTransaction(db, async tx => {
    const before = await getRow(tx, true);
    if (before.revision !== expectedRevision) throw new ConflictError('Configuration changed. Reload before saving.');
    const row = (await tx.query<Row>(`UPDATE marketing_integrations SET display_name=$1,website_domain=$2,enabled=$3,configuration=$4,revision=revision+1,last_configuration_update=now(),last_configuration_test_at=NULL,last_configuration_test_status=NULL,last_error=NULL,updated_by=$5,updated_at=now() WHERE provider_key=$6 RETURNING configuration,enabled,website_domain,revision,last_configuration_update,last_configuration_test_at,last_configuration_test_status`,
      [config.displayName, config.websiteDomain, config.enabled, JSON.stringify(config), actorId, PROVIDER])).rows[0]!;
    await recordAudit(tx, { actorId, action: reset ? 'marketing.google_analytics.configuration_reset' : 'marketing.google_analytics.configuration_saved', resourceType: 'marketing_integration', resourceId: PROVIDER, metadata: { before: dto(before), after: dto(row) } }, context);
    return dto(row);
  });
}
export async function testGa4(db: Queryable, actorId: string, context: AuditContext) {
  return withTransaction(db, async tx => {
    const row = await getRow(tx, true);
    const valid = ga4Schema.safeParse(row.configuration).success && !!row.configuration.measurementId && !!row.configuration.websiteDomain;
    const status = valid ? 'configuration_valid_only' : 'configuration_incomplete';
    await tx.query('UPDATE marketing_integrations SET last_configuration_test_at=now(),last_configuration_test_status=$1 WHERE provider_key=$2', [status, PROVIDER]);
    await recordAudit(tx, { actorId, action: 'marketing.google_analytics.configuration_tested', resourceType: 'marketing_integration', resourceId: PROVIDER, metadata: { status, providerContacted: false, revision: row.revision } }, context);
    return { status, providerContacted: false, trackingVerified: false, message: valid ? 'Configuration format is valid. Google was not contacted and event delivery is not verified.' : 'Enter a valid Measurement ID and domain. Google was not contacted.' };
  });
}
