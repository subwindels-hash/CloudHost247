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
 * Exercises the email forwarding API (G06) end-to-end against a real embedded
 * Postgres engine (pglite).
 *
 *   - Customers can create, list, get, update and delete their own forwarders.
 *   - Customers cannot access other customers' forwarders (404, not 403 — tenant isolation
     never confirms another customer's forwarder exists).
 *   - Staff can list, view, update and delete any forwarder (including via ?user_id=).
 *
 * Every test inserts its own fixture users directly through the database. Tokens are minted
 * with `signAuthToken` using the test JWT_SECRET.
 */
describe('email forwarders API (G06)', () => {
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
    status: 'active' | 'suspended' | 'disabled' = 'active'
  ): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword('correct-horse-battery');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (lower(email)) DO UPDATE SET status = $6`,
      [userId, email, passwordHash, email.split('@')[0], role, status, email.split('@')[0]]
    );
    const token = signAuthToken(env, { sub: userId, role, email });
    return { userId, token: `Bearer ${token}` };
  }

  it('customer can create, list, get, update and delete their own forwarder', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('forwarder-customer@example.com', 'customer');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/email/forwarders',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        local_address: 'support@customer.example',
        destination_address: 'support-team@customer.example',
      }),
    });
    expect(created.statusCode).toBe(201);
    const { id } = (created.json() as { email_forwarder: { id: string } }).email_forwarder;

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/email/forwarders',
      headers: { Authorization: token },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { email_forwarders: unknown[] }).email_forwarders.length).toBeGreaterThanOrEqual(1);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/email/forwarders/${id}`,
      headers: { Authorization: token },
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { email_forwarder: { local_address: string } }).email_forwarder.local_address).toBe('support@customer.example');

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/email/forwarders/${id}`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_address: 'help@customer.example', status: 'disabled' }),
    });
    expect(updated.statusCode).toBe(200);
    const body = updated.json() as { email_forwarder: { destination_address: string; status: string } };
    expect(body.email_forwarder.destination_address).toBe('help@customer.example');
    expect(body.email_forwarder.status).toBe('disabled');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/email/forwarders/${id}`,
      headers: { Authorization: token },
    });
    expect(removed.statusCode).toBe(204);

    await app.close();
  });

  it('customer cannot access another customer forwarder (404)', async () => {
    const app = buildTestApp();
    const { userId: userA, token: tokenA } = await createUserAccount('forwarder-user-a@example.com', 'customer');
    const { userId: userB } = await createUserAccount('forwarder-user-b@example.com', 'customer');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/email/forwarders',
      headers: { Authorization: tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        local_address: 'support@a.example',
        destination_address: 'team@a.example',
      }),
    });
    expect(created.statusCode).toBe(201);
    const { id } = (created.json() as { email_forwarder: { id: string } }).email_forwarder;

    // User B tries to read User A's forwarder — gets 404, not 403 (tenant isolation).
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/email/forwarders/${id}`,
      headers: { Authorization: `Bearer ${signAuthToken(env, { sub: userB, role: 'customer', email: 'forwarder-user-b@example.com' })}` },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('staff can list any customer forwarders via user_id', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('forwarder-staff@example.com', 'staff');
    const { userId: userA } = await createUserAccount('forwarder-staff-user-a@example.com', 'customer');

    // Create a forwarder for user A directly through the DB.
    await db.query(
      `INSERT INTO email_forwarders (id, user_id, local_address, destination_address, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), userA, 'support@staff-a.example', 'team@staff-a.example', 'active']
    );

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/email/forwarders?user_id=${userA}`,
      headers: { Authorization: staffToken },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { email_forwarders: unknown[] }).email_forwarders.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('rejects invalid email addresses', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('forwarder-invalid@example.com', 'customer');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/email/forwarders',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        local_address: 'not-an-email',
        destination_address: 'team@example.com',
      }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 404 for a missing forwarder', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('forwarder-missing@example.com', 'customer');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/email/forwarders/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
