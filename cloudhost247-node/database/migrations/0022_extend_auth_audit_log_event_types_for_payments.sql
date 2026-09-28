-- Migration: 0022_extend_auth_audit_log_event_types_for_payments.sql
-- Purpose: Phase 5C adds three new auditable events (a customer initiating a payment attempt, and
-- staff confirming/rejecting a manual/offline payment) to the same append-only `auth_audit_log`
-- table already used for Phase 1/4 events, continuing the "one shared audit trail, not a new table
-- per phase" pattern established in 0002/0013. This is part of the auditable financial action chain
-- the Phase 5 spec calls for explicitly ("order created -> payment initiated -> webhook received ->
-- payment verified -> invoice marked paid") — `payment_initiated` covers the first payment-related
-- link in that chain now; `manual_payment_confirmed`/`manual_payment_rejected` cover the
-- manual-gateway's own resolution path (Phase 5D will add the webhook-driven equivalents when that
-- lands). As with 0013, the original named CHECK is dropped and an equivalent, wider one takes its
-- place — no existing rows are touched, only the allowed set of future values.

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
    'manual_payment_rejected'
  )
);
