-- Migration: 0085_customer_username_pin_and_verification.sql
-- Purpose: the customer identity contract requested for account security:
--   1. a unique, immutable-in-spirit **username** every customer can create and later change,
--   2. a permanent, globally unique **nine-digit Customer ID** (supersedes the six-digit number
--      added in 0053 for new accounts; existing six-digit values are widened in place, never
--      re-issued, so no customer's number changes meaning),
--   3. an automatically rotating **four-digit Security PIN** that is generated server-side every
--      24 hours and can only be read after a fresh six-digit email verification challenge,
--   4. the email-verification challenges that gate PIN viewing (single use, 10-minute TTL,
--      attempt counters, resend throttling), and
--   5. account-recovery requests raised when a customer cannot complete that verification.
--
-- Notes and invariants (read before editing):
--   * Additive only. `users.id` (uuid) stays the primary key; every existing foreign key still
--     points at it. The Customer ID is a human-readable business identifier, never a relational
--     key, and the PIN is never a relational key either.
--   * Runs inside the migration runner's own transaction — do not add BEGIN/COMMIT here.
--   * No extensions are required (pgcrypto/uuid-ossp are frequently unavailable on shared
--     hosting — see 0001_create_users.sql). Application-generated values use Node's CSPRNG. The
--     one backfill below uses PostgreSQL's own random(), purely to assign an opaque, non-secret
--     account number to rows that predate this migration.
--   * The Security PIN plaintext is NEVER stored, here or anywhere else: `users.security_pin_hash`
--     holds an HMAC of the PIN under a server-held key plus per-value random salt, so it can be
--     verified afterwards (unlike a one-way hash that could never be shown to its owner) without
--     the database alone ever being enough to read it.
--   * Audit rows never contain a PIN, a verification code, or a challenge token. Only metadata.

-- --- Username ---------------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username varchar(32),
  -- Case-insensitive uniqueness is enforced by a unique index on lower(username) below; the stored
  -- value preserves the customer's own capitalisation for display.
  --
  -- `username_changed_at` exists so account settings can show when the name last changed and so a
  -- future abuse policy (e.g. a cool-down between changes) has a value to read. There is no
  -- reserved-name column: impersonation is prevented by the `reserved_usernames` table plus the
  -- static list in src/services/username-service.ts, both consulted on every change.
  ADD COLUMN IF NOT EXISTS username_changed_at timestamptz;

-- Backfill every existing account with a unique, derived username. The derivation is deliberately
-- deterministic and human-recognisable (local-part of the email, punctuation removed) rather than
-- random, because these customers did not choose one and support staff must be able to guess it.
-- A collision is resolved by appending a numeric suffix; the loop retries until the unique index
-- below would accept the value.
DO $usernames$
DECLARE
  target record;
  base text;
  candidate text;
  suffix integer;
  taken boolean;
BEGIN
  FOR target IN SELECT id, email FROM users WHERE username IS NULL LOOP
    base := left(lower(regexp_replace(split_part(coalesce(target.email, ''), '@', 1), '[^a-zA-Z0-9]', '', 'g')), 24);
    IF length(base) < 3 THEN
      base := 'customer';
    END IF;
    -- A username may not begin with a digit or an underscore (see users_username_format_check).
    IF base ~ '^[0-9_]' THEN
      base := 'u' || base;
    END IF;
    candidate := base;
    suffix := 0;
    LOOP
      SELECT EXISTS (
        SELECT 1 FROM users WHERE username IS NOT NULL AND lower(username) = lower(candidate)
      ) INTO taken;
      EXIT WHEN NOT taken;
      suffix := suffix + 1;
      candidate := left(base, 26) || suffix::text;
    END LOOP;
    UPDATE users SET username = candidate WHERE id = target.id;
  END LOOP;
END
$usernames$;

-- Usernames are never NULL once this migration has run. The NOT NULL constraint is deliberately
-- *not* added here: an account that is created without a username (an out-of-band import, a
-- fixture, a future code path that forgets) must not fail the whole insert — every real write path
-- goes through username-service, and a missing name is repaired by the trigger below. A hard
-- constraint would instead turn one sloppy INSERT into a 500 at a random call site.
--
-- `lower(username)` is still unique, and NULLs are distinct in a unique index, so a row without a
-- name cannot collide with a real one. The trigger assigns a derived, unique name on the next
-- write, so the column converges to non-NULL without ever blocking an insert.
CREATE OR REPLACE FUNCTION users_username_backfill() RETURNS trigger AS $uname$
DECLARE
  base text;
  suffix text;
BEGIN
  IF NEW.username IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Derive from the email local part: letters and digits only, lowercased, never starting with a
  -- digit. Exactly mirroring src/services/username-service.ts (`deriveUsernameCandidate`) keeps the
  -- name support staff would guess identical to the one the application would have chosen.
  base := lower(regexp_replace(split_part(coalesce(NEW.email, ''), '@', 1), '[^a-zA-Z0-9]', '', 'g'));
  base := left(coalesce(base, ''), 24);
  IF length(base) < 3 THEN
    base := 'customer';
  END IF;
  IF base ~ '^[0-9]' THEN
    base := 'u' || left(base, 23);
  END IF;

  -- A collision is resolved with a suffix taken from the row's own primary key. Both parts are
  -- hard-bounded (24 + 8 = 32) so the result can never exceed the varchar(32) column, whatever the
  -- email looks like. Getting this wrong is not a cosmetic bug: the assignment happens inside the
  -- INSERT trigger, so an over-long name aborts the whole account creation.
  NEW.username := base;
  IF EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(NEW.username) AND id <> NEW.id) THEN
    suffix := substr(replace(NEW.id::text, '-', ''), 1, 8);
    NEW.username := left(base, 24) || suffix;
  END IF;
  RETURN NEW;
