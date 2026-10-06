-- Migration: 0079_extend_subscriptions_for_platform_plans.sql
-- Purpose: let the EXISTING subscription lifecycle (0037 + src/worker/sweeps.ts dunning) carry the
-- recurring CloudHost247 platform services that are sold as packed tiers rather than as catalogue
-- hosting products: Website Builder tiers, AI Website Builder, Online Store, Digital Marketing
-- engagements and the Unified Inbox.
--
-- Additive and backwards compatible:
--   * `plan_id` becomes nullable — every existing row keeps its value, and the partial CHECK below
--     requires exactly one of the two references to be set, which every existing row already
--     satisfies.
--   * `platform_plan_id` references `platform_service_plans` (0071) — the same admin-managed price
--     list the cart line was priced from.
--   * `resource_type` / `resource_id` record which platform object the subscription entitles
--     (a builder site, a store, an inbox), so a tier change or a cancelled subscription can find
--     exactly what it governs without a new join table per product.
--
-- No dunning column changes: grace period, suspension and termination already read only from the
-- subscription row itself, so platform tiers inherit the same lifecycle for free.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS platform_plan_id uuid NULL;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS resource_type varchar(32) NULL;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS resource_id uuid NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'subscriptions' AND column_name = 'plan_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE subscriptions ALTER COLUMN plan_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_reference_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_reference_check
  CHECK ((plan_id IS NOT NULL) <> (platform_plan_id IS NOT NULL));

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_platform_plan_fk;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_platform_plan_fk
  FOREIGN KEY (platform_plan_id) REFERENCES platform_service_plans (id) ON DELETE SET NULL;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_resource_type_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_resource_type_check
  CHECK (resource_type IS NULL OR resource_type IN ('builder_site', 'store', 'inbox', 'marketing_campaign'));

CREATE INDEX IF NOT EXISTS subscriptions_platform_plan_idx ON subscriptions (platform_plan_id);
CREATE INDEX IF NOT EXISTS subscriptions_resource_idx ON subscriptions (resource_type, resource_id);

-- One live subscription per (order, platform plan): the settlement hook is idempotent against this
-- index, so a redelivered payment webhook can never create a second entitlement for the same line.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_order_platform_plan_unique_idx
  ON subscriptions (order_id, platform_plan_id)
  WHERE platform_plan_id IS NOT NULL AND order_id IS NOT NULL;
