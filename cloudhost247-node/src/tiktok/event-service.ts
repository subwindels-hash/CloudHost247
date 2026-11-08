import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { NotFoundError, ValidationError } from '../lib/errors';
import { loadTikTokConfiguration } from './config-service';
import { TIKTOK_PROVIDER, TIKTOK_EVENTS, tiktokRuntimeConfiguration, type TikTokEvent } from './types';
import { consentGranted, requestConsent, safeSourceUrl, type ConsentRow } from '../marketing/consent-service';
import { customDataSchema, type CustomData } from '../marketing/event-service';
import { orderItemMarketingId } from '../marketing/conversion-service';

export { customDataSchema, type CustomData };

const eventSchema = z.object({
  eventName: z.enum(TIKTOK_EVENTS).refine(v => v !== 'CompletePayment', 'CompletePayment requires backend payment confirmation'),
  eventId: z.string().min(8).max(128).regex(/^[A-Za-z0-9:._-]+$/),
  customData: customDataSchema.default({}),
  sourceUrl: z.string().max(4096).optional(),
}).strict();
const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(20) }).strict();

/**
 * Records browser dispatches for deduplication diagnostics. The browser pixel
 * has already fired (or not) in the visitor's browser; this ledger is what
 * lets the server use the SAME event_id for the Events API copy. CompletePayment
 * is refused here: only recordVerifiedTikTokPayment may create it.
 */
export async function recordTikTokBrowserEvents(pool: Queryable, input: unknown, sessionId: string, appUrl: string) {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(i => i.message).join('; '));
  const config = await loadTikTokConfiguration(pool);
  const runtime = config ? tiktokRuntimeConfiguration(config, new URL(appUrl).hostname) : null;
  if (!runtime?.enabled || !config?.configuration.pixelId) return { recorded: 0, duplicates: 0, status: 'integration_disabled' };
  const consent = (await pool.query<ConsentRow>(`SELECT * FROM marketing_consent_sessions WHERE id=$1`, [sessionId])).rows[0] ?? null;
  if (!consentGranted(consent)) return { recorded: 0, duplicates: 0, status: 'consent_required' };
  let recorded = 0, duplicates = 0;
  for (const event of parsed.data.events) {
    if (!config.configuration.enabledEvents.includes(event.eventName)) { duplicates++; continue; }
    // Remarketing-gated events: ViewContent carries the product context used for
    // audience building, so it is suppressed when remarketing is disabled.
    const result = await pool.query<{ inserted: boolean }>(`INSERT INTO marketing_events(id,provider_key,pixel_id,config_revision,event_name,event_id,custom_data,source_url,session_id,occurred_at,browser_dispatched_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now()) ON CONFLICT(provider_key,pixel_id,event_name,event_id)
      DO UPDATE SET browser_dispatched_at=COALESCE(marketing_events.browser_dispatched_at,now())
      WHERE marketing_events.session_id=EXCLUDED.session_id RETURNING id,(xmax=0) AS inserted`,
    [randomUUID(), TIKTOK_PROVIDER, config.configuration.pixelId, config.revision, event.eventName, event.eventId, JSON.stringify(event.customData), safeSourceUrl(event.sourceUrl, appUrl), sessionId]);
    if (result.rows[0]?.inserted) recorded++; else duplicates++;
  }
  return { recorded, duplicates, status: 'recorded' };
}

async function insertTikTokConversion(tx: Queryable, event: { name: TikTokEvent; id: string; data: CustomData; sourceUrl: string; sessionId: string; occurredAt?: string }) {
  const config = await loadTikTokConfiguration(tx);
  if (!config?.enabled || !config.configuration.pixelId) return { eventId: event.id, recorded: false };
  if (!config.configuration.enabledEvents.includes(event.name)) return { eventId: event.id, recorded: false };
  if (!tiktokRuntimeConfiguration(config, new URL(event.sourceUrl).hostname).enabled) return { eventId: event.id, recorded: false };
  const consent = (await tx.query<ConsentRow>('SELECT * FROM marketing_consent_sessions WHERE id=$1 FOR UPDATE', [event.sessionId])).rows[0];
  if (!consentGranted(consent)) return { eventId: event.id, recorded: false };
  const inserted = await tx.query<{ id: string }>(`INSERT INTO marketing_events(id,provider_key,pixel_id,config_revision,event_name,event_id,custom_data,source_url,session_id,occurred_at,server_recorded_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10::timestamptz,now()),now())
    ON CONFLICT(provider_key,pixel_id,event_name,event_id) DO NOTHING RETURNING id`,
  [randomUUID(), TIKTOK_PROVIDER, config.configuration.pixelId, config.revision, event.name, event.id, JSON.stringify(event.data), event.sourceUrl, event.sessionId, event.occurredAt ?? null]);
  if (!inserted.rows[0]) return { eventId: event.id, recorded: false };
  // Missing/disabled credentials are an honest not-queued state, not a fake successful delivery.
  if (config.configuration.eventsApi.enabled && config.has_events_api_token) {
    await tx.query(`INSERT INTO marketing_delivery_outbox(id,event_id) VALUES($1,$2) ON CONFLICT(event_id) DO NOTHING`, [randomUUID(), inserted.rows[0].id]);
  }
  return { eventId: event.id, recorded: true };
}

