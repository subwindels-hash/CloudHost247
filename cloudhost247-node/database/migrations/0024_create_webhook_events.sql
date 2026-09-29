-- Migration: 0024_create_webhook_events.sql
-- Purpose: Phase 5D durable webhook event ledger for idempotency, processing leases, and replay protection.
--
-- Records external webhook deliveries per gateway and event_id with an atomic lease mechanism
-- to handle crashes, concurrent bursts, and retries safely.
--
-- Purely additive: creates new webhook_events table, indexes, and extends auth_audit_log event types.
--
-- NOTE: Tested in isolated test environments only. NOT AUTHORIZED FOR PRODUCTION EXECUTION.

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway VARCHAR(32) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  transmission_id VARCHAR(255),
  event_type VARCHAR(64) NOT NULL,
  provider_reference VARCHAR(255),
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed', 'rejected', 'ignored')),
  payload_hash VARCHAR(64) NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  processing_node_id VARCHAR(64),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  CONSTRAINT webhook_events_gateway_event_id_unique UNIQUE (gateway, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_lookup
  ON webhook_events (gateway, event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_payment
  ON webhook_events (payment_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_lease
  ON webhook_events (status, lease_expires_at)
  WHERE status = 'processing';

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
    'webhook_payment_failed'
  )
);
