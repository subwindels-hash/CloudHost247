-- Migration: 0020_create_payments.sql
-- Purpose: Phase 5B "Billing foundation" — the schema for an individual payment *attempt* against
-- an invoice. This table is created now so the data model for the rest of Phase 5 is settled, but
-- as of this migration **no code anywhere creates a row in this table** — there is no payment
-- gateway yet (that is Phase 5C: the abstraction layer, a manual/offline gateway, and a
-- self-contained sandbox gateway with simulated signed webhooks). Introducing the schema ahead of
-- the gateway work lets 5C build directly on a reviewed, stable table instead of redesigning it
-- under time pressure once a real gateway shape is known.
--
-- `status` models the real payment lifecycle the Phase 5 spec calls for (pending/successful/
-- failed/cancelled/expired/refunded/partially refunded) — a customer must always see the genuine
-- state, never a fabricated "success". Every payment starts `pending` and a later phase's verified
-- webhook processing (5D) is the only thing ever allowed to move it forward — never a client
-- callback, never a browser redirect result.
--
-- `provider`/`provider_reference` identify which gateway handled this attempt and that gateway's
-- own transaction id for it. The partial unique index below on `(provider, provider_reference)`
-- (only enforced when both are present) is deliberately here *now*, even though nothing writes to
-- this table yet: it is the exact idempotency guarantee Phase 5D's webhook handling will depend on
-- — the same verified webhook event replayed twice must never create two payment records.
--
-- `invoice_id` is `ON DELETE RESTRICT` (a paid-against invoice can never be deleted out from under
-- its payment history) and `user_id` is kept directly on the row for the same direct-query reason
-- as `invoices.user_id` and `billing_ledger.user_id`.

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  provider varchar(32) NULL,
  provider_reference varchar(255) NULL,
  method varchar(32) NULL,
  amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  failure_reason text NULL,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_status_check CHECK (
    status IN ('pending', 'successful', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded')
  ),
  CONSTRAINT payments_amount_positive_check CHECK (amount > 0),
  CONSTRAINT payments_currency_upper_check CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments (user_id);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
-- Idempotency guarantee for the future webhook layer (Phase 5D): the same provider transaction can
-- never be recorded as two different payment rows.
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_unique_idx
  ON payments (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;
