import type { Queryable } from './types';

export interface WebhookEventRecord {
  id: string;
  gateway: string;
  event_id: string;
  transmission_id: string | null;
  event_type: string;
  provider_reference: string | null;
  payment_id: string | null;
  status: 'processing' | 'completed' | 'failed' | 'rejected' | 'ignored';
  payload_hash: string;
  lease_expires_at: Date;
  processing_node_id: string | null;
  error_message: string | null;
  received_at: Date;
  processed_at: Date | null;
}

export interface InsertWebhookEventParams {
  id?: string;
  gateway: string;
  eventId: string;
  transmissionId?: string | null;
  eventType: string;
  providerReference?: string | null;
  paymentId?: string | null;
  payloadHash: string;
  leaseExpiresAt: Date;
  processingNodeId?: string | null;
}

/**
 * Attempts to record a new incoming webhook event with an initial 'processing' lease.
 * Returns the inserted record if new, or null if an event with (gateway, eventId) already exists.
 */
export async function tryInsertWebhookEvent(
  client: Queryable,
  params: InsertWebhookEventParams
): Promise<WebhookEventRecord | null> {
  const sql = `
    INSERT INTO webhook_events (
      id, gateway, event_id, transmission_id, event_type, provider_reference, payment_id,
      status, payload_hash, lease_expires_at, processing_node_id, received_at
    )
    VALUES (
      COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7,
      'processing', $8, $9, $10, NOW()
    )
    ON CONFLICT (gateway, event_id) DO NOTHING
    RETURNING id, gateway, event_id, transmission_id, event_type, provider_reference, payment_id,
              status, payload_hash, lease_expires_at, processing_node_id, error_message,
              received_at, processed_at
  `;
  const res = await client.query<WebhookEventRecord>(sql, [
    params.id ?? null,
    params.gateway,
    params.eventId,
    params.transmissionId ?? null,
    params.eventType,
    params.providerReference ?? null,
    params.paymentId ?? null,
    params.payloadHash,
    params.leaseExpiresAt,
    params.processingNodeId ?? null,
  ]);

  if (res.rows.length === 0) {
    return null;
  }
  return res.rows[0] as WebhookEventRecord;
}

export async function findWebhookEvent(
  client: Queryable,
  gateway: string,
  eventId: string
): Promise<WebhookEventRecord | null> {
  const sql = `
    SELECT id, gateway, event_id, transmission_id, event_type, provider_reference, payment_id,
           status, payload_hash, lease_expires_at, processing_node_id, error_message,
           received_at, processed_at
    FROM webhook_events
    WHERE gateway = $1 AND event_id = $2
  `;
  const res = await client.query<WebhookEventRecord>(sql, [gateway, eventId]);
  if (res.rows.length === 0) return null;
  return res.rows[0] as WebhookEventRecord;
}

/**
 * Atomically attempts to claim an expired processing lease for a retry.
 */
export async function tryTakeoverExpiredLease(
  client: Queryable,
  gateway: string,
  eventId: string,
  newLeaseExpiresAt: Date,
  processingNodeId?: string | null
): Promise<boolean> {
  const sql = `
    UPDATE webhook_events
    SET lease_expires_at = $1,
        processing_node_id = $2,
        received_at = NOW()
    WHERE gateway = $3 AND event_id = $4 AND status = 'processing' AND lease_expires_at <= NOW()
    RETURNING id
  `;
  const res = await client.query<{ id: string }>(sql, [
    newLeaseExpiresAt,
    processingNodeId ?? null,
    gateway,
    eventId,
  ]);
  return res.rows.length > 0;
}

export async function updateWebhookEventStatus(
  client: Queryable,
  gateway: string,
  eventId: string,
  status: 'processing' | 'completed' | 'failed' | 'rejected' | 'ignored',
  errorMessage?: string | null,
  paymentId?: string | null
): Promise<void> {
  const sql = `
    UPDATE webhook_events
    SET status = $1,
        processed_at = NOW(),
        error_message = $2,
        payment_id = COALESCE($3, payment_id)
    WHERE gateway = $4 AND event_id = $5
  `;
  await client.query(sql, [status, errorMessage ?? null, paymentId ?? null, gateway, eventId]);
}
