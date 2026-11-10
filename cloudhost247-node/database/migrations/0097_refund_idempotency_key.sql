-- Phase 14 (P14-01 remediation): idempotency for staff-issued refunds.
--
-- Without a client-supplied idempotency key, a staff refund whose HTTP delivery times out
-- cannot be safely retried: the retry would issue a second, real refund. The key is stored on
-- the ledger entry itself (the ledger is append-only, so the key is immutable once written)
-- and a partial unique index enforces one-key-one-refund per invoice at the engine level.

ALTER TABLE billing_ledger ADD COLUMN IF NOT EXISTS idempotency_key varchar(128) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_ledger_idempotency_key_unique_idx
  ON billing_ledger (invoice_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
