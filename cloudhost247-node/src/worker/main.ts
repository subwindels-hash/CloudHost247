import 'dotenv/config';
import { loadEnv } from '../config/env';
import { getPool, closePool } from '../db/pool';
import { processNextJob, recoverOrphanedJobs, type JobContext } from './handlers';
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
import {
  DEFAULT_WORKER_CYCLE_LEASE_NAME,
  withWorkerCycleLease,
} from './worker-lease';
import { parseWorkerOnceMode, runWorkerLoop, type WorkerCycleOutcome } from './runtime';

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

interface WorkerLogger {
  log(message: string): void;
  error(message: string): void;
}

interface WorkerSchedule {
  lastHealthSweep: number;
  lastSubscriptionSweep: number;
  lastOsLifecycleSweep: number;
  lastTerminationSweep: number;
  lastNotificationDrain: number;
  lastReconciliation: number;
  lastImageRevalidation: number;
  lastSecurityNumberSweep: number;
  lastRevenueGuardianSweep: number;
  lastCloudflareSweep: number;
}

function createWorkerSchedule(): WorkerSchedule {
  return {
    lastHealthSweep: 0,
    lastSubscriptionSweep: 0,
    lastOsLifecycleSweep: 0,
    lastTerminationSweep: 0,
    lastNotificationDrain: 0,
    lastReconciliation: 0,
    lastImageRevalidation: 0,
    lastSecurityNumberSweep: 0,
    lastRevenueGuardianSweep: 0,
    lastCloudflareSweep: 0,
  };
}

function engineOptions(simulationMode: boolean, kubernetesEnabled: boolean): EngineOptions {
  return { simulationMode, kubernetesEnabled };
}

/**
 * Executes one bounded worker cycle. This same cycle is used by a supervised long-running
 * process and by cPanel's `worker:once` cron command; `schedule` keeps interval-gated tasks from
 * running on every tight persistent-loop iteration. A fresh one-shot process has a fresh
 * schedule, which intentionally makes all periodic checks due once per Cron invocation.
 */
async function runWorkerCycle(
  ctx: JobContext,
  schedule: WorkerSchedule,
  logger: WorkerLogger,
  concurrency: number
): Promise<WorkerCycleOutcome> {
  let didWork = false;
  const recovered = await recoverOrphanedJobs(ctx);
  didWork ||= recovered > 0;

  // Drain at most the configured number of deployment jobs in one cycle. Each individual claim
  // is protected by its own row lease; this is safe even when a failed old Cron process is later
  // recovered after the cycle lease expires.
  const claimed: Array<Promise<unknown>> = [];
  for (let slot = 0; slot < concurrency; slot += 1) {
    claimed.push(processNextJob(ctx));
  }
  const processed = await Promise.all(claimed);
  didWork ||= processed.some((job) => job !== null);

  const now = Date.now();
  if (now - schedule.lastHealthSweep >= HEALTHCHECK_INTERVAL_MS) {
    schedule.lastHealthSweep = now;
    const scheduled = await scheduleHealthChecks(ctx.db);
    didWork ||= scheduled > 0;
    if (scheduled > 0) logger.log(`[worker:${ctx.workerId}] scheduled ${scheduled} health check job(s)`);
  }
  if (now - schedule.lastSubscriptionSweep >= SUBSCRIPTION_SWEEP_INTERVAL_MS) {
    schedule.lastSubscriptionSweep = now;
    await sweepSubscriptions(ctx.db);
  }
  if (now - schedule.lastOsLifecycleSweep >= OS_LIFECYCLE_SWEEP_INTERVAL_MS) {
    schedule.lastOsLifecycleSweep = now;
    for (const change of await sweepOperatingSystemLifecycle(ctx.db)) {
      didWork ||= true;
      logger.log(
        `[worker:${ctx.workerId}] OS version ${change.displayName}: ${change.from} → ${change.to} (${change.notifiedServers} customer notice(s))`
      );
    }
  }
  if (now - schedule.lastTerminationSweep >= TERMINATION_SWEEP_INTERVAL_MS) {
    schedule.lastTerminationSweep = now;
    for (const terminated of await sweepScheduledTerminations(ctx.db)) {
      didWork ||= true;
      logger.log(
        `[worker:${ctx.workerId}] scheduled termination due for ${terminated.name}: ${terminated.jobId ? `job ${terminated.jobId}` : 'retired without a provider resource'}`
      );
    }
  }
  if (now - schedule.lastNotificationDrain >= NOTIFICATION_OUTBOX_INTERVAL_MS) {
    schedule.lastNotificationDrain = now;
    const delivery = await deliverNotificationOutbox(ctx.db);
    didWork ||= delivery.claimed > 0;
    if (delivery.claimed > 0) {
      logger.log(
        `[worker:${ctx.workerId}] notification outbox: ${delivery.delivered} delivered, ${delivery.retrying} retrying, ${delivery.failed} failed, ${delivery.configurationRequired} awaiting configuration`
      );
    }
  }
  if (now - schedule.lastReconciliation >= RECONCILIATION_INTERVAL_MS) {
    schedule.lastReconciliation = now;
    for (const drift of await reconcileServerState(ctx.db)) {
      didWork ||= true;
      logger.log(
        `[worker:${ctx.workerId}] drift on ${drift.name}: ${drift.kind} ${drift.from} → ${drift.to}${drift.applied ? ' (applied)' : ' (reported only)'}`
      );
    }
  }
  if (now - schedule.lastImageRevalidation >= IMAGE_REVALIDATION_INTERVAL_MS) {
    schedule.lastImageRevalidation = now;
    for (const check of await revalidateProviderImages(ctx.db)) {
      if (check.outcome !== 'VERIFIED') {
        didWork ||= true;
        logger.log(
          `[worker:${ctx.workerId}] image ${check.providerImageId ?? check.imageId}: ${check.outcome}${check.error ? ` — ${check.error}` : ''}`
        );
      }
    }
  }
  if (now - schedule.lastCloudflareSweep >= CLOUDFLARE_SWEEP_INTERVAL_MS) {
    schedule.lastCloudflareSweep = now;
    const cloudflare = await sweepCloudflareJobs(ctx.db, ctx.workerId);
    didWork ||= cloudflare.claimed > 0 || cloudflare.syncsScheduled > 0;
    if (cloudflare.claimed > 0 || cloudflare.syncsScheduled > 0) {
      logger.log(
        `[worker:${ctx.workerId}] cloudflare jobs: ${cloudflare.succeeded} succeeded, ${cloudflare.retrying} retrying, ${cloudflare.failed} failed, ${cloudflare.syncsScheduled} sync(s) scheduled`
      );
    }
  }
  if (now - schedule.lastRevenueGuardianSweep >= REVENUE_GUARDIAN_SWEEP_INTERVAL_MS) {
    schedule.lastRevenueGuardianSweep = now;
    const revenueGuardian = await runRevenueGuardianCycle(ctx.db);
    didWork ||= revenueGuardian.ran.length > 0 || revenueGuardian.failed.length > 0;
    if (revenueGuardian.ran.length > 0 || revenueGuardian.failed.length > 0) {
      logger.log(
        `[worker:${ctx.workerId}] revenue guardian: ran [${revenueGuardian.ran.join(', ')}]${revenueGuardian.failed.length ? `; failed [${revenueGuardian.failed.join(', ')}]` : ''}`
      );
    }
  }
  if (now - schedule.lastSecurityNumberSweep >= SECURITY_NUMBER_SWEEP_INTERVAL_MS) {
    schedule.lastSecurityNumberSweep = now;
    const rotated = await sweepSecurityNumbers(ctx.db);
    const closed = await sweepExpiredSupportSessions(ctx.db);
    didWork ||= rotated > 0 || closed > 0;
    if (rotated > 0 || closed > 0) {
      logger.log(`[worker:${ctx.workerId}] security numbers rotated: ${rotated}; support sessions expired: ${closed}`);
    }
  }

  return { didWork };
}

