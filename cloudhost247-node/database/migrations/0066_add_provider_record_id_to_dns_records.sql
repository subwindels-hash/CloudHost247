-- ============================================================================
-- Migration 0066: DNS records keep their external provider's record identifier
-- ============================================================================
-- The Cloudflare and Route 53 connectors (A11) need the provider's own record identifier to update
-- or delete a record without guessing: Cloudflare addresses records by its record id, and Route 53
-- record sets are identified by (name, type) with their exact deployed values. Rows created on the
-- INTERNAL engine keep this column NULL.
--
-- Additive and non-destructive: one nullable column plus an index. Historical rows stay valid; the
-- connectors fall back to an explicit, ambiguity-refusing lookup for them.

ALTER TABLE dns_records ADD COLUMN IF NOT EXISTS provider_record_id varchar(255);

CREATE INDEX IF NOT EXISTS dns_records_provider_record_idx
  ON dns_records (zone_id, provider_record_id)
  WHERE provider_record_id IS NOT NULL;
