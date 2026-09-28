-- Migration: 0006_create_catalog_plan_pricing.sql
-- Purpose: Pricing entries for a catalog plan (Phase 3).
--
-- This table is explicitly designed to support a plan existing *before* real pricing is available
-- to publish, per the standing project rule "never invent prices": `amount` is nullable, and a row
-- is only eligible to be returned by the public catalog API once `effective_status = 'published'`.
-- A CHECK constraint (below) makes it impossible to mark a row published without a real amount —
-- so there is no code path that can accidentally expose a fabricated/placeholder price as if it
-- were real.
--
-- A single plan can have more than one price row: different billing_period cadences (e.g. both a
-- monthly and an annually-discounted price for the same recurring plan), and/or, in principle,
-- more than one currency once multi-currency billing is needed (not used in Phase 3 — see
-- docs/API_CATALOG.md for the current single-currency-per-row assumption the public API makes).

CREATE TABLE IF NOT EXISTS plan_pricing (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES product_plans (id) ON DELETE CASCADE,
  billing_period varchar(16) NOT NULL,
  currency char(3) NOT NULL,
  amount numeric(12, 2) NULL,
  setup_fee numeric(12, 2) NULL,
  effective_status varchar(16) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_pricing_billing_period_check CHECK (
    billing_period IN ('one_time', 'monthly', 'quarterly', 'semi_annually', 'annually')
  ),
  CONSTRAINT plan_pricing_currency_check CHECK (currency = upper(currency)),
  CONSTRAINT plan_pricing_amount_non_negative_check CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT plan_pricing_setup_fee_non_negative_check CHECK (setup_fee IS NULL OR setup_fee >= 0),
  CONSTRAINT plan_pricing_effective_status_check CHECK (effective_status IN ('draft', 'published')),
  -- The core "never fabricate a price" guarantee at the database layer: a row can only be
  -- published once it actually carries a real amount.
  CONSTRAINT plan_pricing_published_requires_amount_check CHECK (
    effective_status <> 'published' OR amount IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS plan_pricing_plan_period_currency_unique_idx
  ON plan_pricing (plan_id, billing_period, currency);
CREATE INDEX IF NOT EXISTS plan_pricing_plan_id_idx ON plan_pricing (plan_id);
CREATE INDEX IF NOT EXISTS plan_pricing_effective_status_idx ON plan_pricing (effective_status);
