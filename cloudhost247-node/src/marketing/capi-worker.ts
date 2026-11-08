import { createHash, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { loadConfiguration, loadCapiCredentials } from './config-service';
import { consentGranted, type ConsentRow } from './consent-service';
import { customDataSchema } from './event-service';
import { CONSENT_POLICY_VERSION } from './types';
import { sendCapiEvent, type CapiResult } from './capi-client';

export interface CapiDrainResult { claimed: number; delivered: number; retried: number; failed: number; cancelled: number }
interface DeliveryRow { id: string; event_id: string; attempts: number; status: string; worker_id: string }
interface EventRow {
  pixel_id: string; event_name: import('./types').StandardEvent; event_id: string; custom_data: unknown; source_url: string;
  occurred_at: string; session_id: string; fbp: string | null; fbc: string | null;
}
const BACKOFF_MS = [60_000, 5*60_000, 30*60_000, 2*60*60_000, 12*60*60_000];
const EMPTY: CapiDrainResult = { claimed: 0, delivered: 0, retried: 0, failed: 0, cancelled: 0 };

/** Bounded, lease-protected outbox drain, shared by persistent and Cron workers. HTTP acceptance
 * is not Events Manager verification. Ambiguous timeouts retry the SAME event ID. Consent and
 * configuration are checked immediately before sending and again when recording the result. */
export async function drainCapiOutbox(pool: Queryable, options: { workerId?: string; limit?: number; leaseMs?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<CapiDrainResult> {
  const result = { ...EMPTY };
  // One credential read is the delivery authority: pixel, version, test code and token
  // all come from the same configuration revision. A separate pre-read could mix an old
  // test code with a newly rotated token.
  let credentials: NonNullable<Awaited<ReturnType<typeof loadCapiCredentials>>>;
  try { const loaded = await loadCapiCredentials(pool); if (!loaded) return result; credentials = loaded; }
  catch { return result; }
  const workerId = (options.workerId ?? 'meta').slice(0,48);
  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  const leaseMs = Math.min(300_000, Math.max(45_000, options.leaseMs ?? 60_000));
  // A process may die after claiming/sending but before completion. Those attempts are already
  // durable; once the lease expires an exhausted row becomes terminal without another send.
  const exhausted = await pool.query(`
    UPDATE marketing_delivery_outbox o SET status='dead_letter',worker_id=NULL,lease_until=NULL,
      last_error='Maximum delivery attempts exhausted',updated_at=now()
    FROM marketing_events e WHERE o.event_id=e.id AND e.pixel_id=$1 AND o.attempts>=5
      AND (o.status IN ('queued','retry') OR (o.status='processing' AND o.lease_until<now()))
    RETURNING o.id`, [credentials.pixelId]);
  result.failed += exhausted.rows.length;
  for (let i = 0; i < limit; i++) {
    const claimToken = `${workerId}:${randomUUID()}`;
    const row = (await pool.query<DeliveryRow>(`WITH candidate AS (
      SELECT o.id FROM marketing_delivery_outbox o JOIN marketing_events e ON e.id=o.event_id
      WHERE ((o.status IN ('queued','retry') AND o.next_attempt_at<=now()) OR (o.status='processing' AND o.lease_until<now()))
        AND o.attempts<5 AND e.pixel_id=$1 ORDER BY o.next_attempt_at,o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1)
      UPDATE marketing_delivery_outbox o SET status='processing',attempts=LEAST(5,o.attempts+1),worker_id=$2,lease_until=now()+($3::double precision * interval '1 millisecond'),updated_at=now()
      FROM candidate WHERE o.id=candidate.id RETURNING o.id,o.event_id,o.attempts,o.status,o.worker_id`,
    [credentials.pixelId,claimToken,leaseMs])).rows[0];
    if (!row) break;
    result.claimed++;
    const event = (await pool.query<EventRow>(`SELECT e.*,c.fbp,c.fbc FROM marketing_events e
      JOIN marketing_consent_sessions s ON s.id=e.session_id
      LEFT JOIN marketing_conversion_contexts c ON c.session_id=e.session_id AND c.source_url=e.source_url
      WHERE e.id=$1 ORDER BY c.created_at DESC LIMIT 1`, [row.event_id])).rows[0];
    const current = await loadConfiguration(pool);
    const consent = event ? (await pool.query<ConsentRow>('SELECT * FROM marketing_consent_sessions WHERE id=$1', [event.session_id])).rows[0] : undefined;
    const valid = () => current?.enabled && current.configuration.capi.enabled && current.configuration.pixelId === event?.pixel_id && current.revision === credentials.revision && current.has_capi_token && consentGranted(consent);
    let delivery: CapiResult = { accepted: false, httpStatus: null, eventsReceived: null, retryable: false, error: 'Conversion context unavailable' };
    if (event && valid()) {
      try {
        delivery = await sendCapiEvent({ pixelId: event.pixel_id, apiVersion: credentials.apiVersion, token: credentials.token,
          testEventCode: credentials.testEventCode },
        { eventName: event.event_name, eventId: event.event_id, occurredAt: event.occurred_at, sourceUrl: event.source_url,
          customData: customDataSchema.parse(event.custom_data), userData: { external_id: createHash('sha256').update(event.session_id).digest('hex'), fbp: event.fbp, fbc: event.fbc } }, options.fetchImpl, options.timeoutMs);
      } catch { delivery = { accepted: false, httpStatus: null, eventsReceived: null, retryable: false, error: 'Invalid conversion payload' }; }
    }
    // Completion is one atomic statement. The claim-token guard defeats an expired worker
    // overwriting a newer claim; the EXISTS guards evaluate current consent/config under the
    // same row lock as the status write, closing the SELECT-then-UPDATE withdrawal race.
    const attempts = row.attempts; // reserved durably by the claim, before any network I/O
    const desired = delivery.accepted ? 'delivered' : delivery.retryable && attempts < 5 ? 'retry' : 'dead_letter';
    const completion = await pool.query<{ status: string }>(`UPDATE marketing_delivery_outbox o SET
      status=CASE WHEN $9::boolean AND EXISTS (
          SELECT 1 FROM marketing_events e JOIN marketing_consent_sessions s ON s.id=e.session_id
          WHERE e.id=o.event_id AND s.decided=true AND s.policy_version=$11 AND s.preferences->>'marketing'='true' AND s.expires_at>now()
        ) AND EXISTS (
          SELECT 1 FROM marketing_integrations i JOIN marketing_integration_secrets k
            ON k.provider_key=i.provider_key AND k.secret_key='capi_access_token'
          WHERE i.provider_key='meta_pixel' AND i.enabled=true AND i.revision=$10
            AND i.configuration->'capi'->>'enabled'='true' AND i.configuration->>'pixelId'=(SELECT pixel_id FROM marketing_events WHERE id=o.event_id)
        ) THEN $1::varchar ELSE 'cancelled' END,
      attempts=$2::integer,http_status=$3::integer,events_received=$4::integer,
      last_error=CASE WHEN $9::boolean THEN $5::varchar ELSE 'Consent/configuration changed before completion' END,
      next_attempt_at=now()+($6::double precision * interval '1 millisecond'),delivered_at=CASE WHEN $1::varchar='delivered' THEN now() ELSE NULL END,
      worker_id=NULL,lease_until=NULL,updated_at=now() WHERE o.id=$7::uuid AND o.status='processing' AND o.worker_id=$8 RETURNING status`,
    [desired,attempts,delivery.httpStatus,delivery.eventsReceived,delivery.error,desired === 'retry' ? BACKOFF_MS[attempts-1] : 0,row.id,claimToken,Boolean(event),credentials.revision,CONSENT_POLICY_VERSION]);
    const status = completion.rows[0]?.status;
    if (!status) { result.cancelled++; continue; }
    if (status === 'delivered') result.delivered++;
    else if (status === 'retry') result.retried++;
    else if (status === 'dead_letter') result.failed++;
    else result.cancelled++;
  }
  return result;
}

/** Bounded retention for marketing-only data. Financial and auth audit records are untouched. */
export async function pruneMarketingRetention(pool: Queryable): Promise<{ consentHistory: number; consentSessions: number; events: number; deliveries: number; contexts: number }> {
  const consentHistory = (await pool.query(`DELETE FROM marketing_consent_history WHERE created_at < now()-interval '180 days' RETURNING id`)).rows.length;
  const events = (await pool.query(`DELETE FROM marketing_events WHERE occurred_at < now()-interval '90 days' RETURNING id`)).rows.length;
  const deliveries = (await pool.query(`DELETE FROM marketing_delivery_outbox WHERE status IN ('delivered','dead_letter','cancelled') AND updated_at < now()-interval '30 days' RETURNING id`)).rows.length;
  // A conversion context links a checkout to its consented session so a later verified payment
  // can still attribute Purchase. Do NOT age it out while the order is still awaiting money
  // (unpaid/pending and not cancelled/failed): a slow bank transfer can settle after 90 days and
  // must not silently lose its conversion. Once the order reaches a terminal payment state the
  // context is no longer needed and ages out normally. Expired consent sessions still cascade-
  // delete their contexts below, which is correct: expired consent must not produce a Purchase.
  const contexts = (await pool.query(`DELETE FROM marketing_conversion_contexts c
    WHERE c.created_at < now()-interval '90 days'
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id=c.order_id
        AND o.payment_status IN ('unpaid','pending') AND o.status NOT IN ('cancelled','failed'))
    RETURNING c.subject_key`)).rows.length;
  // Sessions themselves expire after 180 days; remove only expired rows so active consent and
  // any still-retained event/context references remain intact. Financial rows are never touched.
  const consentSessions = (await pool.query(`DELETE FROM marketing_consent_sessions WHERE expires_at < now() RETURNING id`)).rows.length;
  return { consentHistory, consentSessions, events, deliveries, contexts };
}
