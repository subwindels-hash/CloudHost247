-- Migration: 0032_create_application_installations.sql
-- Purpose: Phase 6 — a customer's installed instance of a catalog application (spec §11).
--
-- One row per "customer X runs app Y on server Z" (customers may install the same app multiple
-- times). The installation record is the customer-facing aggregate: current status, domain,
-- ports, latest deployment, enforced resource limits (spec §50), and health/circuit-breaker
-- state for automatic recovery (spec §53).
--
-- Lifecycle: pending → queued → deploying → starting → healthy / unhealthy → stopped → …
-- deleting → deleted (soft delete via deleted_at; billing/audit history must survive).
-- `order_id` links back to the paid order that authorized provisioning (spec §20): the API
-- refuses to enqueue INSTALL until that order is PAID.

CREATE TABLE IF NOT EXISTS application_installations (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications (id) ON DELETE RESTRICT,
  application_version_id uuid NOT NULL REFERENCES application_versions (id) ON DELETE RESTRICT,
  server_id uuid NULL REFERENCES servers (id) ON DELETE SET NULL,
  subscription_id uuid NULL,
  order_id uuid NULL REFERENCES orders (id) ON DELETE SET NULL,
  name varchar(160) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  domain varchar(255) NULL,
  internal_port integer NULL,
  external_port integer NULL,
  deployment_id uuid NULL,
  container_project varchar(120) NULL,
  cpu_limit integer NULL CHECK (cpu_limit IS NULL OR cpu_limit > 0),
  memory_limit_mb integer NULL CHECK (memory_limit_mb IS NULL OR memory_limit_mb > 0),
  storage_limit_mb integer NULL CHECK (storage_limit_mb IS NULL OR storage_limit_mb > 0),
  health_status varchar(16) NOT NULL DEFAULT 'unknown',
  last_health_check_at timestamptz NULL,
  restart_count integer NOT NULL DEFAULT 0,
  circuit_open_until timestamptz NULL,
  last_backup_at timestamptz NULL,
  backup_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT application_installations_status_check CHECK (
    status IN (
      'pending', 'queued', 'deploying', 'starting', 'healthy', 'unhealthy',
      'stopped', 'updating', 'failed', 'deleting', 'deleted'
    )
  ),
  CONSTRAINT application_installations_health_check CHECK (health_status IN ('healthy', 'unhealthy', 'unknown'))
);

-- container_project is the Docker Compose project name (customer-<userIdShort>-<installShort>,
-- generated server-side) and must be globally unique: it namespaces labels, networks, volumes,
-- and the /opt/cloudhost247/apps/<project>/ directory on the target server (spec §32).
CREATE UNIQUE INDEX IF NOT EXISTS application_installations_container_project_unique_idx
  ON application_installations (container_project) WHERE container_project IS NOT NULL;
CREATE INDEX IF NOT EXISTS application_installations_customer_idx ON application_installations (customer_id);
CREATE INDEX IF NOT EXISTS application_installations_application_idx ON application_installations (application_id);
CREATE INDEX IF NOT EXISTS application_installations_server_idx ON application_installations (server_id);
CREATE INDEX IF NOT EXISTS application_installations_status_idx ON application_installations (status);
