-- Migration: 0005_create_catalog_product_plans.sql
-- Purpose: Plans/variants under a catalog product (Phase 3).
--
-- A "plan" is the commercially purchasable unit (e.g. "cPanel Hosting — Starter"); a product is
-- the marketing/category grouping (e.g. "cPanel Hosting"). Pricing and features attach to plans,
-- not products, because two plans under the same product can have entirely different price points
-- and feature sets.
--
-- billing_model is the *shape* of how a plan is sold (one-off vs. recurring). The actual recurring
-- cadence (monthly/quarterly/semi-annually/annually) and amounts live in plan_pricing
-- (0006_create_catalog_plan_pricing.sql) — a single recurring plan can have more than one
-- published cadence (e.g. both a monthly and an annual price).

CREATE TABLE IF NOT EXISTS product_plans (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  slug varchar(160) NOT NULL,
  name varchar(255) NOT NULL,
  description text NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  billing_model varchar(16) NOT NULL DEFAULT 'recurring',
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_plans_status_check CHECK (status IN ('draft', 'active', 'disabled')),
  CONSTRAINT product_plans_billing_model_check CHECK (billing_model IN ('one_time', 'recurring'))
);

-- Plan slugs only need to be unique within their own product (e.g. two different products could
-- both reasonably have a "starter" plan slug).
CREATE UNIQUE INDEX IF NOT EXISTS product_plans_product_slug_unique_idx
  ON product_plans (product_id, lower(slug));
CREATE INDEX IF NOT EXISTS product_plans_product_id_idx ON product_plans (product_id);
CREATE INDEX IF NOT EXISTS product_plans_status_idx ON product_plans (status);
