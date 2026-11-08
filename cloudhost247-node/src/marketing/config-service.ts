import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { recordAudit } from '../lib/audit';
import { encryptSecret, decryptSecret, DecryptionError, MissingEncryptionKeyError } from '../lib/crypto';
import { getKeyRing } from '../lib/keyring';
import { ConflictError, HttpError, ValidationError } from '../lib/errors';
import { CONSENT_POLICY_VERSION, configurationSchema, configurationDTO, defaultConfiguration, META_PROVIDER, type IntegrationRow, type MetaConfiguration } from './types';

const SELECT = `SELECT i.*, EXISTS(SELECT 1 FROM marketing_integration_secrets s WHERE s.provider_key=i.provider_key AND s.secret_key='capi_access_token') AS has_capi_token FROM marketing_integrations i WHERE provider_key=$1`;

export async function loadConfiguration(pool: Queryable): Promise<IntegrationRow | null> {
  const { rows } = await pool.query<IntegrationRow>(SELECT, [META_PROVIDER]);
  return rows[0] ?? null;
}

export async function getAdminConfiguration(pool: Queryable) {
  const row = await loadConfiguration(pool);
  return row ? configurationDTO(row) : configurationDTO({
    provider_key: META_PROVIDER, display_name: defaultConfiguration.displayName,
    website_domain: '', enabled: false, configuration: defaultConfiguration, revision: 0,
    last_configuration_update: null, last_configuration_test_at: null,
    last_configuration_test_status: null, last_error: null,
    created_at: '', updated_at: '', has_capi_token: false,
  });
}

export interface SaveConfigurationInput { configuration: MetaConfiguration; expectedRevision: number; capiAccessToken?: string; removeCapiToken?: boolean }

/** Configuration and its audit record commit together. CAPI secret material never enters audit JSON. */
export async function saveConfiguration(pool: Queryable, actorId: string, input: SaveConfigurationInput, auditContext = {}) {
  const parsed = configurationSchema.safeParse(input.configuration);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const config = parsed.data;
  if (input.removeCapiToken && input.capiAccessToken) throw new ValidationError('Choose either token replacement or removal, not both');
  if (input.removeCapiToken && config.capi.enabled) throw new ValidationError('Disable CAPI before removing its token');
  // Fail before opening a transaction if encryption is unavailable; never store plaintext fallback.
  let encrypted: string | null = null;
  if (input.capiAccessToken) {
    if (!/^[A-Za-z0-9_|.-]{20,4096}$/.test(input.capiAccessToken)) throw new ValidationError('The Meta access token format is invalid');
    try { encrypted = encryptSecret(getKeyRing(), input.capiAccessToken); }
    catch (error) {
      if (error instanceof MissingEncryptionKeyError) throw new HttpError(503, 'Configure CREDENTIAL_ENCRYPTION_KEY before storing a Meta access token', 'CONFIGURATION_REQUIRED');
      throw error;
    }
  }
  return withTransaction(pool, async tx => {
    const { rows } = await tx.query<IntegrationRow>(`${SELECT} FOR UPDATE`, [META_PROVIDER]);
    const row = rows[0];
    if (!row || row.revision !== input.expectedRevision) throw new ConflictError('Configuration changed since it was loaded. Reload before saving.');
    const hasToken = input.removeCapiToken ? false : Boolean(encrypted || row.has_capi_token);
    if (config.capi.enabled && !hasToken) throw new ValidationError('An authorized Meta access token must be stored before CAPI can be enabled');
    if (encrypted) {
      await tx.query(`INSERT INTO marketing_integration_secrets(provider_key,secret_key,encrypted_value,rotated_by) VALUES ($1,'capi_access_token',$2,$3)
        ON CONFLICT(provider_key,secret_key) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value,rotated_by=EXCLUDED.rotated_by,rotated_at=now()`, [META_PROVIDER, encrypted, actorId]);
    }
    if (input.removeCapiToken) await tx.query(`DELETE FROM marketing_integration_secrets WHERE provider_key=$1 AND secret_key='capi_access_token'`, [META_PROVIDER]);
    // A disabled/retargeted integration must not leave a silently stranded outbox. Token
    // rotation alone keeps the same destination, so queued events may use the new credential.
    const destinationChanged = row.configuration.pixelId !== config.pixelId || row.website_domain !== config.websiteDomain;
    if (!config.enabled || !config.capi.enabled || input.removeCapiToken || destinationChanged) {
      await tx.query(`UPDATE marketing_delivery_outbox SET status='cancelled',worker_id=NULL,lease_until=NULL,last_error='Integration configuration changed before delivery',updated_at=now() WHERE status IN ('queued','retry','processing')`);
    }
    const { rows: updated } = await tx.query<IntegrationRow>(`UPDATE marketing_integrations SET display_name=$1,website_domain=$2,enabled=$3,configuration=$4,
      revision=revision+1,last_configuration_update=now(),updated_by=$5,updated_at=now(),last_error=NULL WHERE provider_key=$6 RETURNING *`,
    [config.displayName, config.websiteDomain, config.enabled, JSON.stringify(config), actorId, META_PROVIDER]);
    const after = configurationDTO({ ...updated[0]!, has_capi_token: hasToken });
    await recordAudit(tx, { actorId, action: 'marketing.meta_pixel.configuration_saved', resourceType: 'marketing_integration', resourceId: META_PROVIDER,
      metadata: { before: configurationDTO(row), after, tokenRotated: Boolean(encrypted), tokenRemoved: Boolean(input.removeCapiToken) } }, auditContext);
    return after;
  });
}

