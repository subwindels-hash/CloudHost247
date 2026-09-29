-- Migration: 0038_create_audit_logs.sql
-- Purpose: Phase 6 — platform-wide audit trail (spec §54).
--
-- auth_audit_log (Phases 1–5) stays exactly as it is for authentication/payment events. This
-- table records privileged platform actions across the new surface: server registration,
-- credential rotation, catalog publish/unpublish, deployments, domain/SSL operations, backup
-- deletions, settings changes. Rows are append-only — no code path ever updates or deletes them
-- — and every privileged route writes them through src/lib/audit.ts.

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  actor_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  action varchar(96) NOT NULL,
  resource_type varchar(48) NOT NULL,
  resource_id varchar(64) NULL,
  ip_address varchar(64) NULL,
  user_agent text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs (resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
