import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { createCustomerService } from '../../src/db/customer-services';
import { createCustomerDomain } from '../../src/db/customer-domains';

/**
 * Exercises the self-service Phase 4 "Customer App" API (/api/v1/account/...) end-to-end against
 * a real embedded Postgres engine — not mocks. Covers ownership isolation (a customer can never
 * read/act on another customer's data), the real password-change session-invalidation mechanism,
 * and that services/domains remain read-only for customers (informational only, not self-service
 * ordering).
 */
describe('self-service account API (/api/v1/account)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
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

  async function createCustomer(email: string, password = 'correct-horse-battery'): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword(password);
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'customer')`, [
      userId,
      email,
      passwordHash,
      'Test Customer',
    ]);
    const token = signAuthToken(env, { sub: userId, role: 'customer', email });
    return { userId, token };
  }

  it('rejects every account route when unauthenticated', async () => {
    const app = buildTestApp();
    const routes: Array<{ method: 'GET' | 'PATCH' | 'POST'; url: string }> = [
      { method: 'PATCH', url: '/api/v1/account/profile' },
      { method: 'POST', url: '/api/v1/account/password' },
      { method: 'GET', url: '/api/v1/account/services' },
      { method: 'GET', url: '/api/v1/account/domains' },
      { method: 'GET', url: '/api/v1/account/tickets' },
      { method: 'POST', url: '/api/v1/account/tickets' },
    ];
    for (const route of routes) {
      const res = await app.inject({ method: route.method, url: route.url, payload: {} });
      expect(res.statusCode).toBe(401);
    }
    await app.close();
  });

  it('updates and persists the profile full name', async () => {
    const { token } = await createCustomer('alice@example.com');
    const app = buildTestApp();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/account/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { fullName: 'Alice Updated' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.fullName).toBe('Alice Updated');

    const { rows } = await db.query<{ full_name: string }>('SELECT full_name FROM users WHERE email = $1', ['alice@example.com']);
    expect(rows[0]?.full_name).toBe('Alice Updated');
    await app.close();
  });

  it('rejects a password change with the wrong current password, and does not touch the hash', async () => {
    const { token } = await createCustomer('bob@example.com', 'correct-horse-battery');
    const app = buildTestApp();

    const before = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = $1', ['bob@example.com']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'totally-wrong', newPassword: 'brand-new-password-1' },
    });
    // 400 (ValidationError), not 401: the caller's bearer token is fine, only the submitted
    // currentPassword field is wrong. Using 401 here was a real bug — the frontend's global
    // "401 while holding a token means the token itself is bad" handling (frontend/src/lib/api.ts)
    // would otherwise silently log a customer out of the whole app for simply mistyping their
    // current password. See src/routes/account.ts and frontend/tests/unit/account-page.test.tsx.
    expect(res.statusCode).toBe(400);

    const after = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = $1', ['bob@example.com']);
    expect(after.rows[0]?.password_hash).toBe(before.rows[0]?.password_hash);
    await app.close();
  });

  it('changing the password invalidates every token issued before the change, and a freshly-issued token keeps working', async () => {
    const { userId, token: oldToken } = await createCustomer('carol@example.com', 'correct-horse-battery');
    const app = buildTestApp();

    // The old token works before the change.
    const before = await app.inject({ method: 'GET', url: '/api/v1/account/services', headers: { authorization: `Bearer ${oldToken}` } });
    expect(before.statusCode).toBe(200);

    // The monotonic auth session version changes inside the same password-update SQL statement,
    // so even a change in the exact same JWT iat second invalidates the old session.
    const change = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password',
      headers: { authorization: `Bearer ${oldToken}` },
      payload: { currentPassword: 'correct-horse-battery', newPassword: 'a-brand-new-password-2' },
    });
    expect(change.statusCode).toBe(204);

    // The very same old token (still cryptographically valid, not expired, not logged out via
    // /api/auth/logout) must now be rejected by the changed session generation, not jti revocation.
    const afterWithOldToken = await app.inject({
      method: 'GET',
      url: '/api/v1/account/services',
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(afterWithOldToken.statusCode).toBe(401);

    // A freshly-issued token for the new session generation (simulating a real re-login with the
    // new password) must work immediately; there is no timestamp boundary to wait for.
    const newToken = signAuthToken(env, { sub: userId, role: 'customer', email: 'carol@example.com', sv: 1 });
    const afterWithNewToken = await app.inject({
      method: 'GET',
      url: '/api/v1/account/services',
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(afterWithNewToken.statusCode).toBe(200);
    await app.close();
  });

  it('lists only the caller\'s own services and domains, never another customer\'s', async () => {
    const alice = await createCustomer('alice2@example.com');
    const bob = await createCustomer('bob2@example.com');
    await createCustomerService(db, { id: randomUUID(), userId: alice.userId, label: 'Alice service', createdBy: alice.userId });
    await createCustomerDomain(db, { id: randomUUID(), userId: bob.userId, domainName: 'bobs-domain.com', createdBy: bob.userId });

    const app = buildTestApp();

    const aliceServices = await app.inject({ method: 'GET', url: '/api/v1/account/services', headers: { authorization: `Bearer ${alice.token}` } });
    expect(aliceServices.json().services).toHaveLength(1);
    expect(aliceServices.json().services[0].label).toBe('Alice service');

    const aliceDomains = await app.inject({ method: 'GET', url: '/api/v1/account/domains', headers: { authorization: `Bearer ${alice.token}` } });
    expect(aliceDomains.json().domains).toHaveLength(0); // Alice must never see Bob's domain

    const bobServices = await app.inject({ method: 'GET', url: '/api/v1/account/services', headers: { authorization: `Bearer ${bob.token}` } });
    expect(bobServices.json().services).toHaveLength(0);
    await app.close();
  });

  it('cannot create or modify a service/domain record via any self-service route (informational, staff-entered only)', async () => {
    const { token } = await createCustomer('dana@example.com');
    const app = buildTestApp();

    const postService = await app.inject({
      method: 'POST',
      url: '/api/v1/account/services',
      headers: { authorization: `Bearer ${token}` },
      payload: { label: 'Self-service attempt' },
    });
    expect([404, 405]).toContain(postService.statusCode); // no such route exists at all
    await app.close();
  });

  it('opens a ticket, replies to it, and rejects access to another customer\'s ticket with 404 (not 403)', async () => {
    const alice = await createCustomer('alice3@example.com');
    const bob = await createCustomer('bob3@example.com');
    const app = buildTestApp();

    const opened = await app.inject({
      method: 'POST',
      url: '/api/v1/account/tickets',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { subject: 'Help please', message: 'Something is wrong.' },
    });
    expect(opened.statusCode).toBe(201);
    const ticketId = opened.json().ticket.id;

    // Alice can read/reply to her own ticket.
    const aliceGet = await app.inject({ method: 'GET', url: `/api/v1/account/tickets/${ticketId}`, headers: { authorization: `Bearer ${alice.token}` } });
    expect(aliceGet.statusCode).toBe(200);
    expect(aliceGet.json().ticket.messages).toHaveLength(1);

    const aliceReply = await app.inject({
      method: 'POST',
      url: `/api/v1/account/tickets/${ticketId}/messages`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { message: 'Following up.' },
    });
    expect(aliceReply.statusCode).toBe(201);
    expect(aliceReply.json().ticket.messages).toHaveLength(2);

    // Bob must get 404 (never 403 — no confirmation the ticket even exists) on both read and reply.
    const bobGet = await app.inject({ method: 'GET', url: `/api/v1/account/tickets/${ticketId}`, headers: { authorization: `Bearer ${bob.token}` } });
    expect(bobGet.statusCode).toBe(404);

    const bobReply = await app.inject({
      method: 'POST',
      url: `/api/v1/account/tickets/${ticketId}/messages`,
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { message: 'Sneaky reply attempt' },
    });
    expect(bobReply.statusCode).toBe(404);

    // Bob's attempted reply must never have been persisted against Alice's ticket.
    const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM support_ticket_messages WHERE ticket_id = $1', [ticketId]);
    expect(rows[0]?.count).toBe('2');
    await app.close();
  });

  it('a malformed ticket id returns 400, a well-formed but nonexistent one returns 404', async () => {
    const { token } = await createCustomer('erin@example.com');
    const app = buildTestApp();

    const malformed = await app.inject({ method: 'GET', url: '/api/v1/account/tickets/not-a-uuid', headers: { authorization: `Bearer ${token}` } });
    expect(malformed.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/account/tickets/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
