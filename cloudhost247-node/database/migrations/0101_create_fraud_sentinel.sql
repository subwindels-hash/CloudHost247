-- Migration: 0101_create_fraud_sentinel.sql
-- Purpose: WINDELS FRAUD SENTINEL AI — an advisory fraud-detection and risk-intelligence layer on
-- top of the data CloudHost247 ALREADY records.
--
-- Design constraints honoured here (see docs/FRAUD_SENTINEL.md):
--
--   * ADDITIVE ONLY. This file creates new relations and inserts new platform_settings keys. It
--     contains no ALTER TABLE, no DROP, no UPDATE and no DELETE against any pre-existing table, so
--     no existing payment, billing, auth or customer workflow can regress and the whole module can
--     be removed by dropping exactly the objects it created (documented rollback below).
--   * NO DUPLICATED SYSTEMS. Authorization stays `users.role` re-read from the DB on every request
--     (src/lib/require-role.ts) mapped through a named permission vocabulary
--     (src/fraud-sentinel/permissions.ts) — the Revenue Guardian pattern, not a second RBAC engine.
--     Settings live in the EXISTING platform_settings table. Privileged actions are written to the
--     EXISTING audit_logs table via src/lib/audit.ts. Reviewer notifications ride the EXISTING
--     user_notifications + notification_outbox pipeline. Jobs run in the EXISTING worker loop with
--     the same run_key locking discipline as revenue_guardian_automation_runs.
--   * NO FINANCIAL WRITES, EVER. Nothing in this module can approve/reject a payment, issue a
--     refund, move money, change a balance, change an entitlement, or suspend an account. The
--     module's only writes are to the fraud_sentinel_* tables below (plus audit_logs,
--     user_notifications/notification_outbox and platform_settings for its own configuration).
--     `payments`, `invoices`, `billing_ledger`, `orders`, `subscriptions` and `customer_services`
--     are READ-ONLY inputs.
--   * NO SECRETS IN EVIDENCE. Evidence columns store references to real rows plus a redacted,
--     whitelisted projection of them. Full card numbers, passwords, password hashes, JWTs, refresh
--     tokens, MFA secrets, passkey credentials, API keys and private keys are never copied here;
--     src/fraud-sentinel/utils/redaction.ts enforces that for anything built in application code
--     and the ingestion SQL only ever projects an explicit column whitelist.
--   * MONEY CONVENTION. Amounts follow src/lib/money.ts: non-negative numeric(12,2) magnitudes;
--     direction is carried by the column/entry meaning, never by sign.
--   * REPRODUCIBILITY. Every assessment stores the rule versions, the exact weights used, the
--     evidence references, the scoring-engine version and the rule-set fingerprint, so any score can
--     be recomputed from stored data. Rule changes are append-only auditable rows.
--
-- ROLLBACK STRATEGY (forward-only runner — database/migrate.ts has no `down`):
--   The runner is deliberately forward-only and checksummed. Because this migration is additive and
--   self-contained, the reviewed rollback is a single explicit script, run by an operator, that
--   drops only the objects created here, in dependency order:
--
--     DROP TABLE IF EXISTS fraud_sentinel_false_positives;
--     DROP TABLE IF EXISTS fraud_sentinel_investigations;
--     DROP TABLE IF EXISTS fraud_sentinel_alerts;
--     DROP TABLE IF EXISTS fraud_sentinel_risk_history;
--     DROP TABLE IF EXISTS fraud_sentinel_assessments;
--     DROP TABLE IF EXISTS fraud_sentinel_rule_history;
--     DROP TABLE IF EXISTS fraud_sentinel_rules;
--     DROP TABLE IF EXISTS fraud_sentinel_runs;
--     DROP TABLE IF EXISTS fraud_sentinel_events;
--     DROP SEQUENCE IF EXISTS fraud_sentinel_alert_number_seq;
--     DELETE FROM platform_settings WHERE key LIKE 'fraud_sentinel.%';
--     DELETE FROM schema_migrations WHERE version = '0101';
--
--   That script is NOT part of this file and is never executed by the application: dropping tables
--   is a destructive operation and requires separate explicit authorization. It is recorded here so
--   the rollback path is reviewed and reproducible rather than improvised. Dropping the module
--   leaves every pre-existing table byte-identical.
--
-- Runs inside the migration runner's own transaction — do NOT add BEGIN/COMMIT here.

-- ---------------------------------------------------------------------------------------------
-- 1. Detection event ledger.
--    A normalized, redacted, IDEMPOTENT projection of the rows CloudHost247 already records
--    (payments, invoices, orders, billing_ledger, auth_audit_log, audit_logs, webhook_events,
--    customer_services, provisioning_jobs, admin_support_sessions, tool_abuse_events).
--
--    `dedupe_key` is the idempotency backbone: it is `<source_table>:<source_id>:<observable state>`,
--    so ingesting the same source row in the same state twice inserts nothing, while a genuine state
--    change (a payment moving pending → failed) is a NEW observable event and gets its own row.
--    The unique index makes that a database guarantee rather than application discipline, so two
--    overlapping worker runs can never double-count an event.
--
--    No column here can hold a card number, password or token: the projection is a fixed whitelist
--    and free text is passed through a PAN/secret scrub at ingestion time.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_sentinel_events (
  id uuid PRIMARY KEY,
  dedupe_key varchar(200) NOT NULL,
  source_table varchar(48) NOT NULL,
  source_id varchar(64) NOT NULL,
  -- The source row's own event/status vocabulary, verbatim (e.g. 'failed', 'login_failure',
  -- 'rejected', 'charge'). Never invented, never normalized away — evidence must be traceable.
  source_event_type varchar(64) NOT NULL,
  category varchar(24) NOT NULL,
  subject_type varchar(24) NOT NULL,
  subject_id uuid NULL,
  customer_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  actor_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  order_id uuid NULL REFERENCES orders (id) ON DELETE SET NULL,
  invoice_id uuid NULL REFERENCES invoices (id) ON DELETE SET NULL,
  payment_id uuid NULL REFERENCES payments (id) ON DELETE SET NULL,
  service_id uuid NULL REFERENCES customer_services (id) ON DELETE SET NULL,
  ip_address varchar(64) NULL,
  ip_country_code char(2) NULL,
  -- Coarse, non-identifying client classification produced by the platform's own
  -- src/visitor-intelligence/geo.ts (browser family + OS family), never a raw user-agent copy:
  -- the raw string stays in auth_audit_log where it already lives and is already access-controlled.
  client_family varchar(64) NULL,
  -- Non-uuid subject label: a webhook gateway name, a tool slug, or a provider key. `subject_id` is
  -- a uuid because customer and actor subjects are users; gateway subjects are not, and forcing a
  -- gateway name into a uuid column would be a lie. Indexed below for the gateway scan.
  channel varchar(64) NULL,
  amount numeric(12, 2) NULL,
  currency char(3) NULL,
  occurred_at timestamptz NOT NULL,
  -- Redacted, whitelisted projection of the source row plus its provenance. Scrubbed of
  -- digit runs that could be a PAN and of any secret-shaped key.
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fs_events_category_check CHECK (
    category IN ('payment', 'account_security', 'order_service', 'admin_api')
  ),
  CONSTRAINT fs_events_subject_type_check CHECK (
    subject_type IN ('customer', 'ip', 'actor', 'gateway')
  ),
  CONSTRAINT fs_events_amount_check CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT fs_events_currency_upper_check CHECK (currency IS NULL OR currency = upper(currency)),
  CONSTRAINT fs_events_country_code_check CHECK (
    ip_country_code IS NULL OR ip_country_code ~ '^[A-Z]{2}$'
  ),
  CONSTRAINT fs_events_occurred_not_future_check CHECK (occurred_at < now() + interval '1 day')
);

