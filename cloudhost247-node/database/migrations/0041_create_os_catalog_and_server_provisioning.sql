-- Migration: 0041_create_os_catalog_and_server_provisioning.sql
-- Purpose: Production server ordering, operating-system catalog, provider image mappings and the
-- durable provisioning domain model. The existing deployments table remains the PostgreSQL-backed
-- queue (FOR UPDATE SKIP LOCKED + leases); provisioning_jobs adds the infrastructure-specific
-- state machine and observability record without introducing a second queue technology.
--
-- This migration is additive. Existing infrastructure inventory rows are preserved and assigned
-- the internal UNKNOWN OS version rather than an invented distribution/version.

CREATE TABLE IF NOT EXISTS infrastructure_providers (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL,
  slug varchar(120) NOT NULL,
  provider_type varchar(32) NOT NULL,
  adapter varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'CONFIGURATION_REQUIRED',
  api_base_url text NULL,
  credential_env_prefix varchar(64) NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_health_check_at timestamptz NULL,
  last_health_status varchar(32) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT infrastructure_providers_type_check CHECK (
    provider_type IN ('OVH', 'PROXMOX', 'VIRTUALIZOR', 'SOLUSVM', 'HETZNER', 'OPENSTACK', 'OTHER')
  ),
  CONSTRAINT infrastructure_providers_adapter_check CHECK (
    adapter IN ('ovh', 'proxmox', 'virtualizor', 'solusvm', 'hetzner', 'openstack', 'generic_http')
  ),
  CONSTRAINT infrastructure_providers_status_check CHECK (
    status IN ('ACTIVE', 'DISABLED', 'CONFIGURATION_REQUIRED', 'UNAVAILABLE')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS infrastructure_providers_slug_unique_idx
  ON infrastructure_providers (lower(slug));

CREATE TABLE IF NOT EXISTS infrastructure_regions (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES infrastructure_providers (id) ON DELETE CASCADE,
  code varchar(96) NOT NULL,
  name varchar(160) NOT NULL,
  country_code char(2) NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT infrastructure_regions_status_check CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS infrastructure_regions_provider_code_unique_idx
  ON infrastructure_regions (provider_id, lower(code));

CREATE TABLE IF NOT EXISTS infrastructure_datacenters (
  id uuid PRIMARY KEY,
  region_id uuid NOT NULL REFERENCES infrastructure_regions (id) ON DELETE CASCADE,
  code varchar(96) NOT NULL,
  name varchar(160) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT infrastructure_datacenters_status_check CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS infrastructure_datacenters_region_code_unique_idx
  ON infrastructure_datacenters (region_id, lower(code));

CREATE TABLE IF NOT EXISTS operating_systems (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL,
  slug varchar(120) NOT NULL,
  os_release_ids varchar(64)[] NOT NULL DEFAULT '{}'::varchar(64)[],
  vendor varchar(160) NULL,
  description text NULL,
  logo_url text NULL,
  status varchar(16) NOT NULL DEFAULT 'DISABLED',
  sort_order integer NOT NULL DEFAULT 0,
  is_vps_supported boolean NOT NULL DEFAULT false,
  is_dedicated_supported boolean NOT NULL DEFAULT false,
  is_cloud_supported boolean NOT NULL DEFAULT false,
  is_reinstall_supported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operating_systems_status_check CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS operating_systems_slug_unique_idx ON operating_systems (lower(slug));
CREATE UNIQUE INDEX IF NOT EXISTS operating_systems_name_unique_idx ON operating_systems (lower(name));
CREATE INDEX IF NOT EXISTS operating_systems_catalog_idx ON operating_systems (status, sort_order, name);

CREATE TABLE IF NOT EXISTS operating_system_versions (
  id uuid PRIMARY KEY,
  operating_system_id uuid NOT NULL REFERENCES operating_systems (id) ON DELETE RESTRICT,
  version varchar(64) NOT NULL,
  display_name varchar(200) NOT NULL,
  release_name varchar(160) NULL,
  architecture_support varchar(16)[] NOT NULL DEFAULT ARRAY['x86_64']::varchar(16)[],
  status varchar(24) NOT NULL DEFAULT 'DISABLED',
  is_default boolean NOT NULL DEFAULT false,
  is_recommended boolean NOT NULL DEFAULT false,
  is_lts boolean NOT NULL DEFAULT false,
  release_date date NULL,
  end_of_life_date date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operating_system_versions_status_check CHECK (
    status IN ('ACTIVE', 'MAINTENANCE', 'EOL_WARNING', 'EOL', 'ARCHIVED', 'DISABLED')
  ),
  CONSTRAINT operating_system_versions_arch_check CHECK (
    architecture_support <@ ARRAY['x86_64', 'arm64']::varchar(16)[] AND cardinality(architecture_support) > 0
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS operating_system_versions_os_version_unique_idx
  ON operating_system_versions (operating_system_id, lower(version));
CREATE UNIQUE INDEX IF NOT EXISTS operating_system_versions_one_default_idx
  ON operating_system_versions (operating_system_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS operating_system_versions_catalog_idx
  ON operating_system_versions (operating_system_id, status, is_recommended DESC, release_date DESC);

CREATE TABLE IF NOT EXISTS server_os_images (
  id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES infrastructure_providers (id) ON DELETE RESTRICT,
  operating_system_version_id uuid NOT NULL REFERENCES operating_system_versions (id) ON DELETE RESTRICT,
  provider_image_id varchar(512) NULL,
  provider_template_id varchar(512) NULL,
  architecture varchar(16) NOT NULL,
  region_id uuid NULL REFERENCES infrastructure_regions (id) ON DELETE RESTRICT,
  datacenter_id uuid NULL REFERENCES infrastructure_datacenters (id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'DRAFT',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz NULL,
  verified_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  verification_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT server_os_images_identifier_check CHECK (
    provider_image_id IS NOT NULL OR provider_template_id IS NOT NULL
  ),
  CONSTRAINT server_os_images_arch_check CHECK (architecture IN ('x86_64', 'arm64')),
  CONSTRAINT server_os_images_status_check CHECK (
    status IN ('DRAFT', 'VALIDATING', 'ACTIVE', 'DISABLED', 'INVALID')
  ),
  CONSTRAINT server_os_images_active_verified_check CHECK (status <> 'ACTIVE' OR verified_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS server_os_images_mapping_unique_idx ON server_os_images (
  provider_id,
  operating_system_version_id,
  architecture,
  COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(datacenter_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX IF NOT EXISTS server_os_images_resolution_idx
  ON server_os_images (provider_id, operating_system_version_id, architecture, region_id, status);

-- Every active row is one exact, server-authoritative purchasable combination. This avoids a
-- combinatorial set of loosely-related allowlists that can accidentally admit an invalid tuple.
CREATE TABLE IF NOT EXISTS server_product_configurations (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES product_plans (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES infrastructure_providers (id) ON DELETE RESTRICT,
  region_id uuid NOT NULL REFERENCES infrastructure_regions (id) ON DELETE RESTRICT,
  datacenter_id uuid NULL REFERENCES infrastructure_datacenters (id) ON DELETE RESTRICT,
  operating_system_version_id uuid NOT NULL REFERENCES operating_system_versions (id) ON DELETE RESTRICT,
  architecture varchar(16) NOT NULL,
  server_type varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'DISABLED',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT server_product_configurations_arch_check CHECK (architecture IN ('x86_64', 'arm64')),
  CONSTRAINT server_product_configurations_type_check CHECK (server_type IN ('VPS', 'DEDICATED', 'CLOUD')),
  CONSTRAINT server_product_configurations_status_check CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS server_product_configurations_tuple_unique_idx
  ON server_product_configurations (
    plan_id, provider_id, region_id,
    COALESCE(datacenter_id, '00000000-0000-0000-0000-000000000000'::uuid),
    operating_system_version_id, architecture, server_type
  );
CREATE INDEX IF NOT EXISTS server_product_configurations_lookup_idx
  ON server_product_configurations (plan_id, region_id, server_type, status);

CREATE TABLE IF NOT EXISTS control_panels (
  id uuid PRIMARY KEY,
  name varchar(120) NOT NULL,
  slug varchar(96) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'DISABLED',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_panels_status_check CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS control_panels_slug_unique_idx ON control_panels (lower(slug));

CREATE TABLE IF NOT EXISTS control_panel_compatibility (
  id uuid PRIMARY KEY,
  control_panel_id uuid NOT NULL REFERENCES control_panels (id) ON DELETE CASCADE,
  operating_system_version_id uuid NOT NULL REFERENCES operating_system_versions (id) ON DELETE CASCADE,
  plan_id uuid NULL REFERENCES product_plans (id) ON DELETE CASCADE,
  architecture varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'DISABLED',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT control_panel_compatibility_arch_check CHECK (architecture IN ('x86_64', 'arm64')),
  CONSTRAINT control_panel_compatibility_status_check CHECK (status IN ('ACTIVE', 'DISABLED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS control_panel_compatibility_unique_idx
  ON control_panel_compatibility (
    control_panel_id, operating_system_version_id,
    COALESCE(plan_id, '00000000-0000-0000-0000-000000000000'::uuid), architecture
  );

CREATE TABLE IF NOT EXISTS customer_ssh_keys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  fingerprint varchar(160) NOT NULL,
  public_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_ssh_keys_user_fingerprint_unique_idx
  ON customer_ssh_keys (user_id, fingerprint);

-- Extend, rather than replace, the existing Phase 6 server inventory. Rows with customer_id NULL
-- remain platform deployment targets; rows with a customer are provisioned customer resources.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS customer_id uuid NULL REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS order_id uuid NULL REFERENCES orders (id) ON DELETE SET NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS plan_id uuid NULL REFERENCES product_plans (id) ON DELETE SET NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS provider_id uuid NULL REFERENCES infrastructure_providers (id) ON DELETE RESTRICT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS region_id uuid NULL REFERENCES infrastructure_regions (id) ON DELETE RESTRICT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS datacenter_id uuid NULL REFERENCES infrastructure_datacenters (id) ON DELETE RESTRICT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS operating_system_version_id uuid NULL REFERENCES operating_system_versions (id) ON DELETE RESTRICT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS os_image_id uuid NULL REFERENCES server_os_images (id) ON DELETE RESTRICT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS architecture varchar(16) NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS provider_server_id varchar(255) NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS provisioning_status varchar(32) NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS renewal_date date NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS bandwidth_gb integer NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS control_panel_id uuid NULL REFERENCES control_panels (id) ON DELETE SET NULL;

ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_server_type_check;
ALTER TABLE servers ADD CONSTRAINT servers_server_type_check CHECK (
  server_type IN ('VPS', 'DEDICATED', 'CLOUD', 'CPANEL', 'KUBERNETES', 'SHARED')
);
ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_status_check;
ALTER TABLE servers ADD CONSTRAINT servers_status_check CHECK (
  status IN (
    'awaiting_payment', 'queued', 'provisioning', 'installing', 'configuring', 'health_check',
    'active', 'stopped', 'maintenance', 'offline', 'error', 'deleting', 'retired'
  )
);
ALTER TABLE servers ADD CONSTRAINT servers_architecture_check CHECK (
  architecture IS NULL OR architecture IN ('x86_64', 'arm64')
);
ALTER TABLE servers ADD CONSTRAINT servers_provisioning_status_check CHECK (
  provisioning_status IS NULL OR provisioning_status IN (
    'AWAITING_PAYMENT', 'QUEUED', 'ALLOCATING', 'CREATING', 'INSTALLING_OS', 'CONFIGURING',
    'NETWORK_CONFIGURING', 'SECURITY_CONFIGURING', 'HEALTH_CHECK', 'READY', 'FAILED', 'CANCELLED'
  )
);
CREATE INDEX IF NOT EXISTS servers_customer_idx ON servers (customer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS servers_provider_resource_unique_idx
  ON servers (provider_id, provider_server_id) WHERE provider_id IS NOT NULL AND provider_server_id IS NOT NULL;

-- New deployment actions use the proven deployments queue rather than a synchronous request or
-- a second queue. Existing application/cPanel deployment actions are retained unchanged.
ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_action_check;
ALTER TABLE deployments ADD CONSTRAINT deployments_action_check CHECK (
  action IN (
    'install', 'start', 'stop', 'restart', 'update', 'backup', 'restore', 'reinstall',
    'uninstall', 'ssl_provision', 'domain_configure', 'provision', 'suspend', 'terminate',
    'healthcheck', 'server_provision', 'server_reinstall', 'server_start', 'server_stop',
    'server_reboot', 'server_shutdown', 'server_rescue', 'server_delete'
  )
);

CREATE TABLE IF NOT EXISTS provisioning_jobs (
  id uuid PRIMARY KEY,
  deployment_id uuid NOT NULL REFERENCES deployments (id) ON DELETE RESTRICT,
  server_id uuid NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  order_id uuid NULL REFERENCES orders (id) ON DELETE SET NULL,
  provider_id uuid NOT NULL REFERENCES infrastructure_providers (id) ON DELETE RESTRICT,
  os_image_id uuid NULL REFERENCES server_os_images (id) ON DELETE RESTRICT,
  operation varchar(24) NOT NULL DEFAULT 'PROVISION',
  status varchar(32) NOT NULL DEFAULT 'QUEUED',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  idempotency_key varchar(160) NOT NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  failed_at timestamptz NULL,
  error_code varchar(64) NULL,
  error_message text NULL,
  retryable boolean NULL,
  provider_server_id varchar(255) NULL,
  provider_response jsonb NULL,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provisioning_jobs_operation_check CHECK (
    operation IN ('PROVISION', 'REINSTALL', 'START', 'STOP', 'REBOOT', 'SHUTDOWN', 'RESCUE', 'DELETE')
  ),
  CONSTRAINT provisioning_jobs_status_check CHECK (
    status IN (
      'QUEUED', 'ALLOCATING', 'CREATING', 'INSTALLING_OS', 'CONFIGURING',
      'NETWORK_CONFIGURING', 'SECURITY_CONFIGURING', 'HEALTH_CHECK', 'READY', 'FAILED', 'CANCELLED'
    )
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS provisioning_jobs_deployment_unique_idx ON provisioning_jobs (deployment_id);
CREATE UNIQUE INDEX IF NOT EXISTS provisioning_jobs_idempotency_unique_idx ON provisioning_jobs (idempotency_key);
CREATE INDEX IF NOT EXISTS provisioning_jobs_server_idx ON provisioning_jobs (server_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provisioning_jobs_status_idx ON provisioning_jobs (status, created_at);

CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type varchar(64) NOT NULL,
  title varchar(255) NOT NULL,
  message text NOT NULL,
  resource_type varchar(64) NULL,
  resource_id uuid NULL,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_notifications_user_idx ON user_notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_resource_type_unique_idx
  ON user_notifications (user_id,type,resource_type,resource_id) WHERE resource_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES user_notifications (id) ON DELETE CASCADE,
  channel varchar(24) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  delivered_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_channel_check CHECK (channel IN ('EMAIL', 'WEBHOOK')),
  CONSTRAINT notification_outbox_status_check CHECK (
    status IN ('PENDING', 'DELIVERED', 'FAILED', 'CONFIGURATION_REQUIRED')
  )
);

-- Canonical catalog. These rows describe OS families and versions only; no provider image is
-- seeded or marked deployable. Versions start DISABLED and must pass provider image validation.
INSERT INTO operating_systems (
  id, name, slug, os_release_ids, vendor, description, logo_url, status, sort_order,
  is_vps_supported, is_dedicated_supported, is_cloud_supported, is_reinstall_supported
) VALUES
  ('10000000-0000-0000-0000-000000000001', 'AlmaLinux', 'almalinux', ARRAY['almalinux']::varchar(64)[], 'AlmaLinux OS Foundation', 'Enterprise Linux compatible community distribution.', '/os-logos/almalinux.svg', 'ACTIVE', 10, true, true, true, true),
  ('10000000-0000-0000-0000-000000000002', 'Debian', 'debian', ARRAY['debian']::varchar(64)[], 'Debian Project', 'Stable, community-developed Linux distribution.', '/os-logos/debian.svg', 'ACTIVE', 20, true, true, true, true),
  ('10000000-0000-0000-0000-000000000003', 'Rocky Linux', 'rocky-linux', ARRAY['rocky']::varchar(64)[], 'Rocky Enterprise Software Foundation', 'Enterprise Linux compatible community distribution.', '/os-logos/rocky.svg', 'ACTIVE', 30, true, true, true, true),
  ('10000000-0000-0000-0000-000000000004', 'Ubuntu', 'ubuntu', ARRAY['ubuntu']::varchar(64)[], 'Canonical', 'General-purpose Linux distribution with long-term support releases.', '/os-logos/ubuntu.svg', 'ACTIVE', 40, true, true, true, true),
  ('10000000-0000-0000-0000-000000000005', 'Alpine Linux', 'alpine-linux', ARRAY['alpine']::varchar(64)[], 'Alpine Linux', 'Security-oriented, lightweight Linux distribution.', NULL, 'ACTIVE', 50, true, false, true, true),
  ('10000000-0000-0000-0000-000000000006', 'Arch Linux', 'arch-linux', ARRAY['arch']::varchar(64)[], 'Arch Linux', 'Rolling-release Linux distribution.', NULL, 'ACTIVE', 60, true, false, true, true),
  ('10000000-0000-0000-0000-000000000007', 'CentOS', 'centos', ARRAY['centos']::varchar(64)[], 'CentOS Project', 'CentOS family distribution; versions are lifecycle-managed independently.', '/os-logos/centos.svg', 'DISABLED', 70, true, true, true, true),
  ('10000000-0000-0000-0000-000000000008', 'CloudLinux', 'cloudlinux', ARRAY['cloudlinux']::varchar(64)[], 'CloudLinux Inc.', 'Commercial Linux distribution for hosting environments.', '/os-logos/cloudlinux.svg', 'ACTIVE', 80, true, true, true, true),
  ('10000000-0000-0000-0000-000000000009', 'Fedora Cloud', 'fedora-cloud', ARRAY['fedora']::varchar(64)[], 'Fedora Project', 'Fedora cloud images for current cloud-native workloads.', '/os-logos/fedora.svg', 'ACTIVE', 90, true, false, true, true),
  ('10000000-0000-0000-0000-000000000010', 'Kali Linux', 'kali-linux', ARRAY['kali']::varchar(64)[], 'Offensive Security', 'Security testing distribution for authorized use.', NULL, 'ACTIVE', 100, true, false, true, true),
  ('10000000-0000-0000-0000-000000000011', 'NixOS', 'nixos', ARRAY['nixos']::varchar(64)[], 'NixOS Foundation', 'Declarative Linux distribution based on the Nix package manager.', NULL, 'ACTIVE', 110, true, false, true, true),
  ('10000000-0000-0000-0000-000000000012', 'openSUSE', 'opensuse', ARRAY['opensuse-leap','opensuse-tumbleweed','opensuse']::varchar(64)[], 'openSUSE Project', 'Community Linux distribution from the openSUSE project.', NULL, 'ACTIVE', 120, true, true, true, true),
  ('10000000-0000-0000-0000-000000000099', 'Unknown', 'unknown', ARRAY[]::varchar(64)[], NULL, 'Internal placeholder for existing servers whose operating system cannot be determined safely.', NULL, 'ARCHIVED', 9999, false, false, false, false)
ON CONFLICT DO NOTHING;

INSERT INTO operating_system_versions (
  id, operating_system_id, version, display_name, architecture_support, status, is_default, is_recommended, is_lts
) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '10', 'AlmaLinux 10', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '9', 'AlmaLinux 9', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '13', 'Debian 13', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '12', 'Debian 12', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003', '9', 'Rocky Linux 9', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000004', '24.04', 'Ubuntu 24.04 LTS', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, true),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000004', '22.04', 'Ubuntu 22.04 LTS', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, true),
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000003', '10', 'Rocky Linux 10', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000005', '3.22', 'Alpine Linux 3.22', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000006', 'rolling', 'Arch Linux (rolling)', ARRAY['x86_64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000007', 'stream-10', 'CentOS Stream 10', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000008', '9', 'CloudLinux 9', ARRAY['x86_64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000009', '42', 'Fedora Cloud 42', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000010', 'rolling', 'Kali Linux (rolling)', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000011', '25.05', 'NixOS 25.05', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000012', '15.6', 'openSUSE Leap 15.6', ARRAY['x86_64','arm64']::varchar(16)[], 'DISABLED', false, false, false),
  ('20000000-0000-0000-0000-000000000099', '10000000-0000-0000-0000-000000000099', 'UNKNOWN', 'Unknown operating system', ARRAY['x86_64']::varchar(16)[], 'ARCHIVED', false, false, false)
ON CONFLICT DO NOTHING;

-- Existing server rows are not guessed from their names/provider. Unknown remains visible on the
-- existing server detail while being unavailable for new orders.
UPDATE servers
SET operating_system_version_id = '20000000-0000-0000-0000-000000000099'
WHERE operating_system_version_id IS NULL;

INSERT INTO control_panels (id, name, slug, status) VALUES
  ('30000000-0000-0000-0000-000000000001', 'cPanel', 'cpanel', 'DISABLED'),
  ('30000000-0000-0000-0000-000000000002', 'Plesk', 'plesk', 'DISABLED'),
  ('30000000-0000-0000-0000-000000000003', 'DirectAdmin', 'directadmin', 'DISABLED'),
  ('30000000-0000-0000-0000-000000000004', 'CyberPanel', 'cyberpanel', 'DISABLED'),
  ('30000000-0000-0000-0000-000000000005', 'Webmin', 'webmin', 'DISABLED')
ON CONFLICT DO NOTHING;
