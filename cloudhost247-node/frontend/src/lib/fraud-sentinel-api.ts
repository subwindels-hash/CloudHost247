/**
 * Fraud Sentinel API client — thin typed wrappers over /api/admin/fraud-sentinel/*.
 *
 * Same-origin `apiFetch` with the bearer token, exactly like every other module client. Two rules
 * shape this file:
 *
 *  1. It types the responses; it does NOT duplicate the vocabularies. Alert statuses, risk levels,
 *     categories, subject types, false-positive reasons, the transition map, the sortable columns,
 *     the job list and the minimum note lengths all come from `GET /meta` at runtime, so a server-side
 *     change to any of them is reflected in the UI without a redeploy of the SPA — and a value the
 *     server adds cannot be silently dropped by a stale constant here.
 *  2. Every payload that could read as a verdict carries the server's own advisory contract
 *     (`AdvisoryOnly`). This client never paraphrases it and never renders a score without it.
 */
import { apiFetch } from './api';
import { toolsApiPath } from './tools-runtime';

const BASE = '/api/admin/fraud-sentinel';

export type FsPermission =
  | 'fraud_sentinel.view'
  | 'fraud_sentinel.investigate'
  | 'fraud_sentinel.assign'
  | 'fraud_sentinel.rules'
  | 'fraud_sentinel.run_scan'
  | 'fraud_sentinel.settings'
  | 'fraud_sentinel.export'
  | 'fraud_sentinel.view_all_customers';

const ADMIN_PERMISSIONS: FsPermission[] = [
  'fraud_sentinel.view',
  'fraud_sentinel.investigate',
  'fraud_sentinel.assign',
  'fraud_sentinel.rules',
  'fraud_sentinel.run_scan',
  'fraud_sentinel.export',
  'fraud_sentinel.view_all_customers',
];

/**
 * UX-only mirror of the server-side role→permission map (src/fraud-sentinel/permissions.ts), used to
 * hide menu entries and buttons a role cannot use. The server independently re-verifies every call, so
 * this function being wrong can only ever hide something or show something that is then refused —
 * it can never widen access.
 *
 * `fraud_sentinel.settings` is super_admin-only: settings include the retention horizons, which drive
 * deletion of evidence, plus the scheduler and the AI-assist switch.
 */
export function fsPermissionsForRole(role: string | undefined): FsPermission[] {
  if (role === 'super_admin') return [...ADMIN_PERMISSIONS, 'fraud_sentinel.settings'];
  if (role === 'admin') return [...ADMIN_PERMISSIONS];
  // staff and customer hold no Fraud Sentinel permissions at all: the module's evidence view is a
  // concentrated picture of payment declines, login origins and administrative activity.
  return [];
}

/* -------------------------------------------------------------------------- */
/* Response shapes (mirrors src/fraud-sentinel/types/index.ts)                  */
/* -------------------------------------------------------------------------- */

