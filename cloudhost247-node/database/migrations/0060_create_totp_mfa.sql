-- Migration: 0060_create_totp_mfa.sql
-- Purpose: encrypted TOTP MFA enrollment, single-use recovery codes, and short-lived MFA login
-- challenges. No usable secret, recovery code, or challenge bearer token is stored in plaintext.

CREATE TABLE IF NOT EXISTS user_mfa_totp (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  confirmed_at timestamptz NULL,
  last_used_timestep bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_mfa_totp_confirmed_idx
  ON user_mfa_totp (user_id)
  WHERE confirmed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL UNIQUE,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_mfa_recovery_codes_active_idx
  ON user_mfa_recovery_codes (user_id)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_mfa_login_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  -- The password-login generation this challenge belongs to. A password reset/change makes
  -- outstanding challenges unusable, just like ordinary JWT sessions.
  session_version integer NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_mfa_login_challenges_attempts_check CHECK (attempts >= 0 AND max_attempts > 0)
);
CREATE INDEX IF NOT EXISTS auth_mfa_login_challenges_active_idx
  ON auth_mfa_login_challenges (token_hash, expires_at)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_mfa_login_challenges_expiry_idx
  ON auth_mfa_login_challenges (expires_at);

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
    'password_reset_completed',
    'mfa_enrollment_started',
    'mfa_enabled',
    'mfa_disabled',
    'mfa_login_challenge',
    'mfa_login_failure',
    'mfa_recovery_code_used'
  )
);
