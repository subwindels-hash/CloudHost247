import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Exercises custom domains for online stores (H07 — H Ecommerce) end-to-end
 * against a real embedded Postgres engine (pglite).
 *
 *   - A store owner can set and clear a custom domain on their store.
 *   * Custom domains are unique across stores.
 *   - Non-owners cannot set a custom domain on another's store (404).
 *
 * No DNS verification or SSL provisioning is performed — those depend on a
 * DNS/CA provider that is not yet configured. The field stores the merchant's
 * intended domain honestly.
 */
describe('store custom domains (H07)', () => {
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

  async function createUser(
    email: string,
    role: 'customer' | 'admin' | 'super_admin' = 'customer',
  ): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword('correct-horse-battery');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, email, passwordHash, email.split('@')[0], role, 'active', email.split('@')[0]],
    );
    const token = signAuthToken(env, { sub: userId, role, email });
    return { userId, token: `Bearer ${token}` };
  }

  async function createStore(db: PGlite, userId: string, name: string): Promise<string> {
    const storeId = randomUUID();
    await db.query(
      `INSERT INTO store_stores (id, user_id, name, slug, description, currency, status, payment_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [storeId, userId, name, slugify(name), '', 'USD', 'draft', 'order_intake'],
    );
    return storeId;
  }

  function slugify(input: string): string {
    const base = input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return base.length >= 2 ? base : `store-${randomBytes(3).toString('hex')}`;
  }

  it('store owner can set a custom domain on their store', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUser('h07-owner@example.com');
    const storeId = await createStore(db, userId, 'Windward Guides');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/store/stores/${storeId}`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: 'shop.windward.example' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { store: { custom_domain: string | null } };
    expect(body.store.custom_domain).toBe('shop.windward.example');

    await app.close();
  });

  it('store owner can clear a custom domain (set to null)', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUser('h07-clear@example.com');
    const storeId = await createStore(db, userId, 'Clear Domain Store');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/store/stores/${storeId}`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: 'shop.clear.example' }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/store/stores/${storeId}`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: null }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { store: { custom_domain: string | null } };
    expect(body.store.custom_domain).toBeNull();

    await app.close();
  });

  it('custom domains are unique across stores', async () => {
    const app = buildTestApp();
    const { userId: userIdA, token: tokenA } = await createUser('h07-unique-a@example.com');
    const { userId: userIdB, token: tokenB } = await createUser('h07-unique-b@example.com');
    const storeIdA = await createStore(db, userIdA, 'Store A');
    const storeIdB = await createStore(db, userIdB, 'Store B');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/store/stores/${storeIdA}`,
      headers: { Authorization: tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: 'shop.shared.example' }),
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/store/stores/${storeIdB}`,
      headers: { Authorization: tokenB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: 'shop.shared.example' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('non-owner cannot set custom domain on another store (404)', async () => {
    const app = buildTestApp();
    const { userId: ownerUserId, token: ownerToken } = await createUser('h07-owner2@example.com');
    const { token: attackerToken } = await createUser('h07-attacker@example.com');
    const storeId = await createStore(db, ownerUserId, 'Victim Store');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/store/stores/${storeId}`,
      headers: { Authorization: attackerToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: 'shop.hijacked.example' }),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('returns 404 for unknown store', async () => {
    const app = buildTestApp();
    const { token } = await createUser('h07-unknown@example.com');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/store/stores/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: 'shop.unknown.example' }),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('rejects invalid custom domain (too long)', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUser('h07-invalid@example.com');
    const storeId = await createStore(db, userId, 'Invalid Domain Store');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/store/stores/${storeId}`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: 'a'.repeat(300) }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });
});
