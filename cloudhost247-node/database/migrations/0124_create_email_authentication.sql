-- Migration: 0124_create_email_authentication.sql
-- Purpose: SPF/DKIM/DMARC email authentication (G05 — email and marketing).
--
-- Design notes:
--   * One row per domain per user, storing the domain's email authentication configuration:
--     DKIM selector + public/private key pair, SPF record, DMARC record.
--   * DKIM key pairs are generated server-side (RSA 2048-bit). The private key is stored so the
--     customer can retrieve it for their mail server; in production it should be encrypted at
--     rest. No external mail or DNS provider is called by this migration — publishing DNS
--     records is the customer's or provider's responsibility.
--   * Every row is tenant-scoped via user_id (references users(id)). Staff/admin/super_admin can
--     manage any tenant's configuration.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

CREATE TABLE IF NOT EXISTS email_authentication (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  domain_name varchar(253) NOT NULL,
  dkim_selector varchar(64) NOT NULL DEFAULT 'default',
  dkim_public_key text NOT NULL,
  dkim_private_key text NOT NULL,
  spf_record text NULL,
  dmarc_record text NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_authentication_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT email_authentication_unique_domain_selector UNIQUE (user_id, domain_name, dkim_selector)
);

CREATE INDEX IF NOT EXISTS email_authentication_user_idx ON email_authentication (user_id, domain_name);
CREATE INDEX IF NOT EXISTS email_authentication_domain_idx ON email_authentication (domain_name);
CREATE INDEX IF NOT EXISTS email_authentication_status_idx ON email_authentication (status);

-- Staff-facing comment: DKIM private keys are stored so customers can configure their mail
-- servers. In production deployments these should be encrypted at rest (vault or KMS) before
-- being written here. No mail provider is configured — DNS TXT records for SPF/DKIM/DMARC must
-- be published by the customer or their DNS provider.
