-- Migration: 0030_create_applications.sql
-- Purpose: Phase 6 — the database-driven application catalog (spec §8, §48, §49).
--
-- The catalog is data, not code: application pages are rendered from these rows, and deployable
-- definitions live in application_versions.manifest (imported from manifests/*.yaml). Status is
-- the admin approval workflow (spec §47): draft → validating → testing → approved → published,
-- with 'suspended'/'deprecated' as terminal/held states. Only 'published' applications are
-- installable by customers; a 'published' app whose status is later moved to 'suspended' stops
-- new installs but leaves existing installations running.
--
-- supported_hosting_types drives wizard compatibility (spec §48): the installer hides/disables
-- infrastructure an application cannot run on. requirements_* are the *minimums* advertised on
-- the marketplace card; per-version minimums live on application_versions.

CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY,
  category_id uuid NULL REFERENCES application_categories (id) ON DELETE SET NULL,
  name varchar(160) NOT NULL,
  slug varchar(160) NOT NULL,
  description text NOT NULL,
  long_description text NULL,
  logo_url text NULL,
  website_url text NULL,
  repository_url text NULL,
  documentation_url text NULL,
  license varchar(64) NULL,
  deployment_type varchar(24) NOT NULL DEFAULT 'docker_compose',
  status varchar(24) NOT NULL DEFAULT 'draft',
  featured boolean NOT NULL DEFAULT false,
  popularity integer NOT NULL DEFAULT 0,
  requires_admin_approval boolean NOT NULL DEFAULT false,
  min_cpu integer NOT NULL DEFAULT 1 CHECK (min_cpu > 0),
  min_memory_mb integer NOT NULL DEFAULT 512 CHECK (min_memory_mb > 0),
  min_storage_mb integer NOT NULL DEFAULT 5120 CHECK (min_storage_mb > 0),
  recommended_cpu integer NOT NULL DEFAULT 2,
  recommended_memory_mb integer NOT NULL DEFAULT 2048,
  recommended_storage_mb integer NOT NULL DEFAULT 20480,
  gpu_required boolean NOT NULL DEFAULT false,
  supported_hosting_types text[] NOT NULL DEFAULT '{docker}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applications_deployment_type_check CHECK (
    deployment_type IN ('docker_compose', 'cpanel', 'kubernetes')
  ),
  CONSTRAINT applications_status_check CHECK (
    status IN ('draft', 'validating', 'testing', 'approved', 'published', 'suspended', 'deprecated')
  ),
  CONSTRAINT applications_hosting_type_check CHECK (
    supported_hosting_types <@ ARRAY['shared','cpanel','vps','dedicated','docker','kubernetes']::text[]
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS applications_slug_unique_idx ON applications (lower(slug));
CREATE INDEX IF NOT EXISTS applications_category_idx ON applications (category_id);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications (status);
CREATE INDEX IF NOT EXISTS applications_featured_idx ON applications (featured) WHERE featured;
CREATE INDEX IF NOT EXISTS applications_popularity_idx ON applications (popularity DESC);
