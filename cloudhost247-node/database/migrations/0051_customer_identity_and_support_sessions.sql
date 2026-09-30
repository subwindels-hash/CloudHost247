-- Migration: 0051_customer_identity_and_support_sessions.sql
-- Purpose: Customer identity (permanent six-digit Customer ID), the rotating four-digit Security
-- Number credential, self-service profile fields, profile images, and delegated admin "support
-- mode" sessions.
--
-- Notes:
--   * Additive only. `users.id` (uuid) remains the primary key and every existing foreign key is
--     untouched — the Customer ID is a human-readable business identifier, never a relational key.
--   * Runs inside the migration runner's own transaction — do not add BEGIN/COMMIT here.
--   * No extensions required (pgcrypto/uuid-ossp are frequently unavailable on shared hosting —
--     see 0001_create_users.sql). Application-generated values use Node's CSPRNG; the one-off
--     backfill below uses PostgreSQL's own random() purely to assign identifiers to pre-existing
--     rows, which is an opaque, non-secret account number, not a credential.
--   * The Security Number itself is NEVER stored in plaintext anywhere: only a bcrypt hash lives
--     in `users.security_number_hash`.

-- --- Customer identity + self-service profile fields ------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS customer_id varchar(6),
  ADD COLUMN IF NOT EXISTS security_number_hash text,
  ADD COLUMN IF NOT EXISTS security_number_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS security_number_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS security_number_version integer NOT NULL DEFAULT 1,
  -- Legacy accounts have no Security Number yet. They are explicitly marked uninitialized rather
  -- than being given an invented plaintext value, and are guided through initialization.
  ADD COLUMN IF NOT EXISTS security_number_initialized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone varchar(32),
  ADD COLUMN IF NOT EXISTS address_line1 varchar(255),
  ADD COLUMN IF NOT EXISTS city varchar(120),
  ADD COLUMN IF NOT EXISTS state varchar(120),
  ADD COLUMN IF NOT EXISTS postal_code varchar(32),
  ADD COLUMN IF NOT EXISTS country varchar(64),
  -- Soft deletion: financial/audit history must survive account removal (see spec §22/§58).
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Existing accounts must not stay NULL. Assigns a unique six-digit identifier to every row that
-- does not have one yet, retrying on the (unlikely) collision. Idempotent: re-running the
-- migration finds nothing left to backfill.
DO $backfill$
DECLARE
  target record;
  candidate varchar(6);
  assigned boolean;
BEGIN
  FOR target IN SELECT id FROM users WHERE customer_id IS NULL LOOP
    assigned := false;
    WHILE NOT assigned LOOP
      candidate := lpad((floor(random() * 1000000))::int::text, 6, '0');
      IF NOT EXISTS (SELECT 1 FROM users WHERE customer_id = candidate) THEN
        UPDATE users SET customer_id = candidate WHERE id = target.id;
        assigned := true;
      END IF;
    END LOOP;
  END LOOP;
END
$backfill$;

-- The unique constraint is the authoritative collision check: application code generates a
-- candidate and retries when the insert is rejected, so two concurrent registrations can never
-- be assigned the same Customer ID.
CREATE UNIQUE INDEX IF NOT EXISTS users_customer_id_unique_idx ON users (customer_id);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_id_format_check;
ALTER TABLE users ADD CONSTRAINT users_customer_id_format_check
  CHECK (customer_id IS NULL OR customer_id ~ '^[0-9]{6}$');

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_security_number_version_check;
ALTER TABLE users ADD CONSTRAINT users_security_number_version_check CHECK (security_number_version >= 1);

-- 'deleted' joins the existing lifecycle so soft-deleted accounts are refused at login by the
-- same status check that already handles suspended/disabled accounts.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'suspended', 'disabled', 'deleted'));

-- 'staff' is already accepted by the application's role union (src/db/users.ts) but was missing
-- from the original CHECK constraint; keeping both in sync avoids a write-time surprise.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('customer', 'staff', 'admin', 'super_admin'));

-- --- Security Number verification attempts (rate limiting + security auditing) ----------------

CREATE TABLE IF NOT EXISTS security_number_attempts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  succeeded boolean NOT NULL,
  ip_address varchar(64) NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_number_attempts_user_idx
  ON security_number_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_number_attempts_ip_idx
  ON security_number_attempts (ip_address, created_at DESC);

-- --- Profile images ----------------------------------------------------------------------------
--
-- Stored in the platform's own database rather than introducing a second storage system: this
-- deployment (cPanel/Passenger, see docs/CPANEL_DEPLOYMENT.md) has no object-storage abstraction,
-- and avatars are small, strictly size-capped binaries that are then backed up and replicated
-- with everything else. Bytes are served by an authenticated route, never from a public path, and
-- the content type is whitelisted server-side (no SVG, no HTML, nothing executable).

CREATE TABLE IF NOT EXISTS user_profile_images (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  content_type varchar(64) NOT NULL,
  byte_size integer NOT NULL,
  checksum varchar(64) NOT NULL,
  data bytea NOT NULL,
  uploaded_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profile_images_type_check CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  CONSTRAINT user_profile_images_size_check CHECK (byte_size > 0 AND byte_size <= 2097152)
);

-- --- Delegated admin support sessions ("switch to customer account") ---------------------------
--
-- An administrator never learns the customer's password or Security Number. Switching mints a
-- short-lived, separately-tracked delegated session recorded here, so every access is auditable:
-- who, which customer, when, for how long, and whether it was ended explicitly or expired.

CREATE TABLE IF NOT EXISTS admin_support_sessions (
  id uuid PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  customer_uuid uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  customer_id varchar(6) NULL,
  reason varchar(255) NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  ended_reason varchar(32) NULL,
  ip_address varchar(64) NULL,
  user_agent text NULL,
  CONSTRAINT admin_support_sessions_ended_reason_check
    CHECK (ended_reason IS NULL OR ended_reason IN ('admin_exit', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS admin_support_sessions_admin_idx ON admin_support_sessions (admin_id, started_at DESC);
CREATE INDEX IF NOT EXISTS admin_support_sessions_customer_idx ON admin_support_sessions (customer_uuid, started_at DESC);
CREATE INDEX IF NOT EXISTS admin_support_sessions_active_idx ON admin_support_sessions (expires_at) WHERE ended_at IS NULL;
