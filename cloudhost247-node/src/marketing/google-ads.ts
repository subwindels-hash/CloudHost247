import { z } from 'zod';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { recordAudit, type AuditContext } from '../lib/audit';
import { ConflictError, ValidationError } from '../lib/errors';

export const GOOGLE_ADS_PROVIDER = 'google_ads';
export const GOOGLE_ADS_ACTIONS = ['purchase','lead','sign_up','contact','begin_checkout','add_to_cart','subscription','renewal','upgrade'] as const;
export type GoogleAdsAction = typeof GOOGLE_ADS_ACTIONS[number];
const actionSchema = z.object({ label: z.string().trim().max(128).regex(/^[A-Za-z0-9_-]*$/, 'Conversion labels may contain letters, digits, underscores and hyphens'), primary: z.boolean() }).strict();
const actionsSchema = z.object(Object.fromEntries(GOOGLE_ADS_ACTIONS.map(action => [action, actionSchema])) as Record<GoogleAdsAction, typeof actionSchema>).strict();
export const googleAdsConfigurationSchema = z.object({
  displayName: z.string().trim().min(1).max(120), websiteDomain: z.string().trim().toLowerCase().transform(v => v.replace(/^www\./,''))
    .refine(v => !v || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v), 'Enter a hostname without a scheme, path or port'),
  enabled: z.boolean(), customerId: z.string().refine(v => !v || /^\d{10}$/.test(v), 'Customer ID must be 10 digits without hyphens'),
  conversionId: z.string().refine(v => !v || /^\d{5,20}$/.test(v), 'Conversion ID must contain 5–20 digits'),
  defaultCurrency: z.string().refine(v => !v || /^[A-Z]{3}$/.test(v), 'Use an ISO 4217 currency code'),
  remarketingEnabled: z.boolean(), enhancedConversionsEnabled: z.literal(false), actions: actionsSchema,
}).strict().superRefine((config, ctx) => {
  if (config.enabled && !config.websiteDomain) ctx.addIssue({ code: 'custom', path: ['websiteDomain'], message: 'A website domain is required before enabling Google Ads' });
  if (config.enabled && !/^\d{10}$/.test(config.customerId)) ctx.addIssue({ code: 'custom', path: ['customerId'], message: 'A valid 10-digit Google Ads Customer ID is required' });
  if (config.enabled && !/^\d{5,20}$/.test(config.conversionId)) ctx.addIssue({ code: 'custom', path: ['conversionId'], message: 'A valid Google Ads Conversion ID is required' });
  if (config.enabled && !Object.values(config.actions).some(action => action.label.length > 0)) {
    ctx.addIssue({ code: 'custom', path: ['actions'], message: 'Configure at least one conversion action before enabling Google Ads' });
  }
});
export type GoogleAdsConfiguration = z.infer<typeof googleAdsConfigurationSchema>;
export const defaultGoogleAdsConfiguration: GoogleAdsConfiguration = {
  displayName: 'CloudHost247 Google Ads', websiteDomain: '', enabled: false, customerId: '', conversionId: '', defaultCurrency: '',
  remarketingEnabled: false, enhancedConversionsEnabled: false,
  actions: Object.fromEntries(GOOGLE_ADS_ACTIONS.map(action => [action, { label: '', primary: action === 'purchase' }])) as GoogleAdsConfiguration['actions'],
};
interface AdsRow { provider_key: string; display_name: string; website_domain: string; enabled: boolean; configuration: GoogleAdsConfiguration; revision: number; last_configuration_update: string|null; last_configuration_test_at: string|null; last_configuration_test_status: string|null; last_error: string|null }
const SELECT = `SELECT * FROM marketing_integrations WHERE provider_key='google_ads'`;
export async function loadGoogleAds(pool: Queryable): Promise<AdsRow|null> { return (await pool.query<AdsRow>(SELECT)).rows[0] ?? null; }
function dto(row: AdsRow|null) {
  const config = row?.configuration ?? defaultGoogleAdsConfiguration;
  const enabled = Boolean(row?.enabled && config.enabled);
  return {
    providerKey: GOOGLE_ADS_PROVIDER, displayName: row?.display_name ?? config.displayName,
    websiteDomain: row?.website_domain ?? config.websiteDomain, enabled, customerId: config.customerId || '',
    conversionId: config.conversionId || '', defaultCurrency: config.defaultCurrency,
    remarketingEnabled: enabled && config.remarketingEnabled, enhancedConversionsEnabled: false as const,
    actions: config.actions, revision: row?.revision ?? 0,
    lastConfigurationUpdate: row?.last_configuration_update ?? null,
    lastConfigurationTestAt: row?.last_configuration_test_at ?? null,
    lastConfigurationTestStatus: row?.last_configuration_test_status ?? null,
    linkerStatus: enabled ? 'Google tag linker available; operates only with ad_storage consent' : 'Inactive',
    diagnostic: !row ? 'missing_configuration' : !config.customerId || !config.conversionId ? 'missing_ids' : !enabled ? 'disabled' : 'configured',
    dynamicRemarketing: false as const,
    lastConversionDeliveryStatus: 'Browser dispatch only; Google receipt is not verified by this site',
  };
}
export async function getGoogleAdsAdmin(pool: Queryable) { return dto(await loadGoogleAds(pool)); }
export function googleAdsRuntime(row: AdsRow|null, hostname: string) {
  const config = row?.configuration;
  const active = Boolean(row?.enabled && config?.enabled && config.customerId && config.conversionId && row!.website_domain === hostname.toLowerCase().replace(/^www\./,''));
  return { enabled: active, destination: active ? `AW-${config!.conversionId}` : null, remarketingEnabled: active && config!.remarketingEnabled,
    actions: active ? config!.actions : null, defaultCurrency: active ? config!.defaultCurrency : null,
    diagnostic: !row ? 'missing_configuration' : !config?.customerId || !config?.conversionId ? 'missing_ids' : !row.enabled ? 'disabled' : !active ? 'domain_mismatch' : 'configured' };
}
export async function saveGoogleAds(pool: Queryable, actorId: string, input: {expectedRevision:number; configuration:unknown}, auditContext:AuditContext={}) {
  const parsed = googleAdsConfigurationSchema.safeParse(input.configuration);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const config = parsed.data;
  return withTransaction(pool, async tx => {
    const before = (await tx.query<AdsRow>(`${SELECT} FOR UPDATE`)).rows[0] ?? null;
    if ((before?.revision ?? 0) !== input.expectedRevision) throw new ConflictError('Google Ads configuration changed. Reload before saving.');
    const result = (await tx.query<AdsRow>(`UPDATE marketing_integrations SET display_name=$1,website_domain=$2,enabled=$3,configuration=$4,revision=revision+1,
      last_configuration_update=now(),updated_by=$5,updated_at=now(),last_error=NULL WHERE provider_key='google_ads' AND revision=$6 RETURNING *`,
      [config.displayName,config.websiteDomain,config.enabled,JSON.stringify(config),actorId,input.expectedRevision])).rows[0];
    if (!result) throw new ConflictError('Google Ads configuration changed. Reload before saving.');
    await recordAudit(tx,{actorId,action:'marketing.google_ads.configuration_saved',resourceType:'marketing_integration',resourceId:GOOGLE_ADS_PROVIDER,
      metadata:{before:before?dto(before):dto(null),after:dto(result)}},auditContext);
    return dto(result);
  });
}
export async function testGoogleAds(pool: Queryable, actorId: string, auditContext:AuditContext={}) {
  return withTransaction(pool, async tx => {
    const row=(await tx.query<AdsRow>(`${SELECT} FOR UPDATE`)).rows[0] ?? null;
    const parsed=row ? googleAdsConfigurationSchema.safeParse(row.configuration) : null;
    const status=!row?'MISSING_CONFIGURATION':!parsed?.success?'INVALID_CONFIGURATION':!row.enabled?'DISABLED':'CONFIGURATION_VALID';
    if(row) await tx.query(`UPDATE marketing_integrations SET last_configuration_test_at=now(),last_configuration_test_status=$1 WHERE provider_key='google_ads'`,[status]);
    await recordAudit(tx,{actorId,action:'marketing.google_ads.configuration_tested',resourceType:'marketing_integration',resourceId:GOOGLE_ADS_PROVIDER,metadata:{status,providerContacted:false}},auditContext);
    return {status,providerContacted:false as const,conversionSent:false as const,message:status==='CONFIGURATION_VALID'?'Local configuration is valid. No Google request or production conversion was sent. Verify events with Google Tag Assistant and the Google Ads diagnostics.':'Google Ads is not ready; review the identifiers, action labels and enabled state.'};
  });
}
export async function googleAdsAudit(pool: Queryable) {
  return (await pool.query(`SELECT id,action,metadata,created_at,actor_id FROM audit_logs WHERE resource_type='marketing_integration' AND resource_id='google_ads' ORDER BY created_at DESC LIMIT 50`)).rows;
}
