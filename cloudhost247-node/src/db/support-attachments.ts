import type { Queryable } from './types';
import { withTransaction } from './transaction';
import { ValidationError } from '../lib/errors';
import { MAX_TICKET_ATTACHMENTS_PER_MESSAGE } from '../lib/media-upload';

/**
 * Support-ticket attachments (migration 0103).
 *
 * Deliberately narrow: this module stores and returns bytes and metadata, and nothing else. Every
 * authorisation decision (is this the ticket's owner? is this caller staff?) belongs to the route,
 * because only the route has the authenticated session. Keeping the SQL free of auth makes it
 * impossible for a second caller to "accidentally" get an unscoped read by reusing a helper.
 */

/** Metadata only — listable without pulling the bytes of every file in a thread. */
export interface TicketAttachmentRow {
  id: string;
  ticket_id: string;
  message_id: string | null;
  uploaded_by: string | null;
  uploader_role: string;
  filename: string;
  content_type: string;
  byte_size: number;
  checksum: string;
  created_at: string;
}

/** Metadata plus the stored bytes, returned only by the single-file download path. */
export interface TicketAttachmentWithDataRow extends TicketAttachmentRow {
  data: Buffer;
}

export interface CreateTicketAttachmentInput {
  id: string;
  ticketId: string;
  messageId: string | null;
  uploadedBy: string;
  uploaderRole: string;
  filename: string;
  contentType: string;
  data: Buffer;
  checksum: string;
}

/** Attachments for one ticket, oldest first — the order the thread renders in. */
export async function listAttachmentsForTicket(pool: Queryable, ticketId: string): Promise<TicketAttachmentRow[]> {
  const { rows } = await pool.query<TicketAttachmentRow>(
    `SELECT id, ticket_id, message_id, uploaded_by, uploader_role, filename, content_type,
            byte_size, checksum, created_at
       FROM support_ticket_attachments
      WHERE ticket_id = $1
      ORDER BY created_at ASC, id ASC`,
    [ticketId]
  );
  return rows;
}

/**
 * Metadata + bytes for one attachment, scoped to the ticket it was claimed to belong to.
 *
 * The `ticket_id` predicate is part of the query rather than a check made afterwards by the
 * caller: a file can therefore never be fetched "by id alone", even if a future route forgets to
 * compare the ticket. A mismatch is a 404 at the route, never a 403 — no enumeration.
 */
export async function findAttachment(
  pool: Queryable,
  ticketId: string,
  attachmentId: string
): Promise<TicketAttachmentWithDataRow | null> {
  const { rows } = await pool.query<TicketAttachmentWithDataRow>(
    `SELECT id, ticket_id, message_id, uploaded_by, uploader_role, filename, content_type,
            byte_size, checksum, created_at, data
       FROM support_ticket_attachments
      WHERE id = $1 AND ticket_id = $2
      LIMIT 1`,
    [attachmentId, ticketId]
  );
  return rows[0] ?? null;
}

export async function countAttachmentsForMessage(pool: Queryable, messageId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM support_ticket_attachments WHERE message_id = $1',
    [messageId]
  );
  return Number(rows[0]?.count ?? '0');
}

/**
 * Stores one attachment, refusing past the per-message cap.
 *
 * The cap check and the insert run in the same transaction so two concurrent uploads to the same
 * message cannot both observe "four files" and both succeed as the sixth. The count is taken
 * inside the transaction; on PGlite and on a real pool this is a single serialized unit of work.
 *
 * The size is not re-validated here beyond rejecting an empty buffer: `decodeAndValidateUpload`
 * has already sniffed the bytes and checked the cap, and the CHECK constraint is the backstop.
 */
export async function createTicketAttachment(
  pool: Queryable,
  input: CreateTicketAttachmentInput
): Promise<TicketAttachmentRow> {
  if (input.data.length === 0) throw new ValidationError('The uploaded file is empty');

  return withTransaction(pool, async (tx) => {
    if (input.messageId) {
      const existing = await countAttachmentsForMessage(tx, input.messageId);
      if (existing >= MAX_TICKET_ATTACHMENTS_PER_MESSAGE) {
        throw new ValidationError(
          `A single message can carry at most ${MAX_TICKET_ATTACHMENTS_PER_MESSAGE} attachments`
        );
      }
    }

    const { rows } = await tx.query<TicketAttachmentRow>(
      `INSERT INTO support_ticket_attachments
         (id, ticket_id, message_id, uploaded_by, uploader_role, filename, content_type,
          byte_size, checksum, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, ticket_id, message_id, uploaded_by, uploader_role, filename, content_type,
                 byte_size, checksum, created_at`,
      [
        input.id,
        input.ticketId,
        input.messageId,
        input.uploadedBy,
        input.uploaderRole,
        input.filename,
        input.contentType,
        input.data.length,
        input.checksum,
        input.data,
      ]
    );
    const row = rows[0];
    if (!row) throw new Error('Failed to store the attachment');
    return row;
  });
}

/**
 * Removes one attachment, scoped to its ticket like every other read and write here.
 *
 * Returns the deleted row's metadata so the route can audit what was removed; `null` when the row
 * did not exist under that ticket, which the route reports as 404.
 */
export async function deleteTicketAttachment(
  pool: Queryable,
  ticketId: string,
  attachmentId: string
): Promise<TicketAttachmentRow | null> {
  const { rows } = await pool.query<TicketAttachmentRow>(
    `DELETE FROM support_ticket_attachments
      WHERE id = $1 AND ticket_id = $2
      RETURNING id, ticket_id, message_id, uploaded_by, uploader_role, filename, content_type,
                byte_size, checksum, created_at`,
    [attachmentId, ticketId]
  );
  return rows[0] ?? null;
}

/** Total bytes a ticket currently stores — used by the route to refuse before decoding nothing. */
export async function totalAttachmentBytesForTicket(pool: Queryable, ticketId: string): Promise<number> {
  const { rows } = await pool.query<{ total: string | null }>(
    'SELECT COALESCE(sum(byte_size), 0)::text AS total FROM support_ticket_attachments WHERE ticket_id = $1',
    [ticketId]
  );
  return Number(rows[0]?.total ?? '0');
}