END
$uname$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_username_backfill_trigger ON users;
CREATE TRIGGER users_username_backfill_trigger
  BEFORE INSERT OR UPDATE OF email ON users
  FOR EACH ROW
  EXECUTE FUNCTION users_username_backfill();

-- The authoritative case-insensitive uniqueness check. Application code generates/validates a
-- candidate and lets this index reject duplicates, then reports a friendly conflict — a
-- SELECT-then-INSERT "is it free?" check races under concurrent registration.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique_idx ON users (lower(username));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_format_check;
ALTER TABLE users ADD CONSTRAINT users_username_format_check
  CHECK (
    username ~ '^[a-zA-Z][a-zA-Z0-9._-]{2,31}$'
    -- No leading/trailing separator and no doubled separators: avoids look-alike noise such as
    -- "..admin" or "support__team" that make impersonation easier.
    AND username !~ '[._-]{2,}'
    AND username !~ '^[._-]'
    AND username !~ '[._-]$'
  );

-- --- Nine-digit Customer ID --------------------------------------------------------------------

-- The six-digit column from 0053 is widened in place. Widening is not the same as re-issuing: the
-- existing digits are kept, so a customer who was told "000042" still has a valid, unchanged
-- number — it is simply stored in a column that can also hold nine digits. New accounts are
-- always issued nine CSPRNG digits (src/services/customer-identity-service.ts).
ALTER TABLE users ALTER COLUMN customer_id TYPE varchar(9);

-- The support-session ledger records a copy of the Customer ID for auditing. It has to widen with
-- the source column, otherwise "switch to customer" starts failing with a 22001 (value too long)
-- the moment the first nine-digit customer is delegated to — which is every customer registered
-- after this migration.
ALTER TABLE admin_support_sessions ALTER COLUMN customer_id TYPE varchar(9);

-- Rows that somehow still have no Customer ID at this point (out-of-band imports) receive one now.
-- `random()` here only assigns an opaque non-secret identifier; it is not a credential.
DO $customerids$
DECLARE
  target record;
  candidate text;
  assigned boolean;
BEGIN
  FOR target IN SELECT id FROM users WHERE customer_id IS NULL LOOP
    assigned := false;
    WHILE NOT assigned LOOP
      candidate := lpad((floor(random() * 900000000) + 100000000)::bigint::text, 9, '0');
      IF NOT EXISTS (SELECT 1 FROM users WHERE customer_id = candidate) THEN
        UPDATE users SET customer_id = candidate WHERE id = target.id;
        assigned := true;
      END IF;
    END LOOP;
  END LOOP;
