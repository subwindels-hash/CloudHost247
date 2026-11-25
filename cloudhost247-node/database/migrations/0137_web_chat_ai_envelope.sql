-- Migration: 0135_web_chat_ai_envelope.sql
-- Purpose: carry the AI answer envelope on web_chat_messages so the built-in widget can render
-- verified links and suggested follow-ups, exactly as the AI support desk does.
--
-- Design notes:
--   * `links` — the verified destinations the AI answer offered ({label, url, kind}); resolved
--     server-side against the site registry. The widget never constructs a URL itself.
--   * `follow_ups` — suggested next questions built from what was retrieved, rendered as
--     one-tap chips in the widget. Server strings only.
--   * Visitor/staff messages simply carry the empty defaults.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.

ALTER TABLE web_chat_messages
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE web_chat_messages
  ADD COLUMN IF NOT EXISTS follow_ups jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN web_chat_messages.links IS
  'Verified {label, url, kind} destinations the AI answer offered. Resolved server-side; widgets render them as-is.';
COMMENT ON COLUMN web_chat_messages.follow_ups IS
  'Suggested follow-up questions suggested by the answer engine, rendered as one-tap chips.';
