-- Domain Brokerage core schema. Provider credentials are intentionally not stored here;
-- integrations are referenced by provider_key and resolved by the central integration vault.
CREATE TABLE IF NOT EXISTS domain_broker_providers (
  id uuid PRIMARY KEY, provider_key varchar(80) NOT NULL UNIQUE, name varchar(160) NOT NULL,
  provider_type varchar(32) NOT NULL CHECK (provider_type IN ('marketplace','broker','registrar','manual')),
  status varchar(32) NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured','connected','auth_failed','invalid_configuration','unavailable','disabled')),
  environment varchar(16) NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb, last_health_check_at timestamptz, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS domain_broker_cases (
  id uuid PRIMARY KEY, brokerage_id varchar(32) NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  customer_name varchar(255) NOT NULL, contact_information text NOT NULL, domain varchar(253) NOT NULL, registrar varchar(255), provider_id uuid REFERENCES domain_broker_providers(id) ON DELETE SET NULL,
  assigned_broker_id uuid REFERENCES users(id) ON DELETE SET NULL, status varchar(32) NOT NULL DEFAULT 'request_submitted',
  domain_status varchar(32) NOT NULL DEFAULT 'unknown', acquisition_route varchar(32) NOT NULL DEFAULT 'manual_broker_required',
  max_budget numeric(18,2) NOT NULL CHECK (max_budget > 0), currency char(3) NOT NULL,
  opening_offer numeric(18,2), current_offer numeric(18,2), deadline_at timestamptz,
  payment_status varchar(24) NOT NULL DEFAULT 'pending', transfer_status varchar(24) NOT NULL DEFAULT 'not_started',
  negotiation_instructions text, customer_message text, terms_accepted_at timestamptz NOT NULL,
  idempotency_key varchar(128), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (currency = upper(currency)), CHECK (opening_offer IS NULL OR opening_offer > 0), CHECK (current_offer IS NULL OR current_offer > 0)
);
CREATE INDEX IF NOT EXISTS domain_broker_cases_user_idx ON domain_broker_cases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_broker_cases_filter_idx ON domain_broker_cases(status, payment_status, transfer_status, created_at DESC);
CREATE TABLE IF NOT EXISTS domain_broker_assignments (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES domain_broker_cases(id) ON DELETE CASCADE,
  broker_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(case_id, broker_id)
);
CREATE TABLE IF NOT EXISTS domain_broker_offers (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES domain_broker_cases(id) ON DELETE CASCADE,
  amount numeric(18,2) NOT NULL CHECK (amount > 0), currency char(3) NOT NULL,
  sender_type varchar(16) NOT NULL CHECK (sender_type IN ('customer','broker','seller','provider')),
  recipient_type varchar(16) NOT NULL CHECK (recipient_type IN ('customer','broker','seller','provider')),
  status varchar(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected','expired','superseded')),
  expires_at timestamptz, provider_reference varchar(255), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(currency = upper(currency))
);
CREATE INDEX IF NOT EXISTS domain_broker_offers_case_idx ON domain_broker_offers(case_id, created_at DESC);
CREATE TABLE IF NOT EXISTS domain_broker_messages (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES domain_broker_cases(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL, visibility varchar(16) NOT NULL CHECK (visibility IN ('customer','internal')),
  body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS domain_broker_events (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES domain_broker_cases(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL, event_type varchar(64) NOT NULL, result varchar(24) NOT NULL DEFAULT 'success',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, correlation_id varchar(80), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS domain_broker_events_case_idx ON domain_broker_events(case_id, created_at ASC);
CREATE TABLE IF NOT EXISTS domain_broker_payments (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES domain_broker_cases(id) ON DELETE RESTRICT,
  acquisition_amount numeric(18,2) NOT NULL CHECK(acquisition_amount > 0), brokerage_fee numeric(18,2) NOT NULL DEFAULT 0 CHECK(brokerage_fee >= 0),
  transfer_fee numeric(18,2) NOT NULL DEFAULT 0 CHECK(transfer_fee >= 0), payment_fee numeric(18,2) NOT NULL DEFAULT 0 CHECK(payment_fee >= 0),
  total_amount numeric(18,2) NOT NULL CHECK(total_amount > 0), currency char(3) NOT NULL, status varchar(24) NOT NULL DEFAULT 'pending',
  external_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id), CHECK(currency = upper(currency)), CHECK(status IN ('pending','initiated','authorized','paid','failed','refunded','cancelled'))
);
CREATE TABLE IF NOT EXISTS domain_broker_transfers (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES domain_broker_cases(id) ON DELETE RESTRICT,
  registrar varchar(255), provider_reference varchar(255), destination_account uuid REFERENCES users(id) ON DELETE RESTRICT,
  status varchar(24) NOT NULL DEFAULT 'not_started', epp_status varchar(24), initiated_at timestamptz, completed_at timestamptz, failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(case_id),
  CHECK(status IN ('not_started','authorization_required','initiated','processing','verified','failed'))
);
CREATE TABLE IF NOT EXISTS domain_broker_documents (
  id uuid PRIMARY KEY, case_id uuid NOT NULL REFERENCES domain_broker_cases(id) ON DELETE CASCADE, name varchar(255) NOT NULL,
  storage_key varchar(500) NOT NULL, visibility varchar(16) NOT NULL CHECK(visibility IN ('customer','internal')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS domain_broker_audit_logs (
  id uuid PRIMARY KEY, case_id uuid REFERENCES domain_broker_cases(id) ON DELETE SET NULL, actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(80) NOT NULL, result varchar(24) NOT NULL DEFAULT 'success', metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS domain_broker_case_idempotency_idx ON domain_broker_cases(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
