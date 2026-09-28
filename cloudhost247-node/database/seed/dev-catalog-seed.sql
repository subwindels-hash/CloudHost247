-- database/seed/dev-catalog-seed.sql
--
-- OPTIONAL, DEV/TEST-ONLY fixture data for the Phase 3 catalog. This is NOT a migration (it lives
-- outside database/migrations/ on purpose) and is NEVER run automatically by `npm run migrate` or
-- any part of the application boot sequence. Run it by hand against a local/dev database only,
-- e.g.:
--
--   psql "$DATABASE_URL" -f database/seed/dev-catalog-seed.sql
--
-- Every row inserted here is obviously and explicitly a placeholder/dev fixture — see the
-- "(dev fixture — not a real CloudHost247 price)" note repeated below. None of this is real
-- CloudHost247 commercial pricing, and none of it should ever be deployed to production. The real
-- production catalog is populated exclusively through the authenticated admin API
-- (POST/PATCH /api/v1/admin/catalog/..., see docs/API_CATALOG.md), by a super_admin, with real
-- reviewed pricing — never by running this file against a production database.
--
-- Idempotent: every INSERT uses a fixed, obviously-fake UUID and `ON CONFLICT (id) DO NOTHING`,
-- so running this file twice against the same database is safe and a no-op the second time.
-- To remove this fixture data again, delete by these same ids (products cascade to their plans/
-- pricing/features via ON DELETE CASCADE):
--
--   DELETE FROM products WHERE id = '00000000-0000-4000-8000-000000000001';

BEGIN;

-- One example "hosting" product, published (active + public) with one plan and one published
-- price, so a developer can see the full /hosting/cpanel-style "Plans & pricing" UI render real
-- data end-to-end without needing to click through the admin API by hand first.
INSERT INTO products (id, slug, name, description, product_type, status, visibility, display_order)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'dev-example-hosting',
  '[DEV FIXTURE] Example Hosting',
  'Development/test fixture product — not a real CloudHost247 offering.',
  'hosting',
  'active',
  'public',
  9000
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO product_plans (id, product_id, slug, name, description, status, billing_model, display_order)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'dev-example-plan',
  '[DEV FIXTURE] Example Plan',
  'Development/test fixture plan.',
  'active',
  'recurring',
  1
)
ON CONFLICT (id) DO NOTHING;

-- (dev fixture — not a real CloudHost247 price)
INSERT INTO plan_pricing (id, plan_id, billing_period, currency, amount, setup_fee, effective_status)
VALUES (
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000002',
  'monthly',
  'USD',
  1.23,
  0,
  'published'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO plan_features (id, plan_id, feature_name, feature_value, display_order, visibility)
VALUES (
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000002',
  'Example feature',
  'Example value',
  1,
  'public'
)
ON CONFLICT (id) DO NOTHING;

-- A second example product left deliberately in 'draft' status, to make the honest
-- "coming soon" / unavailable-product UI state easy to see locally without any admin API calls.
INSERT INTO products (id, slug, name, description, product_type, status, visibility, display_order)
VALUES (
  '00000000-0000-4000-8000-000000000005',
  'dev-example-draft-product',
  '[DEV FIXTURE] Example Draft Product',
  'Development/test fixture product left in draft status on purpose (coming-soon state).',
  'service',
  'draft',
  'public',
  9001
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
