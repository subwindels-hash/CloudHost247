import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Queryable } from '../db/types';
import { ValidationError } from '../lib/errors';
import { loadConfiguration } from './config-service';
import { META_PROVIDER, STANDARD_EVENTS, runtimeConfiguration } from './types';
import { consentGranted, safeSourceUrl, type ConsentRow } from './consent-service';

// Explicit allowlist: no names, email addresses, phone numbers, addresses, credentials, card data,
// free-text form messages, arbitrary URL query strings or advanced matching fields are accepted.
// content_name/content_category are catalog-label fields (plan/product names, invoice numbers,
// static labels). They are additionally screened for obvious PII patterns so a client cannot smuggle
// an email address or a phone/card digit run into Meta under a label. The frontend only ever populates
// them with catalog labels; this is defense-in-depth, not a claim that arbitrary text is PII-proof.
const catalogLabel = (max: number) => z.string().max(max)
  .refine(v => !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(v), 'content labels must not contain email addresses')
  .refine(v => !/\d{10,}/.test(v), 'content labels must not contain long digit sequences (phone/card numbers)');
export const customDataSchema = z.object({
  content_ids: z.array(z.string().min(1).max(128)).max(100).optional(),
  contents: z.array(z.object({ id: z.string().min(1).max(128), quantity: z.number().int().positive().max(1000), item_price: z.number().nonnegative().finite().optional() }).strict()).max(100).optional(),
  content_type: z.enum(['product','product_group']).optional(),
  content_name: catalogLabel(200).optional(),
  content_category: catalogLabel(120).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  value: z.number().nonnegative().finite().max(1e9).optional(),
  num_items: z.number().int().positive().max(10000).optional(),
}).strict().refine(v => v.value === undefined || Boolean(v.currency), 'Value requires the actual transaction currency');
export type CustomData = z.infer<typeof customDataSchema>;
const eventSchema = z.object({
  eventName: z.enum(STANDARD_EVENTS).refine(v => v !== 'Purchase', 'Purchase requires backend payment confirmation'),
  eventId: z.string().min(8).max(128).regex(/^[A-Za-z0-9:._-]+$/),
  customData: customDataSchema.default({}),
  sourceUrl: z.string().max(4096).optional(),
}).strict();
const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(20) }).strict();

export async function recordBrowserEvents(pool: Queryable, input: unknown, sessionId: string, appUrl: string) {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map(i => i.message).join('; '));
  const config = await loadConfiguration(pool);
  if (!runtimeConfiguration(config, new URL(appUrl).hostname).enabled || !config?.configuration.pixelId) return { recorded: 0, duplicates: 0, status: 'integration_disabled' };
  const consent = (await pool.query<ConsentRow>(`SELECT * FROM marketing_consent_sessions WHERE id=$1`, [sessionId])).rows[0] ?? null;
  if (!consentGranted(consent)) return { recorded: 0, duplicates: 0, status: 'consent_required' };
  let recorded = 0, duplicates = 0;
  for (const event of parsed.data.events) {
    const result = await pool.query<{ inserted: boolean }>(`INSERT INTO marketing_events(id,provider_key,pixel_id,config_revision,event_name,event_id,custom_data,source_url,session_id,occurred_at,browser_dispatched_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now()) ON CONFLICT(provider_key,pixel_id,event_name,event_id)
      DO UPDATE SET browser_dispatched_at=COALESCE(marketing_events.browser_dispatched_at,now())
      WHERE marketing_events.session_id=EXCLUDED.session_id RETURNING id,(xmax=0) AS inserted`,
    [randomUUID(),META_PROVIDER,config.configuration.pixelId,config.revision,event.eventName,event.eventId,JSON.stringify(event.customData),safeSourceUrl(event.sourceUrl,appUrl),sessionId]);
    // A browser dispatch may follow the authoritative server record for the same event ID.
    // Mark only that browser timestamp; never replace server payload/time, and never attach a
    // different consent session. xmax=0 distinguishes a fresh insert from the conflict update.
    if (result.rows[0]?.inserted) recorded++; else duplicates++;
  }
  return { recorded, duplicates, status: 'recorded' };
}
