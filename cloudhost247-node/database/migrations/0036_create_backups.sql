-- Migration: 0036_create_backups.sql
-- Purpose: Phase 6 — installation backups with off-server storage targets (spec §18).
--
-- storage_provider records WHERE the backup lives: 'local' (same server — allowed for
-- convenience but never the only copy: the platform default retention policy requires a remote
-- target be configured before scheduled backups activate), 's3' / 'r2' / 'remote' for
-- S3-compatible object storage such as Cloudflare R2, or a remote host. Backups are content-
-- addressed via checksum and expire per retention policy (platform_settings.backup.retention_days).

CREATE TABLE IF NOT EXISTS backups (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES application_installations (id) ON DELETE CASCADE,
  server_id uuid NULL REFERENCES servers (id) ON DELETE SET NULL,
  deployment_id uuid NULL REFERENCES deployments (id) ON DELETE SET NULL,
  storage_provider varchar(16) NOT NULL DEFAULT 'local',
  storage_path text NULL,
  size_bytes bigint NULL CHECK (size_bytes IS NULL OR size_bytes >= 0),
  status varchar(24) NOT NULL DEFAULT 'pending',
  checksum varchar(128) NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  expires_at timestamptz NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backups_provider_check CHECK (storage_provider IN ('local', 's3', 'r2', 'remote')),
  CONSTRAINT backups_status_check CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'expired', 'deleted')
  )
);

CREATE INDEX IF NOT EXISTS backups_installation_idx ON backups (installation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS backups_status_idx ON backups (status);
CREATE INDEX IF NOT EXISTS backups_expiry_idx ON backups (expires_at) WHERE status = 'completed';
