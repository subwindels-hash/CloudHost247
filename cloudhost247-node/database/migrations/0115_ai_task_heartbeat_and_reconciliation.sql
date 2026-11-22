-- Task lifecycle observation (local only): a heartbeat recorded when a task is claimed and
-- bumped while its handler makes progress (steps, tool dispatch). This is a DETECTION AID ONLY —
-- never a lease, lock, ownership transfer, timeout, fence, or permission to replay. Age alone
-- never proves a worker died, that an effect did or did not happen, or that a retry is safe.
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS ai_tasks_running_heartbeat_idx ON ai_tasks (heartbeat_at)
  WHERE status = 'running';

-- Operator attention for a suspected-interrupted running task. It never changes the task,
-- releases work, authorizes retry, cancels anything, or verifies an external outcome. One
-- record per task and exact observed heartbeat (microsecond-precise), mirroring the held-claim
-- investigation model in 0111. ON DELETE RESTRICT requires a retention/deletion policy before
-- deployment, like 0111/0113.
CREATE TABLE ai_task_investigations (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES ai_tasks(id) ON DELETE RESTRICT,
  observed_heartbeat_at timestamptz NOT NULL,
  opened_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_task_investigations_observation_unique UNIQUE (task_id, observed_heartbeat_at)
);
CREATE INDEX ai_task_investigations_opened_idx ON ai_task_investigations (opened_at DESC);
