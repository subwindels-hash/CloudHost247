-- Analytics-only checkout attribution. No payment data, user data, URL, GA cookie or
-- external identifier is copied here. A later purchase integration must recheck current
-- consent and the configuration revision before using this context; this table sends nothing.
CREATE TABLE IF NOT EXISTS ga4_checkout_contexts (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  consent_session_id uuid NOT NULL REFERENCES marketing_consent_sessions(id) ON DELETE CASCADE,
  config_revision integer NOT NULL CHECK (config_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ga4_checkout_contexts_consent_idx ON ga4_checkout_contexts(consent_session_id);
