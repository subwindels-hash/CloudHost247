/**
 * Fraud Sentinel job execution with database-enforced locking.
 *
 * The unique `run_key` in `fraud_sentinel_runs` IS the lock, exactly as
 * `revenue_guardian_automation_runs` does it — this module reuses that discipline rather than adding a
 * second scheduler:
 *
 *   * a scheduled pass claims `<job>:sched:<bucket>`, so two overlapping workers execute a bucket once;
 *   * a manual run claims `<job>:manual:<YYYY-MM-DDTHH:MM>`, so a double-click cannot double-fire while
 *     a deliberate re-run a minute later still works;
 *   * a `running` row left behind by a crashed worker is reclaimed after a timeout, otherwise its key
 *     would block every later pass forever.
 *
 * A run's counters, duration and error are stored whether it succeeded or failed, because "the job ran
 * and did nothing" and "the job never ran" must be distinguishable on the operations screen.
 */
import type { Queryable } from '../../db/types';
import {
  EMPTY_COUNTERS,
  claimRun,
  finishRun,
  manualRunKey,
  reclaimStaleRuns as reclaimStale,
} from '../repositories/runs-repo';
import { findJob, type FsJobResult } from './definitions';
import { loadFsSettings } from '../utils/settings';
import type { FraudRunRow } from '../types';

export interface FsRunOutcome {
  /** `locked` means another worker already holds this bucket — not an error. */
  status: 'completed' | 'failed' | 'locked' | 'unknown_job';
  run?: FraudRunRow;
  result?: FsJobResult;
  error?: string;
  notes: string[];
}

/** How long a `running` row may survive before its lock is reclaimed. */
export const STALE_RUN_MINUTES = 60;

export async function executeJob(
  db: Queryable,
  jobName: string,
  options: { trigger: 'schedule' | 'manual'; runKey: string; triggeredBy?: string | null; now?: Date }
): Promise<FsRunOutcome> {
  const job = findJob(jobName);
  if (!job) return { status: 'unknown_job', notes: [`no job named ${jobName}`] };

  const run = await claimRun(db, {
    jobName,
    runKey: options.runKey,
    trigger: options.trigger,
    triggeredBy: options.triggeredBy ?? null,
  });
  // Another worker holds this bucket, which means the bucket is already being executed.
  if (!run) return { status: 'locked', notes: [`${jobName}: bucket ${options.runKey} already claimed`] };

  const startedAt = Date.now();
  try {
    const result = await job.run(db, options.now);
    await finishRun(db, run.id, {
      status: 'completed',
      counters: result.counters,
      durationMs: Date.now() - startedAt,
    });
    return { status: 'completed', run, result, notes: result.notes };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Counters are recorded as zeros on failure: how far the run got before it threw is not knowable
    // from here, and inventing partial counts would make the operations screen lie. The error text is
    // the record.
    await finishRun(db, run.id, {
      status: 'failed',
      counters: { ...EMPTY_COUNTERS },
      durationMs: Date.now() - startedAt,
      error: message,
    });
    return { status: 'failed', run, error: message, notes: [`${jobName} failed: ${message}`] };
  }
}

/**
 * Manual "Run now" from the operations screen.
 *
 * A manual run does NOT bypass `fraud_sentinel.enabled`: a disabled module stays disabled and the job
 * reports that it skipped. Overriding an administrator's off switch from a button would be its own
 * kind of surprise, and the run row still records that the button was pressed and by whom.
 */
export async function executeJobManually(
  db: Queryable,
  jobName: string,
  triggeredBy: string,
  now = new Date()
): Promise<FsRunOutcome> {
  return executeJob(db, jobName, {
    trigger: 'manual',
    runKey: manualRunKey(jobName, now),
    triggeredBy,
    now,
  });
}

/**
 * The run key a scheduled pass would use right now for a job.
 *
 * Each job defines its own bucket (per-interval for ingest/scan, daily for retention, hourly for rule
 * sync), so the key is derived from the job rather than from a single global interval.
 */
export async function scheduledRunKeyFor(db: Queryable, jobName: string, now: Date): Promise<string> {
  const job = findJob(jobName);
  if (!job) return `${jobName}:sched:unknown-job`;
  const settings = await loadFsSettings(db);
  return `${jobName}:sched:${job.bucketOf(now, settings)}`;
}

/** Reclaims wedged locks; called at the start of every scheduler pass. */
export async function reclaimStaleRuns(db: Queryable): Promise<number> {
  return reclaimStale(db, STALE_RUN_MINUTES);
}
