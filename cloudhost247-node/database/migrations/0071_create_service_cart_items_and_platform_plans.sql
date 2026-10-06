-- Migration: 0071_create_service_cart_items_and_platform_plans.sql
-- Purpose: Unified CloudHost247 commerce — service lines in the ONE existing cart, and the ONE
-- admin-managed price list that prices packaged platform services.
--
-- Why two tables and not a second cart/checkout:
--
--   `carts` (0014) + `cart_items` (0015) already model "a plan from the catalog, in the cart".
--   The expansion adds services that are NOT catalog plans (a domain registration, a Website
--   Builder tier, an Online Store tier, a marketing plan, a logo package). Rather than forking a
--   second cart, checkout, order or invoice for them, `cart_service_items` hangs off the SAME
--   `carts` row and is merged into the SAME `orders`/`order_items`/`invoices` by the SAME
--   checkout code path (src/services/commerce-service.ts). Product → Cart → Checkout → Payment →
--   Order → Fulfilment stays a single pipeline with two line kinds, exactly as specified.
--
--   `cart_items` is deliberately left untouched: `plan_id` stays NOT NULL there, all existing
--   queries and tests keep their exact semantics, and nothing about an existing cart changes.
--
-- No price is ever stored on a service line. Like `cart_items`, price is resolved live,
-- server-side, at read and checkout time (src/commerce/service-pricing.ts), from one of two
-- authoritative sources:
--
--   * `domain_registration` — the server-side registration quote (registrar-confirmed price, with
--     any active Domain Club discount applied), never a client-supplied number; the row points at
--     the real `domain_registrations` draft created by the quote.
--   * `platform_plan`       — `platform_service_plans` below (admin-published price in USD).
--
-- `service_ref` is the immutable identifier the resolver needs (a registration id, or a plan id),
-- never a display string and never a price. `service_name` is only a display snapshot; the
-- authoritative name is re-read from the source at checkout.
--
-- Residual: a service line whose price source has since been unpublished/removed resolves to
-- NULL and is surfaced as "pricing no longer available — remove this item" by the same
-- `hasUnavailableItems` mechanism the catalog lines already use. Checkout refuses the whole cart
-- rather than silently dropping or re-pricing the line.

CREATE TABLE IF NOT EXISTS cart_service_items (
  id uuid PRIMARY KEY,
  cart_id uuid NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  service_kind varchar(40) NOT NULL,
  service_ref varchar(120) NOT NULL,
  service_name varchar(255) NOT NULL,
  billing_period varchar(16) NOT NULL DEFAULT 'one_time',
  quantity integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_service_items_kind_check CHECK (
    service_kind IN (
      'domain_registration',
      'platform_plan',
      'expert_service',
      'marketing_plan'
    )
  ),
  CONSTRAINT cart_service_items_billing_period_check CHECK (
    billing_period IN ('one_time', 'monthly', 'quarterly', 'semi_annually', 'annually')
  ),
  CONSTRAINT cart_service_items_quantity_check CHECK (quantity > 0 AND quantity <= 20)
);

-- Adding the same service line twice is an upsert against this key (application-level), never a
-- duplicate line — the same rule cart_items uses for (cart, plan, cadence).
CREATE UNIQUE INDEX IF NOT EXISTS cart_service_items_unique_idx
  ON cart_service_items (cart_id, service_kind, service_ref, billing_period);
CREATE INDEX IF NOT EXISTS cart_service_items_cart_idx ON cart_service_items (cart_id);

-- One draft domain registration may only sit in one cart line at a time; the registrations table's
-- own partial index continues to protect live registrations.
CREATE UNIQUE INDEX IF NOT EXISTS cart_service_items_registration_unique_idx
  ON cart_service_items (service_ref)
  WHERE service_kind = 'domain_registration';

-- Admin-managed price list for packaged CloudHost247 services that are sold as a tier/monthly
-- plan rather than as a hosting product in the catalog: Website Builder (advanced tiers), AI
-- Website Builder, Online Store, Digital Marketing and Unified Inbox.
--
-- Deliberately ships EMPTY. No price is ever invented for a CloudHost247 product: a service with
-- no published row renders the honest "no plan has been published yet" state (the same rule
-- src/routes/catalog-public.ts follows for hosting plans), and a Super Admin publishes real
-- prices in Admin → Platform Services.
--
-- Single-currency platform (docs/API_BILLING.md): `currency` exists for forward compatibility but
-- checkout only accepts USD rows, exactly like `plan_pricing`.
CREATE TABLE IF NOT EXISTS platform_service_plans (
  id uuid PRIMARY KEY,
  service_kind varchar(40) NOT NULL,
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  description text NULL,
  billing_period varchar(16) NOT NULL,
  price_amount numeric(12, 2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What the tier includes, enforced by the entitlement check (src/commerce/entitlements.ts):
  -- e.g. {"sites":3,"aiGenerationsPerMonth":25,"products":500,"seats":5}. Nulls/absent keys mean
  -- "not included by this tier", never "unlimited".
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'draft',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_service_plans_kind_check CHECK (
    service_kind IN ('website_builder', 'ai_builder', 'online_store', 'marketing', 'inbox', 'logo_maker')
  ),
  CONSTRAINT platform_service_plans_status_check CHECK (
    status IN ('draft', 'published', 'archived')
  ),
  CONSTRAINT platform_service_plans_billing_period_check CHECK (
    billing_period IN ('one_time', 'monthly', 'quarterly', 'semi_annually', 'annually')
  ),
  CONSTRAINT platform_service_plans_price_check CHECK (price_amount >= 0),
  CONSTRAINT platform_service_plans_currency_check CHECK (currency = upper(currency))
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_service_plans_code_period_unique_idx
  ON platform_service_plans (service_kind, code, billing_period);
CREATE INDEX IF NOT EXISTS platform_service_plans_published_idx
  ON platform_service_plans (service_kind, status, sort_order);
