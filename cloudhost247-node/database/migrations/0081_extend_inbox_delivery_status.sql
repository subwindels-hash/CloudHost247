-- Migration: 0081_extend_inbox_delivery_status.sql
-- Purpose: let the Unified Inbox describe an outbound reply truthfully.
--
-- Two situations the original value set could not express without lying:
--   * `manual`        — the channel has no outbound transport in CloudHost247 (WhatsApp, Telegram,
--                       SMS, social and live chat are inbound-only today). The reply is stored and
--                       flagged for a human to send from the channel's own app; recording it as
--                       `queued` or `sent` would claim a delivery that never happened.
--   * `not_applicable` — an internal note. Notes are staff-to-staff: there is nothing to deliver.
--
-- Nothing is removed or re-purposed, so existing rows and existing queries keep their meaning.

ALTER TABLE inbox_messages DROP CONSTRAINT IF EXISTS inbox_messages_delivery_status_check;
ALTER TABLE inbox_messages ADD CONSTRAINT inbox_messages_delivery_status_check CHECK (
  delivery_status IN ('received', 'queued', 'sent', 'delivered', 'failed', 'read', 'manual', 'not_applicable')
);

-- The inbox list view filters on "replies that still need a human to deliver them".
CREATE INDEX IF NOT EXISTS inbox_messages_manual_delivery_idx
  ON inbox_messages (conversation_id)
  WHERE delivery_status = 'manual';
