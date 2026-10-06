-- Migration: 0075_create_expert_services.sql
-- Purpose: CloudHost247 "Hire an Expert" / Website Design Services — a real professional-services
-- request pipeline: catalogue, request, staff assignment, quote, customer approval, delivery and
-- completion, with a message thread and an event timeline.
--
-- Relationship to what exists (no duplication):
--   * Support tickets (0010/0011) remain the support channel. An expert request is a *scoped,
--     priced engagement* — it has a quote, an ordered deliverable and its own lifecycle. The
--     request can open a support ticket for conversation, and the Unified Inbox shows both, but
--     this pipeline is not a second ticket system: it never replaces a ticket and a ticket never
--     becomes a request automatically.
--   * Money moves through the ONE existing commerce stack. When a quote is approved, the request
--     creates an order + invoice via `createOrder`/`issueInvoiceForOrder` with
--     `order_items.metadata = { kind: 'expert_service', requestId }`. The paid-order provisioning
--     hook then advances the request — money is only ever recognized from a verified payment.
--
-- Pricing rule: the catalogue carries a *starting* price used for the public "from $X" label, and
-- nothing else. The amount actually charged is the staff-issued quote the customer explicitly
-- approves, never the catalogue label and never a client-supplied number.

CREATE TABLE IF NOT EXISTS expert_service_offerings (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  category varchar(40) NOT NULL,
  summary varchar(500) NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  deliverables jsonb NOT NULL DEFAULT '[]'::jsonb,
  typical_delivery_days integer NULL,
  starting_price_amount numeric(12, 2) NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  -- Whether the engagement is quoted before work starts (every professional service here) or is a
  -- fixed-price item that can be bought directly. Defaults to quoted; a fixed-price offering must
  -- have a price, enforced below.
  pricing_model varchar(16) NOT NULL DEFAULT 'quoted',
  status varchar(16) NOT NULL DEFAULT 'draft',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_service_offerings_category_check CHECK (
    category IN ('website_design', 'website_development', 'ecommerce', 'redesign', 'seo',
                 'migration', 'maintenance', 'integration', 'consulting')
  ),
  CONSTRAINT expert_service_offerings_pricing_model_check CHECK (pricing_model IN ('quoted', 'fixed')),
  CONSTRAINT expert_service_offerings_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT expert_service_offerings_fixed_price_check CHECK (
    pricing_model <> 'fixed' OR starting_price_amount IS NOT NULL
  ),
  CONSTRAINT expert_service_offerings_price_check CHECK (
    starting_price_amount IS NULL OR starting_price_amount >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS expert_service_offerings_code_unique_idx ON expert_service_offerings (lower(code));
CREATE INDEX IF NOT EXISTS expert_service_offerings_status_idx ON expert_service_offerings (status, sort_order);

CREATE TABLE IF NOT EXISTS expert_service_requests (
  id uuid PRIMARY KEY,
  reference varchar(24) NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  offering_id uuid NULL REFERENCES expert_service_offerings (id) ON DELETE SET NULL,
  offering_code varchar(64) NOT NULL,
  title varchar(200) NOT NULL,
  description text NOT NULL,
  goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  reference_url varchar(500) NULL,
  budget_amount numeric(12, 2) NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  desired_start_date date NULL,
  status varchar(24) NOT NULL DEFAULT 'requested',
  priority varchar(16) NOT NULL DEFAULT 'normal',
  assigned_staff_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  -- Set when a quote is approved and the existing commerce stack creates the order.
  order_id uuid NULL REFERENCES orders (id) ON DELETE SET NULL,
  invoice_id uuid NULL REFERENCES invoices (id) ON DELETE SET NULL,
  support_ticket_id uuid NULL REFERENCES support_tickets (id) ON DELETE SET NULL,
  cancelled_reason varchar(500) NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_service_requests_status_check CHECK (
    status IN ('requested', 'scoping', 'quoted', 'approved', 'in_progress', 'review',
               'delivered', 'completed', 'rejected', 'cancelled', 'failed')
  ),
  CONSTRAINT expert_service_requests_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT expert_service_requests_budget_check CHECK (budget_amount IS NULL OR budget_amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS expert_service_requests_reference_unique_idx ON expert_service_requests (reference);
CREATE INDEX IF NOT EXISTS expert_service_requests_user_idx ON expert_service_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS expert_service_requests_staff_idx ON expert_service_requests (assigned_staff_id, status);
CREATE INDEX IF NOT EXISTS expert_service_requests_status_idx ON expert_service_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS expert_service_quotes (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES expert_service_requests (id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  scope text NOT NULL,
  deliverables jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_days integer NULL,
  valid_until timestamptz NULL,
  status varchar(16) NOT NULL DEFAULT 'issued',
  issued_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  decided_at timestamptz NULL,
  decision_note varchar(500) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_service_quotes_amount_check CHECK (amount >= 0),
  CONSTRAINT expert_service_quotes_status_check CHECK (
    status IN ('issued', 'approved', 'declined', 'withdrawn', 'expired')
  )
);

CREATE INDEX IF NOT EXISTS expert_service_quotes_request_idx ON expert_service_quotes (request_id, created_at DESC);
-- At most one live quote per request; issuing a new one must withdraw the previous one first.
CREATE UNIQUE INDEX IF NOT EXISTS expert_service_quotes_live_unique_idx
  ON expert_service_quotes (request_id) WHERE status = 'issued';

CREATE TABLE IF NOT EXISTS expert_service_request_messages (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES expert_service_requests (id) ON DELETE CASCADE,
  author_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  author_role varchar(16) NOT NULL,
  -- 'customer' messages and 'staff' messages are both customer-visible; 'internal' notes are
  -- never returned by any customer-facing query.
  visibility varchar(16) NOT NULL DEFAULT 'customer',
  body text NOT NULL,
  attachment_media_id uuid NULL REFERENCES builder_media (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_service_request_messages_author_check CHECK (author_role IN ('customer', 'staff', 'system')),
  CONSTRAINT expert_service_request_messages_visibility_check CHECK (visibility IN ('customer', 'internal'))
);

CREATE INDEX IF NOT EXISTS expert_service_request_messages_request_idx
  ON expert_service_request_messages (request_id, created_at ASC);

CREATE TABLE IF NOT EXISTS expert_service_request_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES expert_service_requests (id) ON DELETE CASCADE,
  event_type varchar(60) NOT NULL,
  actor_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  actor_role varchar(16) NOT NULL DEFAULT 'system',
  from_status varchar(24) NULL,
  to_status varchar(24) NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expert_service_request_events_request_idx
  ON expert_service_request_events (request_id, created_at ASC);
