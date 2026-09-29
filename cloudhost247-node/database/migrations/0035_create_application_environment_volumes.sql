-- Migration: 0035_create_application_environment_volumes.sql
-- Purpose: Phase 6 — per-installation environment variables (spec §16) and volumes (spec §17).
--
-- Values are encrypted at rest with the platform's AES-256-GCM envelope (src/lib/crypto.ts).
-- Non-secret values are also stored encrypted (cheap, uniform, and prevents leaking possibly
-- sensitive user input mis-tagged as non-secret); the API layer decides what may be returned:
-- secret values are NEVER included in any ordinary API response — only their keys are listed.

CREATE TABLE IF NOT EXISTS application_environment (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES application_installations (id) ON DELETE CASCADE,
  key varchar(255) NOT NULL,
  encrypted_value text NOT NULL,
  is_secret boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS application_environment_installation_key_unique_idx
  ON application_environment (installation_id, key);

CREATE TABLE IF NOT EXISTS application_volumes (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES application_installations (id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  mount_path varchar(255) NOT NULL,
  host_path text NULL,
  size_mb integer NULL CHECK (size_mb IS NULL OR size_mb > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS application_volumes_installation_name_unique_idx
  ON application_volumes (installation_id, name);
CREATE INDEX IF NOT EXISTS application_volumes_installation_idx ON application_volumes (installation_id);
