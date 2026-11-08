-- Migration: 0088_create_whmcs_sso_rate_limits.sql
-- Purpose: a hand-off budget that holds across *application instances*, not just inside one process.
--
-- Why the audit table (0087) is not enough:
--   `whmcs_sso_handoffs` records what happened. Counting its recent rows and then inserting is a
--   read-then-write: two application instances answering the same account at the same moment both
--   read "9 used" and both proceed, so a per-user limit of 10 becomes 10 + (concurrent instances).
--   The in-process Fastify rate limit cannot help either — it is per process.
--
-- What this table does instead:
--   One row per (account, fixed 5-minute window) with an atomic counter. The limiter is a single
--   `INSERT … ON CONFLICT DO UPDATE … RETURNING issued`, which increments and reads in the same
--   statement, so N instances see 1..N and exactly the first `limit` of them are allowed. No
--   read-then-write, no advisory locks, no extra round trip.
--
-- Deliberate properties:
--   * The counter only goes up inside a window; a refused request still increments, so hammering
--     the endpoint cannot "reset" the budget.
--   * A fixed window can allow a burst of up to 2× the limit across a window boundary. That is
--     accepted: the authoritative replay control is WHMCS's single-use 60-second token, and the
--     budget exists to stop bulk minting, not to shape traffic precisely.
--   * Rows are pruned per account by the limiter (buckets older than one day), so the table stays
--     tiny; there is no global cleanup job to forget to install.
--   * This table carries no token, no IP address and no user agent — it cannot be used to
--     reconstruct a session.
--
-- Runs inside the migration runner's own transaction — do not add BEGIN/COMMIT here.

CREATE TABLE IF NOT EXISTS whmcs_sso_rate_limits (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Start of the fixed window, always a whole multiple of the window length.
  window_start timestamptz NOT NULL,
  issued integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whmcs_sso_rate_limits_pkey PRIMARY KEY (user_id, window_start),
  CONSTRAINT whmcs_sso_rate_limits_issued_non_negative CHECK (issued >= 0)
);
