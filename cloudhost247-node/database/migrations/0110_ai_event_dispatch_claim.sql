-- Dispatch ownership is deliberately non-expiring. A worker crash leaves an event for
-- investigation, never for automatic replay of possibly dispatched side effects.
ALTER TABLE ai_events ADD COLUMN dispatch_claim_token uuid NULL;
ALTER TABLE ai_events ADD COLUMN dispatch_claimed_at timestamptz NULL;
ALTER TABLE ai_events ADD CONSTRAINT ai_events_dispatch_claim_pair_check
  CHECK ((dispatch_claim_token IS NULL) = (dispatch_claimed_at IS NULL));

-- Old unprocessed events with workflow runs may have already caused effects under the previous
-- dispatcher. Quarantine them instead of silently replaying them after rollout. Deployment must
-- stop old workers before this migration; old binaries do not honor these claims.
UPDATE ai_events e
SET dispatch_claim_token = gen_random_uuid(),
    dispatch_claimed_at = COALESCE((SELECT min(wr.started_at) FROM ai_workflow_runs wr WHERE wr.event_id = e.id), now())
WHERE e.processed_at IS NULL AND EXISTS (SELECT 1 FROM ai_workflow_runs wr WHERE wr.event_id = e.id);

CREATE INDEX ai_events_dispatch_available_idx ON ai_events (occurred_at, id)
  WHERE processed_at IS NULL AND dispatch_claim_token IS NULL;
