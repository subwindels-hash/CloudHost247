-- Migration: 0126_add_auto_renew_to_domains.sql
-- Purpose: Automatic renewal controls (I12 — domains and DNS).
--
-- Design notes:
--   * Adds an `auto_renew` toggle to `customer_domains`. When true, the domain is flagged for
--     automatic renewal at expiry; when false, the customer must renew manually.
--   * This is purely a backend toggle stored on the customer domain record. No registrar
--     provider is called — actual renewal depends on a registrar integration that is not yet
--     activated. Honest about the absence of a registrar provider rather than fabricating
--     renewal behavior.
--   * Default is false (manual renewal) for existing records; new records can opt in.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

ALTER TABLE customer_domains
  ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS customer_domains_auto_renew_idx
  ON customer_domains (auto_renew, updated_at DESC);

-- Staff-facing comment: auto_renew is a customer-facing preference stored on the domain record.
-- No renewal is actually performed by this migration — a registrar provider must be configured
-- before any automatic renewal can occur.
