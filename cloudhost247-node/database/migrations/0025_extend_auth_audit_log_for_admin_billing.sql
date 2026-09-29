-- Migration: 0025_extend_auth_audit_log_for_admin_billing.sql
-- Purpose: Phase 5F "Staff & Admin Billing Management" — extend auth_audit_log event_type CHECK
-- constraint to record admin billing operations (staff-issued refunds and invoice cancellations)
-- into the same append-only auth_audit_log table, and widen orders.payment_status to varchar(20)
-- to comfortably accommodate 'partially_refunded' (18 characters).

ALTER TABLE orders ALTER COLUMN payment_status TYPE varchar(20);

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
    'admin_role_change',
    'payment_initiated',
    'manual_payment_confirmed',
    'manual_payment_rejected',
    'webhook_payment_succeeded',
    'webhook_payment_failed',
    'admin_invoice_refunded',
    'admin_invoice_cancelled'
  )
);

