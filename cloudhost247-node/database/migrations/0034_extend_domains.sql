-- Migration: 0034_extend_domains.sql
-- Purpose: Phase 6 — extend the existing customer_domains table (spec §15) instead of creating
-- a duplicate `domains` table.
--
-- customer_domains (Phase 4, migration 0009) was a staff-entered informational record. Phase 6
-- makes domains operational: customers can add a domain, prove control via a DNS TXT record
-- (verification_token), attach it to an installation, and get SSL provisioned for it. The
-- additive columns below give it the spec §15 shape (domain_type, provider, verification_status,
-- ssl_status, ssl expiry) while the existing status/registrar/expires_at columns keep their
-- meaning. application_domains is the join that attaches domains to installations.

ALTER TABLE customer_domains
  ADD COLUMN IF NOT EXISTS domain_type varchar(24) NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS provider varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS verification_status varchar(24) NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_method varchar(24) NULL,
  ADD COLUMN IF NOT EXISTS verification_token text NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ssl_status varchar(24) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ssl_issued_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ssl_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS created_by_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS points_to varchar(255) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_domains_domain_type_check'
  ) THEN
    ALTER TABLE customer_domains ADD CONSTRAINT customer_domains_domain_type_check
      CHECK (domain_type IN ('custom', 'subdomain', 'marketplace', 'transferred'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_domains_verification_status_check'
  ) THEN
    ALTER TABLE customer_domains ADD CONSTRAINT customer_domains_verification_status_check
      CHECK (verification_status IN ('unverified', 'pending', 'verified', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_domains_ssl_status_check'
  ) THEN
    ALTER TABLE customer_domains ADD CONSTRAINT customer_domains_ssl_status_check
      CHECK (ssl_status IN ('none', 'pending', 'issued', 'renewing', 'failed', 'expired'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS customer_domains_verification_idx ON customer_domains (verification_status);
CREATE INDEX IF NOT EXISTS customer_domains_ssl_idx ON customer_domains (ssl_status);

CREATE TABLE IF NOT EXISTS application_domains (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES application_installations (id) ON DELETE CASCADE,
  domain_id uuid NOT NULL REFERENCES customer_domains (id) ON DELETE CASCADE,
  primary_domain boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_domains_one_primary UNIQUE (installation_id, primary_domain) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS application_domains_installation_idx ON application_domains (installation_id);
CREATE INDEX IF NOT EXISTS application_domains_domain_idx ON application_domains (domain_id);
