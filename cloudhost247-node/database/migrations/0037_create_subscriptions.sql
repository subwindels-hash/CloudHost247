-- Migration: 0037_create_subscriptions.sql
-- Purpose: Phase 6 — recurring hosting/application subscriptions (spec §19, §21) and order-item
-- provisioning metadata.
--
-- The Phase 5 commerce model is order/invoice/payment based; subscriptions add the recurring
-- lifecycle on top: an order item that represents recurring hosting (a VPS plan, a marketplace
-- app plan) creates a subscription row when its order is paid. Lifecycle (spec §21):
-- active/trialing → past_due → grace_period → suspended → terminated, with cancelled/expired as
-- customer-initiated/natural ends. Grace period length comes from platform_settings
-- (admin-configurable, spec §21) and is snapshotted onto the row when a subscription first goes
-- past_due, so changing the global default never retroactively changes an in-flight dunning run.
--
-- order_items gains a `metadata` jsonb column (spec §19) used by the provisioning hook to carry
-- the installation_id / hosting target a paid item should activate — set server-side at checkout,
-- never accepted from the client.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS metadata jsonb NULL;

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES product_plans (id) ON DELETE RESTRICT,
  order_id uuid NULL REFERENCES orders (id) ON DELETE SET NULL,
  installation_id uuid NULL REFERENCES application_installations (id) ON DELETE SET NULL,
  status varchar(24) NOT NULL DEFAULT 'active',
  provider varchar(32) NULL,
  provider_subscription_id varchar(255) NULL,
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz NULL,
  grace_period_days integer NULL,
  past_due_since timestamptz NULL,
  suspended_at timestamptz NULL,
  terminated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_status_check CHECK (
    status IN ('active', 'trialing', 'past_due', 'grace_period', 'suspended', 'cancelled', 'expired', 'terminated')
  )
);

CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_plan_idx ON subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS subscriptions_installation_idx ON subscriptions (installation_id);
CREATE INDEX IF NOT EXISTS subscriptions_lifecycle_idx ON subscriptions (status, current_period_end);
