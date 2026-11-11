/**
 * Fraud Sentinel scheduler — integrated into the EXISTING worker loop (src/worker/main.ts), not a
 * second worker framework.
 *
 * Each pass:
 *   1. reclaims locks left behind by a crashed worker (this happens even when the module is disabled,
 *      so a wedge clears instead of persisting until someone re-enables the feature);
 *   2. checks `fraud_sentinel.enabled`;
 *   3. executes every job under its own schedule-bucket run key, so two overlapping workers claim the
 *      same key and only one of them runs the bucket.
 *
 * The pass never throws: a failing job is reported in `failed` and the remaining jobs still run. A
 * worker loop that died because one fraud job threw would take every other background job down with it.
 */
import type { Queryable } from '../../db/types';
import { FS_JOBS } from './definitions';
import { executeJob, reclaimStaleRuns } from './runner';
import { loadFsSettings } from '../utils/settings';

export interface SchedulerPassReport {
  ran: string[];
  locked: string[];
  failed: string[];
  /** True when the module is switched off and no job was attempted. */
  skipped: boolean;
  /** How many wedged `running` rows were reclaimed at the start of the pass. */
  reclaimed: number;
  notes: string[];
}

export async function runFraudSentinelCycle(db: Queryable, now = new Date()): Promise<SchedulerPassReport> {
  const report: SchedulerPassReport = { ran: [], locked: [], failed: [], skipped: false, reclaimed: 0, notes: [] };

  try {
    report.reclaimed = await reclaimStaleRuns(db);
    if (report.reclaimed > 0) report.notes.push(`reclaimed ${report.reclaimed} stale run lock(s)`);
  } catch (error) {
    report.notes.push(`stale-lock reclaim failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  const settings = await loadFsSettings(db);
  if (!settings.enabled) {
    report.skipped = true;
    report.notes.push('fraud_sentinel.enabled is false — no job attempted');
    return report;
  }

  for (const job of FS_JOBS) {
    const runKey = `${job.name}:sched:${job.bucketOf(now, settings)}`;
    try {
      const outcome = await executeJob(db, job.name, { trigger: 'schedule', runKey, now });
      if (outcome.status === 'completed') {
        report.ran.push(job.name);
        report.notes.push(...outcome.notes.map((note) => `${job.name}: ${note}`));
      } else if (outcome.status === 'locked') {
        report.locked.push(job.name);
      } else {
        report.failed.push(job.name);
        report.notes.push(...outcome.notes.map((note) => `${job.name}: ${note}`));
      }
    } catch (error) {
      // executeJob already records failures on the run row; this catches anything thrown outside it
      // (e.g. a claim that could not be written) so the pass continues with the remaining jobs.
      report.failed.push(job.name);
      report.notes.push(`${job.name}: pass error ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  return report;
}
