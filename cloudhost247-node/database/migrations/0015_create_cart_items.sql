-- Migration: 0015_create_cart_items.sql
-- Purpose: Phase 5A "Commerce foundation" — line items inside a customer's cart (0014).
--
-- Deliberately stores only `plan_id`, not a separate `product_id`: the parent product is always
-- reachable via `product_plans.product_id`, and storing it twice here would create a second field
-- that could silently drift out of sync with the plan's real product. Every read joins through
-- `product_plans` (see src/db/carts.ts).
--
-- `billing_period` is captured per line (not derived from the plan alone) because a single
-- recurring plan can have more than one published cadence (e.g. monthly vs. annually — see
-- 0006_create_catalog_plan_pricing.sql) and a customer picks exactly one per cart line.
--
-- No price is stored here at all, on purpose: a cart is not yet a financial record, so its price
-- is always resolved live, server-side, from the current `plan_pricing` at read/checkout time
-- (src/services/commerce-service.ts) — never cached, never client-supplied. The immutable price
-- *snapshot* only happens once an order is actually placed (0017_create_order_items.sql).

CREATE TABLE IF NOT EXISTS cart_items (
  id uuid PRIMARY KEY,
  cart_id uuid NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES product_plans (id) ON DELETE CASCADE,
  billing_period varchar(16) NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_quantity_positive_check CHECK (quantity > 0 AND quantity <= 20),
  CONSTRAINT cart_items_billing_period_check CHECK (
    billing_period IN ('one_time', 'monthly', 'quarterly', 'semi_annually', 'annually')
  )
);

-- Adding the same plan+cadence twice increases quantity (application-level upsert against this
-- unique key) instead of creating duplicate lines.
CREATE UNIQUE INDEX IF NOT EXISTS cart_items_cart_plan_period_unique_idx
  ON cart_items (cart_id, plan_id, billing_period);
CREATE INDEX IF NOT EXISTS cart_items_cart_id_idx ON cart_items (cart_id);
