import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { randomUUID } from 'node:crypto';

/**
 * Exercises the live chat API (K03 — K Support) end-to-end against a real
 * embedded Postgres engine (pglite).
 *
 *   - Customers can create conversations, list their own, and send messages.
 *   - Customers cannot access other customers' conversations (404, not 403).
 *   - Staff can list all conversations and close any conversation.
 *
 * Every test inserts its own fixture users and conversations directly through
 * the database. Tokens are minted with `signAuthToken` using the test JWT_SECRET.
 */
describe('live chat API (K03)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'e'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUserAccount(
    email: string,
    role: 'customer' | 'staff' | 'admin' | 'super_admin',
    status: 'active' | 'suspended' | 'disabled' = 'active',
  ): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword('correct-horse-battery');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (lower(email)) DO UPDATE SET status = $6`,
      [userId, email, passwordHash, email.split('@')[0], role, status, email.split('@')[0]],
    );
    const token = signAuthToken(env, { sub: userId, role, email });
    return { userId, token: `Bearer ${token}` };
  }

  async function createConversation(
    customerId: string,
    subject: string,
    status: 'open' | 'closed' = 'open',
  ): Promise<string> {
    const conversationId = randomUUID();
    await db.query(
      `INSERT INTO live_chat_conversations (id, customer_id, subject, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [conversationId, customerId, subject, status],
    );
    return conversationId;
  }

  async function createMessage(
    conversationId: string,
    authorId: string,
    authorRole: string,
    body: string,
  ): Promise<string> {
    const messageId = randomUUID();
    await db.query(
      `INSERT INTO live_chat_messages (id, conversation_id, author_id, author_role, body, created_at)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [messageId, conversationId, authorId, authorRole, body],
    );
    return messageId;
  }

  it('customer can create a conversation', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('chat-customer@example.com', 'customer');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/live-chat/conversations',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'Billing question' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { conversation: { subject: string; status: string } };
    expect(body.conversation.subject).toBe('Billing question');
    expect(body.conversation.status).toBe('open');

    await app.close();
  });

  it('customer can list their own conversations', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('chat-list@example.com', 'customer');
    await createConversation(userId, 'First issue');
    await createConversation(userId, 'Second issue');
    const { userId: otherUserId } = await createUserAccount('chat-list-other@example.com', 'customer');
    await createConversation(otherUserId, 'Other customer issue');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/live-chat/conversations',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversations: Array<{ customer_id: string }> };
    expect(body.conversations.length).toBe(2);
    expect(body.conversations.every((c) => c.customer_id === userId)).toBe(true);

    await app.close();
  });

  it('staff can list all conversations', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('chat-staff@example.com', 'staff');
    const { userId: userA } = await createUserAccount('chat-user-a@example.com', 'customer');
    const { userId: userB } = await createUserAccount('chat-user-b@example.com', 'customer');
    await createConversation(userA, 'Issue A');
    await createConversation(userB, 'Issue B');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/live-chat/conversations',
      headers: { Authorization: staffToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversations: Array<{ subject: string }> };
    const subjects = body.conversations.map((c) => c.subject);
    expect(subjects).toContain('Issue A');
    expect(subjects).toContain('Issue B');

    await app.close();
  });

  it('customer can send a message in their conversation', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('chat-message@example.com', 'customer');
    const conversationId = await createConversation(userId, 'Chat thread');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/live-chat/conversations/${conversationId}/messages`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hello, I need help' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { message: { body: string; author_id: string } };
    expect(body.message.body).toBe('Hello, I need help');
    expect(body.message.author_id).toBe(userId);

    await app.close();
  });

  it('customer can list messages in their conversation', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('chat-msgs@example.com', 'customer');
    const conversationId = await createConversation(userId, 'Message thread');
    await createMessage(conversationId, userId, 'customer', 'First message');
    await createMessage(conversationId, userId, 'customer', 'Second message');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/live-chat/conversations/${conversationId}/messages`,
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { messages: Array<{ body: string }> };
    expect(body.messages.length).toBe(2);

    await app.close();
  });

  it('customer cannot access another customer conversation (404)', async () => {
    const app = buildTestApp();
    const { userId: userA, token: tokenA } = await createUserAccount('chat-user-a2@example.com', 'customer');
    const conversationId = await createConversation(userA, 'Private chat');

    const { userId: userB } = await createUserAccount('chat-user-b2@example.com', 'customer');
    const tokenB = `Bearer ${signAuthToken(env, { sub: userB, role: 'customer', email: 'chat-user-b2@example.com' })}`;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/live-chat/conversations/${conversationId}/messages`,
      headers: { Authorization: tokenB },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('staff can close any conversation', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('chat-staff-close@example.com', 'staff');
    const { userId } = await createUserAccount('chat-close-cust@example.com', 'customer');
    const conversationId = await createConversation(userId, 'To be closed');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/live-chat/conversations/${conversationId}/close`,
      headers: { Authorization: staffToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversation: { status: string } };
    expect(body.conversation.status).toBe('closed');

    await app.close();
  });

  it('customer cannot close a conversation (403)', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('chat-close-cust2@example.com', 'customer');
    const conversationId = await createConversation(userId, 'Customer tries close');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/live-chat/conversations/${conversationId}/close`,
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('returns 404 for sending a message to unknown conversation', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('chat-unknown@example.com', 'customer');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/live-chat/conversations/00000000-0000-0000-0000-000000000000/messages',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hello' }),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('rejects empty message body (400)', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('chat-empty@example.com', 'customer');
    const conversationId = await createConversation(userId, 'Empty body test');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/live-chat/conversations/${conversationId}/messages`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });
});
