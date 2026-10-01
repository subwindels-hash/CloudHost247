-- Migration: 0061_create_webauthn_passkeys.sql
-- WebAuthn passkey credentials and short-lived registration challenges. Browser responses are
-- verified by @simplewebauthn/server; challenge plaintext is deterministically derived at verify
-- time and is never persisted.
CREATE TABLE IF NOT EXISTS user_passkeys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  credential_id varchar(1024) NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  device_type varchar(32) NOT NULL,
  backed_up boolean NOT NULL DEFAULT false,
  aaguid varchar(64) NULL,
  name varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_passkeys_device_type_check CHECK (device_type IN ('singleDevice', 'multiDevice'))
);
CREATE INDEX IF NOT EXISTS user_passkeys_user_idx ON user_passkeys (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webauthn_registration_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  challenge_hash char(64) NOT NULL UNIQUE,
  session_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webauthn_registration_challenges_active_idx
  ON webauthn_registration_challenges (id, expires_at) WHERE used_at IS NULL;

ALTER TABLE auth_audit_log DROP CONSTRAINT IF EXISTS auth_audit_log_event_type_check;
ALTER TABLE auth_audit_log ADD CONSTRAINT auth_audit_log_event_type_check CHECK (event_type IN (
  'register','login_success','login_failure','logout','token_refresh','profile_update','password_change',
  'admin_status_change','admin_role_change','payment_initiated','manual_payment_confirmed',
  'manual_payment_rejected','webhook_payment_succeeded','webhook_payment_failed',
  'admin_invoice_refunded','admin_invoice_cancelled','email_verification_requested','email_verified',
  'password_reset_requested','password_reset_completed','mfa_enrollment_started','mfa_enabled',
  'mfa_disabled','mfa_login_challenge','mfa_login_failure','mfa_recovery_code_used',
  'passkey_enrollment_started','passkey_added','passkey_removed','passkey_renamed'
));
