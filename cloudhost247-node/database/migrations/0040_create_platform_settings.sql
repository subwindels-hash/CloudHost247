-- Migration: 0040_create_platform_settings.sql
-- Purpose: Phase 6 — admin-configurable platform settings (spec §21 grace period, §18 retention).
--
-- A small, typed key-value store read through src/db/platform-settings.ts with safe defaults so
-- the platform runs with no rows present. Keys are dot-namespaced and validated in the admin
-- API (src/routes/admin-settings.ts); values are jsonb so a setting can be a scalar or an object
-- without schema churn. Every change is audit-logged.

CREATE TABLE IF NOT EXISTS platform_settings (
  key varchar(96) PRIMARY KEY,
  value jsonb NOT NULL,
  description text NULL,
  updated_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (key, value, description) VALUES
  ('subscription.grace_period_days', '7', 'Days a past-due subscription stays in grace_period before suspension'),
  ('subscription.suspend_after_days', '7', 'Days in grace_period before the subscription is suspended'),
  ('backup.retention_days', '30', 'Default backup retention before expiry cleanup'),
  ('deployment.max_attempts', '3', 'Maximum attempts for a retried deployment job'),
  ('marketplace.require_approval', 'false', 'Whether newly imported applications require admin approval before publishing')
ON CONFLICT (key) DO NOTHING;
