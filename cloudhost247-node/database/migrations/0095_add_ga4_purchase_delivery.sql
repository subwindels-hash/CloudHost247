-- Server-only GA4 purchase support. Client IDs are encrypted with the existing key ring;
-- consent-session deletion cascades them. Contexts receive an encrypted snapshot at checkout.
ALTER TABLE marketing_consent_sessions ADD COLUMN IF NOT EXISTS ga4_consent_revision integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS ga4_browser_ids (
  consent_session_id uuid PRIMARY KEY REFERENCES marketing_consent_sessions(id) ON DELETE CASCADE,
  config_revision integer NOT NULL CHECK (config_revision > 0),
  measurement_id varchar(12) NOT NULL CHECK (measurement_id ~ '^G-[A-Z0-9]{10}$'),
  client_id_ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ga4_checkout_contexts ADD COLUMN IF NOT EXISTS client_id_ciphertext text NULL;
ALTER TABLE ga4_checkout_contexts ADD COLUMN IF NOT EXISTS measurement_id varchar(12) NULL;
-- An order represents one transaction. This tombstone is deliberately retained when consent
-- contexts are removed, so withdrawal/re-consent cannot create a second delivery attempt.
CREATE TABLE IF NOT EXISTS ga4_purchase_outbox (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  status varchar(20) NOT NULL CHECK (status IN ('queued','sending','http_accepted','unknown','cancelled')),
  claim_token uuid NULL,
  lease_until timestamptz NULL,
  http_status integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ga4_purchase_outbox_due_idx ON ga4_purchase_outbox(status,created_at);
