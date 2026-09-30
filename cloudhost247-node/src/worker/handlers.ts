/**
 * Phase 6 — deployment worker job handlers (spec §29).
 *
 * One handler per action, each independently unit-testable, all sharing the engine. Handlers own
 * the *bookkeeping around* execution (installation status transitions, subscription side
 * effects); the engine owns the step pipeline itself. Nothing here is a giant switch statement —
 * dispatch is a registry lookup, and adding a new action means adding one file-local handler.
 */
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import {
  appendDeploymentEvent,
  claimNextDeployment,
  completeDeployment,
  enqueueDeployment,
  failDeployment,
  findDeploymentById,
  reclaimExpiredDeployments,
  renewDeploymentLease,
  setInstallationStatusIfCurrent,
  type DeploymentRow,
} from './worker-db';
import { executeDeployment, type EngineOptions } from '../deployments/engine';
import { executeServerProvisioning } from '../infrastructure/services/server-provisioner';

export interface JobContext {
  db: Queryable;
  options: EngineOptions;
  workerId: string;
  leaseMs?: number;
}

export type JobHandler = (ctx: JobContext, deployment: DeploymentRow) => Promise<void>;

/**
 * install/reinstall/start/stop/restart/update/backup/restore/uninstall/ssl_provision/
 * domain_configure/healthcheck/provision/suspend/terminate all map to engine pipelines; the
 * handler's job is the pre-state transition (queued → deploying) and logging.
 */
const engineBackedHandler: JobHandler = async (ctx, deployment) => {
  if (deployment.installation_id && (deployment.action === 'install' || deployment.action === 'reinstall')) {
    await setInstallationStatusIfCurrent(ctx.db, deployment.installation_id, ['pending', 'queued', 'failed'], 'deploying');
  }
  const result = await executeDeployment(ctx.db, ctx.options, deployment.id);
  await appendDeploymentEvent(
    ctx.db,
    deployment.id,
    result.outcome === 'succeeded' ? 'info' : 'error',
    `Job finished with outcome: ${result.outcome}`
  );
};

const serverProvisioningHandler: JobHandler = async (ctx,deployment) => {
  const result = await executeServerProvisioning(ctx.db,deployment);
  await appendDeploymentEvent(
    ctx.db,deployment.id,result.outcome === 'succeeded' ? 'info' : 'error',
    `Infrastructure job finished with outcome: ${result.outcome}`
  );
};

export const jobHandlers: Record<string, JobHandler> = {
  install: engineBackedHandler,
  reinstall: engineBackedHandler,
  start: engineBackedHandler,
  stop: engineBackedHandler,
  restart: engineBackedHandler,
  update: engineBackedHandler,
  backup: engineBackedHandler,
  restore: engineBackedHandler,
  uninstall: engineBackedHandler,
  ssl_provision: engineBackedHandler,
  domain_configure: engineBackedHandler,
  healthcheck: engineBackedHandler,
  provision: engineBackedHandler,
  suspend: engineBackedHandler,
  terminate: engineBackedHandler,
  server_provision: serverProvisioningHandler,
  server_reinstall: serverProvisioningHandler,
  server_start: serverProvisioningHandler,
  server_stop: serverProvisioningHandler,
  server_reboot: serverProvisioningHandler,
  server_shutdown: serverProvisioningHandler,
  server_rescue: serverProvisioningHandler,
  server_delete: serverProvisioningHandler,
  server_resize: serverProvisioningHandler,
  server_snapshot_create: serverProvisioningHandler,
  server_snapshot_restore: serverProvisioningHandler,
  server_snapshot_delete: serverProvisioningHandler,
};

export function hasHandler(action: string): boolean {
  return action in jobHandlers;
}

/** Claims and runs one job. Returns the claimed deployment (or null when the queue is empty). */
export async function processNextJob(ctx: JobContext): Promise<DeploymentRow | null> {
  const leaseMs=ctx.leaseMs??120_000;
  const claimed = await claimNextDeployment(ctx.db, ctx.workerId, leaseMs);
  if (!claimed) return null;

  const handler = jobHandlers[claimed.action];
  if (!handler) {
    await failDeployment(ctx.db, claimed, {
      errorCode: 'NO_HANDLER',
      errorMessage: `No worker handler registered for action ${claimed.action}`,
    });
    return claimed;
  }

  // Compute provisioning health waits can be much longer than the queue lease. Renew while any
  // handler runs so a second worker cannot reclaim and execute the same provider operation.
  const renewEveryMs=Math.max(1_000,Math.floor(leaseMs/3));
  const renewal=setInterval(()=>{void renewDeploymentLease(ctx.db,claimed.id,ctx.workerId,leaseMs).catch(()=>undefined);},renewEveryMs);
  renewal.unref?.();
  try {
    await handler(ctx, claimed);
  } catch (err) {
    // Handler-level failures (bookkeeping bugs, DB hiccups) fail the attempt; the queue's
    // retry-with-backoff logic decides whether it runs again.
    await failDeployment(ctx.db, claimed, {
      errorCode: 'HANDLER_ERROR',
      errorMessage: (err as Error).message,
    }).catch(() => undefined);
  } finally {
    clearInterval(renewal);
  }
  return claimed;
}

/** Reclaims jobs whose worker died (expired lease) — crash recovery, spec §28. */
export async function recoverOrphanedJobs(ctx: JobContext): Promise<number> {
  const reclaimed = await reclaimExpiredDeployments(ctx.db, ctx.workerId, ctx.leaseMs??120_000);
  for (const deployment of reclaimed) {
    await appendDeploymentEvent(
      ctx.db,
      deployment.id,
      'warn',
      `Recovered by ${ctx.workerId} after lease expiry (attempt ${deployment.attempts})`
    );
  }
  return reclaimed.length;
}