/** Honest local configuration verification. A public Pixel ID cannot prove ownership or Meta receipt. */
export async function testConfiguration(pool: Queryable, actorId: string, auditContext = {}) {
  return withTransaction(pool, async tx => {
    const row = (await tx.query<IntegrationRow>(`${SELECT} FOR UPDATE`, [META_PROVIDER])).rows[0];
    const config = row ? configurationSchema.safeParse(row.configuration) : null;
    const status = !row ? 'MISSING_CONFIGURATION' : !config?.success || !row.configuration.pixelId ? 'INVALID_CONFIGURATION' : !row.enabled ? 'DISABLED' : 'CONFIGURATION_VALID';
    await tx.query(`UPDATE marketing_integrations SET last_configuration_test_at=now(),last_configuration_test_status=$1 WHERE provider_key=$2`, [status, META_PROVIDER]);
    await recordAudit(tx, { actorId, action: 'marketing.meta_pixel.configuration_tested', resourceType: 'marketing_integration', resourceId: META_PROVIDER, metadata: { status, providerContacted: false } }, auditContext);
    return { status, providerContacted: false as const, metaReceiptVerified: false as const,
      message: status === 'CONFIGURATION_VALID' ? 'Saved configuration is valid. Verify browser events in Meta Test Events; this test did not contact Meta.' : 'Configuration is not ready. Review the Pixel ID, domain and enabled state.' };
  });
}

export async function resetConfiguration(pool: Queryable, actorId: string, expectedRevision: number, auditContext = {}) {
  return withTransaction(pool, async tx => {
    const row = (await tx.query<IntegrationRow>(`${SELECT} FOR UPDATE`, [META_PROVIDER])).rows[0];
    if (!row || row.revision !== expectedRevision) throw new ConflictError('Configuration changed. Reload before resetting.');
    await tx.query(`DELETE FROM marketing_integration_secrets WHERE provider_key=$1`, [META_PROVIDER]);
    await tx.query(`UPDATE marketing_delivery_outbox SET status='cancelled',worker_id=NULL,lease_until=NULL,updated_at=now() WHERE status IN ('queued','retry','processing')`);
    const { rows } = await tx.query<IntegrationRow>(`UPDATE marketing_integrations SET display_name=$1,website_domain='',enabled=false,configuration=$2,
      revision=revision+1,last_configuration_update=now(),last_configuration_test_at=NULL,last_configuration_test_status=NULL,last_error=NULL,updated_by=$3,updated_at=now() WHERE provider_key=$4 RETURNING *`,
    [defaultConfiguration.displayName, JSON.stringify(defaultConfiguration), actorId, META_PROVIDER]);
    await recordAudit(tx, { actorId, action: 'marketing.meta_pixel.configuration_reset', resourceType: 'marketing_integration', resourceId: META_PROVIDER,
      metadata: { before: configurationDTO(row), after: configurationDTO({ ...rows[0]!, has_capi_token: false }), pendingDeliveriesCancelled: true } }, auditContext);
    return configurationDTO({ ...rows[0]!, has_capi_token: false });
  });
}

