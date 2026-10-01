-- Migration: 0063_create_domain_services_foundation.sql
-- Purpose: Phase 1 of the Domain Services platform.
--
-- This migration deliberately extends existing platform primitives instead of duplicating them:
--   * customer_domains remains the canonical record of domains a customer can manage.
--   * carts, orders, invoices, payments, subscriptions and the platform audit_logs remain the
--     only commerce, billing and audit systems.
--   * domain_broker_* remains the dedicated brokerage case-management model.
--
-- Rows here model authoritative provider-backed domain operations. A customer_domains record is
-- only linked after a registrar confirms a registration/transfer; a paid invoice is never itself
-- proof that a registry operation succeeded.

-- -----------------------------------------------------------------------------------------------
-- Domain provider configuration and encrypted credentials
-- -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_service_providers (
  id uuid PRIMARY KEY,
  provider_key varchar(80) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  adapter_key varchar(80) NOT NULL,
  provider_type varchar(24) NOT NULL,
  api_base_url varchar(500) NULL,
  environment varchar(16) NOT NULL DEFAULT 'production',
  status varchar(24) NOT NULL DEFAULT 'not_configured',
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_connection_test_at timestamptz NULL,
  last_success_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_error text NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_service_providers_type_check CHECK (provider_type IN ('registrar', 'rdap', 'appraisal', 'auction')),
  CONSTRAINT domain_service_providers_environment_check CHECK (environment IN ('sandbox', 'production')),
  CONSTRAINT domain_service_providers_status_check CHECK (status IN ('not_configured', 'configured', 'connected', 'auth_failed', 'unavailable', 'disabled'))
);

-- Credentials are write-only AES-GCM envelopes. `credential_names` is safe metadata (such as
-- ["apiKey", "apiSecret"]) so Super Admin can see which values are stored without ever receiving
-- a secret or its ciphertext through a browser API.
CREATE TABLE IF NOT EXISTS domain_service_provider_credentials (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL UNIQUE REFERENCES domain_service_providers(id) ON DELETE CASCADE,
  encrypted_credentials text NOT NULL,
  credential_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NULL,
  CONSTRAINT domain_service_provider_credentials_key_version_check CHECK (key_version >= 1)
);

CREATE INDEX IF NOT EXISTS domain_service_providers_status_idx
  ON domain_service_providers (provider_type, status, created_at DESC);

-- -----------------------------------------------------------------------------------------------
-- Provider-sourced extension catalogue and current sellable offerings
-- -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_extensions (
  id uuid PRIMARY KEY,
  extension varchar(63) NOT NULL,
  description text NULL,
  restrictions text NULL,
  registration_requirements text NULL,
  is_trending boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_extensions_status_check CHECK (status IN ('active', 'disabled', 'unavailable')),
  CONSTRAINT domain_extensions_shape_check CHECK (extension ~ '^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$' OR extension ~ '^[a-z0-9]$')
);
CREATE UNIQUE INDEX IF NOT EXISTS domain_extensions_normalized_unique_idx ON domain_extensions (lower(extension));

-- Prices are snapshots obtained from a connected registrar, never UI-defined prices. A later
-- checkout/registration flow re-queries this offering and the provider before creating an order.
CREATE TABLE IF NOT EXISTS domain_provider_extension_offerings (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES domain_service_providers(id) ON DELETE CASCADE,
  extension_id uuid NOT NULL REFERENCES domain_extensions(id) ON DELETE CASCADE,
  provider_tld varchar(80) NOT NULL,
  registration_price numeric(18,2) NULL,
  renewal_price numeric(18,2) NULL,
  transfer_price numeric(18,2) NULL,
  currency char(3) NOT NULL,
  premium_supported boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'enabled',
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sourced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_provider_extension_offerings_status_check CHECK (status IN ('enabled', 'disabled', 'unavailable')),
  CONSTRAINT domain_provider_extension_offerings_currency_check CHECK (currency = upper(currency)),
  CONSTRAINT domain_provider_extension_offerings_price_check CHECK (
    (registration_price IS NULL OR registration_price >= 0) AND
    (renewal_price IS NULL OR renewal_price >= 0) AND
    (transfer_price IS NULL OR transfer_price >= 0)
  ),
  CONSTRAINT domain_provider_extension_offerings_unique UNIQUE (provider_id, extension_id)
);
CREATE INDEX IF NOT EXISTS domain_provider_extension_offerings_lookup_idx
  ON domain_provider_extension_offerings (provider_id, status, extension_id);

