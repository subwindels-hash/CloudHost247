-- Migration: 0042_expand_infrastructure_providers_and_server_operations.sql
-- Purpose: Phase 2 — Core Infrastructure Abstraction.
-- Expands infrastructure provider types, adapter kinds, deployment actions, and provisioning
-- operations to support AWS, DigitalOcean, Vultr, Contabo, OVHcloud, snapshots, and server resize.

ALTER TABLE infrastructure_providers DROP CONSTRAINT IF EXISTS infrastructure_providers_type_check;
ALTER TABLE infrastructure_providers ADD CONSTRAINT infrastructure_providers_type_check CHECK (
  provider_type IN (
    'OVH', 'HETZNER', 'AWS', 'DIGITALOCEAN', 'VULTR', 'CONTABO',
    'PROXMOX', 'VIRTUALIZOR', 'SOLUSVM', 'OPENSTACK', 'GENERIC_HTTP', 'OTHER'
  )
);

ALTER TABLE infrastructure_providers DROP CONSTRAINT IF EXISTS infrastructure_providers_adapter_check;
ALTER TABLE infrastructure_providers ADD CONSTRAINT infrastructure_providers_adapter_check CHECK (
  adapter IN (
    'hetzner', 'ovh', 'aws', 'digitalocean', 'vultr', 'contabo',
    'proxmox', 'virtualizor', 'solusvm', 'openstack', 'generic_http'
  )
);

ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_action_check;
ALTER TABLE deployments ADD CONSTRAINT deployments_action_check CHECK (
  action IN (
    'install', 'start', 'stop', 'restart', 'update', 'backup', 'restore', 'reinstall',
    'uninstall', 'ssl_provision', 'domain_configure', 'provision', 'suspend', 'terminate',
    'healthcheck', 'server_provision', 'server_reinstall', 'server_start', 'server_stop',
    'server_reboot', 'server_shutdown', 'server_rescue', 'server_delete',
    'server_resize', 'server_snapshot_create', 'server_snapshot_restore', 'server_snapshot_delete'
  )
);

ALTER TABLE provisioning_jobs DROP CONSTRAINT IF EXISTS provisioning_jobs_operation_check;
ALTER TABLE provisioning_jobs ADD CONSTRAINT provisioning_jobs_operation_check CHECK (
  operation IN (
    'PROVISION', 'REINSTALL', 'START', 'STOP', 'REBOOT', 'SHUTDOWN', 'RESCUE', 'DELETE',
    'RESIZE', 'SNAPSHOT_CREATE', 'SNAPSHOT_RESTORE', 'SNAPSHOT_DELETE'
  )
);
