/**
 * Phase 6 (security) — customer session enumeration.
 *
 * The platform's tokens are stateless JWTs carrying a `jti`, and `revoked_tokens` (0003) already
 * lets a single token be invalidated immediately. What was missing is the *inventory*: there was no
 * record of which sessions an account had, so a customer could not see the browsers/devices that
 * could still act as them, nor revoke one without changing their password.
 *
 * One row per issued token, written at login. Revoking a session writes the `jti` to
 * `revoked_tokens` (so src/lib/require-auth.ts rejects it on the very next request, exactly as it
 * does after an explicit logout) and stamps `revoked_at` here so the row stays legible in the
 * account's session list instead of disappearing.
 *
 * Deliberate limits, recorded rather than implied:
 *   - Rows are written at login only. A token minted before this migration, or by a code path that
 *     does not record one, simply has no row and therefore does not appear in the list — the list
 *     is "sessions this build has recorded", never a claim that it is exhaustive.
 *   - `ip_address` is the peer the app saw (`request.ip`). Where a reverse proxy terminates TLS in
 *     front of the app this is the proxy, not the visitor; it is stored for the customer's own
 *     review, exactly as `auth_audit_log` already stores it, and is NOT used to decide whether a
 *     sign-in is unfamiliar (see src/db/auth-sessions.ts).
 *   - `last_seen_at` is refreshed by src/lib/require-auth.ts on a throttle, not on every request,
 *     so it is approximate by design. It is never used for access control.
 *   - Nothing is deleted here. `expires_at` mirrors the token's own `exp` so a future sweep can
 *     prune rows whose token has already expired naturally; until that sweep exists the table grows
 *     by one row per login.
 *
 * Local schema only — not applied to staging or production.
 */
CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The token's `jti`. Unique so a token maps to at most one session row, and so revocation can be
  -- keyed on it without a second lookup.
  jti uuid NOT NULL UNIQUE,
  user_agent text NULL,
  ip_address varchar(64) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  revoked_reason varchar(32) NULL
    CONSTRAINT auth_sessions_revoked_reason_check
    CHECK (revoked_reason IN ('customer_revoked', 'customer_revoked_others', 'logout')),
  -- Mirrors the JWT `exp` claim. NOT a second expiry: the token itself still decides when it stops
  -- working. This exists so an operator (or a future sweep) can tell a live session from a row
  -- whose token expired weeks ago.
  expires_at timestamptz NOT NULL,
  -- A revocation reason with no revocation timestamp would be a row that contradicts itself.
  CONSTRAINT auth_sessions_revoked_timestamp_check
  CHECK ((revoked_at IS NULL AND revoked_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at);

/**
 * Widening the append-only auth audit vocabulary for the two revocation events, following the same
 * drop-and-re-add pattern the earlier widening migrations (0013, 0022, 0025, 0059, 0060, 0061,
 * 0085) used. No existing row is touched; only the set of future values changes. The new events are
 * account-security facts a customer is entitled to see, which is why they belong in this log rather
 * than in a parallel one.
 */
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
    'mfa_recovery_code_used',
    'passkey_enrollment_started',
    'passkey_added',
    'passkey_removed',
    'passkey_renamed',
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
    'account_recovery_rejected',
    'auth_session_revoked',
    'auth_sessions_revoked'
  )
);
