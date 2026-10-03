-- -----------------------------------------------------------------------------------------------
-- 0068 — record what a backup actually contains: the agent's database-dump evidence.
--
-- The agent reports what it dumped (`engine`, `service`, `file`) or why nothing was dumped
-- (`reason`, `attempted`) — see docs/SERVER_AGENT.md §Backups. The control plane used that evidence
-- for a deployment-log warning and a clause in the result message and then threw it away, so in the
-- backup list a "completed" archive with no database dump was indistinguishable from a complete
-- one. That is exactly the confusion A18 fixed inside the agent ("a backup with no dump was
-- indistinguishable from a complete one, complete with a valid checksum"); this closes the other
-- half, recorded as the open item A18(c).
--
-- One jsonb column, holding the agent's reply verbatim. It is provider-shaped evidence, not platform
-- state, and a column per field would need a migration every time the agent learns to report one
-- more thing. The values are deliberately distinguishable:
--   NULL                        the agent reported nothing — an older agent, or a backup that never
--                               asked for a database. Never read this as "no dump was needed".
--   { "engine": "postgres", … }  a dump was produced; the engine names it.
--   { "engine": null, "reason": … }  a dump was requested and none was produced, with the reason
--                               and every attempt recorded beside it.
-- -----------------------------------------------------------------------------------------------
ALTER TABLE backups ADD COLUMN IF NOT EXISTS database_dump jsonb NULL;

-- The column holds the agent's reply object, or nothing at all. A scalar or an array here would be a
-- protocol accident rather than data, and it would make every reader guess.
ALTER TABLE backups DROP CONSTRAINT IF EXISTS backups_database_dump_shape_check;
ALTER TABLE backups ADD CONSTRAINT backups_database_dump_shape_check
  CHECK (database_dump IS NULL OR jsonb_typeof(database_dump) = 'object');
