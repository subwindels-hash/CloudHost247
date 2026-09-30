/**
 * Revenue Guardian scheduler (spec §20, §48, §66) — integrated into the EXISTING worker loop
 * (src/worker/main.ts), not a second worker framework.
 *
 * Each pass:
 *  1. checks the module is enabled;
 *  2. reclaims stale locks;
 *  3. executes every job under a schedule-bucket run key. The bucket is derived from the
 *     admin-configured interval (revenue_guardian.scheduler_interval_minutes) in UTC, so two
 *     overlapping workers claim the same key and only one executes (spec §50).
 */
import type { Queryable } from '../../db/types';
import { getRgSetting } from '../utils/settings';
import { RG_JOBS } from './definitions';
import { executeJob, reclaimStaleRuns } from './runner';

export interface SchedulerPassReport {
  ran: string[];
  locked: string[];
  failed: string[];
  skipped: boolean;
}

export async function runRevenueGuardianCycle(db: Queryable, now = new Date()): Promise<SchedulerPassReport> {
  const report: SchedulerPassReport = { ran: [], locked: [], failed: [], skipped: false };

  const enabled = await getRgSetting(db, 'enabled');
  if (!enabled) {
    report.skipped = true;
    return report;
  }

  await reclaimStaleRuns(db);

  const intervalMinutes = Math.max(5, Number(await getRgSetting(db, 'schedulerIntervalMinutes')) || 60);
  const bucket = Math.floor(now.getTime() / (intervalMinutes * 60_000));

  for (const job of RG_JOBS) {
    const outcome = await executeJob(db, job.name, {
      trigger: 'schedule',
      runKey: `${job.name}:sched:${bucket}`,
      now,
    });
    if (outcome.status === 'completed') report.ran.push(job.name);
    else if (outcome.status === 'locked') report.locked.push(job.name);
    else if (outcome.status === 'failed') report.failed.push(job.name);
  }
  return report;
}
