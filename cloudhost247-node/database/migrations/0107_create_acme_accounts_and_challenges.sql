-- Migration: 0107_create_acme_accounts_and_challenges.sql
-- Purpose: the persistence the SSL module needs to speak ACME (RFC 8555) rather than fabricate a
-- certificate. Two tables, kept separate from `ssl_certificates` because both outlive any single
-- certificate:
--
--   `acme_accounts`  — one ACME account per directory URL. The account private key is stored as an
--                      AES-256-GCM envelope (src/lib/crypto.ts) in exactly the same shape used for
--                      provider credentials, and is NEVER returned by any endpoint. An account is
--                      reused across every order, which is what CAs expect; creating a fresh
--                      account per certificate is the behaviour that gets an IP rate-limited.
--
--   `acme_challenges` — the state of one authorization attempt. HTTP-01 needs the platform to
--                      serve `http://<domain>/.well-known/acme-challenge/<token>` with the key
--                      authorization; DNS-01 needs a TXT record published. Both need the token to
--                      outlive the HTTP request that started the order, so it is persisted here
--                      rather than held in memory. `status` mirrors the CA's own vocabulary
--                      (pending/processing/valid/invalid) and is never upgraded locally — only the
--                      CA can move an authorization to valid.
--
-- Nothing here stores a certificate: issued material continues to live on `ssl_certificates`
-- (0045) so there is exactly one place a certificate is recorded.

CREATE TABLE IF NOT EXISTS acme_accounts (
  id uuid PRIMARY KEY,
  -- The ACME directory this account belongs to. Unique per directory: an account key registered
  -- with Let's Encrypt production is not an account at the staging directory.
  directory_url text NOT NULL,
  -- The account URL returned by newAccount (the `kid` for every later signed request).
  account_url text NULL,
  -- Encrypted JWK envelope (v<keyVersion>:iv:tag:ciphertext). Never exposed, never logged.
  account_key_encrypted text NOT NULL,
  contact_email varchar(255) NULL,
  status varchar(16) NOT NULL DEFAULT 'valid',
  terms_of_service_agreed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acme_accounts_status_check CHECK (status IN ('valid', 'deactivated', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS acme_accounts_directory_unique_idx ON acme_accounts (directory_url);

CREATE TABLE IF NOT EXISTS acme_challenges (
  id uuid PRIMARY KEY,
  certificate_id uuid NOT NULL REFERENCES ssl_certificates (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES acme_accounts (id) ON DELETE CASCADE,
  authorization_url text NOT NULL,
  challenge_url text NULL,
  challenge_type varchar(16) NOT NULL,
  -- The challenge token from the CA. Not secret (it is published at a well-known URL by design),
  -- but it is the exact value the CA will compare, so it is stored rather than re-derived.
  token text NOT NULL,
  -- The exact string the CA expects: for HTTP-01 the key authorization body, for DNS-01 the
  -- base64url SHA-256 of it. Precomputed at creation so a serving route does no crypto per hit.
  key_authorization text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  -- The CA's own problem document for an invalid challenge, kept verbatim so support can quote it.
  error_detail text NULL,
  validated_at timestamptz NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acme_challenges_type_check CHECK (challenge_type IN ('HTTP_01', 'DNS_01')),
  CONSTRAINT acme_challenges_status_check CHECK (status IN ('pending', 'processing', 'valid', 'invalid'))
);

CREATE INDEX IF NOT EXISTS acme_challenges_certificate_idx ON acme_challenges (certificate_id, created_at DESC);
-- The HTTP-01 serving route looks a token up by hostname + token and must be fast and unique.
CREATE UNIQUE INDEX IF NOT EXISTS acme_challenges_authorization_unique_idx ON acme_challenges (authorization_url);
