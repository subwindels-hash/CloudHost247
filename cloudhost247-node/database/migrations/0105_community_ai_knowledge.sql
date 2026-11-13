-- Migration: 0105_community_ai_knowledge.sql
-- Purpose: let a moderator-approved accepted solution become a retrievable AI knowledge source,
--          without creating a second knowledge base.
--
-- The corpus, its chunk index, its retrieval ranking and its trust model already exist
-- (0066 -> 0100 -> 0102). A community solution is published into that same corpus as a source with
-- `source_kind = 'community_solution'` and `surface = 'community'`; nothing is duplicated.
--
-- Two constraints have to learn the new vocabulary:
--   * the source-kind CHECK, which enumerated the nine website kinds, and
--   * the surface CHECK, which enumerated spa | php | catalog | registry.
--
-- Both are widened only. Every existing row stays valid, and the retrieval ranking gives the new
-- kind a deliberately modest prior (see KIND_PRIOR in src/ai-website/retrieval.ts): a verified
-- community answer may help, but it never outranks the official page that documents the product.
--
-- Also note the counterpart guard in src/ai-website/website-knowledge-repo.ts:
-- `deleteSourcesNotIn` now prunes only *website* kinds, so a full website reconciliation can never
-- delete the community solutions it did not discover. Without that, the next sync would quietly
-- erase this entire knowledge bridge.
--
-- Runs inside the migration runner's own transaction — do not add BEGIN/COMMIT here.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_knowledge_sources_kind_check') THEN
    ALTER TABLE ai_knowledge_sources DROP CONSTRAINT ai_knowledge_sources_kind_check;
  END IF;
  ALTER TABLE ai_knowledge_sources
    ADD CONSTRAINT ai_knowledge_sources_kind_check
    CHECK (source_kind IS NULL OR source_kind IN (
      'website_page', 'website_tool', 'website_doc', 'legal_document', 'product', 'service',
      'faq', 'announcement', 'catalog_page', 'community_solution'
    ));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_knowledge_sources_surface_check') THEN
    ALTER TABLE ai_knowledge_sources DROP CONSTRAINT ai_knowledge_sources_surface_check;
  END IF;
  ALTER TABLE ai_knowledge_sources
    ADD CONSTRAINT ai_knowledge_sources_surface_check
    CHECK (surface IS NULL OR surface IN ('spa', 'php', 'catalog', 'registry', 'community'));
END $$;

-- Fast lookup of every published community solution, and the reverse link from a discussion to the
-- source it produced (community_discussions.ai_source_id, added in 0103).
CREATE INDEX IF NOT EXISTS ai_knowledge_sources_community_idx
  ON ai_knowledge_sources (sync_status, approval_status)
  WHERE source_kind = 'community_solution';
