-- Migration: 0089_create_email_trace_centre.sql
-- Purpose: the storage layer for the native Email Trace Centre — delivery evidence collected from
-- CloudHost247's own mail servers (Exim), with no third-party tracking API anywhere in the path.
--
-- What this schema is for
--   One row per *observed transport event* on a mail server: a submission, a deferral, a remote
--   acceptance, a bounce, a rejection. Rows are evidence, not conclusions. The status attached to
--   each row is the strictest reading of that single event, and `DELIVERED` never means "it reached
--   an inbox" — it means the receiving SMTP server accepted the message (see
--   docs/EMAIL-TRACE-CENTRE-ARCHITECTURE.md §2.2).
--
-- What it deliberately does not store
--   * No message bodies, attachments, full headers or raw log lines. A raw log line never leaves
--     the mail server; only normalised fields are persisted, which is also why there is no "raw"
--     column to leak later.
--   * No SMTP credentials, tokens, passwords or server keys. Collection credentials live in
--     `server_credentials` (0028, AES-256-GCM, key-versioned) and are referenced by name only.
--   * No invented events: every row carries the server that produced it and a content hash of the
--     source record, so a row can be traced back to an evidence class (never to a raw line).
--
-- Deduplication is a database constraint, not an application habit
--   `UNIQUE (source_server_id, source_event_hash)` means a collector that re-reads a log after a
--   crash, a rotated file, or an operator-triggered run cannot double-count an event. The hash is
--   built in src/email-trace/dedupe.ts from the fields that identify the event, so the same line
--   always hashes the same way.
--
-- Ownership is resolved server-side
--   `customer_id` / `hosting_account_id` / `domain_id` are denormalised so tenant filters stay
--   cheap, but they are always derived from `customer_services` / `customer_domains` at collection
--   time. A client-supplied customer id is a filter, never a grant.
--
-- Retention
--   `retention_hold` exists so an active investigation can pin a row past the retention sweep. The
--   sweep reports what it held back rather than deleting silently.
--
-- Runs inside the migration runner's own transaction — do not add BEGIN/COMMIT here.

-- ---------------------------------------------------------------------------------------------
-- 1. Normalised events
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_trace_events (
  id uuid PRIMARY KEY,
  -- The message identity a timeline is grouped by (the Exim message id as logged).
  trace_id varchar(128) NOT NULL,
  -- The raw source identifier kept for cross-referencing with a server operator. Same value as
  -- trace_id today; separate so a future provider with a different id shape does not need a rewrite.
  provider_message_id varchar(255) NULL,
  hosting_account_id uuid NULL REFERENCES customer_services (id) ON DELETE SET NULL,
  customer_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  domain_id uuid NULL REFERENCES customer_domains (id) ON DELETE SET NULL,
  -- `<>` is a real value (the null reverse-path of a bounce), which is why the address check below
  -- allows it explicitly instead of storing an empty string that looks like missing data.
  sender varchar(320) NOT NULL,
  recipient varchar(320) NOT NULL,
  sender_domain varchar(255) NOT NULL DEFAULT '',
  recipient_domain varchar(255) NOT NULL DEFAULT '',
  event_type varchar(32) NOT NULL,
  delivery_status varchar(16) NOT NULL,
  smtp_response_code integer NULL,
  smtp_response_text varchar(500) NULL,
  remote_hostname varchar(255) NULL,
  -- The timestamp from the source record, in UTC. Never `now()`: a collected event is historical.
  event_timestamp timestamptz NOT NULL,
  source_server_id uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  source_event_hash char(64) NOT NULL,
  retention_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_trace_events_event_type_check CHECK (
    event_type IN (
      'submission', 'routing', 'delivery', 'additional_delivery', 'completion',
      'deferral', 'bounce', 'rejection', 'queue_snapshot'
    )
  ),
  CONSTRAINT email_trace_events_delivery_status_check CHECK (
    delivery_status IN (
      'ACCEPTED', 'QUEUED', 'PROCESSING', 'DEFERRED',
      'DELIVERED', 'BOUNCED', 'REJECTED', 'FAILED', 'UNKNOWN'
    )
  ),
  CONSTRAINT email_trace_events_smtp_code_check CHECK (
    smtp_response_code IS NULL OR (smtp_response_code BETWEEN 100 AND 599)
  ),
  CONSTRAINT email_trace_events_sender_check CHECK (
    sender = '<>' OR position('@' in sender) > 1
  ),
  CONSTRAINT email_trace_events_recipient_check CHECK (
    position('@' in recipient) > 1
  ),
  CONSTRAINT email_trace_events_trace_id_check CHECK (length(trace_id) BETWEEN 6 AND 128),
  CONSTRAINT email_trace_events_hash_check CHECK (length(source_event_hash) = 64)
);

