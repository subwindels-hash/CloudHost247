-- Migration: 0017_create_order_items.sql
-- Purpose: Phase 5A "Commerce foundation" — the immutable line items of an order (0016), each
-- carrying a full price *snapshot* taken at the moment of checkout.
--
-- `product_name_snapshot`/`plan_name_snapshot`/`unit_price_amount`/`currency`/`line_total_amount`
-- are copied from the catalog at checkout time and never updated afterward, by design: this is
-- the mechanism that guarantees a later catalog price change, rename, or even deletion can never
-- alter what a historical order says the customer agreed to pay. `product_id`/`plan_id` are kept
-- only as optional, best-effort soft links back to the live catalog (`ON DELETE SET NULL` — a
-- retired/deleted catalog row must never corrupt or cascade-delete order history); every display
-- of an order must read the `*_snapshot` columns, never re-join to the live catalog for the name
-- or price.
--
-- `order_id` cascades on delete purely for structural/administrative reasons (no app route ever
-- deletes an order — see 0016's comment); it is not a statement that order items are disposable.

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id uuid NULL REFERENCES products (id) ON DELETE SET NULL,
  plan_id uuid NULL REFERENCES product_plans (id) ON DELETE SET NULL,
  product_name_snapshot varchar(255) NOT NULL,
  plan_name_snapshot varchar(255) NOT NULL,
  billing_period varchar(16) NOT NULL,
  quantity integer NOT NULL,
  unit_price_amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL,
  line_total_amount numeric(12, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_quantity_positive_check CHECK (quantity > 0 AND quantity <= 20),
  CONSTRAINT order_items_amounts_non_negative_check CHECK (
    unit_price_amount >= 0 AND line_total_amount >= 0
  ),
  CONSTRAINT order_items_billing_period_check CHECK (
    billing_period IN ('one_time', 'monthly', 'quarterly', 'semi_annually', 'annually')
  ),
  CONSTRAINT order_items_currency_upper_check CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
