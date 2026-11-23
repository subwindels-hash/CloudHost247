-- Migration: 0127_extend_deployment_actions.sql
-- Purpose: Add WordPress hosting deployment actions (A02 — hosting product ecosystem).
--
-- Design notes:
--   * Adds 'clone', 'stage', 'migrate' actions to the deployments action CHECK constraint so
--     WordPress clone/stage/migrate jobs can be enqueued.
--   * These actions are accepted and queued but not yet executed — no WP-CLI bridge is
--     configured. Honest about the absence rather than fabricating clone/stage/migrate success.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

ALTER TABLE deployments
  DROP CONSTRAINT deployments_action_check,
  ADD CONSTRAINT deployments_action_check CHECK (
    action IN (
      'install', 'start', 'stop', 'restart', 'update', 'backup', 'restore', 'reinstall',
      'uninstall', 'clone', 'stage', 'migrate',
      'ssl_provision', 'domain_configure', 'provision', 'suspend', 'terminate',
      'healthcheck'
    )
  );
