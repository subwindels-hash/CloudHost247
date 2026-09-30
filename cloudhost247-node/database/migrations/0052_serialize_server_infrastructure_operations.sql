-- 0052 Serialize infrastructure operations per server.
--
-- A server must never be rebuilt, deleted, resized, or power-cycled by two durable jobs at once.
-- The application takes a row lock before enqueueing; this partial unique index is the final
-- database guard for direct writes and mixed-version deployments during rollout.
--
-- If legacy data already contains overlapping work, preserve the oldest operation and cancel the
-- newer queue records before adding the invariant. No provider resource is guessed or marked
-- successful by this cleanup.

WITH ranked AS (
  SELECT id,deployment_id,
         row_number() OVER(PARTITION BY server_id ORDER BY created_at ASC,id ASC) position
  FROM provisioning_jobs
  WHERE status NOT IN('READY','FAILED','CANCELLED')
), cancelled AS (
  UPDATE provisioning_jobs j
  SET status='CANCELLED',completed_at=now(),
      error_code='CONCURRENT_OPERATION_CANCELLED',
      error_message='Cancelled while enabling one-active-operation-per-server protection',
      retryable=false,updated_at=now()
  FROM ranked r
  WHERE j.id=r.id AND r.position>1
  RETURNING j.deployment_id
)
UPDATE deployments d
SET status='cancelled',completed_at=now(),lease_expires_at=NULL,worker_id=NULL,
    error_code='CONCURRENT_OPERATION_CANCELLED',
    error_message='Cancelled while enabling one-active-operation-per-server protection',updated_at=now()
WHERE d.id IN(SELECT deployment_id FROM cancelled)
  AND d.status NOT IN('succeeded','failed','cancelled','rolled_back');

CREATE UNIQUE INDEX IF NOT EXISTS provisioning_jobs_one_active_per_server_idx
  ON provisioning_jobs(server_id)
  WHERE status NOT IN('READY','FAILED','CANCELLED');
