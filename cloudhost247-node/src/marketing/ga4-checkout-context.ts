import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db/types';
import { requestConsent, type ConsentRow } from './consent-service';
import { ga4Runtime } from './ga4-config';
import { CONSENT_POLICY_VERSION } from './types';

/** Checkout attribution is independent of Meta/marketing consent. This module does not emit events. */
export function analyticsConsentGranted(row: ConsentRow | null | undefined): boolean {
  return Boolean(row && row.decided && row.policy_version === CONSENT_POLICY_VERSION &&
    row.preferences?.analytics === true && new Date(row.expires_at).getTime() > Date.now());
}
export interface Ga4CheckoutContext { sessionId: string; hostname: string; revision: number }

/** Request-derived only: never accept a session ID, hostname or GA identifier from a body. */
export async function ga4CheckoutContext(db: Queryable, request: FastifyRequest): Promise<Ga4CheckoutContext | null> {
  try {
    const [consent, runtime] = await Promise.all([requestConsent(db, request), ga4Runtime(db, request.hostname)]);
    if (!analyticsConsentGranted(consent) || !runtime.enabled) return null;
    return { sessionId: consent!.id, hostname: request.hostname, revision: runtime.revision };
  } catch { return null; }
}

/**
 * Recheck both the configuration and consent under row locks within the order transaction.
 * Withdrawal takes the same session lock and deletes contexts, so a concurrent opt-out cannot
 * leave a usable attribution. An analytics outage never prevents a valid customer order.
 */
export async function attachGa4CheckoutContext(tx: Queryable, orderId: string, context: Ga4CheckoutContext | null | undefined): Promise<void> {
  if (!context) return;
  await tx.query('SAVEPOINT ga4_order_context');
  try {
    await tx.query("SELECT provider_key FROM marketing_integrations WHERE provider_key='google_analytics' FOR UPDATE");
    const runtime = await ga4Runtime(tx, context.hostname);
    const consent = (await tx.query<ConsentRow>('SELECT * FROM marketing_consent_sessions WHERE id=$1 FOR UPDATE', [context.sessionId])).rows[0];
    if (runtime.enabled && runtime.revision === context.revision && analyticsConsentGranted(consent)) {
      await tx.query(`INSERT INTO ga4_checkout_contexts(order_id,consent_session_id,config_revision,client_id_ciphertext,measurement_id)
        SELECT $1,$2,$3,b.client_id_ciphertext,b.measurement_id FROM (SELECT 1) x
        LEFT JOIN ga4_browser_ids b ON b.consent_session_id=$2 AND b.config_revision=$3 AND b.measurement_id=$4
        ON CONFLICT(order_id) DO NOTHING`, [orderId, context.sessionId, context.revision, runtime.measurementId]);
    }
    await tx.query('RELEASE SAVEPOINT ga4_order_context');
  } catch {
    await tx.query('ROLLBACK TO SAVEPOINT ga4_order_context');
    await tx.query('RELEASE SAVEPOINT ga4_order_context');
  }
}
