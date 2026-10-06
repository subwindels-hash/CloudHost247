-- Migration: 0078_create_unified_inbox.sql
-- Purpose: CloudHost247 Unified Inbox — one place for every customer conversation, whatever
-- channel it arrived on, with labels, assignment, status, unread counts, internal notes and a
-- complete history.
--
-- Channel model (built to be extended without a redesign):
--   `inbox_channels` is a row per configured channel instance. `kind` and the `provider_key` that
--   implements it are data, not code paths — adding WhatsApp, Telegram, SMS, Instagram, a live
--   chat widget or another mailbox later means inserting a channel row and registering one
--   connector, not reworking conversations, messages, labels or the customer UI.
--
--   A connector that needs credentials the platform does not have stays in `not_configured` and
--   the UI says so. No channel ever shows invented conversations or a fabricated delivery status.
--
-- Relationship to what exists (no duplication):
--   * The web-form channel is fed by `builder_form_submissions` (0072), which sets
--     `inbox_conversation_id` — so a customer's own website form lands in the inbox as a real
--     conversation.
--   * The support channel mirrors existing `support_tickets` (0010): `inbox_conversations.ticket_id`
--     links a conversation to the ticket it came from. Ticket data is not copied or forked; the
--     inbox reads the ticket and links out to it.
--   * Outbound email reuses the platform's existing email transport configuration; the inbox never
--     introduces a second mailer.

CREATE TABLE IF NOT EXISTS inbox_channels (
  id uuid PRIMARY KEY,
  kind varchar(32) NOT NULL,
  name varchar(120) NOT NULL,
  provider_key varchar(64) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'not_configured',
  -- Non-secret channel configuration only (mailbox address, page id, phone number, widget key's
  -- public half). Credentials live in the AI & Integrations centre, encrypted and write-only.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_health_check_at timestamptz NULL,
  last_error_code varchar(64) NULL,
  last_error_message varchar(500) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_channels_kind_check CHECK (
    kind IN ('web_form', 'email', 'support', 'api', 'live_chat', 'whatsapp', 'telegram', 'sms', 'social')
  ),
  CONSTRAINT inbox_channels_status_check CHECK (
    status IN ('not_configured', 'connected', 'auth_failed', 'error', 'disabled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_channels_kind_name_unique_idx ON inbox_channels (kind, lower(name));

CREATE TABLE IF NOT EXISTS inbox_labels (
  id uuid PRIMARY KEY,
  name varchar(60) NOT NULL,
  color varchar(16) NOT NULL DEFAULT '#0756d8',
  description varchar(200) NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_labels_name_unique_idx ON inbox_labels (lower(name));

CREATE TABLE IF NOT EXISTS inbox_conversations (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES inbox_channels (id) ON DELETE RESTRICT,
  -- The platform account this conversation belongs to, when it is known. A public contact form
  -- submission from a visitor who is not a customer leaves this NULL and keeps the contact
  -- identity in the columns below.
  user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  ticket_id uuid NULL REFERENCES support_tickets (id) ON DELETE SET NULL,
  contact_name varchar(200) NULL,
  contact_email varchar(255) NULL,
  contact_phone varchar(40) NULL,
  -- Channel-native identifier (message thread id, page-scoped user id, form id…). Unique per
  -- channel, so a redelivered inbound message cannot create a second conversation.
  external_reference varchar(200) NULL,
  subject varchar(255) NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'open',
  priority varchar(16) NOT NULL DEFAULT 'normal',
  assignee_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  unread_for_staff integer NOT NULL DEFAULT 0,
  unread_for_customer integer NOT NULL DEFAULT 0,
  is_starred boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview varchar(300) NOT NULL DEFAULT '',
  closed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_conversations_status_check CHECK (
    status IN ('open', 'pending', 'snoozed', 'closed')
  ),
  CONSTRAINT inbox_conversations_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT inbox_conversations_unread_check CHECK (unread_for_staff >= 0 AND unread_for_customer >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_conversations_external_unique_idx
  ON inbox_conversations (channel_id, external_reference) WHERE external_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inbox_conversations_ticket_unique_idx
  ON inbox_conversations (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_conversations_staff_queue_idx
  ON inbox_conversations (status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS inbox_conversations_assignee_idx
  ON inbox_conversations (assignee_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS inbox_conversations_user_idx
  ON inbox_conversations (user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS inbox_conversation_labels (
  conversation_id uuid NOT NULL REFERENCES inbox_conversations (id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES inbox_labels (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, label_id)
);

CREATE INDEX IF NOT EXISTS inbox_conversation_labels_label_idx ON inbox_conversation_labels (label_id);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES inbox_conversations (id) ON DELETE CASCADE,
  direction varchar(16) NOT NULL,
  -- 'public' messages are part of the conversation the customer sees; 'internal' notes exist only
  -- for staff and are excluded from every customer-facing query (not merely hidden in the UI).
  visibility varchar(16) NOT NULL DEFAULT 'public',
  author_user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  author_name varchar(200) NULL,
  author_email varchar(255) NULL,
  body text NOT NULL,
  delivery_status varchar(16) NOT NULL DEFAULT 'received',
  delivery_error varchar(500) NULL,
  -- Channel-native message id; the unique index below makes inbound webhooks idempotent.
  external_message_id varchar(200) NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbox_messages_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT inbox_messages_visibility_check CHECK (visibility IN ('public', 'internal')),
  CONSTRAINT inbox_messages_delivery_status_check CHECK (
    delivery_status IN ('received', 'queued', 'sent', 'delivered', 'failed', 'read')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS inbox_messages_external_unique_idx
  ON inbox_messages (conversation_id, external_message_id) WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_messages_conversation_idx ON inbox_messages (conversation_id, created_at ASC);

-- Assignment history so "who had this, and when" is answerable.
CREATE TABLE IF NOT EXISTS inbox_assignment_events (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES inbox_conversations (id) ON DELETE CASCADE,
  from_assignee_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  to_assignee_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  actor_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  note varchar(300) NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbox_assignment_events_conversation_idx
  ON inbox_assignment_events (conversation_id, created_at ASC);

-- Link the website-builder form submissions created in 0072 to the conversation they became.
ALTER TABLE builder_form_submissions
  DROP CONSTRAINT IF EXISTS builder_form_submissions_inbox_fk;
ALTER TABLE builder_form_submissions
  ADD CONSTRAINT builder_form_submissions_inbox_fk
  FOREIGN KEY (inbox_conversation_id) REFERENCES inbox_conversations (id) ON DELETE SET NULL;
