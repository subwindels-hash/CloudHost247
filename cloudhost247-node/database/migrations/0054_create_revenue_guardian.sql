-- Migration: 0054_create_revenue_guardian.sql
-- Purpose: Revenue Guardian — a revenue-recovery *management layer* on top of the existing
-- CloudHost247 billing engine (invoices / payments / billing_ledger / orders / subscriptions /
-- customer_services / customer_domains). No billing table is duplicated here: every table below
-- references the existing entities by foreign key and stores only recovery-workflow state that
-- has no existing home (cases, follow-ups, payment promises, staff assignments, automation rules
-- and their execution history, and the module's own activity/communication logs).
--
-- Monetary amounts follow the platform-wide invariant (src/lib/money.ts): non-negative
-- magnitudes in numeric(12,2); direction is carried by the column meaning, never by sign.
-- Financial truth ALWAYS remains the billing_ledger — amounts cached on a recovery case
-- (amount_outstanding / amount_recovered) are recomputed from the ledger by
-- src/revenue-guardian/services/case-service.ts and are never authoritative on their own.

-- ---------------------------------------------------------------------------------------------
-- 1. Recovery cases — the central unit of recovery work (spec §34).
-- ---------------------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS revenue_guardian_case_number_seq;

CREATE TABLE IF NOT EXISTS revenue_guardian_recovery_cases (
  id uuid PRIMARY KEY,
  case_number varchar(32) NOT NULL DEFAULT ('RG-' || lpad(nextval('revenue_guardian_case_number_seq')::text, 8, '0')),
  customer_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  invoice_id uuid NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  order_id uuid NULL REFERENCES orders (id) ON DELETE RESTRICT,
  service_id uuid NULL REFERENCES customer_services (id) ON DELETE SET NULL,
  domain_id uuid NULL REFERENCES customer_domains (id) ON DELETE SET NULL,
  subscription_id uuid NULL REFERENCES subscriptions (id) ON DELETE SET NULL,
  assigned_staff_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  status varchar(24) NOT NULL DEFAULT 'new',
  priority varchar(8) NOT NULL DEFAULT 'normal',
  risk_level varchar(8) NOT NULL DEFAULT 'medium',
  risk_score integer NOT NULL DEFAULT 0,
  -- Human-readable reasons behind risk_score/risk_level (spec §4 "traceable to actual stored
  -- data"): a JSON array of strings, recomputed together with the score, never free-typed.
  risk_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalation_level integer NOT NULL DEFAULT 0,
  -- Where the case came from: 'manual' or 'automation:<job_name>' — part of auditability.
  source varchar(64) NOT NULL DEFAULT 'manual',
  currency char(3) NOT NULL DEFAULT 'USD',
  amount_at_risk numeric(12, 2) NOT NULL DEFAULT 0,
  amount_outstanding numeric(12, 2) NOT NULL DEFAULT 0,
  amount_recovered numeric(12, 2) NOT NULL DEFAULT 0,
  dispute_reason text NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_contact_at timestamptz NULL,
  next_follow_up_at timestamptz NULL,
  closed_at timestamptz NULL,
  closed_reason text NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rg_cases_status_check CHECK (status IN (
    'new', 'contact_required', 'contacted', 'awaiting_customer', 'payment_promised',
    'payment_pending', 'partially_recovered', 'recovered', 'escalated', 'disputed',
    'closed', 'written_off'
  )),
  CONSTRAINT rg_cases_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT rg_cases_risk_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT rg_cases_amounts_check CHECK (
    amount_at_risk >= 0 AND amount_outstanding >= 0 AND amount_recovered >= 0
  ),
  CONSTRAINT rg_cases_currency_upper_check CHECK (currency = upper(currency))
);

CREATE UNIQUE INDEX IF NOT EXISTS rg_cases_case_number_unique_idx
  ON revenue_guardian_recovery_cases (case_number);
-- Idempotency backbone for the overdue-invoice automation (spec §50): at most ONE open case per
-- invoice, enforced by the database itself so two overlapping job runs can never double-create.
CREATE UNIQUE INDEX IF NOT EXISTS rg_cases_open_invoice_unique_idx
  ON revenue_guardian_recovery_cases (invoice_id)
  WHERE invoice_id IS NOT NULL AND closed_at IS NULL;
CREATE INDEX IF NOT EXISTS rg_cases_customer_idx ON revenue_guardian_recovery_cases (customer_id);
CREATE INDEX IF NOT EXISTS rg_cases_staff_idx ON revenue_guardian_recovery_cases (assigned_staff_id);
CREATE INDEX IF NOT EXISTS rg_cases_status_idx ON revenue_guardian_recovery_cases (status);
CREATE INDEX IF NOT EXISTS rg_cases_risk_idx ON revenue_guardian_recovery_cases (risk_level, status);
CREATE INDEX IF NOT EXISTS rg_cases_follow_up_due_idx ON revenue_guardian_recovery_cases (next_follow_up_at)
  WHERE closed_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 2. Follow-ups (spec §9, §35). "overdue" is DERIVED at query time (status='pending' AND
--    scheduled_at < now()) — never swept into a stored status that could go stale.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_guardian_follow_ups (
  id uuid PRIMARY KEY,
  case_id uuid NULL REFERENCES revenue_guardian_recovery_cases (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invoice_id uuid NULL REFERENCES invoices (id) ON DELETE SET NULL,
  service_id uuid NULL REFERENCES customer_services (id) ON DELETE SET NULL,
  assigned_staff_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  type varchar(32) NOT NULL,
  priority varchar(8) NOT NULL DEFAULT 'normal',
  status varchar(16) NOT NULL DEFAULT 'pending',
  channel varchar(16) NOT NULL DEFAULT 'email',
  scheduled_at timestamptz NOT NULL,
  snoozed_until timestamptz NULL,
  completed_at timestamptz NULL,
  outcome text NULL,
  notes text NULL,
  -- Deterministic key for automation-created follow-ups (spec §50): e.g.
  -- 'overdue-followup:<invoice_id>' — the DB rejects the duplicate, the job skips it.
  dedupe_key varchar(160) NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rg_follow_ups_type_check CHECK (type IN (
    'payment_reminder', 'invoice_due', 'invoice_overdue', 'renewal_reminder',
    'expiration_reminder', 'pre_suspension', 'pre_termination', 'failed_payment',
    'payment_promise', 'customer_check_in', 'escalation', 'custom'
  )),
  CONSTRAINT rg_follow_ups_status_check CHECK (status IN (
    'pending', 'in_progress', 'completed', 'snoozed', 'cancelled'
  )),
  CONSTRAINT rg_follow_ups_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT rg_follow_ups_channel_check CHECK (channel IN (
    'email', 'phone', 'whatsapp', 'sms', 'in_person', 'other'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS rg_follow_ups_dedupe_unique_idx
  ON revenue_guardian_follow_ups (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS rg_follow_ups_case_idx ON revenue_guardian_follow_ups (case_id);
CREATE INDEX IF NOT EXISTS rg_follow_ups_customer_idx ON revenue_guardian_follow_ups (customer_id);
CREATE INDEX IF NOT EXISTS rg_follow_ups_staff_due_idx
  ON revenue_guardian_follow_ups (assigned_staff_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS rg_follow_ups_due_idx ON revenue_guardian_follow_ups (scheduled_at)
  WHERE status IN ('pending', 'snoozed');

-- ---------------------------------------------------------------------------------------------
-- 3. Payment promises (spec §10, §36). Fulfillment is decided ONLY by comparing the promise to
--    billing_ledger 'payment' entries recorded after the promise was made — never by a button.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_guardian_payment_promises (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  case_id uuid NULL REFERENCES revenue_guardian_recovery_cases (id) ON DELETE SET NULL,
  promised_amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  promised_date date NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  fulfilled_amount numeric(12, 2) NOT NULL DEFAULT 0,
  fulfilled_at timestamptz NULL,
  broken_at timestamptz NULL,
  payment_reference varchar(255) NULL,
  assigned_staff_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rg_promises_status_check CHECK (status IN (
    'pending', 'fulfilled', 'partially_fulfilled', 'broken', 'cancelled'
  )),
  CONSTRAINT rg_promises_amount_check CHECK (promised_amount > 0 AND fulfilled_amount >= 0),
  CONSTRAINT rg_promises_currency_upper_check CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS rg_promises_customer_idx ON revenue_guardian_payment_promises (customer_id);
CREATE INDEX IF NOT EXISTS rg_promises_invoice_idx ON revenue_guardian_payment_promises (invoice_id);
CREATE INDEX IF NOT EXISTS rg_promises_due_idx ON revenue_guardian_payment_promises (promised_date)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS rg_promises_staff_idx ON revenue_guardian_payment_promises (assigned_staff_id);

-- ---------------------------------------------------------------------------------------------
-- 4. Customer ↔ staff assignments (spec §5–§6, §37). One ACTIVE assignment per customer per
--    assignment_type; reassignment ends the old row (ended_at) and inserts a new one, preserving
--    full ownership history.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_guardian_assignments (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assignment_type varchar(24) NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  assigned_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  ended_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  reason text NULL,
  -- 'manual' or 'rule:<rule_id>' — which path created this assignment.
  source varchar(64) NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rg_assignments_type_check CHECK (assignment_type IN (
    'account_manager', 'sales_rep', 'collections', 'customer_success'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS rg_assignments_active_unique_idx
  ON revenue_guardian_assignments (customer_id, assignment_type)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS rg_assignments_staff_idx ON revenue_guardian_assignments (staff_user_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS rg_assignments_customer_idx ON revenue_guardian_assignments (customer_id);

-- ---------------------------------------------------------------------------------------------
-- 5. Automatic assignment rules (spec §5): declarative conditions, validated by a zod schema in
--    src/revenue-guardian/rules/assignment-rules.ts. NEVER executable code (spec §38).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_guardian_assignment_rules (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL,
  description text NULL,
  conditions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  staff_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  assignment_type varchar(24) NOT NULL DEFAULT 'account_manager',
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rg_assignment_rules_type_check CHECK (assignment_type IN (
    'account_manager', 'sales_rep', 'collections', 'customer_success'
  ))
);

CREATE INDEX IF NOT EXISTS rg_assignment_rules_enabled_idx
  ON revenue_guardian_assignment_rules (enabled, priority);

-- ---------------------------------------------------------------------------------------------
-- 6. Automation rules (spec §18, §38): admin-tunable overrides for the built-in automation jobs.
--    conditions_json / actions_json use the validated schema in rules/automation-rules.ts.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_guardian_automation_rules (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL,
  description text NULL,
  event_type varchar(48) NOT NULL,
  conditions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  last_run_at timestamptz NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rg_automation_rules_event_check CHECK (event_type IN (
    'invoice_upcoming', 'invoice_overdue', 'payment_failed', 'renewal_upcoming',
    'service_expiring', 'pre_suspension', 'pre_termination', 'promise_due', 'promise_broken'
  ))
);

CREATE INDEX IF NOT EXISTS rg_automation_rules_event_idx
  ON revenue_guardian_automation_rules (event_type, enabled, priority);

-- ---------------------------------------------------------------------------------------------
-- 7. Automation run history + concurrency lock (spec §19–§21, §50). run_key is UNIQUE: a
--    scheduled run claims `<job>:<schedule bucket>` and a second overlapping worker's INSERT
--    simply conflicts — the database is the lock, no advisory-lock daemon required.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_guardian_automation_runs (
  id uuid PRIMARY KEY,
  job_name varchar(64) NOT NULL,
  run_key varchar(160) NOT NULL,
  trigger varchar(16) NOT NULL DEFAULT 'schedule',
  triggered_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  duration_ms integer NULL,
  processed_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  notifications_sent integer NOT NULL DEFAULT 0,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rg_runs_status_check CHECK (status IN ('running', 'completed', 'failed')),
  CONSTRAINT rg_runs_trigger_check CHECK (trigger IN ('schedule', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS rg_runs_run_key_unique_idx
  ON revenue_guardian_automation_runs (run_key);
CREATE INDEX IF NOT EXISTS rg_runs_job_idx ON revenue_guardian_automation_runs (job_name, started_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 8. Module activity log (spec §39): append-only record of every recovery decision/action.
--    Complements (does not replace) the platform-wide audit_logs, which continues to receive
--    privileged-action entries via src/lib/audit.ts.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_guardian_activity_log (
  id uuid PRIMARY KEY,
  customer_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  case_id uuid NULL REFERENCES revenue_guardian_recovery_cases (id) ON DELETE SET NULL,
  invoice_id uuid NULL REFERENCES invoices (id) ON DELETE SET NULL,
  follow_up_id uuid NULL REFERENCES revenue_guardian_follow_ups (id) ON DELETE SET NULL,
  promise_id uuid NULL REFERENCES revenue_guardian_payment_promises (id) ON DELETE SET NULL,
  actor_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  actor_type varchar(16) NOT NULL DEFAULT 'staff',
  event_type varchar(48) NOT NULL,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rg_activity_actor_type_check CHECK (actor_type IN ('staff', 'system', 'customer'))
);

CREATE INDEX IF NOT EXISTS rg_activity_customer_idx ON revenue_guardian_activity_log (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rg_activity_case_idx ON revenue_guardian_activity_log (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rg_activity_event_idx ON revenue_guardian_activity_log (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS rg_activity_created_idx ON revenue_guardian_activity_log (created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 9. Communication log (spec §40, §22–§23). Email delivery itself rides the EXISTING
--    user_notifications + notification_outbox pipeline (one SMTP engine, spec §78); this table
--    records which Revenue Guardian communication was queued for whom, with a deterministic
--    dedupe_key so a re-run job can never queue the same reminder twice (spec §50, §75).
--    status honestly tracks the outbox: 'queued' until the outbox sweep reports otherwise —
--    never 'sent' merely because a row was inserted (spec §40, §63).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_guardian_communication_log (
  id uuid PRIMARY KEY,
  customer_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  case_id uuid NULL REFERENCES revenue_guardian_recovery_cases (id) ON DELETE SET NULL,
  invoice_id uuid NULL REFERENCES invoices (id) ON DELETE SET NULL,
  channel varchar(16) NOT NULL DEFAULT 'email',
  recipient varchar(255) NOT NULL,
  template_key varchar(64) NOT NULL,
  subject varchar(255) NOT NULL,
  body text NULL,
  provider varchar(32) NULL,
  provider_message_id varchar(255) NULL,
  status varchar(32) NOT NULL DEFAULT 'queued',
  failure_reason text NULL,
  -- Links the email copy to the platform notification pipeline for honest status reads.
  notification_id uuid NULL,
  dedupe_key varchar(160) NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  CONSTRAINT rg_comm_channel_check CHECK (channel IN ('email', 'whatsapp')),
  CONSTRAINT rg_comm_status_check CHECK (status IN (
    'queued', 'sent', 'delivered', 'failed', 'configuration_required', 'suppressed'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS rg_comm_dedupe_unique_idx
  ON revenue_guardian_communication_log (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS rg_comm_customer_idx ON revenue_guardian_communication_log (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rg_comm_status_idx ON revenue_guardian_communication_log (status, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 10. Supporting indexes on EXISTING billing tables for the recovery queries this module runs
--     constantly (spec §59). Additive only — no existing migration is touched.
-- ---------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS invoices_due_date_idx ON invoices (due_date);
CREATE INDEX IF NOT EXISTS invoices_status_due_date_idx ON invoices (status, due_date);
CREATE INDEX IF NOT EXISTS customer_domains_expires_at_idx ON customer_domains (expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_user_status_idx ON payments (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_ledger_invoice_type_idx ON billing_ledger (invoice_id, entry_type);

-- ---------------------------------------------------------------------------------------------
-- 11. Module settings (spec §69), stored in the EXISTING platform_settings table — no second
--     settings system. All thresholds/windows are admin-configurable, never hard-coded.
-- ---------------------------------------------------------------------------------------------
INSERT INTO platform_settings (key, value, description) VALUES
  ('revenue_guardian.enabled', 'true', 'Master switch for the Revenue Guardian module'),
  ('revenue_guardian.timezone', '"UTC"', 'Timezone used by Revenue Guardian scheduling and reporting'),
  ('revenue_guardian.reporting_currency', '"USD"', 'Currency used for Revenue Guardian cross-currency report labels (native amounts are always shown; no silent conversion)'),
  ('revenue_guardian.overdue_threshold_days', '1', 'Days past invoice due date before a recovery case is opened automatically'),
  ('revenue_guardian.upcoming_invoice_reminder_days', '[7, 3, 1]', 'Days before invoice due date at which payment reminders are queued'),
  ('revenue_guardian.overdue_followup_days', '3', 'Days overdue at which a staff follow-up task is auto-created'),
  ('revenue_guardian.renewal_reminder_days', '[60, 30, 14, 7, 3, 1, 0]', 'Days before subscription/domain expiry at which renewal reminders fire'),
  ('revenue_guardian.pre_suspension_alert_days', '5', 'Days before projected suspension at which an urgent recovery task is created'),
  ('revenue_guardian.pre_termination_alert_days', '7', 'Days before projected termination at which an escalation is created'),
  ('revenue_guardian.terminate_after_suspension_days', '30', 'Days a suspended subscription is held before projected termination'),
  ('revenue_guardian.risk_thresholds', '{"medium": 25, "high": 50, "critical": 75}', 'Risk score boundaries (0-100) for medium/high/critical'),
  ('revenue_guardian.high_value_thresholds', '{"lifetimeRevenue": 1000, "recurringRevenue": 100, "activeServices": 3}', 'Any threshold met qualifies a customer as high-value'),
  ('revenue_guardian.aging_buckets', '[7, 30, 60, 90]', 'Upper day-bounds of overdue aging buckets (last bucket is open-ended)'),
  ('revenue_guardian.escalation_levels', '[{"level": 1, "overdueDays": 7}, {"level": 2, "overdueDays": 21}, {"level": 3, "overdueDays": 45}, {"level": 4, "overdueDays": 90}]', 'Escalation ladder by days overdue'),
  ('revenue_guardian.scheduler_interval_minutes', '60', 'How often the worker runs the Revenue Guardian automation cycle'),
  ('revenue_guardian.whatsapp', '{"enabled": false, "provider": null}', 'Optional WhatsApp notification provider configuration (fail-closed when absent)'),
  ('revenue_guardian.email_templates', '{}', 'Admin overrides for Revenue Guardian email templates (defaults live in code)')
ON CONFLICT (key) DO NOTHING;
