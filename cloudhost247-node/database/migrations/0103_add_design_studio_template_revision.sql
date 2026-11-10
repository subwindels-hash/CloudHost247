-- Design Studio templates: a revision counter for version-safe overwrite.
--
-- "Save over" replaces a saved layout wholesale, so two tabs editing the same template is not a
-- hypothetical: the second save silently discards the first, and the customer sees the name they
-- expected with contents they did not choose. A counter on the row makes that detectable without a
-- second table or a stored history:
--
--   UPDATE ... SET revision = revision + 1 WHERE id = $1 AND user_id = $2 AND revision = $expected
--
-- Zero rows updated means either "not yours" or "you were looking at an older version", and the
-- repository tells those apart by re-reading the row (404 vs 409). The check is in the WHERE clause
-- rather than a read-then-write in TypeScript, so two concurrent saves cannot both pass it.
--
-- Defaulting to 1 backfills existing rows: a template saved before this column existed is version 1,
-- and any client that does not send an expectation still gets a conditional write against the version
-- it just read. Nothing about the stored document changes, so previously saved templates keep working
-- untouched.
ALTER TABLE design_studio_templates
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

-- A revision is a small monotonic counter; a negative or zero value would mean the row was written
-- by something that bypassed the repository, and a conditional update could then never match it.
ALTER TABLE design_studio_templates
  DROP CONSTRAINT IF EXISTS design_studio_templates_revision_check;
ALTER TABLE design_studio_templates
  ADD CONSTRAINT design_studio_templates_revision_check CHECK (revision >= 1);
