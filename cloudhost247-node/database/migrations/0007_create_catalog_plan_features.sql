-- Migration: 0007_create_catalog_plan_features.sql
-- Purpose: Normalized feature list for a catalog plan (Phase 3).
--
-- Replaces hard-coding feature copy inside React components: feature name/value pairs are data,
-- administered through the catalog admin API, so adding/correcting a feature line never requires
-- a frontend code change or redeploy. `visibility` lets an internal-only note (e.g. a margin/cost
-- note for ops) live alongside public marketing features on the same plan without ever being
-- returned by the public catalog API.

CREATE TABLE IF NOT EXISTS plan_features (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES product_plans (id) ON DELETE CASCADE,
  feature_name varchar(160) NOT NULL,
  feature_value text NULL,
  display_order integer NOT NULL DEFAULT 0,
  visibility varchar(16) NOT NULL DEFAULT 'public',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_features_visibility_check CHECK (visibility IN ('public', 'private'))
);

CREATE INDEX IF NOT EXISTS plan_features_plan_id_idx ON plan_features (plan_id);
CREATE INDEX IF NOT EXISTS plan_features_display_order_idx ON plan_features (display_order);
