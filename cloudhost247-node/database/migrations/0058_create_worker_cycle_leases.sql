-- Serialises cPanel Cron's one-shot worker invocations. This is deliberately separate
-- from per-deployment leases: it prevents several cron-launched processes from running the
-- periodic sweeps at once, while deployment rows still retain their own crash-recovery lease.
CREATE TABLE IF NOT EXISTS worker_cycle_leases (
  name varchar(96) PRIMARY KEY,
  holder varchar(96) NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS worker_cycle_leases_expiry_idx
  ON worker_cycle_leases (lease_expires_at);
