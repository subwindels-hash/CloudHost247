-- Migration: 0066_create_ai_control_plane.sql
-- Purpose: CloudHost247 AI Control Plane — the persistence layer for the platform's AI-native
-- operating system (agent registry, task/run execution, tool calls, human approvals, scoped
-- memory, knowledge/RAG, event bus, workflows, findings, incidents, executive reports, model
-- routing, evaluations and an immutable AI audit trail).
--
-- Design invariants (spec: CLOUDHOST247 — NATIVE AI OPERATING SYSTEM):
--  - No existing table is duplicated: agents READ the real platform tables (users, invoices,
--    payments, orders, subscriptions, support_tickets, servers, server_metrics, deployments,
--    customer_domains, ssl_certificates, auth_audit_log, …). These tables only store AI
--    workflow state that has no existing home.
--  - Rows in ai_audit_logs are append-only: application code never updates or deletes them.
--  - ai_approvals is the Human Decision Inbox: high-risk tool execution is impossible without a
--    row approved by a real staff/admin user (enforced by src/ai-os/runtime/executor.ts).
--  - Memory is tenant-isolated by scope + customer_id; a customer-scoped row can never leak to
--    another customer because every read is keyed on the authenticated user id, server-side.
--  - Monetary values are never stored here: findings/tasks reference real billing rows by FK.

-- ---------------------------------------------------------------------------------------------
-- 1. Agent registry (spec §18). Agents must not hard-code their own permissions: the registry
--    permissions/tools columns are the only authority consulted by the runtime tool executor.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(64) NOT NULL,
  name varchar(120) NOT NULL,
  description text NOT NULL,
  -- executive | support | infrastructure | security | billing | sales | marketing | customer |
  -- knowledge | internal | incident | finops | analytics | copilot
  category varchar(24) NOT NULL,
  -- Board seat label for executive agents (CEO/CFO/…); NULL for workforce agents.
  board_seat varchar(8) NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  -- 'deterministic' = the native, reviewable CloudHost247 engine; engine_external_* rows in
  -- ai_model_configs govern anything else (fail-closed until configured — spec §37).
  engine varchar(32) NOT NULL DEFAULT 'deterministic',
  model_tier varchar(24) NOT NULL DEFAULT 'native',
  status varchar(16) NOT NULL DEFAULT 'active',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  task_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- automatic: low-risk reads only | standard: medium+ needs approval | strict: everything
  -- beyond reads needs approval.
  approval_policy varchar(16) NOT NULL DEFAULT 'standard',
  risk_level varchar(8) NOT NULL DEFAULT 'low',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_agents_category_check CHECK (category IN (
    'executive','support','infrastructure','security','billing','sales','marketing','customer',
    'knowledge','internal','incident','finops','analytics','copilot'
  )),
  CONSTRAINT ai_agents_status_check CHECK (status IN ('active', 'disabled', 'retired')),
  CONSTRAINT ai_agents_approval_policy_check CHECK (approval_policy IN ('automatic', 'standard', 'strict')),
  CONSTRAINT ai_agents_risk_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'critical'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_slug_unique_idx ON ai_agents (slug);
CREATE INDEX IF NOT EXISTS ai_agents_category_idx ON ai_agents (category, enabled);

-- Versioned configuration history for each agent (spec §18 ai_agent_versions).
CREATE TABLE IF NOT EXISTS ai_agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES ai_agents (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  system_prompt text NULL,
  change_notes text NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_agent_versions_unique UNIQUE (agent_id, version)
);

