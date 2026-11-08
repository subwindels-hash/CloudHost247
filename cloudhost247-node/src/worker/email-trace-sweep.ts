/**
 * Scheduled Email Trace collection and retention.
 *
 * Two jobs in one sweep, because they are the same maintenance moment:
 *
 *  1. **Collect** from every enabled source, oldest-successful first, so a host that has been failing
 *     is retried before a host that is already current. One server's failure never stops the others.
 *  2. **Trim** events and runs past their retention window. Events pinned with `retention_hold` are
 *     counted and reported as held rather than deleted, so an open investigation cannot be erased by
 *     a retention sweep.
 *
 * The sweep is safe to run concurrently: collection is idempotent (the dedupe constraint absorbs a
 * re-read) and the trim only removes rows that are already past the window.
 */
import type { Queryable } from '../db/types';
import { trimEmailTraceCollectionRuns, trimEmailTraceEvents } from '../db/email-trace';
import { collectEnabledServers, type CollectionResult } from '../email-trace/collector';
import { createAgentEximTraceAdapter, type EximTraceAdapter } from '../email-trace/adapters/exim-agent';
import { auditEmailTraceWorkerAction } from '../email-trace/audit';

export const EMAIL_TRACE_SWEEP_INTERVAL_MS = 5 * 60_000;

/** Matches `EMAIL_TRACE_RETENTION_DAYS` in src/config/env.ts; the env value is the operator's knob. */
export const EMAIL_TRACE_DEFAULT_RETENTION_DAYS = 30;
export const EMAIL_TRACE_DEFAULT_RUN_RETENTION_DAYS = 90;
/** Bounded per cycle so one slow host cannot make a sweep run for the whole interval. */
export const EMAIL_TRACE_MAX_SERVERS_PER_SWEEP = 25;

export interface EmailTraceSweepResult {
  servers: number;
  ok: number;
  partial: number;
  failed: number;
  skipped: number;
  eventsCollected: number;
  duplicates: number;
  rejected: number;
  retention: { eventsDeleted: number; eventsHeld: number; runsDeleted: number };
  results: CollectionResult[];
}

export async function sweepEmailTrace(
  db: Queryable,
  options: {
    adapter?: EximTraceAdapter;
    retentionDays?: number;
    runRetentionDays?: number;
    maxServers?: number;
  } = {}
): Promise<EmailTraceSweepResult> {
  const adapter = options.adapter ?? createAgentEximTraceAdapter(db);
  const results = await collectEnabledServers(db, adapter, {
    maxServers: options.maxServers ?? EMAIL_TRACE_MAX_SERVERS_PER_SWEEP,
  });

  const retention = {
    eventsDeleted: 0,
    eventsHeld: 0,
    runsDeleted: 0,
  };
  try {
    const events = await trimEmailTraceEvents(db, options.retentionDays ?? EMAIL_TRACE_DEFAULT_RETENTION_DAYS);
    retention.eventsDeleted = events.deleted;
    retention.eventsHeld = events.held;
    retention.runsDeleted = await trimEmailTraceCollectionRuns(
      db,
      options.runRetentionDays ?? EMAIL_TRACE_DEFAULT_RUN_RETENTION_DAYS
    );
  } catch {
    // A retention failure must not lose the collection results we just recorded.
  }

  const summary: EmailTraceSweepResult = {
    servers: results.length,
    ok: results.filter((result) => result.status === 'ok').length,
    partial: results.filter((result) => result.status === 'partial').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    eventsCollected: results.reduce((total, result) => total + result.collected, 0),
    duplicates: results.reduce((total, result) => total + result.duplicates, 0),
    rejected: results.reduce((total, result) => total + result.rejected, 0),
    retention,
    results,
  };

  if (summary.servers > 0 || retention.eventsDeleted > 0 || retention.runsDeleted > 0) {
    await auditEmailTraceWorkerAction(db, 'email_trace.collect_requested', {
      trigger: 'schedule',
      servers: summary.servers,
      ok: summary.ok,
      partial: summary.partial,
      failed: summary.failed,
      skipped: summary.skipped,
      eventsCollected: summary.eventsCollected,
      retention,
    });
  }

  return summary;
}
