import { createHash, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { loadTikTokConfiguration, loadEventsApiCredentials } from './config-service';
import { consentGranted, type ConsentRow } from '../marketing/consent-service';
import { CONSENT_POLICY_VERSION } from '../marketing/types';
import { customDataSchema } from '../marketing/event-service';
import { sendTikTokEvent, type TikTokEventsApiResult } from './events-api-client';
import { toTikTokProperties } from './event-service';
import { TIKTOK_PROVIDER, TIKTOK_SECRET_KEY, type TikTokEvent } from './types';

export interface TikTokDrainResult { claimed: number; delivered: number; retried: number; failed: number; cancelled: number }
interface DeliveryRow { id: string; event_id: string; attempts: number }
interface EventRow {
  pixel_id: string; event_name: TikTokEvent; event_id: string; custom_data: unknown; source_url: string;
  occurred_at: string; session_id: string; ttp: string | null; ttclid: string | null;
}
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];
const EMPTY: TikTokDrainResult = { claimed: 0, delivered: 0, retried: 0, failed: 0, cancelled: 0 };

/**
 * Bounded, lease-protected Events API outbox drain (mirrors the Meta CAPI
 * worker discipline). Attempts are reserved durably at claim time; ambiguous
 * timeouts retry the SAME event_id so TikTok deduplicates. Consent and
 * configuration are re-checked immediately before sending and atomically when
 * recording the result — the Events API is never used to bypass a consent
 * withdrawal. TikTok HTTP/code-0 acceptance is recorded honestly as API
 * acceptance, not Events Manager attribution.
 */
