/**
 * Server cancellation and termination.
 *
 * Provisioning had no counterpart: every adapter implements `deleteServer` and the queue already
 * understands the `DELETE` operation, but nothing ever asked for one. That left customers unable
 * to stop paying and left provider resources running with no way to reclaim them.
 *
 * Two modes, both customer-initiated and both recorded on the server row itself:
 *
 *  - `AT_PERIOD_END` — the paid-for term is honoured. The subscription is flagged
 *    `cancel_at_period_end`, the server keeps running, and the hourly sweep enqueues the DELETE
 *    job once the period end passes. Revocable until then.
 *  - `IMMEDIATE` — the customer accepts data loss now. The DELETE job is enqueued straight away
 *    and the subscription is cancelled so no further invoice is raised.
 *
 * Nothing here talks to a provider or deletes a row: destruction happens in the worker through
 * the normal provisioning job, and the `servers` record is kept (status `retired`) so billing
 * history, audit trail and invoices stay intact.
 */
import type { Queryable } from '../db/types';
import type { CustomerServerDetailRow } from '../db/server-provisioning';
import {
  enqueueServerProvisioningJob,
  findCustomerServerById,
  updateCustomerServerProvisioning,
} from '../db/server-provisioning';
import { recordAuditBestEffort } from '../lib/audit';

export type TerminationMode = 'AT_PERIOD_END' | 'IMMEDIATE';

/** What is stored under `servers.metadata.cancellation`. */
export interface ServerCancellation {
  mode: TerminationMode;
  requestedAt: string;
  requestedBy: string | null;
  effectiveAt: string | null;
  reason: string | null;
}

export interface TerminationRequest {
  server: CustomerServerDetailRow;
  actorId: string | null;
  mode: TerminationMode;
  reason?: string | null;
  idempotencyKey: string;
  now?: Date;
}

export interface TerminationResult {
  mode: TerminationMode;
  effectiveAt: string | null;
  jobId: string | null;
  queued: boolean;
  cancelledSubscriptions: string[];
  /** True when there was no provider resource to destroy, so the server was retired directly. */
  retiredWithoutProviderCall: boolean;
}

/** Subscription states that still bill or still hold a service open. */
const BILLABLE_SUBSCRIPTION_STATES = ['active', 'trialing', 'past_due', 'grace_period', 'suspended'];

export function readCancellation(server: CustomerServerDetailRow): ServerCancellation | null {
  const raw = server.metadata?.cancellation;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.mode !== 'AT_PERIOD_END' && value.mode !== 'IMMEDIATE') return null;
  return {
    mode: value.mode,
    requestedAt: typeof value.requestedAt === 'string' ? value.requestedAt : '',
    requestedBy: typeof value.requestedBy === 'string' ? value.requestedBy : null,
    effectiveAt: typeof value.effectiveAt === 'string' ? value.effectiveAt : null,
    reason: typeof value.reason === 'string' ? value.reason : null,
  };
}

async function writeCancellation(db: Queryable, serverId: string, value: ServerCancellation | null): Promise<void> {
  if (value === null) {
    await db.query(`UPDATE servers SET metadata=metadata - 'cancellation',updated_at=now() WHERE id=$1`, [serverId]);
    return;
  }
  await db.query(
    `UPDATE servers SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('cancellation',$2::jsonb),updated_at=now() WHERE id=$1`,
    [serverId, JSON.stringify(value)]
  );
}

/**
 * The end of the term the customer has already paid for. The subscription is authoritative;
 * `servers.renewal_date` is the fallback for one-off orders that never created one.
 */
export async function resolveTermEnd(db: Queryable, server: CustomerServerDetailRow): Promise<string | null> {
  if (server.order_id) {
    const { rows } = await db.query<{ period_end: string | null }>(
      `SELECT max(current_period_end) period_end FROM subscriptions
        WHERE order_id=$1 AND status=ANY($2::varchar[])`,
      [server.order_id, BILLABLE_SUBSCRIPTION_STATES]
    );
    if (rows[0]?.period_end) return new Date(rows[0].period_end).toISOString();
  }
  return server.renewal_date ? new Date(server.renewal_date).toISOString() : null;
}

