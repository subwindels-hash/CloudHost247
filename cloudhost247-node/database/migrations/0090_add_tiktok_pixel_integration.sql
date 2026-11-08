-- Migration: 0090_add_tiktok_pixel_integration.sql
-- TikTok Pixel + Events API as a second provider on the canonical marketing
-- infrastructure created by 0089 (configuration, encrypted secrets, consent
-- sessions, deduplicated events and the delivery outbox are shared, never
-- duplicated). Additive only; the Meta Pixel row and its checks are preserved.
-- A TikTok Pixel ID ("pixel code") is public configuration. The Events API
-- access token lives only in the separate encrypted secret table.

ALTER TABLE marketing_integrations DROP CONSTRAINT marketing_integrations_provider_check;
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_provider_check
  CHECK (provider_key IN ('meta_pixel', 'tiktok_pixel'));

-- The 0089 enabled-requires-id check hard-codes Meta's numeric Pixel ID.
-- Replace it with a provider-conditional equivalent (Meta rule unchanged;
-- TikTok pixel codes are alphanumeric, see src/tiktok/types.ts).
ALTER TABLE marketing_integrations DROP CONSTRAINT marketing_integrations_enabled_requires_id;
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_enabled_requires_id CHECK (
  NOT enabled OR (
    website_domain <> '' AND (
      (provider_key = 'meta_pixel' AND configuration->>'pixelId' ~ '^[1-9][0-9]{4,31}$')
      OR (provider_key = 'tiktok_pixel' AND configuration->>'pixelId' ~ '^[A-Za-z0-9]{16,32}$')
    )
  )
);

ALTER TABLE marketing_integration_secrets DROP CONSTRAINT marketing_integration_secrets_key_check;
ALTER TABLE marketing_integration_secrets ADD CONSTRAINT marketing_integration_secrets_key_check
  CHECK (secret_key IN ('capi_access_token', 'events_api_access_token'));

-- TikTok standard events that have no Meta equivalent in the 0089 allowlist.
-- Shared names (ViewContent, Search, AddToCart, InitiateCheckout,
-- AddPaymentInfo, CompleteRegistration, Contact) are already permitted.
ALTER TABLE marketing_events DROP CONSTRAINT marketing_events_event_name_check;
ALTER TABLE marketing_events ADD CONSTRAINT marketing_events_event_name_check
  CHECK (event_name IN (
    'PageView','ViewContent','Search','AddToCart','InitiateCheckout','AddPaymentInfo',
    'Purchase','CompleteRegistration','Lead','Contact',
    'PlaceAnOrder','CompletePayment','SubmitForm','Subscribe'
  ));

-- Optional TikTok browser click/context identifiers, captured only with
-- marketing consent at checkout (mirrors fbp/fbc for Meta). No new PII.
ALTER TABLE marketing_conversion_contexts ADD COLUMN IF NOT EXISTS ttp varchar(256) NULL;
ALTER TABLE marketing_conversion_contexts ADD COLUMN IF NOT EXISTS ttclid varchar(256) NULL;

INSERT INTO marketing_integrations (provider_key, display_name, configuration)
VALUES ('tiktok_pixel', 'CloudHost247 TikTok Pixel',
  '{"pixelId":null,"testMode":false,"testEventCode":null,"remarketingEnabled":false,"enabledEvents":["PageView","ViewContent","Search","AddToCart","InitiateCheckout","AddPaymentInfo","PlaceAnOrder","CompletePayment","SubmitForm","CompleteRegistration","Contact","Subscribe"],"eventsApi":{"enabled":false}}'::jsonb)
ON CONFLICT (provider_key) DO NOTHING;
