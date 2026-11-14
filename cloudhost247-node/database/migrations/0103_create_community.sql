-- Migration: 0103_create_community.sql
-- Purpose: the Community Forum — categories, discussions, replies, reactions, bookmarks,
--          subscriptions, mentions, reports, attachments, badges, reputation and notification
--          preferences, all owned by the EXISTING CloudHost247 accounts.
--
-- Design rules (see docs/community/COMMUNITY-PLAN.md):
--
--   * No parallel identity. A member is a `users` row. There is no `community_users` table, no
--     second password, no duplicate e-mail. Signing in anywhere on the site signs you in here.
--   * No duplicate infrastructure. Privileged actions go to the existing `audit_logs`, in-app
--     notifications go to the existing `user_notifications`, and approved solutions are published
--     into the existing `ai_knowledge_sources` / `ai_knowledge_chunks` corpus (0105).
--   * No fabricated content. This migration creates structure only. Categories and system badges
--     are configuration and live in 0104; not one discussion, reply, member or reaction is seeded.
--   * Application-generated UUIDs, no database extension. Same rule as 0001 — the supported cPanel
--     PostgreSQL grants no CREATE EXTENSION, so identities come from crypto.randomUUID().
--   * PGlite-compatible (the test suite's embedded engine): generated tsvector columns, CHECK
--     constraints, partial indexes and array columns only — the same vocabulary 0100 already uses.
--
-- Runs inside the migration runner's own transaction — do not add BEGIN/COMMIT here.

-- ---------------------------------------------------------------------------------------------
-- 1. Categories — the twelve forums the Community Forum ships with (seeded in 0104).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_categories (
  id uuid PRIMARY KEY,
  slug varchar(64) NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(400) NOT NULL,
  -- discussion | question | announcement | showcase
  -- A `question` category tracks accepted answers; `announcement` is staff-posted only;
  -- `showcase` is the developer project/tutorial shape. The distinction drives UI affordances
  -- rather than hiding them behind a hard-coded slug list.
  purpose varchar(24) NOT NULL DEFAULT 'discussion',
  accepts_solutions boolean NOT NULL DEFAULT false,
  staff_only_posting boolean NOT NULL DEFAULT false,
  is_enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS community_categories_slug_unique_idx ON community_categories (lower(slug));
CREATE INDEX IF NOT EXISTS community_categories_position_idx ON community_categories (is_enabled, position, name);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_categories_purpose_check') THEN
    ALTER TABLE community_categories
      ADD CONSTRAINT community_categories_purpose_check
      CHECK (purpose IN ('discussion', 'question', 'announcement', 'showcase'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_categories_slug_check') THEN
    ALTER TABLE community_categories
      ADD CONSTRAINT community_categories_slug_check
      CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Member profile — one row per member, keyed by the existing account.
--
-- Display name, e-mail and account status are NEVER copied here: users.username / users.full_name
-- stay the single source of truth, and a rename is reflected everywhere immediately. Only
-- community-specific profile data and the counters that belong to the community live here.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_members (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio varchar(600) NOT NULL DEFAULT '',
  website_url varchar(200) NULL,
  location varchar(120) NULL,
  reputation integer NOT NULL DEFAULT 0,
  accepted_answers integer NOT NULL DEFAULT 0,
  -- Opt-out of the public member directory. Their discussions still show their name; they simply
  -- are not listed on /community/members.
  directory_listed boolean NOT NULL DEFAULT true,
  -- Posting restriction (distinct from a suspended ACCOUNT, which is handled by users.status).
  restricted_until timestamptz NULL,
  restriction_reason varchar(300) NULL,
  muted_from_reports boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_members_reputation_check') THEN
    ALTER TABLE community_members ADD CONSTRAINT community_members_reputation_check CHECK (reputation >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_members_accepted_check') THEN
    ALTER TABLE community_members ADD CONSTRAINT community_members_accepted_check CHECK (accepted_answers >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS community_members_reputation_idx ON community_members (reputation DESC, joined_at ASC);
CREATE INDEX IF NOT EXISTS community_members_directory_idx ON community_members (directory_listed, reputation DESC);

-- Staff designations. Deliberately a separate table from users.role: the platform's role column
-- gates the whole control plane (catalog, billing, provisioning), and being a forum moderator must
-- never imply any of that. Only a super_admin can grant these, and the service never reads a
-- requested role from a request body — see src/community/permissions.ts.
CREATE TABLE IF NOT EXISTS community_staff_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL,
  granted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_staff_roles_role_check') THEN
    ALTER TABLE community_staff_roles
      ADD CONSTRAINT community_staff_roles_role_check CHECK (role IN ('moderator', 'developer', 'staff'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Discussions.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_discussions (
  id uuid PRIMARY KEY,
  category_id uuid NOT NULL REFERENCES community_categories(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug varchar(200) NOT NULL,
  title varchar(200) NOT NULL,
  -- Markdown, bounded by the route schema. Rendered to React elements by the existing
  -- frontend/src/lib/markdown.tsx renderer: the community never inserts raw HTML, so no user
  -- string is ever passed to dangerouslySetInnerHTML.
  body text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  is_pinned boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  accepted_reply_id uuid NULL,
  accepted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  accepted_at timestamptz NULL,
  view_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  reaction_count integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  -- Set when this discussion's accepted solution was published to the AI knowledge corpus (0105).
  ai_source_id uuid NULL,
  ai_published_at timestamptz NULL,
  -- Tags are deliberately NOT part of this generated vector: array_to_string() is only STABLE,
  -- and PostgreSQL requires a generated column's expression to be IMMUTABLE. Tags keep their own
  -- GIN index below, and search matches them explicitly (see searchCommunity in
  -- src/community/community-service.ts), so nothing is lost.
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(body, '')), 'C')
  ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS community_discussions_slug_unique_idx ON community_discussions (lower(slug));
CREATE INDEX IF NOT EXISTS community_discussions_category_idx ON community_discussions (category_id, last_activity_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS community_discussions_activity_idx ON community_discussions (last_activity_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS community_discussions_author_idx ON community_discussions (author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS community_discussions_pinned_idx ON community_discussions (is_pinned DESC, last_activity_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS community_discussions_unanswered_idx ON community_discussions (created_at DESC) WHERE deleted_at IS NULL AND reply_count = 0 AND is_locked = false;
CREATE INDEX IF NOT EXISTS community_discussions_solution_idx ON community_discussions (accepted_at DESC) WHERE accepted_reply_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS community_discussions_search_idx ON community_discussions USING gin (search_vector);
CREATE INDEX IF NOT EXISTS community_discussions_tags_idx ON community_discussions USING gin (tags);

-- ---------------------------------------------------------------------------------------------
-- 4. Replies — one level of nesting (a reply may answer another reply); the service enforces it.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_replies (
  id uuid PRIMARY KEY,
  discussion_id uuid NOT NULL REFERENCES community_discussions(id) ON DELETE CASCADE,
  parent_id uuid NULL REFERENCES community_replies(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  is_accepted boolean NOT NULL DEFAULT false,
  reaction_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS community_replies_discussion_idx ON community_replies (discussion_id, created_at ASC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS community_replies_author_idx ON community_replies (author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS community_replies_parent_idx ON community_replies (parent_id, created_at ASC);

-- Forward reference: the accepted reply lives on the discussion, so the constraint is added after
-- both tables exist. ON DELETE SET NULL because deleting an accepted reply must un-solve the
-- discussion rather than block the delete.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_discussions_accepted_reply_fk') THEN
    ALTER TABLE community_discussions
      ADD CONSTRAINT community_discussions_accepted_reply_fk
      FOREIGN KEY (accepted_reply_id) REFERENCES community_replies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Reactions, bookmarks, subscriptions.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_reactions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type varchar(12) NOT NULL,
  target_id uuid NOT NULL,
  kind varchar(16) NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_type, target_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_reactions_target_check') THEN
    ALTER TABLE community_reactions
      ADD CONSTRAINT community_reactions_target_check CHECK (target_type IN ('discussion', 'reply'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_reactions_kind_check') THEN
    ALTER TABLE community_reactions
      ADD CONSTRAINT community_reactions_kind_check CHECK (kind IN ('like', 'helpful', 'insightful'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS community_reactions_target_idx ON community_reactions (target_type, target_id);

CREATE TABLE IF NOT EXISTS community_bookmarks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discussion_id uuid NOT NULL REFERENCES community_discussions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, discussion_id)
);

CREATE INDEX IF NOT EXISTS community_bookmarks_user_idx ON community_bookmarks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_subscriptions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type varchar(12) NOT NULL,
  scope_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope_type, scope_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_subscriptions_scope_check') THEN
    ALTER TABLE community_subscriptions
      ADD CONSTRAINT community_subscriptions_scope_check CHECK (scope_type IN ('discussion', 'category'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS community_subscriptions_scope_idx ON community_subscriptions (scope_type, scope_id);

-- ---------------------------------------------------------------------------------------------
-- 6. Mentions — resolved server-side against real usernames, never trusted from the client.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_mentions (
  id uuid PRIMARY KEY,
  source_type varchar(12) NOT NULL,
  source_id uuid NOT NULL,
  mentioned_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS community_mentions_user_idx ON community_mentions (mentioned_user_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 7. Reports and moderation queue. One open report per member per item; the unique index is what
-- makes "report" idempotent instead of a way to pile up duplicate complaints.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_reports (
  id uuid PRIMARY KEY,
  target_type varchar(12) NOT NULL,
  target_id uuid NOT NULL,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason varchar(32) NOT NULL,
  detail varchar(1000) NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'open',
  resolved_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz NULL,
  resolution_note varchar(500) NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_reports_target_check') THEN
    ALTER TABLE community_reports
      ADD CONSTRAINT community_reports_target_check CHECK (target_type IN ('discussion', 'reply', 'member'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_reports_status_check') THEN
    ALTER TABLE community_reports
      ADD CONSTRAINT community_reports_status_check CHECK (status IN ('open', 'actioned', 'dismissed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_reports_reason_check') THEN
    ALTER TABLE community_reports
      ADD CONSTRAINT community_reports_reason_check
      CHECK (reason IN ('spam', 'abuse', 'off_topic', 'inaccurate', 'security', 'other'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS community_reports_open_unique_idx
  ON community_reports (reporter_id, target_type, target_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS community_reports_queue_idx ON community_reports (status, created_at ASC);
CREATE INDEX IF NOT EXISTS community_reports_target_idx ON community_reports (target_type, target_id);

-- ---------------------------------------------------------------------------------------------
-- 8. Attachments.
--
-- Stored in the database as bytes rather than on the filesystem so a cPanel deployment needs no
-- writable upload directory, and nothing is ever served by the static handler: the download route
-- re-authorizes every request and answers with an allowlisted image MIME type, `nosniff`, and
-- `Content-Disposition: inline` for images only. Size and type are enforced twice — by these CHECK
-- constraints and by the route schema.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_attachments (
  id uuid PRIMARY KEY,
  discussion_id uuid NOT NULL REFERENCES community_discussions(id) ON DELETE CASCADE,
  reply_id uuid NULL REFERENCES community_replies(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name varchar(120) NOT NULL,
  mime_type varchar(64) NOT NULL,
  byte_size integer NOT NULL,
  content bytea NOT NULL,
  width integer NULL,
  height integer NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_attachments_type_check') THEN
    ALTER TABLE community_attachments
      ADD CONSTRAINT community_attachments_type_check
      CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_attachments_size_check') THEN
    ALTER TABLE community_attachments
      ADD CONSTRAINT community_attachments_size_check CHECK (byte_size > 0 AND byte_size <= 1572864);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS community_attachments_discussion_idx ON community_attachments (discussion_id, created_at ASC);
CREATE INDEX IF NOT EXISTS community_attachments_uploader_idx ON community_attachments (uploaded_by, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 9. Badges and reputation.
--
-- Reputation is derived from recorded events, never incremented from an untracked counter alone:
-- the unique index makes every award exactly-once per (member, reason, item), so editing a reply
-- twice, toggling a reaction, or replaying a request cannot farm points.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_badges (
  id uuid PRIMARY KEY,
  slug varchar(48) NOT NULL,
  name varchar(80) NOT NULL,
  description varchar(300) NOT NULL,
  kind varchar(12) NOT NULL DEFAULT 'automatic',
  icon varchar(16) NOT NULL DEFAULT '★',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS community_badges_slug_unique_idx ON community_badges (lower(slug));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_badges_kind_check') THEN
    ALTER TABLE community_badges
      ADD CONSTRAINT community_badges_kind_check CHECK (kind IN ('automatic', 'manual'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS community_member_badges (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id uuid NOT NULL REFERENCES community_badges(id) ON DELETE CASCADE,
  granted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS community_reputation_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(40) NOT NULL,
  points integer NOT NULL,
  source_type varchar(16) NOT NULL,
  source_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS community_reputation_once_idx
  ON community_reputation_events (user_id, kind, source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_reputation_user_idx ON community_reputation_events (user_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 10. Notification preferences. Absent row = the service default for that type. Email is OFF by
-- default for community activity: a reply in a forum thread is not a billing event and must never
-- arrive as unsolicited mail. Members opt in per type.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS community_notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type varchar(40) NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_type)
);
