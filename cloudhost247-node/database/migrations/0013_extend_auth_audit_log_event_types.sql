-- Migration: 0013_extend_auth_audit_log_event_types.sql
-- Purpose: Phase 4 adds a handful of new auditable events (profile edits, password changes, and
-- super_admin-only account status/role changes) to the same append-only auth_audit_log table
-- introduced in 0002_create_auth_audit_log.sql, rather than creating a parallel log table. The
-- original CHECK constraint only allowed the Phase 1 event types, so it must be widened here to
-- accept the new ones without weakening it to accept arbitrary strings.
--
-- Postgres has no "ALTER CONSTRAINT" — the original named CHECK is dropped and an equivalent,
-- wider one is added in its place. This never touches existing rows/data, only the allowed set of
-- future values.

ALTER TABLE auth_audit_log DROP CONSTRAINT IF EXISTS auth_audit_log_event_type_check;

ALTER TABLE auth_audit_log ADD CONSTRAINT auth_audit_log_event_type_check CHECK (
  event_type IN (
    'register',
    'login_success',
    'login_failure',
    'logout',
    'token_refresh',
    'profile_update',
    'password_change',
    'admin_status_change',
    'admin_role_change'
  )
);
