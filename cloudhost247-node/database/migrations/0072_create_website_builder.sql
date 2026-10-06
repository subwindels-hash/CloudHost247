-- Migration: 0072_create_website_builder.sql
-- Purpose: CloudHost247 Website Builder — customer sites, pages, sections, revisions, published
-- snapshots, a media library, forms and form submissions, and custom-domain attachment.
--
-- Relationship to what already exists (no duplication):
--
--   * `modules/addons/cloudhost247_builder/` (the WHMCS-side page builder) stays exactly as it is:
--     it publishes the *public marketing website*. This builder publishes *customer websites* —
--     a different object with a different owner, lifecycle and hostname. They share nothing but
--     the CLOUDHOST247 brand and (optionally) the same custom-domain records.
--   * Customer-owned domains are NOT duplicated here. `builder_sites.domain_id` references the
--     existing `customer_domains` row (0009/0034) — the same record the DNS, SSL and hosting
--     flows already manage, so a domain attached to a site is the same domain the customer sees
--     under My Domains.
--   * Media bytes live in this database as `bytea`, exactly like profile images (src/db/profile-
--     images.ts): the supported cPanel target has no object-store credentials and no persistent
--     writable web root, and a database blob stays under the same access control, backup and
--     replication as everything else. Content types are whitelisted and re-sniffed server-side.
--
-- Draft vs published is enforced structurally, not by convention:
--   `builder_pages.content` is the editable draft; `builder_publications.snapshot` is an immutable
--   JSON snapshot of every page taken at publish time and served to visitors. Editing a draft can
--   never change a live page, and unpublishing removes the served snapshot.

CREATE TABLE IF NOT EXISTS builder_templates (
  id uuid PRIMARY KEY,
  slug varchar(80) NOT NULL,
  name varchar(160) NOT NULL,
  category varchar(40) NOT NULL,
  description text NOT NULL DEFAULT '',
  -- A real, complete page schema (the same shape builder_pages.content uses) — not a mockup
  -- thumbnail. Importing a template copies this into a new draft page.
  schema jsonb NOT NULL,
  palette jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'published',
  is_first_party boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_templates_status_check CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS builder_templates_slug_unique_idx ON builder_templates (slug);
CREATE INDEX IF NOT EXISTS builder_templates_category_idx ON builder_templates (category, status);

CREATE TABLE IF NOT EXISTS builder_sites (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  slug varchar(80) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  -- The live published revision (nullable until the first publish). FKs are added after both
  -- tables exist, below.
  published_publication_id uuid NULL,
  draft_revision integer NOT NULL DEFAULT 0,
  -- Custom domain: the EXISTING customer_domains record (never a second domain model).
  domain_id uuid NULL REFERENCES customer_domains (id) ON DELETE SET NULL,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Which offering produced the site ('free', or a platform_service_plans code) and the
  -- subscription that pays for it when it is a paid tier. Both server-set.
  plan_code varchar(64) NOT NULL DEFAULT 'free',
  subscription_id uuid NULL REFERENCES subscriptions (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_sites_status_check CHECK (status IN ('draft', 'published', 'suspended'))
);

CREATE UNIQUE INDEX IF NOT EXISTS builder_sites_slug_unique_idx ON builder_sites (lower(slug));
CREATE INDEX IF NOT EXISTS builder_sites_user_idx ON builder_sites (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS builder_pages (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES builder_sites (id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  path varchar(200) NOT NULL,
  is_home boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'draft',
  -- Ordered section array; every section is validated against the section registry
  -- (src/builders/sections.ts) before it is stored. No HTML is ever accepted as content.
  content jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  published_revision integer NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_pages_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT builder_pages_path_check CHECK (path ~ '^/[A-Za-z0-9._~/-]*$')
);

CREATE UNIQUE INDEX IF NOT EXISTS builder_pages_site_path_unique_idx ON builder_pages (site_id, lower(path));
-- One home page per site, enforced by the database rather than by application convention.
CREATE UNIQUE INDEX IF NOT EXISTS builder_pages_one_home_idx ON builder_pages (site_id) WHERE is_home;
CREATE INDEX IF NOT EXISTS builder_pages_site_idx ON builder_pages (site_id, sort_order);

-- Append-only revision history. Every accepted draft save writes a row; restoring a revision
-- copies it forward as a NEW revision (history is never rewritten or deleted).
CREATE TABLE IF NOT EXISTS builder_page_revisions (
  id uuid PRIMARY KEY,
  page_id uuid NOT NULL REFERENCES builder_pages (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  content jsonb NOT NULL,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  note varchar(200) NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS builder_page_revisions_unique_idx ON builder_page_revisions (page_id, revision);
CREATE INDEX IF NOT EXISTS builder_page_revisions_page_idx ON builder_page_revisions (page_id, revision DESC);

-- An immutable, complete snapshot of the site's pages at publish time. This — never the draft
-- tables — is what a visitor is served.
CREATE TABLE IF NOT EXISTS builder_publications (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES builder_sites (id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  published_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  unpublished_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS builder_publications_version_unique_idx ON builder_publications (site_id, version);
CREATE INDEX IF NOT EXISTS builder_publications_site_idx ON builder_publications (site_id, created_at DESC);

ALTER TABLE builder_sites
  DROP CONSTRAINT IF EXISTS builder_sites_published_publication_fk;
ALTER TABLE builder_sites
  ADD CONSTRAINT builder_sites_published_publication_fk
  FOREIGN KEY (published_publication_id) REFERENCES builder_publications (id) ON DELETE SET NULL;

-- Media library (bytes in-database; content type whitelisted and re-sniffed by
-- src/lib/image-upload.ts). `alt_text` is required-by-UI rather than NOT NULL so an upload can be
-- saved first and described afterwards without inventing filler text.
CREATE TABLE IF NOT EXISTS builder_media (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES builder_sites (id) ON DELETE CASCADE,
  uploaded_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  filename varchar(255) NOT NULL,
  content_type varchar(64) NOT NULL,
  byte_size integer NOT NULL,
  checksum char(64) NOT NULL,
  alt_text varchar(255) NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_media_size_check CHECK (byte_size > 0 AND byte_size <= 2097152)
);

CREATE INDEX IF NOT EXISTS builder_media_site_idx ON builder_media (site_id, created_at DESC);

-- Forms are first-class builder objects: a form block references one, and a submission is stored
-- here and simultaneously delivered into the Unified Inbox as a conversation message.
CREATE TABLE IF NOT EXISTS builder_forms (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES builder_sites (id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  notify_email varchar(255) NULL,
  success_message varchar(500) NOT NULL DEFAULT 'Thank you — your message has been received.',
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_forms_status_check CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS builder_forms_site_idx ON builder_forms (site_id);

CREATE TABLE IF NOT EXISTS builder_form_submissions (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES builder_forms (id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES builder_sites (id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  -- Set when the submission was also delivered into the Unified Inbox.
  inbox_conversation_id uuid NULL,
  source_ip inet NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS builder_form_submissions_form_idx ON builder_form_submissions (form_id, created_at DESC);
