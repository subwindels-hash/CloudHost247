import 'dotenv/config';
import { loadEnv } from '../config/env';
import { getPool, closePool } from '../db/pool';
import { processNextJob, recoverOrphanedJobs } from './handlers';
import {
  SECURITY_NUMBER_SWEEP_INTERVAL_MS,
  scheduleHealthChecks,
  sweepExpiredSupportSessions,
  sweepSecurityNumbers,
  sweepSubscriptions,
} from './sweeps';
import { sweepOperatingSystemLifecycle } from '../services/os-lifecycle-service';
import { sweepScheduledTerminations } from '../services/server-termination-service';
import { deliverNotificationOutbox } from '../services/notification-outbox-service';
import { reconcileServerState } from '../services/infrastructure-reconciliation-service';
import { revalidateProviderImages } from '../services/os-image-revalidation-service';
import { runRevenueGuardianCycle } from '../revenue-guardian/jobs/scheduler';
import { sweepCloudflareJobs } from './cloudflare-sweep';
import type { EngineOptions } from '../deployments/engine';

const HEALTHCHECK_INTERVAL_MS = 60_000;
const SUBSCRIPTION_SWEEP_INTERVAL_MS = 5 * 60_000;
// OS end-of-life dates move at most once a day; hourly is frequent enough and cheap.
const OS_LIFECYCLE_SWEEP_INTERVAL_MS = 60 * 60_000;
// Scheduled cancellations are day-granular in practice; a 15-minute sweep destroys them promptly
// after the paid term ends without polling the database hard.
const TERMINATION_SWEEP_INTERVAL_MS = 15 * 60_000;
// Notification emails are queued, not sent inline, so this drain is what actually delivers them.
const NOTIFICATION_OUTBOX_INTERVAL_MS = 60_000;
// Provider state drifts slowly and each check is a provider API call, so the sweep walks a
// bounded batch of the oldest-checked servers every ten minutes rather than polling everything.
const RECONCILIATION_INTERVAL_MS = 10 * 60_000;
// Image catalogs change on the scale of provider releases, so a six-hourly pass over the stalest
// mappings is enough to catch a withdrawn image long before a customer orders it.
const IMAGE_REVALIDATION_INTERVAL_MS = 6 * 60 * 60_000;
// Revenue Guardian automation cycle: the sweep runs every 5 minutes, but each job only actually
// executes once per admin-configured schedule bucket (run_key lock) — see
// src/revenue-guardian/jobs/scheduler.ts. Frequent sweeping just means a due bucket is picked up
// promptly; it never causes double execution.
const REVENUE_GUARDIAN_SWEEP_INTERVAL_MS = 5 * 60_000;
// Cloudflare durable job queue: claim-lease with per-job backoff, so sweeping often is cheap.
const CLOUDFLARE_SWEEP_INTERVAL_MS = 60_000;

function engineOptions(simulationMode: boolean, kubernetesEnabled: boolean): EngineOptions {
  return { simulationMode, kubernetesEnabled };
}

