-- Design Studio templates: record writes that skipped the revision check.
--
-- `overwriteTemplate` now requires `expectedRevision`, so every conditional overwrite is safe by
-- construction. The only remaining way to write without a version check is the explicit compatibility
-- path (`overwriteTemplateForced`), and this column is what makes that path *visible* afterwards:
--
--   SELECT count(*) FROM design_studio_templates WHERE last_forced_at > now() - interval '30 days';
--
-- answers "are any clients still using the escape hatch, and which templates did they touch", which is
-- the question that decides whether the sunset date can hold. Without the column the compatibility
-- path would be indistinguishable from the safe one once the request had been served.
--
-- NULL means the template has never been written by a forced overwrite. Existing rows are NULL, which
-- is correct: every one of them was written before the path existed.
ALTER TABLE design_studio_templates
  ADD COLUMN IF NOT EXISTS last_forced_at timestamptz;

-- Finding the forced writes is the only query this column serves, so the index is partial: it stays
-- tiny while nobody uses the compatibility path, and no full-table index is maintained on every normal
-- save.
CREATE INDEX IF NOT EXISTS design_studio_templates_forced_idx
  ON design_studio_templates (last_forced_at DESC)
  WHERE last_forced_at IS NOT NULL;
