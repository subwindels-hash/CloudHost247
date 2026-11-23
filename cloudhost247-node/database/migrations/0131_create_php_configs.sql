-- Migration: 0131_create_php_configs.sql
-- Purpose: Add PHP configuration for hosting services (A08 — A Hosting).
--
-- Design notes:
--   * Creates a php_configs table that stores PHP version and settings per
--     customer service. Each service can have one PHP config record.
--   * This is an internal configuration store only. No PHP-FPM provider or
--     control panel is called to apply the version — honest about the absence
--     of a PHP runtime provider rather than fabricating PHP configuration
--     changes.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

CREATE TABLE IF NOT EXISTS php_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES customer_services (id) ON DELETE CASCADE,
  php_version varchar(16) NOT NULL DEFAULT '8.2',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT php_configs_service_unique UNIQUE (service_id)
);

CREATE INDEX IF NOT EXISTS php_configs_service_id_idx ON php_configs (service_id);
CREATE INDEX IF NOT EXISTS php_configs_php_version_idx ON php_configs (php_version);
