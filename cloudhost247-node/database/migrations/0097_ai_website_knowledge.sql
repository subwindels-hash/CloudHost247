-- Migration: 0097_ai_website_knowledge.sql
-- Purpose: make the EXISTING AI knowledge base (0066) the single source of truth for everything the
-- public CloudHost247 website publishes — every page, tool, document, policy, product, service,
-- announcement and FAQ — so the AI chat assistant can answer from real retrieved content instead of
-- a hand-maintained list of FAQs.
--
-- Design rules this migration follows (see docs/AI_WEBSITE_INTELLIGENCE.md):
--
--   * No duplicate knowledge store. `ai_knowledge_sources` and `ai_knowledge_chunks` already exist
--     and are already used by the AI Control Plane; this migration EXTENDS them. Existing rows keep
--     working: every new column is nullable or defaulted, and `source_type` (with its CHECK
--     constraint) is left untouched. The new `source_kind` column carries the website taxonomy.
--
--   * No new database extension. pgvector and pg_trgm are not available on the supported cPanel
--     PostgreSQL and are not available in the embedded engine the test suite runs on. Retrieval uses
--     PostgreSQL's built-in full-text search (tsvector + GIN), which needs no extension, plus a
--     deterministic application-side matcher (synonyms, abbreviations, typo tolerance, reranking).
--
--   * Idempotent and additive. Safe to re-run; no destructive statement anywhere.