/** Worker CLI entry point. `--once` is for cPanel Cron; no flag is for a supervised worker host. */
export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const env = loadEnv();
  const once = parseWorkerOnceMode(argv, env.WORKER_ONCE);
  const pool = getPool(env);
  const workerId = env.WORKER_ID;
  const ctx: JobContext = {
    db: pool,
    options: engineOptions(env.DEPLOYMENT_SIMULATION_MODE, env.KUBERNETES_ADAPTER_ENABLED),
    workerId,
    leaseMs: env.WORKER_LEASE_MS,
  };
  const logger: WorkerLogger = console;
  const schedule = createWorkerSchedule();
  let running = true;

  const shutdown = (signal: string) => {
    logger.log(`[worker:${workerId}] ${signal} received — draining`);
    running = false;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.log(
    `[worker:${workerId}] starting (${once ? 'one-shot Cron cycle' : 'persistent worker'}, poll=${env.WORKER_POLL_INTERVAL_MS}ms, concurrency=${env.WORKER_CONCURRENCY}, simulation=${env.DEPLOYMENT_SIMULATION_MODE})`
  );

  try {
    await runWorkerLoop(
      async () => {
        if (!once) return runWorkerCycle(ctx, schedule, logger, env.WORKER_CONCURRENCY);

        const lease = await withWorkerCycleLease(
          pool,
          {
            name: DEFAULT_WORKER_CYCLE_LEASE_NAME,
            holder: workerId,
            leaseMs: env.WORKER_ONCE_LEASE_MS,
          },
          () => runWorkerCycle(ctx, schedule, logger, env.WORKER_CONCURRENCY),
          (error) => logger.error(`[worker:${workerId}] cycle-lease issue: ${error.message}`)
        );
        if (!lease.acquired) {
          logger.log(`[worker:${workerId}] skipped one-shot cycle: another Cron worker holds the active lease`);
          return { didWork: false };
        }
        return lease.value ?? { didWork: false };
      },
      {
        once,
        pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
        isRunning: () => running,
        onError: (error) => logger.error(`[worker:${workerId}] loop error: ${error.message}`),
      }
    );
  } finally {
    await closePool();
    logger.log(`[worker:${workerId}] stopped cleanly`);
  }
}

// Only auto-start when run directly (node dist/src/worker/main.js), not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[worker] fatal startup error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