async function main() {
  const env = loadEnv();
  const pool = getPool(env);
  const workerId = env.WORKER_ID;
  const ctx = {
    db: pool,
    options: engineOptions(env.DEPLOYMENT_SIMULATION_MODE, env.KUBERNETES_ADAPTER_ENABLED),
    workerId,
    leaseMs:env.WORKER_LEASE_MS,
  };

  const logger = console; // worker logs to stdout; pino JSON in a later ops phase
  logger.log(`[worker:${workerId}] starting (poll=${env.WORKER_POLL_INTERVAL_MS}ms, concurrency=${env.WORKER_CONCURRENCY}, simulation=${env.DEPLOYMENT_SIMULATION_MODE})`);

  let running = true;
  let lastHealthSweep = 0;
  let lastSubscriptionSweep = 0;
  let lastOsLifecycleSweep = 0;
  let lastTerminationSweep = 0;
  let lastNotificationDrain = 0;
  let lastReconciliation = 0;
  let lastImageRevalidation = 0;
  let lastSecurityNumberSweep = 0;
  let lastRevenueGuardianSweep = 0;
  let lastCloudflareSweep = 0;

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
      if (now - lastOsLifecycleSweep >= OS_LIFECYCLE_SWEEP_INTERVAL_MS) {
        lastOsLifecycleSweep = now;
        const transitions = await sweepOperatingSystemLifecycle(pool);
        for (const change of transitions) {
          logger.log(`[worker:${workerId}] OS version ${change.displayName}: ${change.from} → ${change.to} (${change.notifiedServers} customer notice(s))`);
        }
      }

      if (now - lastTerminationSweep >= TERMINATION_SWEEP_INTERVAL_MS) {
        lastTerminationSweep = now;
        for (const terminated of await sweepScheduledTerminations(pool)) {
          logger.log(`[worker:${workerId}] scheduled termination due for ${terminated.name}: ${terminated.jobId ? `job ${terminated.jobId}` : 'retired without a provider resource'}`);
        }
      }

      if (now - lastNotificationDrain >= NOTIFICATION_OUTBOX_INTERVAL_MS) {
        lastNotificationDrain = now;
        const delivery = await deliverNotificationOutbox(pool);
        if (delivery.claimed > 0) {
          logger.log(`[worker:${workerId}] notification outbox: ${delivery.delivered} delivered, ${delivery.retrying} retrying, ${delivery.failed} failed, ${delivery.configurationRequired} awaiting configuration`);
        }
      }

      if (now - lastReconciliation >= RECONCILIATION_INTERVAL_MS) {
        lastReconciliation = now;
        for (const drift of await reconcileServerState(pool)) {
          logger.log(`[worker:${workerId}] drift on ${drift.name}: ${drift.kind} ${drift.from} → ${drift.to}${drift.applied ? ' (applied)' : ' (reported only)'}`);
        }
      }

      if (now - lastImageRevalidation >= IMAGE_REVALIDATION_INTERVAL_MS) {
        lastImageRevalidation = now;
        for (const check of await revalidateProviderImages(pool)) {
          if (check.outcome !== 'VERIFIED') {
            logger.log(`[worker:${workerId}] image ${check.providerImageId ?? check.imageId}: ${check.outcome}${check.error ? ` — ${check.error}` : ''}`);
          }
        }
      }

      if (now - lastCloudflareSweep >= CLOUDFLARE_SWEEP_INTERVAL_MS) {
        lastCloudflareSweep = now;
        const cf = await sweepCloudflareJobs(pool, workerId);
        if (cf.claimed > 0 || cf.syncsScheduled > 0) {
          logger.log(`[worker:${workerId}] cloudflare jobs: ${cf.succeeded} succeeded, ${cf.retrying} retrying, ${cf.failed} failed, ${cf.syncsScheduled} sync(s) scheduled`);
        }
      }

      if (now - lastRevenueGuardianSweep >= REVENUE_GUARDIAN_SWEEP_INTERVAL_MS) {
        lastRevenueGuardianSweep = now;
        const rg = await runRevenueGuardianCycle(pool);
        if (rg.ran.length > 0 || rg.failed.length > 0) {
          logger.log(`[worker:${workerId}] revenue guardian: ran [${rg.ran.join(', ')}]${rg.failed.length ? `; failed [${rg.failed.join(', ')}]` : ''}`);
        }
      }

      if (now - lastSecurityNumberSweep >= SECURITY_NUMBER_SWEEP_INTERVAL_MS) {
        lastSecurityNumberSweep = now;
        const rotated = await sweepSecurityNumbers(pool);
        const closed = await sweepExpiredSupportSessions(pool);
        if (rotated > 0 || closed > 0) {
          logger.log(`[worker:${workerId}] security numbers rotated: ${rotated}; support sessions expired: ${closed}`);
        }
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
