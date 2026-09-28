-- Migration: 0003_create_revoked_tokens.sql
-- Purpose: DB-backed denylist for explicitly logged-out JWTs.
--
-- Tokens issued by this app are stateless (self-contained, verified only via signature + expiry)
-- until they expire naturally. That means a plain client-side "delete the token from
-- localStorage" logout does NOT stop a copy of that same token (e.g. leaked via XSS, a
-- shared/public computer, or captured in a proxy/log) from continuing to authenticate until it
-- expires on its own. This table lets POST /api/auth/logout actually invalidate one specific
-- token immediately: every authenticated route that goes through src/lib/require-auth.ts rejects
-- a token whose `jti` (JWT ID) is present here, even when the JWT's signature and expiry are
-- both still valid.
--
-- This is a single indexed Postgres lookup per authenticated request -- no Redis, no in-memory
-- session store, and no always-running process, consistent with this project's constraints.
--
-- expires_at mirrors the token's own `exp` claim so a *future* cPanel Cron job (not implemented
-- yet -- out of scope for this phase) can safely prune rows whose underlying token has already
-- expired naturally: an expired token is rejected by signature/expiry checks regardless of
-- whether a revocation row still exists, so keeping that row forever serves no purpose.

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS revoked_tokens_expires_at_idx ON revoked_tokens (expires_at);
CREATE INDEX IF NOT EXISTS revoked_tokens_user_id_idx ON revoked_tokens (user_id);
