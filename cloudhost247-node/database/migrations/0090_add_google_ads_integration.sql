-- Google Ads is another provider in the canonical marketing configuration store. It uses
-- the shared consent manager and event source; no Google account credentials are stored here.
ALTER TABLE marketing_integrations DROP CONSTRAINT IF EXISTS marketing_integrations_provider_check;
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_provider_check CHECK (provider_key IN ('meta_pixel','google_ads'));
ALTER TABLE marketing_integrations DROP CONSTRAINT IF EXISTS marketing_integrations_enabled_requires_id;
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_enabled_requires_id CHECK (
  NOT enabled OR website_domain <> '' AND (
    (provider_key='meta_pixel' AND configuration->>'pixelId' ~ '^[1-9][0-9]{4,31}$') OR
    (provider_key='google_ads' AND configuration->>'customerId' ~ '^[0-9]{10}$' AND configuration->>'conversionId' ~ '^[0-9]{5,20}$')
  )
);
INSERT INTO marketing_integrations(provider_key,display_name,configuration)
VALUES ('google_ads','CloudHost247 Google Ads',
'{"displayName":"CloudHost247 Google Ads","websiteDomain":"","enabled":false,"customerId":"","conversionId":"","defaultCurrency":"","remarketingEnabled":false,"enhancedConversionsEnabled":false,"actions":{"purchase":{"label":"","primary":true},"lead":{"label":"","primary":false},"sign_up":{"label":"","primary":false},"contact":{"label":"","primary":false},"begin_checkout":{"label":"","primary":false},"add_to_cart":{"label":"","primary":false},"subscription":{"label":"","primary":false},"renewal":{"label":"","primary":false},"upgrade":{"label":"","primary":false}},"consentPolicy":"shared_marketing_preferences"}'::jsonb)
ON CONFLICT(provider_key) DO NOTHING;