-- ---------------------------------------------------------------------------------------------
-- 2. Tasks, runs, steps — the observable execution spine.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES ai_agents (id) ON DELETE RESTRICT,
  task_type varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'queued',
  subject_type varchar(48) NULL,
  subject_id uuid NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority varchar(8) NOT NULL DEFAULT 'normal',
  requested_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  -- staff | customer | system | schedule | workflow | board
  requested_by_type varchar(16) NOT NULL DEFAULT 'system',
  -- Customer this task acts for, when any. Drives customer-facing AI activity transparency
  -- (/account/ai) and tenant isolation checks. NULL means platform-wide work.
  customer_id uuid NULL REFERENCES users (id) ON DELETE CASCADE,
  result_summary text NULL,
  result jsonb NULL,
  error_code varchar(64) NULL,
  error_message text NULL,
  -- Idempotent enqueue: the same logical job (event/workflow bucket) can never double-run.
  idempotency_key varchar(160) NULL,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT ai_tasks_status_check CHECK (status IN (
    'queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'
  )),
  CONSTRAINT ai_tasks_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT ai_tasks_requested_by_type_check CHECK (
    requested_by_type IN ('staff', 'customer', 'system', 'schedule', 'workflow', 'board')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_tasks_idempotency_unique_idx
  ON ai_tasks (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_tasks_status_idx ON ai_tasks (status, run_after);
CREATE INDEX IF NOT EXISTS ai_tasks_agent_idx ON ai_tasks (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_tasks_customer_idx ON ai_tasks (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES ai_tasks (id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES ai_agents (id) ON DELETE RESTRICT,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status varchar(20) NOT NULL DEFAULT 'running',
  engine varchar(32) NOT NULL DEFAULT 'deterministic',
  model varchar(80) NOT NULL DEFAULT 'cloudhost247-native',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NULL,
  verification jsonb NULL,
  error_code varchar(64) NULL,
  error_message text NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  duration_ms integer NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT ai_runs_status_check CHECK (status IN ('running', 'succeeded', 'failed', 'awaiting_approval', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS ai_runs_task_idx ON ai_runs (task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_agent_idx ON ai_runs (agent_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES ai_runs (id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  -- Observe → understand → plan → act → verify → report (spec header principle).
  phase varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'completed',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_run_steps_phase_check CHECK (phase IN (
    'observe', 'understand', 'plan', 'authorize', 'act', 'verify', 'report', 'learn'
  )),
  CONSTRAINT ai_run_steps_status_check CHECK (status IN ('completed', 'failed', 'skipped'))
);
CREATE INDEX IF NOT EXISTS ai_run_steps_run_idx ON ai_run_steps (run_id, step_order);

-- ---------------------------------------------------------------------------------------------
-- 3. Tool calls (spec §19). Every action an agent performs is registered, permission-checked,
--    risk-classified, recorded here, and mirrored into ai_audit_logs.
--    arguments/result are REDACTED (no secrets) and truncated by the executor before insert.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NULL REFERENCES ai_runs (id) ON DELETE SET NULL,
  task_id uuid NULL REFERENCES ai_tasks (id) ON DELETE SET NULL,
  agent_id uuid NULL REFERENCES ai_agents (id) ON DELETE SET NULL,
  approval_id uuid NULL,
  tool varchar(64) NOT NULL,
  permission varchar(64) NOT NULL,
  risk_level varchar(8) NOT NULL DEFAULT 'low',
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NULL,
  success boolean NOT NULL DEFAULT false,
  error_code varchar(64) NULL,
  duration_ms integer NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_tool_calls_risk_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'critical'))
);
CREATE INDEX IF NOT EXISTS ai_tool_calls_agent_idx ON ai_tool_calls (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_tool_calls_run_idx ON ai_tool_calls (run_id);
CREATE INDEX IF NOT EXISTS ai_tool_calls_tool_idx ON ai_tool_calls (tool, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 4. Human Decision Inbox (spec §21). A pending approval IS the block: the guarded tool's
--    arguments are sealed here and only executed after a staff/admin decision.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES ai_agents (id) ON DELETE RESTRICT,
  task_id uuid NULL REFERENCES ai_tasks (id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES ai_runs (id) ON DELETE SET NULL,
  tool varchar(64) NOT NULL,
  action varchar(160) NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_level varchar(8) NOT NULL DEFAULT 'high',
  affected_customer_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  affected_resource text NULL,
  -- Sealed tool arguments, executed verbatim on approval. Redaction rules from tool calls apply.
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'pending',
  decision_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  decision_at timestamptz NULL,
  decision_note text NULL,
  expires_at timestamptz NOT NULL,
  executed_at timestamptz NULL,
  execution_result jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_approvals_status_check CHECK (status IN (
    'pending', 'approved', 'rejected', 'expired', 'cancelled', 'executed', 'failed'
  )),
  CONSTRAINT ai_approvals_risk_level_check CHECK (risk_level IN ('medium', 'high', 'critical'))
);
CREATE INDEX IF NOT EXISTS ai_approvals_status_idx ON ai_approvals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_approvals_agent_idx ON ai_approvals (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_approvals_customer_idx
  ON ai_approvals (affected_customer_id, created_at DESC) WHERE affected_customer_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 5. Scoped memory (spec §23). scope + customer_id isolate tenants; unique key upserts keep one
--    value per (scope, tenant, agent, key).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- short | customer | operational | organizational | executive
  scope varchar(16) NOT NULL,
  customer_id uuid NULL REFERENCES users (id) ON DELETE CASCADE,
  agent_slug varchar(64) NULL,
  memory_key varchar(160) NOT NULL,
  value jsonb NOT NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_memories_scope_check CHECK (scope IN (
    'short', 'customer', 'operational', 'organizational', 'executive'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_memories_unique_idx ON ai_memories (
  scope, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(agent_slug, ''), memory_key
);
CREATE INDEX IF NOT EXISTS ai_memories_customer_idx ON ai_memories (customer_id, updated_at DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_memories_expiry_idx ON ai_memories (expires_at) WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 6. Knowledge base / RAG (spec §10, §24). Chunks always carry their source so every AI answer
--    is traceable to a document + version + timestamp.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(255) NOT NULL,
  -- manual | doc | faq | policy | procedure | runbook | resolution
  source_type varchar(16) NOT NULL DEFAULT 'doc',
  uri text NULL,
  version varchar(32) NOT NULL DEFAULT '1',
  status varchar(16) NOT NULL DEFAULT 'active',
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_knowledge_sources_type_check CHECK (
    source_type IN ('manual', 'doc', 'faq', 'policy', 'procedure', 'runbook', 'resolution')
  ),
  CONSTRAINT ai_knowledge_sources_status_check CHECK (status IN ('active', 'retired'))
);

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES ai_knowledge_sources (id) ON DELETE CASCADE,
  chunk_index integer NOT NULL DEFAULT 0,
  title varchar(255) NULL,
  content text NOT NULL,
  keywords text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_knowledge_chunks_content_check CHECK (length(btrim(content)) BETWEEN 1 AND 20000)
);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_source_idx ON ai_knowledge_chunks (source_id, chunk_index);

-- ---------------------------------------------------------------------------------------------
-- 7. Event bus + workflow engine (spec §24, §25). Events are real platform-meaningful signals;
--    workflows create agent tasks in response. No polling loops where events suffice: detection
--    emitters live in the worker sweep, each with a fingerprint dedupe window.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(64) NOT NULL,
  -- platform | detection | webhook | admin | agent
  source varchar(16) NOT NULL DEFAULT 'platform',
  -- Stable dedupe fingerprint (e.g. invoice.overdue:<invoiceId>:<day>) for detector-side
  -- suppression of duplicate emissions inside one window.
  fingerprint varchar(160) NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_events_source_check CHECK (source IN ('platform', 'detection', 'webhook', 'admin', 'agent'))
);
CREATE INDEX IF NOT EXISTS ai_events_unprocessed_idx ON ai_events (occurred_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS ai_events_type_idx ON ai_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_events_fingerprint_idx ON ai_events (fingerprint, occurred_at DESC)
  WHERE fingerprint IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(64) NOT NULL,
  name varchar(120) NOT NULL,
  description text NOT NULL DEFAULT '',
  event_type varchar(64) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- [{ agent_slug, task_type, input_template, subject_from, priority? }] — resolved against the
  -- event payload by src/ai-os/workflows/engine.ts.
  definition jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_workflows_slug_unique_idx ON ai_workflows (slug);
CREATE INDEX IF NOT EXISTS ai_workflows_event_idx ON ai_workflows (event_type, enabled);

CREATE TABLE IF NOT EXISTS ai_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES ai_workflows (id) ON DELETE CASCADE,
  event_id uuid NULL REFERENCES ai_events (id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'running',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT ai_workflow_runs_status_check CHECK (status IN ('running', 'succeeded', 'failed', 'partial'))
);
CREATE INDEX IF NOT EXISTS ai_workflow_runs_workflow_idx ON ai_workflow_runs (workflow_id, started_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 8. Findings — the structured exchange format between agents (spec §27: no agent fabricates
--    another agent's conclusion; findings carry evidence and never conclusions of other agents).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES ai_agents (id) ON DELETE RESTRICT,
  run_id uuid NULL REFERENCES ai_runs (id) ON DELETE SET NULL,
  task_id uuid NULL REFERENCES ai_tasks (id) ON DELETE SET NULL,
  finding_type varchar(64) NOT NULL,
  severity varchar(8) NOT NULL DEFAULT 'info',
  title varchar(255) NOT NULL,
  summary text NOT NULL,
  -- Real rows/queries the finding is grounded in: [{table, id?, description}].
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject_type varchar(48) NULL,
  subject_id uuid NULL,
  recommendation text NULL,
  status varchar(12) NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_findings_severity_check CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  CONSTRAINT ai_findings_status_check CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed'))
);
CREATE INDEX IF NOT EXISTS ai_findings_agent_idx ON ai_findings (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_findings_status_idx ON ai_findings (status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_findings_subject_idx ON ai_findings (subject_type, subject_id);

-- ---------------------------------------------------------------------------------------------
-- 9. Immutable AI audit trail (spec §22). Append-only; application code never updates/deletes.
--    Redaction happens before insert (no secrets/tokens/passwords — spec §22 footer).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NULL REFERENCES ai_agents (id) ON DELETE SET NULL,
  user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  task_id uuid NULL REFERENCES ai_tasks (id) ON DELETE SET NULL,
  run_id uuid NULL REFERENCES ai_runs (id) ON DELETE SET NULL,
  approval_id uuid NULL REFERENCES ai_approvals (id) ON DELETE SET NULL,
  action varchar(120) NOT NULL,
  tool varchar(64) NULL,
  arguments jsonb NULL,
  result jsonb NULL,
  decision varchar(16) NULL,
  model varchar(80) NULL,
  status varchar(16) NOT NULL DEFAULT 'ok',
  risk_level varchar(8) NULL,
  duration_ms integer NULL,
  error_code varchar(64) NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_audit_logs_status_check CHECK (status IN ('ok', 'denied', 'error', 'pending_approval')),
  CONSTRAINT ai_audit_logs_risk_level_check CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT ai_audit_logs_decision_check CHECK (decision IS NULL OR decision IN ('approved', 'rejected', 'expired', 'auto', 'blocked'))
);
CREATE INDEX IF NOT EXISTS ai_audit_logs_created_idx ON ai_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_audit_logs_agent_idx ON ai_audit_logs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_audit_logs_action_idx ON ai_audit_logs (action, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 10. Evaluations (spec §31) — measurable per-agent quality/safety counters, including staff
--     feedback and hallucination reports.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES ai_agents (id) ON DELETE CASCADE,
  run_id uuid NULL REFERENCES ai_runs (id) ON DELETE SET NULL,
  -- resolution_rate | escalation_accuracy | detection_accuracy | answer_accuracy |
  -- false_positive | hallucination_report | rating | task_completion | override | custom
  metric varchar(40) NOT NULL,
  value numeric(10, 3) NOT NULL,
  rater_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_evaluations_agent_idx ON ai_evaluations (agent_id, metric, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 11. Model router configs (spec §28). The native deterministic engine is always available.
--     External engines are seeded DISABLED/unconfigured: any resolution attempt fails closed
--     with CONFIGURATION_REQUIRED (spec §37). API keys never live here — only connection
--     metadata; credentials stay in environment variables when an engine is enabled.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine varchar(32) NOT NULL,
  provider varchar(48) NULL,
  model varchar(80) NULL,
  endpoint text NULL,
  enabled boolean NOT NULL DEFAULT false,
  -- non-secret metadata only (latency/cost class, max context, purposes)
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_model_configs_engine_lowercase CHECK (engine = lower(engine))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_configs_engine_unique_idx ON ai_model_configs (engine);

-- ---------------------------------------------------------------------------------------------
-- 12. AI incidents (spec §13) — incidents raised/managed by the Incident Commander, correlated
--     from real findings and events.
-- ---------------------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS ai_incident_number_seq;

CREATE TABLE IF NOT EXISTS ai_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number varchar(32) NOT NULL DEFAULT ('AI-' || lpad(nextval('ai_incident_number_seq')::text, 8, '0')),
  severity varchar(8) NOT NULL DEFAULT 'medium',
  title varchar(255) NOT NULL,
  summary text NOT NULL DEFAULT '',
  -- affected services/customers/resources: real references, never narrative claims.
  affected jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(14) NOT NULL DEFAULT 'open',
  commander_agent_id uuid NULL REFERENCES ai_agents (id) ON DELETE SET NULL,
  opened_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  opened_by_type varchar(16) NOT NULL DEFAULT 'agent',
  timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_incidents_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT ai_incidents_status_check CHECK (status IN ('open', 'investigating', 'mitigated', 'resolved')),
  CONSTRAINT ai_incidents_opened_by_type_check CHECK (opened_by_type IN ('agent', 'staff', 'system'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_incidents_number_unique_idx ON ai_incidents (incident_number);
CREATE INDEX IF NOT EXISTS ai_incidents_status_idx ON ai_incidents (status, severity, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 13. Executive reports (spec §26) — daily/weekly/monthly briefings. One final report per
--     (type, period) — idempotent regeneration returns the existing report.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_executive_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type varchar(8) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by_agent_id uuid NULL REFERENCES ai_agents (id) ON DELETE SET NULL,
  status varchar(10) NOT NULL DEFAULT 'final',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_executive_reports_type_check CHECK (report_type IN ('daily', 'weekly', 'monthly', 'adhoc')),
  CONSTRAINT ai_executive_reports_status_check CHECK (status IN ('draft', 'final'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_executive_reports_period_unique_idx
  ON ai_executive_reports (report_type, period_start, period_end) WHERE status = 'final';
