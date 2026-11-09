import { CONSENT_POLICY_VERSION } from './types';
import { currencyDefinition, isSupportedCurrency } from '../currency/registry';
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import type { Env } from '../config/env';
import { decryptSecret } from '../lib/crypto';
import { getKeyRing } from '../lib/keyring';
import { findGa4PaidCandidate } from './ga4-paid-candidate';
import { ga4ClientIdPattern } from './ga4-browser-id';
import { ga4PurchaseCredentials } from './ga4-purchase-config';
import { isGa4PurchaseDeliverySafe } from './ga4-purchase-safety';

interface Context { order_id: string; client_id_ciphertext: string; measurement_id: string; test_mode: boolean }
async function purchaseContext(db: Queryable, paymentId: string): Promise<Context | null> {
  return (await db.query<Context>(`SELECT c.order_id,c.client_id_ciphertext,c.measurement_id,coalesce((g.configuration->>'testMode')::boolean,false) AS test_mode FROM payments p
    JOIN invoices i ON i.id=p.invoice_id JOIN ga4_checkout_contexts c ON c.order_id=i.order_id
    JOIN marketing_integrations g ON g.provider_key='google_analytics' AND g.revision=c.config_revision
    WHERE p.id=$1 AND c.client_id_ciphertext IS NOT NULL AND c.measurement_id=g.configuration->>'measurementId'`, [paymentId])).rows[0] ?? null;
}

/** Called inside the authoritative payment transaction. No network request is made here. */
export async function queueGa4Purchase(tx: Queryable, env: Env, paymentId: string): Promise<boolean> {
  if (!isGa4PurchaseDeliverySafe()) return false;
  const candidate = await findGa4PaidCandidate(tx, paymentId);
  const context = candidate && await purchaseContext(tx, paymentId);
  if (!candidate || !isSupportedCurrency(candidate.currency) ||
      (currencyDefinition(candidate.currency).zeroDecimal && (candidate.value % 1 !== 0 || candidate.items.some(item => item.price % 1 !== 0))) ||
      !context || !ga4PurchaseCredentials(env, context.measurement_id)) return false;
  const inserted = await tx.query(`INSERT INTO ga4_purchase_outbox(order_id,payment_id,status) VALUES($1,$2,'queued')
    ON CONFLICT(order_id) DO NOTHING RETURNING order_id`, [context.order_id, paymentId]);
  return inserted.rows.length === 1;
}

/** Isolate optional analytics failures from settlement. */
export async function queueGa4PurchaseBestEffort(tx: Queryable, env: Env, paymentId: string): Promise<void> {
  await tx.query('SAVEPOINT ga4_paid_event');
  try { await queueGa4Purchase(tx, env, paymentId); await tx.query('RELEASE SAVEPOINT ga4_paid_event'); }
  catch { await tx.query('ROLLBACK TO SAVEPOINT ga4_paid_event'); await tx.query('RELEASE SAVEPOINT ga4_paid_event'); }
}

export interface Ga4DrainResult { claimed: number; httpAccepted: number; unknown: number; cancelled: number }
/**
 * At-most-one network attempt per order: a crash, timeout or non-2xx response is ambiguous and
 * becomes unknown, never blindly retried. HTTP 2xx is transport acceptance, not Google validation.
 * A current consent/paid-state check immediately precedes dispatch. A withdrawal after a request
 * leaves the process cannot retract it. No secret, client ID or URL is returned or logged.
 */
