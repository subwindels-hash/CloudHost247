-- Design Studio templates: saved label / shipping / VDA / business-card layouts.
--
-- Why a dedicated table rather than `tool_reports`: a template is a *reusable input*, not a result.
-- It is edited in place, listed by kind, duplicated and deleted, and the editor polls it on every
-- open. Modelling it as a report would mean filtering one table by a magic status, and an operator
-- clearing old reports would silently delete a customer's label designs.
--
-- Ownership is enforced in code (src/tools/design-studio/templates/repository.ts) AND expressed
-- here: `user_id` is NOT NULL and cascades with the account, so a deleted user cannot leave orphan
-- templates behind. System templates are not rows in this table at all — they ship in the source
-- (`labels/templates.ts`, `shipping/templates.ts`, `vda/templates.ts`, `business-cards/templates.ts`)
-- and therefore cannot be overwritten by any user.
CREATE TABLE IF NOT EXISTS design_studio_templates (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Which studio the template belongs to: label | shipping | vda | card.
  kind varchar(24) NOT NULL,
  name varchar(160) NOT NULL,
  -- Short description shown in the template list.
  summary varchar(400) NOT NULL DEFAULT '',
  -- The document itself (millimetre geometry + elements). Never contains credentials.
  document jsonb NOT NULL,
  -- Parent template id when the document was created from a system template.
  source_template varchar(96),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_studio_templates_owner_idx
  ON design_studio_templates (user_id, kind, updated_at DESC);

-- Case-insensitive uniqueness per owner and kind: "Warehouse A" and "warehouse a" are the same
-- template name, and letting both exist makes the picker ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS design_studio_templates_owner_name_idx
  ON design_studio_templates (user_id, kind, lower(name));

-- Size guard at the database level too: the application caps a template at 2 MB of JSON, and this
-- constraint is the backstop for any future writer that forgets to.
ALTER TABLE design_studio_templates
  DROP CONSTRAINT IF EXISTS design_studio_templates_size_check;
ALTER TABLE design_studio_templates
  ADD CONSTRAINT design_studio_templates_size_check
  CHECK (pg_column_size(document) <= 2097152);
