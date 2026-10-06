-- Migration: 0076_create_digital_marketing_services.sql
-- Purpose: CloudHost247 Digital Marketing — a managed-services catalogue across SEO, search
-- marketing, social, email, advertising and analytics, campaign engagements with a real lifecycle,
-- Monthly recurring engagement billing through the existing subscription/commerce stack, reporting
-- periods that hold only real, source-attributed numbers, and a per-provider integration status
-- that never claims a connection the platform does not have.
--
-- Relationship to what exists (no duplication):
--   * `modules/addons/cloudhost247_marketing/` (the WHMCS-side email marketing suite) keeps
--     ownership of *sending* campaigns from this platform's own list. This module sells and manages
--     marketing *services* and records what an external channel/provider reports; where email is
--     the channel, the campaign engagement delegates to that existing engine rather than building
--     a second mailer. `marketing_channel_connections` below only records the integration state.
--   * Billing uses the ONE existing commerce stack: a recurring engagement creates a subscription
--     against a `product_plans` row when the service is sold as a catalog product, or an order +
--     invoice from `platform_service_plans` when sold as a packaged tier.
--
-- Reporting rule: `marketing_report_metrics` stores numbers with an explicit `source` (which
-- connection produced them) and `is_estimated`. A metric with no real source is simply absent —
-- the report renders "not connected yet" instead of a plausible-looking zero, exactly as the
-- Domain Services and Tools Center rules require.

CREATE TABLE IF NOT EXISTS marketing_service_offerings (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  channel varchar(40) NOT NULL,
  summary varchar(500) NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  deliverables jsonb NOT NULL DEFAULT '[]'::jsonb,
  starting_price_amount numeric(12, 2) NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  billing_period varchar(16) NOT NULL DEFAULT 'monthly',
  min_term_months integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'draft',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_service_offerings_channel_check CHECK (
    channel IN ('seo', 'search_ads', 'social', 'email', 'advertising', 'analytics', 'content', 'conversion')
  ),
  CONSTRAINT marketing_service_offerings_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT marketing_service_offerings_billing_check CHECK (
    billing_period IN ('one_time', 'monthly', 'quarterly', 'semi_annually', 'annually')
  ),
  CONSTRAINT marketing_service_offerings_price_check CHECK (
    starting_price_amount IS NULL OR starting_price_amount >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_service_offerings_code_unique_idx ON marketing_service_offerings (lower(code));
CREATE INDEX IF NOT EXISTS marketing_service_offerings_status_idx ON marketing_service_offerings (status, sort_order);

-- Which external channel integrations actually exist, and their verified state. Credentials are
-- NOT stored here: they live in the AI & Integrations centre (encrypted, write-only), and this row
-- only records which provider key was selected and the outcome of the last real connection test.
CREATE TABLE IF NOT EXISTS marketing_channel_connections (
  id uuid PRIMARY KEY,
  channel varchar(40) NOT NULL,
  name varchar(120) NOT NULL,
  provider_key varchar(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'not_configured',
  last_checked_at timestamptz NULL,
  last_error_code varchar(64) NULL,
  last_error_message varchar(500) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_channel_connections_channel_check CHECK (
    channel IN ('seo', 'search_ads', 'social', 'email', 'advertising', 'analytics', 'content', 'conversion')
  ),
  CONSTRAINT marketing_channel_connections_status_check CHECK (
    status IN ('not_configured', 'connected', 'auth_failed', 'error', 'disabled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_channel_connections_unique_idx
  ON marketing_channel_connections (channel, provider_key);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id uuid PRIMARY KEY,
  reference varchar(24) NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  offering_id uuid NULL REFERENCES marketing_service_offerings (id) ON DELETE SET NULL,
  offering_code varchar(64) NOT NULL,
  channel varchar(40) NOT NULL,
  name varchar(200) NOT NULL,
  goal text NOT NULL,
  target_url varchar(500) NULL,
  target_audience text NULL,
  monthly_budget_amount numeric(12, 2) NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  status varchar(24) NOT NULL DEFAULT 'requested',
  assigned_staff_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  order_id uuid NULL REFERENCES orders (id) ON DELETE SET NULL,
  invoice_id uuid NULL REFERENCES invoices (id) ON DELETE SET NULL,
  subscription_id uuid NULL REFERENCES subscriptions (id) ON DELETE SET NULL,
  started_at timestamptz NULL,
  paused_at timestamptz NULL,
  ends_at timestamptz NULL,
  completed_at timestamptz NULL,
  cancelled_reason varchar(500) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaigns_status_check CHECK (
    status IN ('requested', 'planning', 'active', 'paused', 'reporting', 'completed',
               'rejected', 'cancelled', 'failed')
  ),
  CONSTRAINT marketing_campaigns_channel_check CHECK (
    channel IN ('seo', 'search_ads', 'social', 'email', 'advertising', 'analytics', 'content', 'conversion')
  ),
  CONSTRAINT marketing_campaigns_budget_check CHECK (monthly_budget_amount IS NULL OR monthly_budget_amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_campaigns_reference_unique_idx ON marketing_campaigns (reference);
CREATE INDEX IF NOT EXISTS marketing_campaigns_user_idx ON marketing_campaigns (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_campaigns_status_idx ON marketing_campaigns (status, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_campaign_events (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns (id) ON DELETE CASCADE,
  event_type varchar(60) NOT NULL,
  actor_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  actor_role varchar(16) NOT NULL DEFAULT 'system',
  from_status varchar(24) NULL,
  to_status varchar(24) NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_campaign_events_campaign_idx
  ON marketing_campaign_events (campaign_id, created_at ASC);

CREATE TABLE IF NOT EXISTS marketing_campaign_messages (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns (id) ON DELETE CASCADE,
  author_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  author_role varchar(16) NOT NULL,
  visibility varchar(16) NOT NULL DEFAULT 'customer',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaign_messages_author_check CHECK (author_role IN ('customer', 'staff', 'system')),
  CONSTRAINT marketing_campaign_messages_visibility_check CHECK (visibility IN ('customer', 'internal'))
);

CREATE INDEX IF NOT EXISTS marketing_campaign_messages_campaign_idx
  ON marketing_campaign_messages (campaign_id, created_at ASC);

-- Reporting periods. A period with no connected source is created as `unavailable` and renders as
-- "no source connected" — never as zeros that look like measured performance.
CREATE TABLE IF NOT EXISTS marketing_report_periods (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns (id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  summary text NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL,
  CONSTRAINT marketing_report_periods_status_check CHECK (
    status IN ('pending', 'collecting', 'published', 'unavailable')
  ),
  CONSTRAINT marketing_report_periods_range_check CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_report_periods_unique_idx
  ON marketing_report_periods (campaign_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS marketing_report_metrics (
  id uuid PRIMARY KEY,
  period_id uuid NOT NULL REFERENCES marketing_report_periods (id) ON DELETE CASCADE,
  metric_key varchar(60) NOT NULL,
  metric_label varchar(120) NOT NULL,
  value numeric(18, 4) NOT NULL,
  unit varchar(24) NOT NULL DEFAULT 'count',
  -- Which integration actually reported this number. Required: an unattributed metric cannot be
  -- stored, so a report can never contain a number nobody can trace.
  source varchar(60) NOT NULL,
  is_estimated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_report_metrics_unit_check CHECK (
    unit IN ('count', 'currency', 'percent', 'ratio', 'seconds')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_report_metrics_unique_idx
  ON marketing_report_metrics (period_id, metric_key, source);
