-- Migration: 0019_create_billing_ledger.sql
-- Purpose: Phase 5B "Billing foundation" — the append-only, immutable financial audit trail the
-- Phase 5 spec calls for explicitly ("no deleting financial history"). Every entry records one
-- financial fact about a customer's account: an invoice being issued (`charge`), money actually
-- received (`payment`), money returned (`refund`), or a manual adjustment in the customer's favor
-- (`credit`, staff-issued — not used by any code yet; reserved for Phase 5F).
--
-- `amount` is always stored as a positive magnitude; the accounting direction is implied entirely
-- by `entry_type` (a `charge` increases what the customer owes; `payment`/`credit` reduce it; a
-- `refund` reduces money previously received). This table intentionally does not compute or store
-- a running balance anywhere — a balance is always a query-time sum over these rows, never a
-- separately-maintained (and therefore driftable) number.
--
-- Unlike every other table in this codebase, this one is enforced as insert-only **at the
-- database level**, not merely by application discipline: the triggers below make any UPDATE or
-- DELETE against this table fail outright, regardless of which code path attempts it (including a
-- future bug, a manual psql session, or a compromised admin route). This is a deliberately
-- stronger guarantee than the `orders`/`order_items` tables get (which rely on "no route exposes
-- a mutation"), reserved for this table because it is explicitly named as the audit trail in the
-- Phase 5 spec. Correcting a mistaken ledger entry must always be done by inserting a new
-- *reversing* entry, never by editing or removing the original.
--
-- `invoice_id` is nullable to allow a future staff-issued `credit` entry that is not tied to any
-- specific invoice (e.g. a goodwill credit) — Phase 5B itself only ever inserts `charge` entries,
-- always with a non-null `invoice_id`. `user_id` is kept directly on the ledger (not only
-- reachable via `invoice_id`) so "this customer's full financial history" never requires an
-- invoice to exist — consistent with `credit` entries potentially having none.

CREATE TABLE IF NOT EXISTS billing_ledger (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  invoice_id uuid NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  entry_type varchar(16) NOT NULL,
  amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL,
  description varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_ledger_entry_type_check CHECK (entry_type IN ('charge', 'payment', 'refund', 'credit')),
  CONSTRAINT billing_ledger_amount_positive_check CHECK (amount > 0),
  CONSTRAINT billing_ledger_currency_upper_check CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS billing_ledger_user_id_idx ON billing_ledger (user_id);
CREATE INDEX IF NOT EXISTS billing_ledger_invoice_id_idx ON billing_ledger (invoice_id);

CREATE OR REPLACE FUNCTION billing_ledger_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing_ledger is append-only: % is not permitted on an existing row (id=%)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS billing_ledger_no_update ON billing_ledger;
CREATE TRIGGER billing_ledger_no_update
  BEFORE UPDATE ON billing_ledger
  FOR EACH ROW EXECUTE FUNCTION billing_ledger_prevent_mutation();

DROP TRIGGER IF EXISTS billing_ledger_no_delete ON billing_ledger;
CREATE TRIGGER billing_ledger_no_delete
  BEFORE DELETE ON billing_ledger
  FOR EACH ROW EXECUTE FUNCTION billing_ledger_prevent_mutation();
