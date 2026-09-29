/**
 * Phase 6 — the deployment worker process (spec §28).
 *
 *   npm run worker     (from cloudhost247-node/, after `npm run build` in production:
 *                       node dist/src/worker/main.js)
 *
 * Architecture position: the API creates deployment rows; PostgreSQL holds the queue; THIS
 * process consumes it. Multiple workers can run concurrently (SKIP LOCKED claiming), and the
 * API stays responsive however long a deployment takes (spec §28: "The API must remain
 * responsive while deployments are running").
 *
 * Loops:
 *   1. Job loop      — claim → run handler → record outcome, with lease renewal for long jobs.
 *   2. Recovery loop — reclaim jobs whose worker died mid-run (expired lease).
 *   3. Scheduler     — periodic platform work: enqueue health checks for active installations
 *                      (spec §52) and apply the subscription dunning lifecycle (spec §21).
 */
import 'dotenv/config';
import { loadEnv } from '../config/env';
import { getPool, closePool } from '../db/pool';
import { getSetting, listSubscriptionsByStatus, updateSubscription } from '../db/ops-tables';
import { enqueueDeployment } from '../db/deployments';
import { executeDeployment } from '../deployments/engine';
import { processNextJob, recoverOrphanedJobs, hasHandler } from './handlers';
import { listInstallationsForHealthChecks } from './worker-db';
import type { EngineOptions } from '../deployments/engine';

const HEALTHCHECK_INTERVAL_MS = 60_000;
const SUBSCRIPTION_SWEEP_INTERVAL_MS = 5 * 60_000;
const HEALTHCHECK_PERIOD_MINUTES = 5;
const SUBSCRIPTION_GRACE_DEFAULT_DAYS = 7;
const SUSPEND_AFTER_GRACE_DEFAULT_DAYS = 7;

function engineOptions(simulationMode: boolean, kubernetesEnabled: boolean): EngineOptions {
  return { simulationMode, kubernetesEnabled };
}

async function scheduleHealthChecks(pool: Parameters<typeof processNextJob>[0]['db']): Promise<number> {
  const installations = await listInstallationsForHealthChecks(pool);
  const periodMs = HEALTHCHECK_PERIOD_MINUTES * 60_000;
  const bucket = Math.floor(Date.now() / periodMs);
  let enqueued = 0;
  for (const installation of installations) {
    // Skip when a health check ran recently or the circuit breaker is open (spec §53).
    if (installation.last_health_check_at && Date.now() - new Date(installation.last_health_check_at).getTime() < periodMs) continue;
    if (installation.circuit_open_until && new Date(installation.circuit_open_until).getTime() > Date.now()) continue;
    if (!installation.server_id) continue;
    await enqueueDeployment(pool, {
      installationId: installation.id,
      serverId: installation.server_id,
      action: 'healthcheck',
      idempotencyKey: `healthcheck:${installation.id}:${bucket}`,
      maxAttempts: 1,
    });
    enqueued += 1;
  }
  return enqueued;
}

/**
 * Subscription dunning sweep (spec §21): active → past_due (period ended) → grace_period →
 * suspended → (installations stopped by enqueued stop deployments). Grace/suspend windows come
 * from platform_settings — admin-configurable from the dashboard.
 */
async function sweepSubscriptions(db: Parameters<typeof processNextJob>[0]['db']): Promise<void> {
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
      // Suspend the installation attached to the subscription (worker job, not synchronous).
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

async function main() {
  const env = loadEnv();
  const pool = getPool(env);
  const workerId = env.WORKER_ID;
  const ctx = {
    db: pool,
    options: engineOptions(env.DEPLOYMENT_SIMULATION_MODE, env.KUBERNETES_ADAPTER_ENABLED),
    workerId,
  };

  const logger = console; // worker logs to stdout; pino JSON in a later ops phase
  logger.log(`[worker:${workerId}] starting (poll=${env.WORKER_POLL_INTERVAL_MS}ms, concurrency=${env.WORKER_CONCURRENCY}, simulation=${env.DEPLOYMENT_SIMULATION_MODE})`);

  let running = true;
  let lastHealthSweep = 0;
  let lastSubscriptionSweep = 0;

  const shutdown = (signal: string) => {
    logger.log(`[worker:${workerId}] ${signal} received — draining`);
    running = false;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  while (running) {
    try {
      await recoverOrphanedJobs(ctx);

      // Run up to WORKER_CONCURRENCY jobs concurrently; each poll drains at most that many.
      const claimed: Array<Promise<unknown>> = [];
      for (let slot = 0; slot < env.WORKER_CONCURRENCY; slot += 1) {
        claimed.push(processNextJob(ctx));
      }
      const processed = await Promise.all(claimed);
      const didWork = processed.some((p) => p !== null);

      const now = Date.now();
      if (now - lastHealthSweep >= HEALTHCHECK_INTERVAL_MS) {
        lastHealthSweep = now;
        const scheduled = await scheduleHealthChecks(pool);
        if (scheduled > 0) logger.log(`[worker:${workerId}] scheduled ${scheduled} health check job(s)`);
      }
      if (now - lastSubscriptionSweep >= SUBSCRIPTION_SWEEP_INTERVAL_MS) {
        lastSubscriptionSweep = now;
        await sweepSubscriptions(pool);
      }

      if (!didWork) {
        await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS));
      }
    } catch (err) {
      logger.error(`[worker:${workerId}] loop error: ${(err as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(env.WORKER_POLL_INTERVAL_MS, 5000)));
    }
  }

  await closePool();
  logger.log(`[worker:${workerId}] stopped cleanly`);
}

// Only auto-start when run directly (node dist/src/worker/main.js), not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    console.error('[worker] fatal startup error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