END
$customerids$;

-- The format check accepts six digits (pre-0085 rows, preserved verbatim) or nine digits (every
-- row issued from now on). It is strict about "digits only" either way, so the column can never
-- hold a UUID, an email address, or an arbitrary string.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_id_format_check;
ALTER TABLE users ADD CONSTRAINT users_customer_id_format_check
  CHECK (customer_id IS NULL OR customer_id ~ '^([0-9]{6}|[0-9]{9})$');

-- Immutability is enforced by the database, not only by convention: assignment happens once (the
-- column starts NULL) and any later UPDATE that changes it aborts. Ordinary administrators and
-- customers therefore cannot rewrite an identifier even if a future route forgets to strip the
-- field from its input — belt and braces alongside the strict request schemas.
CREATE OR REPLACE FUNCTION users_customer_id_immutable() RETURNS trigger AS $immutable$
BEGIN
  IF OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'users.customer_id is permanent and cannot be changed (account %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$immutable$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_customer_id_immutable_trigger ON users;
CREATE TRIGGER users_customer_id_immutable_trigger
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION users_customer_id_immutable();

-- --- Security PIN (rotating four-digit credential) ---------------------------------------------

ALTER TABLE users
  -- Keyed hash of the current PIN (HMAC-SHA-256 under SECURITY_PIN_HMAC_KEY, per-value salt).
  -- Never selected into a customer-facing DTO, never logged, never shown to staff.
  ADD COLUMN IF NOT EXISTS security_pin_hash text,
  ADD COLUMN IF NOT EXISTS security_pin_salt varchar(64),
  -- The same PIN, sealed with AES-256-GCM under a key derived from SECURITY_PIN_HMAC_KEY. This is
  -- what makes "show the owner their current PIN" possible: the keyed hash can verify but never
  -- reveal, and plaintext is never stored. A database dump *without* the environment key yields
  -- nothing; the column is never read by any route other than the verified reveal, and never
  -- selected into a DTO, log line or audit row.
  ADD COLUMN IF NOT EXISTS security_pin_encrypted text,
  ADD COLUMN IF NOT EXISTS security_pin_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS security_pin_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS security_pin_version integer NOT NULL DEFAULT 0,
  -- Set when a PIN mail has been queued for the current version, so a redelivered sweep tick does
  -- not re-send "your PIN has rotated" for the same rotation.
  ADD COLUMN IF NOT EXISTS security_pin_notified_version integer NOT NULL DEFAULT 0,
  -- The value rotated *out* in the last rotation. Used only to guarantee with certainty that the
  -- replacement differs from its predecessor; it is an integrity check, not a recoverable copy of
  -- the older credential (it is overwritten on every rotation).
  ADD COLUMN IF NOT EXISTS security_pin_previous_hash text;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_security_pin_version_check;
ALTER TABLE users ADD CONSTRAINT users_security_pin_version_check CHECK (security_pin_version >= 0);

-- Rotation is a single atomic statement keyed on the version the caller observed, so two requests
-- that both notice "expired" cannot both succeed: the loser's WHERE clause matches no row and it
-- re-reads the winner's value instead of issuing a competing PIN.
CREATE INDEX IF NOT EXISTS users_security_pin_due_idx
  ON users (coalesce(security_pin_expires_at, created_at))
  WHERE status = 'active' AND deleted_at IS NULL;

-- --- Six-digit email verification challenges (the "Verify it's you" gate) ----------------------