-- Deduplication: the only hard guarantee that a re-collected event is not counted twice.
CREATE UNIQUE INDEX IF NOT EXISTS email_trace_events_source_hash_unique_idx
  ON email_trace_events (source_server_id, source_event_hash);

-- Timeline for one message.
CREATE INDEX IF NOT EXISTS email_trace_events_trace_idx
  ON email_trace_events (trace_id, event_timestamp);

-- "What left this address / arrived for this domain", the two searches that matter.
CREATE INDEX IF NOT EXISTS email_trace_events_sender_idx
  ON email_trace_events (sender, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS email_trace_events_recipient_domain_idx
  ON email_trace_events (recipient_domain, event_timestamp DESC);

-- Tenant isolation reads these.
CREATE INDEX IF NOT EXISTS email_trace_events_customer_idx
  ON email_trace_events (customer_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS email_trace_events_hosting_account_idx
  ON email_trace_events (hosting_account_id, event_timestamp DESC);

-- Per-server view and the admin dashboard.
CREATE INDEX IF NOT EXISTS email_trace_events_server_idx
  ON email_trace_events (source_server_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS email_trace_events_problem_idx
  ON email_trace_events (delivery_status, event_timestamp DESC)
  WHERE delivery_status IN ('DEFERRED', 'BOUNCED', 'REJECTED', 'FAILED');

-- ---------------------------------------------------------------------------------------------
-- 2. Sources — one row per mail server we are allowed to read evidence from
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_trace_sources (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  provider_type varchar(32) NOT NULL DEFAULT 'unknown',
  collection_method varchar(24) NOT NULL DEFAULT 'none',
  -- Last capability probe: which evidence classes this host actually exposes, and why not. An
  -- empty or `unsupported` capability is displayed as such — never as an empty table.
  capability jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Incremental read position (inode/offset/last timestamp). A checkpoint is only advanced after
  -- the corresponding rows have been written, so a crash re-reads rather than skips.
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  collection_enabled boolean NOT NULL DEFAULT false,
  last_success_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_error_code varchar(64) NULL,
  last_error_message varchar(500) NULL,
  status varchar(24) NOT NULL DEFAULT 'not_configured',
  -- *Which* credential to use (e.g. 'agent_secret'), never the credential itself.
  config_reference varchar(64) NULL,
  retention_days_override integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_trace_sources_provider_type_check CHECK (
    provider_type IN ('exim_cpanel', 'exim_standalone', 'postfix', 'unknown')
  ),
  CONSTRAINT email_trace_sources_collection_method_check CHECK (
    collection_method IN ('agent', 'whm_api', 'none')
  ),
  CONSTRAINT email_trace_sources_status_check CHECK (
    status IN ('not_configured', 'ok', 'degraded', 'error', 'disabled')
  ),
  CONSTRAINT email_trace_sources_retention_check CHECK (
    retention_days_override IS NULL OR retention_days_override BETWEEN 1 AND 3650
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS email_trace_sources_server_unique_idx
  ON email_trace_sources (server_id);
CREATE INDEX IF NOT EXISTS email_trace_sources_status_idx
  ON email_trace_sources (status, collection_enabled);

-- ---------------------------------------------------------------------------------------------
-- 3. Collection runs — what happened each time the collector touched a server
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_trace_collection_runs (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES email_trace_sources (id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  status varchar(16) NOT NULL DEFAULT 'running',
  records_seen integer NOT NULL DEFAULT 0,
  records_collected integer NOT NULL DEFAULT 0,
  records_rejected integer NOT NULL DEFAULT 0,
  -- Queue snapshot taken during this run, so the queue view is "the queue as of the last successful
  -- collection" rather than a number scraped live on a page load.
  queue_count integer NULL,
  queue_oldest_seconds integer NULL,
  queue_deferred integer NULL,
  error_class varchar(64) NULL,
  error_message varchar(500) NULL,
  checkpoint_after jsonb NULL,
  lease_holder varchar(96) NULL,
  CONSTRAINT email_trace_collection_runs_status_check CHECK (
    status IN ('running', 'ok', 'partial', 'failed', 'skipped')
  ),
  CONSTRAINT email_trace_collection_runs_counts_check CHECK (
    records_seen >= 0 AND records_collected >= 0 AND records_rejected >= 0
  ),
  CONSTRAINT email_trace_collection_runs_queue_check CHECK (
    (queue_count IS NULL OR queue_count >= 0)
    AND (queue_oldest_seconds IS NULL OR queue_oldest_seconds >= 0)
    AND (queue_deferred IS NULL OR queue_deferred >= 0)
  )
);

CREATE INDEX IF NOT EXISTS email_trace_collection_runs_source_idx
  ON email_trace_collection_runs (source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS email_trace_collection_runs_status_idx
  ON email_trace_collection_runs (status, started_at DESC);
