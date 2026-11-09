-- Add a second provider without weakening the existing Meta-specific checks.
ALTER TABLE marketing_integrations DROP CONSTRAINT marketing_integrations_provider_check;
ALTER TABLE marketing_integrations DROP CONSTRAINT marketing_integrations_enabled_requires_id;
ALTER TABLE marketing_integrations DROP CONSTRAINT marketing_integrations_test_code_check;
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_provider_check CHECK (provider_key IN ('meta_pixel', 'google_analytics'));
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_enabled_requires_id CHECK (
  NOT enabled OR (website_domain <> '' AND CASE provider_key
    WHEN 'meta_pixel' THEN coalesce(configuration->>'pixelId', '') ~ '^[1-9][0-9]{4,31}$'
    WHEN 'google_analytics' THEN coalesce(configuration->>'measurementId', '') ~ '^G-[A-Z0-9]{10}$'
    ELSE false END)
);
ALTER TABLE marketing_integrations ADD CONSTRAINT marketing_integrations_test_code_check CHECK (
  provider_key <> 'meta_pixel' OR NOT coalesce((configuration->>'testMode')::boolean, false) OR coalesce(configuration->>'testEventCode', '') <> ''
);
INSERT INTO marketing_integrations (provider_key, display_name, configuration)
VALUES ('google_analytics', 'CloudHost247 Google Analytics', '{"displayName":"CloudHost247 Google Analytics","websiteDomain":"","enabled":false,"measurementId":null,"testMode":false}'::jsonb)
ON CONFLICT (provider_key) DO NOTHING;