-- -----------------------------------------------------------------------------------------------
-- Search and bulk search history. Results preserve the provider-confirmed answer and price
-- snapshot at search time; they are never proof that the domain will remain available.
-- -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_searches (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  provider_id uuid NULL REFERENCES domain_service_providers(id) ON DELETE SET NULL,
  search_type varchar(16) NOT NULL DEFAULT 'single',
  query_label varchar(253) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  error_code varchar(80) NULL,
  error_message text NULL,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_searches_type_check CHECK (search_type IN ('single', 'bulk')),
  CONSTRAINT domain_searches_status_check CHECK (status IN ('pending', 'completed', 'provider_not_configured', 'provider_error', 'rate_limited', 'failed'))
);
CREATE INDEX IF NOT EXISTS domain_searches_user_idx ON domain_searches (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_searches_provider_idx ON domain_searches (provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS domain_search_results (
  id uuid PRIMARY KEY,
  search_id uuid NOT NULL REFERENCES domain_searches(id) ON DELETE CASCADE,
  offering_id uuid NULL REFERENCES domain_provider_extension_offerings(id) ON DELETE SET NULL,
  domain_name varchar(253) NOT NULL,
  availability_status varchar(24) NOT NULL,
  is_premium boolean NOT NULL DEFAULT false,
  registration_price numeric(18,2) NULL,
  renewal_price numeric(18,2) NULL,
  transfer_price numeric(18,2) NULL,
  currency char(3) NULL,
  provider_reference varchar(255) NULL,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_search_results_status_check CHECK (availability_status IN ('available', 'registered', 'premium', 'unavailable', 'unsupported', 'provider_error')),
  CONSTRAINT domain_search_results_currency_check CHECK (currency IS NULL OR currency = upper(currency)),
  CONSTRAINT domain_search_results_price_check CHECK (
    (registration_price IS NULL OR registration_price >= 0) AND
    (renewal_price IS NULL OR renewal_price >= 0) AND
    (transfer_price IS NULL OR transfer_price >= 0)
  ),
  CONSTRAINT domain_search_results_unique UNIQUE (search_id, domain_name)
);
CREATE INDEX IF NOT EXISTS domain_search_results_lookup_idx ON domain_search_results (domain_name, checked_at DESC);

CREATE TABLE IF NOT EXISTS domain_bulk_searches (
  id uuid PRIMARY KEY,
  search_id uuid NOT NULL UNIQUE REFERENCES domain_searches(id) ON DELETE CASCADE,
  source_type varchar(16) NOT NULL,
  submitted_count integer NOT NULL,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  export_requested_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_bulk_searches_source_check CHECK (source_type IN ('text', 'csv', 'txt')),
  CONSTRAINT domain_bulk_searches_count_check CHECK (submitted_count >= 0 AND accepted_count >= 0 AND rejected_count >= 0)
);

-- -----------------------------------------------------------------------------------------------
-- Contact data and registrar-backed registration / transfer lifecycle
-- -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_contacts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encrypted_contact_data text NOT NULL,
  key_version integer NOT NULL,
  display_label varchar(120) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_contacts_key_version_check CHECK (key_version >= 1)
);
CREATE INDEX IF NOT EXISTS domain_contacts_user_idx ON domain_contacts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS domain_registrations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  customer_domain_id uuid NULL UNIQUE REFERENCES customer_domains(id) ON DELETE SET NULL,
  provider_id uuid NOT NULL REFERENCES domain_service_providers(id) ON DELETE RESTRICT,
  offering_id uuid NULL REFERENCES domain_provider_extension_offerings(id) ON DELETE SET NULL,
  contact_id uuid NULL REFERENCES domain_contacts(id) ON DELETE SET NULL,
  order_id uuid NULL UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id uuid NULL REFERENCES invoices(id) ON DELETE SET NULL,
  domain_name varchar(253) NOT NULL,
  registration_years integer NOT NULL DEFAULT 1,
  status varchar(32) NOT NULL DEFAULT 'pending_payment',
  provider_reference varchar(255) NULL,
  provider_status varchar(120) NULL,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NULL,
  confirmed_at timestamptz NULL,
  failed_at timestamptz NULL,
  error_code varchar(80) NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_registrations_years_check CHECK (registration_years BETWEEN 1 AND 10),
  CONSTRAINT domain_registrations_status_check CHECK (status IN ('pending_payment', 'payment_verified', 'registration_requested', 'pending_provider_confirmation', 'registered', 'failed', 'cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS domain_registrations_live_domain_unique_idx
  ON domain_registrations (lower(domain_name))
  WHERE status IN ('payment_verified', 'registration_requested', 'pending_provider_confirmation', 'registered');
CREATE INDEX IF NOT EXISTS domain_registrations_user_idx ON domain_registrations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_registrations_provider_idx ON domain_registrations (provider_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS domain_transfers (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  customer_domain_id uuid NULL UNIQUE REFERENCES customer_domains(id) ON DELETE SET NULL,
  provider_id uuid NOT NULL REFERENCES domain_service_providers(id) ON DELETE RESTRICT,
  contact_id uuid NULL REFERENCES domain_contacts(id) ON DELETE SET NULL,
  order_id uuid NULL UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id uuid NULL REFERENCES invoices(id) ON DELETE SET NULL,
  domain_name varchar(253) NOT NULL,
  current_registrar varchar(255) NULL,
  encrypted_auth_code text NULL,
  auth_code_key_version integer NULL,
  authorization_confirmed_at timestamptz NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  provider_reference varchar(255) NULL,
  provider_status varchar(120) NULL,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  initiated_at timestamptz NULL,
  completed_at timestamptz NULL,
  failed_at timestamptz NULL,
  error_code varchar(80) NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_transfers_status_check CHECK (status IN ('pending', 'authorization_required', 'transfer_initiated', 'transfer_in_progress', 'pending_registry', 'completed', 'failed', 'cancelled')),
  CONSTRAINT domain_transfers_auth_code_key_version_check CHECK (auth_code_key_version IS NULL OR auth_code_key_version >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS domain_transfers_live_domain_unique_idx
  ON domain_transfers (lower(domain_name))
  WHERE status IN ('pending', 'authorization_required', 'transfer_initiated', 'transfer_in_progress', 'pending_registry');
CREATE INDEX IF NOT EXISTS domain_transfers_user_idx ON domain_transfers (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_transfers_provider_idx ON domain_transfers (provider_id, status, created_at DESC);

-- -----------------------------------------------------------------------------------------------
-- Domain intelligence. WHOIS/RDAP persists only a privacy-respecting public projection, never a
-- raw registrant record or an attempt to deanonymise privacy-protected registrations.
-- -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_appraisals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id uuid NULL REFERENCES domain_service_providers(id) ON DELETE SET NULL,
  order_id uuid NULL UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id uuid NULL REFERENCES invoices(id) ON DELETE SET NULL,
  domain_name varchar(253) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending_payment',
  estimated_value numeric(18,2) NULL,
  currency char(3) NULL,
  confidence varchar(16) NULL,
  valuation jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_reference varchar(255) NULL,
  completed_at timestamptz NULL,
  error_code varchar(80) NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_appraisals_status_check CHECK (status IN ('pending_payment', 'payment_verified', 'requested', 'completed', 'provider_not_configured', 'failed', 'cancelled')),
  CONSTRAINT domain_appraisals_confidence_check CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high')),
  CONSTRAINT domain_appraisals_currency_check CHECK (currency IS NULL OR currency = upper(currency)),
  CONSTRAINT domain_appraisals_value_check CHECK (estimated_value IS NULL OR estimated_value >= 0)
);
CREATE INDEX IF NOT EXISTS domain_appraisals_user_idx ON domain_appraisals (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS domain_whois_lookups (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  provider_id uuid NULL REFERENCES domain_service_providers(id) ON DELETE SET NULL,
  domain_name varchar(253) NOT NULL,
  source varchar(16) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  public_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  privacy_protected boolean NOT NULL DEFAULT false,
  provider_reference varchar(255) NULL,
  error_code varchar(80) NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT domain_whois_lookups_source_check CHECK (source IN ('rdap', 'whois')),
  CONSTRAINT domain_whois_lookups_status_check CHECK (status IN ('pending', 'completed', 'provider_not_configured', 'not_found', 'rate_limited', 'failed'))
);
CREATE INDEX IF NOT EXISTS domain_whois_lookups_user_idx ON domain_whois_lookups (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_whois_lookups_domain_idx ON domain_whois_lookups (lower(domain_name), created_at DESC);

-- -----------------------------------------------------------------------------------------------
-- Auction and Domain Club core records. The auction service will lock its auction row and assign
-- monotonically increasing bid_sequence values inside one transaction; this schema supplies the
-- unique backstop against concurrent highest-bid races and duplicate idempotency submissions.
-- -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_auctions (
  id uuid PRIMARY KEY,
  seller_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  domain_name varchar(253) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'scheduled',
  currency char(3) NOT NULL,
  minimum_bid numeric(18,2) NOT NULL,
  bid_increment numeric(18,2) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  current_highest_bid numeric(18,2) NULL,
  current_highest_bidder_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  bid_count integer NOT NULL DEFAULT 0,
  winner_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_auctions_status_check CHECK (status IN ('scheduled', 'live', 'ending_soon', 'ended', 'cancelled', 'completed')),
  CONSTRAINT domain_auctions_currency_check CHECK (currency = upper(currency)),
  CONSTRAINT domain_auctions_bids_check CHECK (minimum_bid > 0 AND bid_increment > 0 AND (current_highest_bid IS NULL OR current_highest_bid >= minimum_bid)),
  CONSTRAINT domain_auctions_window_check CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS domain_auctions_browse_idx ON domain_auctions (status, ends_at ASC);
CREATE INDEX IF NOT EXISTS domain_auctions_domain_idx ON domain_auctions (lower(domain_name));

CREATE TABLE IF NOT EXISTS domain_bids (
  id uuid PRIMARY KEY,
  auction_id uuid NOT NULL REFERENCES domain_auctions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bid_sequence integer NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency char(3) NOT NULL,
  idempotency_key varchar(128) NULL,
  status varchar(24) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_bids_status_check CHECK (status IN ('active', 'outbid', 'winning', 'won', 'lost', 'void')),
  CONSTRAINT domain_bids_amount_check CHECK (amount > 0),
  CONSTRAINT domain_bids_currency_check CHECK (currency = upper(currency)),
  CONSTRAINT domain_bids_sequence_unique UNIQUE (auction_id, bid_sequence)
);
CREATE UNIQUE INDEX IF NOT EXISTS domain_bids_idempotency_unique_idx
  ON domain_bids (auction_id, user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS domain_bids_auction_idx ON domain_bids (auction_id, amount DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS domain_bids_user_idx ON domain_bids (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS domain_club_plans (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL,
  description text NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  currency char(3) NOT NULL,
  billing_period varchar(16) NOT NULL,
  price_amount numeric(18,2) NOT NULL,
  discount_type varchar(16) NOT NULL,
  discount_value numeric(18,2) NOT NULL,
  eligible_extensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  promotion jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_club_plans_status_check CHECK (status IN ('draft', 'published', 'disabled')),
  CONSTRAINT domain_club_plans_currency_check CHECK (currency = upper(currency)),
  CONSTRAINT domain_club_plans_period_check CHECK (billing_period IN ('monthly', 'annually')),
  CONSTRAINT domain_club_plans_price_check CHECK (price_amount >= 0),
  CONSTRAINT domain_club_plans_discount_check CHECK ((discount_type IN ('percentage', 'fixed')) AND discount_value >= 0 AND (discount_type <> 'percentage' OR discount_value <= 100))
);

CREATE TABLE IF NOT EXISTS domain_club_memberships (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES domain_club_plans(id) ON DELETE RESTRICT,
  subscription_id uuid NULL UNIQUE REFERENCES subscriptions(id) ON DELETE SET NULL,
  order_id uuid NULL UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  status varchar(24) NOT NULL DEFAULT 'pending_payment',
  starts_at timestamptz NULL,
  renews_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_club_memberships_status_check CHECK (status IN ('pending_payment', 'active', 'past_due', 'cancelled', 'expired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS domain_club_memberships_active_user_unique_idx
  ON domain_club_memberships (user_id) WHERE status IN ('pending_payment', 'active', 'past_due');
CREATE INDEX IF NOT EXISTS domain_club_memberships_user_idx ON domain_club_memberships (user_id, created_at DESC);

-- Domain payment/transaction index. The authoritative payment webhook still updates payments,
-- orders and invoices first; this table gives the Domain Services dashboard one traceable view.
CREATE TABLE IF NOT EXISTS domain_transactions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  transaction_type varchar(32) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  amount numeric(18,2) NOT NULL,
  currency char(3) NOT NULL,
  order_id uuid NULL REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id uuid NULL REFERENCES invoices(id) ON DELETE SET NULL,
  payment_id uuid NULL REFERENCES payments(id) ON DELETE SET NULL,
  registration_id uuid NULL REFERENCES domain_registrations(id) ON DELETE SET NULL,
  transfer_id uuid NULL REFERENCES domain_transfers(id) ON DELETE SET NULL,
  auction_id uuid NULL REFERENCES domain_auctions(id) ON DELETE SET NULL,
  appraisal_id uuid NULL REFERENCES domain_appraisals(id) ON DELETE SET NULL,
  broker_case_id uuid NULL REFERENCES domain_broker_cases(id) ON DELETE SET NULL,
  membership_id uuid NULL REFERENCES domain_club_memberships(id) ON DELETE SET NULL,
  provider_reference varchar(255) NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code varchar(80) NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_transactions_type_check CHECK (transaction_type IN ('registration', 'renewal', 'transfer', 'auction_payment', 'appraisal', 'club_membership', 'broker_fee', 'domain_acquisition', 'refund')),
  CONSTRAINT domain_transactions_status_check CHECK (status IN ('pending', 'authorized', 'processing', 'paid', 'failed', 'refunded', 'cancelled')),
  CONSTRAINT domain_transactions_currency_check CHECK (currency = upper(currency)),
  CONSTRAINT domain_transactions_amount_check CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS domain_transactions_user_idx ON domain_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_transactions_status_idx ON domain_transactions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_transactions_order_idx ON domain_transactions (order_id) WHERE order_id IS NOT NULL;
