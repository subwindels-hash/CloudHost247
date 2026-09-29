-- Migration: 0033_create_deployments.sql
-- Purpose: Phase 6 — the deployment job queue, its step log, and its event stream (spec §12, §13, §14, §24, §28).
--
-- deployments is BOTH the durable record of every orchestration job and the queue the worker
-- consumes. PostgreSQL is the queue broker (spec §28 allows "another reliable queue"): rows are
-- claimed atomically with `FOR UPDATE SKIP LOCKED`, so multiple workers can share one queue with
-- exactly-once claiming, no Redis dependency, and one transaction system for jobs + financial
-- state. See src/deployments/queue.ts.
--
-- idempotency_key (spec §12): unique across the table; a retried API request carrying the same
-- key returns the existing deployment instead of enqueuing a duplicate. Actions (spec §12 + §29):
-- lifecycle actions for installations plus platform-level PROVISION/SUSPEND/TERMINATE for
-- hosting resources (cPanel accounts) that have no installation row.
--
-- status values: queued → running → succeeded | failed | cancelled, with rolling_back /
-- rolled_back as the recorded outcome of a partial-failure rollback (spec §14). A failed job
-- with attempts < max_attempts and a run_after in the future is an automatic retry with backoff.
--
-- deployment_steps records the ordered pipeline (validate order → validate server → pull image →
-- … → health check) with per-step timing, output and error, so a failure states exactly which
-- step failed (spec §13). deployment_events is an append-only log stream surfaced to the
-- customer via SSE (spec §24).

CREATE TABLE IF NOT EXISTS deployments (
  id uuid PRIMARY KEY,
  installation_id uuid NULL REFERENCES application_installations (id) ON DELETE CASCADE,
  server_id uuid NULL REFERENCES servers (id) ON DELETE SET NULL,
  order_id uuid NULL REFERENCES orders (id) ON DELETE SET NULL,
  action varchar(24) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'queued',
  idempotency_key varchar(128) NOT NULL,
  requested_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NULL,
  worker_id varchar(64) NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  error_code varchar(64) NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployments_action_check CHECK (
    action IN (
      'install', 'start', 'stop', 'restart', 'update', 'backup', 'restore', 'reinstall',
      'uninstall', 'ssl_provision', 'domain_configure', 'provision', 'suspend', 'terminate',
      'healthcheck'
    )
  ),
  CONSTRAINT deployments_status_check CHECK (
    status IN (
      'queued', 'running', 'succeeded', 'failed', 'cancelled',
      'rolling_back', 'rolled_back'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS deployments_idempotency_key_unique_idx ON deployments (idempotency_key);
CREATE INDEX IF NOT EXISTS deployments_queue_idx ON deployments (status, run_after)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS deployments_lease_idx ON deployments (lease_expires_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS deployments_installation_idx ON deployments (installation_id);
CREATE INDEX IF NOT EXISTS deployments_server_idx ON deployments (server_id);
CREATE INDEX IF NOT EXISTS deployments_created_idx ON deployments (created_at DESC);

CREATE TABLE IF NOT EXISTS deployment_steps (
  id uuid PRIMARY KEY,
  deployment_id uuid NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  name varchar(120) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  output text NULL,
  error text NULL,
  CONSTRAINT deployment_steps_status_check CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS deployment_steps_deployment_idx ON deployment_steps (deployment_id, step_order);
-- A deployment's pipeline is written once per step (created up-front by the engine, then
-- updated in place as each step runs) — this constraint catches a duplicate-step bug instantly.
CREATE UNIQUE INDEX IF NOT EXISTS deployment_steps_deployment_order_unique_idx
  ON deployment_steps (deployment_id, step_order);

CREATE TABLE IF NOT EXISTS deployment_events (
  id uuid PRIMARY KEY,
  deployment_id uuid NOT NULL REFERENCES deployments (id) ON DELETE CASCADE,
  level varchar(16) NOT NULL DEFAULT 'info',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployment_events_level_check CHECK (level IN ('debug', 'info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS deployment_events_deployment_idx ON deployment_events (deployment_id, created_at);
