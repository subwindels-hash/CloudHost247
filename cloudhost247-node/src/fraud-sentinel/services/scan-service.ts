/**
 * The scan cycle — the only place that turns recorded activity into assessments and alerts.
 *
 * One pass does four things, in this order:
 *   1. INGEST — project newly recorded rows from the platform's own tables into
 *      `fraud_sentinel_events` (idempotent: a row already projected is excluded by the source query
 *      AND refused by the unique dedupe key).
 *   2. ENUMERATE — list the subjects that actually have events in the window. The scan never invents
 *      a subject: an idle customer is not assessed at all.
 *   3. ASSESS — build each subject's signal bundle and run the deterministic engine.
 *   4. PERSIST — write the assessment, its risk-history point and (when the result is alertable) the
 *      alert, all in one transaction, so a half-written finding is never observable.
 *
 * Two policies here are deliberate and are the difference between a usable ledger and an unusable one:
 *
 *   * AN ASSESSMENT IS ONLY STORED WHEN IT SAYS SOMETHING NEW. A pass re-stores a subject's
 *     assessment when the score or level moved, when MORE events were examined than last time (new
 *     evidence arrived), or when the result is alertable and no alert is open for it yet. Otherwise
 *     nothing is written: a 15-minute cadence over an unchanged subject would otherwise add a
 *     near-identical row every pass and bury the real history — and would bump an alert's
 *     recurrence_count for a finding nobody re-detected. The first assessment for a subject is always
 *     stored, so a zero score still has a recorded baseline carrying the flags that say what a zero
 *     actually means.
 *
 *   * AN OPEN ALERT IS NEVER AUTO-CLOSED. When the score falls below the alert threshold, the alert's
 *     score and level are refreshed and the change is written to its investigation timeline, but its
 *     status stays where a human put it. A detector deciding that its own earlier finding is now
 *     resolved would be an enforcement decision, and this module makes none.
 *
 * No function in this file writes to payments, invoices, orders, billing_ledger, customer_services or
 * users. It reads them (through the repositories) and writes only fraud_sentinel_* tables plus
 * notifications. tests/integration/fraud-sentinel-detection.test.ts asserts that.
 */
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import { MS_PER_DAY } from '../rules/signals';
import { assessSubject } from '../rules/engine';
import {
  ingestNewEvents,
  listActiveIpSubjects,
  listActiveSubjects,
  pruneEvents,
  type IngestionOutcome,
  type SubjectKey,
} from '../repositories/events-repo';
import { buildSignalBundle } from '../repositories/signals-repo';
import { listRules, toEngineConfigs } from '../repositories/rules-repo';
import {
  findLatestActiveAssessment,
  insertAssessment,
  pruneRiskHistory,
  pruneSupersededAssessments,
} from '../repositories/assessments-repo';
import { alertDedupeKey, findOpenAlertByDedupeKey, upsertAlertForAssessment } from '../repositories/alerts-repo';
import { insertInvestigationEntry } from '../repositories/investigations-repo';
import { loadFsSettings, levelAtLeast, type FsSettings } from '../utils/settings';
import { notifyReviewersOfAlert } from '../notifications/reviewer-alerts';
import { EMPTY_COUNTERS } from '../repositories/runs-repo';
import type { AssessmentResult, RunCounters } from '../types';

export interface ScanOptions {
  /** Evaluation instant. Always injectable so a scan is reproducible in tests. */
  now?: Date;
  /** The administrator who pressed "Run scan now"; null for a scheduled pass. */
  triggeredBy?: string | null;
  /** Cap on subjects assessed in this pass (defaults to fraud_sentinel.scan_batch_size). */
  maxSubjects?: number;
  /** Send reviewer notifications for newly raised alerts (default true). */
  notify?: boolean;
}

export interface SubjectFailure {
  subjectType: SubjectKey['subjectType'];
  subjectId: string;
  error: string;
}

export interface ScanReport {
  enabled: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  settings: {
    lookbackDays: number;
    alertMinLevel: FsSettings['alertMinLevel'];
    alertOnCriticalRule: boolean;
    scanBatchSize: number;
    eventBatchLimit: number;
    ingestBatchLimit: number;
  };
  window: { startedAt: string; endedAt: string };
  ingestion: IngestionOutcome;
  subjectsConsidered: number;
  assessmentsCreated: number;
  assessmentsUnchanged: number;
  alertsCreated: number;
  alertsUpdated: number;
  notificationsSent: number;
  failures: SubjectFailure[];
  counters: RunCounters;
}

/** One extra day beyond the lookback, so a row recorded just outside the window is still projected. */
const INGESTION_OVERLAP_DAYS = 1;

