-- Migration: 0086_create_whmcs_operations.sql
-- Purpose: the durable record of every state-changing WHMCS operation (order, payment, provisioning
-- action) this platform initiates, so that a retry can be recognised as a retry.
--
-- Why the table exists at all:
--   A timeout is not a failure. If WHMCS accepted `CreateOrder` and the reply was lost, retrying
--   blindly creates a second order, a second invoice and possibly a second charge. The only safe
--   sequence is: write the operation key first, send the request, then record the outcome — and on
--   any later attempt with the same key, look the operation up instead of re-sending.
--
-- Rules encoded here:
--   * `operation_key` is UNIQUE. It is derived by the caller from stable inputs (client, service,
--     cart fingerprint), never from a random id, so the same intent maps to the same row.
--   * `state` only moves pending -> succeeded/failed. A succeeded row is never rewritten by a later
--     duplicate attempt; the first confirmed answer is the answer.
--   * `response_json` stores the WHMCS payload needed for reconciliation. Credentials are never
--     stored: the request body (which carries the identifier and secret) is deliberately not kept.
--   * This table creates no invoices, orders or charges. It records what WHMCS already did.

CREATE TABLE IF NOT EXISTS whmcs_operations (
  id bigserial PRIMARY KEY,
  operation_key text NOT NULL,
  action text NOT NULL,
  request_id text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  whmcs_ref text,
  error_code text,
  attempts integer NOT NULL DEFAULT 1,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whmcs_operations_key_unique UNIQUE (operation_key),
  CONSTRAINT whmcs_operations_state_check CHECK (state IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT whmcs_operations_key_format CHECK (operation_key ~ '^[A-Za-z0-9:_.-]{8,200}$'),
  CONSTRAINT whmcs_operations_action_length CHECK (char_length(action) BETWEEN 1 AND 80),
  CONSTRAINT whmcs_operations_attempts_positive CHECK (attempts >= 1)
);

CREATE INDEX IF NOT EXISTS whmcs_operations_state_idx ON whmcs_operations (state, created_at DESC);
CREATE INDEX IF NOT EXISTS whmcs_operations_action_idx ON whmcs_operations (action, created_at DESC);

COMMENT ON TABLE whmcs_operations IS
  'Idempotency ledger for state-changing WHMCS API calls. A row is written before the request is sent; a repeated operation_key returns the recorded outcome instead of re-sending.';
COMMENT ON COLUMN whmcs_operations.response_json IS
  'WHMCS response payload kept for reconciliation. Never contains the request body or any credential.';