export async function listActivity(pool: Queryable, limit = 50, offset = 0) {
  const { rows } = await pool.query(`SELECT e.id,e.event_name,e.event_id,e.pixel_id,e.custom_data,e.occurred_at,e.browser_dispatched_at,e.server_recorded_at,
    CASE WHEN e.browser_dispatched_at IS NOT NULL AND e.server_recorded_at IS NOT NULL THEN 'browser_and_server' WHEN e.server_recorded_at IS NOT NULL THEN 'server' WHEN e.browser_dispatched_at IS NOT NULL THEN 'browser' ELSE 'server_recorded' END AS channel,
    o.status AS delivery_status,o.attempts,o.http_status,o.events_received,o.last_error,o.delivered_at,o.next_attempt_at,
    (s.id IS NOT NULL AND s.decided AND s.policy_version=$4 AND (s.preferences->>'marketing')::boolean AND s.expires_at>now()) AS marketing_consent_current
    FROM marketing_events e LEFT JOIN marketing_delivery_outbox o ON o.event_id=e.id LEFT JOIN marketing_consent_sessions s ON s.id=e.session_id
    WHERE e.provider_key=$1 ORDER BY e.created_at DESC LIMIT $2 OFFSET $3`, [META_PROVIDER, limit, offset, CONSENT_POLICY_VERSION]);
  return rows;
}

export async function configurationAudit(pool: Queryable) {
  return (await pool.query(`SELECT id,action,metadata,created_at,actor_id FROM audit_logs WHERE resource_type='marketing_integration' AND resource_id=$1 ORDER BY created_at DESC LIMIT 50`, [META_PROVIDER])).rows;
}

export function readCapiToken(encrypted: string): string {
  try { return decryptSecret(getKeyRing(), encrypted); }
  catch (error) {
    if (error instanceof DecryptionError || error instanceof MissingEncryptionKeyError) throw new HttpError(503, 'Meta credential unavailable; an administrator must review encryption configuration', 'CONFIGURATION_REQUIRED');
    throw error;
  }
}

export async function loadCapiCredentials(pool: Queryable) {
  // One SQL statement is one PostgreSQL snapshot: configuration, revision, test code and
  // ciphertext cannot straddle a committed token rotation. Decrypt only after the row returns.
  const row = (await pool.query<IntegrationRow & { capi_access_token_ciphertext: string }>(`
    SELECT i.*, k.encrypted_value AS capi_access_token_ciphertext
    FROM marketing_integrations i
    JOIN marketing_integration_secrets k ON k.provider_key=i.provider_key AND k.secret_key='capi_access_token'
    WHERE i.provider_key=$1 AND i.enabled=true AND i.configuration->'capi'->>'enabled'='true'`, [META_PROVIDER])).rows[0];
  if (!row?.configuration.pixelId) return null;
  return { pixelId: row.configuration.pixelId, apiVersion: row.configuration.capi.apiVersion, token: readCapiToken(row.capi_access_token_ciphertext), revision: row.revision,
    testEventCode: row.configuration.testMode ? row.configuration.testEventCode : null };
}

export async function importLegacyConfiguration(pool: Queryable, actorId: string, input: { pixelId: string; websiteDomain: string; displayName?: string; expectedRevision: number }, auditContext = {}) {
  const current = await getAdminConfiguration(pool);
  const result = await saveConfiguration(pool, actorId, { expectedRevision: input.expectedRevision, configuration: {
    ...defaultConfiguration, displayName: input.displayName || 'CloudHost247 Meta Pixel (legacy import)',
    pixelId: input.pixelId, websiteDomain: input.websiteDomain, enabled: false,
  } }, auditContext);
  return { configuration: result, importedFrom: 'facebook_pixel_code', enabled: false, previousPixelId: current.pixelId };
}
