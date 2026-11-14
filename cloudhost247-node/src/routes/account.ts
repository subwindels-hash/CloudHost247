import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { findUserById, recordAuthEvent, updateFullName, updatePasswordHash } from '../db/users';
import { listServicesForUser } from '../db/customer-services';
import { listDomainsForUser } from '../db/customer-domains';
import {
  appendTicketMessage,
  createTicket,
  findTicketById,
  listMessagesForTicket,
  listTicketsForUser,
} from '../db/support-tickets';
import {
  createTicketAttachment,
  deleteTicketAttachment,
  findAttachment,
  listAttachmentsForTicket,
} from '../db/support-attachments';
import {
  decodeAndValidateUpload,
  MAX_TICKET_ATTACHMENT_BYTES,
  TICKET_ATTACHMENT_BODY_LIMIT_BYTES,
} from '../lib/media-upload';
import { hashPassword, verifyPassword } from '../lib/password';
import { authenticate } from '../lib/require-auth';
import { guardSupportMode } from '../lib/support-mode';
import { NotFoundError, ValidationError } from '../lib/errors';
import {
  toCustomerDomainDTO,
  toCustomerServiceDTO,
  toPublicUser,
  toTicketAttachmentDTO,
  toTicketMessageDTO,
  toTicketSummaryDTO,
} from '../dto/account';

const updateProfileSchema = z.object({
  fullName: z.string().min(1, 'fullName is required').max(255),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'currentPassword is required'),
  newPassword: z.string().min(10, 'Password must be at least 10 characters'),
});

const createTicketSchema = z.object({
  subject: z.string().min(1, 'subject is required').max(255),
  message: z.string().min(1, 'message is required').max(10000),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});

/**
 * One optional attachment per message request.
 *
 * Base64 in the body rather than multipart, matching every other upload in this platform
 * (builder media, store products, expert services): `@fastify/multipart` is not a dependency, and
 * the validator in src/lib/media-upload.ts re-derives type, size and filename from the decoded
 * bytes, so nothing the client declares is trusted either way.
 *
 * The declared content type is *checked against* the bytes rather than believed; a mismatch is a
 * 400 that names both types.
 */
const ticketAttachmentSchema = z.object({
  base64: z.string().min(1, 'attachment.base64 is required'),
  contentType: z.string().min(1, 'attachment.contentType is required').max(64),
  filename: z.string().min(1, 'attachment.filename is required').max(255),
});

const replyTicketSchema = z.object({
  message: z.string().min(1, 'message is required').max(10000),
  attachment: ticketAttachmentSchema.optional(),
});

const createTicketWithAttachmentSchema = createTicketSchema.extend({
  attachment: ticketAttachmentSchema.optional(),
});

/**
 * Turns a body-limit rejection into an answer a customer can act on.
 *
 * Fastify throws FST_ERR_CTP_BODY_TOO_LARGE with the generic text "Request body is too large";
 * for an upload that names neither the limit nor the field. This says both, in the same words the
 * validator uses, so a customer with an oversized screenshot is told what to do instead of being
 * shown a transport error. Any other error is re-thrown to the app-wide handler.
 */
function ticketBodyLimitHandler(
  error: Error & { code?: string; statusCode?: number },
  _request: unknown,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } }
) {
  if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413) {
    return reply.code(413).send({
      error: 'PAYLOAD_TOO_LARGE',
      message: `That attachment is larger than the ${Math.floor(MAX_TICKET_ATTACHMENT_BYTES / (1024 * 1024))} MB limit for support attachments`,
    });
  }
  throw error;
}

/**
 * The two ticket routes that may carry a file need a body limit above Fastify's 1 MiB default,
 * otherwise a legal 2 MiB screenshot is rejected before the validator runs. Kept in one place so
 * the two routes cannot drift apart.
 */
const TICKET_UPLOAD_ROUTE_OPTIONS = {
  config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  bodyLimit: TICKET_ATTACHMENT_BODY_LIMIT_BYTES,
  errorHandler: ticketBodyLimitHandler,
};

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });
const attachmentParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  attachmentId: z.string().uuid('attachmentId must be a valid UUID'),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * Phase 4 self-service "Customer App" API — see docs/API_CUSTOMER_APP.md for the full contract.
 *
 * Every route here is scoped to the *calling* account only: `authenticate()` establishes who the
 * caller is (re-verified against the database on every request, including the password-change
 * session-invalidation check — see src/lib/require-auth.ts), and every query below filters
 * explicitly by that caller's own user id. A record that exists but belongs to someone else is
 * never distinguishable from a record that doesn't exist at all — both return 404, never 403, so
 * this API never confirms or denies another customer's data exists (see the ticket-detail/reply
 * handlers below for the concrete case).
 *
 * customer_services and customer_domains are read-only here by design: customers can view their
 * own staff-entered records but cannot create or edit them (see database/migrations/0008 and
 * 0009 — these are informational only, not a self-service ordering/provisioning flow).
 */
