/**
 * First-party anonymous visitor live chat.
 *
 * Public (visitor) surface — no account required; the visitor holds an opaque token issued by
 * the session endpoint. The token travels in the `X-Web-Chat-Token` header; only its sha256 hash
 * is stored server-side.
 *
 *   POST /api/v1/web-chat/session                  — open (or resume) a conversation
 *   GET  /api/v1/web-chat/session                  — current session state
 *   GET  /api/v1/web-chat/messages?after=<seq>     — delta-poll messages
 *   POST /api/v1/web-chat/messages                 — send a visitor message (the AI decision
 *                                                    layer answers it first; a human owns
 *                                                    conversations it has escalated)
 *
 * Staff surface — authenticated staff/admin/super_admin; powers Admin → Live Chat:
 *
 *   GET   /api/v1/admin/web-chat/conversations                 — list (status filter)
 *   GET   /api/v1/admin/web-chat/conversations/:id             — one conversation
 *   GET   /api/v1/admin/web-chat/conversations/:id/messages    — delta-poll; marks visitor side read
 *   POST  /api/v1/admin/web-chat/conversations/:id/messages    — staff reply
 *   PATCH /api/v1/admin/web-chat/conversations/:id/close       — close
 *   PATCH /api/v1/admin/web-chat/conversations/:id/reopen      — reopen
 *
 * Authorization: visitors can only ever see (and post into) the conversation bound to their
 * token; staff can see and answer everything. No third-party chat provider is integrated —
 * this is an honest internal service, and it says so when unconfigured rather than faking one.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  createConversation,
  createMessage,
  getConversationById,
  getConversationByTokenHash,
  hashVisitorToken,
  listConversationsForAdmin,
  listMessages,
  markStaffRead,
  mintVisitorToken,
  setConversationHandling,
  setConversationStatus,
  type WebChatConversationRow,
  type WebChatMessageRow,
} from '../db/web-chat';
import { findUserById } from '../db/users';
import { authenticate } from '../lib/require-auth';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../lib/errors';
import { decideSupportResponse } from '../services/ai-support-operator';
import { createNotification } from '../services/notification-service';
import { auditRequest } from '../lib/audit';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

const TOKEN_HEADER = 'x-web-chat-token';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

const sessionBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(255).optional(),
  source: z.enum(['spa', 'whmcs', 'unknown']).optional(),
});

const visitorMessageBodySchema = z.object({
  body: z.string().trim().min(1, 'body is required').max(2000, 'Messages are limited to 2000 characters'),
});

const messagesQuerySchema = z.object({
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});

const conversationIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

const adminListQuerySchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  handling: z.enum(['ai', 'human']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const handlingSchema = z.object({
  handling: z.enum(['ai', 'human']),
});

const adminMessageBodySchema = z.object({
  body: z.string().trim().min(1, 'body is required').max(4000),
});

type ConversationDto = {
  id: string;
  status: 'open' | 'closed';
  source: 'spa' | 'whmcs' | 'unknown';
  visitorName: string | null;
  visitorEmail: string | null;
  lastMessageAt: string | null;
  /** 'ai' = the AI decision layer answers; 'human' = a person owns the conversation and the AI is silent. */
  aiHandling: 'ai' | 'human';
  /** Set only when the AI/visitor triggered a handoff to a human — not for ordinary staff replies. */
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminConversationDto = ConversationDto & {
  messageCount: number;
  unreadStaff: number;
  lastMessageBody: string | null;
  lastMessageAuthor: 'visitor' | 'staff' | 'ai' | null;
};

type MessageLink = { label: string; url: string; kind?: string };

type MessageDto = {
  id: string;
  seq: number;
  author: 'visitor' | 'staff' | 'ai';
  authorName: string | null;
  body: string;
  links: MessageLink[];
  followUps: string[];
  createdAt: string;
};

