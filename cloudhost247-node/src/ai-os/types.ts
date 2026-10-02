/**
 * CloudHost247 AI Control Plane — shared types.
 *
 * The AI Control Plane is ONE shared operating system for every CloudHost247 AI agent: shared
 * registry, shared tool executor, shared permission model, shared event bus, shared audit trail
 * and one Executive Board on top. It deliberately contains no LLM hard dependency: the native
 * `deterministic` engine answers only from real platform data + registered knowledge; any
 * external model engine stays fail-closed (CONFIGURATION_REQUIRED) until an administrator
 * configures and enables it (see src/ai-os/models/router.ts, spec §37).
 */

export type AgentCategory =
  | 'executive' | 'support' | 'infrastructure' | 'security' | 'billing' | 'sales'
  | 'marketing' | 'customer' | 'knowledge' | 'internal' | 'incident' | 'finops'
  | 'analytics' | 'copilot';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'awaiting_approval' | 'cancelled';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'executed' | 'failed';
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type MemoryScope = 'short' | 'customer' | 'operational' | 'organizational' | 'executive';
export type RunPhase = 'observe' | 'understand' | 'plan' | 'authorize' | 'act' | 'verify' | 'report' | 'learn';

export interface AgentRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: AgentCategory;
  board_seat: string | null;
  version: number;
  engine: string;
  model_tier: string;
  status: string;
  permissions: unknown;
  tools: unknown;
  task_types: unknown;
  approval_policy: 'automatic' | 'standard' | 'strict';
  risk_level: RiskLevel;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  agent_id: string;
  task_type: string;
  status: TaskStatus;
  subject_type: string | null;
  subject_id: string | null;
  context: Record<string, unknown>;
  priority: string;
  requested_by: string | null;
  requested_by_type: string;
  customer_id: string | null;
  result_summary: string | null;
  result: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  idempotency_key: string | null;
  run_after: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RunRow {
  id: string;
  task_id: string;
  agent_id: string;
  attempt: number;
  status: RunStatus;
  engine: string;
  model: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  verification: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface RunStepRow {
  id: string;
  run_id: string;
  step_order: number;
  phase: RunPhase;
  status: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ToolCallRow {
  id: string;
  run_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  approval_id: string | null;
  tool: string;
  permission: string;
  risk_level: RiskLevel;
  arguments: Record<string, unknown>;
  result: unknown;
  success: boolean;
  error_code: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ApprovalRow {
  id: string;
  agent_id: string;
  task_id: string | null;
  run_id: string | null;
  tool: string;
  action: string;
  reason: string;
  evidence: unknown;
  risk_level: RiskLevel;
  affected_customer_id: string | null;
  affected_resource: string | null;
  arguments: Record<string, unknown>;
  status: ApprovalStatus;
  decision_by: string | null;
  decision_at: string | null;
  decision_note: string | null;
  expires_at: string;
  executed_at: string | null;
  execution_result: unknown;
  created_at: string;
  updated_at: string;
}

export interface FindingRow {
  id: string;
  agent_id: string;
  run_id: string | null;
  task_id: string | null;
  finding_type: string;
  severity: FindingSeverity;
  title: string;
  summary: string;
  evidence: unknown;
  subject_type: string | null;
  subject_id: string | null;
  recommendation: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  event_type: string;
  source: string;
  fingerprint: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  processed_at: string | null;
  created_at: string;
}

export interface WorkflowRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  event_type: string;
  enabled: boolean;
  definition: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  event_id: string | null;
  status: string;
  steps: unknown;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface IncidentRow {
  id: string;
  incident_number: string;
  severity: string;
  title: string;
  summary: string;
  affected: unknown;
  status: string;
  commander_agent_id: string | null;
  opened_by: string | null;
  opened_by_type: string;
  timeline: unknown;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecutiveReportRow {
  id: string;
  report_type: 'daily' | 'weekly' | 'monthly' | 'adhoc';
  period_start: string;
  period_end: string;
  sections: unknown;
  metrics: unknown;
  findings: unknown;
  generated_by_agent_id: string | null;
  status: string;
  created_at: string;
}

export interface KnowledgeSourceRow {
  id: string;
  title: string;
  source_type: string;
  uri: string | null;
  version: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunkRow {
  id: string;
  source_id: string;
  chunk_index: number;
  title: string | null;
  content: string;
  keywords: string[];
  created_at: string;
}

export interface ModelConfigRow {
  id: string;
  engine: string;
  provider: string | null;
  model: string | null;
  endpoint: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A single traceable grounding reference for any agent output (spec §24 traceability). */
export interface EvidenceRef {
  table: string;
  id?: string;
  description: string;
}

/** Platform-meaningful event vocabulary the AI event bus understands (spec §24). */
export const AI_EVENT_TYPES = [
  'customer.created',
  'order.created',
  'order.paid',
  'invoice.created',
  'invoice.overdue',
  'payment.failed',
  'payment.succeeded',
  'subscription.created',
  'subscription.cancelled',
  'subscription.past_due',
  'ticket.created',
  'ticket.updated',
  'server.created',
  'server.unhealthy',
  'server.offline',
  'deployment.failed',
  'deployment.stuck',
  'deployment.completed',
  'domain.expiring',
  'ssl.expiring',
  'ssl.failed',
  'security.alert',
  'incident.created',
  'incident.resolved',
  'manual.trigger',
] as const;

export type AiEventType = (typeof AI_EVENT_TYPES)[number];