export async function drainGa4Purchases(db: Queryable, env: Env, options: { fetchImpl?: typeof fetch; limit?: number; timeoutMs?: number } = {}): Promise<Ga4DrainResult> {
  const result: Ga4DrainResult = { claimed: 0, httpAccepted: 0, unknown: 0, cancelled: 0 };
  if (!isGa4PurchaseDeliverySafe() || !ga4PurchaseCredentials(env, env.GA4_PURCHASE_MEASUREMENT_ID ?? null)) return result;
  const stale = await db.query(`UPDATE ga4_purchase_outbox SET status='unknown',claim_token=NULL,lease_until=NULL,updated_at=now()
    WHERE status='sending' AND lease_until<now() RETURNING order_id`);
  result.unknown += stale.rows.length;
  // Abandoned in-flight claims after withdrawal must never be retried or retain claim tokens.
  await db.query(`UPDATE ga4_purchase_outbox SET claim_token=NULL,lease_until=NULL,updated_at=now()
    WHERE status='unknown' AND claim_token IS NOT NULL AND lease_until<now()`);
  for (const row of stale.rows as Array<{ order_id: string }>) {
    await db.query('UPDATE ga4_checkout_contexts SET client_id_ciphertext=NULL,measurement_id=NULL WHERE order_id=$1', [row.order_id]);
  }
  for (let i = 0; i < Math.min(50, Math.max(1, options.limit ?? 10)); i++) {
    const token = randomUUID();
    const claim = (await db.query<{ order_id: string; payment_id: string }>(`WITH next AS (
      SELECT order_id FROM ga4_purchase_outbox WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE ga4_purchase_outbox o SET status='sending',claim_token=$1,lease_until=now()+interval '5 minutes',updated_at=now()
      FROM next WHERE o.order_id=next.order_id RETURNING o.order_id,o.payment_id`, [token])).rows[0];
    if (!claim) break;
    result.claimed++;
    const finish = async (status: 'http_accepted' | 'unknown' | 'cancelled', httpStatus: number | null = null) => {
      const updated = await db.query(`UPDATE ga4_purchase_outbox SET status=$1,http_status=$2,claim_token=NULL,lease_until=NULL,updated_at=now()
        WHERE order_id=$3 AND status IN ('sending','unknown') AND claim_token=$4 RETURNING order_id`, [status,httpStatus,claim.order_id,token]);
      if (!updated.rows.length) return;
      // The terminal tombstone is sufficient for deduplication; remove the encrypted checkout ID.
      await db.query('UPDATE ga4_checkout_contexts SET client_id_ciphertext=NULL,measurement_id=NULL WHERE order_id=$1', [claim.order_id]);
      if (status === 'http_accepted') result.httpAccepted++;
      else if (status === 'unknown') result.unknown++;
      else result.cancelled++;
    };
    let attempted = false;
    try {
      const candidate = await findGa4PaidCandidate(db, claim.payment_id);
      const context = candidate && await purchaseContext(db, claim.payment_id);
      const credentials = context && ga4PurchaseCredentials(env, context.measurement_id);
      if (!candidate || !isSupportedCurrency(candidate.currency) || (currencyDefinition(candidate.currency).zeroDecimal && (candidate.value % 1 !== 0 || candidate.items.some(item => item.price % 1 !== 0))) || !context || !credentials || context.order_id !== claim.order_id) { await finish('cancelled'); continue; }
      const clientId = decryptSecret(getKeyRing(), context.client_id_ciphertext);
      if (!ga4ClientIdPattern.test(clientId)) { await finish('cancelled'); continue; }
      // Withdrawal can cancel a claimed row; check once more immediately before sending.
      const eligible = (await db.query(`SELECT 1 FROM ga4_purchase_outbox o JOIN ga4_checkout_contexts c ON c.order_id=o.order_id
        JOIN marketing_consent_sessions s ON s.id=c.consent_session_id JOIN marketing_integrations g ON g.provider_key='google_analytics'
        JOIN payments p ON p.id=o.payment_id JOIN invoices i ON i.id=p.invoice_id JOIN orders ord ON ord.id=i.order_id
        WHERE o.order_id=$1 AND o.status='sending' AND o.claim_token=$2 AND s.decided=true AND s.policy_version=$3
        AND s.preferences->>'analytics'='true' AND s.expires_at>now() AND g.enabled=true AND g.revision=c.config_revision
        AND p.status='successful' AND p.provider='manual' AND i.status='paid' AND ord.payment_status='paid'
        AND p.completed_at > now()-interval '72 hours'`, [claim.order_id,token,CONSENT_POLICY_VERSION])).rows.length;
      if (!eligible) { await finish('cancelled'); continue; }
      const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(credentials.measurementId)}&api_secret=${encodeURIComponent(credentials.apiSecret)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(60_000, Math.max(1000, options.timeoutMs ?? 10_000)));
      let response: Response;
      try {
        attempted = true;
        response = await (options.fetchImpl ?? fetch)(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ client_id: clientId, consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' }, events: [{ name: 'purchase', params: { transaction_id: claim.order_id, currency: candidate.currency, value: candidate.value, items: candidate.items, ...(context.test_mode ? { debug_mode: true } : {}) } }] }) });
      } catch { await finish('unknown'); continue; }
      finally { clearTimeout(timer); }
      await finish(response.ok ? 'http_accepted' : 'unknown', response.status);
    } catch { await finish(attempted ? 'unknown' : 'cancelled'); }
  }
  return result;
}
