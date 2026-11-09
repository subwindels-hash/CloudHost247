import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { recordAudit } from '../lib/audit';
import { encryptSecret, decryptSecret, DecryptionError, MissingEncryptionKeyError } from '../lib/crypto';
import { getKeyRing } from '../lib/keyring';
import { ConflictError, HttpError, ValidationError } from '../lib/errors';
import { CONSENT_POLICY_VERSION } from '../marketing/types';
import { TIKTOK_PROVIDER, TIKTOK_SECRET_KEY, tiktokConfigurationSchema, tiktokConfigurationDTO, defaultTikTokConfiguration, type TikTokIntegrationRow, type TikTokConfiguration } from './types';

const SELECT = `SELECT i.*, EXISTS(SELECT 1 FROM marketing_integration_secrets s WHERE s.provider_key=i.provider_key AND s.secret_key='${TIKTOK_SECRET_KEY}') AS has_events_api_token FROM marketing_integrations i WHERE provider_key=$1`;
const CANCEL_PENDING = `UPDATE marketing_delivery_outbox SET status='cancelled',worker_id=NULL,lease_until=NULL,last_error='TikTok integration configuration changed before delivery',updated_at=now()
  WHERE status IN ('queued','retry','processing') AND event_id IN (SELECT id FROM marketing_events WHERE provider_key='${TIKTOK_PROVIDER}')`;

export async function loadTikTokConfiguration(pool: Queryable): Promise<TikTokIntegrationRow | null> {
  const { rows } = await pool.query<TikTokIntegrationRow>(SELECT, [TIKTOK_PROVIDER]);
  return rows[0] ?? null;
}

function fallbackRow(): TikTokIntegrationRow {
  return {
    provider_key: TIKTOK_PROVIDER, display_name: defaultTikTokConfiguration.displayName,
    website_domain: '', enabled: false, configuration: defaultTikTokConfiguration, revision: 0,
    last_configuration_update: null, last_configuration_test_at: null,
    last_configuration_test_status: null, last_error: null,
    created_at: '', updated_at: '', has_events_api_token: false,
  };
}

export async function getTikTokAdminConfiguration(pool: Queryable) {
  const row = await loadTikTokConfiguration(pool);
  return tiktokConfigurationDTO(row ?? fallbackRow());
}

export interface SaveTikTokInput { configuration: TikTokConfiguration; expectedRevision: number; eventsApiAccessToken?: string; removeEventsApiToken?: boolean }

