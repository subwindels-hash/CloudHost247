-- Migration: 0059_create_auth_recovery.sql
-- Purpose: durable, single-use email verification and password-recovery actions.  The database
-- stores only SHA-256 hashes of the bearer tokens.  The raw token is deterministically derived
-- by the delivery worker from its action id and the server's JWT secret, so a durable retry queue
-- never has to persist a usable recovery link in plaintext.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL;

-- JWT iat is only whole-second precision. A monotonic database-backed session version closes the
-- same-second gap in timestamp-only invalidation: changing a password increments it, so every
-- previously issued session is rejected immediately even if the password reset happens in the
-- very same second as the original login. Existing pre-migration JWTs map to version zero.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_session_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS auth_action_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose varchar(32) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_action_tokens_purpose_check CHECK (purpose IN ('email_verification', 'password_reset'))
);
CREATE INDEX IF NOT EXISTS auth_action_tokens_active_lookup_idx
  ON auth_action_tokens (token_hash, purpose, expires_at)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_action_tokens_user_purpose_created_idx
  ON auth_action_tokens (user_id, purpose, created_at DESC);

-- Authentication emails deliberately use their own outbox. notification_outbox always belongs to
-- an in-app user_notification, while reset requests may be anonymous and must not create a
-- customer-visible notification that discloses sensitive recovery activity.
CREATE TABLE IF NOT EXISTS auth_email_outbox (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_id uuid NOT NULL UNIQUE REFERENCES auth_action_tokens (id) ON DELETE CASCADE,
  email_type varchar(32) NOT NULL,
  recipient_email varchar(320) NOT NULL,
  recipient_name varchar(255) NULL,
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text NULL,
  delivered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_email_outbox_type_check CHECK (email_type IN ('email_verification', 'password_reset')),
  CONSTRAINT auth_email_outbox_status_check CHECK (
    status IN ('PENDING', 'DELIVERED', 'FAILED', 'CONFIGURATION_REQUIRED', 'CANCELLED')
  ),
  CONSTRAINT auth_email_outbox_attempts_check CHECK (attempts >= 0 AND max_attempts > 0)
);
CREATE INDEX IF NOT EXISTS auth_email_outbox_due_idx
  ON auth_email_outbox (next_attempt_at)
  WHERE status IN ('PENDING', 'CONFIGURATION_REQUIRED');

-- Keep the auth history exhaustive without weakening the existing finite event-type constraint.
ALTER TABLE auth_audit_log DROP CONSTRAINT IF EXISTS auth_audit_log_event_type_check;
ALTER TABLE auth_audit_log ADD CONSTRAINT auth_audit_log_event_type_check CHECK (
  event_type IN (
    'register',
    'login_success',
    'login_failure',
    'logout',
    'token_refresh',
    'profile_update',
    'password_change',
    'admin_status_change',
    'admin_role_change',
    'payment_initiated',
    'manual_payment_confirmed',
    'manual_payment_rejected',
    'webhook_payment_succeeded',
    'webhook_payment_failed',
    'admin_invoice_refunded',
    'admin_invoice_cancelled',
    'email_verification_requested',
    'email_verified',
    'password_reset_requested',
    'password_reset_completed'
  )
);