async function flagSubscriptionsForPeriodEnd(db: Queryable, orderId: string | null): Promise<string[]> {
  if (!orderId) return [];
  const { rows } = await db.query<{ id: string }>(
    `UPDATE subscriptions SET cancel_at_period_end=true,updated_at=now()
      WHERE order_id=$1 AND status=ANY($2::varchar[]) RETURNING id`,
    [orderId, BILLABLE_SUBSCRIPTION_STATES]
  );
  return rows.map((row) => row.id);
}

async function cancelSubscriptionsNow(db: Queryable, orderId: string | null): Promise<string[]> {
  if (!orderId) return [];
  const { rows } = await db.query<{ id: string }>(
    `UPDATE subscriptions SET status='cancelled',cancelled_at=now(),cancel_at_period_end=false,updated_at=now()
      WHERE order_id=$1 AND status=ANY($2::varchar[]) RETURNING id`,
    [orderId, BILLABLE_SUBSCRIPTION_STATES]
  );
  return rows.map((row) => row.id);
}

/**
 * Enqueues the destructive half of a termination: one DELETE job per server, or — when the server
 * never reached the provider — a direct retirement, because there is nothing out there to delete
 * and pretending to call a provider would be a lie.
 */
async function destroy(
  db: Queryable,
  server: CustomerServerDetailRow,
  actorId: string | null,
  idempotencyKey: string,
  source: 'customer-request' | 'termination-sweep'
): Promise<{ jobId: string | null; queued: boolean; retiredWithoutProviderCall: boolean }> {
  if (!server.provider_server_id || !server.provider_id) {
    await updateCustomerServerProvisioning(db, server.id, { status: 'retired', provisioningStatus: 'CANCELLED' });
    await recordAuditBestEffort(db, {
      actorId, action: 'SERVER_RETIRED_WITHOUT_PROVIDER_RESOURCE', resourceType: 'server', resourceId: server.id,
      metadata: { source, reason: 'server was never created at the provider' },
    });
    return { jobId: null, queued: false, retiredWithoutProviderCall: true };
  }
  const result = await enqueueServerProvisioningJob(db, {
    serverId: server.id, orderId: server.order_id, providerId: server.provider_id, osImageId: server.os_image_id,
    operation: 'DELETE', requestedBy: actorId, idempotencyKey, payload: { source },
  });
  await updateCustomerServerProvisioning(db, server.id, { status: 'deleting', provisioningStatus: 'QUEUED' });
  return { jobId: result.job.id, queued: result.created, retiredWithoutProviderCall: false };
}

/**
 * Records a customer cancellation. Callers (the route, the sweep) are responsible for ownership
 * and state checks; this function performs the transition itself.
 */
export async function requestServerTermination(db: Queryable, input: TerminationRequest): Promise<TerminationResult> {
  const now = input.now ?? new Date();
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, 500) : null;

  if (input.mode === 'IMMEDIATE') {
    const cancelledSubscriptions = await cancelSubscriptionsNow(db, input.server.order_id);
    const cancellation: ServerCancellation = {
      mode: 'IMMEDIATE', requestedAt: now.toISOString(), requestedBy: input.actorId, effectiveAt: now.toISOString(), reason,
    };
    await writeCancellation(db, input.server.id, cancellation);
    const destroyed = await destroy(db, input.server, input.actorId, input.idempotencyKey, 'customer-request');
    await recordAuditBestEffort(db, {
      actorId: input.actorId, action: 'SERVER_TERMINATION_REQUESTED', resourceType: 'server', resourceId: input.server.id,
      metadata: { mode: 'IMMEDIATE', jobId: destroyed.jobId, cancelledSubscriptions, reason },
    });
    return { mode: 'IMMEDIATE', effectiveAt: cancellation.effectiveAt, ...destroyed, cancelledSubscriptions };
  }

  const effectiveAt = await resolveTermEnd(db, input.server);
  const cancelledSubscriptions = await flagSubscriptionsForPeriodEnd(db, input.server.order_id);
  const cancellation: ServerCancellation = {
    mode: 'AT_PERIOD_END', requestedAt: now.toISOString(), requestedBy: input.actorId, effectiveAt, reason,
  };
  await writeCancellation(db, input.server.id, cancellation);
  await recordAuditBestEffort(db, {
    actorId: input.actorId, action: 'SERVER_TERMINATION_SCHEDULED', resourceType: 'server', resourceId: input.server.id,
    metadata: { mode: 'AT_PERIOD_END', effectiveAt, flaggedSubscriptions: cancelledSubscriptions, reason },
  });
  return {
    mode: 'AT_PERIOD_END', effectiveAt, jobId: null, queued: false,
    cancelledSubscriptions, retiredWithoutProviderCall: false,
  };
}