-- ---------------------------------------------------------------------------------------------
-- 1. Source identity, source taxonomy and synchronisation state.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE ai_knowledge_sources
  -- Stable identity of the document on the website (e.g. 'spa:/hosting/vps', 'php:vps-hosting.php',
  -- 'catalog:product:web-hosting'). This is the sync key: it is how an event-driven update finds the
  -- row to rewrite instead of inserting a duplicate.
  ADD COLUMN IF NOT EXISTS source_key varchar(200) NULL,
  -- website_page | website_tool | website_doc | legal_document | product | service | faq |
  -- announcement | catalog_page. `source_type` keeps its historical value for every one of these.
  ADD COLUMN IF NOT EXISTS source_kind varchar(32) NULL,
  -- Which website surface produced the document: spa | php | catalog | registry.
  ADD COLUMN IF NOT EXISTS surface varchar(16) NULL,
  -- Canonical visitor-facing path. Always an internal absolute path; never an absolute URL.
  ADD COLUMN IF NOT EXISTS url text NULL,
  -- Alternative paths that render the same document (e.g. the PHP route and a legacy alias).
  ADD COLUMN IF NOT EXISTS aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Navigation section / offering family, used for related-content suggestions and coverage reports.
  ADD COLUMN IF NOT EXISTS section varchar(80) NULL,
  ADD COLUMN IF NOT EXISTS category varchar(80) NULL,
  -- SHA-256 of the normalised document. A sync compares this before doing any work.
  ADD COLUMN IF NOT EXISTS fingerprint char(64) NULL,
  -- pending | indexed | skipped | excluded | failed
  ADD COLUMN IF NOT EXISTS sync_status varchar(16) NOT NULL DEFAULT 'pending',
  -- Plain-language reason for a skip/exclusion/failure, safe to show an administrator.
  ADD COLUMN IF NOT EXISTS sync_note varchar(500) NULL,
  -- Consecutive failures. Recoverable failures are retried by the worker until this is exhausted.
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL,
  -- Administrator-controlled exclusions: an excluded source is kept (so the console can show it) but
  -- is never retrievable.
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_reason varchar(300) NULL,
  ADD COLUMN IF NOT EXISTS chunk_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS word_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_knowledge_sources_sync_status_check'
  ) THEN
    ALTER TABLE ai_knowledge_sources
      ADD CONSTRAINT ai_knowledge_sources_sync_status_check
      CHECK (sync_status IN ('pending', 'indexed', 'skipped', 'excluded', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_knowledge_sources_surface_check'
  ) THEN
    ALTER TABLE ai_knowledge_sources
      ADD CONSTRAINT ai_knowledge_sources_surface_check
      CHECK (surface IS NULL OR surface IN ('spa', 'php', 'catalog', 'registry'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_knowledge_sources_kind_check'
  ) THEN
    ALTER TABLE ai_knowledge_sources
      ADD CONSTRAINT ai_knowledge_sources_kind_check
      CHECK (source_kind IS NULL OR source_kind IN (
        'website_page', 'website_tool', 'website_doc', 'legal_document', 'product', 'service',
        'faq', 'announcement', 'catalog_page'
      ));
  END IF;
END $$;

-- One row per website document. Rows created before this migration have a NULL source_key and are
-- therefore unaffected by the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS ai_knowledge_sources_key_unique_idx
  ON ai_knowledge_sources (source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_knowledge_sources_kind_idx
  ON ai_knowledge_sources (source_kind, sync_status);
CREATE INDEX IF NOT EXISTS ai_knowledge_sources_retrievable_idx
  ON ai_knowledge_sources (source_kind, url) WHERE excluded = false AND sync_status = 'indexed';
CREATE INDEX IF NOT EXISTS ai_knowledge_sources_url_idx
  ON ai_knowledge_sources (url) WHERE url IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_knowledge_sources_sync_failed_idx
  ON ai_knowledge_sources (last_error_at) WHERE sync_status = 'failed';

-- ---------------------------------------------------------------------------------------------
-- 2. Chunk metadata + the full-text index that replaces a vector extension.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE ai_knowledge_chunks
  ADD COLUMN IF NOT EXISTS url text NULL,
  ADD COLUMN IF NOT EXISTS page_title varchar(255) NULL,
  ADD COLUMN IF NOT EXISTS section varchar(120) NULL,
  ADD COLUMN IF NOT EXISTS category varchar(80) NULL,
  -- Copied from the parent source at write time so retrieval can filter without a join on hot paths.
  ADD COLUMN IF NOT EXISTS source_kind varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS fingerprint char(64) NULL,
  -- Weighted lexical surface: the chunk title, its page title, its section and its body. Generated,
  -- so it can never drift from the row it describes.
  --
  -- `keywords` is deliberately NOT part of the generated expression: `array_to_string()` is only
  -- STABLE (its result depends on the element type's output function), and PostgreSQL rejects a
  -- non-immutable expression in a generated column. Keywords are indexed separately by a GIN index
  -- on the array and matched with the immutable `&&` operator — see retrieveKnowledge().
  ADD COLUMN IF NOT EXISTS search_text text
    GENERATED ALWAYS AS (
      coalesce(page_title, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(section, '') || ' ' ||
      coalesce(content, '')
    ) STORED,
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, coalesce(page_title, '') || ' ' || coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english'::regconfig, coalesce(section, '')), 'B') ||
      setweight(to_tsvector('english'::regconfig, coalesce(content, '')), 'C')
    ) STORED;

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_fts_idx
  ON ai_knowledge_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_keywords_idx
  ON ai_knowledge_chunks USING GIN (keywords);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_source_kind_idx
  ON ai_knowledge_chunks (source_kind);
CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_url_idx
  ON ai_knowledge_chunks (url) WHERE url IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 2b. Answer provenance on the existing transcript. An AI message now records the verified links it
--     offered and the knowledge it used, so the widget can render real clickable links, the admin
--     console can show what an answer was based on, and a "this is wrong" report points at evidence.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE ai_support_messages
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS grounded boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------------------------
-- 3. Sync run ledger — "when did the AI last learn about the website, and did it work?".
--    Deliberately small: a run row plus counters, pruned by the worker. It is not a second queue;
--    the work itself is done synchronously (event-driven) or by the reconciling worker sweep.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_knowledge_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger varchar(24) NOT NULL DEFAULT 'manual',
  status varchar(16) NOT NULL DEFAULT 'running',
  discovered integer NOT NULL DEFAULT 0,
  indexed integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  excluded integer NOT NULL DEFAULT 0,
  removed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  duration_ms integer NULL,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggered_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  CONSTRAINT ai_knowledge_sync_runs_trigger_check CHECK (
    trigger IN ('manual', 'worker', 'event', 'startup', 'api')
  ),
  CONSTRAINT ai_knowledge_sync_runs_status_check CHECK (
    status IN ('running', 'succeeded', 'partial', 'failed')
  )
);
CREATE INDEX IF NOT EXISTS ai_knowledge_sync_runs_started_idx
  ON ai_knowledge_sync_runs (started_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 4. Administrator-managed source exclusions for documents that have not been discovered yet.
--    (An already-discovered source is excluded with ai_knowledge_sources.excluded.)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_knowledge_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A path prefix ('/admin'), an exact path ('/legal/terms') or a source key prefix ('php:admin/').
  pattern varchar(300) NOT NULL,
  reason varchar(300) NOT NULL DEFAULT '',
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_knowledge_exclusions_pattern_unique_idx
  ON ai_knowledge_exclusions (lower(pattern));

-- ---------------------------------------------------------------------------------------------
-- 5. Answer feedback (phase 9/10): one row per customer rating of an AI answer. Ties directly to the
--    existing transcript so an administrator can read the answer that was rated.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_support_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES ai_support_messages (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES ai_support_conversations (id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  rating varchar(8) NOT NULL,
  reason varchar(40) NULL,
  comment varchar(1000) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_support_feedback_rating_check CHECK (rating IN ('up', 'down')),
  CONSTRAINT ai_support_feedback_reason_check CHECK (
    reason IS NULL OR reason IN ('incorrect', 'incomplete', 'unclear', 'outdated', 'wrong_link', 'other')
  )
);
-- One rating per message: a customer changing their mind updates the row rather than inflating the
-- score.
CREATE UNIQUE INDEX IF NOT EXISTS ai_support_feedback_message_unique_idx
  ON ai_support_feedback (message_id);
CREATE INDEX IF NOT EXISTS ai_support_feedback_recent_idx
  ON ai_support_feedback (created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 6. Unanswered-question queue (phase 10). Every AI turn that could not be grounded is recorded so
--    an administrator can turn it into content — the mechanism that keeps the knowledge base from
--    silently rotting. `resolved` rows stay for reporting; the queue view filters on it.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_support_unanswered_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NULL REFERENCES ai_support_conversations (id) ON DELETE SET NULL,
  message_id uuid NULL REFERENCES ai_support_messages (id) ON DELETE SET NULL,
  question varchar(2000) NOT NULL,
  -- Normalised question text, so the same question asked twice is counted once.
  question_key varchar(200) NOT NULL,
  intent varchar(64) NULL,
  occurrences integer NOT NULL DEFAULT 1,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  resolved_at timestamptz NULL,
  resolution_note varchar(500) NULL,
  last_asked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_support_unanswered_question_key_unique_idx
  ON ai_support_unanswered_questions (question_key);
CREATE INDEX IF NOT EXISTS ai_support_unanswered_open_idx
  ON ai_support_unanswered_questions (occurrences DESC, last_asked_at DESC) WHERE resolved = false;
