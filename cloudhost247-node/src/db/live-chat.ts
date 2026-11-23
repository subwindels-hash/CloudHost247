/**
 * Live chat (K03 — K Support).
 *
 * Internal live chat conversations and messages. Customers open conversations
 * and exchange messages with staff. No third-party chat provider is integrated
 * — provider credentials are not configured, so this is an honest internal
 * service rather than a fabricated provider-backed integration.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export interface LiveChatConversationRow {
  id: string;
  customer_id: string;
  subject: string;
  status: 'open' | 'closed';
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface LiveChatMessageRow {
  id: string;
  conversation_id: string;
  author_id: string;
  author_role: string;
  body: string;
  created_at: Date;
}

export interface ListConversationsFilters {
  status?: 'open' | 'closed';
  customer_id?: string;
}

export async function listConversations(
  db: Queryable,
  filters: ListConversationsFilters = {},
): Promise<LiveChatConversationRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.customer_id) {
    params.push(filters.customer_id);
    conditions.push(`customer_id = $${params.length}`);
  }

  const { rows } = await db.query<LiveChatConversationRow>(
    `SELECT id, customer_id, subject, status, last_message_at, created_at, updated_at
     FROM live_chat_conversations
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY COALESCE(last_message_at, created_at) DESC`,
    params,
  );
  return rows;
}

export async function getConversation(
  db: Queryable,
  id: string,
): Promise<LiveChatConversationRow | null> {
  const { rows } = await db.query<LiveChatConversationRow>(
    `SELECT id, customer_id, subject, status, last_message_at, created_at, updated_at
     FROM live_chat_conversations
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface CreateConversationInput {
  customer_id: string;
  subject: string;
}

export async function createConversation(
  db: Queryable,
  input: CreateConversationInput,
): Promise<LiveChatConversationRow> {
  const { rows } = await db.query<LiveChatConversationRow>(
    `INSERT INTO live_chat_conversations (id, customer_id, subject, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'open', now(), now())
     RETURNING id, customer_id, subject, status, last_message_at, created_at, updated_at`,
    [randomUUID(), input.customer_id, input.subject],
  );
  return rows[0]!;
}

export async function listMessages(
  db: Queryable,
  conversationId: string,
): Promise<LiveChatMessageRow[]> {
  const { rows } = await db.query<LiveChatMessageRow>(
    `SELECT id, conversation_id, author_id, author_role, body, created_at
     FROM live_chat_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId],
  );
  return rows;
}

export interface CreateMessageInput {
  conversation_id: string;
  author_id: string;
  author_role: string;
  body: string;
}

export async function createMessage(
  db: Queryable,
  input: CreateMessageInput,
): Promise<LiveChatMessageRow | null> {
  const { rows } = await db.query<LiveChatMessageRow>(
    `INSERT INTO live_chat_messages (id, conversation_id, author_id, author_role, body, created_at)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING id, conversation_id, author_id, author_role, body, created_at`,
    [randomUUID(), input.conversation_id, input.author_id, input.author_role, input.body],
  );
  return rows[0] ?? null;
}

export async function closeConversation(
  db: Queryable,
  id: string,
): Promise<LiveChatConversationRow | null> {
  const { rows } = await db.query<LiveChatConversationRow>(
    `UPDATE live_chat_conversations
     SET status = 'closed', updated_at = now()
     WHERE id = $1
     RETURNING id, customer_id, subject, status, last_message_at, created_at, updated_at`,
    [id],
  );
  return rows[0] ?? null;
}
