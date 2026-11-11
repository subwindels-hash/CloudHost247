-- Additive trust metadata. No source is automatically human-approved.
ALTER TABLE ai_knowledge_sources
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'unreviewed' CHECK (approval_status IN ('unreviewed','approved','rejected')),
  ADD COLUMN IF NOT EXISTS authority_tier integer NOT NULL DEFAULT 6 CHECK (authority_tier BETWEEN 1 AND 6),
  ADD COLUMN IF NOT EXISTS approved_fingerprint text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS historical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_claims jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(verified_claims) = 'object');
-- Fingerprint is the content revision; no invented author modification date for old rows.
UPDATE ai_knowledge_sources SET content_observed_at = updated_at WHERE content_observed_at IS NULL;
CREATE INDEX IF NOT EXISTS ai_source_claims_idx ON ai_knowledge_sources USING gin(verified_claims);
