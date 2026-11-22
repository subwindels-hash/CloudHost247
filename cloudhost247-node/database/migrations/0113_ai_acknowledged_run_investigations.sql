-- Records attention only: not verification, resolution, assignment or permission to replay.
-- Retains the exact acknowledged event incarnation and the status observed when opened.
CREATE TABLE ai_acknowledged_run_investigations (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES ai_workflow_runs(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES ai_events(id) ON DELETE RESTRICT,
  acknowledged_at timestamptz NOT NULL,
  observed_status varchar(16) NOT NULL CHECK (observed_status IN ('running', 'failed', 'partial')),
  opened_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_acknowledged_run_investigations_identity UNIQUE (run_id, event_id, acknowledged_at)
);
