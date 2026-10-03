-- -----------------------------------------------------------------------------------------------
-- 0069 — classify backup rows: standard backups vs safety snapshots.
--
-- A restore performed by an adapter that replaces state on disk (the docker-compose adapter's
-- restore untars compose.yaml, .env and volumes/ into the project directory) is destructive and,
-- until this change, irreversible: "restore the backup I took an hour ago" could not be undone
-- because nothing held the state the restore replaced (recorded open item A19(b)). The restore
-- pipeline now takes a safety snapshot of the current state before the destructive write and
-- refuses to run when that snapshot cannot be taken (engine.ts restorePipeline).
--
-- The snapshot is a real backup row — the same agent path, the same checksum, the same retention —
-- because the undo operation IS a restore of that row, so it must appear in the customer's backup
-- list beside every other restorable archive. What distinguishes it is why it exists, and that is
-- exactly what this column records. deployment_id ties the snapshot to the restore that required
-- it. Old rows default to 'standard', which is what they are.
-- -----------------------------------------------------------------------------------------------
ALTER TABLE backups ADD COLUMN IF NOT EXISTS backup_kind varchar(24) NOT NULL DEFAULT 'standard';

ALTER TABLE backups DROP CONSTRAINT IF EXISTS backups_backup_kind_check;
ALTER TABLE backups ADD CONSTRAINT backups_backup_kind_check
  CHECK (backup_kind IN ('standard', 'safety_snapshot'));
