-- Migration: 0016_create_orders.sql
-- Purpose: Phase 5A "Commerce foundation" — a real, immutable order record produced by checking
-- out a cart (src/services/commerce-service.ts). This is the first genuinely financial table in
-- the platform: unlike `carts`/`cart_items`, rows here are never deleted or hard-modified by any
-- app code once created, and `user_id` deliberately does NOT cascade on delete (see below).
--
-- `order_number` is a human-facing reference, generated server-side from a dedicated sequence —
-- never client-supplied, never derived from a value that could collide under concurrent checkouts.
--
-- `status` (the order's own lifecycle) and `payment_status` (driven by the payment/webhook layer —
-- Phase 5C/5D, not yet implemented as of this migration) are intentionally separate columns: an
-- order can be `cancelled` for reasons unrelated to payment (e.g. staff void), and a `pending`
-- order always starts with `payment_status = 'unpaid'` until a verified payment event says
-- otherwise. No route in this phase (5A) ever sets `payment_status` to anything other than its
-- default — that only becomes possible once the gateway/webhook layer exists.
--
-- `subtotal_amount`/`discount_amount`/`tax_amount`/`total_amount` are computed and snapshotted
-- entirely server-side at checkout time (src/services/commerce-service.ts) from the live catalog
-- price — never accepted from the client request body. Phase 5A has no discount/tax configuration
-- system yet, so `discount_amount`/`tax_amount` are always `0` for every order created by this
-- phase; the columns exist now so a later phase can start populating them without a schema change,
-- per "taxes/fees only when actually configured" — never fabricated.
--
-- Financial-history immutability: `user_id REFERENCES users (id) ON DELETE RESTRICT` (not CASCADE)
-- is a deliberate, defensive choice — a user account must never be deletable while it has order
-- history, even though no route in this codebase currently deletes user accounts at all. This
-- mirrors the project-wide rule "no deleting financial history."

CREATE SEQUENCE IF NOT EXISTS order_number_seq;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  order_number varchar(32) NOT NULL DEFAULT ('CH-' || lpad(nextval('order_number_seq')::text, 8, '0')),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  currency char(3) NOT NULL DEFAULT 'USD',
  subtotal_amount numeric(12, 2) NOT NULL,
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  total_amount numeric(12, 2) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  payment_status varchar(16) NOT NULL DEFAULT 'unpaid',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_status_check CHECK (status IN ('pending', 'completed', 'cancelled', 'failed')),
  CONSTRAINT orders_payment_status_check CHECK (
    payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded')
  ),
  CONSTRAINT orders_amounts_non_negative_check CHECK (
    subtotal_amount >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0
  ),
  CONSTRAINT orders_currency_upper_check CHECK (currency = upper(currency))
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_unique_idx ON orders (order_number);
CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders (user_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_payment_status_idx ON orders (payment_status);