CREATE TABLE IF NOT EXISTS security_pin_verification_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The session that opened the challenge. The same JWT must present the code, so a code stolen
  -- from one browser cannot be redeemed with a different session.
  session_jti varchar(64) NOT NULL,
  -- SHA-256 of the six-digit code. The code itself exists only in the mail that was queued.
  code_hash char(64) NOT NULL,
  -- SHA-256 of the opaque challenge token returned to the browser. The token is not a code and
  -- cannot be guessed into one; it only identifies which challenge is being answered.
  challenge_token_hash char(64) NOT NULL,
  -- The address the mail was actually queued to, captured at issue time. Verification refuses to
  -- report a code to any address supplied later in the request.
  sent_to_email varchar(320) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  resend_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  -- Non-null once the email round-trip has been proven. A challenge may be used to reveal the PIN
  -- exactly once after that.
  verified_at timestamptz NULL,
  -- Non-null once the challenge is finished (revealed, superseded, expired or exhausted). Every
  -- failure mode sets a reason so the audit trail can distinguish them.
  consumed_at timestamptz NULL,
  consumed_reason varchar(32) NULL,
  ip_address varchar(64) NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_pin_challenges_attempts_check CHECK (attempts >= 0 AND max_attempts > 0),
  CONSTRAINT security_pin_challenges_resend_check CHECK (resend_count >= 0),
  CONSTRAINT security_pin_challenges_reason_check CHECK (
    consumed_reason IS NULL
    OR consumed_reason IN ('revealed', 'superseded', 'expired', 'attempts_exhausted', 'cancelled', 'session_changed')
  )
);