export interface AdvisoryOnly {
  advisoryOnly: boolean;
  performsNoEnforcement: boolean;
  forbiddenActions: string[];
  statement: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface EvidenceRef {
  table: string;
  id: string | null;
  description: string;
  occurredAt?: string | null;
}

export interface EvidenceIntegrity {
  ok: boolean;
  /** JSON paths whose content failed the outbound secret check and were therefore withheld. */
  withheld: string[];
}

export interface DataQualityFlag {
  code: string;
  severity: 'informational' | 'material';
  detail: string;
}

export interface FamilyContribution {
  family: string;
  raw: number;
  capped: number;
  cap: number;
}

export interface TriggeredRule {
  code: string;
  version: number;
  family: string;
  category: string;
  severity: string;
  weight: number;
  cappedWeight: number;
  reasonCode: string;
  reason: string;
  confidence: string;
  evidence: EvidenceRef[];
}

export interface AssessmentRow {
  id: string;
  subject_type: string;
  subject_id: string | null;
  subject_label: string | null;
  customer_id: string | null;
  risk_score: number;
  risk_level: string;
  previous_score: number | null;
  previous_level: string | null;
  previous_assessment_id: string | null;
  triggered_rules: TriggeredRule[];
  family_contributions: FamilyContribution[];
  evidence: EvidenceRef[];
  recommendations: string[];
  confidence: string;
  data_quality: DataQualityFlag[];
  rule_set_version: string;
  scoring_version: number;
  window_started_at: string;
  window_ended_at: string;
  events_examined: number;
  status: string;
  ai_summary: string | null;
  ai_assisted: boolean;
  ai_engine: string | null;
  assessed_at: string;
  created_at: string;
  customer_email?: string | null;
  customer_name?: string | null;
}

export interface AlertRow {
  id: string;
  alert_number: string;
  assessment_id: string;
  customer_id: string | null;
  subject_type: string;
  subject_id: string | null;
  subject_label: string | null;
  dedupe_key: string;
  category: string;
  risk_level: string;
  risk_score: number;
  title: string;
  explanation: string;
  primary_rule_code: string | null;
  status: string;
  assigned_reviewer_id: string | null;
  assigned_at: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  recurrence_count: number;
  detected_at: string;
  last_assessed_at: string;
  created_at: string;
  updated_at: string;
  customer_email?: string | null;
  customer_name?: string | null;
  reviewer_name?: string | null;
}

export interface InvestigationRow {
  id: string;
  alert_id: string;
  assessment_id: string | null;
  actor_id: string | null;
  actor_type: 'staff' | 'system';
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_name?: string | null;
}

export interface FalsePositiveRow {
  id: string;
  alert_id: string;
  assessment_id: string | null;
  rule_codes: string[];
  reported_by: string | null;
  reason_category: string;
  explanation: string;
  created_at: string;
  reported_by_name?: string | null;
}

export interface RiskHistoryRow {
  id: string;
  customer_id: string | null;
  subject_type: string;
  subject_id: string | null;
  subject_label: string | null;
  assessment_id: string | null;
  risk_score: number;
  risk_level: string;
  previous_score: number | null;
  previous_level: string | null;
  primary_reason_code: string | null;
  rule_set_version: string;
  recorded_at: string;
}

export interface AlertDetail {
  alert: AlertRow;
  assessment: AssessmentRow | null;
  investigations: InvestigationRow[];
  falsePositive: FalsePositiveRow | null;
  riskHistory: RiskHistoryRow[];
  advisory: AdvisoryOnly;
  evidenceIntegrity: EvidenceIntegrity;
}

export interface EventRow {
  id: string;
  dedupe_key: string;
  source_table: string;
  source_id: string;
  source_event_type: string;
  category: string;
  subject_type: string;
  subject_id: string | null;
  customer_id: string | null;
  actor_id: string | null;
  order_id: string | null;
  invoice_id: string | null;
  payment_id: string | null;
  service_id: string | null;
  ip_address: string | null;
  ip_country_code: string | null;
  client_family: string | null;
  amount: string | null;
  currency: string | null;
  channel: string | null;
  occurred_at: string;
  evidence: Record<string, unknown>;
  ingested_at: string;
  created_at: string;
}

export interface CustomerRiskProfile {
  customerId: string;
  account: { email: string | null; full_name: string | null; role: string; status: string; created_at: string | null } | null;
  current: AssessmentRow | null;
  history: RiskHistoryRow[];
  openAlerts: AlertRow[];
  closedAlerts: AlertRow[];
  recentEvents: EventRow[];
  assessments: AssessmentRow[];
  advisory: AdvisoryOnly;
}

export interface RuleRow {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  family: string;
  version: number;
  enabled: boolean;
  weight: number;
  severity: string;
  parameters: Record<string, unknown>;
  recommendation: string;
  data_sources: string[];
  applies_to: string[];
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuleDefinition {
  code: string;
  name: string;
  description: string;
  category: string;
  family: string;
  version: number;
  enabled: boolean;
  weight: number;
  severity: string;
  parameters: Record<string, unknown>;
  recommendation: string;
  dataSources: string[];
  appliesTo: string[];
}

/** A stored rule beside the reviewed default it may have drifted from. */
export interface RuleWithDefault extends RuleRow {
  catalogueDefault: RuleDefinition | null;
  drift: string[];
  hasEvaluator: boolean;
}

export interface RuleHistoryRow {
  id: string;
  rule_id: string;
  code: string;
  version: number;
  change_type: string;
  snapshot: Record<string, unknown>;
  changed_by: string | null;
  reason: string | null;
  created_at: string;
}

export interface RuleDriftReport {
  missingInDatabase: string[];
  withoutEvaluator: Array<{ code: string; enabled: boolean }>;
  tuned: Array<{ code: string; drift: string[] }>;
}

export interface FsSettings {
  enabled: boolean;
  lookbackDays: number;
  riskThresholds: { medium: number; high: number; critical: number };
  familyCaps: Record<string, number>;
  alertMinLevel: string;
  alertOnCriticalRule: boolean;
  notifyReviewerRoles: string[];
  scanBatchSize: number;
  eventBatchLimit: number;
  ingestBatchLimit: number;
  schedulerIntervalMinutes: number;
  retentionEventDays: number;
  retentionHistoryDays: number;
  retentionSupersededAssessmentDays: number;
  aiAssistEnabled: boolean;
  aiEngine: string;
}

export interface SettingsView {
  settings: FsSettings;
  defaults: FsSettings;
  overridden: string[];
  scoringKeys: string[];
  levels: string[];
  categories: string[];
  families: string[];
  canEdit?: boolean;
}

export interface RunRow {
  id: string;
  job_name: string;
  run_key: string;
  trigger: 'schedule' | 'manual';
  triggered_by: string | null;
  status: 'running' | 'completed' | 'failed';
  subjects_scanned: number;
  events_ingested: number;
  assessments_created: number;
  alerts_created: number;
  alerts_updated: number;
  notifications_sent: number;
  records_pruned: number;
  failed_count: number;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  triggered_by_name?: string | null;
}

export interface JobRunOutcome {
  status: 'completed' | 'failed' | 'locked' | 'unknown_job';
  notes: string[];
  error?: string;
  run?: RunRow;
  result?: { counters: Record<string, number>; notes: string[]; skippedSources?: Array<{ table: string; reason: string }> };
}

export interface ScanReport {
  enabled: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  settings: Record<string, unknown>;
  window: { startedAt: string; endedAt: string };
  ingestion: {
    ingested: number;
    scanned: number;
    perTable: Array<{ table: string; scanned: number; ingested: number }>;
    skippedSources: Array<{ table: string; reason: string }>;
  };
  subjectsConsidered: number;
  assessmentsCreated: number;
  assessmentsUnchanged: number;
  alertsCreated: number;
  alertsUpdated: number;
  notificationsSent: number;
  failures: Array<{ subjectType: string; subjectId: string; error: string }>;
  counters: Record<string, number>;
  advisory: AdvisoryOnly;
}

export interface DashboardOverview {
  window: { since: string; until: string };
  alerts: {
    total: number;
    open: number;
    new: number;
    underReview: number;
    escalated: number;
    resolved: number;
    falsePositive: number;
    highOrCritical: number;
    unassigned: number;
  };
  riskDistribution: Array<{ level: string; subjects: number }>;
  byCategory: Array<{ category: string; alerts: number }>;
  topRules: Array<{ code: string; alerts: number; falsePositives: number }>;
  confidenceBreakdown: Array<{ confidence: string; assessments: number }>;
  recentAlerts: AlertRow[];
  highestRiskCustomers: Array<{
    customer_id: string;
    email: string | null;
    full_name: string | null;
    risk_score: number;
    risk_level: string;
    assessed_at: string;
    open_alerts: number;
  }>;
  lastRun: { job_name: string; status: string; started_at: string; finished_at: string | null } | null;
  advisory: AdvisoryOnly;
  permissions: FsPermission[];
}

export interface RuleFeedbackRow {
  code: string;
  name: string;
  family: string;
  enabled: boolean;
  weight: number;
  version: number;
  alerts: number;
  falsePositives: number;
  /** null rather than 0 when the rule raised no alerts: nobody has tested it, so it has no rate. */
  falsePositiveRate: number | null;
}

/**
 * The vocabulary and the state machine, published by the server so this SPA hardcodes neither.
 * Every select, every transition button and every minimum-length hint on the Fraud Sentinel screens
 * is built from this payload.
 */
export interface FsMeta {
  permissions: FsPermission[];
  statuses: string[];
  levels: string[];
  categories: string[];
  subjectTypes: string[];
  falsePositiveReasons: string[];
  investigationActions: string[];
  transitions: Record<string, string[]>;
  sortColumns: string[];
  jobs: Array<{ name: string; description: string }>;
  minResolutionNote: number;
  minFalsePositiveExplanation: number;
  advisory: AdvisoryOnly;
}

export interface FsReviewer {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

export type FsQuery = Record<string, string | number | boolean | undefined | null>;

function query(params: FsQuery): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // `false` is meaningful (an explicit "no" filter) and must survive; null/undefined/'' must not.
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function fsGet<T>(path: string, params: FsQuery = {}): Promise<T> {
  return apiFetch<T>(`${BASE}${path}${query(params)}`);
}

export function fsPost<T>(path: string, body?: unknown, params: FsQuery = {}): Promise<T> {
  return apiFetch<T>(`${BASE}${path}${query(params)}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function fsPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`${BASE}${path}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/** The vocabulary + state machine. Cheap, cached per mount by `useFsMeta`. */
export function fetchFsMeta(): Promise<FsMeta> {
  return fsGet<FsMeta>('/meta');
}

/**
 * The alert CSV export needs the raw bytes, so it bypasses apiFetch's JSON parsing.
 *
 * The filters passed here are the ones the list screen is showing, and the server applies the window
 * only when one was requested — the download matches the screen rather than silently narrowing to the
 * last 30 days.
 */
export async function fsExportAlertsCsv(params: FsQuery = {}): Promise<{ blob: Blob; filename: string }> {
  const token = localStorage.getItem('ch247_token');
  const res = await fetch(toolsApiPath(`${BASE}/alerts/export.csv${query(params)}`), {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ message: res.statusText }))) as { message?: string };
    throw new Error(err.message ?? 'Export failed');
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] ?? 'fraud-sentinel-alerts.csv' };
}

/**
 * Who may be named as a reviewer: active administrators.
 *
 * Read through the platform's existing staff directory (`GET /api/v1/admin/customers?role=…`, already
 * gated to admin/super_admin) rather than a Fraud Sentinel endpoint of its own — the module needs no
 * second copy of the staff list, and `POST /alerts/:id/assign` re-verifies the reviewer's role and
 * status server-side regardless of what this picker shows.
 */
export async function fetchFsReviewers(): Promise<FsReviewer[]> {
  const roles = ['admin', 'super_admin'] as const;
  const pages = await Promise.all(
    roles.map((role) =>
      apiFetch<{ customers: Array<{ id: string; email: string; fullName: string; role: string; status: string }> }>(
        `/api/v1/admin/customers?role=${role}&limit=100`
      )
    )
  );
  const seen = new Set<string>();
  const reviewers: FsReviewer[] = [];
  for (const page of pages) {
    for (const person of page.customers) {
      // Only an ACTIVE account can be handed an investigation: the assign endpoint refuses anyone else.
      if (person.status !== 'active' || seen.has(person.id)) continue;
      seen.add(person.id);
      reviewers.push(person);
    }
  }
  return reviewers.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.email.localeCompare(b.email));
}
