-- Migration: 0018_create_invoices.sql
-- Purpose: Phase 5B "Billing foundation" — the formal billing document produced for an order.
--
-- One invoice per order in this phase (`order_id` is UNIQUE): there is no recurring/subscription
-- billing yet (that belongs to a later phase, alongside the cPanel-provisioning work this project
-- explicitly excludes from Phase 5), so "checkout an order" and "get invoiced for it" are still a
-- 1:1 relationship. `invoice_number` is generated the same proven way as `orders.order_number`
-- (0016) — a dedicated sequence, DB-generated, never client- or app-supplied, race-free under
-- concurrent checkouts.
--
-- `subtotal_amount`/`discount_amount`/`tax_amount`/`total_amount`/`currency` are a **snapshot**,
-- copied from the order at the moment the invoice is issued (src/services/billing-service.ts),
-- not a live join to `orders` — an invoice is its own billing record, not merely a view of one.
-- Phase 5B has no tax/discount configuration system yet, so — exactly like `orders` — every
-- invoice's `discount_amount`/`tax_amount` is genuinely `0` here, never fabricated.
--
-- `due_date` defaults to the issue date (`CURRENT_DATE`) — i.e. due on receipt. This is a
-- deliberately conservative, honest default: there is no payment-terms configuration system yet
-- (e.g. "net 7", "net 30"), so this migration does not invent one. A future phase can add
-- configurable payment terms without a schema change (this column already exists and is already
-- nullable-safe to recompute).
--
-- Unlike `order_items`, `invoices.status` is expected to change after creation — Phase 5D's
-- verified-webhook processing is what will move it from `unpaid` to `paid` (or `refunded` /
-- `partially_refunded`), hence `updated_at`. No code in Phase 5B ever sets it to anything but the
-- default `unpaid` — there is no payment gateway wired up yet.
--
-- `order_id`/`user_id` are both `ON DELETE RESTRICT`, matching `orders.user_id` (0016): a customer
-- or an order that has an invoice can never be deleted out from under it. `user_id` is kept
-- alongside `order_id` (rather than requiring a join through `orders` for every customer-scoped
-- query) purely for direct, efficient "this customer's invoices" lookups.

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY,
  invoice_number varchar(32) NOT NULL DEFAULT ('INV-' || lpad(nextval('invoice_number_seq')::text, 8, '0')),
  order_id uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  currency char(3) NOT NULL DEFAULT 'USD',
  subtotal_amount numeric(12, 2) NOT NULL,
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  total_amount numeric(12, 2) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'unpaid',
  due_date date NOT NULL DEFAULT CURRENT_DATE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_status_check CHECK (status IN ('unpaid', 'paid', 'void', 'refunded', 'partially_refunded')),
  CONSTRAINT invoices_amounts_non_negative_check CHECK (
    subtotal_amount >= 0 AND discount_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0
  ),
  CONSTRAINT invoices_currency_upper_check CHECK (currency = upper(currency))
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_unique_idx ON invoices (invoice_number);
-- One invoice per order, in this phase (see comment above).
CREATE UNIQUE INDEX IF NOT EXISTS invoices_order_id_unique_idx ON invoices (order_id);
CREATE INDEX IF NOT EXISTS invoices_user_id_idx ON invoices (user_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status);
