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
 * Exercises the SPF/DKIM/DMARC email authentication API (G05) end-to-end against a real
 * embedded Postgres engine (pglite).
 *
 *   - Customers can create auth config (generates DKIM keys), list, get, update and delete
 *     their own.
 *   - DKIM private key is returned only at creation; subsequent reads omit it.
 *   - Customers cannot access other customers' auth (404, not 403).
 *   - Staff can list/view/update/delete any customer's config.
 *
 * Every test inserts its own fixture users directly through the database. Tokens are minted
 * with `signAuthToken` using the test JWT_SECRET.
 */
describe('email authentication API (G05)', () => {
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

  it('customer can create, list, get, update and delete email authentication', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('auth-customer@example.com', 'customer');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/email/authentication',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain_name: 'customer.example',
      }),
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      email_authentication: { id: string; dkim_private_key: string | null; dkim_public_key: string };
      dkim_txt_record: string;
    };
    expect(body.email_authentication.id).toBeDefined();
    expect(body.email_authentication.dkim_private_key).toBeTruthy();
    expect(body.email_authentication.dkim_public_key).toBeTruthy();
    expect(body.dkim_txt_record).toContain('v=DKIM1');
    expect(body.dkim_txt_record).toContain('k=rsa');
    const { id } = body.email_authentication;

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/email/authentication',
      headers: { Authorization: token },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { email_authentication: unknown[] }).email_authentication.length).toBeGreaterThanOrEqual(1);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/email/authentication/${id}`,
      headers: { Authorization: token },
    });
    expect(get.statusCode).toBe(200);
    const getBody = get.json() as { email_authentication: { dkim_private_key: string | null; dkim_public_key: string } };
    // Private key is NOT returned on subsequent reads.
    expect(getBody.email_authentication.dkim_private_key).toBeNull();
    expect(getBody.email_authentication.dkim_public_key).toBeTruthy();

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/email/authentication/${id}`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    });
    expect(updated.statusCode).toBe(200);
    const updBody = updated.json() as { email_authentication: { status: string } };
    expect(updBody.email_authentication.status).toBe('disabled');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/email/authentication/${id}`,
      headers: { Authorization: token },
    });
    expect(removed.statusCode).toBe(204);

    await app.close();
  });

  it('customer cannot access another customer auth config (404)', async () => {
    const app = buildTestApp();
    const { userId: userA, token: tokenA } = await createUserAccount('auth-user-a@example.com', 'customer');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/email/authentication',
      headers: { Authorization: tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_name: 'a.example' }),
    });
    expect(created.statusCode).toBe(201);
    const { id } = (created.json() as { email_authentication: { id: string } }).email_authentication;

    // User B tries to read User A's auth config — gets 404.
    const { userId: userB } = await createUserAccount('auth-user-b@example.com', 'customer');
    const tokenB = `Bearer ${signAuthToken(env, { sub: userB, role: 'customer', email: 'auth-user-b@example.com' })}`;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/email/authentication/${id}`,
      headers: { Authorization: tokenB },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('staff can list any customer auth configs via user_id', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('auth-staff@example.com', 'staff');
    const { userId: userA } = await createUserAccount('auth-staff-user-a@example.com', 'customer');

    await db.query(
      `INSERT INTO email_authentication (id, user_id, domain_name, dkim_selector, dkim_public_key, dkim_private_key, spf_record, dmarc_record, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), userA, 'staff-a.example', 'default', 'public-key', 'private-key', 'v=spf1 mx -all', null, 'active']
    );

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/email/authentication?user_id=${userA}`,
      headers: { Authorization: staffToken },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { email_authentication: unknown[] }).email_authentication.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('rejects invalid domain names', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('auth-invalid@example.com', 'customer');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/email/authentication',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_name: 'not a domain' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 404 for a missing auth config', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('auth-missing@example.com', 'customer');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/email/authentication/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