/**
 * How much recorded activity an IP address needs before it is worth assessing as a subject of its
 * own. No source row is projected as `subject_type = 'ip'`, because an IP address is something many
 * tables RECORD (auth_audit_log, audit_logs, tool_abuse_events, admin support sessions) rather than a
 * row type of its own — so IP subjects are derived here instead. The two rules that take an IP as
 * their subject (ACC_IP_FAILURE_SPRAY, ACC_SHARED_REGISTRATION_CLUSTER) are reachable only through
 * this enumeration. The floor keeps one stray login from costing a whole assessment, and keeps the
 * per-pass subject count bounded on a platform with normal traffic.
 */
const IP_SUBJECT_MIN_EVENTS = 5;

/**
 * Whether this result is worth an alert.
 *
 * Either the score reached the configured minimum level, or a single rule of `critical` severity fired
 * and `alert_on_critical_rule` is on — the second path exists because one very strong signal (many
 * declines then an approval, an MFA removal, a permission-change burst) deserves a reviewer even when
 * the capped total is still below the level threshold.
 */
export function isAlertable(result: AssessmentResult, settings: FsSettings): boolean {
  if (levelAtLeast(result.riskLevel, settings.alertMinLevel)) return true;
  if (!settings.alertOnCriticalRule) return false;
  return result.triggeredRules.some((rule) => rule.severity === 'critical' && rule.cappedWeight > 0);
}

