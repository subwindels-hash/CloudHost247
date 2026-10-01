-- ============================================================================
-- Migration 0056: Extend Platform Services, Licenses, and Backup Jobs
-- ============================================================================

-- 1. Create licenses table for commercial and free control panel licensing
CREATE TABLE IF NOT EXISTS licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id uuid NULL,
  control_panel_id uuid NOT NULL REFERENCES control_panels(id) ON DELETE RESTRICT,
  license_key text NOT NULL,
  license_type varchar(64) NOT NULL DEFAULT 'STANDARD',
  provider varchar(64) NOT NULL DEFAULT 'INTERNAL',
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  activated_at timestamptz NULL,
  expires_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licenses_status_check CHECK (
    status IN ('ACTIVE', 'PENDING', 'EXPIRED', 'SUSPENDED', 'CANCELLED', 'TERMINATED')
  )
);

CREATE INDEX IF NOT EXISTS licenses_customer_idx ON licenses (customer_id, status);
CREATE INDEX IF NOT EXISTS licenses_panel_idx ON licenses (control_panel_id);
CREATE INDEX IF NOT EXISTS licenses_status_expiry_idx ON licenses (status, expires_at);

-- 2. Extend customer_services with complete server, panel, license and billing fields
ALTER TABLE customer_services
  ADD COLUMN IF NOT EXISTS customer_id uuid NULL REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS server_id uuid NULL REFERENCES servers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS control_panel_id uuid NULL REFERENCES control_panels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS license_id uuid NULL REFERENCES licenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS domain varchar(255) NULL,
  ADD COLUMN IF NOT EXISTS hostname varchar(255) NULL,
  ADD COLUMN IF NOT EXISTS username varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS billing_cycle varchar(32) NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS amount numeric(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS next_due_date timestamptz NULL,
  ADD COLUMN IF NOT EXISTS suspension_date timestamptz NULL,
  ADD COLUMN IF NOT EXISTS termination_date timestamptz NULL;

-- Backfill customer_id from user_id if null
UPDATE customer_services SET customer_id = user_id WHERE customer_id IS NULL;

-- Update status constraint on customer_services to support full lifecycle
ALTER TABLE customer_services DROP CONSTRAINT IF EXISTS customer_services_status_check;
ALTER TABLE customer_services ADD CONSTRAINT customer_services_status_check CHECK (
  status IN (
    'active', 'pending', 'provisioning', 'suspended', 'cancelled', 'terminated',
    'pending_migration', 'degraded', 'ACTIVE', 'PENDING', 'PROVISIONING',
    'SUSPENDED', 'CANCELLED', 'TERMINATED', 'DEGRADED'
  )
);

CREATE INDEX IF NOT EXISTS customer_services_server_idx ON customer_services (server_id);
CREATE INDEX IF NOT EXISTS customer_services_panel_idx ON customer_services (control_panel_id);
CREATE INDEX IF NOT EXISTS customer_services_due_date_idx ON customer_services (next_due_date) WHERE status = 'active' OR status = 'ACTIVE';

-- Add foreign key from licenses to customer_services now that customer_services is extended
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'licenses_service_fk'
  ) THEN
    ALTER TABLE licenses ADD CONSTRAINT licenses_service_fk
      FOREIGN KEY (service_id) REFERENCES customer_services(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Extend servers table with standard panel, networking, security and resource fields
ALTER TABLE servers
  ADD COLUMN IF NOT EXISTS ipv4 varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS ipv6 varchar(128) NULL,
  ADD COLUMN IF NOT EXISTS operating_system varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS operating_system_version varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS ram_mb integer NULL,
  ADD COLUMN IF NOT EXISTS disk_gb integer NULL,
  ADD COLUMN IF NOT EXISTS panel_status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS firewall_status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS dns_status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS ssl_status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS monitoring_status varchar(32) NOT NULL DEFAULT 'HEALTHY';

-- Sync ipv4 with ip_address where null
UPDATE servers SET ipv4 = ip_address WHERE ipv4 IS NULL AND ip_address IS NOT NULL;
UPDATE servers SET ram_mb = memory_mb WHERE ram_mb IS NULL AND memory_mb IS NOT NULL;
UPDATE servers SET disk_gb = CAST(storage_mb / 1024 AS integer) WHERE disk_gb IS NULL AND storage_mb IS NOT NULL;

-- 4. Create backup_jobs table
CREATE TABLE IF NOT EXISTS backup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NULL REFERENCES servers(id) ON DELETE CASCADE,
  service_id uuid NULL REFERENCES customer_services(id) ON DELETE SET NULL,
  installation_id uuid NULL REFERENCES application_installations(id) ON DELETE SET NULL,
  job_type varchar(32) NOT NULL DEFAULT 'SERVER_SNAPSHOT',
  status varchar(32) NOT NULL DEFAULT 'QUEUED',
  storage_provider varchar(32) NOT NULL DEFAULT 'local',
  storage_path text NULL,
  size_bytes bigint NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  error_message text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backup_jobs_type_check CHECK (
    job_type IN ('SERVER_SNAPSHOT', 'APP_BACKUP', 'DATABASE_BACKUP', 'FULL_SYSTEM')
  ),
  CONSTRAINT backup_jobs_status_check CHECK (
    status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT backup_jobs_provider_check CHECK (
    storage_provider IN ('local', 's3', 'r2', 'remote')
  )
);

CREATE INDEX IF NOT EXISTS backup_jobs_server_idx ON backup_jobs (server_id, created_at DESC);
CREATE INDEX IF NOT EXISTS backup_jobs_status_idx ON backup_jobs (status);
