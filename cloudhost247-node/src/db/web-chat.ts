/**
 * First-party anonymous visitor live chat — database access.
 *
 * The public website widget (SPA and the WHMCS theme) talks to the matching routes in
 * src/routes/web-chat.ts; staff use the admin routes and the Admin → Live Chat console.
 * No third-party chat provider is integrated — an honest internal service.
 *
 * AI-first handling: the AI support decision layer answers visitor messages while
 * `ai_handling = 'ai'`. A human owns the conversation — and the AI goes silent — once the AI
 * escalates, the visitor asks for a human, staff take it over, or staff reply.
 * `escalated_at` is stamped only for an AI/visitor-initiated handoff.
 *
 * Identity model: visitors hold an opaque random token issued by
 * `POST /api/v1/web-chat/session`. Only sha256(token) is persisted
 * (`web_chat_conversations.visitor_token_hash`); every visitor-scoped query goes through
 * that hash, so a leaked database cannot be used to impersonate a visitor.
 *
 * Delta polling: messages carry a monotonically increasing `seq` (IDENTITY column). Clients poll
 * `WHERE ... seq > $after`, which is immune to identical-timestamp messages. `after = 0` returns
 * the full history.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from './types';

export interface WebChatConversationRow {
  id: string;
  visitor_name: string | null;
  visitor_email: string | null;
  status: 'open' | 'closed';
  source: 'spa' | 'whmcs' | 'unknown';
  last_message_at: Date | null;
  ai_handling: 'ai' | 'human';
  escalated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface WebChatAnswerLink {
  label: string;
  url: string;
  kind?: string;
}

export interface WebChatMessageRow {
  id: string;
  seq: number;
  conversation_id: string;
  author: 'visitor' | 'staff' | 'ai';
  author_id: string | null;
  author_name: string | null;
  body: string;
  links: WebChatAnswerLink[];
  follow_ups: string[];
  created_at: Date;
}

export interface AdminConversationRow extends WebChatConversationRow {
  last_message_body: string | null;
  last_message_author: 'visitor' | 'staff' | 'ai' | null;
  message_count: number;
  unread_staff: number;
}

export function hashVisitorToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function mintVisitorToken(): string {
  return randomBytes(24).toString('base64url');
}

const CONVERSATION_COLUMNS =
  'id, visitor_name, visitor_email, status, source, last_message_at, ai_handling, escalated_at, created_at, updated_at';

const MESSAGE_COLUMNS =
  'id, seq, conversation_id, author, author_id, author_name, body, links, follow_ups, created_at';

export async function createConversation(
  db: Queryable,
  input: { tokenHash: string; visitorName: string | null; visitorEmail: string | null; source: 'spa' | 'whmcs' | 'unknown' },
): Promise<WebChatConversationRow> {
  const { rows } = await db.query<WebChatConversationRow>(
    `INSERT INTO web_chat_conversations (visitor_token_hash, visitor_name, visitor_email, source)
     VALUES ($1, $2, $3, $4)
     RETURNING ${CONVERSATION_COLUMNS}`,
    [input.tokenHash, input.visitorName, input.visitorEmail, input.source],
  );
  return rows[0]!;
}

export async function getConversationByTokenHash(
  db: Queryable,
  tokenHash: string,
): Promise<WebChatConversationRow | null> {
  const { rows } = await db.query<WebChatConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM web_chat_conversations WHERE visitor_token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function getConversationById(
  db: Queryable,
  id: string,
): Promise<WebChatConversationRow | null> {
  const { rows } = await db.query<WebChatConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM web_chat_conversations WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface AdminListFilters {
  status?: 'open' | 'closed';
  handling?: 'ai' | 'human';
  limit?: number;
}

export async function listConversationsForAdmin(
  db: Queryable,
  filters: AdminListFilters = {},
): Promise<AdminConversationRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (filters.handling) {
    params.push(filters.handling);
    conditions.push(`c.ai_handling = $${params.length}`);
  }
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
  params.push(limit);
  const { rows } = await db.query<AdminConversationRow>(
    `SELECT c.id, c.visitor_name, c.visitor_email, c.status, c.source, c.last_message_at,
            c.created_at, c.updated_at,
            c.ai_handling, c.escalated_at,
            lm.body AS last_message_body, lm.author AS last_message_author,
            (SELECT count(*)::int FROM web_chat_messages m WHERE m.conversation_id = c.id) AS message_count,
            (SELECT count(*)::int FROM web_chat_messages m
              WHERE m.conversation_id = c.id AND m.author = 'visitor'
                AND m.created_at > COALESCE(c.staff_read_at, 'epoch'::timestamptz)) AS unread_staff
     FROM web_chat_conversations c
     LEFT JOIN LATERAL (
       SELECT body, author FROM web_chat_messages m
       WHERE m.conversation_id = c.id ORDER BY m.seq DESC LIMIT 1
     ) lm ON true
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY (c.status = 'open') DESC, (c.ai_handling = 'human' AND c.escalated_at IS NOT NULL) DESC, COALESCE(c.last_message_at, c.created_at) DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function listMessages(
  db: Queryable,
  conversationId: string,
  afterSeq = 0,
): Promise<WebChatMessageRow[]> {
  const { rows } = await db.query<WebChatMessageRow>(
    `SELECT ${MESSAGE_COLUMNS} FROM web_chat_messages
     WHERE conversation_id = $1 AND seq > $2
     ORDER BY seq ASC`,
    [conversationId, afterSeq],
  );
  return rows;
}

export interface CreateMessageInput {
  conversation_id: string;
  author: 'visitor' | 'staff' | 'ai';
  author_id?: string | null;
  author_name?: string | null;
  body: string;
  links?: WebChatAnswerLink[];
  followUps?: string[];
}

export async function createMessage(
  db: Queryable,
  input: CreateMessageInput,
): Promise<WebChatMessageRow> {
  const { rows } = await db.query<WebChatMessageRow>(
    `INSERT INTO web_chat_messages (conversation_id, author, author_id, author_name, body, links, follow_ups)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     RETURNING ${MESSAGE_COLUMNS}`,
    [
      input.conversation_id,
      input.author,
      input.author_id ?? null,
      input.author_name ?? null,
      input.body,
      JSON.stringify(input.links ?? []),
      JSON.stringify(input.followUps ?? []),
    ],
  );
  const message = rows[0]!;
  await db.query(
    `UPDATE web_chat_conversations
     SET last_message_at = now(), updated_at = now()
     WHERE id = $1`,
    [input.conversation_id],
  );
  return message;
}

export async function setConversationStatus(
  db: Queryable,
  id: string,
  status: 'open' | 'closed',
): Promise<WebChatConversationRow | null> {
  const { rows } = await db.query<WebChatConversationRow>(
    `UPDATE web_chat_conversations
     SET status = $2, updated_at = now()
     WHERE id = $1
     RETURNING ${CONVERSATION_COLUMNS}`,
    [id, status],
  );
  return rows[0] ?? null;
}

/** Marks the visitor side as read by staff up to now — powers the console's unread badge. */
export async function markStaffRead(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE web_chat_conversations SET staff_read_at = now() WHERE id = $1`,
    [id],
  );
}

/**
 * Switches who owns the conversation. `escalatedAt` semantics:
 *   undefined — leave the existing stamp alone (staff replies and take-overs);
 *   null      — clear it (staff return the conversation to the AI);
 *   Date      — stamp a fresh handoff (the AI/visitor triggered it).
 */
export async function setConversationHandling(
  db: Queryable,
  id: string,
  handling: 'ai' | 'human',
  escalatedAt?: Date | null,
): Promise<WebChatConversationRow | null> {
  const keep = escalatedAt === undefined;
  const { rows } = await db.query<WebChatConversationRow>(
    `UPDATE web_chat_conversations
     SET ai_handling = $2,
         escalated_at = CASE WHEN $3 THEN escalated_at ELSE $4::timestamptz END,
         updated_at = now()
     WHERE id = $1
     RETURNING ${CONVERSATION_COLUMNS}`,
    [id, handling, keep, keep ? null : escalatedAt],
  );
  return rows[0] ?? null;
}