/** Runs one full scan pass. Safe to call concurrently: alerts dedupe in the database, events dedupe too. */
export async function runFraudScan(db: Queryable, options: ScanOptions = {}): Promise<ScanReport> {
  const started = Date.now();
  const now = options.now ?? new Date();
  const settings = await loadFsSettings(db);

  const baseReport = (): ScanReport => ({
    enabled: settings.enabled,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    settings: {
      lookbackDays: settings.lookbackDays,
      alertMinLevel: settings.alertMinLevel,
      alertOnCriticalRule: settings.alertOnCriticalRule,
      scanBatchSize: settings.scanBatchSize,
      eventBatchLimit: settings.eventBatchLimit,
      ingestBatchLimit: settings.ingestBatchLimit,
    },
    window: {
      startedAt: new Date(now.getTime() - settings.lookbackDays * MS_PER_DAY).toISOString(),
      endedAt: now.toISOString(),
    },
    ingestion: { ingested: 0, scanned: 0, perTable: [], skippedSources: [] },
    subjectsConsidered: 0,
    assessmentsCreated: 0,
    assessmentsUnchanged: 0,
    alertsCreated: 0,
    alertsUpdated: 0,
    notificationsSent: 0,
    failures: [],
    counters: { ...EMPTY_COUNTERS },
  });

  if (!settings.enabled) {
    // A disabled module does nothing at all: no ingestion, no assessment, no alert. The run row still
    // records that the pass happened and was skipped, so "nothing happened" is distinguishable from
    // "the scheduler never ran".
    return baseReport();
  }

  const report = baseReport();
  const windowStart = new Date(now.getTime() - settings.lookbackDays * MS_PER_DAY);

  report.ingestion = await ingestNewEvents(db, {
    since: new Date(now.getTime() - (settings.lookbackDays + INGESTION_OVERLAP_DAYS) * MS_PER_DAY),
    limitPerTable: settings.ingestBatchLimit,
  });

  const maxSubjects = Math.max(1, Math.floor(options.maxSubjects ?? settings.scanBatchSize));
  const subjects = await listActiveSubjects(db, {
    since: windowStart,
    until: now,
    limit: maxSubjects,
  });
  if (subjects.length < maxSubjects) {
    const seen = new Set(subjects.map((subject) => `${subject.subjectType}:${subject.subjectId}`));
    const ipSubjects = await listActiveIpSubjects(db, {
      since: windowStart,
      until: now,
      limit: maxSubjects - subjects.length,
      minEvents: IP_SUBJECT_MIN_EVENTS,
    });
    for (const subject of ipSubjects) {
      const key = `${subject.subjectType}:${subject.subjectId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      subjects.push(subject);
    }
  }
  report.subjectsConsidered = subjects.length;

  // One read of the rule set per pass: every subject is scored against the SAME configuration, which
  // is what makes rule_set_version mean something across a batch.
  const ruleRows = await listRules(db, { enabledOnly: true });
  const rules = toEngineConfigs(ruleRows);

  const pendingNotifications: Array<{ alertId: string; alertNumber: string; title: string; explanation: string; riskLevel: string; created: boolean }> = [];

  for (const subject of subjects) {
    try {
      const bundle = await buildSignalBundle(db, subject, {
        evaluatedAt: now,
        lookbackDays: settings.lookbackDays,
        eventBatchLimit: settings.eventBatchLimit,
      });
      const previous = await findLatestActiveAssessment(db, {
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        customerId: bundle.customerId,
      });
      const result = assessSubject({
        bundle,
        rules,
        thresholds: settings.riskThresholds,
        familyCaps: settings.familyCaps,
        previous: {
          score: previous?.risk_score ?? null,
          level: previous?.risk_level ?? null,
          assessmentId: previous?.id ?? null,
        },
        nowMs: now.getTime(),
        lookbackDays: settings.lookbackDays,
      });

      const alertable = isAlertable(result, settings);
      const changed =
        !previous || previous.risk_score !== result.riskScore || previous.risk_level !== result.riskLevel;
      // More events examined than the last assessment saw means new evidence arrived, even when the
      // capped score did not move — that is a genuine re-detection and worth recording.
      const newEvidence = !previous || result.eventsExamined > previous.events_examined;
      const openAlert = previous ? await findOpenAlertByDedupeKey(db, alertDedupeKey(result)) : null;

      if (!changed && !newEvidence && (!alertable || openAlert)) {
        // Nothing new to record: the stored assessment and its open alert already say exactly this.
        report.assessmentsUnchanged += 1;
        continue;
      }

      const persisted = await withTransaction(db, async (tx) => {
        const { assessment } = await insertAssessment(tx, result, { assessedAt: now });

        // An existing OPEN alert is refreshed whether or not this pass would raise a new one, so its
        // displayed score is never stale. Its status is left alone — see the header.
        const dedupeKey = alertDedupeKey(result);
        const openAlert = await findOpenAlertByDedupeKey(tx, dedupeKey);

        if (!alertable && !openAlert) {
          return { alert: null, created: false, previousScore: previous?.risk_score ?? null };
        }

        const outcome = await upsertAlertForAssessment(tx, {
          assessmentId: assessment.id,
          result,
          accountEmail: bundle.facts.account?.email ?? null,
          detectedAt: now,
        });

        await insertInvestigationEntry(tx, {
          alertId: outcome.alert.id,
          assessmentId: assessment.id,
          actorId: options.triggeredBy ?? null,
          actorType: options.triggeredBy ? 'staff' : 'system',
          action: outcome.created ? 'created' : changed ? 'risk_changed' : 're_detected',
          toStatus: outcome.alert.status,
          note: outcome.created
            ? `Raised by the detection scan: ${result.riskLevel} risk (${result.riskScore}/100), ${result.triggeredRules.length} rule(s) triggered.`
            : `Re-assessed by the detection scan: ${result.riskLevel} risk (${result.riskScore}/100)` +
              (outcome.previousScore !== null && outcome.previousScore !== result.riskScore
                ? `, previously ${outcome.previousScore}/100.`
                : '.'),
          metadata: {
            runTriggeredBy: options.triggeredBy ?? null,
            ruleSetVersion: result.ruleSetVersion,
            scoringVersion: result.scoringVersion,
            eventsExamined: result.eventsExamined,
            confidence: result.confidence,
            previousScore: outcome.previousScore,
            previousLevel: outcome.previousLevel,
            triggeredRuleCodes: result.triggeredRules.map((rule) => rule.code),
          },
        });

        return {
          alert: outcome.alert,
          created: outcome.created,
          previousScore: outcome.previousScore,
        };
      });

      report.assessmentsCreated += 1;
      if (persisted.alert) {
        if (persisted.created) report.alertsCreated += 1;
        else report.alertsUpdated += 1;
        // Only a NEW alert notifies. Re-detection of an alert a reviewer is already working would
        // otherwise page them every pass; its recurrence_count and timeline carry that information.
        if (persisted.created && options.notify !== false) {
          pendingNotifications.push({
            alertId: persisted.alert.id,
            alertNumber: persisted.alert.alert_number,
            title: persisted.alert.title,
            explanation: persisted.alert.explanation,
            riskLevel: persisted.alert.risk_level,
            created: true,
          });
        }
      }
    } catch (error) {
      // One subject's failure must not abort the pass: the remaining subjects still need assessing,
      // and a swallowed error would be worse, so it is reported and counted.
      report.failures.push({
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  if (pendingNotifications.length > 0) {
    // After the assessments commit: a notification failure must not roll back a finding, and a
    // finding must not be reported as notified before it exists.
    for (const pending of pendingNotifications) {
      try {
        report.notificationsSent += await notifyReviewersOfAlert(db, pending, settings);
      } catch (error) {
        report.failures.push({
          subjectType: 'customer',
          subjectId: pending.alertId,
          error: `notification failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - started;
  report.counters = {
    ...EMPTY_COUNTERS,
    subjectsScanned: report.subjectsConsidered,
    eventsIngested: report.ingestion.ingested,
    assessmentsCreated: report.assessmentsCreated,
    alertsCreated: report.alertsCreated,
    alertsUpdated: report.alertsUpdated,
    notificationsSent: report.notificationsSent,
    failedCount: report.failures.length,
  };
  return report;
}

/**
 * Assesses ONE subject on demand — the "assess this customer now" action behind an investigation
 * screen, and the entry point the API test uses to avoid depending on a whole scan pass.
 */
export async function assessSubjectNow(
  db: Queryable,
  subject: SubjectKey,
  options: { now?: Date; triggeredBy?: string | null; notify?: boolean } = {}
): Promise<{ result: AssessmentResult; assessmentId: string | null; alertId: string | null }> {
  const now = options.now ?? new Date();
  const settings = await loadFsSettings(db);
  const bundle = await buildSignalBundle(db, subject, {
    evaluatedAt: now,
    lookbackDays: settings.lookbackDays,
    eventBatchLimit: settings.eventBatchLimit,
  });
  const previous = await findLatestActiveAssessment(db, {
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    customerId: bundle.customerId,
  });
  const rules = toEngineConfigs(await listRules(db, { enabledOnly: true }));
  const result = assessSubject({
    bundle,
    rules,
    thresholds: settings.riskThresholds,
    familyCaps: settings.familyCaps,
    previous: {
      score: previous?.risk_score ?? null,
      level: previous?.risk_level ?? null,
      assessmentId: previous?.id ?? null,
    },
    nowMs: now.getTime(),
    lookbackDays: settings.lookbackDays,
  });

  const persisted = await withTransaction(db, async (tx) => {
    const { assessment } = await insertAssessment(tx, result, { assessedAt: now });
    const alertable = isAlertable(result, settings);
    const openAlert = await findOpenAlertByDedupeKey(tx, alertDedupeKey(result));
    if (!alertable && !openAlert) return { assessmentId: assessment.id, alertId: null };
    const outcome = await upsertAlertForAssessment(tx, {
      assessmentId: assessment.id,
      result,
      accountEmail: bundle.facts.account?.email ?? null,
      detectedAt: now,
    });
    await insertInvestigationEntry(tx, {
      alertId: outcome.alert.id,
      assessmentId: assessment.id,
      actorId: options.triggeredBy ?? null,
      actorType: options.triggeredBy ? 'staff' : 'system',
      action: outcome.created ? 'created' : 're_detected',
      toStatus: outcome.alert.status,
      note: `On-demand assessment: ${result.riskLevel} risk (${result.riskScore}/100).`,
      metadata: { ruleSetVersion: result.ruleSetVersion, triggeredRuleCodes: result.triggeredRules.map((rule) => rule.code) },
    });
    return { assessmentId: assessment.id, alertId: outcome.alert.id };
  });

  return { result, assessmentId: persisted.assessmentId, alertId: persisted.alertId };
}

/* -------------------------------------------------------------------------- */
/* Retention                                                                   */
/* -------------------------------------------------------------------------- */

export interface RetentionReport {
  eventsPruned: number;
  supersededAssessmentsPruned: number;
  riskHistoryPruned: number;
  horizons: { eventDays: number; supersededAssessmentDays: number; historyDays: number };
}

/**
 * Applies the configured retention horizons.
 *
 * Deletion is bounded and evidence-preserving:
 *   * events older than `retention_event_days` — the projected ledger, not the source rows, which
 *     stay under their own existing retention;
 *   * SUPERSEDED assessments older than `retention_superseded_assessment_days`, excluding any an alert
 *     still references (ON DELETE RESTRICT plus an explicit NOT EXISTS), so no alert ever loses the
 *     evidence it cites;
 *   * risk-history points older than `retention_history_days`.
 *
 * Nothing here deletes an alert, an investigation entry or a false-positive report: those are the
 * audit trail, and the authorization treats their removal as out of scope for automation.
 */
export async function applyRetention(db: Queryable, options: { now?: Date } = {}): Promise<RetentionReport> {
  const now = options.now ?? new Date();
  const settings = await loadFsSettings(db);
  const days = (value: number) => new Date(now.getTime() - Math.max(1, Math.floor(value)) * MS_PER_DAY);

  const eventsPruned = await pruneEvents(db, days(settings.retentionEventDays));
  const supersededAssessmentsPruned = await pruneSupersededAssessments(db, days(settings.retentionSupersededAssessmentDays));
  const riskHistoryPruned = await pruneRiskHistory(db, days(settings.retentionHistoryDays));

  return {
    eventsPruned,
    supersededAssessmentsPruned,
    riskHistoryPruned,
    horizons: {
      eventDays: settings.retentionEventDays,
      supersededAssessmentDays: settings.retentionSupersededAssessmentDays,
      historyDays: settings.retentionHistoryDays,
    },
  };
}
