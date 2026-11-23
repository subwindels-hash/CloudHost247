-- Migration: 0129_create_live_chat.sql
-- Purpose: Add live chat conversations and messages (K03 — K Support).
--
-- Design notes:
--   * Creates `live_chat_conversations` (one per customer thread) and
--     `live_chat_messages` (threaded messages with a snapshot of author_role).
--   * This is an internal live chat service. No third-party chat provider
--     (Intercom, Zendesk Chat, etc.) is integrated — provider credentials are
--     not configured, so this is honest about the absence rather than
--     fabricating provider-backed chat.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

CREATE TABLE IF NOT EXISTS live_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject varchar(255) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  last_message_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_chat_conversations_customer_id_idx
  ON live_chat_conversations (customer_id);
CREATE INDEX IF NOT EXISTS live_chat_conversations_status_idx
  ON live_chat_conversations (status);

CREATE TABLE IF NOT EXISTS live_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES live_chat_conversations (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_role varchar(32) NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_chat_messages_body_not_blank_check CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS live_chat_messages_conversation_id_idx
  ON live_chat_messages (conversation_id);
