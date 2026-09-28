-- Migration: 0009_create_customer_domains.sql
-- Purpose: Phase 4 "Customer App" — a purely informational record of a domain name a customer
-- already owns/has registered, entered and maintained only by authorized staff.
--
-- Exactly like customer_services (see 0008), this table has NO automation hooks: it never calls a
-- registrar API, never performs a real availability check, and never registers/renews/transfers
-- anything. It is a staff-maintained record for display only, distinct from the public "Domains"
-- marketing page (which already explicitly tells visitors no live registrar connection exists —
-- see frontend/src/pages/DomainsMarketingPage.tsx).
--
-- `domain_name` is intentionally NOT globally unique at the database level: this is a staff record
-- of what a customer says/is known to own, not a live authoritative registry, so re-entering the
-- same domain (e.g. after a transfer between two of a customer's own accounts, or correcting a
-- migration mistake) must never be blocked by a hard uniqueness constraint.

CREATE TABLE IF NOT EXISTS customer_domains (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  domain_name varchar(255) NOT NULL,
  registrar varchar(255) NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  expires_at date NULL,
  external_reference varchar(255) NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_domains_status_check CHECK (status IN ('active', 'expired', 'pending_transfer', 'pending_migration'))
);

CREATE INDEX IF NOT EXISTS customer_domains_user_id_idx ON customer_domains (user_id);
CREATE INDEX IF NOT EXISTS customer_domains_status_idx ON customer_domains (status);