function toConversationDto(row: WebChatConversationRow): ConversationDto {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    visitorName: row.visitor_name,
    visitorEmail: row.visitor_email,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
    aiHandling: row.ai_handling,
    escalatedAt: row.escalated_at ? new Date(row.escalated_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toAdminConversationDto(row: WebChatConversationRow & {
  message_count?: number;
  unread_staff?: number;
  last_message_body?: string | null;
  last_message_author?: 'visitor' | 'staff' | 'ai' | null;
}): AdminConversationDto {
  return {
    ...toConversationDto(row),
    messageCount: row.message_count ?? 0,
    unreadStaff: row.unread_staff ?? 0,
    lastMessageBody: row.last_message_body ?? null,
    lastMessageAuthor: row.last_message_author ?? null,
  };
}

function toMessageDto(row: WebChatMessageRow): MessageDto {
  const rawLinks = Array.isArray(row.links) ? row.links : [];
  const links = rawLinks
    .filter((link): link is MessageLink => Boolean(link) && typeof (link as MessageLink).label === 'string' && typeof (link as MessageLink).url === 'string')
    .map((link) => ({ label: String(link.label).slice(0, 120), url: String(link.url).slice(0, 2048), ...(link.kind ? { kind: String(link.kind).slice(0, 40) } : {}) }))
    .filter((link) => /^\/[^/]|^https:\/\//.test(link.url));
  const rawFollowUps = Array.isArray(row.follow_ups) ? row.follow_ups : [];
  const followUps = rawFollowUps
    .map((item) => String(item).trim().slice(0, 160))
    .filter((item) => item.length > 0)
    .slice(0, 4);
  return {
    id: row.id,
    seq: row.seq,
    author: row.author,
    authorName: row.author_name,
    body: row.body,
    links,
    followUps,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function extractVisitorToken(request: FastifyRequest): string {
  const raw = request.headers[TOKEN_HEADER];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token || !TOKEN_PATTERN.test(token)) {
    // 401 rather than 400: the widget treats this as "no session — ask for a new one".
    throw new UnauthorizedError('A valid X-Web-Chat-Token header is required');
  }
  return token;
}

async function visitorConversation(request: FastifyRequest, db: Queryable) {
  const token = extractVisitorToken(request);
  const row = await getConversationByTokenHash(db, hashVisitorToken(token));
  if (!row) {
    throw new UnauthorizedError('This chat session is not recognised — start a new one');
  }
  return row;
}

/** Tells every active staff member a visitor conversation now needs a human. In-app notification
 * plus the email outbox, deduplicated per (staff, conversation) — the console's unread badge and
 * escalated-first ordering are the persistent signals; this is the push. */
async function notifyStaffOfEscalation(
  db: Queryable,
  conversation: WebChatConversationRow,
  reason: string,
  visitorMessage: string,
): Promise<void> {
  try {
    const admins = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE status = 'active' AND role IN ('staff', 'admin', 'super_admin')`,
    );
    const who = conversation.visitor_name ?? 'An anonymous visitor';
    const contact = conversation.visitor_email ? ` (${conversation.visitor_email})` : '';
    const preview = visitorMessage.replace(/\s+/g, ' ').trim().slice(0, 140);
    const message = [
      `${who}${contact} needs a human in the built-in live chat.`,
      `Reason: ${reason.replaceAll('_', ' ').toLowerCase()}`,
      `Latest message: ${preview}`,
      `Conversation: ${conversation.id}`,
    ].join('\n');
    for (const admin of admins.rows) {
      await createNotification(db, {
        userId: admin.id,
        type: 'WEB_CHAT_ESCALATION',
        title: 'Live chat needs a human',
        message,
        resourceType: 'web_chat_conversation',
        resourceId: conversation.id,
      });
    }
  } catch {
    // A failed push must never lose the conversation itself — the queue badge still shows it.
  }
}

/** Silent AI answering is bounded to conversations nobody has taken over. Everything else in this
 * module treats `ai_handling = 'human'` as "a person owns it — say nothing". */
async function staffAuth(request: FastifyRequest, env: Env, db: Queryable) {
  const auth = await authenticate(request, env, db);
  if (!STAFF_ROLES.includes(auth.role as StaffRole)) {
    throw new ForbiddenError('Only staff can manage live chat conversations');
  }
  return auth;
}

export async function registerWebChatRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- Visitor: open or resume a session --------------------------------------

  app.post<{ Body: z.infer<typeof sessionBodySchema> }>(
    '/api/v1/web-chat/session',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = sessionBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const rawToken = request.headers[TOKEN_HEADER];
      const existingToken = Array.isArray(rawToken) ? rawToken[0] : rawToken;

      // Resume path: the widget already holds a token bound to a conversation —
      // return that conversation instead of minting a second one. A closed
      // conversation stays closed; the visitor's next message reopens it.
      if (existingToken && TOKEN_PATTERN.test(existingToken)) {
        const existing = await getConversationByTokenHash(db, hashVisitorToken(existingToken));
        if (existing) {
          return { conversation: toConversationDto(existing), token: null };
        }
      }

      const token = mintVisitorToken();
      const row = await createConversation(db, {
        tokenHash: hashVisitorToken(token),
        visitorName: parsed.data.name?.trim() || null,
        visitorEmail: parsed.data.email?.trim() || null,
        source: parsed.data.source ?? 'unknown',
      });
      reply.code(201);
      // The token is returned exactly once — only its sha256 hash is stored.
      return { conversation: toConversationDto(row), token };
    },
  );

  // --- Visitor: current session state -----------------------------------------

  app.get('/api/v1/web-chat/session', async (request) => {
    const conversation = await visitorConversation(request, db);
    const messages = await listMessages(db, conversation.id, 0);
    return {
      conversation: toConversationDto(conversation),
      lastSeq: messages.length ? messages[messages.length - 1]!.seq : 0,
    };
  });

  // --- Visitor: delta-poll messages -------------------------------------------

  app.get<{ Querystring: z.infer<typeof messagesQuerySchema> }>(
    '/api/v1/web-chat/messages',
    async (request) => {
      const conversation = await visitorConversation(request, db);
      const parsed = messagesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const messages = await listMessages(db, conversation.id, parsed.data.after ?? 0);
      return {
        conversation: toConversationDto(conversation),
        messages: messages.map(toMessageDto),
      };
    },
  );

  // --- Visitor: send a message -------------------------------------------------

  app.post<{ Body: z.infer<typeof visitorMessageBodySchema> }>(
    '/api/v1/web-chat/messages',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, _reply) => {
      const conversationRow = await visitorConversation(request, db);
      // A visitor messaging a closed conversation reopens it — they are asking for help again,
      // and silently refusing the message would lose their words.
      let conversation = conversationRow;
      if (conversationRow.status === 'closed') {
        conversation = (await setConversationStatus(db, conversationRow.id, 'open')) ?? conversationRow;
      }
      const parsed = visitorMessageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const message = await createMessage(db, {
        conversation_id: conversation.id,
        author: 'visitor',
        body: parsed.data.body,
      });

      // AI-first: the CloudHost247 AI decision layer answers while nobody has taken the
      // conversation over. A visitor message in a human-owned conversation just lands — the
      // person reading it answers it.
      let aiHandling = conversation.ai_handling;
      if (conversation.ai_handling === 'ai') {
        try {
          // Feed the decision layer the same shape the AI support desk uses: the last few turns,
          // mapped to its author vocabulary, plus where the visitor is standing.
          const history = await listMessages(db, conversation.id, 0);
          const previousMessages = history.slice(-8).map((turn) => ({
            author_type: turn.author === 'visitor' ? 'CUSTOMER' : turn.author === 'ai' ? 'AI' : 'AGENT',
            body: turn.body,
          }));
          const decision = await decideSupportResponse(db, parsed.data.body, {
            previousMessages,
            currentPath: typeof request.headers['x-cloudhost-page'] === 'string' ? request.headers['x-cloudhost-page'] : null,
            // Configuring the website-builder model does not authorize sending support transcripts.
            allowModel: false,
          });
          await createMessage(db, {
            conversation_id: conversation.id,
            author: 'ai',
            author_name: 'CloudHost247 AI Support',
            body: decision.body.slice(0, 4000),
            links: (decision.links ?? []).slice(0, 5),
            followUps: (decision.followUps ?? []).slice(0, 4),
          });
          if (decision.kind === 'ESCALATE') {
            aiHandling = 'human';
            await setConversationHandling(db, conversation.id, 'human', new Date());
            await auditRequest(db, request, null, {
              action: 'WEB_CHAT_AI_ESCALATION',
              resourceType: 'web_chat_conversation',
              resourceId: conversation.id,
              metadata: { reason: decision.reason ?? 'OTHER', intent: decision.intent },
            });
            await notifyStaffOfEscalation(db, conversation, decision.reason ?? 'OTHER', parsed.data.body);
          }
        } catch {
          // The AI is down — fail closed into the human queue, never leave the visitor on silence,
          // and never pretend the AI answered when it did not.
          aiHandling = 'human';
          try {
            await createMessage(db, {
              conversation_id: conversation.id,
              author: 'ai',
              author_name: 'CloudHost247 AI Support',
              body: 'I could not process that just now, so I have passed this conversation to the CloudHost247 support team. A specialist will reply here as soon as one is available.',
            });
          } catch {
            // The visitor's own message is already stored — the handoff still happens.
          }
          await setConversationHandling(db, conversation.id, 'human', new Date());
          await auditRequest(db, request, null, {
            action: 'WEB_CHAT_AI_FAILURE_HANDOFF',
            resourceType: 'web_chat_conversation',
            resourceId: conversation.id,
          });
          await notifyStaffOfEscalation(db, conversation, 'AI_UNAVAILABLE', parsed.data.body);
        }
      }
      return { message: toMessageDto(message), aiHandling };
    },
  );

  // --- Staff: list conversations ----------------------------------------------

  app.get<{ Querystring: z.infer<typeof adminListQuerySchema> }>(
    '/api/v1/admin/web-chat/conversations',
    async (request, reply) => {
      await staffAuth(request, env, db);
      const parsed = adminListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const rows = await listConversationsForAdmin(db, {
        status: parsed.data.status,
        handling: parsed.data.handling,
        limit: parsed.data.limit,
      });
      return { conversations: rows.map(toAdminConversationDto) };
    },
  );

  // --- Staff: one conversation -------------------------------------------------

  app.get<{ Params: z.infer<typeof conversationIdParamSchema> }>(
    '/api/v1/admin/web-chat/conversations/:id',
    async (request, reply) => {
      await staffAuth(request, env, db);
      const paramsParsed = conversationIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const row = await getConversationById(db, paramsParsed.data.id);
      if (!row) throw new NotFoundError('Conversation not found');
      return { conversation: toConversationDto(row) };
    },
  );

  // --- Staff: delta-poll messages (marks the visitor side as read) ------------

  app.get<{ Params: z.infer<typeof conversationIdParamSchema>; Querystring: z.infer<typeof messagesQuerySchema> }>(
    '/api/v1/admin/web-chat/conversations/:id/messages',
    async (request, reply) => {
      await staffAuth(request, env, db);
      const paramsParsed = conversationIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const parsed = messagesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const row = await getConversationById(db, paramsParsed.data.id);
      if (!row) throw new NotFoundError('Conversation not found');
      const after = parsed.data.after ?? 0;
      // Only advance the read marker for a full-history fetch; delta polls carry everything
      // the staff client has already seen.
      if (after === 0) await markStaffRead(db, row.id);
      const messages = await listMessages(db, row.id, after);
      return {
        conversation: toConversationDto(row),
        messages: messages.map(toMessageDto),
      };
    },
  );

  // --- Staff: reply ------------------------------------------------------------

  app.post<{ Params: z.infer<typeof conversationIdParamSchema>; Body: z.infer<typeof adminMessageBodySchema> }>(
    '/api/v1/admin/web-chat/conversations/:id/messages',
    async (request, reply) => {
      const auth = await staffAuth(request, env, db);
      const paramsParsed = conversationIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const parsed = adminMessageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const row = await getConversationById(db, paramsParsed.data.id);
      if (!row) throw new NotFoundError('Conversation not found');
      if (row.status === 'closed') {
        reply.code(409);
        return {
          error: 'CONVERSATION_CLOSED',
          message: 'This conversation is closed. Reopen it before replying.',
        };
      }
      const user = await findUserById(db, auth.userId);
      const message = await createMessage(db, {
        conversation_id: row.id,
        author: 'staff',
        author_id: auth.userId,
        author_name: user?.full_name ?? auth.email,
        body: parsed.data.body,
      });
      // A human reply means a human owns it — stop the AI from answering over them. Leaves any
      // existing `escalated_at` stamp alone (that is provenance, not workflow state).
      if (row.ai_handling !== 'human') {
        await setConversationHandling(db, row.id, 'human');
      }
      return { message: toMessageDto(message) };
    },
  );

  // --- Staff: change who owns the conversation (AI <-> human) --------------------

  app.patch<{ Params: z.infer<typeof conversationIdParamSchema>; Body: z.infer<typeof handlingSchema> }>(
    '/api/v1/admin/web-chat/conversations/:id/handling',
    async (request, reply) => {
      const auth = await staffAuth(request, env, db);
      const paramsParsed = conversationIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const parsed = handlingSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const existing = await getConversationById(db, paramsParsed.data.id);
      if (!existing) throw new NotFoundError('Conversation not found');
      // 'ai' clears the escalation stamp: returning a conversation to the AI also forgives it.
      const row = await setConversationHandling(
        db,
        existing.id,
        parsed.data.handling,
        parsed.data.handling === 'ai' ? null : undefined,
      );
      if (!row) throw new NotFoundError('Conversation not found');
      await auditRequest(db, request, auth.userId, {
        action: 'WEB_CHAT_HANDLING_CHANGED',
        resourceType: 'web_chat_conversation',
        resourceId: row.id,
        metadata: { handling: parsed.data.handling },
      });
      return { conversation: toConversationDto(row) };
    },
  );

  // --- Staff: close / reopen ---------------------------------------------------

  app.patch<{ Params: z.infer<typeof conversationIdParamSchema> }>(
    '/api/v1/admin/web-chat/conversations/:id/close',
    async (request, reply) => {
      await staffAuth(request, env, db);
      const paramsParsed = conversationIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const row = await setConversationStatus(db, paramsParsed.data.id, 'closed');
      if (!row) throw new NotFoundError('Conversation not found');
      return { conversation: toConversationDto(row) };
    },
  );

  app.patch<{ Params: z.infer<typeof conversationIdParamSchema> }>(
    '/api/v1/admin/web-chat/conversations/:id/reopen',
    async (request, reply) => {
      await staffAuth(request, env, db);
      const paramsParsed = conversationIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const row = await setConversationStatus(db, paramsParsed.data.id, 'open');
      if (!row) throw new NotFoundError('Conversation not found');
      return { conversation: toConversationDto(row) };
    },
  );
}
