-- Migration: 0086_create_marketing_integrations.sql
-- Canonical marketing configuration, privacy choices and conversion delivery ledger.
-- The runner supplies BEGIN/COMMIT. Additive only; no existing billing/auth table is changed.
-- A Pixel ID is public configuration. Access tokens live only in the separate secret table.

CREATE TABLE IF NOT EXISTS marketing_integrations (
  provider_key varchar(64) PRIMARY KEY,
  display_name varchar(120) NOT NULL,
  website_domain varchar(253) NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  last_configuration_update timestamptz NULL,
  last_configuration_test_at timestamptz NULL,
  last_configuration_test_status varchar(40) NULL,
  last_error varchar(240) NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_integrations_provider_check CHECK (provider_key IN ('meta_pixel')),
  CONSTRAINT marketing_integrations_enabled_requires_id CHECK (
    NOT enabled OR (configuration->>'pixelId' ~ '^[1-9][0-9]{4,31}$' AND website_domain <> '')
  ),
  CONSTRAINT marketing_integrations_test_code_check CHECK (
    NOT (configuration->>'testMode')::boolean OR coalesce(configuration->>'testEventCode', '') <> ''
  )
);

INSERT INTO marketing_integrations (provider_key, display_name, configuration)
VALUES ('meta_pixel', 'CloudHost247 Meta Pixel',
  '{"pixelId":null,"testMode":false,"testEventCode":null,"consentPolicy":"global_opt_in","capi":{"enabled":false,"apiVersion":"v26.0"}}'::jsonb)
ON CONFLICT (provider_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS marketing_integration_secrets (
  provider_key varchar(64) NOT NULL REFERENCES marketing_integrations(provider_key) ON DELETE CASCADE,
  secret_key varchar(64) NOT NULL,
  encrypted_value text NOT NULL,
  rotated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_key, secret_key),
  CONSTRAINT marketing_integration_secrets_key_check CHECK (secret_key IN ('capi_access_token'))
);

-- The cookie contains 256 random bits; only its SHA-256 digest is stored. No account ID,
-- email, IP address or user agent is collected by this subsystem.
CREATE TABLE IF NOT EXISTS marketing_consent_sessions (
  id uuid PRIMARY KEY,
  token_hash varchar(64) NOT NULL UNIQUE,
  preferences jsonb NOT NULL DEFAULT '{"essential":true,"analytics":false,"marketing":false}'::jsonb,
  decided boolean NOT NULL DEFAULT false,
  jurisdiction varchar(2) NULL,
  policy_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  CONSTRAINT marketing_consent_preferences_check CHECK (
    preferences ? 'essential' AND preferences ? 'analytics' AND preferences ? 'marketing'
    AND (preferences->>'essential')::boolean = true
    AND jsonb_typeof(preferences->'analytics') = 'boolean'
    AND jsonb_typeof(preferences->'marketing') = 'boolean'
  ),
  CONSTRAINT marketing_consent_country_check CHECK (jurisdiction IS NULL OR jurisdiction ~ '^[A-Z]{2}$')
);
CREATE INDEX IF NOT EXISTS marketing_consent_expiry_idx ON marketing_consent_sessions(expires_at);

CREATE TABLE IF NOT EXISTS marketing_consent_history (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES marketing_consent_sessions(id) ON DELETE CASCADE,
  action varchar(24) NOT NULL CHECK (action IN ('accept_all','reject_optional','save_preferences','withdraw')),
  preferences jsonb NOT NULL,
  jurisdiction varchar(2) NULL,
  policy_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_consent_history_session_idx ON marketing_consent_history(session_id,created_at DESC);

-- Captured at checkout, never inferred from accepting terms or creating an account.
-- Opaque Meta browser identifiers are optional and only captured with marketing permission.
CREATE TABLE IF NOT EXISTS marketing_conversion_contexts (
  subject_key varchar(128) PRIMARY KEY,
  order_id uuid NULL REFERENCES orders(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES marketing_consent_sessions(id) ON DELETE CASCADE,
  source_url varchar(2048) NOT NULL,
  fbp varchar(128) NULL,
  fbc varchar(512) NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketing_events (
  id uuid PRIMARY KEY,
  provider_key varchar(64) NOT NULL REFERENCES marketing_integrations(provider_key),
  pixel_id varchar(32) NOT NULL,
  config_revision integer NOT NULL,
  event_name varchar(40) NOT NULL CHECK (event_name IN
    ('PageView','ViewContent','Search','AddToCart','InitiateCheckout','AddPaymentInfo','Purchase','CompleteRegistration','Lead','Contact')),
  event_id varchar(128) NOT NULL,
  custom_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url varchar(2048) NOT NULL,
  session_id uuid NULL REFERENCES marketing_consent_sessions(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL,
  browser_dispatched_at timestamptz NULL,
  server_recorded_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_key,pixel_id,event_name,event_id)
);
-- Also upgrades development databases that applied the unreleased 0086 before origin timestamps existed.
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS server_recorded_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS marketing_events_activity_idx ON marketing_events(created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_delivery_outbox (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE REFERENCES marketing_events(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','retry','delivered','dead_letter','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NULL,
  worker_id varchar(96) NULL,
  http_status integer NULL,
  events_received integer NULL,
  last_error varchar(240) NULL,
  delivered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_delivery_due_idx ON marketing_delivery_outbox(status,next_attempt_at,lease_until);