/** Called only after the business operation succeeds. Marketing failure never changes that result. */
export async function recordTikTokServerConversion(pool: Queryable, request: FastifyRequest, appUrl: string,
  event: { name: TikTokEvent; id: string; data?: CustomData; sourceUrl?: string }): Promise<{ eventId: string; recorded: boolean } | null> {
  const consent = await requestConsent(pool, request);
  if (!consentGranted(consent)) return null;
  const data = customDataSchema.parse(event.data ?? {});
  return withTransaction(pool, tx => insertTikTokConversion(tx, { name: event.name, id: event.id, data, sourceUrl: safeSourceUrl(event.sourceUrl ?? request.headers.referer, appUrl), sessionId: consent!.id }));
}

const ORDER_ITEM_SELECT = `oi.id, oi.quantity, p.slug AS product_slug, pp.slug AS plan_slug, oi.metadata
       FROM order_items oi
       LEFT JOIN products p ON p.id=oi.product_id
       LEFT JOIN product_plans pp ON pp.id=oi.plan_id`;

/**
 * Transactional hook at the shared authoritative pending→successful payment
 * transition (same call sites as Meta's recordVerifiedPaymentBestEffort).
 * No payment status, invoice status, ledger amount or gateway setting is
 * changed here. Event ID is `purchase:<payment UUID>` — identical in shape to
 * the Meta convention, scoped per-provider by the events unique key, so the
 * browser receipt and the Events API copy deduplicate at TikTok.
 */
export async function recordVerifiedTikTokPaymentBestEffort(tx: Queryable, paymentId: string): Promise<void> {
  await tx.query('SAVEPOINT tiktok_verified_payment');
  try { await recordVerifiedTikTokPayment(tx, paymentId); await tx.query('RELEASE SAVEPOINT tiktok_verified_payment'); }
  catch { await tx.query('ROLLBACK TO SAVEPOINT tiktok_verified_payment'); await tx.query('RELEASE SAVEPOINT tiktok_verified_payment'); }
}

export async function recordVerifiedTikTokPayment(tx: Queryable, paymentId: string): Promise<void> {
  const { rows } = await tx.query<{ id: string; amount: string; currency: string; completed_at: string; order_id: string; session_id: string; source_url: string }>(`
    SELECT p.id,p.amount,p.currency,p.completed_at,i.order_id,c.session_id,c.source_url
    FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN orders o ON o.id=i.order_id
    JOIN marketing_conversion_contexts c ON c.order_id=o.id
    WHERE p.id=$1 AND p.status='successful' AND p.amount>0 AND i.status='paid' AND o.payment_status='paid'`, [paymentId]);
  const payment = rows[0]; if (!payment) return;
  const items = (await tx.query<{ id: string; quantity: number; product_slug: string | null; plan_slug: string | null; metadata: Record<string, unknown> | null }>(`SELECT ${ORDER_ITEM_SELECT} WHERE oi.order_id=$1 ORDER BY oi.created_at,oi.id`, [payment.order_id])).rows;
  const contents = items.map(item => ({ id: orderItemMarketingId(item), quantity: item.quantity }));
  await insertTikTokConversion(tx, { name: 'CompletePayment', id: `purchase:${payment.id}`, sessionId: payment.session_id, sourceUrl: payment.source_url, occurredAt: payment.completed_at,
    data: { value: Number(payment.amount), currency: payment.currency, content_type: 'product', content_ids: contents.map(c => c.id), contents, num_items: contents.reduce((n, c) => n + c.quantity, 0) } });
}

/** Browser receipts are derived from payment rows, never client-supplied amounts or modal state. */
export async function verifiedTikTokPurchaseReceipt(pool: Queryable, userId: string, invoiceId: string, sessionId: string) {
  const payment = (await pool.query<{ id: string; amount: string; currency: string; order_id: string }>(`SELECT p.id,p.amount,p.currency,i.order_id FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN orders o ON o.id=i.order_id
    WHERE p.invoice_id=$1 AND i.user_id=$2 AND p.status='successful' AND i.status='paid' AND o.payment_status='paid'
      AND EXISTS(SELECT 1 FROM marketing_conversion_contexts c WHERE c.order_id=i.order_id AND c.session_id=$3)
    ORDER BY p.completed_at DESC LIMIT 1`, [invoiceId, userId, sessionId])).rows[0];
  if (!payment) throw new NotFoundError('No verified successful payment is available for this invoice');
  const items = (await pool.query<{ id: string; quantity: number; product_slug: string | null; plan_slug: string | null; metadata: Record<string, unknown> | null }>(`SELECT ${ORDER_ITEM_SELECT} WHERE oi.order_id=$1 ORDER BY oi.created_at,oi.id`, [payment.order_id])).rows;
  const contents = items.map(item => ({ id: orderItemMarketingId(item), quantity: item.quantity }));
  return { verified: true as const, status: 'successful' as const, eventName: 'CompletePayment' as const, eventId: `purchase:${payment.id}`,
    customData: { value: Number(payment.amount), currency: payment.currency, content_type: 'product' as const, content_ids: contents.map(c => c.id), contents, num_items: contents.reduce((n, c) => n + c.quantity, 0) } };
}

/** Maps the stored allowlisted custom data to TikTok's documented properties shape. */
export function toTikTokProperties(data: CustomData): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  if (data.content_ids) properties.content_ids = data.content_ids;
  if (data.contents) properties.contents = data.contents.map(item => ({
    content_id: item.id, quantity: item.quantity,
    ...(item.item_price !== undefined ? { price: item.item_price } : {}),
  }));
  if (data.content_type) properties.content_type = data.content_type;
  if (data.content_name) properties.content_name = data.content_name;
  if (data.content_category) properties.content_category = data.content_category;
  if (data.currency) properties.currency = data.currency;
  if (data.value !== undefined) properties.value = data.value;
  if (data.num_items !== undefined) properties.num_items = data.num_items;
  return properties;
}
