-- Migration: 0047_infrastructure_adapter_coverage.sql
-- Purpose: Complete the provider adapter coverage introduced with the OS catalog.
--
--  1. Allow the development-only `mock` adapter to be registered explicitly by an operator.
--     It is refused at runtime when NODE_ENV=production or when ALLOW_MOCK_PROVIDER is not
--     'true' (src/infrastructure/providers/mock-adapter.ts), so this is an additive constraint
--     change only — no provider is created, enabled, or selected by this migration.
--  2. Add the indexes the provisioning observability panel needs (failure-code breakdown and
--     per-provider duration/success reporting) so the admin dashboard does not sequentially
--     scan provisioning_jobs as the table grows.
--
-- Additive and idempotent. No customer server, billing, or catalog data is modified.

ALTER TABLE infrastructure_providers DROP CONSTRAINT IF EXISTS infrastructure_providers_type_check;
ALTER TABLE infrastructure_providers ADD CONSTRAINT infrastructure_providers_type_check CHECK (
  provider_type IN (
    'OVH', 'HETZNER', 'AWS', 'DIGITALOCEAN', 'VULTR', 'CONTABO',
    'PROXMOX', 'VIRTUALIZOR', 'SOLUSVM', 'OPENSTACK', 'GENERIC_HTTP', 'MOCK', 'OTHER'
  )
);

ALTER TABLE infrastructure_providers DROP CONSTRAINT IF EXISTS infrastructure_providers_adapter_check;
ALTER TABLE infrastructure_providers ADD CONSTRAINT infrastructure_providers_adapter_check CHECK (
  adapter IN (
    'hetzner', 'ovh', 'aws', 'digitalocean', 'vultr', 'contabo',
    'proxmox', 'virtualizor', 'solusvm', 'openstack', 'generic_http', 'mock'
  )
);

-- A MOCK provider may never be marked ACTIVE alongside a real provider type by accident: the
-- adapter column and the provider_type column must agree on the mock kind.
ALTER TABLE infrastructure_providers DROP CONSTRAINT IF EXISTS infrastructure_providers_mock_pairing_check;
ALTER TABLE infrastructure_providers ADD CONSTRAINT infrastructure_providers_mock_pairing_check CHECK (
  (adapter = 'mock') = (provider_type = 'MOCK')
);

CREATE INDEX IF NOT EXISTS provisioning_jobs_error_code_idx
  ON provisioning_jobs (error_code, created_at DESC) WHERE error_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS provisioning_jobs_provider_idx
  ON provisioning_jobs (provider_id, status, created_at DESC);
