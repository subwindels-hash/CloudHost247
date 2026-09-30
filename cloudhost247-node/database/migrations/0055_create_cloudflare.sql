-- Migration: 0055_create_cloudflare.sql
-- Purpose: Cloudflare Reseller & Management subsystem. Cloudflare becomes a first-class service
-- provider inside the EXISTING platform: products/plans/pricing come from the existing catalog,
-- money flows through the existing orders/invoices/ledger/subscriptions, and the customer-facing
-- unit remains an ordinary customer_services row. These tables store only Cloudflare-specific
-- state: the reseller account (encrypted token), per-plan mapping/entitlements, the zone-backed
-- service record, a synchronized DNS cache, the durable provisioning/sync job queue, and an
-- API observability log. No billing/customer/auth table is duplicated.

-- ---------------------------------------------------------------------------------------------
-- 1. Reseller accounts. Designed multi-account from day one (spec §37); exactly one row is
--    'active' at a time today (partial unique index), which keeps the door open without a
--    rewrite. API tokens are AES-256-GCM envelopes (src/lib/crypto.ts) — never plaintext.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cloudflare_accounts (
  id uuid PRIMARY KEY,
  account_name varchar(120) NOT NULL,
  cloudflare_account_id varchar(64) NOT NULL,
  api_base_url varchar(255) NOT NULL DEFAULT 'https://api.cloudflare.com/client/v4',
  encrypted_api_token text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  default_zone_type varchar(16) NOT NULL DEFAULT 'full',
  default_ssl_mode varchar(16) NOT NULL DEFAULT 'full',
  default_proxied boolean NOT NULL DEFAULT true,
  last_connection_test_at timestamptz NULL,
  last_success_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_error text NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cloudflare_accounts_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT cloudflare_accounts_zone_type_check CHECK (default_zone_type IN ('full', 'partial')),
  CONSTRAINT cloudflare_accounts_ssl_mode_check CHECK (default_ssl_mode IN ('off', 'flexible', 'full', 'strict'))
);

CREATE UNIQUE INDEX IF NOT EXISTS cloudflare_accounts_single_active_idx
  ON cloudflare_accounts ((true)) WHERE status = 'active';

