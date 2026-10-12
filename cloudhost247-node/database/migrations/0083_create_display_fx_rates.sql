-- Migration: 0083_create_display_fx_rates.sql
-- Purpose: keep a local, timestamped copy of the WHMCS currency addon's rates, used ONLY to show
-- approximate display amounts in other currencies.
--
-- Rules this table exists to enforce:
--   * Rates come only from the WHMCS addon's latest successful run (see modules/addons/cloudhost247_currency/display-feed.php).
--     A row is never written from a guessed, hard-coded or client-supplied rate.
--   * Each row keeps the source run id and the rate's observation time, so every displayed
--     conversion can say when its rate was observed.
--   * Nothing here changes a charge, an order, an invoice or a stored amount. Billing stays in USD.
--     Rows are display inputs and are safe to delete; a sync simply writes a new run.

CREATE TABLE IF NOT EXISTS display_fx_rates (
  id bigserial PRIMARY KEY,
  source_run_id bigint NOT NULL,
  base_currency char(3) NOT NULL,
  currency_code char(3) NOT NULL,
  rate numeric(24, 12) NOT NULL,
  observed_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT display_fx_rates_base_currency_check CHECK (base_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT display_fx_rates_currency_code_check CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT display_fx_rates_rate_positive_check CHECK (rate > 0),
  CONSTRAINT display_fx_rates_run_currency_unique UNIQUE (source_run_id, currency_code)
);

CREATE INDEX IF NOT EXISTS display_fx_rates_latest_run_idx ON display_fx_rates (fetched_at DESC, source_run_id);

COMMENT ON TABLE display_fx_rates IS
  'Display-only exchange-rate snapshots copied from the WHMCS currency addon. Never used to price, charge or restate an amount.';
