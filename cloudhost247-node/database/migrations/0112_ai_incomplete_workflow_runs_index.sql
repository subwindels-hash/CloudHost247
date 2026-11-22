-- Supports bounded, recent operator visibility into incomplete workflow runs. This is not
-- evidence that any side effect failed or that an old event may safely be replayed.
CREATE INDEX ai_workflow_runs_incomplete_recent_idx ON ai_workflow_runs (started_at DESC, id DESC)
  WHERE status IN ('running', 'failed', 'partial');
