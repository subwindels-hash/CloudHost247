/**
 * Fraud Sentinel admin API — /api/admin/fraud-sentinel/*
 *
 * Every route authenticates, re-verifies the caller's role against the database (never the JWT claim
 * alone) and asserts an explicit module permission from `permissions.ts`. All input is zod-validated;
 * all SQL is parameterized inside the repositories; all reads carry the caller's `FraudScope`, and a
 * scope that matches nothing returns nothing.
 *
 * Three response rules hold across the whole surface:
 *
 *  1. Every payload that could be mistaken for a verdict carries `advisory: ADVISORY_ONLY`, so a client
 *     cannot render a detection as an enforcement outcome even by accident.
 *  2. "Exists but outside your scope" is a 404, never a 403 — the disclosure contract
 *     `src/email-trace/access-control.ts` established.
 *  3. Evidence is re-checked for secrets on the way OUT as well as on the way in. If a description ever
 *     fails that check it is withheld and the payload says so in `evidenceIntegrity`, rather than being
 *     returned or silently rewritten.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../../config/env';
import { getPool } from '../../db/pool';
import type { Queryable } from '../../db/types';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { recordAudit, requestAuditContext } from '../../lib/audit';
import { MS_PER_DAY } from '../rules/signals';
import { RULE_CATALOGUE } from '../rules/catalogue';
import { allowedTransitions } from '../rules/transitions';
import { requireFsPermission, type FsRequestContext } from '../permissions';
import { findUnredactedSecret } from '../utils/redaction';
import {
  ADVISORY_ONLY,
  ALERT_STATUSES,
  FALSE_POSITIVE_REASONS,
  FRAUD_CATEGORIES,
  RISK_LEVELS,
  SUBJECT_TYPES,
  type AdvisoryOnly,
  type EvidenceRef,
} from '../types';
import { findAssessmentById, listAssessments } from '../repositories/assessments-repo';
import { listRuns, latestRunPerJob } from '../repositories/runs-repo';
import {
  MIN_FALSE_POSITIVE_EXPLANATION,
  MIN_RESOLUTION_NOTE,
  addAlertNote,
  assignAlert,
  dashboardOverview,
  getAlertDetail,
  listAlertsForRequest,
  reportFalsePositive,
  transitionAlert,
  type Actor,
} from '../services/alert-service';
import {
  customerEventLedger,
  customerRiskProfile,
  falsePositiveReports,
  investigationHistory,
  ruleFeedbackReport,
} from '../services/investigation-service';
import {
  getRuleDetail,
  getSettingsForRequest,
  listRuleHistoryForRequest,
  listRulesForRequest,
  ruleDriftReport,
  syncCatalogueForRequest,
  updateRuleForRequest,
  updateSettingsForRequest,
  MAX_RULE_WEIGHT,
  MIN_RULE_WEIGHT,
} from '../services/rule-service';
import { assessSubjectNow, runFraudScan } from '../services/scan-service';
import { FS_JOBS, findJob } from '../jobs/definitions';
import { executeJobManually } from '../jobs/runner';
import type { AlertSortColumn } from '../repositories/alerts-repo';
import { ALERT_SORT_COLUMNS } from '../repositories/alerts-repo';
import type { RuleFamily } from '../rules/catalogue';
import { INVESTIGATION_ACTIONS, type AlertStatus, type InvestigationAction } from '../types';

const BASE = '/api/admin/fraud-sentinel';

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`.trim()).join(', '));
  }
  return parsed.data;
}

const pagination = {
  page: z.coerce.number().int().positive().max(10_000).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
};

const pageOf = (value: number | undefined): number => Math.max(1, Math.floor(value ?? 1));
const limitOf = (value: number | undefined, fallback = 25): number => Math.min(100, Math.max(1, Math.floor(value ?? fallback)));

/**
 * A boolean query parameter.
 *
 * Zod's coerced boolean is deliberately NOT used here: `Boolean('false')` is `true`, so a caller
 * passing `?unassigned=false` would get the opposite of what they asked for. Only the literal strings
 * below are accepted; anything else is a 400.
 */
const booleanQuery = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const idParam = z.object({ id: z.string().uuid() });
const codeParam = z.object({ code: z.string().min(1).max(48) });

/** Accepts an ISO-8601 instant, or nothing. A malformed date is a 400, never a silent default. */
const instant = z.string().datetime({ offset: true }).optional();

function toDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new ValidationError(`Invalid timestamp: ${value}`);
  return parsed;
}

const windowQuery = {
  since: instant,
  until: instant,
  days: z.coerce.number().int().positive().max(365).optional(),
};

function resolveWindow(query: { since?: string; until?: string; days?: number }): { since: Date; until: Date } {
  const until = toDate(query.until, new Date());
  const since = toDate(query.since, new Date(until.getTime() - (query.days ?? 30) * MS_PER_DAY));
  if (since.getTime() > until.getTime()) throw new ValidationError('since must not be later than until');
  return { since, until };
}

/* -------------------------------------------------------------------------- */
/* Evidence integrity                                                          */
/* -------------------------------------------------------------------------- */

export interface EvidenceIntegrity {
  ok: boolean;
  /** JSON paths whose content failed the secret check and were therefore withheld. */
  withheld: string[];
}

/**
 * Re-checks stored evidence for secret-shaped content before it leaves the process.
 *
 * Evidence is redacted on the way in, so this should always pass. It exists because "should" is not a
 * guarantee across 40 detectors and a growing source list: if a rule ever copies a raw gateway message
 * containing a card number into a description, the API withholds that ONE description and says so in
 * the payload, rather than either leaking it or failing the whole request.
 */
export function safeEvidence(refs: readonly EvidenceRef[]): { evidence: EvidenceRef[]; integrity: EvidenceIntegrity } {
  const withheld: string[] = [];
  const evidence = refs.map((ref, index) => {
    const finding = findUnredactedSecret({ description: ref.description, table: ref.table }, `$[${index}]`);
    if (!finding) return ref;
    withheld.push(`${finding}`);
    return {
      ...ref,
      description: '[evidence withheld: this description failed the secret-redaction check and was not returned]',
    };
  });
  return { evidence, integrity: { ok: withheld.length === 0, withheld } };
}

/** Applies the evidence check to a whole alert detail payload. */
function withEvidenceIntegrity<T extends { assessment: { evidence: EvidenceRef[]; triggered_rules: Array<{ evidence: EvidenceRef[] }> } | null }>(
  detail: T
): T & { evidenceIntegrity: EvidenceIntegrity; advisory: AdvisoryOnly } {
  if (!detail.assessment) return { ...detail, evidenceIntegrity: { ok: true, withheld: [] }, advisory: ADVISORY_ONLY };
  const own = safeEvidence(detail.assessment.evidence);
  const perRule = detail.assessment.triggered_rules.map((rule) => safeEvidence(rule.evidence));
  const withheld = [...own.integrity.withheld, ...perRule.flatMap((entry) => entry.integrity.withheld)];
  return {
    ...detail,
    assessment: {
      ...detail.assessment,
      evidence: own.evidence,
      triggered_rules: detail.assessment.triggered_rules.map((rule, index) => ({
        ...rule,
        evidence: (perRule[index] ?? own).evidence,
      })),
    },
    evidenceIntegrity: { ok: withheld.length === 0, withheld },
    advisory: ADVISORY_ONLY,
  };
}

/* -------------------------------------------------------------------------- */
/* Schemas                                                                     */
/* -------------------------------------------------------------------------- */