/** Configuration and its audit record commit together. Token material never enters audit JSON. */
export async function saveTikTokConfiguration(pool: Queryable, actorId: string, input: SaveTikTokInput, auditContext = {}) {
  const parsed = tiktokConfigurationSchema.safeParse(input.configuration);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const config = parsed.data;
  if (input.removeEventsApiToken && input.eventsApiAccessToken) throw new ValidationError('Choose either token replacement or removal, not both');
  if (input.removeEventsApiToken && config.eventsApi.enabled) throw new ValidationError('Disable the Events API before removing its token');
  // Fail before opening a transaction if encryption is unavailable; never store plaintext fallback.
  let encrypted: string | null = null;
  if (input.eventsApiAccessToken) {
    if (!/^[A-Za-z0-9_|.-]{20,4096}$/.test(input.eventsApiAccessToken)) throw new ValidationError('The TikTok access token format is invalid');
    try { encrypted = encryptSecret(getKeyRing(), input.eventsApiAccessToken); }
    catch (error) {
      if (error instanceof MissingEncryptionKeyError) throw new HttpError(503, 'Configure CREDENTIAL_ENCRYPTION_KEY before storing a TikTok access token', 'CONFIGURATION_REQUIRED');
      throw error;
    }
  }
  return withTransaction(pool, async tx => {
    const { rows } = await tx.query<TikTokIntegrationRow>(`${SELECT} FOR UPDATE`, [TIKTOK_PROVIDER]);
    const row = rows[0];
    if (!row || row.revision !== input.expectedRevision) throw new ConflictError('Configuration changed since it was loaded. Reload before saving.');
    const hasToken = input.removeEventsApiToken ? false : Boolean(encrypted || row.has_events_api_token);
    if (config.eventsApi.enabled && !hasToken) throw new ValidationError('An authorized TikTok Events API access token must be stored before the Events API can be enabled');
    if (encrypted) {
      await tx.query(`INSERT INTO marketing_integration_secrets(provider_key,secret_key,encrypted_value,rotated_by) VALUES ($1,$2,$3,$4)
        ON CONFLICT(provider_key,secret_key) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value,rotated_by=EXCLUDED.rotated_by,rotated_at=now()`, [TIKTOK_PROVIDER, TIKTOK_SECRET_KEY, encrypted, actorId]);
    }
    if (input.removeEventsApiToken) await tx.query(`DELETE FROM marketing_integration_secrets WHERE provider_key=$1 AND secret_key=$2`, [TIKTOK_PROVIDER, TIKTOK_SECRET_KEY]);
    // A disabled/retargeted integration must not leave a silently stranded outbox. Token
    // rotation alone keeps the same destination, so queued events may use the new credential.
    const destinationChanged = row.configuration.pixelId !== config.pixelId || row.website_domain !== config.websiteDomain;
    if (!config.enabled || !config.eventsApi.enabled || input.removeEventsApiToken || destinationChanged) {
      await tx.query(CANCEL_PENDING);
    }
    const { rows: updated } = await tx.query<TikTokIntegrationRow>(`UPDATE marketing_integrations SET display_name=$1,website_domain=$2,enabled=$3,configuration=$4,
      revision=revision+1,last_configuration_update=now(),updated_by=$5,updated_at=now(),last_error=NULL WHERE provider_key=$6 RETURNING *`,
    [config.displayName, config.websiteDomain, config.enabled, JSON.stringify(config), actorId, TIKTOK_PROVIDER]);
    const after = tiktokConfigurationDTO({ ...updated[0]!, has_events_api_token: hasToken });
    await recordAudit(tx, { actorId, action: 'marketing.tiktok_pixel.configuration_saved', resourceType: 'marketing_integration', resourceId: TIKTOK_PROVIDER,
      metadata: { before: tiktokConfigurationDTO(row), after, tokenRotated: Boolean(encrypted), tokenRemoved: Boolean(input.removeEventsApiToken) } }, auditContext);
    return after;
  });
}

/**
 * Honest local configuration verification. A public Pixel ID cannot prove
 * TikTok account ownership or event receipt, and no TikTok endpoint is
 * contacted here — live verification happens in TikTok Events Manager /
 * Test Events with real account credentials (documented as an external step).
 */
export async function testTikTokConfiguration(pool: Queryable, actorId: string, auditContext = {}) {
  return withTransaction(pool, async tx => {
    const row = (await tx.query<TikTokIntegrationRow>(`${SELECT} FOR UPDATE`, [TIKTOK_PROVIDER])).rows[0];
    const config = row ? tiktokConfigurationSchema.safeParse(row.configuration) : null;
    const status = !row ? 'MISSING_CONFIGURATION' : !config?.success || !row.configuration.pixelId ? 'INVALID_CONFIGURATION' : !row.enabled ? 'DISABLED' : 'CONFIGURATION_VALID';
    await tx.query(`UPDATE marketing_integrations SET last_configuration_test_at=now(),last_configuration_test_status=$1 WHERE provider_key=$2`, [status, TIKTOK_PROVIDER]);
    await recordAudit(tx, { actorId, action: 'marketing.tiktok_pixel.configuration_tested', resourceType: 'marketing_integration', resourceId: TIKTOK_PROVIDER, metadata: { status, providerContacted: false } }, auditContext);
    return { status, providerContacted: false as const, tiktokReceiptVerified: false as const,
      message: status === 'CONFIGURATION_VALID' ? 'Saved configuration is valid. Verify browser events in TikTok Events Manager (Test Events); this test did not contact TikTok.' : 'Configuration is not ready. Review the Pixel ID, domain and enabled state.' };
  });
}

