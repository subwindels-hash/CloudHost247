/**
 * WINDELS FRAUD SENTINEL AI — shared domain types and constants.
 *
 * The module is an ADVISORY risk-intelligence layer over data CloudHost247 already records. These
 * types mirror database/migrations/0101_create_fraud_sentinel.sql exactly; nothing here invents a
 * field the schema does not store.
 *
 * Two invariants the whole module is built around:
 *   1. Every risk statement is traceable to a real stored row (see EvidenceRef).
 *   2. The module never writes to a financial or account-status table. It reports; humans decide.
 */

/* -------------------------------------------------------------------------- */
/* Enumerations (mirrors of the CHECK constraints in migration 0101)           */
/* -------------------------------------------------------------------------- */

export const FRAUD_CATEGORIES = ['payment', 'account_security', 'order_service', 'admin_api'] as const;
export type FraudCategory = (typeof FRAUD_CATEGORIES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Deliberately the same four-level scale Revenue Guardian uses, so two platform risk numbers
 * never disagree about what "high" means. */
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const SUBJECT_TYPES = ['customer', 'ip', 'actor', 'gateway'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const ALERT_STATUSES = ['new', 'under_review', 'escalated', 'resolved', 'false_positive'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const OPEN_ALERT_STATUSES = ['new', 'under_review', 'escalated'] as const;

export const ASSESSMENT_STATUSES = ['active', 'superseded'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const RULE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

export const FALSE_POSITIVE_REASONS = [
  'legitimate_customer',
  'expected_behaviour',
  'insufficient_evidence',
  'duplicate_signal',
  'rule_misconfiguration',
  'other',
] as const;
export type FalsePositiveReason = (typeof FALSE_POSITIVE_REASONS)[number];

export const INVESTIGATION_ACTIONS = [
  'created',
  're_detected',
  'status_changed',
  'assigned',
  'unassigned',
  'note_added',
  'evidence_reviewed',
  'escalated',
  'resolved',
  'false_positive_reported',
  'ai_summary_generated',
  'risk_changed',
] as const;
export type InvestigationAction = (typeof INVESTIGATION_ACTIONS)[number];

export const RULE_CHANGE_TYPES = [
  'created',
  'updated',
  'enabled',
  'disabled',
  'parameters_changed',
  'reseeded',
] as const;
export type RuleChangeType = (typeof RULE_CHANGE_TYPES)[number];

/** Version of the scoring AGGREGATION formula (family caps → sum → clamp → level). Bumped only when
 * the formula changes, never when a rule weight changes — that is what rule versions and
 * `rule_set_version` are for. */
export const SCORING_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A pointer at a real row. This is the module's honesty contract: evidence is never a narrative
 * claim, it is `{table, id, description}` that an investigator can go and read.
 */
export interface EvidenceRef {
  table: string;
  id: string | null;
  description: string;
  /** ISO-8601. The event timestamp the authorization asks every assessment to carry. */
  occurredAt?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

export interface FraudRuleRow {
  id: string;
  code: string;
  name: string;
  description: string;
  category: FraudCategory;
  family: string;
  version: number;
  enabled: boolean;
  weight: number;
  severity: RuleSeverity;
  parameters: Record<string, unknown>;
  recommendation: string;
  data_sources: string[];
  applies_to: SubjectType[];
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FraudRuleHistoryRow {
  id: string;
  rule_id: string;
  code: string;
  version: number;
  change_type: RuleChangeType;
  snapshot: Record<string, unknown>;
  changed_by: string | null;
  reason: string | null;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export interface FraudEventRow {
  id: string;
  dedupe_key: string;
  source_table: string;
  source_id: string;
  source_event_type: string;
  category: FraudCategory;
  subject_type: SubjectType;
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
  /**
   * Non-uuid subject label for `gateway` subjects (the payment provider name), because a gateway is a
   * name rather than a row id and forcing it into `subject_id uuid` would either fail or lose it.
   * NULL for every other subject type.
   */
  channel: string | null;
  occurred_at: string;
  evidence: Record<string, unknown>;
  ingested_at: string;
  created_at: string;
}

/* -------------------------------------------------------------------------- */
/* Assessments                                                                 */
/* -------------------------------------------------------------------------- */

/** One triggered rule inside an assessment — the full derivation of its contribution. */
export interface TriggeredRule {
  code: string;
  version: number;
  family: string;
  category: FraudCategory;
  severity: RuleSeverity;
  /** The configured weight at assessment time (not the catalogue default). */
  weight: number;
  /** The weight actually credited after the family cap was applied. */
  cappedWeight: number;
  reasonCode: string;
  reason: string;
  confidence: ConfidenceLevel;
  evidence: EvidenceRef[];
}

/**
 * One scoring family's contribution to the final score, frozen on the assessment row.
 *
 * `cap` is stored (not just `raw`/`capped`) so the breakdown remains self-describing after an
 * administrator retunes the caps: the row answers "why did this family stop at 30?" without needing
 * the configuration that existed at the time.
 */
export interface FamilyContribution {
  family: string;
  /** Sum of the configured weights of every triggered rule in the family. */
  raw: number;
  /** What was actually credited after the cap — `min(raw, cap)`, allocated heaviest-rule-first. */
  capped: number;
  cap: number;
}

export interface DataQualityFlag {
  code: string;
  severity: 'informational' | 'material';
  detail: string;
}

export interface AssessmentResult {
  subjectType: SubjectType;
  subjectId: string | null;
  customerId: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  previousScore: number | null;
  previousLevel: RiskLevel | null;
  triggeredRules: TriggeredRule[];
  evidence: EvidenceRef[];
  recommendations: string[];
  confidence: ConfidenceLevel;
  dataQuality: DataQualityFlag[];
  ruleSetVersion: string;
  scoringVersion: number;
  windowStartedAt: string;
  windowEndedAt: string;
  eventsExamined: number;
  /** Family totals after capping — exposed so the dashboard can show WHERE the score came from. */
  familyContributions: Array<{ family: string; raw: number; capped: number; cap: number }>;
}

export interface FraudAssessmentRow {
  id: string;
  subject_type: SubjectType;
  subject_id: string | null;
  /** Literal subject identity for non-uuid subjects: the IP address for `ip`, the gateway name for
   * `gateway`. NULL for customer/actor subjects, whose identity is subject_id / customer_id. */
  subject_label: string | null;
  customer_id: string | null;
  risk_score: number;
  risk_level: RiskLevel;
  previous_score: number | null;
  previous_level: RiskLevel | null;
  previous_assessment_id: string | null;
  triggered_rules: TriggeredRule[];
  /** Per-family raw/capped totals — the readable form of how the capped weights summed to the score. */
  family_contributions: FamilyContribution[];
  evidence: EvidenceRef[];
  recommendations: string[];
  confidence: ConfidenceLevel;
  data_quality: DataQualityFlag[];
  rule_set_version: string;
  scoring_version: number;
  window_started_at: string;
  window_ended_at: string;
  events_examined: number;
  status: AssessmentStatus;
  ai_summary: string | null;
  ai_assisted: boolean;
  ai_engine: string | null;
  assessed_at: string;
  created_at: string;
  /** Present only when the read joined `users` for the customer — never stored on the row. */
  customer_email?: string | null;
  customer_name?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Alerts & investigations                                                     */
/* -------------------------------------------------------------------------- */

export interface FraudAlertRow {
  id: string;
  alert_number: string;
  assessment_id: string;
  customer_id: string | null;
  subject_type: SubjectType;
  subject_id: string | null;
  /** See FraudAssessmentRow.subject_label — the IP address or gateway name for non-uuid subjects. */
  subject_label: string | null;
  dedupe_key: string;
  category: FraudCategory;
  risk_level: RiskLevel;
  risk_score: number;
  title: string;
  explanation: string;
  primary_rule_code: string | null;
  status: AlertStatus;
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
  /** Present when the alert was enriched with its assessment (detail endpoint). */
  customer_email?: string | null;
  customer_name?: string | null;
  reviewer_name?: string | null;
}

export interface FraudInvestigationRow {
  id: string;
  alert_id: string;
  assessment_id: string | null;
  actor_id: string | null;
  actor_type: 'staff' | 'system';
  action: InvestigationAction;
  from_status: AlertStatus | null;
  to_status: AlertStatus | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_name?: string | null;
}

export interface FraudFalsePositiveRow {
  id: string;
  alert_id: string;
  assessment_id: string | null;
  rule_codes: string[];
  reported_by: string | null;
  reason_category: FalsePositiveReason;
  explanation: string;
  created_at: string;
  reported_by_name?: string | null;
}

export interface FraudRiskHistoryRow {
  id: string;
  customer_id: string | null;
  subject_type: SubjectType;
  subject_id: string | null;
  subject_label: string | null;
  assessment_id: string | null;
  risk_score: number;
  risk_level: RiskLevel;
  previous_score: number | null;
  previous_level: RiskLevel | null;
  primary_reason_code: string | null;
  rule_set_version: string;
  recorded_at: string;
}

export interface FraudRunRow {
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

/* -------------------------------------------------------------------------- */
/* Job results                                                                 */
/* -------------------------------------------------------------------------- */

export interface JobResult {
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  notificationsSent: number;
  eventsIngested: number;
  assessmentsCreated: number;
  alertsCreated: number;
  alertsUpdated: number;
  recordsPruned: number;
}

export function emptyJobResult(): JobResult {
  return {
    processed: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    notificationsSent: 0,
    eventsIngested: 0,
    assessmentsCreated: 0,
    alertsCreated: 0,
    alertsUpdated: 0,
    recordsPruned: 0,
  };
}

/** Counters the run ledger persists, mapped from JobResult. */
export interface RunCounters {
  subjectsScanned: number;
  eventsIngested: number;
  assessmentsCreated: number;
  alertsCreated: number;
  alertsUpdated: number;
  notificationsSent: number;
  recordsPruned: number;
  failedCount: number;
}

/* -------------------------------------------------------------------------- */
/* Scope (customer isolation)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Explicit read scope, following the contract src/db/email-trace.ts established: scoping is a
 * PARAMETER, not a convention, and an empty scope is a CLOSED scope that matches nothing.
 *
 * This platform is single-tenant (no table in the 100 committed migrations carries a tenant_id), so
 * "tenant isolation" here means customer isolation for customer-facing reads and role-based
 * scoping for staff reads. `unrestricted` is only ever set for admin/super_admin callers whose role
 * was re-read from the database on this request.
 */
export interface FraudScope {
  /** True only for admin/super_admin: no subject filtering is applied. */
  unrestricted: boolean;
  /** When not unrestricted, reads are limited to this single customer uuid. Empty = closed scope. */
  customerIds: readonly string[];
}

export const CLOSED_SCOPE: FraudScope = { unrestricted: false, customerIds: [] };

export function scopeAllowsCustomer(scope: FraudScope, customerId: string | null): boolean {
  if (scope.unrestricted) return true;
  if (!customerId) return false;
  return scope.customerIds.includes(customerId);
}

/**
 * Splits the opaque subject identity used across the module into its two storage columns.
 *
 * Everywhere upstream (SubjectKey, SubjectFacts, AssessmentResult) `subjectId` is ONE opaque string:
 * a `users.id` uuid for customer/actor subjects, an IP address for `ip` subjects, a gateway name for
 * `gateway` subjects. Only the persistence layer may assume a shape, and this is the single place
 * that does — so a uuid is never forced into an IP address or vice versa, and the split cannot drift
 * between assessments, alerts and risk history.
 */
export function splitSubjectIdentity(
  subjectType: SubjectType,
  subjectId: string | null
): { subjectId: string | null; subjectLabel: string | null } {
  if (subjectId === null) return { subjectId: null, subjectLabel: null };
  return subjectType === 'ip' || subjectType === 'gateway'
    ? { subjectId: null, subjectLabel: subjectId.slice(0, 64) }
    : { subjectId, subjectLabel: null };
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/* -------------------------------------------------------------------------- */
/* Advisory-only contract                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Returned with every assessment/alert payload so no consumer — API client, dashboard, or a future
 * automation — can mistake this module's output for an enforcement decision.
 *
 * The list is the authorization boundary restated in code: Fraud Sentinel does not approve or reject
 * payments, issue refunds, move money, change balances, seize funds, suspend accounts, change
 * entitlements, bypass WHMCS authorization, or override any existing financial control.
 */
export const ADVISORY_ONLY = {
  advisoryOnly: true,
  performsNoEnforcement: true,
  forbiddenActions: [
    'approve_or_reject_payments',
    'issue_refunds',
    'transfer_money',
    'change_customer_balances',
    'seize_customer_funds',
    'suspend_accounts',
    'change_service_entitlements',
    'bypass_whmcs_authorization',
    'override_financial_controls',
  ],
  statement:
    'Fraud Sentinel is advisory and investigative. Every risk score, alert and recommendation is a ' +
    'pointer at recorded evidence for a human reviewer. It performs no enforcement action of any ' +
    'kind; enforcement stays in the existing, separately authorized workflows with human approval ' +
    'and audit logging.',
} as const;

export type AdvisoryOnly = typeof ADVISORY_ONLY;