/** Undoes a scheduled cancellation while the server is still running. */
export async function revokeScheduledTermination(
  db: Queryable, server: CustomerServerDetailRow, actorId: string | null
): Promise<string[]> {
  const restored = server.order_id
    ? (await db.query<{ id: string }>(
        `UPDATE subscriptions SET cancel_at_period_end=false,updated_at=now()
          WHERE order_id=$1 AND status=ANY($2::varchar[]) AND cancel_at_period_end RETURNING id`,
        [server.order_id, BILLABLE_SUBSCRIPTION_STATES]
      )).rows.map((row) => row.id)
    : [];
  await writeCancellation(db, server.id, null);
  await recordAuditBestEffort(db, {
    actorId, action: 'SERVER_TERMINATION_REVOKED', resourceType: 'server', resourceId: server.id,
    metadata: { restoredSubscriptions: restored },
  });
  return restored;
}

export interface TerminationSweepResult {
  serverId: string;
  name: string;
  effectiveAt: string | null;
  jobId: string | null;
  retiredWithoutProviderCall: boolean;
}

/**
 * Destroys servers whose scheduled cancellation date has passed. Idempotent: servers already
 * `deleting` or `retired` are skipped, and the idempotency key is derived from the effective date
 * so a re-run reuses the existing job instead of queueing a second destruction.
 */
export async function sweepScheduledTerminations(
  db: Queryable, options: { now?: Date } = {}
): Promise<TerminationSweepResult[]> {
  const now = options.now ?? new Date();
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM servers
      WHERE metadata->'cancellation'->>'mode'='AT_PERIOD_END'
        AND metadata->'cancellation'->>'effectiveAt' IS NOT NULL
        AND (metadata->'cancellation'->>'effectiveAt')::timestamptz <= $1
        AND status NOT IN ('deleting','retired')
      ORDER BY created_at`,
    [now.toISOString()]
  );

  const results: TerminationSweepResult[] = [];
  for (const { id } of rows) {
    // Re-read through the customer view so the destroy path sees provider ids and order id.
    const server = await findCustomerServerById(db, id);
    if (!server) continue;
    const cancellation = readCancellation(server);
    if (!cancellation?.effectiveAt) continue;
    await cancelSubscriptionsNow(db, server.order_id);
    const destroyed = await destroy(
      db, server, cancellation.requestedBy,
      `server-terminate:${server.id}:${cancellation.effectiveAt}`,
      'termination-sweep'
    );
    await recordAuditBestEffort(db, {
      actorId: cancellation.requestedBy, action: 'SERVER_TERMINATION_STARTED', resourceType: 'server', resourceId: server.id,
      metadata: { effectiveAt: cancellation.effectiveAt, jobId: destroyed.jobId, source: 'termination-sweep' },
    });
    results.push({
      serverId: server.id, name: server.name, effectiveAt: cancellation.effectiveAt,
      jobId: destroyed.jobId, retiredWithoutProviderCall: destroyed.retiredWithoutProviderCall,
    });
  }
  return results;
}
