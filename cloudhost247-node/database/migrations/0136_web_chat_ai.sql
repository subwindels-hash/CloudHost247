-- Migration: 0134_web_chat_ai.sql
-- Purpose: AI-first handling for the built-in first-party live chat.
--
-- Design notes:
--   * The CloudHost247 AI support decision layer (src/services/ai-support-operator.ts) answers
--     the visitor first, exactly as it does for the signed-in AI support desk. A human picks the
--     conversation up only when (a) the AI escalates (guardrail or unable to answer), (b) the
--     visitor asks for a human, (c) staff take it over or reply — at which point the AI goes
--     silent for the rest of the conversation.
--   * `ai_handling = 'ai'`     — the AI answers; staff watch the queue.
--   * `ai_handling = 'human'`  — a person owns it (or it is waiting for one); the AI stays silent.
--   * `escalated_at` is stamped only when the AI/visitor actually triggered the handoff to a human —
--     not for an ordinary staff reply and not for a staff take-over — so the console can
--     distinguish "the visitor asked for help" from "a person is simply here".
--   * `author = 'ai'` messages are written by the AI decision layer with no author_id, mirroring
--     `author = 'visitor'` rows carrying no user reference.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema + CI; production rollout follows the normal migration gate.

ALTER TABLE web_chat_messages DROP CONSTRAINT IF EXISTS web_chat_messages_author_check;
ALTER TABLE web_chat_messages
  ADD CONSTRAINT web_chat_messages_author_check CHECK (author IN ('visitor', 'staff', 'ai'));

ALTER TABLE web_chat_conversations
  ADD COLUMN IF NOT EXISTS ai_handling text NOT NULL DEFAULT 'ai'
    CHECK (ai_handling IN ('ai', 'human'));
ALTER TABLE web_chat_conversations
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz NULL;

COMMENT ON COLUMN web_chat_conversations.ai_handling IS
  'ai = the AI decision layer answers visitor messages; human = a person owns the conversation and the AI stays silent.';
COMMENT ON COLUMN web_chat_conversations.escalated_at IS
  'Set when the AI/visitor triggered a handoff to a human (guardrail, unable to answer, or explicit human request). NULL for ordinary staff replies and staff take-overs.';
