-- -----------------------------------------------------------------------------------------------
-- 0070 — record what the archive was asked for and actually holds: the agent's `includes` report.
--
-- The agent has answered since A18 with an `includes` block — `{ volumes: <bool>, databases:
-- <engine|null> }` — stating what the archive really contains, as distinct from the
-- `databaseDump` evidence 0068 began persisting. The control plane used the dump half and threw
-- the rest away, which was recorded as the open item on row A22 ("the reply's includes block is
-- still not stored"). This closes that half the same way 0068 closed the dump half: one jsonb
-- column holding the agent's reply verbatim, because it is provider-shaped evidence, and a column
-- per field would need a migration every time the agent learns to report one more thing.
--
-- The states stay distinguishable, exactly as 0068 keeps them:
--   NULL                              the agent reported nothing — an older agent. Never read as
--                                     "nothing is inside"; the archive holds at least its volumes.
--   { "volumes": true, "databases": "postgres" }   the archive was asked for and holds both.
--   { "volumes": true, "databases": null }         volumes archived, no database engine dumped.
-- -----------------------------------------------------------------------------------------------
ALTER TABLE backups ADD COLUMN IF NOT EXISTS includes jsonb NULL;

-- The column holds the agent's reply object, or nothing at all — the same shape guard as 0068's.
ALTER TABLE backups DROP CONSTRAINT IF EXISTS backups_includes_shape_check;
ALTER TABLE backups ADD CONSTRAINT backups_includes_shape_check
  CHECK (includes IS NULL OR jsonb_typeof(includes) = 'object');
