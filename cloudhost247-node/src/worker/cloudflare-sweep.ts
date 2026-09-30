/**
 * Cloudflare background job execution (spec §41–§42, §60) — runs inside the EXISTING worker
 * loop. Claim-lease + attempts + exponential backoff live in the cloudflare_jobs table
 * (src/db/cloudflare.ts); this sweep claims due jobs, executes them through the provider
 * abstraction, and records honest outcomes. A CONFIGURATION_REQUIRED failure retries on the
 * backoff schedule (the admin may be mid-setup) but is never silently swallowed; exhausting
 * attempts marks the service provisioning_failed / sync_failed — never ACTIVE (spec §65).
 *
 * Scheduled zone re-sync: enqueues sync_zone jobs for stale active services at the
 * admin-configured interval, with a per-service idempotency key per interval bucket so
 * overlapping workers cannot double-enqueue.
 */
import type { Queryable } from '../db/types';
import { getSetting } from '../db/ops-tables';
import { CloudflareError } from '../integrations/cloudflare/errors';
import {
  claimDueCloudflareJobs,
  finishCloudflareJob,
  updateCloudflareService,
  enqueueCloudflareJob,
  type CloudflareJobRow,
} from '../db/cloudflare';
import {
  executeChangePlan,
  executeSuspend,
  executeTerminate,
  executeUnsuspend,
  runCloudflareProvisioning,
  runCloudflareSync,
} from '../services/cloudflare-service';
import type { ResolveOptions } from '../integrations/cloudflare/config';

export interface CloudflareSweepReport {
  claimed: number;
  succeeded: number;
  retrying: number;
  failed: number;
  syncsScheduled: number;
}

async function loadServiceRow(db: Queryable, id: string) {
  const { rows } = await db.query<import('../db/cloudflare').CloudflareServiceRow>(
    `SELECT * FROM cloudflare_services WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function executeJob(db: Queryable, job: CloudflareJobRow, options: ResolveOptions): Promise<void> {
  const service = await loadServiceRow(db, job.cloudflare_service_id);
  if (!service) throw new Error('Cloudflare service no longer exists');
  switch (job.job_type) {
    case 'provision_zone':
      await runCloudflareProvisioning(db, service, options);
      return;
    case 'sync_zone':
    case 'sync_hosting_ip':
      await runCloudflareSync(db, service, options);
      return;
    case 'change_plan':
      await executeChangePlan(db, service, job.payload as { newPlanId?: string; newTier?: string }, options);
      return;
    case 'suspend':
      await executeSuspend(db, service, options);
      return;
    case 'unsuspend':
      await executeUnsuspend(db, service, options);
      return;
    case 'terminate':
      await executeTerminate(db, service, options);
      return;
    default:
      throw new Error(`Unknown Cloudflare job type: ${job.job_type as string}`);
  }
}

const TERMINAL_STATUS_FOR_JOB: Partial<Record<CloudflareJobRow['job_type'], 'provisioning_failed' | 'sync_failed'>> = {
  provision_zone: 'provisioning_failed',
  sync_zone: 'sync_failed',
  sync_hosting_ip: 'sync_failed',
};

export async function sweepCloudflareJobs(
  db: Queryable,
  workerId: string,
  options: ResolveOptions = {}
): Promise<CloudflareSweepReport> {
  const report: CloudflareSweepReport = { claimed: 0, succeeded: 0, retrying: 0, failed: 0, syncsScheduled: 0 };

  const enabled = await getSetting<boolean>(db, 'cloudflare.enabled', true);
  if (!enabled) return report;

  const jobs = await claimDueCloudflareJobs(db, workerId);
  report.claimed = jobs.length;

  for (const job of jobs) {
    try {
      await executeJob(db, job, options);
      const outcome = await finishCloudflareJob(db, job, { success: true });
      if (outcome === 'succeeded') report.succeeded += 1;
    } catch (error) {
      const isCf = error instanceof CloudflareError;
      const retryable = isCf ? error.retryable || error.code === 'CLOUDFLARE_CONFIGURATION_REQUIRED' : true;
      const message = error instanceof Error ? error.message : 'Unknown error';
      const outcome = await finishCloudflareJob(db, job, { success: false, error: message, retryable });
      if (outcome === 'retrying') report.retrying += 1;
      else {
        report.failed += 1;
        const terminalStatus = TERMINAL_STATUS_FOR_JOB[job.job_type];
        if (terminalStatus) {
          await updateCloudflareService(db, job.cloudflare_service_id, {
            status: terminalStatus,
            lastErrorCode: isCf ? error.code : 'INTERNAL_ERROR',
            lastErrorMessage: message.slice(0, 1000),
          });
        }
      }
    }
  }

  // Scheduled re-sync of stale active zones (spec §40): interval-bucketed idempotency keys so
  // concurrent sweeps cannot double-enqueue, and never more than a bounded batch per pass.
  const intervalMinutes = Math.max(30, Number(await getSetting<number>(db, 'cloudflare.sync_interval_minutes', 360)) || 360);
  const bucket = Math.floor(Date.now() / (intervalMinutes * 60_000));
  const { rows: stale } = await db.query<{ id: string }>(
    `SELECT id FROM cloudflare_services
      WHERE status = 'active' AND zone_id IS NOT NULL
        AND (last_synced_at IS NULL OR last_synced_at < now() - ($1 || ' minutes')::interval)
      ORDER BY last_synced_at ASC NULLS FIRST
      LIMIT 10`,
    [String(intervalMinutes)]
  );
  for (const row of stale) {
    const queued = await enqueueCloudflareJob(db, {
      serviceId: row.id,
      jobType: 'sync_zone',
      idempotencyKey: `cf-sched-sync:${row.id}:${bucket}`,
      maxAttempts: 3,
    });
    if (queued) report.syncsScheduled += 1;
  }

  return report;
}
