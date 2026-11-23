-- Migration: 0123_create_email_forwarders.sql
-- Purpose: Email forwarding rules (G06 — email forwarding).
--
-- Design notes:
--   * A forwarder maps a local address (e.g. support@customer.example) to a destination
--     address (e.g. support-team@customer.example). Multiple destination addresses may be
--     configured for one local address; each is a separate forwarder row.
--   * Every forwarder is tenant-scoped via user_id (references users(id)). A customer can only
--     manage forwarders for addresses they own. Staff/admin/super_admin can list across tenants.
--   * No SMTP, IMAP, or mail provider is configured by this migration. Forwarding rules are
--     stored and exposed for staff/customer use; actual delivery depends on a mail provider that
--     is not yet configured (honest about the absence rather than fabricating delivery).
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

CREATE TABLE IF NOT EXISTS email_forwarders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  local_address varchar(320) NOT NULL,
  destination_address varchar(320) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_forwarders_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT email_forwarders_unique_active_per_user_dest UNIQUE (user_id, local_address, destination_address)
);

CREATE INDEX IF NOT EXISTS email_forwarders_user_idx ON email_forwarders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_forwarders_local_idx ON email_forwarders (local_address);
CREATE INDEX IF NOT EXISTS email_forwarders_status_idx ON email_forwarders (status);

-- Staff-facing comment: destination addresses are not verified against a mail server. The
-- forwarder rule is stored as configured; delivery is the mail provider's responsibility.
