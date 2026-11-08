-- Migration: 0087_create_whmcs_identity.sql
-- Purpose: one customer identity, and the audit record of every SSO hand-off into the WHMCS client
-- area (B5.1). Two tables, deliberately small:
--
--   1. `whmcs_client_links` — the *only* mapping between a CloudHost247 account (`users.id`) and a
--      WHMCS client (`whmcs_client_id`). Route code reads the client id from here and never from a
--      request body, which is what stops a caller from asking to be signed in as somebody else.
--   2. `whmcs_sso_handoffs` — one row per minted SSO token: who, which client, which destination,
--      when it was minted and when it stops being usable.
--
-- Rules encoded here (read before editing):
--
--   * **One identity each way.** `user_id` is the primary key, so a CloudHost247 account can link at
--     most one WHMCS client; `whmcs_client_id` is UNIQUE, so one WHMCS client can never be shared by
--     two accounts. A merge or a mistake has to be resolved by a human, not by a race.
--   * **Nothing here stores a password or a token.** A WHMCS SSO access token lives for 60 seconds
--     and is single use; keeping a copy would create a replayable credential sitting in a table
--     backup. `whmcs_sso_handoffs` records that a token was minted, never the token itself, so the
--     table can be dumped during an incident without handing over a session.
--   * **Link method is explicit.** `verified-email-match` is the only automated path (the customer
--     proved the mailbox, and WHMCS holds the same address). `staff-assisted` exists as a named
--     value so a future support workflow has to state what it did rather than reuse a default.
--   * Deleting the account removes both rows (`ON DELETE CASCADE`); the WHMCS client itself is never
--     touched by this platform.
--   * Runs inside the migration runner's own transaction — do not add BEGIN/COMMIT here.

CREATE TABLE IF NOT EXISTS whmcs_client_links (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  whmcs_client_id integer NOT NULL,
  -- Stored lower-cased: the comparison that matters is the case-insensitive one, and normalising on
  -- write means a later lookup can be a plain equality test instead of a lower() index scan.
  whmcs_email text NOT NULL,
  link_method text NOT NULL DEFAULT 'verified-email-match',
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whmcs_client_links_client_unique UNIQUE (whmcs_client_id),
  CONSTRAINT whmcs_client_links_client_positive CHECK (whmcs_client_id > 0),
  CONSTRAINT whmcs_client_links_method_check CHECK (link_method IN ('verified-email-match', 'staff-assisted')),
  CONSTRAINT whmcs_client_links_email_normalised CHECK (whmcs_email = lower(whmcs_email)),
  CONSTRAINT whmcs_client_links_email_shape CHECK (whmcs_email <> '' AND position('@' IN whmcs_email) > 1)
);

CREATE TABLE IF NOT EXISTS whmcs_sso_handoffs (
  -- Application-generated uuid (the migration runner does not assume pgcrypto; see 0001).
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  whmcs_client_id integer NOT NULL,
  -- The WHMCS SSO scope that was requested, e.g. `clientarea:invoices`. Never a URL: the redirect
  -- target comes back from WHMCS, not from the caller.
  destination text NOT NULL,
  -- The revoked-token `jti` of the CloudHost247 session that asked for the hand-off. Kept for audit
  -- only; it is not a credential for anything, and the hand-off is not redeemable by presenting it.
  session_jti varchar(64),
  -- Mint time + 60s (WHMCS's own ceiling). A row past this instant is evidence, not an invitation.
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whmcs_sso_handoffs_destination_length CHECK (char_length(destination) BETWEEN 1 AND 64),
  CONSTRAINT whmcs_sso_handoffs_client_positive CHECK (whmcs_client_id > 0),
  CONSTRAINT whmcs_sso_handoffs_expiry_after_creation CHECK (expires_at > created_at)
);

-- The query the rate limiter runs: "how many hand-offs for this user in the last window".
CREATE INDEX IF NOT EXISTS whmcs_sso_handoffs_user_created_idx
  ON whmcs_sso_handoffs (user_id, created_at DESC);
