-- Migration: 0065_create_domain_availability_watches.sql
-- Purpose: Domain availability watchlist (spec §17 — "Domain availability" notifications).
--
-- A customer watches a domain that is currently registered/unavailable; the domain-services
-- worker sweep re-checks it through the CONFIGURED registrar (small batches, oldest-first) and
-- notifies the customer exactly once when the provider reports it available. No watch is ever
-- fulfilled without a live provider answer — the sweep is the only state machine, and the
-- notification dedupe index guarantees once-only delivery.

CREATE TABLE IF NOT EXISTS domain_availability_watches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain_name varchar(253) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'watching',
  provider_id uuid NULL REFERENCES domain_service_providers(id) ON DELETE SET NULL,
  last_checked_at timestamptz NULL,
  last_availability varchar(16) NULL,
  check_failures integer NOT NULL DEFAULT 0,
  available_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_availability_watches_status_check CHECK (status IN ('watching', 'available', 'cancelled')),
  CONSTRAINT domain_availability_watches_failures_check CHECK (check_failures >= 0),
  CONSTRAINT domain_availability_watches_availability_check CHECK (
    last_availability IS NULL OR last_availability IN ('available', 'registered', 'premium', 'unavailable', 'unsupported')
  )
);

-- At most one ACTIVE watch per user per domain. Watches that became available or were cancelled
-- are kept as history and do not block a fresh watch.
CREATE UNIQUE INDEX IF NOT EXISTS domain_availability_watches_active_unique_idx
  ON domain_availability_watches (user_id, lower(domain_name)) WHERE status = 'watching';

CREATE INDEX IF NOT EXISTS domain_availability_watches_user_idx
  ON domain_availability_watches (user_id, created_at DESC);

-- Sweep intake: active watches, stale checks first (never-checked first).
CREATE INDEX IF NOT EXISTS domain_availability_watches_sweep_idx
  ON domain_availability_watches (status, last_checked_at ASC NULLS FIRST);
