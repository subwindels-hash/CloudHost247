import 'dotenv/config';
import { loadEnv } from '../config/env';
import { getPool, closePool } from '../db/pool';
import { processNextJob, recoverOrphanedJobs } from './handlers';
import { scheduleHealthChecks, sweepSubscriptions } from './sweeps';
import type { EngineOptions } from '../deployments/engine';

const HEALTHCHECK_INTERVAL_MS = 60_000;
const SUBSCRIPTION_SWEEP_INTERVAL_MS = 5 * 60_000;

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
