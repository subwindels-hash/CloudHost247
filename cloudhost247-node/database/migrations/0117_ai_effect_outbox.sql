/**
 * Phase 2 gate item 2 — external-effect outbox for approval executions.
 *
 * A durable intent row is written in the SAME transaction as the approval decision, claimed
 * atomically with the non-expiring execution claim (0108), and closed with the observed outcome
 * in the same transaction that finalizes the approval. This gives stranding detection
 * (decided-but-never-started vs started-but-outcome-unknown) without ever auto-replaying an
 * effect: investigation and resolution remain manual and are not implemented here.
 *
 * Local schema only — not applied to staging or production.
 */
CREATE TABLE IF NOT EXISTS ai_effect_outbox (
  id uuid PRIMARY KEY,
  effect_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  approval_id uuid NOT NULL UNIQUE REFERENCES ai_approvals (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT ai_effect_outbox_status_check
    CHECK (status IN ('pending', 'dispatched', 'succeeded', 'failed', 'needs_review')),
  attempts integer NOT NULL DEFAULT 0,
  dispatched_at timestamptz,
  outcome_at timestamptz,
  outcome_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_effect_outbox_kind_check CHECK (kind IN ('approval_execution'))
);

CREATE INDEX IF NOT EXISTS ai_effect_outbox_status_idx ON ai_effect_outbox (status, created_at);
CREATE INDEX IF NOT EXISTS ai_effect_outbox_approval_idx ON ai_effect_outbox (approval_id);
