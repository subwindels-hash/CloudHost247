-- Migration: 0130_add_custom_domain_to_stores.sql
-- Purpose: Add custom domain support to online stores (H07 — H Ecommerce).
--
-- Design notes:
--   * Adds a nullable `custom_domain` column to `store_stores` so a merchant can
--     expose their store under their own domain (e.g. shop.example.com).
--   * The column is unique so two stores cannot claim the same custom domain.
--   * No DNS verification or SSL provisioning is performed here — those depend on
--     a DNS/CA provider that is not yet configured. The field stores the merchant's
--     intended domain honestly; resolution is left to the storefront layer.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

ALTER TABLE store_stores
  ADD COLUMN IF NOT EXISTS custom_domain varchar(255) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS store_stores_custom_domain_unique_idx
  ON store_stores (lower(custom_domain)) WHERE custom_domain IS NOT NULL;
