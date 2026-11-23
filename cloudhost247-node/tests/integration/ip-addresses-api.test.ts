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
 * Exercises the IP address inventory API (E12 — E VPS) end-to-end against a real
 * embedded Postgres engine (pglite).
 *
 *   - Staff can register, list, assign and release IP addresses.
 *   - Customers can only list IPs assigned to them; they cannot register/assign/release (403).
 *   - Assigning a non-free IP fails (400); duplicate addresses fail (400); unknown IP fails (404).
 *
 * Every test inserts its own fixture users, servers and IP addresses directly through
 * the database. Tokens are minted with `signAuthToken` using the test JWT_SECRET.
 */
describe('ip addresses API (E12)', () => {
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

  async function createServer(): Promise<string> {
    const serverId = randomUUID();
    await db.query(
      `INSERT INTO servers (id, name, hostname, server_type, provider, region, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'VPS', 'test', 'test-region', 'active', now(), now())`,
      [serverId, 'Test Server', 'test-server.example.com'],
    );
    return serverId;
  }

  async function createIpAddress(
    address: string,
    version: 'ipv4' | 'ipv6' = 'ipv4',
    status: 'free' | 'assigned' | 'reserved' = 'free',
    serverId: string | null = null,
    customerId: string | null = null,
  ): Promise<string> {
    const ipId = randomUUID();
    await db.query(
      `INSERT INTO ip_addresses (id, address, version, status, server_id, customer_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
      [ipId, address, version, status, serverId, customerId],
    );
    return ipId;
  }

  it('staff can register a new IP address', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-staff@example.com', 'staff');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ip-addresses',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '192.0.2.10', version: 'ipv4', status: 'free' }),
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { ip_address: { address: string } }).ip_address.address).toBe('192.0.2.10');

    await app.close();
  });

  it('customer cannot register an IP address (403)', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-customer@example.com', 'customer');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ip-addresses',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '192.0.2.10', version: 'ipv4' }),
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('rejects duplicate IP address', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-dup@example.com', 'staff');
    await createIpAddress('192.0.2.20', 'ipv4', 'free');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ip-addresses',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '192.0.2.20', version: 'ipv4' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('staff can list IP addresses', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-list@example.com', 'staff');
    await createIpAddress('192.0.2.30', 'ipv4', 'free');
    await createIpAddress('2001:db8::1', 'ipv6', 'assigned');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ip-addresses',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ip_addresses: Array<{ address: string }> };
    expect(body.ip_addresses.length).toBeGreaterThanOrEqual(2);

    await app.close();
  });

  it('filters IP addresses by status', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-filter@example.com', 'staff');
    await createIpAddress('192.0.2.40', 'ipv4', 'free');
    await createIpAddress('192.0.2.41', 'ipv4', 'assigned');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ip-addresses?status=free',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ip_addresses: Array<{ status: string }> };
    expect(body.ip_addresses.every((ip) => ip.status === 'free')).toBe(true);

    await app.close();
  });

  it('customer can list only IPs assigned to them', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('ip-owner@example.com', 'customer');
    await createIpAddress('192.0.2.50', 'ipv4', 'assigned', null, userId);
    await createIpAddress('192.0.2.51', 'ipv4', 'assigned', null, randomUUID()); // another customer

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ip-addresses',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ip_addresses: Array<{ customer_id: string }> };
    expect(body.ip_addresses.every((ip) => ip.customer_id === userId)).toBe(true);

    await app.close();
  });

  it('staff can assign a free IP to a server and customer', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-assign@example.com', 'staff');
    const serverId = await createServer();
    const { userId: customerId } = await createUserAccount('ip-assign-cust@example.com', 'customer');
    const ipId = await createIpAddress('192.0.2.60', 'ipv4', 'free');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/ip-addresses/${ipId}/assign`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: serverId, customer_id: customerId, status: 'assigned' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ip_address: { status: string; server_id: string } };
    expect(body.ip_address.status).toBe('assigned');
    expect(body.ip_address.server_id).toBe(serverId);

    await app.close();
  });

  it('rejects assigning a non-free IP (400)', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-assign2@example.com', 'staff');
    const serverId = await createServer();
    const { userId: customerId } = await createUserAccount('ip-assign2-cust@example.com', 'customer');
    const ipId = await createIpAddress('192.0.2.61', 'ipv4', 'assigned', serverId, customerId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/ip-addresses/${ipId}/assign`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: serverId, customer_id: customerId, status: 'assigned' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 404 for assigning an unknown IP', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-assign3@example.com', 'staff');
    const serverId = await createServer();
    const { userId: customerId } = await createUserAccount('ip-assign3-cust@example.com', 'customer');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ip-addresses/00000000-0000-0000-0000-000000000000/assign',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: serverId, customer_id: customerId, status: 'assigned' }),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('customer cannot assign an IP (403)', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-assign-cust2@example.com', 'customer');
    const serverId = await createServer();
    const ipId = await createIpAddress('192.0.2.62', 'ipv4', 'free');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/ip-addresses/${ipId}/assign`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: serverId, customer_id: randomUUID(), status: 'assigned' }),
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('staff can release an assigned IP back to the pool', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-release@example.com', 'staff');
    const serverId = await createServer();
    const { userId: customerId } = await createUserAccount('ip-release-cust@example.com', 'customer');
    const ipId = await createIpAddress('192.0.2.70', 'ipv4', 'assigned', serverId, customerId);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/ip-addresses/${ipId}`,
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ip_address: { status: string; server_id: string | null } };
    expect(body.ip_address.status).toBe('free');
    expect(body.ip_address.server_id).toBeNull();

    await app.close();
  });

  it('rejects releasing an already-free IP (400)', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-release2@example.com', 'staff');
    const ipId = await createIpAddress('192.0.2.71', 'ipv4', 'free');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/ip-addresses/${ipId}`,
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('rejects invalid IP address on create (400)', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-invalid@example.com', 'staff');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ip-addresses',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '', version: 'ipv4' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('staff can reconcile IP addresses', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-reconcile@example.com', 'staff');
    await createIpAddress('192.0.2.80', 'ipv4', 'free');
    await createIpAddress('192.0.2.81', 'ipv4', 'assigned');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ip-addresses/reconcile',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reconciliation: { total: number; free: number; assigned: number; reserved: number; issues: Array<{ issue: string }> } };
    expect(body.reconciliation.total).toBeGreaterThanOrEqual(2);
    expect(body.reconciliation.free).toBeGreaterThanOrEqual(1);
    expect(body.reconciliation.assigned).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.reconciliation.issues)).toBe(true);

    await app.close();
  });

  it('customer cannot reconcile IP addresses (403)', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-reconcile-cust@example.com', 'customer');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ip-addresses/reconcile',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('reconciliation returns no issues when all references are valid', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('ip-clean@example.com', 'staff');
    const serverId = await createServer();
    const { userId: customerId } = await createUserAccount('ip-clean-cust@example.com', 'customer');
    await createIpAddress('192.0.2.90', 'ipv4', 'assigned', serverId, customerId);
    await createIpAddress('192.0.2.91', 'ipv4', 'free');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ip-addresses/reconcile',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { reconciliation: { total: number; issues: Array<{ issue: string }> } };
    expect(body.reconciliation.issues).toEqual([]);
    expect(body.reconciliation.total).toBeGreaterThanOrEqual(2);

    await app.close();
  });
});