export async function registerAccountRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.patch('/api/v1/account/profile', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { fullName } = parseOrThrow(updateProfileSchema, request.body);

    const user = await updateFullName(pool, auth.userId, fullName);
    if (!user) throw new NotFoundError('Account no longer exists');

    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: auth.userId,
      eventType: 'profile_update',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return { user: toPublicUser(user) };
  });

  app.post(
    '/api/v1/account/password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      // An administrator inside this account in support mode must never be able to take it over
      // by setting a new password (spec §38). Refused and audited, not silently ignored.
      await guardSupportMode(pool, request, auth, 'password.change');
      const { currentPassword, newPassword } = parseOrThrow(changePasswordSchema, request.body);

      const user = await findUserById(pool, auth.userId);
      if (!user) throw new NotFoundError('Account no longer exists');

      const currentOk = await verifyPassword(currentPassword, user.password_hash);
      if (!currentOk) {
        // Deliberately 400 (ValidationError), not 401: this account's *bearer token* is fine
        // (authenticate() already succeeded above) — only the submitted currentPassword field
        // failed to validate. The frontend's apiFetch (frontend/src/lib/api.ts) treats *any* 401
        // received while a token is present as proof that token itself is no longer good, and
        // immediately clears the whole local session — appropriate for a genuinely invalid/
        // revoked token, but not for a customer who simply mistyped their current password. Using
        // 401 here was caught as a real bug via a frontend test (a mistyped current password was
        // silently logging the user out of the app entirely) — see
        // frontend/tests/unit/account-page.test.tsx.
        throw new ValidationError('Current password is incorrect');
      }

      const newHash = await hashPassword(newPassword);
      // Stamps password_changed_at = now(), which is what makes every token issued before this
      // exact moment stop working on its next request (enforced in src/lib/require-auth.ts) — a
      // real, immediate, server-side session invalidation, not just a client-side "log out".
      await updatePasswordHash(pool, auth.userId, newHash);

      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: auth.userId,
        eventType: 'password_change',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      reply.code(204).send();
    }
  );

  app.get('/api/v1/account/services', async (request) => {
    const auth = await authenticate(request, env, pool);
    const services = await listServicesForUser(pool, auth.userId);
    return { services: services.map(toCustomerServiceDTO) };
  });

  app.get('/api/v1/account/domains', async (request) => {
    const auth = await authenticate(request, env, pool);
    const domains = await listDomainsForUser(pool, auth.userId);
    return { domains: domains.map(toCustomerDomainDTO) };
  });

  app.get('/api/v1/account/tickets', async (request) => {
    const auth = await authenticate(request, env, pool);
    const tickets = await listTicketsForUser(pool, auth.userId);
    return { tickets: tickets.map(toTicketSummaryDTO) };
  });

  app.post('/api/v1/account/tickets', TICKET_UPLOAD_ROUTE_OPTIONS, async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(createTicketWithAttachmentSchema, request.body);

    // Validated before the ticket row is written, so a rejected file never leaves behind a ticket
    // whose first message the customer has to retype.
    const file = input.attachment
      ? decodeAndValidateUpload(
          input.attachment.base64,
          input.attachment.contentType,
          input.attachment.filename,
          MAX_TICKET_ATTACHMENT_BYTES
        )
      : null;

    const messageId = randomUUID();
    const ticket = await createTicket(pool, {
      id: randomUUID(),
      userId: auth.userId,
      subject: input.subject,
      priority: input.priority,
      firstMessage: { id: messageId, authorId: auth.userId, authorRole: 'customer', body: input.message },
    });

    if (file) {
      await createTicketAttachment(pool, {
        id: randomUUID(),
        ticketId: ticket.id,
        messageId,
        uploadedBy: auth.userId,
        uploaderRole: 'customer',
        filename: file.filename,
        contentType: file.contentType,
        data: file.data,
        checksum: file.checksum,
      });
    }

    reply.code(201);
    return { ticket: toTicketSummaryDTO(ticket) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/account/tickets/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParamSchema, request.params);

    const ticket = await findTicketById(pool, id);
    // Never distinguish "doesn't exist" from "exists but isn't yours" — both are 404.
    if (!ticket || ticket.user_id !== auth.userId) {
      throw new NotFoundError('No ticket was found with that id');
    }

    const [messages, attachments] = await Promise.all([
      listMessagesForTicket(pool, ticket.id),
      listAttachmentsForTicket(pool, ticket.id),
    ]);
    return {
      ticket: {
        ...toTicketSummaryDTO(ticket),
        closedAt: ticket.closed_at,
        messages: messages.map((m) =>
          toTicketMessageDTO(
            m,
            auth.userId,
            attachments.filter((a) => a.message_id === m.id)
          )
        ),
        // Files that belong to the ticket rather than to one message.
        attachments: attachments.filter((a) => a.message_id === null).map((a) => toTicketAttachmentDTO(a, ticket.id)),
      },
    };
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/account/tickets/:id/messages',
    TICKET_UPLOAD_ROUTE_OPTIONS,
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const { id } = parseOrThrow(idParamSchema, request.params);
      const { message, attachment } = parseOrThrow(replyTicketSchema, request.body);

      const ticket = await findTicketById(pool, id);
      if (!ticket || ticket.user_id !== auth.userId) {
        throw new NotFoundError('No ticket was found with that id');
      }

      // Validated before the message is appended, so a rejected file does not leave an empty reply
      // in the thread that the customer cannot delete.
      const file = attachment
        ? decodeAndValidateUpload(
            attachment.base64,
            attachment.contentType,
            attachment.filename,
            MAX_TICKET_ATTACHMENT_BYTES
          )
        : null;

      const messageId = randomUUID();
      await appendTicketMessage(pool, {
        id: messageId,
        ticketId: ticket.id,
        authorId: auth.userId,
        authorRole: 'customer',
        body: message,
      });

      if (file) {
        await createTicketAttachment(pool, {
          id: randomUUID(),
          ticketId: ticket.id,
          messageId,
          uploadedBy: auth.userId,
          uploaderRole: 'customer',
          filename: file.filename,
          contentType: file.contentType,
          data: file.data,
          checksum: file.checksum,
        });
      }

      const updatedTicket = await findTicketById(pool, ticket.id);
      const [messages, attachments] = await Promise.all([
        listMessagesForTicket(pool, ticket.id),
        listAttachmentsForTicket(pool, ticket.id),
      ]);
      reply.code(201);
      return {
        ticket: {
          ...toTicketSummaryDTO(updatedTicket ?? ticket),
          closedAt: (updatedTicket ?? ticket).closed_at,
          messages: messages.map((m) =>
            toTicketMessageDTO(
              m,
              auth.userId,
              attachments.filter((a) => a.message_id === m.id)
            )
          ),
          attachments: attachments.filter((a) => a.message_id === null).map((a) => toTicketAttachmentDTO(a, ticket.id)),
        },
      };
    }
  );

  /**
   * Attachment download for the ticket's owner.
   *
   * Ownership is re-derived from the session on every request; the bytes are never reachable
   * through a share token or a public URL, so an attachment cannot be read after the reader's
   * session ends. A ticket that is not the caller's is a 404 (indistinguishable from nonexistent),
   * matching every other route in this file.
   */
  app.get<{ Params: { id: string; attachmentId: string } }>(
    '/api/v1/account/tickets/:id/attachments/:attachmentId/download',
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const { id, attachmentId } = parseOrThrow(attachmentParamSchema, request.params);

      const ticket = await findTicketById(pool, id);
      if (!ticket || ticket.user_id !== auth.userId) {
        throw new NotFoundError('No ticket was found with that id');
      }

      const attachment = await findAttachment(pool, ticket.id, attachmentId);
      if (!attachment) throw new NotFoundError('No attachment was found with that id');

      reply
        .header('Content-Type', attachment.content_type)
        .header(
          'Content-Disposition',
          `attachment; filename="${attachment.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`
        )
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'private, no-store');
      return reply.send(attachment.data);
    }
  );

  /**
   * Removes one of the caller's own attachments.
   *
   * Only a file *this* user uploaded can be deleted, so one party on a thread cannot remove the
   * other's evidence. Staff removal is a separate admin concern and is not offered here.
   */
  app.delete<{ Params: { id: string; attachmentId: string } }>(
    '/api/v1/account/tickets/:id/attachments/:attachmentId',
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const { id, attachmentId } = parseOrThrow(attachmentParamSchema, request.params);

      const ticket = await findTicketById(pool, id);
      if (!ticket || ticket.user_id !== auth.userId) {
        throw new NotFoundError('No ticket was found with that id');
      }

      // Scope the uploader check to a lookup that is already ticket-scoped, so a foreign id is a
      // 404 rather than a 403.
      const existing = await findAttachment(pool, ticket.id, attachmentId);
      if (!existing || existing.uploaded_by !== auth.userId) {
        throw new NotFoundError('No attachment was found with that id');
      }

      const removed = await deleteTicketAttachment(pool, ticket.id, attachmentId);
      if (!removed) throw new NotFoundError('No attachment was found with that id');

      reply.code(204);
      return reply.send();
    }
  );
}
