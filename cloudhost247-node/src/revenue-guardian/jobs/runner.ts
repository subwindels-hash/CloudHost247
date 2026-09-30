/**
 * Job execution with database-enforced locking (spec §19–§21, §50, §66).
 *
 * The unique run_key in revenue_guardian_automation_runs IS the lock: scheduled runs claim
 * `<job>:sched:<bucket>` (one execution per schedule bucket across all workers), manual runs
 * claim `<job>:manual` while running so two admins cannot double-fire. Stale 'running' rows
 * from a crashed worker are reclaimed after a timeout, and every run's counters, duration, and
 * error are stored for the Automation Runs page.
 */
import type { Queryable } from '../../db/types';
import type { AutomationRunRow, JobResult } from '../types';
import { claimRun, finishRun, failStaleRuns } from '../repositories/automation-repo';
import { findJob } from './definitions';

export interface RunOutcome {
  status: 'completed' | 'failed' | 'locked' | 'unknown_job';
  run?: AutomationRunRow;
  result?: JobResult;
  error?: string;
}

export async function executeJob(
  db: Queryable,
  jobName: string,
  options: { trigger: 'schedule' | 'manual'; runKey: string; triggeredBy?: string | null; now?: Date }
): Promise<RunOutcome> {
  const job = findJob(jobName);
  if (!job) return { status: 'unknown_job' };

  const run = await claimRun(db, jobName, options.runKey, options.trigger, options.triggeredBy ?? null);
  if (!run) return { status: 'locked' };

  const startedAt = Date.now();
  try {
    const result = await job.run(db, options.now);
    await finishRun(db, run.id, {
      status: 'completed',
      processed: result.processed,
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
      notificationsSent: result.notificationsSent,
      durationMs: Date.now() - startedAt,
    });
    return { status: 'completed', run, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await finishRun(db, run.id, {
      status: 'failed',
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      notificationsSent: 0,
      error: message,
      durationMs: Date.now() - startedAt,
    });
    return { status: 'failed', run, error: message };
  }
}

/**
 * Manual "Run Now" (spec §21). The run key contains the wall-clock minute so an accidental
 * double-click cannot double-run, while a deliberate later re-run is possible.
 */
export async function executeJobManually(
  db: Queryable,
  jobName: string,
  triggeredBy: string,
  now = new Date()
): Promise<RunOutcome> {
  const minuteKey = now.toISOString().slice(0, 16);
  return executeJob(db, jobName, {
    trigger: 'manual',
    runKey: `${jobName}:manual:${minuteKey}`,
    triggeredBy,
    now,
  });
}

/** Reclaims wedged locks; called at the start of every scheduler pass. */
export async function reclaimStaleRuns(db: Queryable): Promise<number> {
  return failStaleRuns(db, 60);
}