export async function drainTikTokOutbox(pool: Queryable, options: { workerId?: string; limit?: number; leaseMs?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<TikTokDrainResult> {
  const result = { ...EMPTY };
  let credentials: NonNullable<Awaited<ReturnType<typeof loadEventsApiCredentials>>>;
  try { const loaded = await loadEventsApiCredentials(pool); if (!loaded) return result; credentials = loaded; }
  catch { return result; }
  const workerId = (options.workerId ?? 'tiktok').slice(0, 48);
  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  const leaseMs = Math.min(300_000, Math.max(45_000, options.leaseMs ?? 60_000));
  const exhausted = await pool.query(`
    UPDATE marketing_delivery_outbox o SET status='dead_letter',worker_id=NULL,lease_until=NULL,
      last_error='Maximum delivery attempts exhausted',updated_at=now()
    FROM marketing_events e WHERE o.event_id=e.id AND e.provider_key=$2 AND e.pixel_id=$1 AND o.attempts>=5
      AND (o.status IN ('queued','retry') OR (o.status='processing' AND o.lease_until<now()))
    RETURNING o.id`, [credentials.pixelId, TIKTOK_PROVIDER]);
  result.failed += exhausted.rows.length;
  for (let i = 0; i < limit; i++) {
    const claimToken = `${workerId}:${randomUUID()}`;
    const row = (await pool.query<DeliveryRow>(`WITH candidate AS (
      SELECT o.id FROM marketing_delivery_outbox o JOIN marketing_events e ON e.id=o.event_id
      WHERE ((o.status IN ('queued','retry') AND o.next_attempt_at<=now()) OR (o.status='processing' AND o.lease_until<now()))
        AND o.attempts<5 AND e.provider_key=$4 AND e.pixel_id=$1 ORDER BY o.next_attempt_at,o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1)
      UPDATE marketing_delivery_outbox o SET status='processing',attempts=LEAST(5,o.attempts+1),worker_id=$2,lease_until=now()+($3::double precision * interval '1 millisecond'),updated_at=now()
      FROM candidate WHERE o.id=candidate.id RETURNING o.id,o.event_id,o.attempts`,
    [credentials.pixelId, claimToken, leaseMs, TIKTOK_PROVIDER])).rows[0];
    if (!row) break;
    result.claimed++;
    const event = (await pool.query<EventRow>(`SELECT e.pixel_id,e.event_name,e.event_id,e.custom_data,e.source_url,e.occurred_at,e.session_id,c.ttp,c.ttclid FROM marketing_events e
      LEFT JOIN marketing_conversion_contexts c ON c.session_id=e.session_id AND c.source_url=e.source_url
      WHERE e.id=$1 ORDER BY c.created_at DESC LIMIT 1`, [row.event_id])).rows[0];
    const current = await loadTikTokConfiguration(pool);
    const consent = event ? (await pool.query<ConsentRow>('SELECT * FROM marketing_consent_sessions WHERE id=$1', [event.session_id])).rows[0] : undefined;
    const valid = () => current?.enabled && current.configuration.eventsApi.enabled && current.configuration.pixelId === event?.pixel_id && current.revision === credentials.revision && current.has_events_api_token && consentGranted(consent);
    let delivery: TikTokEventsApiResult = { accepted: false, httpStatus: null, eventsReceived: null, retryable: false, error: 'Conversion context unavailable' };
    if (event && valid()) {
      try {
        delivery = await sendTikTokEvent({ pixelId: event.pixel_id, token: credentials.token, testEventCode: credentials.testEventCode },
          { eventName: event.event_name, eventId: event.event_id, occurredAt: event.occurred_at, sourceUrl: event.source_url,
            customData: toTikTokProperties(customDataSchema.parse(event.custom_data)),
            user: { ttp: event.ttp, ttclid: event.ttclid, externalIdHash: createHash('sha256').update(event.session_id).digest('hex') } }, options.fetchImpl, options.timeoutMs);
      } catch { delivery = { accepted: false, httpStatus: null, eventsReceived: null, retryable: false, error: 'Invalid conversion payload' }; }
    }
    const attempts = row.attempts;
    const desired = delivery.accepted ? 'delivered' : delivery.retryable && attempts < 5 ? 'retry' : 'dead_letter';
    const completion = await pool.query<{ status: string }>(`UPDATE marketing_delivery_outbox o SET
      status=CASE WHEN $9::boolean AND EXISTS (
          SELECT 1 FROM marketing_events e JOIN marketing_consent_sessions s ON s.id=e.session_id
          WHERE e.id=o.event_id AND s.decided=true AND s.policy_version=$11 AND s.preferences->>'marketing'='true' AND s.expires_at>now()
        ) AND EXISTS (
          SELECT 1 FROM marketing_integrations i JOIN marketing_integration_secrets k
            ON k.provider_key=i.provider_key AND k.secret_key='${TIKTOK_SECRET_KEY}'
          WHERE i.provider_key='${TIKTOK_PROVIDER}' AND i.enabled=true AND i.revision=$10
            AND i.configuration->'eventsApi'->>'enabled'='true' AND i.configuration->>'pixelId'=(SELECT pixel_id FROM marketing_events WHERE id=o.event_id)
        ) THEN $1::varchar ELSE 'cancelled' END,
      attempts=$2::integer,http_status=$3::integer,events_received=$4::integer,
      last_error=CASE WHEN $9::boolean THEN $5::varchar ELSE 'Consent/configuration changed before completion' END,
      next_attempt_at=now()+($6::double precision * interval '1 millisecond'),delivered_at=CASE WHEN $1::varchar='delivered' THEN now() ELSE NULL END,
      worker_id=NULL,lease_until=NULL,updated_at=now() WHERE o.id=$7::uuid AND o.status='processing' AND o.worker_id=$8 RETURNING status`,
    [desired, attempts, delivery.httpStatus, delivery.eventsReceived, delivery.error, desired === 'retry' ? BACKOFF_MS[attempts - 1] : 0, row.id, claimToken, Boolean(event), credentials.revision, CONSENT_POLICY_VERSION]);
    const status = completion.rows[0]?.status;
    if (!status) { result.cancelled++; continue; }
    if (status === 'delivered') result.delivered++;
    else if (status === 'retry') result.retried++;
    else if (status === 'dead_letter') result.failed++;
    else result.cancelled++;
  }
  return result;
}