CREATE INDEX IF NOT EXISTS security_pin_challenges_user_idx
  ON security_pin_verification_challenges (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS security_pin_challenges_token_idx
  ON security_pin_verification_challenges (challenge_token_hash);
-- At most one live (unverified, unconsumed) challenge per account: issuing a replacement
-- invalidates the previous one, which is what stops an attacker from keeping an old code alive.
CREATE UNIQUE INDEX IF NOT EXISTS security_pin_challenges_one_live_per_user_idx
  ON security_pin_verification_challenges (user_id)
  WHERE verified_at IS NULL AND consumed_at IS NULL;

-- --- Verification-code mail queue --------------------------------------------------------------

-- One row per challenge. `code_envelope` holds the six-digit code sealed with AES-256-GCM under a
-- key derived from the PIN key, so a database snapshot taken while a code is in flight contains no
-- usable code; the mail worker decrypts in memory immediately before sending. A resend overwrites
-- the envelope of the same row (challenge_id is unique), which is what stops two live codes from
-- existing for one challenge. Rows for codes that expire, are used, or are superseded are marked
-- CANCELLED rather than delivered late.
CREATE TABLE IF NOT EXISTS pin_verification_email_queue (
  id uuid PRIMARY KEY,
  challenge_id uuid NOT NULL UNIQUE REFERENCES security_pin_verification_challenges (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipient_email varchar(320) NOT NULL,
  recipient_name varchar(255) NULL,
  code_envelope text NOT NULL,
  ttl_minutes integer NOT NULL DEFAULT 10,
  -- Copied from the challenge at queue time so the drain can cancel a stale code without a join
  -- (and so a cancelled row is self-explanatory in an operator query).
  expires_at timestamptz NOT NULL DEFAULT now(),
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text NULL,
  delivered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pin_verification_email_status_check CHECK (
    status IN ('PENDING', 'DELIVERED', 'FAILED', 'CONFIGURATION_REQUIRED', 'CANCELLED')
  ),
  CONSTRAINT pin_verification_email_attempts_check CHECK (attempts >= 0 AND max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS pin_verification_email_due_idx
  ON pin_verification_email_queue (next_attempt_at)
  WHERE status IN ('PENDING', 'CONFIGURATION_REQUIRED');

-- --- Account recovery requests -----------------------------------------------------------------

-- A customer who cannot complete email verification (lost mailbox, compromised inbox) needs a
-- human, identity-checked route back in. A recovery request never reveals or resets the PIN: it
-- only records the claim, lets support verify ownership out of band, and — on approval — revokes
-- compromised verification methods and requires a fresh email verification before any rotation.
CREATE TABLE IF NOT EXISTS account_recovery_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- varchar, not char: a blank-padded reference would leak trailing spaces into every API response
  -- and every email the customer quotes back to support.
  reference varchar(12) NOT NULL UNIQUE,
  reason varchar(32) NOT NULL,
  contact_email varchar(320) NULL,
  contact_phone varchar(40) NULL,
  details text NULL,
  status varchar(24) NOT NULL DEFAULT 'OPEN',
  -- Who resolved it and how. Never a secret value: an admin id, a timestamp, and a free-text note.
  resolved_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  resolved_at timestamptz NULL,
  resolution_note text NULL,
  ip_address varchar(64) NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_recovery_reason_check CHECK (
    reason IN ('cannot_access_email', 'email_compromised', 'lost_device', 'other')
  ),
  CONSTRAINT account_recovery_status_check CHECK (
    status IN ('OPEN', 'IDENTITY_VERIFIED', 'APPROVED', 'REJECTED', 'CANCELLED')
  )
);

CREATE INDEX IF NOT EXISTS account_recovery_user_idx
  ON account_recovery_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_recovery_status_idx
  ON account_recovery_requests (status, created_at DESC);
-- One open claim per account: a customer cannot queue several competing recoveries, and support
-- always sees a single, current request to work from.
CREATE UNIQUE INDEX IF NOT EXISTS account_recovery_one_open_per_user_idx
  ON account_recovery_requests (user_id)
  WHERE status IN ('OPEN', 'IDENTITY_VERIFIED');

-- --- Reserved usernames (impersonation prevention) ---------------------------------------------

-- Seeded system/role/brand names a customer may never take. Application code also carries a static
-- list (src/services/username-service.ts) so the rule holds even if this table is emptied; the
-- table exists so support can add names without a deployment.
CREATE TABLE IF NOT EXISTS reserved_usernames (
  username varchar(32) PRIMARY KEY,
  reason varchar(120) NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reserved_usernames (username, reason) VALUES
  ('admin', 'system role'),
  ('administrator', 'system role'),
  ('root', 'system role'),
  ('superadmin', 'system role'),
  ('super_admin', 'system role'),
  ('staff', 'system role'),
  ('support', 'system role'),
  ('helpdesk', 'system role'),
  ('billing', 'system role'),
  ('sales', 'system role'),
  ('security', 'system role'),
  ('system', 'reserved'),
  ('cloudhost247', 'brand'),
  ('cloudhost', 'brand'),
  ('ch247', 'brand'),
  ('official', 'impersonation risk'),
  ('moderator', 'system role'),
  ('mod', 'system role'),
  ('api', 'reserved'),
  ('www', 'reserved'),
  ('mail', 'reserved'),
  ('noreply', 'reserved'),
  ('no-reply', 'reserved'),
  ('postmaster', 'reserved'),
  ('hostmaster', 'reserved'),
  ('webmaster', 'reserved'),
  ('abuse', 'reserved'),
  ('anonymous', 'reserved'),
  ('null', 'reserved'),
  ('undefined', 'reserved'),
  ('me', 'reserved'),
  ('you', 'reserved')
ON CONFLICT (username) DO NOTHING;

-- --- Auth audit vocabulary ---------------------------------------------------------------------

-- The security events below must be recordable in the existing append-only auth_audit_log. The
-- constraint is widened (never loosened to arbitrary text) exactly as migrations 0013/0022/0025/
-- 0059/0060/0061 did for their own new events.
ALTER TABLE auth_audit_log DROP CONSTRAINT IF EXISTS auth_audit_log_event_type_check;
ALTER TABLE auth_audit_log ADD CONSTRAINT auth_audit_log_event_type_check CHECK (
  event_type IN (
    'register', 'login_success', 'login_failure', 'logout', 'token_refresh',
    'profile_update', 'password_change', 'admin_status_change', 'admin_role_change',
    'payment_initiated', 'manual_payment_confirmed', 'manual_payment_rejected',
    'webhook_payment_succeeded', 'webhook_payment_failed',
    'admin_invoice_refunded', 'admin_invoice_cancelled',
    'email_verification_requested', 'email_verified',
    'password_reset_requested', 'password_reset_completed',
    'mfa_enrollment_started', 'mfa_enabled', 'mfa_disabled',
    'mfa_login_challenge', 'mfa_login_failure', 'mfa_recovery_code_used',
    'passkey_enrollment_started', 'passkey_added', 'passkey_removed', 'passkey_renamed',
    -- 0085: username / PIN / verification / recovery vocabulary
    'username_changed',
    'security_pin_rotated',
    'security_pin_view_challenge_requested',
    'security_pin_view_challenge_resent',
    'security_pin_view_verification_failed',
    'security_pin_viewed',
    'account_recovery_requested',
    'account_recovery_cancelled',
    'account_recovery_identity_verified',
    'account_recovery_approved',
    'account_recovery_rejected'
  )
);