export async function resetTikTokConfiguration(pool: Queryable, actorId: string, expectedRevision: number, auditContext = {}) {
  return withTransaction(pool, async tx => {
    const row = (await tx.query<TikTokIntegrationRow>(`${SELECT} FOR UPDATE`, [TIKTOK_PROVIDER])).rows[0];
    if (!row || row.revision !== expectedRevision) throw new ConflictError('Configuration changed. Reload before resetting.');
    await tx.query(`DELETE FROM marketing_integration_secrets WHERE provider_key=$1`, [TIKTOK_PROVIDER]);
    await tx.query(CANCEL_PENDING);
    const { rows } = await tx.query<TikTokIntegrationRow>(`UPDATE marketing_integrations SET display_name=$1,website_domain='',enabled=false,configuration=$2,
      revision=revision+1,last_configuration_update=now(),last_configuration_test_at=NULL,last_configuration_test_status=NULL,last_error=NULL,updated_by=$3,updated_at=now() WHERE provider_key=$4 RETURNING *`,
    [defaultTikTokConfiguration.displayName, JSON.stringify(defaultTikTokConfiguration), actorId, TIKTOK_PROVIDER]);
    await recordAudit(tx, { actorId, action: 'marketing.tiktok_pixel.configuration_reset', resourceType: 'marketing_integration', resourceId: TIKTOK_PROVIDER,
      metadata: { before: tiktokConfigurationDTO(row), after: tiktokConfigurationDTO({ ...rows[0]!, has_events_api_token: false }), pendingDeliveriesCancelled: true } }, auditContext);
    return tiktokConfigurationDTO({ ...rows[0]!, has_events_api_token: false });
  });
}

export async function listTikTokActivity(pool: Queryable, limit = 50, offset = 0) {
  const { rows } = await pool.query(`SELECT e.id,e.event_name,e.event_id,e.pixel_id,e.custom_data,e.occurred_at,e.browser_dispatched_at,e.server_recorded_at,
    CASE WHEN e.browser_dispatched_at IS NOT NULL AND e.server_recorded_at IS NOT NULL THEN 'browser_and_server' WHEN e.server_recorded_at IS NOT NULL THEN 'server' WHEN e.browser_dispatched_at IS NOT NULL THEN 'browser' ELSE 'server_recorded' END AS channel,
    o.status AS delivery_status,o.attempts,o.http_status,o.events_received,o.last_error,o.delivered_at,o.next_attempt_at,
    (s.id IS NOT NULL AND s.decided AND s.policy_version=$4 AND (s.preferences->>'marketing')::boolean AND s.expires_at>now()) AS marketing_consent_current,
    (SELECT count(*)::int FROM marketing_events d WHERE d.provider_key=e.provider_key AND d.pixel_id=e.pixel_id AND d.event_name=e.event_name AND d.event_id=e.event_id) AS same_event_id_count
    FROM marketing_events e LEFT JOIN marketing_delivery_outbox o ON o.event_id=e.id LEFT JOIN marketing_consent_sessions s ON s.id=e.session_id
    WHERE e.provider_key=$1 ORDER BY e.created_at DESC LIMIT $2 OFFSET $3`, [TIKTOK_PROVIDER, limit, offset, CONSENT_POLICY_VERSION]);
  return rows;
}

export async function tiktokConfigurationAudit(pool: Queryable) {
  return (await pool.query(`SELECT id,action,metadata,created_at,actor_id FROM audit_logs WHERE resource_type='marketing_integration' AND resource_id=$1 ORDER BY created_at DESC LIMIT 50`, [TIKTOK_PROVIDER])).rows;
}

export function readTikTokToken(encrypted: string): string {
  try { return decryptSecret(getKeyRing(), encrypted); }
  catch (error) {
    if (error instanceof DecryptionError || error instanceof MissingEncryptionKeyError) throw new HttpError(503, 'TikTok credential unavailable; an administrator must review encryption configuration', 'CONFIGURATION_REQUIRED');
    throw error;
  }
}

export async function loadEventsApiCredentials(pool: Queryable) {
  // One SQL statement is one PostgreSQL snapshot: configuration, revision, test
  // code and ciphertext cannot straddle a committed token rotation.
  const row = (await pool.query<TikTokIntegrationRow & { events_api_access_token_ciphertext: string }>(`
    SELECT i.*, k.encrypted_value AS events_api_access_token_ciphertext
    FROM marketing_integrations i
    JOIN marketing_integration_secrets k ON k.provider_key=i.provider_key AND k.secret_key='${TIKTOK_SECRET_KEY}'
    WHERE i.provider_key=$1 AND i.enabled=true AND i.configuration->'eventsApi'->>'enabled'='true'`, [TIKTOK_PROVIDER])).rows[0];
  if (!row?.configuration.pixelId) return null;
  return { pixelId: row.configuration.pixelId, token: readTikTokToken(row.events_api_access_token_ciphertext), revision: row.revision,
    testEventCode: row.configuration.testMode ? row.configuration.testEventCode : null };
}
