-- Migration: 0002_create_auth_audit_log.sql
-- Purpose: Append-only audit trail for authentication events. This is the foundation table that
-- later phases (Revenue Guardian audit logs, admin activity logs) will follow the same pattern
-- for: append-only, no destructive updates/deletes from application code.

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  event_type varchar(64) NOT NULL,
  ip_address varchar(64) NULL,
  user_agent text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_audit_log_event_type_check CHECK (
    event_type IN ('register', 'login_success', 'login_failure', 'logout', 'token_refresh')
  )
);

CREATE INDEX IF NOT EXISTS auth_audit_log_user_id_idx ON auth_audit_log (user_id);
CREATE INDEX IF NOT EXISTS auth_audit_log_created_at_idx ON auth_audit_log (created_at);
