import type { Queryable } from '../db/types';
import type { Env } from '../config/env';
import { withTransaction } from '../db/transaction';
import { encryptSecret } from '../lib/crypto';
import { getKeyRing } from '../lib/keyring';
import { ga4Runtime } from './ga4-config';
import { analyticsConsentGranted } from './ga4-checkout-context';
import type { ConsentRow } from './consent-service';
import { ga4PurchaseCredentials } from './ga4-purchase-config';

/** A Google gtag `get` client_id, never inferred from an email, account or other identifier. */
export const ga4ClientIdPattern = /^[0-9]{1,20}\.[0-9]{1,20}$/;

export async function saveGa4BrowserId(db: Queryable, env: Env, sessionId: string, hostname: string, revision: number, consentRevision: number, clientId: string): Promise<boolean> {
  if (!ga4ClientIdPattern.test(clientId)) return false;
  return withTransaction(db, async tx => {
    // Identical lock ordering to the checkout-context write.
    await tx.query("SELECT provider_key FROM marketing_integrations WHERE provider_key='google_analytics' FOR UPDATE");
    const runtime = await ga4Runtime(tx, hostname);
    const consent = (await tx.query<ConsentRow>('SELECT * FROM marketing_consent_sessions WHERE id=$1 FOR UPDATE', [sessionId])).rows[0];
    if (!runtime.enabled || runtime.revision !== revision || !analyticsConsentGranted(consent) || consent?.ga4_consent_revision !== consentRevision || !ga4PurchaseCredentials(env, runtime.measurementId)) return false;
    const ciphertext = encryptSecret(getKeyRing(), clientId);
    await tx.query(`INSERT INTO ga4_browser_ids(consent_session_id,config_revision,measurement_id,client_id_ciphertext)
      VALUES($1,$2,$3,$4) ON CONFLICT(consent_session_id) DO UPDATE SET config_revision=EXCLUDED.config_revision,measurement_id=EXCLUDED.measurement_id,client_id_ciphertext=EXCLUDED.client_id_ciphertext,updated_at=now()`, [sessionId, revision, runtime.measurementId, ciphertext]);
    return true;
  });
}
