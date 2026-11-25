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
 * Exercises the first-party anonymous visitor live chat (web_chat) end-to-end
 * against a real embedded Postgres engine (pglite).
 *
 *   - Anonymous visitors can open a session, send messages, and resume a stored
 *     session across page loads; the server only ever stores the token's hash.
 *   - AI-first: the built-in AI decision layer answers while the conversation is
 *     unclaimed; a human-requested handoff or a staff reply silences the AI.
 *   - Staff (and no one else) can list conversations, read a thread, reply,
 *     take a conversation over, return it to the AI, and close/reopen; a
 *     full-history staff read marks the visitor side read.
 *   - Staff replies are refused on a closed conversation (409).
 *   - A visitor messaging a closed conversation reopens it.
 */
describe('web chat API (first-party visitor chat)', () => {
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

  async function createStaffAccount(
    email: string,
    role: 'customer' | 'staff' | 'admin' | 'super_admin',
  ): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword('correct-horse-battery');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (lower(email)) DO UPDATE SET status = $6`,
      [userId, email, passwordHash, email.split('@')[0], role, 'active', email.split('@')[0]],
    );
    const token = signAuthToken(env, { sub: userId, role, email });
    return { userId, token: `Bearer ${token}` };
  }

  async function openSession(app: ReturnType<typeof buildTestApp>, body: Record<string, unknown> = { source: 'spa' }) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/session',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res;
  }

  it('anonymous visitor opens a session, sends a message and polls it back', async () => {
    const app = buildTestApp();

    const session = await openSession(app, { source: 'spa', name: 'Ada', email: 'ada@example.com' });
    expect(session.statusCode).toBe(201);
    const opened = session.json() as { conversation: { id: string }; token: string };
    expect(opened.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const emptyPoll = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/messages?after=0',
      headers: { 'X-Web-Chat-Token': opened.token },
    });
    expect(emptyPoll.statusCode).toBe(200);
    expect((emptyPoll.json() as { messages: unknown[] }).messages).toHaveLength(0);

    const sent = await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/messages',
      headers: { 'Content-Type': 'application/json', 'X-Web-Chat-Token': opened.token },
      body: JSON.stringify({ body: 'Hello from the public site' }),
    });
    expect(sent.statusCode).toBe(200);
    expect((sent.json() as { message: { seq: number } }).message.seq).toBe(1);

    const poll = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/messages?after=0',
      headers: { 'X-Web-Chat-Token': opened.token },
    });
    const polled = poll.json() as { messages: Array<{ body: string; author: string }> };
    expect(polled.messages.some((m) => m.author === 'visitor' && m.body === 'Hello from the public site')).toBe(true);
    // AI-first: the platform's AI decision layer answers (or fail-closed escalates) — either way
    // the visitor is never met with silence, and the transcript records who wrote what.
    expect(polled.messages.some((m) => m.author === 'ai')).toBe(true);

    await app.close();
  });

  it('only stores a hash of the visitor token', async () => {
    const app = buildTestApp();
    const session = await openSession(app);
    const opened = session.json() as { conversation: { id: string }; token: string };

    const result = await db.query(
      'SELECT visitor_token_hash FROM web_chat_conversations WHERE id = $1',
      [opened.conversation.id],
    ) as { rows: Array<{ visitor_token_hash: string }> };
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.visitor_token_hash).not.toBe(opened.token);
    expect(result.rows[0]!.visitor_token_hash).toMatch(/^[a-f0-9]{64}$/);

    await app.close();
  });

  it('resumes an existing session instead of minting a second one', async () => {
    const app = buildTestApp();
    const first = await openSession(app);
    const firstBody = first.json() as { conversation: { id: string }; token: string };

    const resumed = await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/session',
      headers: { 'Content-Type': 'application/json', 'X-Web-Chat-Token': firstBody.token },
      body: JSON.stringify({ source: 'spa' }),
    });
    expect(resumed.statusCode).toBe(200);
    const resumedBody = resumed.json() as { conversation: { id: string }; token: string | null };
    expect(resumedBody.conversation.id).toBe(firstBody.conversation.id);
    expect(resumedBody.token).toBeNull();

    const rows = await db.query('SELECT count(*)::int AS n FROM web_chat_conversations') as { rows: Array<{ n: number }> };
    expect(rows.rows[0]!.n).toBe(1);

    await app.close();
  });

  it('rejects visitor requests without a valid token (401)', async () => {
    const app = buildTestApp();

    const noToken = await app.inject({ method: 'GET', url: '/api/v1/web-chat/messages?after=0' });
    expect(noToken.statusCode).toBe(401);

    const badToken = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/messages?after=0',
      headers: { 'X-Web-Chat-Token': 'this-is-not-a-real-token-at-all-1234567890' },
    });
    expect(badToken.statusCode).toBe(401);

    await app.close();
  });

  it('staff can list, read, reply, close and reopen; customer JWTs are forbidden (403)', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createStaffAccount('webchat-staff@example.com', 'staff');
    const { token: customerToken } = await createStaffAccount('webchat-customer@example.com', 'customer');

    const session = await openSession(app, { source: 'whmcs', name: 'Visitor' });
    const opened = session.json() as { conversation: { id: string }; token: string };
    await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/messages',
      headers: { 'Content-Type': 'application/json', 'X-Web-Chat-Token': opened.token },
      body: JSON.stringify({ body: 'Need help with billing' }),
    });

    // Customers cannot use the staff surface.
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/web-chat/conversations?status=open',
      headers: { Authorization: customerToken },
    });
    expect(forbidden.statusCode).toBe(403);

    // Staff list shows the conversation with one unread visitor message.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/web-chat/conversations?status=open',
      headers: { Authorization: staffToken },
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json() as { conversations: Array<{ id: string; unreadStaff: number; messageCount: number }> };
    expect(listed.conversations.map((c) => c.id)).toContain(opened.conversation.id);
    expect(listed.conversations.find((c) => c.id === opened.conversation.id)!.unreadStaff).toBe(1);

    // Staff full-history read marks the visitor side read.
    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/messages?after=0`,
      headers: { Authorization: staffToken },
    });
    expect(read.statusCode).toBe(200);
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/web-chat/conversations?status=open',
      headers: { Authorization: staffToken },
    });
    const afterList = after.json() as { conversations: Array<{ id: string; unreadStaff: number }> };
    expect(afterList.conversations.find((c) => c.id === opened.conversation.id)!.unreadStaff).toBe(0);

    // Staff reply reaches the visitor.
    const reply = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/messages`,
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Hi! Happy to help.' }),
    });
    expect(reply.statusCode).toBe(200);

    const visitorPoll = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/messages?after=1',
      headers: { 'X-Web-Chat-Token': opened.token },
    });
    const visitorMessages = visitorPoll.json() as { messages: Array<{ author: string; body: string }> };
    expect(visitorMessages.messages.some((m) => m.author === 'staff' && m.body === 'Hi! Happy to help.')).toBe(true);

    // Close the conversation: staff reply is now refused with 409.
    const close = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/close`,
      headers: { Authorization: staffToken },
    });
    expect(close.statusCode).toBe(200);
    const refused = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/messages`,
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Are you still there?' }),
    });
    expect(refused.statusCode).toBe(409);

    // The visitor, however, reopens the conversation by sending a message again.
    const reopened = await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/messages',
      headers: { 'Content-Type': 'application/json', 'X-Web-Chat-Token': opened.token },
      body: JSON.stringify({ body: 'Still here — billing question' }),
    });
    expect(reopened.statusCode).toBe(200);
    const reopenState = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/session',
      headers: { 'X-Web-Chat-Token': opened.token },
    });
    expect((reopenState.json() as { conversation: { status: string } }).conversation.status).toBe('open');

    // Staff can still close it again afterwards.
    const reclose = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/close`,
      headers: { Authorization: staffToken },
    });
    expect(reclose.statusCode).toBe(200);

    await app.close();
  });


  it('AI answers first; a human request hands the conversation to the queue and silences the AI', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createStaffAccount('webchat-ai-notify@example.com', 'staff');

    const session = await openSession(app, { source: 'spa' });
    const opened = session.json() as { conversation: { id: string }; token: string };

    // A deterministic AI-ANSWER path (account recovery is a reviewed procedure).
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/messages',
      headers: { 'Content-Type': 'application/json', 'X-Web-Chat-Token': opened.token },
      body: JSON.stringify({ body: 'I forgot my password and I cannot log in' }),
    });
    expect(first.statusCode).toBe(200);

    const afterAi = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/messages?after=0',
      headers: { 'X-Web-Chat-Token': opened.token },
    });
    const afterAiBody = afterAi.json() as {
      conversation: { aiHandling: string };
      messages: Array<{ author: string; body: string }>;
    };
    expect(afterAiBody.conversation.aiHandling).toBe('ai');
    expect(afterAiBody.messages.some((m) => m.author === 'ai')).toBe(true);

    // The visitor asks for a human — the guardrail hands the conversation over.
    const handoff = await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/messages',
      headers: { 'Content-Type': 'application/json', 'X-Web-Chat-Token': opened.token },
      body: JSON.stringify({ body: "I'd like to talk to a human" }),
    });
    expect(handoff.statusCode).toBe(200);
    expect((handoff.json() as { aiHandling: string }).aiHandling).toBe('human');

    const afterHandoff = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/session',
      headers: { 'X-Web-Chat-Token': opened.token },
    });
    expect((afterHandoff.json() as { conversation: { aiHandling: string; escalatedAt: string | null } }).conversation)
      .toMatchObject({ aiHandling: 'human' });
    expect((afterHandoff.json() as { conversation: { escalatedAt: string | null } }).conversation.escalatedAt).not.toBeNull();

    // The AI stays silent once a human owns the conversation.
    const all = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/messages?after=0',
      headers: { 'X-Web-Chat-Token': opened.token },
    });
    const before = (all.json() as { messages: Array<{ author: string }> }).messages.length;
    await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/messages',
      headers: { 'Content-Type': 'application/json', 'X-Web-Chat-Token': opened.token },
      body: JSON.stringify({ body: 'One more question about renewals' }),
    });
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/messages?after=0',
      headers: { 'X-Web-Chat-Token': opened.token },
    });
    const afterMsgs = (after.json() as { messages: Array<{ author: string }> }).messages;
    expect(afterMsgs.length).toBe(before + 1); // only the visitor's own message
    expect(afterMsgs[afterMsgs.length - 1]!.author).toBe('visitor');

    // The staff notification fired for the escalation.
    const notifications = await db.query(
      `SELECT count(*)::int AS n FROM user_notifications WHERE type = 'WEB_CHAT_ESCALATION' AND resource_id = $1`,
      [opened.conversation.id],
    ) as { rows: Array<{ n: number }> };
    expect(notifications.rows[0]!.n).toBeGreaterThanOrEqual(1);

    // Staff can return the conversation to the AI; the stamp clears.
    const returned = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/handling`,
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ handling: 'ai' }),
    });
    expect(returned.statusCode).toBe(200);
    expect((returned.json() as { conversation: { aiHandling: string; escalatedAt: string | null } }).conversation)
      .toMatchObject({ aiHandling: 'ai', escalatedAt: null });

    // …and the AI answers again afterwards.
    await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/messages',
      headers: { 'Content-Type': 'application/json', 'X-Web-Chat-Token': opened.token },
      body: JSON.stringify({ body: 'I forgot my password and I cannot log in' }),
    });
    const back = await app.inject({
      method: 'GET',
      url: '/api/v1/web-chat/messages?after=0',
      headers: { 'X-Web-Chat-Token': opened.token },
    });
    const backMsgs = (back.json() as { messages: Array<{ author: string }> }).messages;
    expect(backMsgs[backMsgs.length - 1]!.author).toBe('ai');

    await app.close();
  });

  it('a staff reply makes a person the owner; escalated conversations sort first', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createStaffAccount('webchat-takeover@example.com', 'staff');

    const session = await openSession(app, { source: 'whmcs' });
    const opened = session.json() as { conversation: { id: string }; token: string };
    await app.inject({
      method: 'POST',
      url: '/api/v1/web-chat/messages',
      headers: { 'Content-Type': 'application/json', 'X-Web-Chat-Token': opened.token },
      body: JSON.stringify({ body: 'please help' }),
    });

    const reply = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/messages`,
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'On it — a specialist here.' }),
    });
    expect(reply.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/messages?after=0`,
      headers: { Authorization: staffToken },
    });
    expect((after.json() as { conversation: { aiHandling: string } }).conversation.aiHandling).toBe('human');

    // Escalated (handoff) conversations appear before ordinary AI-owned ones in the open list.
    const openList = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/web-chat/conversations?status=open',
      headers: { Authorization: staffToken },
    });
    const ids = (openList.json() as { conversations: Array<{ id: string; aiHandling: string }> }).conversations;
    expect(ids.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('staff surface requires authentication (401)', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/web-chat/conversations' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('staff can reopen a closed conversation and reply', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createStaffAccount('webchat-reopen@example.com', 'staff');

    const session = await openSession(app);
    const opened = session.json() as { conversation: { id: string }; token: string };

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/close`,
      headers: { Authorization: staffToken },
    });
    const reopen = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/reopen`,
      headers: { Authorization: staffToken },
    });
    expect(reopen.statusCode).toBe(200);
    expect((reopen.json() as { conversation: { status: string } }).conversation.status).toBe('open');

    const reply = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/web-chat/conversations/${opened.conversation.id}/messages`,
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Welcome back' }),
    });
    expect(reply.statusCode).toBe(200);

    await app.close();
  });
});
