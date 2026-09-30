/**
 * Phase 6 — periodic platform sweeps run by the worker (spec §21, §52, §53).
 *
 * Extracted from main.ts so the dunning lifecycle and health-check scheduling are testable
 * without spinning up the worker loop. Both are idempotent and safe to run concurrently.
 */
import type { Queryable } from '../db/types';
import { getSetting, listSubscriptionsByStatus, updateSubscription } from '../db/ops-tables';
import { enqueueDeployment } from '../db/deployments';
import { listInstallationsForHealthChecks } from './worker-db';
import { expireStaleSupportSessions } from '../db/support-sessions';
import { listAccountsNeedingRotation, rotateSecurityNumber } from '../services/security-number-service';
import { recordAuditBestEffort } from '../lib/audit';

export const HEALTHCHECK_PERIOD_MINUTES = 5;
export const SUBSCRIPTION_GRACE_DEFAULT_DAYS = 7;
export const SUSPEND_AFTER_GRACE_DEFAULT_DAYS = 7;
/** Rotation windows are hours long, so a five-minute sweep is timely without being chatty. */
export const SECURITY_NUMBER_SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Enqueues health-check jobs for active installations (spec §52). One job per installation per
 * period bucket (idempotency key `healthcheck:<installation>:<bucket>`), skipping installations
 * checked recently or whose circuit breaker is open (spec §53).
 */
export async function scheduleHealthChecks(db: Queryable): Promise<number> {
  const installations = await listInstallationsForHealthChecks(db);
  const periodMs = HEALTHCHECK_PERIOD_MINUTES * 60_000;
  const bucket = Math.floor(Date.now() / periodMs);
  let enqueued = 0;
  for (const installation of installations) {
    if (installation.last_health_check_at && Date.now() - new Date(installation.last_health_check_at).getTime() < periodMs) continue;
    if (installation.circuit_open_until && new Date(installation.circuit_open_until).getTime() > Date.now()) continue;
    if (!installation.server_id) continue;
    const { created } = await enqueueDeployment(db, {
      installationId: installation.id,
      serverId: installation.server_id,
      action: 'healthcheck',
      idempotencyKey: `healthcheck:${installation.id}:${bucket}`,
      maxAttempts: 1,
    });
    if (created) enqueued += 1;
  }
  return enqueued;
}

/**
 * Subscription dunning sweep (spec §21): active → past_due (period ended) → grace_period →
 * suspended, with installations stopped by an enqueued deployment — never synchronously.
 * Window lengths come from platform_settings (admin-configurable).
 */
export async function sweepSubscriptions(db: Queryable): Promise<void> {
  const graceDays = await getSetting<number>(db, 'subscription.grace_period_days', SUBSCRIPTION_GRACE_DEFAULT_DAYS);
  const suspendAfterDays = await getSetting<number>(db, 'subscription.suspend_after_days', SUSPEND_AFTER_GRACE_DEFAULT_DAYS);
  const now = Date.now();

  for (const subscription of await listSubscriptionsByStatus(db, 'active')) {
    if (new Date(subscription.current_period_end).getTime() > now) continue;
    await updateSubscription(db, subscription.id, {
      status: 'past_due',
      pastDueSince: new Date().toISOString(),
      gracePeriodDays: graceDays,
    });
  }

  for (const subscription of await listSubscriptionsByStatus(db, 'past_due')) {
    const dueSince = subscription.past_due_since ? new Date(subscription.past_due_since).getTime() : now;
    if (now - dueSince >= graceDays * 86_400_000) {
      await updateSubscription(db, subscription.id, { status: 'grace_period' });
    }
  }

  for (const subscription of await listSubscriptionsByStatus(db, 'grace_period')) {
    const dueSince = subscription.past_due_since ? new Date(subscription.past_due_since).getTime() : now;
    if (now - dueSince >= (graceDays + suspendAfterDays) * 86_400_000) {
      await updateSubscription(db, subscription.id, {
        status: 'suspended',
        suspendedAt: new Date().toISOString(),
      });
      // Suspend the attached installation via the queue — a stop deployment, not a sync stop.
      if (subscription.installation_id) {
        const installation = await db.query<{ server_id: string | null }>(
          `SELECT server_id FROM application_installations WHERE id = $1`,
          [subscription.installation_id]
        );
        await enqueueDeployment(db, {
          installationId: subscription.installation_id,
          serverId: installation.rows[0]?.server_id ?? null,
          action: 'stop',
          idempotencyKey: `subscription-suspend:${subscription.id}:${subscription.suspended_at ?? Date.now()}`,
          maxAttempts: 3,
        });
      }
    }
  }
}

/**
 * Proactive Security Number rotation (spec §14–§17).
 *
 * Walks accounts whose number has expired (or was never issued) and reissues one, incrementing
 * the version and destroying the previous hash. This is the *proactive* half of the guarantee;
 * the reactive half lives on the customer's status endpoint, so a stopped worker can never leave
 * anybody locked out — it only means their new number is minted on next access instead of ahead
 * of time. Every rotation is audited (without the value, which is never logged).
 */
export async function sweepSecurityNumbers(db: Queryable, batchSize = 500): Promise<number> {
  const due = await listAccountsNeedingRotation(db, batchSize);
  let rotated = 0;
  for (const user of due) {
    const result = await rotateSecurityNumber(db, user.id);
    if (!result) continue;
    rotated += 1;
    await recordAuditBestEffort(db, {
      actorId: null,
      action: 'security_number_rotated',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { customerId: user.customer_id, trigger: 'scheduled_rotation', version: result.version },
    });
  }
  return rotated;
}

/**
 * Closes out delegated admin support sessions that have run past their expiry, so the audit
 * record shows a definite end ("expired") instead of an open-looking row. Authentication already
 * refuses an expired session on every request — this sweep is about the trail, not the gate.
 */
export async function sweepExpiredSupportSessions(db: Queryable): Promise<number> {
  const expired = await expireStaleSupportSessions(db);
  for (const session of expired) {
    await recordAuditBestEffort(db, {
      actorId: session.admin_id,
      action: 'admin_customer_account_switch_ended',
      resourceType: 'user',
      resourceId: session.customer_uuid,
      metadata: { customerId: session.customer_id, switchSessionId: session.id, endedReason: 'expired' },
    });
  }
  return expired.length;
}
