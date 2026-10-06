-- Migration: 0073_create_ai_website_builder.sql
-- Purpose: CloudHost247 AI Website Builder — generation projects, an auditable generation ledger,
-- and the per-customer usage metering that decides what the free allowance covers.
--
-- Provider model (mirrors the AI Control Plane's rule in src/ai-os/types.ts and the Domain
-- Services rule in docs/DOMAIN_SERVICES_ARCHITECTURE.md):
--
--   * The NATIVE engine (`rules`) always exists and is always available. It is a real, deterministic
--     site generator — it expands the customer's brief into real pages, sections, copy, CTAs, SEO
--     metadata and image recommendations from the platform's own section registry. It is labelled
--     as what it is: a rules engine, not a language model. Nothing it produces is presented as
--     model output.
--   * An EXTERNAL engine (OpenAI-compatible or Anthropic-compatible chat completions) is used only
--     when an administrator has stored credentials in the AI & Integrations centre AND the adapter
--     is compiled. Without credentials the request fails closed with CONFIGURATION_REQUIRED — the
--     platform never silently pretends a model answered, and never falls back to inventing model
--     output.
--
-- Every generation is recorded, including failures, so the admin console can show what the engine
-- actually did rather than a claim about it.

CREATE TABLE IF NOT EXISTS ai_site_projects (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The site this project generated (or will generate into). Nullable while a project is still a
  -- brief, and never cascaded away with the site: the generation history outlives the site.
  site_id uuid NULL REFERENCES builder_sites (id) ON DELETE SET NULL,
  name varchar(200) NOT NULL,
  industry varchar(80) NULL,
  brief jsonb NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'draft',
  engine varchar(32) NULL,
  model varchar(120) NULL,
  last_generation_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_site_projects_status_check CHECK (
    status IN ('draft', 'generating', 'generated', 'applied', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS ai_site_projects_user_idx ON ai_site_projects (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_site_projects_site_idx ON ai_site_projects (site_id);

CREATE TABLE IF NOT EXISTS ai_site_generations (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES ai_site_projects (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  engine varchar(32) NOT NULL,
  model varchar(120) NULL,
  prompt_hash char(64) NOT NULL,
  brief jsonb NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  output jsonb NULL,
  -- The exact structured plan the engine returned, kept verbatim for audit and for the honest
  -- admin view. Never edited after the fact.
  error_code varchar(64) NULL,
  error_message text NULL,
  input_tokens integer NULL,
  output_tokens integer NULL,
  provider_reference varchar(160) NULL,
  duration_ms integer NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT ai_site_generations_status_check CHECK (
    status IN ('pending', 'succeeded', 'failed', 'rejected')
  )
);

CREATE INDEX IF NOT EXISTS ai_site_generations_project_idx ON ai_site_generations (project_id, created_at DESC);
-- Usage metering reads by (user, created_at) so the free-allowance window is a database fact, never
-- an in-memory counter that a restart could reset.
CREATE INDEX IF NOT EXISTS ai_site_generations_user_idx ON ai_site_generations (user_id, created_at DESC);

-- The images a generated site recommends. Recommendation only — the platform does not fetch or
-- embed third-party image assets on the customer's behalf, so there is no pretend asset to lie
-- about later; the customer uploads or links their own, and each row records what was suggested.
CREATE TABLE IF NOT EXISTS ai_site_image_suggestions (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL REFERENCES ai_site_generations (id) ON DELETE CASCADE,
  section_key varchar(80) NOT NULL,
  description text NOT NULL,
  search_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  accepted_media_id uuid NULL REFERENCES builder_media (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_site_image_suggestions_generation_idx ON ai_site_image_suggestions (generation_id);
