import { createHash, randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { NotFoundError } from '../lib/errors';
import { loadConfiguration } from './config-service';
import { requestConsent, consentGranted, safeSourceUrl, type ConsentRow } from './consent-service';
import { META_PROVIDER, runtimeConfiguration, type StandardEvent } from './types';
import { customDataSchema, type CustomData } from './event-service';

/** Meta advanced matching normalization, for eligible identifiers only. No identifier is sent by
 * default; this helper exists for a separately reviewed, consented future matching integration. */
export function hashCustomerIdentifier(kind: 'em' | 'ph' | 'fn' | 'ln' | 'ct' | 'st' | 'zp' | 'country', value: string): string {
  let normalized = value.trim().toLowerCase();
  if (kind === 'em') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Invalid email');
  } else if (kind === 'ph') normalized = normalized.replace(/[^0-9]/g, '');
  else if (kind === 'country') normalized = normalized.replace(/[^a-z]/g, '');
  else normalized = normalized.replace(/[\s().-]/g, '');
  if (!normalized || normalized.length > 320) throw new Error('Invalid matching identifier');
  return createHash('sha256').update(normalized).digest('hex');
}


/** Stable public catalog identifiers, shared by browser funnel events and verified Purchase.
 * Internal order-item UUIDs are a last resort only; they are not catalog content IDs. */
export function orderItemMarketingId(item: { id: string; product_slug?: string | null; plan_slug?: string | null; metadata?: Record<string, unknown> | null }): string {
  const metadata = item.metadata ?? {};
  if (metadata.kind === 'platform_plan' && typeof metadata.serviceKind === 'string' && typeof metadata.planCode === 'string') return `platform:${metadata.serviceKind}:${metadata.planCode}`;
  if (metadata.kind === 'domain_registration' && typeof metadata.registrationId === 'string') return `domain:${metadata.registrationId}`;
  if (item.product_slug && item.plan_slug) return `catalog:${item.product_slug}:${item.plan_slug}`;
  return item.id;
}
const ORDER_ITEM_MARKETING_SELECT = `oi.id, oi.quantity, p.slug AS product_slug, pp.slug AS plan_slug, oi.metadata
       FROM order_items oi
       LEFT JOIN products p ON p.id=oi.product_id
       LEFT JOIN product_plans pp ON pp.id=oi.plan_id`;

/** Called only after the business operation succeeds. Marketing failure never changes that result. */
export async function recordServerConversion(pool: Queryable, request: FastifyRequest, appUrl: string,
  event: { name: StandardEvent; id: string; data?: CustomData; sourceUrl?: string }): Promise<{ eventId: string; recorded: boolean } | null> {
  const consent = await requestConsent(pool, request);
  if (!consentGranted(consent)) return null;
  const data = customDataSchema.parse(event.data ?? {});
  return withTransaction(pool, tx => insertConversion(tx, { name: event.name, id: event.id, data, sourceUrl: safeSourceUrl(event.sourceUrl ?? request.headers.referer, appUrl), sessionId: consent!.id }));
}

async function insertConversion(tx: Queryable, event: { name: StandardEvent; id: string; data: CustomData; sourceUrl: string; sessionId: string; occurredAt?: string }) {
  const config = await loadConfiguration(tx);
  if (!config?.enabled || !config.configuration.pixelId) return { eventId: event.id, recorded: false };
  if (!runtimeConfiguration(config, new URL(event.sourceUrl).hostname).enabled) return { eventId: event.id, recorded: false };
  const consent = (await tx.query<ConsentRow>('SELECT * FROM marketing_consent_sessions WHERE id=$1 FOR UPDATE', [event.sessionId])).rows[0];
  if (!consentGranted(consent)) return { eventId: event.id, recorded: false };
  const inserted = await tx.query<{ id: string }>(`INSERT INTO marketing_events(id,provider_key,pixel_id,config_revision,event_name,event_id,custom_data,source_url,session_id,occurred_at,server_recorded_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10::timestamptz,now()),now())
    ON CONFLICT(provider_key,pixel_id,event_name,event_id) DO NOTHING RETURNING id`,
  [randomUUID(),META_PROVIDER,config.configuration.pixelId,config.revision,event.name,event.id,JSON.stringify(event.data),event.sourceUrl,event.sessionId,event.occurredAt ?? null]);
  if (!inserted.rows[0]) return { eventId: event.id, recorded: false };
  // Missing/disabled credentials are an honest not-queued state, not a fake successful delivery.
  if (config.configuration.capi.enabled && config.has_capi_token) {
    await tx.query(`INSERT INTO marketing_delivery_outbox(id,event_id) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING`, [randomUUID(),inserted.rows[0].id]);
  }
  return { eventId: event.id, recorded: true };
}

