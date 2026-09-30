/**
 * Revenue Guardian — shared domain types and constants.
 *
 * The module is a recovery/management layer over the existing billing engine; these types mirror
 * the schema introduced in database/migrations/0054_create_revenue_guardian.sql.
 */

export const CASE_STATUSES = [
  'new',
  'contact_required',
  'contacted',
  'awaiting_customer',
  'payment_promised',
  'payment_pending',
  'partially_recovered',
  'recovered',
  'escalated',
  'disputed',
  'closed',
  'written_off',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const FOLLOW_UP_TYPES = [
  'payment_reminder',
  'invoice_due',
  'invoice_overdue',
  'renewal_reminder',
  'expiration_reminder',
  'pre_suspension',
  'pre_termination',
  'failed_payment',
  'payment_promise',
  'customer_check_in',
  'escalation',
  'custom',
] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const FOLLOW_UP_STATUSES = ['pending', 'in_progress', 'completed', 'snoozed', 'cancelled'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_CHANNELS = ['email', 'phone', 'whatsapp', 'sms', 'in_person', 'other'] as const;
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];

export const PROMISE_STATUSES = ['pending', 'fulfilled', 'partially_fulfilled', 'broken', 'cancelled'] as const;
export type PromiseStatus = (typeof PROMISE_STATUSES)[number];

export const ASSIGNMENT_TYPES = ['account_manager', 'sales_rep', 'collections', 'customer_success'] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const AUTOMATION_EVENT_TYPES = [
  'invoice_upcoming',
  'invoice_overdue',
  'payment_failed',
  'renewal_upcoming',
  'service_expiring',
  'pre_suspension',
  'pre_termination',
  'promise_due',
  'promise_broken',
] as const;
export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number];

/** Result counters every automation job reports (spec §21). */
export interface JobResult {
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  notificationsSent: number;
}

export function emptyJobResult(): JobResult {
  return { processed: 0, created: 0, skipped: 0, failed: 0, notificationsSent: 0 };
}

export interface RecoveryCaseRow {
  id: string;
  case_number: string;
  customer_id: string;
  invoice_id: string | null;
  order_id: string | null;
  service_id: string | null;
  domain_id: string | null;
  subscription_id: string | null;
  assigned_staff_id: string | null;
  status: CaseStatus;
  priority: CasePriority;
  risk_level: RiskLevel;
  risk_score: number;
  risk_reasons: string[];
  escalation_level: number;
  source: string;
  currency: string;
  amount_at_risk: string;
  amount_outstanding: string;
  amount_recovered: string;
  dispute_reason: string | null;
  opened_at: string;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpRow {
  id: string;
  case_id: string | null;
  customer_id: string;
  invoice_id: string | null;
  service_id: string | null;
  assigned_staff_id: string | null;
  type: FollowUpType;
  priority: CasePriority;
  status: FollowUpStatus;
  channel: FollowUpChannel;
  scheduled_at: string;
  snoozed_until: string | null;
  completed_at: string | null;
  outcome: string | null;
  notes: string | null;
  dedupe_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentPromiseRow {
  id: string;
  customer_id: string;
  invoice_id: string;
  case_id: string | null;
  promised_amount: string;
  currency: string;
  promised_date: string;
  status: PromiseStatus;
  fulfilled_amount: string;
  fulfilled_at: string | null;
  broken_at: string | null;
  payment_reference: string | null;
  assigned_staff_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssignmentRow {
  id: string;
  customer_id: string;
  staff_user_id: string;
  assignment_type: AssignmentType;
  is_primary: boolean;
  assigned_by: string | null;
  assigned_at: string;
  ended_at: string | null;
  ended_by: string | null;
  reason: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface AutomationRunRow {
  id: string;
  job_name: string;
  run_key: string;
  trigger: 'schedule' | 'manual';
  triggered_by: string | null;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  processed_count: number;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  notifications_sent: number;
  error: string | null;
}

export interface ActivityLogRow {
  id: string;
  customer_id: string | null;
  case_id: string | null;
  invoice_id: string | null;
  follow_up_id: string | null;
  promise_id: string | null;
  actor_id: string | null;
  actor_type: 'staff' | 'system' | 'customer';
  event_type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CommunicationLogRow {
  id: string;
  customer_id: string | null;
  case_id: string | null;
  invoice_id: string | null;
  channel: 'email' | 'whatsapp';
  recipient: string;
  template_key: string;
  subject: string;
  body: string | null;
  provider: string | null;
  provider_message_id: string | null;
  status: string;
  failure_reason: string | null;
  notification_id: string | null;
  dedupe_key: string | null;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
}

/** Pagination envelope shared by every Revenue Guardian list endpoint. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
