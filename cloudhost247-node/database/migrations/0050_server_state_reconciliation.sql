-- Server state reconciliation.
--
-- Until now a server's recorded state only ever changed when CloudHost247 itself acted on it.
-- If a customer powered a machine off from the provider's own console, if the provider moved or
-- reassigned its IP, or if the instance was destroyed outside the platform, the dashboard kept
-- claiming the old state indefinitely.
--
-- `last_reconciled_at` lets the worker round-robin through servers oldest-first so one broken
-- provider cannot starve the rest, and records when reality was last confirmed.
--
-- Additive: the column is nullable and NULL sorts first, so existing servers are checked before
-- anything that has already been verified.

ALTER TABLE servers ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS servers_reconciliation_idx
  ON servers (last_reconciled_at NULLS FIRST)
  WHERE provider_server_id IS NOT NULL;
