/**
 * Fraud Sentinel job definitions — integrated into the EXISTING worker loop (src/worker/main.ts),
 * not a second worker framework.
 *
 * Four jobs, each with its own schedule bucket so a job that does not need to run every pass does not:
 *
 *   fraud_sentinel_ingest    every `scheduler_interval_minutes` — project newly recorded rows into the
 *                            detection ledger. Cheap, idempotent, and it keeps the ledger fresh even
 *                            when a full scan is expensive.
 *   fraud_sentinel_scan      every `scheduler_interval_minutes` — assess active subjects and raise or
 *                            refresh alerts. Ingests first, so a manual "Run now" is self-sufficient;
 *                            when both jobs run in the same pass the second ingest is a no-op because
 *                            every row is already projected (unique dedupe key).
 *   fraud_sentinel_retention daily — apply the configured retention horizons.
 *   fraud_sentinel_rule_sync hourly — insert catalogue rules the database is missing. It never
 *                            overwrites a rule an operator has tuned.
 *
 * No job here performs an enforcement action: they write fraud_sentinel_* rows and notifications only.
 */
import type { Queryable } from '../../db/types';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../rules/signals';
import { RULE_CATALOGUE } from '../rules/catalogue';
import { syncCatalogue } from '../repositories/rules-repo';
import { ingestNewEvents } from '../repositories/events-repo';
import { EMPTY_COUNTERS } from '../repositories/runs-repo';
import { applyRetention, runFraudScan } from '../services/scan-service';
import { loadFsSettings, type FsSettings } from '../utils/settings';
import type { RunCounters } from '../types';

export interface FsJobResult {
  counters: RunCounters;
  /** Short human-readable outcome lines, stored nowhere — returned to the caller and the app log. */
  notes: string[];
  /** Sources that could not be read during the pass. Never silently ignored. */
  skippedSources?: Array<{ table: string; reason: string }>;
}

export interface FsJobDefinition {
  name: string;
  description: string;
  /** The schedule bucket this job runs once per. Two workers in the same bucket claim the same key. */
  bucketOf: (now: Date, settings: FsSettings) => string;
  run: (db: Queryable, now?: Date) => Promise<FsJobResult>;
}

function intervalBucket(now: Date, settings: FsSettings): string {
  const intervalMinutes = Math.max(1, Math.floor(settings.schedulerIntervalMinutes));
  return String(Math.floor(now.getTime() / (intervalMinutes * MS_PER_MINUTE)));
}

export const FS_JOB_INGEST = 'fraud_sentinel_ingest';
export const FS_JOB_SCAN = 'fraud_sentinel_scan';
export const FS_JOB_RETENTION = 'fraud_sentinel_retention';
export const FS_JOB_RULE_SYNC = 'fraud_sentinel_rule_sync';

export const FS_JOBS: readonly FsJobDefinition[] = [
  {
    name: FS_JOB_INGEST,
    description:
      'Projects newly recorded platform rows into the fraud detection ledger. Idempotent: a row already projected is excluded by the source query and refused by the unique dedupe key.',
    bucketOf: intervalBucket,
    run: async (db, now) => {
      const evaluatedAt = now ?? new Date();
      const settings = await loadFsSettings(db);
      if (!settings.enabled) {
        return { counters: { ...EMPTY_COUNTERS }, notes: ['fraud_sentinel.enabled is false — nothing ingested'] };
      }
      // Ingestion only — no assessment, no alert. The scan job calls runFraudScan, which ingests as
      // its first step; this job exists so the ledger stays fresh between scans.
      const outcome = await ingestNewEvents(db, {
        since: new Date(evaluatedAt.getTime() - (settings.lookbackDays + 1) * MS_PER_DAY),
        limitPerTable: settings.ingestBatchLimit,
      });
      return {
        counters: { ...EMPTY_COUNTERS, eventsIngested: outcome.ingested },
        notes: [
          `scanned ${outcome.scanned} source row(s), projected ${outcome.ingested} new event(s)`,
          ...outcome.perTable.map((entry) => `${entry.table}: ${entry.ingested}/${entry.scanned}`),
        ],
        skippedSources: outcome.skippedSources,
      };
    },
  },
  {
    name: FS_JOB_SCAN,
    description:
      'Assesses every subject with recorded activity in the lookback window and raises or refreshes alerts. Stores an assessment only when it says something new.',
    bucketOf: intervalBucket,
    run: async (db, now) => {
      const report = await runFraudScan(db, { ...(now ? { now } : {}) });
      if (!report.enabled) {
        return { counters: { ...EMPTY_COUNTERS }, notes: ['fraud_sentinel.enabled is false — scan skipped'] };
      }
      return {
        counters: report.counters,
        notes: [
          `ingested ${report.ingestion.ingested} event(s), considered ${report.subjectsConsidered} subject(s)`,
          `assessments stored ${report.assessmentsCreated}, unchanged ${report.assessmentsUnchanged}`,
          `alerts created ${report.alertsCreated}, refreshed ${report.alertsUpdated}, notifications ${report.notificationsSent}`,
          ...(report.ingestion.skippedSources.map((entry) => `SKIPPED SOURCE ${entry.table}: ${entry.reason}`)),
          ...(report.failures.map((failure) => `FAILED ${failure.subjectType} ${failure.subjectId}: ${failure.error}`)),
        ],
        skippedSources: report.ingestion.skippedSources,
      };
    },
  },
  {
    name: FS_JOB_RETENTION,
    description:
      'Applies the configured retention horizons to the projected event ledger, superseded assessments not referenced by an alert, and old risk-history points. Never deletes an alert, an investigation entry or a false-positive report.',
    bucketOf: (now) => String(Math.floor(now.getTime() / MS_PER_DAY)),
    run: async (db, now) => {
      const report = await applyRetention(db, { ...(now ? { now } : {}) });
      const pruned = report.eventsPruned + report.supersededAssessmentsPruned + report.riskHistoryPruned;
      return {
        counters: { ...EMPTY_COUNTERS, recordsPruned: pruned },
        notes: [
          `pruned ${report.eventsPruned} event(s) older than ${report.horizons.eventDays} day(s)`,
          `pruned ${report.supersededAssessmentsPruned} superseded assessment(s) older than ${report.horizons.supersededAssessmentDays} day(s)`,
          `pruned ${report.riskHistoryPruned} risk-history point(s) older than ${report.horizons.historyDays} day(s)`,
        ],
      };
    },
  },
  {
    name: FS_JOB_RULE_SYNC,
    description:
      'Inserts reviewed catalogue rules the database does not have yet. Existing rules are left exactly as an operator tuned them, so a redeploy can never silently reset a weight.',
    bucketOf: (now) => String(Math.floor(now.getTime() / MS_PER_HOUR)),
    run: async (db) => {
      const inserted = await syncCatalogue(db, RULE_CATALOGUE);
      return {
        counters: { ...EMPTY_COUNTERS },
        notes:
          inserted.length > 0
            ? [`inserted ${inserted.length} rule(s) from the code catalogue: ${inserted.join(', ')}`]
            : ['catalogue already in sync — no rule was inserted or modified'],
      };
    },
  },
];

export function findJob(name: string): FsJobDefinition | undefined {
  return FS_JOBS.find((job) => job.name === name);
}

export function jobNames(): string[] {
  return FS_JOBS.map((job) => job.name);
}