-- ---------------------------------------------------------------------------------------------
-- 2. Product plan ↔ Cloudflare plan mapping + feature entitlements (spec §6, §29, §57).
--    Admin-configured, never hard-coded. entitlements is a validated JSON object of
--    feature-key → boolean (zod schema in src/services/cloudflare-service.ts).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cloudflare_plan_mappings (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES product_plans (id) ON DELETE CASCADE,
  cloudflare_plan varchar(16) NOT NULL DEFAULT 'free',
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_domains integer NOT NULL DEFAULT 1,
  provisioning_mode varchar(16) NOT NULL DEFAULT 'automatic',
  default_ssl_mode varchar(16) NULL,
  default_proxied boolean NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cloudflare_plan_mappings_plan_check CHECK (cloudflare_plan IN ('free', 'pro', 'business', 'enterprise')),
  CONSTRAINT cloudflare_plan_mappings_mode_check CHECK (provisioning_mode IN ('automatic', 'manual')),
  CONSTRAINT cloudflare_plan_mappings_ssl_check CHECK (
    default_ssl_mode IS NULL OR default_ssl_mode IN ('off', 'flexible', 'full', 'strict')
  ),
  CONSTRAINT cloudflare_plan_mappings_max_domains_check CHECK (max_domains >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS cloudflare_plan_mappings_plan_unique_idx
  ON cloudflare_plan_mappings (plan_id);

-- ---------------------------------------------------------------------------------------------
-- 3. Cloudflare services (spec §10, §38): the zone-backed service record. 1:1 with an existing
--    customer_services row (the billing/service identity); Cloudflare's zone id is the external
--    provider identifier — never the domain name.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cloudflare_services (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  customer_service_id uuid NOT NULL REFERENCES customer_services (id) ON DELETE RESTRICT,
  cloudflare_account_id uuid NULL REFERENCES cloudflare_accounts (id) ON DELETE SET NULL,
  customer_domain_id uuid NULL REFERENCES customer_domains (id) ON DELETE SET NULL,
  hosting_service_id uuid NULL REFERENCES customer_services (id) ON DELETE SET NULL,
  subscription_id uuid NULL REFERENCES subscriptions (id) ON DELETE SET NULL,
  order_id uuid NULL REFERENCES orders (id) ON DELETE SET NULL,
  plan_id uuid NOT NULL REFERENCES product_plans (id) ON DELETE RESTRICT,
  cloudflare_plan varchar(16) NOT NULL DEFAULT 'free',
  zone_id varchar(64) NULL,
  zone_name varchar(253) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  activation_status varchar(32) NOT NULL DEFAULT 'pending',
  name_server_1 varchar(255) NULL,
  name_server_2 varchar(255) NULL,
  proxy_default boolean NOT NULL DEFAULT true,
  ssl_mode varchar(16) NULL,
  development_mode_until timestamptz NULL,
  last_synced_at timestamptz NULL,
  last_error_code varchar(64) NULL,
  last_error_message text NULL,
  suspended_at timestamptz NULL,
  terminated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cloudflare_services_status_check CHECK (status IN (
    'pending', 'provisioning', 'active', 'suspended', 'provisioning_failed',
    'sync_failed', 'terminating', 'terminated'
  )),
  CONSTRAINT cloudflare_services_activation_check CHECK (activation_status IN (
    'pending_nameserver_update', 'pending', 'active', 'error'
  )),
  CONSTRAINT cloudflare_services_plan_check CHECK (cloudflare_plan IN ('free', 'pro', 'business', 'enterprise'))
);

CREATE UNIQUE INDEX IF NOT EXISTS cloudflare_services_customer_service_unique_idx
  ON cloudflare_services (customer_service_id);
-- One live Cloudflare service per zone: a second service can never silently capture another
-- customer's zone (spec §42, §71).
CREATE UNIQUE INDEX IF NOT EXISTS cloudflare_services_zone_unique_idx
  ON cloudflare_services (zone_id) WHERE zone_id IS NOT NULL AND status <> 'terminated';
-- One live Cloudflare service per zone name, likewise.
CREATE UNIQUE INDEX IF NOT EXISTS cloudflare_services_zone_name_unique_idx
  ON cloudflare_services (lower(zone_name)) WHERE status <> 'terminated';
CREATE INDEX IF NOT EXISTS cloudflare_services_customer_idx ON cloudflare_services (customer_id);
CREATE INDEX IF NOT EXISTS cloudflare_services_status_idx ON cloudflare_services (status);

-- ---------------------------------------------------------------------------------------------
-- 4. DNS record cache (spec §39, §44): a synchronized REPRESENTATION — Cloudflare remains the
--    provider-side source of truth. Every row carries Cloudflare's record id, and `ownership`
--    separates SYSTEM_MANAGED rows (written by hosting provisioning; may be updated by IP sync)
--    from CUSTOMER_MANAGED rows (never touched by automation).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cloudflare_dns_records (
  id uuid PRIMARY KEY,
  cloudflare_service_id uuid NOT NULL REFERENCES cloudflare_services (id) ON DELETE CASCADE,
  cloudflare_record_id varchar(64) NOT NULL,
  type varchar(10) NOT NULL,
  name varchar(255) NOT NULL,
  content text NOT NULL,
  ttl integer NOT NULL DEFAULT 1,
  proxied boolean NOT NULL DEFAULT false,
  priority integer NULL,
  comment varchar(500) NULL,
  ownership varchar(20) NOT NULL DEFAULT 'CUSTOMER_MANAGED',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NULL,
  CONSTRAINT cloudflare_dns_records_ownership_check CHECK (ownership IN ('SYSTEM_MANAGED', 'CUSTOMER_MANAGED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS cloudflare_dns_records_provider_unique_idx
  ON cloudflare_dns_records (cloudflare_service_id, cloudflare_record_id);
CREATE INDEX IF NOT EXISTS cloudflare_dns_records_service_idx ON cloudflare_dns_records (cloudflare_service_id);

-- ---------------------------------------------------------------------------------------------
-- 5. Durable background job queue (spec §41–§42): provisioning/sync/lifecycle never runs inside
--    an HTTP request. Claim-lease + attempts + exponential backoff, idempotency_key UNIQUE so a
--    duplicate webhook can never enqueue the same provisioning twice.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cloudflare_jobs (
  id uuid PRIMARY KEY,
  cloudflare_service_id uuid NOT NULL REFERENCES cloudflare_services (id) ON DELETE CASCADE,
  job_type varchar(32) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_by varchar(64) NULL,
  locked_at timestamptz NULL,
  idempotency_key varchar(160) NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  CONSTRAINT cloudflare_jobs_type_check CHECK (job_type IN (
    'provision_zone', 'sync_zone', 'change_plan', 'suspend', 'unsuspend', 'terminate', 'sync_hosting_ip'
  )),
  CONSTRAINT cloudflare_jobs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS cloudflare_jobs_idempotency_unique_idx
  ON cloudflare_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS cloudflare_jobs_due_idx ON cloudflare_jobs (status, next_attempt_at)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS cloudflare_jobs_service_idx ON cloudflare_jobs (cloudflare_service_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 6. API observability log (spec §62): request/response envelope WITHOUT secrets or bodies.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cloudflare_api_logs (
  id uuid PRIMARY KEY,
  request_id varchar(64) NOT NULL,
  cloudflare_service_id uuid NULL REFERENCES cloudflare_services (id) ON DELETE SET NULL,
  operation varchar(64) NOT NULL,
  method varchar(8) NOT NULL,
  path varchar(255) NOT NULL,
  status_code integer NULL,
  success boolean NOT NULL DEFAULT false,
  duration_ms integer NULL,
  error_code varchar(64) NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cloudflare_api_logs_created_idx ON cloudflare_api_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS cloudflare_api_logs_service_idx ON cloudflare_api_logs (cloudflare_service_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cloudflare_api_logs_success_idx ON cloudflare_api_logs (success, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 7. Cart items gain optional, server-validated configuration metadata so a Cloudflare line can
--    carry its target domain from cart → order item (mirrors order_items.metadata added in 0037).
--    Additive and nullable: existing cart behaviour is unchanged.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS metadata jsonb NULL;

-- ---------------------------------------------------------------------------------------------
-- 8. Module settings in the existing platform_settings table.
-- ---------------------------------------------------------------------------------------------
INSERT INTO platform_settings (key, value, description) VALUES
  ('cloudflare.enabled', 'true', 'Master switch for the Cloudflare integration module'),
  ('cloudflare.sync_interval_minutes', '360', 'How often the worker re-synchronizes active Cloudflare zones'),
  ('cloudflare.suspension_policy', '"pause_zone"', 'What suspension does at Cloudflare: pause_zone (stop proxying) or none (local-only)'),
  ('cloudflare.termination_policy', '"delete_zone"', 'What termination does at Cloudflare: delete_zone or detach (keep zone, forget it locally)')
ON CONFLICT (key) DO NOTHING;
