-- database/seed/dev-domain-extensions-seed.sql
--
-- OPTIONAL, DEV/TEST-ONLY fixture data for the Domain Services extension catalogue. Like
-- dev-catalog-seed.sql this is NOT a migration, is never run by `npm run migrate`, and must never
-- be applied to production.
--
-- Why it exists: the public price tags under the domain search bar
-- (frontend/src/components/domain/TldPriceRow.tsx) print the registrar's own snapshot from
-- domain_provider_extension_offerings. On a fresh local database there is no provider and no
-- catalogue, so there is nothing to render end to end. These rows make that path visible locally.
--
-- Every value here is a fixture: the provider is named "[DEV FIXTURE] …" and the prices are
-- placeholders, not CloudHost247 commercial pricing. Real prices only ever arrive from a connected
-- registrar through the admin "sync extensions" action.
--
-- Idempotent: fixed, obviously-fake UUIDs with ON CONFLICT DO NOTHING.
-- To remove: DELETE FROM domain_service_providers WHERE id = '00000000-0000-4000-8000-00000000d001';
-- (offerings cascade from the provider; delete the extensions separately).

BEGIN;

INSERT INTO domain_service_providers
  (id, provider_key, name, adapter_key, provider_type, environment, status, capabilities, configuration)
VALUES (
  '00000000-0000-4000-8000-00000000d001',
  'dev-fixture-registrar',
  '[DEV FIXTURE] Registrar (local only)',
  'namecheap',
  'registrar',
  'sandbox',
  'connected',
  '{"search": true, "tldCatalogue": true}'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO domain_extensions (id, extension, description, is_trending, status) VALUES
  ('00000000-0000-4000-8000-0000000e0001', 'com',   '[DEV FIXTURE] The familiar default.', true,  'active'),
  ('00000000-0000-4000-8000-0000000e0002', 'net',   '[DEV FIXTURE] Network-flavoured name.', false, 'active'),
  ('00000000-0000-4000-8000-0000000e0003', 'org',   '[DEV FIXTURE] Organisations and communities.', false, 'active'),
  ('00000000-0000-4000-8000-0000000e0004', 'space', '[DEV FIXTURE] Short, memorable names.', true,  'active'),
  ('00000000-0000-4000-8000-0000000e0005', 'fun',   '[DEV FIXTURE] Playful projects.', true,  'active'),
  ('00000000-0000-4000-8000-0000000e0006', 'icu',   '[DEV FIXTURE] "I see you" — short and cheap.', true,  'active'),
  ('00000000-0000-4000-8000-0000000e0007', 'shop',  '[DEV FIXTURE] Storefronts.', true,  'active'),
  ('00000000-0000-4000-8000-0000000e0008', 'top',   '[DEV FIXTURE] Broad, generic name.', true,  'active'),
  ('00000000-0000-4000-8000-0000000e0009', 'cn',    '[DEV FIXTURE] China country-code extension.', true,  'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO domain_provider_extension_offerings
  (id, provider_id, extension_id, provider_tld, registration_price, renewal_price, transfer_price, currency, premium_supported, status)
VALUES
  ('00000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000e0001', 'com',   11.98, 14.98, 11.98, 'USD', false, 'enabled'),
  ('00000000-0000-4000-8000-0000000f0002', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000e0002', 'net',   13.98, 15.98, 13.98, 'USD', false, 'enabled'),
  ('00000000-0000-4000-8000-0000000f0003', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000e0003', 'org',   12.48, 14.48, 12.48, 'USD', false, 'enabled'),
  ('00000000-0000-4000-8000-0000000f0004', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000e0004', 'space',  1.18,  8.98,  8.98, 'USD', false, 'enabled'),
  ('00000000-0000-4000-8000-0000000f0005', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000e0005', 'fun',    1.48,  9.98,  9.98, 'USD', false, 'enabled'),
  ('00000000-0000-4000-8000-0000000f0006', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000e0006', 'icu',    1.48,  8.98,  8.98, 'USD', false, 'enabled'),
  ('00000000-0000-4000-8000-0000000f0007', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000e0007', 'shop',   1.88,  9.98,  9.98, 'USD', false, 'enabled'),
  ('00000000-0000-4000-8000-0000000f0008', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000e0008', 'top',    1.98,  8.98,  8.98, 'USD', false, 'enabled'),
  ('00000000-0000-4000-8000-0000000f0009', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-0000000e0009', 'cn',     9.88, 12.88,  9.88, 'USD', false, 'enabled')
ON CONFLICT (id) DO NOTHING;

COMMIT;
