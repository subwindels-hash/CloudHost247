/**
 * Run ledger and database-enforced job locking.
 *
 * The unique `run_key` IS the lock, exactly as `revenue_guardian_automation_runs` does it — this module
 * deliberately reuses that discipline rather than inventing a second scheduler:
 *
 *   * a scheduled pass claims `<job>:sched:<bucket>`, where the bucket is derived from the configured
 *     interval in UTC. Two overlapping workers compute the same key, one INSERT succeeds and the other
 *     gets `null`, so a bucket executes exactly once;
 *   * a manual "Run now" claims `<job>:manual:<YYYY-MM-DDTHH:MM>`, so an accidental double-click cannot
 *     double-fire while a deliberate later re-run stays possible;
 *   * a `running` row whose worker died is reclaimed after a timeout, otherwise its key would block
 *     every later pass forever.
 *
 * Counters are stored with the run so the operations screen can answer "did the scan actually do
 * anything?" without re-deriving it from the alerts table.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { FraudRunRow, Paginated, RunCounters } from '../types';
import { paginate } from '../types';

export const EMPTY_COUNTERS: RunCounters = Object.freeze({
  subjectsScanned: 0,
  eventsIngested: 0,
  assessmentsCreated: 0,
  alertsCreated: 0,
  alertsUpdated: 0,
  notificationsSent: 0,
  recordsPruned: 0,
  failedCount: 0,
});

/** A non-negative integer counter, clamped: a bogus counter must never break the CHECK constraints. */
function counter(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toRunRow(row: Record<string, unknown>): FraudRunRow {
  return {
    id: String(row.id),
    job_name: String(row.job_name),
    run_key: String(row.run_key),
    trigger: row.trigger === 'manual' ? 'manual' : 'schedule',
    triggered_by: toText(row.triggered_by),
    status: row.status === 'failed' ? 'failed' : row.status === 'completed' ? 'completed' : 'running',
    subjects_scanned: Number(row.subjects_scanned ?? 0),
    events_ingested: Number(row.events_ingested ?? 0),
    assessments_created: Number(row.assessments_created ?? 0),
    alerts_created: Number(row.alerts_created ?? 0),
    alerts_updated: Number(row.alerts_updated ?? 0),
    notifications_sent: Number(row.notifications_sent ?? 0),
    records_pruned: Number(row.records_pruned ?? 0),
    failed_count: Number(row.failed_count ?? 0),
    started_at: String(row.started_at),
    finished_at: toText(row.finished_at),
    duration_ms: toNumberOrNull(row.duration_ms),
    error: toText(row.error),
    created_at: String(row.created_at),
    ...(row.triggered_by_name !== undefined ? { triggered_by_name: toText(row.triggered_by_name) } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Locking                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Attempts to claim `runKey`. Returns the new run row, or null when another worker already holds it.
 *
 * `ON CONFLICT (run_key) DO NOTHING` against the unique index is the whole mechanism: no advisory
 * locks, no SELECT-then-INSERT race, and nothing to release if the caller crashes (see reclaimStaleRuns).
 */
export async function claimRun(
  db: Queryable,
  options: { jobName: string; runKey: string; trigger: 'schedule' | 'manual'; triggeredBy?: string | null }
): Promise<FraudRunRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO fraud_sentinel_runs (id, job_name, run_key, trigger, triggered_by, status)
     VALUES ($1,$2,$3,$4,$5,'running')
     ON CONFLICT (run_key) DO NOTHING
     RETURNING *`,
    [randomUUID(), options.jobName, options.runKey, options.trigger, options.triggeredBy ?? null]
  );
  return rows[0] ? toRunRow(rows[0]) : null;
}

/**
 * Records the outcome of a claimed run. Called on both the success and the failure path — a run that
 * is left `running` is indistinguishable from a wedged lock.
 */
export async function finishRun(
  db: Queryable,
  runId: string,
  outcome: { status: 'completed' | 'failed'; counters: RunCounters; durationMs: number; error?: string | null }
): Promise<void> {
  await db.query(
    `UPDATE fraud_sentinel_runs
        SET status = $2, finished_at = now(), duration_ms = $3,
            subjects_scanned = $4, events_ingested = $5, assessments_created = $6,
            alerts_created = $7, alerts_updated = $8, notifications_sent = $9,
            records_pruned = $10, failed_count = $11, error = $12
      WHERE id = $1::uuid`,
    [
      runId,
      outcome.status,
      counter(outcome.durationMs),
      counter(outcome.counters.subjectsScanned),
      counter(outcome.counters.eventsIngested),
      counter(outcome.counters.assessmentsCreated),
      counter(outcome.counters.alertsCreated),
      counter(outcome.counters.alertsUpdated),
      counter(outcome.counters.notificationsSent),
      counter(outcome.counters.recordsPruned),
      counter(outcome.counters.failedCount),
      outcome.error ?? null,
    ]
  );
}

/**
 * Fails `running` rows older than the timeout, so no worker is left waiting on a lock whose owner is
 * gone.
 *
 * The reclaimed row KEEPS its `run_key`: a bucket is attempted once and stays on the record as
 * `failed` rather than being silently retried under the same key. Nothing is lost by that — the next
 * bucket re-does the work, because a scan reads the whole window and ingestion is idempotent, and the
 * failed row is what tells an operator the earlier pass did not finish.
 *
 * The error text says the run did not complete rather than inventing a reason: a reclaimed lock means
 * the worker died or hung, and nothing here can know which.
 */
export async function reclaimStaleRuns(db: Queryable, olderThanMinutes = 60): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE fraud_sentinel_runs
        SET status = 'failed', finished_at = now(),
            error = 'Run did not complete (stale lock reclaimed)'
      WHERE status = 'running' AND started_at < now() - ($1 || ' minutes')::interval
      RETURNING id`,
    [String(Math.max(1, Math.floor(olderThanMinutes)))]
  );
  return rows.length;
}

/**
 * The manual run key: wall-clock minute, so a double-click cannot double-run.
 *
 * Scheduled keys are built by the job runner from each job's own `bucketOf`, because the four jobs run
 * on different cadences (per-interval, daily, hourly). There is deliberately no second helper here
 * that computes a schedule key from a single global interval — two ways of deriving the same key is
 * how a bucket ends up executed twice.
 */
export function manualRunKey(jobName: string, now: Date): string {
  return `${jobName}:manual:${now.toISOString().slice(0, 16)}`;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export interface RunFilters {
  page: number;
  limit: number;
  jobName?: string | null;
  status?: 'running' | 'completed' | 'failed' | null;
  trigger?: 'schedule' | 'manual' | null;
  since?: Date | null;
  until?: Date | null;
}

/**
 * Recent runs, newest first, for the operations screen.
 *
 * Run rows carry no customer data — they are counters about the module's own execution — so there is
 * no customer scope to apply. The route that exposes them is administrator-only.
 */
export async function listRuns(db: Queryable, filters: RunFilters): Promise<Paginated<FraudRunRow>> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  const push = (clause: string, value: unknown) => {
    params.push(value);
    clauses.push(clause.replace('?', `$${params.length}`));
  };

  if (filters.jobName) push('r.job_name = ?', filters.jobName);
  if (filters.status) push('r.status = ?', filters.status);
  if (filters.trigger) push('r.trigger = ?', filters.trigger);
  if (filters.since) push('r.started_at >= ?::timestamptz', filters.since.toISOString());
  if (filters.until) push('r.started_at <= ?::timestamptz', filters.until.toISOString());

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT r.*, u.full_name AS triggered_by_name
     FROM fraud_sentinel_runs r
     LEFT JOIN users u ON u.id = r.triggered_by
     ${whereSql}
     ORDER BY r.started_at DESC, r.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, (filters.page - 1) * filters.limit]
  );
  const { rows: countRows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM fraud_sentinel_runs r ${whereSql}`,
    params
  );
  return paginate(rows.map(toRunRow), countRows[0]?.total ?? 0, filters.page, filters.limit);
}

/** The most recent completed run per job — "when did each job last actually succeed?". */
export async function latestRunPerJob(db: Queryable): Promise<FraudRunRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT DISTINCT ON (r.job_name) r.*
     FROM fraud_sentinel_runs r
     ORDER BY r.job_name, r.started_at DESC, r.id DESC`
  );
  return rows.map(toRunRow);
}

/** The last run for one job and one run key, if any. */
export async function findRunByKey(db: Queryable, runKey: string): Promise<FraudRunRow | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM fraud_sentinel_runs WHERE run_key = $1 LIMIT 1`,
    [runKey]
  );
  return rows[0] ? toRunRow(rows[0]) : null;
}
