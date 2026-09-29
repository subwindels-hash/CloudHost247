-- Migration: 0029_create_application_categories.sql
-- Purpose: Phase 6 — marketplace application categories (spec §7).

CREATE TABLE IF NOT EXISTS application_categories (
  id uuid PRIMARY KEY,
  name varchar(80) NOT NULL,
  slug varchar(80) NOT NULL,
  description text NULL,
  icon_url text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS application_categories_slug_unique_idx ON application_categories (lower(slug));
CREATE INDEX IF NOT EXISTS application_categories_active_sort_idx ON application_categories (active, sort_order);
