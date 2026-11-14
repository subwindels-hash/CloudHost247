-- Migration: 0106_create_support_ticket_attachments.sql
-- Purpose: Support-ticket attachments — the one capability the module certification catalog
-- recorded as "deliberately absent" (docs/MODULE-CERTIFICATION-CATALOG.md §"Genuine unfinished
-- items"). This adds it without inventing anything the rest of the module does not already have.
--
-- Design constraints, each one taken from an existing decision in this repository rather than
-- chosen fresh:
--
--   * Bytes live in the database (bytea), exactly as `builder_media` (0072) and `store_products`
--     already do. There is no object store configured for this platform, and writing uploads to a
--     directory the Passenger app can reach would make the file store a second, unreconciled
--     copy of customer data — the backups engine would not capture it.
--   * The size cap is enforced twice: here by a CHECK constraint (so no code path can exceed it)
--     and again in the upload validator before the insert, so the operator sees a clear message
--     instead of a constraint violation.
--   * `byte_size` is the decoded length, never the base64 length. `checksum` is the SHA-256 of the
--     stored bytes so a download can be proven to be the file that was attached.
--   * `ticket_id` cascades: deleting a ticket takes its attachments with it. `message_id` is
--     nullable because an attachment may be uploaded with the opening message before that message
--     row is written, and because a customer may attach evidence to the ticket itself.
--   * There is deliberately NO public sharing token and no unauthenticated download. Every read
--     goes through a session-scoped route that re-checks ownership (customer) or staff role.
--
-- Both new columns on `support_ticket_messages` are additive and nullable, so existing rows and
-- existing reads are unaffected.

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
  -- The message this file was sent with. NULL for a ticket-level attachment.
  message_id uuid NULL REFERENCES support_ticket_messages (id) ON DELETE CASCADE,
  uploaded_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  -- 'customer' or the staff role, captured as a snapshot: the author's role may change later, but
  -- what the customer was told at the time must not.
  uploader_role varchar(32) NOT NULL,
  -- Server-normalised display name (slug + extension implied by the DETECTED type). Never the
  -- client's path, never a second extension.
  filename varchar(255) NOT NULL,
  content_type varchar(64) NOT NULL,
  byte_size integer NOT NULL,
  checksum char(64) NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Must match MAX_TICKET_ATTACHMENT_BYTES in src/lib/media-upload.ts.
  CONSTRAINT support_ticket_attachments_size_check CHECK (byte_size > 0 AND byte_size <= 5242880),
  CONSTRAINT support_ticket_attachments_role_check CHECK (length(uploader_role) > 0)
);

CREATE INDEX IF NOT EXISTS support_ticket_attachments_ticket_idx
  ON support_ticket_attachments (ticket_id, created_at ASC);

CREATE INDEX IF NOT EXISTS support_ticket_attachments_message_idx
  ON support_ticket_attachments (message_id) WHERE message_id IS NOT NULL;
