-- Migration: 0080_allow_multiple_domain_lines_per_order.sql
-- Purpose: the unified cart can hold more than one domain line, so a single checkout may now
-- genuinely produce one order containing a registration AND a transfer, or two registrations.
--
-- 0063 created `domain_registrations.order_id` and `domain_transfers.order_id` as UNIQUE, which
-- encoded the assumption of the previous one-domain-per-checkout flow. That assumption no longer
-- holds; the UNIQUE constraint is replaced by a plain index (so the "find the registration behind
-- this order item" lookup stays indexed) and nothing else changes. Every existing row remains
-- valid, and no data is rewritten.
--
-- The constraints that actually protect the platform are untouched:
--   * `domain_registrations_live_domain_unique_idx` still allows at most one LIVE registration per
--     domain name.
--   * `customer_domain_id` stays UNIQUE on both tables (one registration/transfer per customer
--     domain record).
--   * `cart_service_items_registration_unique_idx` (0071) stops one draft being added twice.

ALTER TABLE domain_registrations DROP CONSTRAINT IF EXISTS domain_registrations_order_id_key;
ALTER TABLE domain_transfers DROP CONSTRAINT IF EXISTS domain_transfers_order_id_key;

CREATE INDEX IF NOT EXISTS domain_registrations_order_idx ON domain_registrations (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS domain_transfers_order_idx ON domain_transfers (order_id) WHERE order_id IS NOT NULL;
