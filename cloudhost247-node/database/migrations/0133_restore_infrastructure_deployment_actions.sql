-- Migration: 0133_restore_infrastructure_deployment_actions.sql
-- Purpose: Preserve infrastructure provisioning and server-operation actions alongside the
--          marketplace actions added in 0127.
--
-- Migration 0127 replaced deployments_action_check with a marketplace-only allowlist, silently
-- dropping every server provisioning, server lifecycle, resize, and snapshot action added in 0041
-- and 0042. That left the TypeScript DeploymentAction union and the database constraint out of
-- sync, so paid server orders and server-operation requests failed when they tried to enqueue.
-- Keep this constraint aligned with src/db/deployments.ts.
-- This is a forward-only schema repair; no existing rows are changed.

ALTER TABLE deployments
  DROP CONSTRAINT IF EXISTS deployments_action_check,
  ADD CONSTRAINT deployments_action_check CHECK (
    action IN (
      'install', 'start', 'stop', 'restart', 'update', 'backup', 'restore', 'reinstall',
      'uninstall', 'clone', 'stage', 'migrate',
      'ssl_provision', 'domain_configure', 'provision', 'suspend', 'terminate',
      'healthcheck',
      'server_provision', 'server_reinstall', 'server_start', 'server_stop',
      'server_reboot', 'server_shutdown', 'server_rescue', 'server_delete',
      'server_resize', 'server_snapshot_create', 'server_snapshot_restore', 'server_snapshot_delete'
    )
  );