/** Transactional hook at the shared authoritative pending→successful payment transition.
 * No payment status, invoice status, ledger amount or gateway setting is changed here.
 */
export async function recordVerifiedPaymentBestEffort(tx: Queryable, paymentId: string): Promise<void> {
  await tx.query('SAVEPOINT marketing_verified_payment');
  try { await recordVerifiedPayment(tx, paymentId); await tx.query('RELEASE SAVEPOINT marketing_verified_payment'); }
  catch { await tx.query('ROLLBACK TO SAVEPOINT marketing_verified_payment'); await tx.query('RELEASE SAVEPOINT marketing_verified_payment'); }
}

export async function recordVerifiedPayment(tx: Queryable, paymentId: string): Promise<void> {
  const { rows } = await tx.query<{ id: string; amount: string; currency: string; completed_at: string; order_id: string; session_id: string; source_url: string }>(`
    SELECT p.id,p.amount,p.currency,p.completed_at,i.order_id,c.session_id,c.source_url
    FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN orders o ON o.id=i.order_id
    JOIN marketing_conversion_contexts c ON c.order_id=o.id
    WHERE p.id=$1 AND p.status='successful' AND p.amount>0 AND i.status='paid' AND o.payment_status='paid'`, [paymentId]);
  const payment = rows[0]; if (!payment) return;
  const items = (await tx.query<{ id: string; quantity: number; product_slug: string | null; plan_slug: string | null; metadata: Record<string, unknown> | null }>(`SELECT ${ORDER_ITEM_MARKETING_SELECT} WHERE oi.order_id=$1 ORDER BY oi.created_at,oi.id`, [payment.order_id])).rows;
  const contents = items.map(item => ({ id: orderItemMarketingId(item), quantity: item.quantity }));
  await insertConversion(tx, { name: 'Purchase', id: `purchase:${payment.id}`, sessionId: payment.session_id, sourceUrl: payment.source_url, occurredAt: payment.completed_at,
    data: { value: Number(payment.amount), currency: payment.currency, content_type: 'product', content_ids: contents.map(c => c.id), contents, num_items: contents.reduce((n,c) => n+c.quantity,0) } });
}

/** Browser receipts are derived from payment rows, never client-supplied amounts or modal state. */
export async function verifiedPurchaseReceipt(pool: Queryable, userId: string, invoiceId: string, sessionId: string) {
  const payment = (await pool.query<{ id: string; amount: string; currency: string; order_id: string }>(`SELECT p.id,p.amount,p.currency,i.order_id FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN orders o ON o.id=i.order_id
    WHERE p.invoice_id=$1 AND i.user_id=$2 AND p.status='successful' AND i.status='paid' AND o.payment_status='paid'
      AND EXISTS(SELECT 1 FROM marketing_conversion_contexts c WHERE c.order_id=i.order_id AND c.session_id=$3)
    ORDER BY p.completed_at DESC LIMIT 1`, [invoiceId,userId,sessionId])).rows[0];
  if (!payment) throw new NotFoundError('No verified successful payment is available for this invoice');
  const items = (await pool.query<{ id: string; quantity: number; product_slug: string | null; plan_slug: string | null; metadata: Record<string, unknown> | null }>(`SELECT ${ORDER_ITEM_MARKETING_SELECT} WHERE oi.order_id=$1 ORDER BY oi.created_at,oi.id`, [payment.order_id])).rows;
  const contents = items.map(item => ({ id: orderItemMarketingId(item), quantity: item.quantity }));
  return { verified: true as const, status: 'successful' as const, eventId: `purchase:${payment.id}`,
    customData: { value: Number(payment.amount), currency: payment.currency, content_type: 'product' as const, content_ids: contents.map(c => c.id), contents, num_items: contents.reduce((n,c) => n+c.quantity,0) } };
}
