-- Migration: 0132_create_website_access_shares.sql
-- Purpose: Add website access sharing for agency clients (J03 — J Agency).
--
-- Design notes:
--   * Creates a website_access_shares table that lets an agency client grant
--     view/edit access to one of their builder_sites to another user in the
--     same agency (or any user, scoped by agency membership).
--   * permission_level is 'viewer' or 'editor'. status is 'active' or 'revoked'.
--   * An optional expires_at allows time-limited shares.
--   * This is an internal access-control store only — no external provider is
--     called. Honest about the absence of cross-platform SSO or OAuth sharing.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

CREATE TABLE IF NOT EXISTS website_access_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES builder_sites (id) ON DELETE CASCADE,
  granted_to_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  granted_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  permission_level varchar(16) NOT NULL DEFAULT 'viewer' CHECK (permission_level IN ('viewer', 'editor')),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_access_shares_site_user_unique UNIQUE (site_id, granted_to_user_id)
);

CREATE INDEX IF NOT EXISTS website_access_shares_site_id_idx ON website_access_shares (site_id);
CREATE INDEX IF NOT EXISTS website_access_shares_granted_to_idx ON website_access_shares (granted_to_user_id);
CREATE INDEX IF NOT EXISTS website_access_shares_granted_by_idx ON website_access_shares (granted_by_user_id);
CREATE INDEX IF NOT EXISTS website_access_shares_status_idx ON website_access_shares (status);
