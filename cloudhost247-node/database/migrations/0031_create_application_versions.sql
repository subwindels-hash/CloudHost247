-- Migration: 0031_create_application_versions.sql
-- Purpose: Phase 6 — multiple deployable versions per application (spec §9).
--
-- `manifest` stores the validated, normalized manifest document (src/marketplace/manifest-schema.ts)
-- for THIS version — image tag, ports, env contract, volumes, healthcheck, dependencies — as it
-- was at import time. The worker never reads manifests/*.yaml directly; it deploys what the
-- database says, so a manifest file edited on disk can never silently change an already-sold
-- installation's definition. Re-importing refreshes rows by (application_id, version).

CREATE TABLE IF NOT EXISTS application_versions (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  version varchar(64) NOT NULL,
  docker_image text NULL,
  manifest jsonb NOT NULL,
  minimum_cpu integer NOT NULL DEFAULT 1 CHECK (minimum_cpu > 0),
  minimum_memory_mb integer NOT NULL DEFAULT 512 CHECK (minimum_memory_mb > 0),
  minimum_storage_mb integer NOT NULL DEFAULT 5120 CHECK (minimum_storage_mb > 0),
  release_notes text NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  is_stable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_versions_status_check CHECK (status IN ('draft', 'published', 'deprecated'))
);

CREATE UNIQUE INDEX IF NOT EXISTS application_versions_app_version_unique_idx
  ON application_versions (application_id, version);
CREATE INDEX IF NOT EXISTS application_versions_application_idx ON application_versions (application_id);
CREATE INDEX IF NOT EXISTS application_versions_stable_idx ON application_versions (application_id) WHERE is_stable;