CREATE UNIQUE INDEX IF NOT EXISTS fs_events_dedupe_unique_idx ON fraud_sentinel_events (dedupe_key);
CREATE INDEX IF NOT EXISTS fs_events_customer_time_idx
  ON fraud_sentinel_events (customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS fs_events_subject_time_idx
  ON fraud_sentinel_events (subject_type, subject_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS fs_events_category_time_idx
  ON fraud_sentinel_events (category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS fs_events_source_event_time_idx
  ON fraud_sentinel_events (source_event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS fs_events_ip_time_idx
  ON fraud_sentinel_events (ip_address, occurred_at DESC);
CREATE INDEX IF NOT EXISTS fs_events_occurred_idx ON fraud_sentinel_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS fs_events_source_idx ON fraud_sentinel_events (source_table, source_id);
CREATE INDEX IF NOT EXISTS fs_events_channel_idx
  ON fraud_sentinel_events (channel, occurred_at DESC) WHERE channel IS NOT NULL;
-- Retention sweep (fraud_sentinel.retention_event_days) deletes oldest-first.
CREATE INDEX IF NOT EXISTS fs_events_ingested_idx ON fraud_sentinel_events (ingested_at);

-- ---------------------------------------------------------------------------------------------
-- 2. Detection rules — the configurable, versioned rule set.
--    Seeded below with the reviewed defaults from src/fraud-sentinel/rules/catalogue.ts. The code
--    catalogue and these seed rows are asserted to match by
--    tests/integration/fraud-sentinel-migration.test.ts, so they cannot silently drift.
--
--    `weight` is the rule's maximum contribution to the raw score; `family` groups correlated rules
--    whose combined contribution is capped by fraud_sentinel.family_caps — that cap is the mechanism
--    that stops one underlying incident being counted five times.
--    Changing a weight/threshold is a scoring-rule change: super_admin only, and every change writes
--    an append-only fraud_sentinel_rule_history row (below) plus an audit_logs entry.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_sentinel_rules (
  id uuid PRIMARY KEY,
  code varchar(48) NOT NULL,
  name varchar(160) NOT NULL,
  description text NOT NULL,
  category varchar(24) NOT NULL,
  family varchar(48) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  weight integer NOT NULL DEFAULT 10,
  severity varchar(8) NOT NULL DEFAULT 'medium',
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text NOT NULL DEFAULT '',
  -- The real tables this rule reads. Documentation and honesty aid: a rule may not claim a data
  -- source it does not use.
  data_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The subject types this rule applies to, so a customer scan never evaluates an IP-only rule.
  applies_to jsonb NOT NULL DEFAULT '["customer"]'::jsonb,
  updated_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fs_rules_category_check CHECK (
    category IN ('payment', 'account_security', 'order_service', 'admin_api')
  ),
  CONSTRAINT fs_rules_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT fs_rules_weight_check CHECK (weight BETWEEN 0 AND 100),
  CONSTRAINT fs_rules_version_check CHECK (version >= 1),
  CONSTRAINT fs_rules_code_format_check CHECK (code ~ '^[A-Z][A-Z0-9_]{2,47}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS fs_rules_code_unique_idx ON fraud_sentinel_rules (code);
CREATE INDEX IF NOT EXISTS fs_rules_category_idx ON fraud_sentinel_rules (category, enabled);
CREATE INDEX IF NOT EXISTS fs_rules_family_idx ON fraud_sentinel_rules (family);

-- ---------------------------------------------------------------------------------------------
-- 3. Rule change history — append-only. "Changes to scoring rules must be auditable."
--    `snapshot` is the full rule row after the change, so the exact weights/parameters in force at
--    any past assessment can be reconstructed and a score re-derived.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_sentinel_rule_history (
  id uuid PRIMARY KEY,
  rule_id uuid NOT NULL REFERENCES fraud_sentinel_rules (id) ON DELETE CASCADE,
  code varchar(48) NOT NULL,
  version integer NOT NULL,
  change_type varchar(16) NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fs_rule_history_change_type_check CHECK (
    change_type IN ('created', 'updated', 'enabled', 'disabled', 'parameters_changed', 'reseeded')
  )
);

CREATE INDEX IF NOT EXISTS fs_rule_history_rule_idx
  ON fraud_sentinel_rule_history (rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fs_rule_history_code_idx
  ON fraud_sentinel_rule_history (code, created_at DESC);
CREATE INDEX IF NOT EXISTS fs_rule_history_created_idx
  ON fraud_sentinel_rule_history (created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 4. Assessments — one reproducible risk evaluation of one subject at one instant.
--    Assessments are never updated after creation except to be marked 'superseded' by a newer one
--    for the same subject; the numbers themselves are immutable so a past score always means what it
--    said it meant.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_sentinel_assessments (
  id uuid PRIMARY KEY,
  subject_type varchar(24) NOT NULL,
  subject_id uuid NULL,
  -- Literal identity for subjects that are not a uuid row: the IP address for `ip` subjects, the
  -- gateway name for `gateway` subjects. NULL for customer/actor subjects, which are identified by
  -- subject_id / customer_id. The two columns are mutually exclusive by subject_type.
  subject_label varchar(64) NULL,
  customer_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  risk_score integer NOT NULL,
  risk_level varchar(8) NOT NULL,
  previous_score integer NULL,
  previous_level varchar(8) NULL,
  previous_assessment_id uuid NULL REFERENCES fraud_sentinel_assessments (id) ON DELETE SET NULL,
  -- [{code, version, weight, family, cappedWeight, severity, reasonCode, reason, confidence,
  --   evidence:[{table,id,description,occurredAt}]}] — the complete derivation of the score.
  triggered_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{family, raw, capped, cap}] — per-family totals, so the score breakdown stays readable after an
  -- administrator retunes the caps. The cap is stored with the assessment for the same reason the
  -- weight is stored per rule: the derivation must not depend on today's configuration.
  family_contributions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Deduplicated evidence across all triggered rules, each entry pointing at a real row.
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence varchar(8) NOT NULL DEFAULT 'low',
  -- Honest data-quality gaps: [{code, severity, detail}] e.g. NO_LOGIN_BASELINE, GEO_UNAVAILABLE,
  -- EVENT_BATCH_LIMIT_REACHED. A score computed on thin data says so.
  data_quality jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- sha256 fingerprint (first 16 hex chars) of the enabled rule set with its weights/versions at
  -- assessment time. Two assessments with the same fingerprint used the same scoring inputs.
  rule_set_version varchar(64) NOT NULL,
  scoring_version integer NOT NULL DEFAULT 1,
  window_started_at timestamptz NOT NULL,
  window_ended_at timestamptz NOT NULL,
  events_examined integer NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'active',
  -- Optional AI-assisted narrative. ALWAYS a summary of the stored evidence above; it can never
  -- change risk_score/risk_level/triggered_rules, and it is flagged so the UI can label it as
  -- assistant output rather than a verified finding. Null unless an engine is explicitly enabled.
  ai_summary text NULL,
  ai_assisted boolean NOT NULL DEFAULT false,
  ai_engine varchar(48) NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fs_assessments_subject_type_check CHECK (
    subject_type IN ('customer', 'ip', 'actor', 'gateway')
  ),
  CONSTRAINT fs_assessments_score_check CHECK (risk_score BETWEEN 0 AND 100),
  CONSTRAINT fs_assessments_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT fs_assessments_previous_level_check CHECK (
    previous_level IS NULL OR previous_level IN ('low', 'medium', 'high', 'critical')
  ),
  CONSTRAINT fs_assessments_confidence_check CHECK (confidence IN ('low', 'medium', 'high')),
  CONSTRAINT fs_assessments_status_check CHECK (status IN ('active', 'superseded')),
  CONSTRAINT fs_assessments_previous_score_check CHECK (
    previous_score IS NULL OR previous_score BETWEEN 0 AND 100
  ),
  CONSTRAINT fs_assessments_events_examined_check CHECK (events_examined >= 0),
  CONSTRAINT fs_assessments_window_order_check CHECK (window_started_at <= window_ended_at),
  CONSTRAINT fs_assessments_ai_label_check CHECK (
    (ai_assisted = false) OR (ai_summary IS NOT NULL AND ai_engine IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS fs_assessments_customer_time_idx
  ON fraud_sentinel_assessments (customer_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS fs_assessments_subject_time_idx
  ON fraud_sentinel_assessments (subject_type, subject_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS fs_assessments_level_time_idx
  ON fraud_sentinel_assessments (risk_level, assessed_at DESC);
CREATE INDEX IF NOT EXISTS fs_assessments_active_customer_idx
  ON fraud_sentinel_assessments (customer_id, assessed_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS fs_assessments_assessed_idx
  ON fraud_sentinel_assessments (assessed_at DESC);
CREATE INDEX IF NOT EXISTS fs_assessments_rule_set_idx
  ON fraud_sentinel_assessments (rule_set_version);

-- ---------------------------------------------------------------------------------------------
-- 5. Alerts — the human work item raised from a high/critical assessment.
--    Duplicate suppression is a DATABASE guarantee: the partial unique index allows at most one
--    alert per (subject, primary rule) while an alert is open (new/under_review/escalated). A
--    re-detection therefore updates recurrence_count + last_assessed_at + assessment_id on the open
--    alert and writes an investigation timeline entry; it never opens a second alert for the same
--    underlying condition. Once resolved or marked false_positive the key is free again, so a
--    genuine recurrence later raises a fresh alert.
-- ---------------------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS fraud_sentinel_alert_number_seq;

CREATE TABLE IF NOT EXISTS fraud_sentinel_alerts (
  id uuid PRIMARY KEY,
  alert_number varchar(32) NOT NULL DEFAULT (
    'FS-' || lpad(nextval('fraud_sentinel_alert_number_seq')::text, 8, '0')
  ),
  -- The most recent assessment behind this alert. RESTRICT: an alert's evidence basis can never be
  -- deleted out from under it.
  assessment_id uuid NOT NULL REFERENCES fraud_sentinel_assessments (id) ON DELETE RESTRICT,
  customer_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  subject_type varchar(24) NOT NULL,
  subject_id uuid NULL,
  -- See fraud_sentinel_assessments.subject_label — the IP address or gateway name for non-uuid subjects.
  subject_label varchar(64) NULL,
  dedupe_key varchar(200) NOT NULL,
  category varchar(24) NOT NULL,
  risk_level varchar(8) NOT NULL,
  risk_score integer NOT NULL,
  title varchar(255) NOT NULL,
  explanation text NOT NULL,
  primary_rule_code varchar(48) NULL,
  status varchar(20) NOT NULL DEFAULT 'new',
  assigned_reviewer_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  assigned_at timestamptz NULL,
  escalated_at timestamptz NULL,
  resolved_at timestamptz NULL,
  resolution_note text NULL,
  recurrence_count integer NOT NULL DEFAULT 1,
  detected_at timestamptz NOT NULL DEFAULT now(),
  last_assessed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fs_alerts_status_check CHECK (
    status IN ('new', 'under_review', 'escalated', 'resolved', 'false_positive')
  ),
  CONSTRAINT fs_alerts_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT fs_alerts_score_check CHECK (risk_score BETWEEN 0 AND 100),
  CONSTRAINT fs_alerts_category_check CHECK (
    category IN ('payment', 'account_security', 'order_service', 'admin_api')
  ),
  CONSTRAINT fs_alerts_subject_type_check CHECK (
    subject_type IN ('customer', 'ip', 'actor', 'gateway')
  ),
  CONSTRAINT fs_alerts_recurrence_check CHECK (recurrence_count >= 1),
  CONSTRAINT fs_alerts_assignment_check CHECK (
    (assigned_reviewer_id IS NULL AND assigned_at IS NULL)
    OR (assigned_reviewer_id IS NOT NULL AND assigned_at IS NOT NULL)
  ),
  CONSTRAINT fs_alerts_resolution_check CHECK (
    status NOT IN ('resolved', 'false_positive')
    OR (resolved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS fs_alerts_number_unique_idx ON fraud_sentinel_alerts (alert_number);
CREATE UNIQUE INDEX IF NOT EXISTS fs_alerts_open_dedupe_unique_idx
  ON fraud_sentinel_alerts (dedupe_key)
  WHERE status IN ('new', 'under_review', 'escalated');
CREATE INDEX IF NOT EXISTS fs_alerts_status_time_idx
  ON fraud_sentinel_alerts (status, risk_level, detected_at DESC);
CREATE INDEX IF NOT EXISTS fs_alerts_subject_label_idx
  ON fraud_sentinel_alerts (subject_type, subject_label) WHERE subject_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS fs_alerts_customer_time_idx
  ON fraud_sentinel_alerts (customer_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS fs_alerts_reviewer_idx
  ON fraud_sentinel_alerts (assigned_reviewer_id, status);
CREATE INDEX IF NOT EXISTS fs_alerts_category_time_idx
  ON fraud_sentinel_alerts (category, detected_at DESC);
CREATE INDEX IF NOT EXISTS fs_alerts_dedupe_idx ON fraud_sentinel_alerts (dedupe_key, detected_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 6. Investigation timeline — append-only record of everything that happened to an alert:
--    detection, re-detection, assignment, status transitions, reviewer notes, evidence review,
--    false-positive reports and AI-summary generation. This is the module's investigation history;
--    privileged actions additionally land in the platform-wide audit_logs.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_sentinel_investigations (
  id uuid PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES fraud_sentinel_alerts (id) ON DELETE CASCADE,
  assessment_id uuid NULL REFERENCES fraud_sentinel_assessments (id) ON DELETE SET NULL,
  actor_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  actor_type varchar(16) NOT NULL DEFAULT 'staff',
  action varchar(48) NOT NULL,
  from_status varchar(20) NULL,
  to_status varchar(20) NULL,
  note text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fs_investigations_actor_type_check CHECK (actor_type IN ('staff', 'system')),
  CONSTRAINT fs_investigations_action_check CHECK (action IN (
    'created', 're_detected', 'status_changed', 'assigned', 'unassigned', 'note_added',
    'evidence_reviewed', 'escalated', 'resolved', 'false_positive_reported',
    'ai_summary_generated', 'risk_changed'
  ))
);

CREATE INDEX IF NOT EXISTS fs_investigations_alert_idx
  ON fraud_sentinel_investigations (alert_id, created_at);
CREATE INDEX IF NOT EXISTS fs_investigations_actor_idx
  ON fraud_sentinel_investigations (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fs_investigations_created_idx
  ON fraud_sentinel_investigations (created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 7. Risk score history — the per-subject time series behind "historical risk changes" and the
--    customer risk profile sparkline. One row per assessment, immutable.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_sentinel_risk_history (
  id uuid PRIMARY KEY,
  customer_id uuid NULL REFERENCES users (id) ON DELETE CASCADE,
  subject_type varchar(24) NOT NULL,
  subject_id uuid NULL,
  -- See fraud_sentinel_assessments.subject_label: the IP address or gateway name for non-uuid
  -- subjects, so a platform-level subject's score history stays attributable.
  subject_label varchar(64) NULL,
  assessment_id uuid NULL REFERENCES fraud_sentinel_assessments (id) ON DELETE SET NULL,
  risk_score integer NOT NULL,
  risk_level varchar(8) NOT NULL,
  previous_score integer NULL,
  previous_level varchar(8) NULL,
  primary_reason_code varchar(48) NULL,
  rule_set_version varchar(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fs_risk_history_score_check CHECK (risk_score BETWEEN 0 AND 100),
  CONSTRAINT fs_risk_history_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT fs_risk_history_subject_type_check CHECK (
    subject_type IN ('customer', 'ip', 'actor', 'gateway')
  )
);

CREATE INDEX IF NOT EXISTS fs_risk_history_customer_idx
  ON fraud_sentinel_risk_history (customer_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS fs_risk_history_subject_idx
  ON fraud_sentinel_risk_history (subject_type, subject_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS fs_risk_history_subject_label_idx
  ON fraud_sentinel_risk_history (subject_type, subject_label) WHERE subject_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS fs_risk_history_recorded_idx
  ON fraud_sentinel_risk_history (recorded_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 8. False-positive reports — one per alert (unique), the feedback loop that lets a reviewer say
--    "this rule misfired here" with a reason category. Reports never delete or rewrite the
--    assessment: the detection stays on record and is labelled, which is what makes rule tuning
--    auditable instead of silent.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_sentinel_false_positives (
  id uuid PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES fraud_sentinel_alerts (id) ON DELETE CASCADE,
  assessment_id uuid NULL REFERENCES fraud_sentinel_assessments (id) ON DELETE SET NULL,
  rule_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  reported_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  reason_category varchar(32) NOT NULL,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fs_false_positives_reason_check CHECK (reason_category IN (
    'legitimate_customer', 'expected_behaviour', 'insufficient_evidence',
    'duplicate_signal', 'rule_misconfiguration', 'other'
  )),
  CONSTRAINT fs_false_positives_explanation_check CHECK (length(explanation) BETWEEN 3 AND 4000)
);

CREATE UNIQUE INDEX IF NOT EXISTS fs_false_positives_alert_unique_idx
  ON fraud_sentinel_false_positives (alert_id);
CREATE INDEX IF NOT EXISTS fs_false_positives_reason_idx
  ON fraud_sentinel_false_positives (reason_category, created_at DESC);
CREATE INDEX IF NOT EXISTS fs_false_positives_created_idx
  ON fraud_sentinel_false_positives (created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 9. Scan run ledger + DB-enforced lock, mirroring revenue_guardian_automation_runs.
--    The unique run_key IS the lock: scheduled runs claim `<job>:sched:<bucket>` so two overlapping
--    workers execute a bucket once; manual runs claim `<job>:manual:<minute>` so a double-click
--    cannot double-fire. Stale 'running' rows from a crashed worker are reclaimed by the runner.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_sentinel_runs (
  id uuid PRIMARY KEY,
  job_name varchar(64) NOT NULL,
  run_key varchar(160) NOT NULL,
  trigger varchar(16) NOT NULL DEFAULT 'schedule',
  triggered_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'running',
  subjects_scanned integer NOT NULL DEFAULT 0,
  events_ingested integer NOT NULL DEFAULT 0,
  assessments_created integer NOT NULL DEFAULT 0,
  alerts_created integer NOT NULL DEFAULT 0,
  alerts_updated integer NOT NULL DEFAULT 0,
  notifications_sent integer NOT NULL DEFAULT 0,
  records_pruned integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  duration_ms integer NULL,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fs_runs_status_check CHECK (status IN ('running', 'completed', 'failed')),
  CONSTRAINT fs_runs_trigger_check CHECK (trigger IN ('schedule', 'manual')),
  CONSTRAINT fs_runs_counters_check CHECK (
    subjects_scanned >= 0 AND events_ingested >= 0 AND assessments_created >= 0
    AND alerts_created >= 0 AND alerts_updated >= 0 AND notifications_sent >= 0
    AND records_pruned >= 0 AND failed_count >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS fs_runs_run_key_unique_idx ON fraud_sentinel_runs (run_key);
CREATE INDEX IF NOT EXISTS fs_runs_job_idx ON fraud_sentinel_runs (job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS fs_runs_started_idx ON fraud_sentinel_runs (started_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 10. Seed the reviewed default rule set.
--     Weights and thresholds below are the defaults mirrored in
--     src/fraud-sentinel/rules/catalogue.ts and documented in docs/FRAUD_SENTINEL.md §4.
--     ON CONFLICT DO NOTHING: an existing deployment's tuned rules are never overwritten by a
--     re-run, and code that adds a rule later upserts only genuinely new codes.
-- ---------------------------------------------------------------------------------------------
INSERT INTO fraud_sentinel_rules
  (id, code, name, description, category, family, version, enabled, weight, severity, parameters, recommendation, data_sources, applies_to)
VALUES
  ('11111111-0000-4000-8000-000000000001', 'PAY_REPEATED_FAILURES',
   'Repeated payment failures',
   'Counts payments.status = ''failed'' rows for the customer inside the lookback window. A customer whose card is declined repeatedly is either in financial distress or trying stolen credentials; both need a human look. Evidence is the real payments rows.',
   'payment', 'payment_failures', 1, true, 12, 'medium',
   '{"windowDays":30,"threshold":3}'::jsonb,
   'Review the failed payments rows with the customer before any retry. Confirm the funding instrument is theirs and current. Do not change the payment method on the customer''s behalf without a verified request.',
   '["payments","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000002', 'PAY_FAILURE_BURST',
   'Payment failure burst (card-testing pattern)',
   'Counts failed payment attempts inside a short window (default 60 minutes). Rapid successive declines against one or more invoices is the signature of automated card testing. Uses only recorded payments rows.',
   'payment', 'payment_failures', 1, true, 18, 'high',
   '{"windowMinutes":60,"threshold":3}'::jsonb,
   'Treat as possible card testing. Check whether the same instrument or IP appears on other accounts (ACC_IP_FAILURE_SPRAY, ACC_SHARED_REGISTRATION_CLUSTER). Preserve the payments rows; do not retry the charge while under review.',
   '["payments","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000003', 'PAY_SUCCESS_AFTER_FAILURES',
   'Successful payment immediately after repeated failures',
   'A successful payment preceded by several failures within the configured window. This is the strongest recorded card-testing indicator: many declines then one approval. Built from payments.status transitions only.',
   'payment', 'payment_failures', 1, true, 22, 'critical',
   '{"windowHours":24,"minFailures":3}'::jsonb,
   'Verify with the cardholder through a known-good contact channel before provisioning or delivering service. Confirm the successful charge with the gateway. Any refund decision stays in the existing authorized billing workflow with human approval.',
   '["payments","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000004', 'PAY_DUPLICATE_ATTEMPT',
   'Duplicate payment attempt on the same invoice',
   'Two or more payment attempts against the same invoice with the same amount, currency and provider inside a short window. May be a double-click, a retry loop, or deliberate duplicate charging. Distinct from the webhook ledger''s own idempotency, which prevents duplicate RECORDS, not duplicate ATTEMPTS.',
   'payment', 'payment_integrity', 1, true, 14, 'medium',
   '{"windowMinutes":15}'::jsonb,
   'Compare the provider_reference values at the gateway before concluding a double charge happened. If money was taken twice, the refund goes through the existing authorized refund workflow with human approval — never from this module.',
   '["payments","invoices","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000005', 'PAY_METHOD_CHURN',
   'Suspicious churn of payment details',
   'Counts distinct (provider, method) pairs used by the customer inside the window. Repeatedly switching instruments across attempts is what an attacker does when each stolen card declines. Recorded fields only: payments.provider and payments.method.',
   'payment', 'payment_integrity', 1, true, 10, 'medium',
   '{"windowDays":7,"threshold":3}'::jsonb,
   'Ask the customer to confirm which instrument is genuinely theirs. Check whether the other instruments appear on unrelated accounts. Never store or request full card details during the review.',
   '["payments","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000006', 'PAY_UNUSUAL_FREQUENCY',
   'Unusual payment frequency',
   'Total payment attempts (any status) in the window above the configured ceiling for one customer. Legitimate customers rarely attempt a dozen payments in a week.',
   'payment', 'payment_value', 1, true, 10, 'medium',
   '{"windowDays":7,"threshold":10}'::jsonb,
   'Establish whether the attempts are customer-driven or a retry loop in a gateway/webhook path. If automated, the fix is in the payment workflow, not the customer record.',
   '["payments","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000007', 'PAY_UNUSUAL_VALUE',
   'Unusual payment value for this customer',
   'The largest payment amount in the window is at least `multiplier` times the customer''s own median successful payment, or exceeds the absolute floor when there is not enough history. Comparison is per-customer, so a large enterprise order is not flagged for being large — only for being large FOR THEM.',
   'payment', 'payment_value', 1, true, 16, 'high',
   '{"multiplier":5,"minHistory":3,"floorAmount":"1000.00"}'::jsonb,
   'Confirm the order behind the payment is genuine and authorized by the account holder. Where history is too thin the assessment carries a NO_PAYMENT_HISTORY data-quality flag — treat the score as indicative, not conclusive.',
   '["payments","invoices","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000008', 'PAY_AMOUNT_MISMATCH',
   'Payment amount does not match the invoice total',
   'A successful or partially-refunded payment whose amount differs from its invoice''s total_amount by more than the tolerance. Overpayment and underpayment both indicate tampering, a manipulated client, or an inconsistent record.',
   'payment', 'payment_integrity', 1, true, 14, 'high',
   '{"toleranceAmount":"0.01"}'::jsonb,
   'Reconcile payments.amount against invoices.total_amount and billing_ledger. The ledger is authoritative; do not "correct" it — a reversing entry is the only permitted fix, and it belongs to the existing billing workflow.',
   '["payments","invoices","billing_ledger","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000009', 'PAY_CURRENCY_MISMATCH',
   'Currency inconsistent across order, invoice and payment',
   'payments.currency differs from its invoice''s currency, or invoices.currency differs from its order''s currency. Inconsistent customer/transaction information of exactly the kind the authorization asks to detect.',
   'payment', 'payment_integrity', 1, true, 12, 'medium',
   '{}'::jsonb,
   'Trace the currency from the cart through checkout to the gateway. A mismatch usually means a display-FX path wrote a converted amount somewhere it should not have; fix the workflow, not the historical rows.',
   '["payments","invoices","orders","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000010', 'PAY_REFUND_REVERSAL',
   'Refund / chargeback-proxy reversals',
   'Counts recorded money reversals in the window: billing_ledger entry_type = ''refund'' or ''credit'', payments.status refunded/partially_refunded, invoices.status refunded/partially_refunded/void. HONEST SCOPE: no gateway in src/payments records a chargeback event type, so this rule detects refunds and credits as chargeback PROXIES and never claims a confirmed chargeback.',
   'payment', 'payment_integrity', 1, true, 12, 'medium',
   '{"windowDays":30,"threshold":1}'::jsonb,
   'Confirm who authorized each reversal through audit_logs and the existing refund workflow. A pattern of pay-then-refund across orders is friendly fraud; a single authorized refund is normal business.',
   '["billing_ledger","payments","invoices","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000011', 'PAY_REFUND_VELOCITY',
   'Refund requested almost immediately after payment',
   'A refund recorded within `maxDaysBetweenPaymentAndRefund` days of the payment it reverses. Fast pay-then-refund cycles are used to launder a stolen card through a legitimate-looking order.',
   'payment', 'payment_integrity', 1, true, 16, 'high',
   '{"maxDaysBetweenPaymentAndRefund":7}'::jsonb,
   'Check whether the service was used or delivered between payment and refund. Correlate with ACC_NEW_GEO_LOGIN and ORD_HIGH_VALUE_NEW_ACCOUNT before concluding anything.',
   '["billing_ledger","payments","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000012', 'ACC_LOGIN_FAILURE_CLUSTER',
   'Repeated authentication failures on one account',
   'Counts auth_audit_log event_type = ''login_failure'' rows for the account in the window. Brute force or a forgotten password — the detector does not decide which, and never locks the account.',
   'account_security', 'account_auth', 1, true, 14, 'medium',
   '{"windowHours":24,"threshold":5}'::jsonb,
   'Contact the customer through a verified channel. If it was not them, follow the existing account-recovery workflow (which has its own identity verification and human approval). This module performs no lockout.',
   '["auth_audit_log","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000013', 'ACC_IP_FAILURE_SPRAY',
   'One IP failing logins across many accounts (password spraying)',
   'For an IP subject: at least `minFailures` login_failure rows targeting at least `minAccounts` distinct accounts in the window. Cross-account fan-out from one source is the distinguishing feature versus a single customer mistyping a password.',
   'account_security', 'account_auth', 1, true, 20, 'high',
   '{"windowHours":24,"minFailures":10,"minAccounts":3}'::jsonb,
   'Human security review: assess intent. Any containment (rate limit, WAF rule, IP block) goes through the existing authorized infrastructure workflow with approval — this module only reports.',
   '["auth_audit_log","fraud_sentinel_events"]'::jsonb, '["ip"]'::jsonb),

  ('11111111-0000-4000-8000-000000000014', 'ACC_NEW_GEO_LOGIN',
   'Successful login from a country the account has never used',
   'A login_success whose IP resolves (via the platform''s own geoip-lite lookup, src/visitor-intelligence/geo.ts) to a country absent from the account''s baseline of previously seen countries. Carries a GEO_UNAVAILABLE data-quality flag when the IP cannot be resolved, and NO_LOGIN_BASELINE when the account has no prior login history.',
   'account_security', 'account_auth', 1, true, 12, 'medium',
   '{"baselineDays":90}'::jsonb,
   'Ask the customer whether the login was them (travel, VPN, new location are all common and innocent). Escalate only if it coincides with ACC_CONTEXT_CHANGE_AFTER_NEW_LOGIN or ACC_MFA_TAMPERING.',
   '["auth_audit_log","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000015', 'ACC_NEW_DEVICE_LOGIN',
   'New or unexpected device / session activity',
   'A login_success whose classified client family (browser family + OS family, derived by the platform''s own classifier — no raw user-agent is copied into this module) is absent from the account''s baseline. Device fingerprints are NOT available on this platform; this is a coarse family comparison and the assessment says so.',
   'account_security', 'account_auth', 1, true, 10, 'medium',
   '{"baselineDays":90}'::jsonb,
   'Confirm with the customer. A browser or OS upgrade produces this legitimately; treat it as context for other signals, not as a finding on its own.',
   '["auth_audit_log","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000016', 'ACC_IMPOSSIBLE_TRAVEL',
   'Two successful logins too far apart too quickly',
   'Two login_success events from different resolved countries within `maxHours`, where the great-circle distance between the GeoIP city centres implies a speed above `maxSpeedKmh`. Deterministic haversine arithmetic on coordinates the platform already derives; no external service is called.',
   'account_security', 'account_auth', 1, true, 18, 'high',
   '{"maxHours":6,"maxSpeedKmh":900}'::jsonb,
   'One of the two sessions is not the account owner, or one is a VPN/proxy exit. Review both sessions'' activity, then use the existing recovery workflow if the customer disowns one. GeoIP is city-centre accuracy — verify before acting.',
   '["auth_audit_log","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000017', 'ACC_ACCESS_FREQUENCY_ANOMALY',
   'Abnormal account access frequency',
   'login_success events in the last `windowHours` exceed `multiplier` times the account''s own baseline rate, and the baseline itself has at least `minBaselineSessions` sessions so a brand-new account is not compared against nothing.',
   'account_security', 'account_auth', 1, true, 8, 'low',
   '{"windowHours":1,"multiplier":5,"minBaselineSessions":10}'::jsonb,
   'Usually automation, a shared login, or a stuck client re-authenticating. Confirm with the customer before treating it as compromise.',
   '["auth_audit_log","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000018', 'ACC_RECOVERY_REQUEST_BURST',
   'Suspicious password / account recovery activity volume',
   'Counts password_reset_requested, email_verification_requested and account_recovery_requested events for the account in the window. Repeated recovery requests are either a locked-out owner or an attacker probing the reset path.',
   'account_security', 'account_recovery', 1, true, 14, 'medium',
   '{"windowHours":24,"threshold":3}'::jsonb,
   'Check whether any request was completed (password_reset_completed / account_recovery_approved) and from which IP. The existing recovery workflow already requires identity verification and human approval — confirm that path was followed.',
   '["auth_audit_log","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000019', 'ACC_RECOVERY_AFTER_FAILURES',
   'Account recovery completed straight after failed logins',
   'A password_reset_completed or account_recovery_approved within `windowMinutes` of at least `minFailures` login_failure rows. The classic takeover sequence: guess, fail, reset, succeed.',
   'account_security', 'account_recovery', 1, true, 20, 'high',
   '{"windowMinutes":60,"minFailures":3}'::jsonb,
   'Treat as a possible takeover until the customer confirms otherwise. Review every action taken in the session after the reset. Password changes already invalidate prior sessions (auth_session_version); verify that happened.',
   '["auth_audit_log","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000020', 'ACC_STEP_UP_VERIFICATION_FAILURES',
   'Step-up verification failures (MFA / Security PIN)',
   'Counts mfa_login_failure, security_pin_view_verification_failed and security_number_verification_failed events in the window. Failing a second factor repeatedly means someone holds the password but not the second factor.',
   'account_security', 'account_recovery', 1, true, 12, 'medium',
   '{"windowHours":24,"threshold":3}'::jsonb,
   'Confirm with the customer. If the password is compromised but the second factor held, the credential — not the account — is the exposure. Rotation goes through the existing security workflow.',
   '["auth_audit_log","audit_logs","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000021', 'ACC_CONTEXT_CHANGE_AFTER_NEW_LOGIN',
   'Account information changed right after an unfamiliar login',
   'profile_update, username_changed, password_change or an email change within `windowMinutes` of a login that ACC_NEW_GEO_LOGIN or ACC_NEW_DEVICE_LOGIN would flag. Correlating the two is what separates an owner updating their profile from an attacker locking the owner out.',
   'account_security', 'account_change', 1, true, 16, 'high',
   '{"windowMinutes":30}'::jsonb,
   'Contact the customer through the pre-change contact details. If they disown the change, revert it through the existing authorized account workflow with the change on record.',
   '["auth_audit_log","users","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000022', 'ACC_MFA_TAMPERING',
   'Second factor removed or rotated after unfamiliar access',
   'mfa_disabled, passkey_removed or security_pin_rotated within `windowMinutes` of an unfamiliar-context login or of repeated login failures. Removing the second factor is the step that turns a compromised password into a taken-over account.',
   'account_security', 'account_change', 1, true, 22, 'critical',
   '{"windowMinutes":60}'::jsonb,
   'Highest-priority account-security review. Verify with the customer immediately; if unconfirmed, follow the existing account-recovery workflow. This module does not suspend the account or revoke the session itself.',
   '["auth_audit_log","fraud_sentinel_events"]'::jsonb, '["customer","actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000023', 'ACC_SHARED_REGISTRATION_CLUSTER',
   'Multiple accounts registered from one source',
   'For an IP subject: at least `threshold` auth_audit_log ''register'' events from the same ip_address in the window, and the distinct customer accounts they created. Bulk registration from one source precedes payment fraud and free-trial abuse.',
   'account_security', 'account_cluster', 1, true, 16, 'high',
   '{"windowHours":24,"threshold":3}'::jsonb,
   'Review the registered accounts as a group, not individually: shared payment instrument, shared contact details, or shared ordering pattern. NAT and corporate proxies produce this innocently — verify before acting.',
   '["auth_audit_log","users","fraud_sentinel_events"]'::jsonb, '["ip"]'::jsonb),

  ('11111111-0000-4000-8000-000000000024', 'ORD_ORDER_VELOCITY',
   'Unusual hosting / VPS order velocity',
   'Count of orders created by the customer in the window above the threshold. Legitimate buyers place a handful of orders; a burst suggests either an automated client or an account being used to farm resources.',
   'order_service', 'order_velocity', 1, true, 12, 'medium',
   '{"windowHours":24,"threshold":5}'::jsonb,
   'Check whether the orders were paid, and whether the resulting services were actually used. Unpaid bursts are usually a broken client; paid bursts need a customer conversation.',
   '["orders","order_items","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000025', 'ORD_REPEAT_IDENTICAL_PURCHASE',
   'Suspicious repeated identical service purchases',
   'At least `threshold` orders in the window containing the same product and plan snapshot (order_items.product_name_snapshot + plan_name_snapshot + billing_period). Buying the same VPS plan repeatedly is a resource-farming pattern.',
   'order_service', 'order_velocity', 1, true, 14, 'medium',
   '{"windowDays":7,"threshold":3}'::jsonb,
   'Ask what the repeated identical services are for. Resellers do this legitimately — confirm the account is a reseller before escalating.',
   '["orders","order_items","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000026', 'ORD_HIGH_VALUE_NEW_ACCOUNT',
   'High-value order from a brand-new account',
   'An order whose total_amount is at least `minAmount` placed while the account is younger than `accountAgeHours`. The single most reliable hosting-fraud pattern: register, buy big, disappear with the resource.',
   'order_service', 'order_value', 1, true, 22, 'critical',
   '{"accountAgeHours":72,"minAmount":"500.00"}'::jsonb,
   'Verify identity and payment ownership BEFORE provisioning. Hold delivery through the existing order/provisioning workflow — this module does not and must not block the order itself. Correlate with ACC_NEW_GEO_LOGIN and ACC_SHARED_REGISTRATION_CLUSTER.',
   '["orders","users","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000027', 'ORD_UNPAID_ACCUMULATION',
   'Accumulating unpaid or failed orders',
   'Count of orders in the window with payment_status unpaid or failed above the threshold. Ordering capacity without paying is abuse of the checkout path and a precursor to service abuse.',
   'order_service', 'order_value', 1, true, 10, 'medium',
   '{"windowDays":30,"threshold":5}'::jsonb,
   'Distinguish a customer in difficulty (Revenue Guardian''s job) from an account farming unpaid orders (this module''s job) by whether any service was ever delivered.',
   '["orders","invoices","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000028', 'ORD_PROVISIONING_BURST',
   'Abnormal provisioning request volume',
   'Count of provisioning_jobs rows linked to the customer''s orders in the window above the threshold. One event per job row — retries increment that row''s own attempts counter, so a job retried to its maximum still counts once and the attempt count is carried in the evidence. A burst of PROVISION/REINSTALL/DELETE operations is either an automation fault or someone churning infrastructure.',
   'order_service', 'service_abuse', 1, true, 12, 'medium',
   '{"windowHours":24,"threshold":5}'::jsonb,
   'Read provisioning_jobs.operation and .status for the burst. Repeated FAILED + retry is an infrastructure fault; repeated DELETE + PROVISION is churn and needs a provider-cost look.',
   '["provisioning_jobs","orders","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000029', 'ORD_CANCEL_REFUND_PATTERN',
   'Abnormal cancellation and refund pattern',
   'At least `minCancellations` customer_services rows moved to ''cancelled'' together with at least `minRefunds` recorded refunds in the window. Buy, use, cancel, refund is a service-abuse cycle.',
   'order_service', 'service_abuse', 1, true, 16, 'high',
   '{"windowDays":30,"minCancellations":2,"minRefunds":1}'::jsonb,
   'Check whether the service was consumed between activation and cancellation (usage evidence lives with the service, not here). Refund policy decisions stay in the existing authorized workflow.',
   '["customer_services","billing_ledger","orders","fraud_sentinel_events"]'::jsonb, '["customer"]'::jsonb),

  ('11111111-0000-4000-8000-000000000030', 'SVC_TOOL_ABUSE',
   'Recorded service/tool abuse events',
   'Counts tool_abuse_events rows attributed to the customer or to the IP subject in the window. This is the ONE service-usage abuse signal with genuine per-actor telemetry on this platform; SMTP-relay and proxy abuse have no such telemetry and are deliberately NOT detected (docs/FRAUD_SENTINEL.md §3).',
   'order_service', 'service_abuse', 1, true, 14, 'medium',
   '{"windowDays":7,"threshold":3}'::jsonb,
   'Read tool_abuse_events.kind and .detail for the recorded abuse. Rate limiting and tool disabling belong to the Tools Center admin workflow, not to this module.',
   '["tool_abuse_events","fraud_sentinel_events"]'::jsonb, '["customer","ip"]'::jsonb),

  ('11111111-0000-4000-8000-000000000031', 'ADM_PRIVILEGED_ACTION_BURST',
   'Unusual volume of privileged administrative actions',
   'Count of audit_logs rows written by one actor in the window above the threshold. A burst of privileged actions is either a migration in progress or an account being used to change many things quickly.',
   'admin_api', 'admin_activity', 1, true, 14, 'medium',
   '{"windowHours":1,"threshold":25}'::jsonb,
   'Read the audit_logs actions in the burst and confirm the actor was doing authorized work. Insider risk is reviewed by a second administrator, never by the actor.',
   '["audit_logs","fraud_sentinel_events"]'::jsonb, '["actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000032', 'ADM_PERMISSION_CHANGE',
   'Unexpected permission or account-status change',
   'An auth_audit_log admin_role_change or admin_status_change event in the window. Privilege changes are rare and always worth a second pair of eyes, including when they are legitimate.',
   'admin_api', 'admin_activity', 1, true, 14, 'high',
   '{"windowHours":24,"threshold":1}'::jsonb,
   'Confirm the change was requested and approved by a super_admin. Role changes go through the existing role service, which writes both users.role and user_roles in one transaction — verify both were written.',
   '["auth_audit_log","users","fraud_sentinel_events"]'::jsonb, '["actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000033', 'ADM_PERMISSION_CHANGE_BURST',
   'Multiple permission changes in a short window',
   'At least `threshold` admin_role_change / admin_status_change events by one actor in the window. Mass privilege manipulation is how an insider or a compromised admin account establishes persistence.',
   'admin_api', 'admin_activity', 1, true, 22, 'critical',
   '{"windowHours":24,"threshold":3}'::jsonb,
   'Escalate to a second super_admin immediately and review every affected account. Super-admin-only configuration must stay protected; this module reports and never changes a role itself.',
   '["auth_audit_log","users","fraud_sentinel_events"]'::jsonb, '["actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000034', 'ADM_STAFF_AUTH_FAILURES',
   'Repeated authentication failures on a privileged account',
   'login_failure events targeting an account whose users.role is staff, admin or super_admin. Privileged accounts are the highest-value target on the platform, so the same volume that is noise on a customer account is a finding here.',
   'admin_api', 'admin_activity', 1, true, 16, 'high',
   '{"windowHours":24,"threshold":3}'::jsonb,
   'Verify with the administrator directly. If the failures are unexplained, review every audit_logs action by that actor since the first failure.',
   '["auth_audit_log","users","fraud_sentinel_events"]'::jsonb, '["actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000035', 'ADM_SUPPORT_SESSION_FANOUT',
   'Delegated support sessions opened across many customers',
   'At least `threshold` admin_support_sessions opened by one administrator, spanning at least `minDistinctCustomers` distinct customers, in the window. Delegated access is legitimate one customer at a time; a fan-out is not.',
   'admin_api', 'admin_activity', 1, true, 12, 'medium',
   '{"windowHours":24,"threshold":5,"minDistinctCustomers":3}'::jsonb,
   'Ask the administrator what the sweep was for. Each session row records a reason — check it was given. Session tokens are already single-use and expire; no action here changes that.',
   '["admin_support_sessions","fraud_sentinel_events"]'::jsonb, '["actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000036', 'ADM_OFF_HOURS_SENSITIVE',
   'Sensitive administrative action outside configured hours',
   'A sensitive audit_logs action (credentials, settings, provider configuration, roles, secrets) whose occurred_at hour in UTC falls inside the configured off-hours band. DATA-QUALITY NOTE: the band is evaluated in UTC because the platform stores timestamptz and the module does not know the actor''s timezone; the flag says so rather than pretending to local time.',
   'admin_api', 'admin_activity', 1, true, 8, 'low',
   '{"startHourUtc":22,"endHourUtc":6}'::jsonb,
   'Confirm the actor was working late rather than someone using their session. Off-hours alone is weak evidence — only meaningful next to another signal.',
   '["audit_logs","fraud_sentinel_events"]'::jsonb, '["actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000037', 'ADM_SENSITIVE_CONFIG_CHANGE',
   'Unusual changes to sensitive configuration',
   'Count of audit_logs rows in the window whose resource_type or action matches the documented sensitive list actually used by this codebase (platform_settings, marketing_integration, domain_service_provider, cloudflare_account, tool_provider, ssh_key, server credentials, and actions containing credentials/configuration_saved/settings.updated/policy_updated/secret).',
   'admin_api', 'admin_activity', 1, true, 12, 'medium',
   '{"windowDays":7,"threshold":3}'::jsonb,
   'Review each configuration change against its approval. Provider credentials and webhook secrets are the highest-impact items — confirm rotation was authorized.',
   '["audit_logs","fraud_sentinel_events"]'::jsonb, '["actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000038', 'ADM_MANUAL_PAYMENT_BURST',
   'Manual payment confirmations by one administrator',
   'At least `threshold` auth_audit_log manual_payment_confirmed events by one actor in the window. Manual confirmation is the one place a human can mark money as received without a gateway, so a burst is a direct financial-control risk.',
   'admin_api', 'admin_activity', 1, true, 20, 'critical',
   '{"windowHours":24,"threshold":3}'::jsonb,
   'Reconcile every manual confirmation against the bank/gateway statement through the existing payment-reconciliation workflow. Manual confirmation requires the existing authorization; verify each one had it.',
   '["auth_audit_log","payments","billing_ledger","fraud_sentinel_events"]'::jsonb, '["actor"]'::jsonb),

  ('11111111-0000-4000-8000-000000000039', 'API_WEBHOOK_REJECT_BURST',
   'Burst of rejected or failed webhook deliveries',
   'For a gateway subject: at least `threshold` webhook_events rows with status rejected or failed in the window. Rejected deliveries mean signature failures, malformed payloads, or someone probing the webhook endpoint.',
   'admin_api', 'webhook_integrity', 1, true, 16, 'high',
   '{"windowHours":1,"threshold":5}'::jsonb,
   'Check webhook_events.event_type and error-free rejection counts at the gateway. Signature verification is already enforced in src/payments/webhook-signing.ts; a burst means the endpoint is being attacked or a provider changed shape.',
   '["webhook_events","fraud_sentinel_events"]'::jsonb, '["gateway"]'::jsonb),

  ('11111111-0000-4000-8000-000000000040', 'API_WEBHOOK_REPLAY',
   'Webhook payload replay attempts',
   'For a gateway subject: the same webhook_events.payload_hash recorded on at least `threshold` distinct webhook_events rows in the window. HONEST SCOPE: src/routes/webhooks.ts verifies the signature BEFORE any row is written, and UNIQUE(gateway, event_id) stops a re-delivered event id creating a second row — so a byte-identical replay of the SAME event id is refused without leaving a row here and is NOT visible to this rule. What it does see is one payload recorded under several distinct event ids: a provider retry storm, a re-signed replay, or an attacker able to produce valid signatures for new event ids.',
   'admin_api', 'webhook_integrity', 1, true, 20, 'critical',
   '{"windowHours":1,"threshold":3}'::jsonb,
   'Compare the event_ids sharing the payload hash. If they are provider retries, nothing is wrong. If they are not, treat it as an attack on the payment webhook: confirm signature verification is enabled for the gateway and rotate the webhook secret through the existing authorized configuration workflow. Signature-rejected deliveries are refused before any row is written, so their absence here is not evidence of absence — check the application log.',
   '["webhook_events","fraud_sentinel_events"]'::jsonb, '["gateway"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Every seeded rule gets a 'created' history row so the audit trail starts at the migration rather
-- than at the first admin edit. Deterministic ids keep a re-run idempotent.
INSERT INTO fraud_sentinel_rule_history (id, rule_id, code, version, change_type, snapshot, changed_by, reason)
SELECT
  -- Stable, derived id: no sequence, no randomness, so re-running the migration body is a no-op.
  ('22222222-0000-4000-8000-' || lpad((row_number() OVER (ORDER BY r.code))::text, 12, '0'))::uuid,
  r.id, r.code, r.version, 'created',
  jsonb_build_object(
    'code', r.code, 'name', r.name, 'category', r.category, 'family', r.family,
    'version', r.version, 'enabled', r.enabled, 'weight', r.weight, 'severity', r.severity,
    'parameters', r.parameters, 'dataSources', r.data_sources, 'appliesTo', r.applies_to
  ),
  NULL, 'Seeded by migration 0101_create_fraud_sentinel.sql'
FROM fraud_sentinel_rules r
WHERE NOT EXISTS (
  SELECT 1 FROM fraud_sentinel_rule_history h WHERE h.rule_id = r.id AND h.change_type = 'created'
);

-- ---------------------------------------------------------------------------------------------
-- 11. Module settings — stored in the EXISTING platform_settings table, no second settings system.
--     Defaults are mirrored in src/fraud-sentinel/utils/settings.ts so a partially seeded database
--     still behaves deterministically.
-- ---------------------------------------------------------------------------------------------
INSERT INTO platform_settings (key, value, description) VALUES
  ('fraud_sentinel.enabled', 'true',
   'Master switch for Fraud Sentinel. When false the worker cycle does nothing and the dashboard reports the module as disabled — it never silently stops scoring.'),
  ('fraud_sentinel.lookback_days', '30',
   'Default detection lookback window (days). Every rule window is bounded by this, so no scan reads unbounded history.'),
  ('fraud_sentinel.risk_thresholds', '{"medium": 25, "high": 50, "critical": 75}',
   'Risk score boundaries (0-100) for medium/high/critical. Deliberately the same scale Revenue Guardian uses so two platform risk numbers never disagree about what "high" means.'),
  ('fraud_sentinel.family_caps', '{"payment_failures": 30, "payment_integrity": 28, "payment_value": 20, "account_auth": 30, "account_recovery": 22, "account_change": 24, "account_cluster": 18, "order_velocity": 22, "order_value": 24, "service_abuse": 22, "admin_activity": 30, "webhook_integrity": 22}',
   'Maximum total contribution of each correlated-rule family. This is the anti-double-counting mechanism: five rules describing one failed-payment burst cannot stack past the family cap.'),
  ('fraud_sentinel.alert_min_level', '"high"',
   'Lowest risk level that raises an alert (medium | high | critical). Assessments are always stored regardless; this only controls whether a human work item is created.'),
  ('fraud_sentinel.alert_on_critical_rule', 'true',
   'When true, any single triggered rule of severity critical raises an alert even if the aggregate score is below alert_min_level.'),
  ('fraud_sentinel.notify_reviewer_roles', '["super_admin", "admin"]',
   'Roles that receive the in-app + email notification when a new alert is raised. Uses the existing user_notifications/notification_outbox pipeline; no new mail engine.'),
  ('fraud_sentinel.scan_batch_size', '200',
   'Maximum subjects assessed per scheduled scan pass. Bounds each run so a large backlog cannot produce an unbounded query.'),
  ('fraud_sentinel.event_batch_limit', '2000',
   'Maximum event rows loaded per subject per assessment. When the limit is reached the assessment carries an EVENT_BATCH_LIMIT_REACHED data-quality flag and its counts are reported as lower bounds — never silently truncated.'),
  ('fraud_sentinel.ingest_batch_limit', '5000',
   'Maximum source rows ingested per source table per pass, oldest first. Keeps ingestion bounded on a large existing database.'),
  ('fraud_sentinel.scheduler_interval_minutes', '15',
   'How often the worker runs the Fraud Sentinel scan cycle. The schedule-bucket run_key means overlapping workers still execute a bucket exactly once.'),
  ('fraud_sentinel.retention_event_days', '180',
   'Days the detection event ledger is kept before pruning. Events are a derived projection — the authoritative rows stay in their own tables forever.'),
  ('fraud_sentinel.retention_history_days', '730',
   'Days of risk-score history kept per subject before pruning.'),
  ('fraud_sentinel.retention_superseded_assessment_days', '365',
   'Days a SUPERSEDED assessment is kept before pruning. Assessments referenced by an alert are never pruned (ON DELETE RESTRICT), so the evidence basis of every alert survives.'),
  ('fraud_sentinel.ai_assist_enabled', 'false',
   'Optional AI-assisted narrative layer. OFF by default and never mandatory: with no external engine configured the module produces its deterministic evidence summary and nothing degrades.'),
  ('fraud_sentinel.ai_engine', '"deterministic"',
   'Engine used for the optional narrative summary. Any non-deterministic value must exist, be enabled and be configured in the EXISTING ai_model_configs table, otherwise resolution fails closed to the deterministic summary. No API key is ever required to run Fraud Sentinel.')
ON CONFLICT (key) DO NOTHING;
