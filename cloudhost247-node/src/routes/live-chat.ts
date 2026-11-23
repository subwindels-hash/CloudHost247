/**
 * Live chat (K03 — K Support).
 *
 *   GET    /api/v1/live-chat/conversations              — list conversations (staff: all; customer: own)
 *   POST   /api/v1/live-chat/conversations              — create a conversation (customer)
 *   GET    /api/v1/live-chat/conversations/:id/messages — list messages in a conversation
 *   POST   /api/v1/live-chat/conversations/:id/messages — send a message
 *   PATCH  /api/v1/live-chat/conversations/:id/close    — close a conversation (staff only)
 *
 * Authorization:
 *   - Customers manage their own conversations and messages.
 *   - Staff / admin / super_admin can manage any conversation.
 *
 * No third-party chat provider is integrated — this is an honest internal
 * chat service.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  closeConversation,
  createConversation,
  createMessage,
  getConversation,
  listConversations,
  listMessages,
  type LiveChatConversationRow,
  type LiveChatMessageRow,
} from '../db/live-chat';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;

const conversationIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

const conversationListQuerySchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  customer_id: z.string().uuid().optional(),
});

const conversationCreateBodySchema = z.object({
  subject: z.string().min(1, 'subject is required').max(255),
});

const messageCreateBodySchema = z.object({
  body: z.string().min(1, 'body is required'),
});

type ConversationDto = {
  id: string;
  customer_id: string;
  subject: string;
  status: 'open' | 'closed';
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type MessageDto = {
  id: string;
  conversation_id: string;
  author_id: string;
  author_role: string;
  body: string;
  created_at: Date;
};

function toConversationDto(row: LiveChatConversationRow): ConversationDto {
  return {
    id: row.id,
    customer_id: row.customer_id,
    subject: row.subject,
    status: row.status,
    last_message_at: row.last_message_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toMessageDto(row: LiveChatMessageRow): MessageDto {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    author_id: row.author_id,
    author_role: row.author_role,
    body: row.body,
    created_at: row.created_at,
  };
}

export async function registerLiveChatRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- List conversations -----------------------------------------------------

  app.get<{ Querystring: z.infer<typeof conversationListQuerySchema> }>(
    '/api/v1/live-chat/conversations',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = conversationListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const filters: { status?: 'open' | 'closed'; customer_id?: string } = {};
      if (parsed.data.status) filters.status = parsed.data.status;
      if (!isStaff) {
        filters.customer_id = auth.userId;
      } else if (parsed.data.customer_id) {
        filters.customer_id = parsed.data.customer_id;
      }

      const rows = await listConversations(db, filters);
      return { conversations: rows.map(toConversationDto) };
    },
  );

  // --- Create a conversation --------------------------------------------------

  app.post<{ Body: z.infer<typeof conversationCreateBodySchema> }>(
    '/api/v1/live-chat/conversations',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = conversationCreateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const row = await createConversation(db, {
        customer_id: auth.userId,
        subject: parsed.data.subject,
      });
      reply.code(201);
      return { conversation: toConversationDto(row) };
    },
  );

  // --- List messages ----------------------------------------------------------

  app.get<{ Params: z.infer<typeof conversationIdParamSchema> }>(
    '/api/v1/live-chat/conversations/:id/messages',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = conversationIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const conversation = await getConversation(db, paramsParsed.data.id);
      if (!conversation) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Conversation not found' };
      }
      if (!isStaff && conversation.customer_id !== auth.userId) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Conversation not found' };
      }

      const messages = await listMessages(db, paramsParsed.data.id);
      return { messages: messages.map(toMessageDto) };
    },
  );

  // --- Send a message ---------------------------------------------------------

  app.post<{ Params: z.infer<typeof conversationIdParamSchema>; Body: z.infer<typeof messageCreateBodySchema> }>(
    '/api/v1/live-chat/conversations/:id/messages',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = conversationIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const conversation = await getConversation(db, paramsParsed.data.id);
      if (!conversation) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Conversation not found' };
      }
      if (!isStaff && conversation.customer_id !== auth.userId) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Conversation not found' };
      }

      const bodyParsed = messageCreateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }

      const row = await createMessage(db, {
        conversation_id: paramsParsed.data.id,
        author_id: auth.userId,
        author_role: auth.role,
        body: bodyParsed.data.body,
      });
      if (!row) {
        reply.code(400);
        return { error: 'BAD_REQUEST', message: 'Message could not be created' };
      }
      return { message: toMessageDto(row) };
    },
  );

  // --- Close a conversation ---------------------------------------------------

  app.patch<{ Params: z.infer<typeof conversationIdParamSchema> }>(
    '/api/v1/live-chat/conversations/:id/close',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      if (!isStaff) {
        reply.code(403);
        return { error: 'FORBIDDEN', message: 'Only staff can close conversations' };
      }

      const paramsParsed = conversationIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const existing = await getConversation(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Conversation not found' };
      }
      if (existing.status === 'closed') {
        reply.code(400);
        return { error: 'BAD_REQUEST', message: 'Conversation is already closed' };
      }

      const row = await closeConversation(db, paramsParsed.data.id);
      if (!row) {
        reply.code(400);
        return { error: 'BAD_REQUEST', message: 'Conversation could not be closed' };
      }
      return { conversation: toConversationDto(row) };
    },
  );
}
