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
 * Exercises the PHP configuration API (A08 — A Hosting) end-to-end against a real
 * embedded Postgres engine (pglite).
 *
 *   - Customers can create, list and get PHP configs for their own services.
 *   - Customers can update PHP config for their own services (preference only).
 *   - Staff can manage any PHP config.
 *   - No PHP-FPM provider is called — version is stored as preference only.
 *
 * Every test inserts its own fixture users, services and PHP configs directly
 * through the database. Tokens are minted with `signAuthToken` using the test
 * JWT_SECRET.
 */
describe('php config API (A08)', () => {
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

  async function createService(userId: string, label: string): Promise<string> {
    const serviceId = randomUUID();
    await db.query(
      `INSERT INTO customer_services (id, user_id, label, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', now(), now())`,
      [serviceId, userId, label],
    );
    return serviceId;
  }

  it('customer can create a PHP config for their own service', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('php-customer@example.com', 'customer');
    const serviceId = await createService(userId, 'My PHP Site');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId, php_version: '8.1', settings: { memory_limit: '256M' } }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { php_config: { service_id: string; php_version: string; settings: Record<string, unknown> } };
    expect(body.php_config.service_id).toBe(serviceId);
    expect(body.php_config.php_version).toBe('8.1');
    expect(body.php_config.settings.memory_limit).toBe('256M');

    await app.close();
  });

  it('customer can list their own PHP configs only', async () => {
    const app = buildTestApp();
    const { userId: userA, token: tokenA } = await createUserAccount('php-user-a@example.com', 'customer');
    const { userId: userB } = await createUserAccount('php-user-b@example.com', 'customer');
    const serviceIdA = await createService(userA, 'Site A');
    const serviceIdB = await createService(userB, 'Site B');

    await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceIdA, php_version: '8.2' }),
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: `Bearer ${signAuthToken(env, { sub: userB, role: 'customer', email: 'php-user-b@example.com' })}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceIdB, php_version: '7.4' }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/php-config',
      headers: { Authorization: tokenA },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { php_configs: Array<{ service_id: string; php_version: string }> };
    expect(body.php_configs.length).toBe(1);
    expect(body.php_configs[0].service_id).toBe(serviceIdA);
    expect(body.php_configs[0].php_version).toBe('8.2');

    await app.close();
  });

  it('staff can list all PHP configs', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('php-staff@example.com', 'staff');
    const { userId: userA } = await createUserAccount('php-staff-user-a@example.com', 'customer');
    const serviceId = await createService(userA, 'Staff Site');

    await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: `Bearer ${signAuthToken(env, { sub: userA, role: 'customer', email: 'php-staff-user-a@example.com' })}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId, php_version: '8.2' }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/php-config',
      headers: { Authorization: staffToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { php_configs: Array<{ service_id: string }> };
    expect(body.php_configs.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('customer can update their own PHP config', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('php-update@example.com', 'customer');
    const serviceId = await createService(userId, 'Updatable Site');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId, php_version: '8.0' }),
    });
    expect(create.statusCode).toBe(201);
    const configId = (create.json() as { php_config: { id: string } }).php_config.id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/php-config/${configId}`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ php_version: '8.2', settings: { memory_limit: '512M' } }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { php_config: { php_version: string; settings: Record<string, unknown> } };
    expect(body.php_config.php_version).toBe('8.2');
    expect(body.php_config.settings.memory_limit).toBe('512M');

    await app.close();
  });

  it('customer cannot access another customer PHP config (404)', async () => {
    const app = buildTestApp();
    const { userId: userA, token: tokenA } = await createUserAccount('php-user-a2@example.com', 'customer');
    const serviceId = await createService(userA, 'Private Site');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: tokenA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId, php_version: '8.2' }),
    });
    const configId = (create.json() as { php_config: { id: string } }).php_config.id;

    const { userId: userB } = await createUserAccount('php-user-b2@example.com', 'customer');
    const tokenB = `Bearer ${signAuthToken(env, { sub: userB, role: 'customer', email: 'php-user-b2@example.com' })}`;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/php-config/${configId}`,
      headers: { Authorization: tokenB },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('returns 404 for a missing PHP config', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('php-missing@example.com', 'customer');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/php-config/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('customer cannot delete a PHP config (403)', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('php-delete-cust@example.com', 'customer');
    const serviceId = await createService(userId, 'Deletable Site');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId, php_version: '8.2' }),
    });
    const configId = (create.json() as { php_config: { id: string } }).php_config.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/php-config/${configId}`,
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('staff can delete a PHP config', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('php-delete-staff@example.com', 'staff');
    const { userId } = await createUserAccount('php-delete-cust2@example.com', 'customer');
    const serviceId = await createService(userId, 'To Be Deleted');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: `Bearer ${signAuthToken(env, { sub: userId, role: 'customer', email: 'php-delete-cust2@example.com' })}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId, php_version: '8.2' }),
    });
    const configId = (create.json() as { php_config: { id: string } }).php_config.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/php-config/${configId}`,
      headers: { Authorization: staffToken },
    });
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it('rejects invalid PHP version on create (400)', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('php-invalid@example.com', 'customer');
    const serviceId = await createService(userId, 'Invalid PHP');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId, php_version: '' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 404 for creating config on unknown service', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('php-unknown-svc@example.com', 'customer');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/php-config',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: '00000000-0000-0000-0000-000000000000', php_version: '8.2' }),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
