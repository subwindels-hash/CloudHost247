-- Migration: 0011_create_support_ticket_messages.sql
-- Purpose: Threaded messages for support_tickets (0010). `author_role` is captured as a snapshot
-- at post time (not re-derived from the live users table on every read) so the historical thread
-- always reads correctly even if a person's role is changed or their account is later removed.
--
-- Deliberately no attachment/file column at all in Phase 4 — file uploads are explicitly out of
-- scope (see docs/NODE_PLATFORM_STATUS.md Phase 4 section), so there is nothing here to secure or
-- validate for that later.

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_role varchar(32) NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_ticket_messages_body_not_blank_check CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_id_idx ON support_ticket_messages (ticket_id);
