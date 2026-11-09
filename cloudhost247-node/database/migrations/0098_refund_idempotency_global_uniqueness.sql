-- Phase 16 hardening: a refund idempotency key identifies ONE refund operation, globally.
-- The 0097 index was per-invoice, which allowed a key to bleed onto a different invoice.
-- Global uniqueness (one key == one operation, forever) closes that. Replays are recognized
-- in application code (billing-service) and must match invoice, amount AND reason.
DROP INDEX IF EXISTS billing_ledger_idempotency_key_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS billing_ledger_idempotency_key_global_unique_idx
  ON billing_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