const listAlertsQuery = z.object({
  ...pagination,
  ...windowQuery,
  status: z.enum([...ALERT_STATUSES, 'open'] as [string, ...string[]]).optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  category: z.enum(FRAUD_CATEGORIES).optional(),
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectLabel: z.string().max(64).optional(),
  customerId: z.string().uuid().optional(),
  reviewerId: z.string().uuid().optional(),
  unassigned: booleanQuery.optional(),
  ruleCode: z.string().max(48).optional(),
  search: z.string().max(120).optional(),
  sortBy: z.enum(ALERT_SORT_COLUMNS as unknown as [string, ...string[]]).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

const transitionBody = z.object({
  toStatus: z.enum(ALERT_STATUSES),
  note: z.string().max(4000).optional().nullable(),
});

const assignBody = z.object({
  reviewerId: z.string().uuid().nullable(),
  note: z.string().max(4000).optional().nullable(),
});

const falsePositiveBody = z.object({
  reasonCategory: z.enum(FALSE_POSITIVE_REASONS),
  explanation: z.string().min(MIN_FALSE_POSITIVE_EXPLANATION).max(4000),
  ruleCodes: z.array(z.string().max(48)).max(40).optional(),
});

const noteBody = z.object({
  note: z.string().min(3).max(4000),
  kind: z.enum(['note_added', 'evidence_reviewed']).optional(),
});

const rulePatchBody = z.object({
  weight: z.number().int().min(MIN_RULE_WEIGHT).max(MAX_RULE_WEIGHT).optional(),
  enabled: z.boolean().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  family: z.string().max(48).optional(),
  appliesTo: z.array(z.enum(SUBJECT_TYPES)).min(1).optional(),
  parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).optional(),
  name: z.string().min(4).max(255).optional(),
  description: z.string().min(4).max(4000).optional(),
  recommendation: z.string().min(4).max(4000).optional(),
  reason: z.string().max(2000).optional().nullable(),
});

const settingsPatchBody = z
  .object({
    enabled: z.boolean().optional(),
    lookbackDays: z.number().int().min(1).max(365).optional(),
    riskThresholds: z
      .object({ medium: z.number().int().min(1).max(100), high: z.number().int().min(1).max(100), critical: z.number().int().min(1).max(100) })
      .optional(),
    familyCaps: z.record(z.string(), z.number().int().min(0).max(100)).optional(),
    alertMinLevel: z.enum(RISK_LEVELS).optional(),
    alertOnCriticalRule: z.boolean().optional(),
    notifyReviewerRoles: z.array(z.enum(['admin', 'super_admin', 'staff'])).max(5).optional(),
    scanBatchSize: z.number().int().min(1).max(10_000).optional(),
    eventBatchLimit: z.number().int().min(1).max(100_000).optional(),
    ingestBatchLimit: z.number().int().min(1).max(100_000).optional(),
    schedulerIntervalMinutes: z.number().int().min(5).max(1440).optional(),
    retentionEventDays: z.number().int().min(1).max(3650).optional(),
    retentionHistoryDays: z.number().int().min(1).max(3650).optional(),
    retentionSupersededAssessmentDays: z.number().int().min(1).max(3650).optional(),
    aiAssistEnabled: z.boolean().optional(),
    aiEngine: z.string().max(48).optional(),
    reason: z.string().max(2000).optional().nullable(),
  })
  .strict();

const listAssessmentsQuery = z.object({
  ...pagination,
  ...windowQuery,
  customerId: z.string().uuid().optional(),
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  status: z.enum(['active', 'superseded']).optional(),
  ruleCode: z.string().max(48).optional(),
});

const investigationsQuery = z.object({
  ...pagination,
  ...windowQuery,
  alertId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.enum(INVESTIGATION_ACTIONS).optional(),
  customerId: z.string().uuid().optional(),
});

const falsePositivesQuery = z.object({
  ...pagination,
  ...windowQuery,
  reasonCategory: z.enum(FALSE_POSITIVE_REASONS).optional(),
  ruleCode: z.string().max(48).optional(),
  reportedBy: z.string().uuid().optional(),
});

const runsQuery = z.object({
  ...pagination,
  ...windowQuery,
  jobName: z.string().max(64).optional(),
  status: z.enum(['running', 'completed', 'failed']).optional(),
  trigger: z.enum(['schedule', 'manual']).optional(),
});

const eventsQuery = z.object({
  ...pagination,
  category: z.enum(FRAUD_CATEGORIES).optional(),
});

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

export async function registerFraudSentinelRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable): Promise<void> {
  const pool = overridePool ?? getPool(env);

  const actorFor = (ctx: FsRequestContext, request: Parameters<typeof requestAuditContext>[0]): Actor => ({
    userId: ctx.userId,
    actorType: 'staff',
    audit: requestAuditContext(request),
  });

  /* ------------------------------------------------------------- overview --- */

  app.get(`${BASE}/overview`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const query = parseOrThrow(z.object(windowQuery), request.query);
    const window = resolveWindow(query);
    const overview = await dashboardOverview(pool, { scope: ctx.scope, since: window.since, until: window.until });
    return { ...overview, permissions: ctx.permissions };
  });

  /** The permission vocabulary and the state machine, so the UI never hardcodes either. */
  app.get(`${BASE}/meta`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    return {
      permissions: ctx.permissions,
      statuses: ALERT_STATUSES,
      levels: RISK_LEVELS,
      categories: FRAUD_CATEGORIES,
      subjectTypes: SUBJECT_TYPES,
      falsePositiveReasons: FALSE_POSITIVE_REASONS,
      // Published for the same reason as the rest: the investigation ledger is filterable by action,
      // and a client that hardcodes the 12 values would silently lose any action added here.
      investigationActions: INVESTIGATION_ACTIONS,
      transitions: Object.fromEntries(ALERT_STATUSES.map((status) => [status, allowedTransitions(status)])),
      sortColumns: ALERT_SORT_COLUMNS,
      jobs: FS_JOBS.map((job) => ({ name: job.name, description: job.description })),
      minResolutionNote: MIN_RESOLUTION_NOTE,
      minFalsePositiveExplanation: MIN_FALSE_POSITIVE_EXPLANATION,
      advisory: ADVISORY_ONLY,
    };
  });

  /* --------------------------------------------------------------- alerts --- */

  app.get(`${BASE}/alerts`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const query = parseOrThrow(listAlertsQuery, request.query);
    const window = resolveWindow(query);
    const page = await listAlertsForRequest(pool, {
      page: pageOf(query.page),
      limit: limitOf(query.limit),
      ...(query.status ? { status: query.status as AlertStatus | 'open' } : {}),
      ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.subjectType ? { subjectType: query.subjectType } : {}),
      ...(query.subjectLabel ? { subjectLabel: query.subjectLabel } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.reviewerId ? { reviewerId: query.reviewerId } : {}),
      ...(query.unassigned === undefined ? {} : { unassigned: query.unassigned }),
      ...(query.ruleCode ? { ruleCode: query.ruleCode } : {}),
      ...(query.search ? { search: query.search } : {}),
      since: query.since || query.until || query.days ? window.since : null,
      until: query.since || query.until || query.days ? window.until : null,
      ...(query.sortBy ? { sortBy: query.sortBy as AlertSortColumn } : {}),
      ...(query.sortDir ? { sortDir: query.sortDir } : {}),
      scope: ctx.scope,
    });
    return { ...page, advisory: ADVISORY_ONLY };
  });

  app.get(`${BASE}/alerts/:id`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const { id } = parseOrThrow(idParam, request.params);
    const detail = await getAlertDetail(pool, id, ctx.scope);
    if (!detail) throw new NotFoundError('Alert not found');
    return withEvidenceIntegrity(detail);
  });

  app.post(`${BASE}/alerts/:id/transition`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.investigate');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(transitionBody, request.body);
    const detail = await transitionAlert(
      pool,
      { alertId: id, toStatus: body.toStatus, note: body.note ?? null, scope: ctx.scope },
      actorFor(ctx, request)
    );
    return withEvidenceIntegrity(detail);
  });

  app.post(`${BASE}/alerts/:id/assign`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.assign');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(assignBody, request.body);
    const detail = await assignAlert(
      pool,
      { alertId: id, reviewerId: body.reviewerId, note: body.note ?? null, scope: ctx.scope },
      actorFor(ctx, request)
    );
    return withEvidenceIntegrity(detail);
  });

  app.post(`${BASE}/alerts/:id/false-positive`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.investigate');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(falsePositiveBody, request.body);
    const detail = await reportFalsePositive(
      pool,
      {
        alertId: id,
        reasonCategory: body.reasonCategory,
        explanation: body.explanation,
        ...(body.ruleCodes ? { ruleCodes: body.ruleCodes } : {}),
        scope: ctx.scope,
      },
      actorFor(ctx, request)
    );
    return withEvidenceIntegrity(detail);
  });

  app.post(`${BASE}/alerts/:id/notes`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.investigate');
    const { id } = parseOrThrow(idParam, request.params);
    const body = parseOrThrow(noteBody, request.body);
    const detail = await addAlertNote(
      pool,
      { alertId: id, note: body.note, scope: ctx.scope, ...(body.kind ? { action: body.kind } : {}) },
      actorFor(ctx, request)
    );
    return withEvidenceIntegrity(detail);
  });

  /** CSV export of the current alert filter — the same rows the screen shows, nothing more. */
  app.get(`${BASE}/alerts/export.csv`, async (request, reply) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.export');
    const query = parseOrThrow(listAlertsQuery, request.query);
    const window = resolveWindow(query);
    // The window is applied ONLY when the caller asked for one, exactly as `GET /alerts` does. Defaulting
    // the export to the last 30 days would silently drop the older rows the screen is showing, and an
    // export that disagrees with the list it claims to export is worse than no export at all.
    const windowApplied = Boolean(query.since || query.until || query.days);
    const page = await listAlertsForRequest(pool, {
      page: 1,
      limit: 100,
      ...(query.status ? { status: query.status as AlertStatus | 'open' } : {}),
      ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.ruleCode ? { ruleCode: query.ruleCode } : {}),
      ...(query.search ? { search: query.search } : {}),
      since: windowApplied ? window.since : null,
      until: windowApplied ? window.until : null,
      scope: ctx.scope,
    });

    await recordAudit(
      pool,
      {
        actorId: ctx.userId,
        action: 'fraud_sentinel.alerts_exported',
        resourceType: 'fraud_sentinel_alert',
        metadata: {
          rows: page.items.length,
          total: page.total,
          filters: { ...query },
          // null records that no window was applied, rather than implying one that was not.
          window: windowApplied ? { since: window.since.toISOString(), until: window.until.toISOString() } : null,
        },
      },
      requestAuditContext(request)
    );

    const csv = toCsv(page.items.map((alert) => ({
      alert_number: alert.alert_number,
      detected_at: alert.detected_at,
      status: alert.status,
      risk_level: alert.risk_level,
      risk_score: String(alert.risk_score),
      category: alert.category,
      primary_rule_code: alert.primary_rule_code ?? '',
      subject_type: alert.subject_type,
      customer_id: alert.customer_id ?? '',
      customer_email: alert.customer_email ?? '',
      assigned_reviewer: alert.reviewer_name ?? '',
      recurrence_count: String(alert.recurrence_count),
      title: alert.title,
      advisory_only: 'true',
    })));
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="fraud-sentinel-alerts.csv"').send(csv);
  });

  /* ---------------------------------------------------------- assessments --- */

  app.get(`${BASE}/assessments`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const query = parseOrThrow(listAssessmentsQuery, request.query);
    const window = resolveWindow(query);
    const page = await listAssessments(pool, {
      page: pageOf(query.page),
      limit: limitOf(query.limit),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.subjectType ? { subjectType: query.subjectType } : {}),
      ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
      ...(query.minScore === undefined ? {} : { minScore: query.minScore }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.ruleCode ? { ruleCode: query.ruleCode } : {}),
      since: query.since || query.until || query.days ? window.since : null,
      until: query.since || query.until || query.days ? window.until : null,
      scope: ctx.scope,
    });
    return { ...page, advisory: ADVISORY_ONLY };
  });

  app.get(`${BASE}/assessments/:id`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const { id } = parseOrThrow(idParam, request.params);
    const assessment = await findAssessmentById(pool, id, ctx.scope);
    if (!assessment) throw new NotFoundError('Assessment not found');
    const { evidence, integrity } = safeEvidence(assessment.evidence);
    const triggeredRules = assessment.triggered_rules.map((rule) => {
      const perRule = safeEvidence(rule.evidence);
      return { ...rule, evidence: perRule.evidence };
    });
    return {
      assessment: { ...assessment, evidence, triggered_rules: triggeredRules },
      evidenceIntegrity: integrity,
      advisory: ADVISORY_ONLY,
    };
  });

  /* -------------------------------------------------------------- customers --- */

  app.get(`${BASE}/customers/:id/risk-profile`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const { id } = parseOrThrow(idParam, request.params);
    const profile = await customerRiskProfile(pool, id, ctx.scope);
    return profile;
  });

  app.get(`${BASE}/customers/:id/events`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const { id } = parseOrThrow(idParam, request.params);
    const query = parseOrThrow(eventsQuery, request.query);
    const page = await customerEventLedger(pool, id, ctx.scope, {
      page: pageOf(query.page),
      limit: limitOf(query.limit, 50),
      ...(query.category ? { category: query.category } : {}),
    });
    // The ledger's evidence payloads were redacted at ingestion; re-check them before returning.
    const items = page.items.map((event) => {
      const finding = findUnredactedSecret(event.evidence, `event ${event.id}`);
      return finding ? { ...event, evidence: { withheld: true, reason: finding } } : event;
    });
    return { ...page, items };
  });

  /** Re-assesses one customer on demand. Writes an assessment; takes no action on the customer. */
  app.post(`${BASE}/customers/:id/assess`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.run_scan');
    const { id } = parseOrThrow(idParam, request.params);
    const outcome = await assessSubjectNow(pool, { subjectType: 'customer', subjectId: id }, { triggeredBy: ctx.userId, notify: false });
    await recordAudit(
      pool,
      {
        actorId: ctx.userId,
        action: 'fraud_sentinel.customer_assessed',
        resourceType: 'fraud_sentinel_assessment',
        resourceId: outcome.assessmentId,
        metadata: {
          customerId: id,
          riskScore: outcome.result.riskScore,
          riskLevel: outcome.result.riskLevel,
          ruleSetVersion: outcome.result.ruleSetVersion,
          triggeredRules: outcome.result.triggeredRules.map((rule) => rule.code),
        },
      },
      requestAuditContext(request)
    );
    const { evidence, integrity } = safeEvidence(outcome.result.evidence);
    return {
      assessmentId: outcome.assessmentId,
      alertId: outcome.alertId,
      result: { ...outcome.result, evidence },
      evidenceIntegrity: integrity,
      advisory: ADVISORY_ONLY,
    };
  });

  /* ------------------------------------------------- investigations & feedback --- */

  app.get(`${BASE}/investigations`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const query = parseOrThrow(investigationsQuery, request.query);
    const window = resolveWindow(query);
    const page = await investigationHistory(pool, {
      page: pageOf(query.page),
      limit: limitOf(query.limit, 50),
      ...(query.alertId ? { alertId: query.alertId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action as InvestigationAction } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      since: query.since || query.until || query.days ? window.since : null,
      until: query.since || query.until || query.days ? window.until : null,
      scope: ctx.scope,
    });
    return page;
  });

  app.get(`${BASE}/false-positives`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const query = parseOrThrow(falsePositivesQuery, request.query);
    const window = resolveWindow(query);
    const page = await falsePositiveReports(pool, {
      page: pageOf(query.page),
      limit: limitOf(query.limit, 50),
      ...(query.reasonCategory ? { reasonCategory: query.reasonCategory } : {}),
      ...(query.ruleCode ? { ruleCode: query.ruleCode } : {}),
      ...(query.reportedBy ? { reportedBy: query.reportedBy } : {}),
      since: window.since,
      until: window.until,
      scope: ctx.scope,
    });
    return page;
  });

  app.get(`${BASE}/rule-feedback`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const query = parseOrThrow(z.object(windowQuery), request.query);
    const window = resolveWindow(query);
    return ruleFeedbackReport(pool, { since: window.since, until: window.until, scope: ctx.scope });
  });

  /* ---------------------------------------------------------------- rules --- */

  app.get(`${BASE}/rules`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const query = parseOrThrow(
      z.object({
        category: z.enum(FRAUD_CATEGORIES).optional(),
        family: z.string().max(48).optional(),
        enabledOnly: booleanQuery.optional(),
        search: z.string().max(120).optional(),
      }),
      request.query
    );
    const items = await listRulesForRequest(pool, {
      ...(query.category ? { category: query.category } : {}),
      ...(query.family ? { family: query.family as RuleFamily } : {}),
      ...(query.enabledOnly === undefined ? {} : { enabledOnly: query.enabledOnly }),
      ...(query.search ? { search: query.search } : {}),
    });
    const drift = await ruleDriftReport(pool);
    return { items, total: items.length, drift, canEdit: ctx.permissions.includes('fraud_sentinel.rules') };
  });

  /** The reviewed defaults as shipped in this build — the reference the stored rules may drift from. */
  app.get(`${BASE}/rules/catalogue`, async (request) => {
    await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    return { items: RULE_CATALOGUE, total: RULE_CATALOGUE.length };
  });

  app.get(`${BASE}/rules/:code`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const { code } = parseOrThrow(codeParam, request.params);
    const detail = await getRuleDetail(pool, code);
    if (!detail) throw new NotFoundError('Rule not found');
    return { ...detail, canEdit: ctx.permissions.includes('fraud_sentinel.rules') };
  });

  app.patch(`${BASE}/rules/:code`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.rules');
    const { code } = parseOrThrow(codeParam, request.params);
    const body = parseOrThrow(rulePatchBody, request.body);
    const { reason, ...patch } = body;
    return updateRuleForRequest(
      pool,
      {
        code,
        patch: {
          ...(patch.weight === undefined ? {} : { weight: patch.weight }),
          ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
          ...(patch.severity === undefined ? {} : { severity: patch.severity }),
          ...(patch.family === undefined ? {} : { family: patch.family as RuleFamily }),
          ...(patch.appliesTo === undefined ? {} : { appliesTo: patch.appliesTo }),
          ...(patch.parameters === undefined ? {} : { parameters: patch.parameters }),
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.description === undefined ? {} : { description: patch.description }),
          ...(patch.recommendation === undefined ? {} : { recommendation: patch.recommendation }),
        },
        reason: reason ?? null,
      },
      actorFor(ctx, request)
    );
  });

  app.post(`${BASE}/rules/sync`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.rules');
    return syncCatalogueForRequest(pool, actorFor(ctx, request));
  });

  app.get(`${BASE}/rule-history`, async (request) => {
    await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const query = parseOrThrow(z.object({ ...pagination, code: z.string().max(48).optional() }), request.query);
    return listRuleHistoryForRequest(pool, {
      page: pageOf(query.page),
      limit: limitOf(query.limit, 50),
      ...(query.code ? { code: query.code } : {}),
    });
  });

  /* ------------------------------------------------------------- settings --- */

  app.get(`${BASE}/settings`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const view = await getSettingsForRequest(pool);
    return { ...view, canEdit: ctx.permissions.includes('fraud_sentinel.settings') };
  });

  app.patch(`${BASE}/settings`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.settings');
    const body = parseOrThrow(settingsPatchBody, request.body);
    const { reason, ...patch } = body;
    return updateSettingsForRequest(pool, { patch, reason: reason ?? null }, actorFor(ctx, request));
  });

  /* ------------------------------------------------------------ operations --- */

  /** Runs a full scan pass now. Synchronous: the caller sees exactly what the pass did. */
  app.post(`${BASE}/scan`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.run_scan');
    const query = parseOrThrow(z.object({ maxSubjects: z.coerce.number().int().positive().max(5000).optional() }), request.query ?? {});
    const report = await runFraudScan(pool, {
      triggeredBy: ctx.userId,
      ...(query.maxSubjects ? { maxSubjects: query.maxSubjects } : {}),
    });
    await recordAudit(
      pool,
      {
        actorId: ctx.userId,
        action: 'fraud_sentinel.scan_run',
        resourceType: 'fraud_sentinel_run',
        metadata: {
          subjects: report.subjectsConsidered,
          assessments: report.assessmentsCreated,
          alertsCreated: report.alertsCreated,
          alertsUpdated: report.alertsUpdated,
          eventsIngested: report.ingestion.ingested,
          failures: report.failures.length,
          skippedSources: report.ingestion.skippedSources,
        },
      },
      requestAuditContext(request)
    );
    return { ...report, advisory: ADVISORY_ONLY };
  });

  app.get(`${BASE}/runs`, async (request) => {
    await requireFsPermission(request, env, pool, 'fraud_sentinel.view');
    const query = parseOrThrow(runsQuery, request.query);
    const window = resolveWindow(query);
    const page = await listRuns(pool, {
      page: pageOf(query.page),
      limit: limitOf(query.limit, 50),
      ...(query.jobName ? { jobName: query.jobName } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.trigger ? { trigger: query.trigger } : {}),
      since: query.since || query.until || query.days ? window.since : null,
      until: query.since || query.until || query.days ? window.until : null,
    });
    return { ...page, latestPerJob: await latestRunPerJob(pool), jobs: FS_JOBS.map((job) => ({ name: job.name, description: job.description })) };
  });

  app.post(`${BASE}/jobs/:name/run`, async (request) => {
    const ctx = await requireFsPermission(request, env, pool, 'fraud_sentinel.run_scan');
    const { name } = parseOrThrow(z.object({ name: z.string().max(64) }), request.params);
    if (!findJob(name)) throw new NotFoundError(`Unknown job: ${name}`);
    const outcome = await executeJobManually(pool, name, ctx.userId);
    await recordAudit(
      pool,
      {
        actorId: ctx.userId,
        action: 'fraud_sentinel.job_run',
        resourceType: 'fraud_sentinel_run',
        resourceId: outcome.run?.id ?? null,
        metadata: { job: name, status: outcome.status, counters: outcome.result?.counters ?? null, error: outcome.error ?? null },
      },
      requestAuditContext(request)
    );
    return outcome;
  });
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

/** RFC-4180 quoting. A value containing a comma, quote or newline is quoted and its quotes doubled. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(rows: readonly Record<string, string>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0] as Record<string, string>);
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header] ?? '')).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
