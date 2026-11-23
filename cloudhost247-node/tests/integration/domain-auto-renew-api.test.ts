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
 * Exercises the automatic renewal controls API (I12) end-to-end against a real embedded
 * Postgres engine (pglite).
 *
 *   - Customers can get and toggle auto-renew for their own domains.
 *   - Customers cannot access other customers' domains (404, not 403).
 *   - Staff can get and toggle auto-renew for any domain.
 *
 * Every test inserts its own fixture users and domains directly through the database.
 * Tokens are minted with `signAuthToken` using the test JWT_SECRET.
 */
describe('domain auto-renew API (I12)', () => {
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

  async function createCustomerDomain(userId: string, domainName: string): Promise<string> {
    const domainId = randomUUID();
    await db.query(
      `INSERT INTO customer_domains (id, user_id, domain_name, status, auto_renew)
       VALUES ($1, $2, $3, 'active', false)`,
      [domainId, userId, domainName]
    );
    return domainId;
  }

  it('customer can get and toggle auto-renew for their own domain', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('autorenew-customer@example.com', 'customer');
    const domainId = await createCustomerDomain(userId, 'autorenew.example');

    // Initial state: auto_renew is false
    const getInitial = await app.inject({
      method: 'GET',
      url: `/api/v1/domains/${domainId}/auto-renew`,
      headers: { Authorization: token },
    });
    expect(getInitial.statusCode).toBe(200);
    expect((getInitial.json() as { domain_auto_renew: { auto_renew: boolean } }).domain_auto_renew.auto_renew).toBe(false);

    // Enable auto-renew
    const enable = await app.inject({
      method: 'PATCH',
      url: `/api/v1/domains/${domainId}/auto-renew`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_renew: true }),
    });
    expect(enable.statusCode).toBe(200);
    expect((enable.json() as { domain_auto_renew: { auto_renew: boolean } }).domain_auto_renew.auto_renew).toBe(true);

    // Verify it persisted
    const getAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/domains/${domainId}/auto-renew`,
      headers: { Authorization: token },
    });
    expect(getAfter.statusCode).toBe(200);
    expect((getAfter.json() as { domain_auto_renew: { auto_renew: boolean } }).domain_auto_renew.auto_renew).toBe(true);

    // Disable auto-renew
    const disable = await app.inject({
      method: 'PATCH',
      url: `/api/v1/domains/${domainId}/auto-renew`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_renew: false }),
    });
    expect(disable.statusCode).toBe(200);
    expect((disable.json() as { domain_auto_renew: { auto_renew: boolean } }).domain_auto_renew.auto_renew).toBe(false);

    await app.close();
  });

  it('customer cannot access another customer domain auto-renew (404)', async () => {
    const app = buildTestApp();
    const { userId: userA, token: tokenA } = await createUserAccount('autorenew-user-a@example.com', 'customer');
    const domainId = await createCustomerDomain(userA, 'a.example');

    // User B tries to read User A's domain auto-renew — gets 404.
    const { userId: userB } = await createUserAccount('autorenew-user-b@example.com', 'customer');
    const tokenB = `Bearer ${signAuthToken(env, { sub: userB, role: 'customer', email: 'autorenew-user-b@example.com' })}`;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/domains/${domainId}/auto-renew`,
      headers: { Authorization: tokenB },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('staff can get and toggle any customer domain auto-renew', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('autorenew-staff@example.com', 'staff');
    const { userId: userA } = await createUserAccount('autorenew-staff-user-a@example.com', 'customer');
    const domainId = await createCustomerDomain(userA, 'staff-a.example');

    // Staff can read
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/domains/${domainId}/auto-renew`,
      headers: { Authorization: staffToken },
    });
    expect(get.statusCode).toBe(200);

    // Staff can toggle
    const toggle = await app.inject({
      method: 'PATCH',
      url: `/api/v1/domains/${domainId}/auto-renew`,
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_renew: true }),
    });
    expect(toggle.statusCode).toBe(200);
    expect((toggle.json() as { domain_auto_renew: { auto_renew: boolean } }).domain_auto_renew.auto_renew).toBe(true);

    await app.close();
  });

  it('rejects invalid auto_renew value', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('autorenew-invalid@example.com', 'customer');
    const domainId = await createCustomerDomain(userId, 'invalid.example');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/domains/${domainId}/auto-renew`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_renew: 'yes' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 404 for a missing domain', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('autorenew-missing@example.com', 'customer');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/domains/00000000-0000-0000-0000-000000000000/auto-renew',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
