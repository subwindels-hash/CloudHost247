-- Add GA4 after the existing Meta, Ads, and TikTok providers without weakening their checks.
ALTER TABLE marketing_integrations DROP CONSTRAINT marketing_integrations_provider_check;
ALTER TABLE marketing_integrations DROP CONSTRAINT marketing_integrations_enabled_requires_id;
ALTER TABLE marketing_integrations DROP CONSTRAINT marketing_integrations_test_code_check;
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_provider_check CHECK (provider_key IN ('meta_pixel', 'google_ads', 'tiktok_pixel', 'google_analytics'));
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_enabled_requires_id CHECK (
  NOT enabled OR (website_domain <> '' AND CASE provider_key
    WHEN 'meta_pixel' THEN coalesce(configuration->>'pixelId', '') ~ '^[1-9][0-9]{4,31}$'
    WHEN 'google_ads' THEN coalesce(configuration->>'customerId', '') ~ '^[0-9]{10}$' AND coalesce(configuration->>'conversionId', '') ~ '^[0-9]{5,20}$'
    WHEN 'tiktok_pixel' THEN coalesce(configuration->>'pixelId', '') ~ '^[A-Za-z0-9]{16,32}$'
    WHEN 'google_analytics' THEN coalesce(configuration->>'measurementId', '') ~ '^G-[A-Z0-9]{10}$'
    ELSE false END)
);
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_test_code_check CHECK (
  provider_key = 'google_analytics' OR NOT coalesce((configuration->>'testMode')::boolean, false) OR coalesce(configuration->>'testEventCode', '') <> ''
);
INSERT INTO marketing_integrations (provider_key, display_name, configuration)
VALUES ('google_analytics', 'CloudHost247 Google Analytics', '{"displayName":"CloudHost247 Google Analytics","websiteDomain":"","enabled":false,"measurementId":null,"testMode":false}'::jsonb)
ON CONFLICT (provider_key) DO NOTHING;
