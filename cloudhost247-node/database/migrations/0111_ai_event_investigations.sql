-- A record of operator attention only. It does not release, retry, cancel or settle an event.
-- No free text, event payload, claim token or provider result is stored here.
CREATE TABLE ai_event_investigations (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES ai_events(id) ON DELETE RESTRICT,
  claim_observed_at timestamptz NOT NULL,
  opened_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_event_investigations_claim_unique UNIQUE (event_id, claim_observed_at)
);
CREATE INDEX ai_event_investigations_opened_idx ON ai_event_investigations (opened_at DESC);
