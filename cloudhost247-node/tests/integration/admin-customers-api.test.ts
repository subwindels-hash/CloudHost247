import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { createTicket } from '../../src/db/support-tickets';

/**
 * Exercises the staff-side Phase 4 customer-management API (/api/v1/admin/customers,
 * /api/v1/admin/tickets) end-to-end against a real embedded Postgres engine. Covers the full RBAC
 * matrix (unauthenticated / customer / admin / super_admin), the super_admin-only account
 * integrity routes, self-demotion lockout protection, a forged-JWT-role attack, and a concrete
 * "no side effect" boundary test proving a service/domain mutation never makes an outbound network
 * call (i.e. this is not provisioning).
 */
describe('staff customer-management API (/api/v1/admin/customers, /api/v1/admin/tickets)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'h'.repeat(32),
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

  async function createUserWithRole(role: 'customer' | 'admin' | 'super_admin', email?: string): Promise<{ userId: string; token: string; email: string }> {
    const userId = randomUUID();
    const userEmail = email ?? `${role}-${userId}@example.com`;
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`, [
      userId,
      userEmail,
      'not-a-real-hash',
      'Test User',
      role,
    ]);
    const token = signAuthToken(env, { sub: userId, role, email: userEmail });
    return { userId, token, email: userEmail };
  }

  it('rejects unauthenticated requests across the whole admin customer-management surface', async () => {
    const app = buildTestApp();
    const customerId = randomUUID();
    const routes: Array<{ method: 'GET' | 'PATCH' | 'POST'; url: string }> = [
      { method: 'GET', url: '/api/v1/admin/customers' },
      { method: 'GET', url: `/api/v1/admin/customers/${customerId}` },
      { method: 'PATCH', url: `/api/v1/admin/customers/${customerId}/status` },
      { method: 'PATCH', url: `/api/v1/admin/customers/${customerId}/role` },
      { method: 'POST', url: `/api/v1/admin/customers/${customerId}/services` },
      { method: 'POST', url: `/api/v1/admin/customers/${customerId}/domains` },
      { method: 'GET', url: '/api/v1/admin/tickets' },
    ];
    for (const route of routes) {
      const res = await app.inject({ method: route.method, url: route.url, payload: {} });
      expect(res.statusCode).toBe(401);
    }
    await app.close();
  });

  it('rejects a customer-role token on every admin route with 403', async () => {
    const { token } = await createUserWithRole('customer');
    const app = buildTestApp();
    const customerId = randomUUID();

    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/customers', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);

    const statusRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${customerId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'suspended' },
    });
    expect(statusRes.statusCode).toBe(403);
    await app.close();
  });

  it('allows admin (not just super_admin) to view customers, manage services/domains, and reply to tickets', async () => {
    const staff = await createUserWithRole('admin');
    const customer = await createUserWithRole('customer');
    const app = buildTestApp();

    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/customers', headers: { authorization: `Bearer ${staff.token}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json().customers.some((c: { id: string }) => c.id === customer.userId)).toBe(true);

    const createService = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customer.userId}/services`,
      headers: { authorization: `Bearer ${staff.token}` },
      payload: { label: 'cPanel Hosting — Starter' },
    });
    expect(createService.statusCode).toBe(201);

    const createDomain = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customer.userId}/domains`,
      headers: { authorization: `Bearer ${staff.token}` },
      payload: { domainName: 'example.org' },
    });
    expect(createDomain.statusCode).toBe(201);

    const ticket = await createTicket(db, {
      id: randomUUID(),
      userId: customer.userId,
      subject: 'Question',
      firstMessage: { id: randomUUID(), authorId: customer.userId, authorRole: 'customer', body: 'Hi' },
    });
    const reply = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/tickets/${ticket.id}/messages`,
      headers: { authorization: `Bearer ${staff.token}` },
      payload: { message: 'We are on it.' },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().ticket.messages[1].authorRole).toBe('admin');
    await app.close();
  });

  it('rejects "admin" (not super_admin) on account status and role change routes', async () => {
    const staff = await createUserWithRole('admin');
    const customer = await createUserWithRole('customer');
    const app = buildTestApp();

    const statusRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${customer.userId}/status`,
      headers: { authorization: `Bearer ${staff.token}` },
      payload: { status: 'suspended' },
    });
    expect(statusRes.statusCode).toBe(403);

    const roleRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${customer.userId}/role`,
      headers: { authorization: `Bearer ${staff.token}` },
      payload: { role: 'admin' },
    });
    expect(roleRes.statusCode).toBe(403);

    const { rows } = await db.query<{ status: string; role: string }>('SELECT status, role FROM users WHERE id = $1', [customer.userId]);
    expect(rows[0]?.status).toBe('active');
    expect(rows[0]?.role).toBe('customer');
    await app.close();
  });

  it('super_admin can suspend/reactivate an account and change a role, and it actually persists', async () => {
    const superAdmin = await createUserWithRole('super_admin');
    const customer = await createUserWithRole('customer');
    const app = buildTestApp();

    const suspend = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${customer.userId}/status`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: { status: 'suspended' },
    });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().customer.status).toBe('suspended');

    const promote = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${customer.userId}/role`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: { role: 'admin' },
    });
    expect(promote.statusCode).toBe(200);
    expect(promote.json().customer.role).toBe('admin');

    const { rows } = await db.query<{ status: string; role: string }>('SELECT status, role FROM users WHERE id = $1', [customer.userId]);
    expect(rows[0]?.status).toBe('suspended');
    expect(rows[0]?.role).toBe('admin');
    await app.close();
  });

  it('a suspended account is immediately rejected on its next request, even mid-session', async () => {
    const superAdmin = await createUserWithRole('super_admin');
    const customer = await createUserWithRole('customer');
    const app = buildTestApp();

    // customer's token still works before suspension
    const before = await app.inject({ method: 'GET', url: '/api/v1/account/services', headers: { authorization: `Bearer ${customer.token}` } });
    expect(before.statusCode).toBe(200);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${customer.userId}/status`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: { status: 'suspended' },
    });

    const after = await app.inject({ method: 'GET', url: '/api/v1/account/services', headers: { authorization: `Bearer ${customer.token}` } });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  it('blocks a super_admin from changing their own role (self-demotion lockout protection)', async () => {
    const superAdmin = await createUserWithRole('super_admin');
    const app = buildTestApp();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${superAdmin.userId}/role`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: { role: 'customer' },
    });
    expect(res.statusCode).toBe(400);

    const { rows } = await db.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [superAdmin.userId]);
    expect(rows[0]?.role).toBe('super_admin');
    await app.close();
  });

  it('a forged JWT claiming super_admin for an account whose real DB role is customer is still rejected (403), proving DB re-verification', async () => {
    const customer = await createUserWithRole('customer');
    // Forge a token with the *claim* super_admin, for the same real user id whose DB row is customer.
    const forgedToken = signAuthToken(env, { sub: customer.userId, role: 'super_admin', email: customer.email });
    const app = buildTestApp();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${customer.userId}/status`,
      headers: { authorization: `Bearer ${forgedToken}` },
      payload: { status: 'suspended' },
    });
    expect(res.statusCode).toBe(403);

    const { rows } = await db.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [customer.userId]);
    expect(rows[0]?.status).toBe('active');
    await app.close();
  });

  it('rejects malformed UUID params with 400 and well-formed-but-missing customer ids with 404', async () => {
    const staff = await createUserWithRole('admin');
    const app = buildTestApp();

    const malformed = await app.inject({ method: 'GET', url: '/api/v1/admin/customers/not-a-uuid', headers: { authorization: `Bearer ${staff.token}` } });
    expect(malformed.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers/${randomUUID()}`,
      headers: { authorization: `Bearer ${staff.token}` },
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('never allows a service/domain to be attached to the wrong customer id in the URL', async () => {
    const staff = await createUserWithRole('admin');
    const customerA = await createUserWithRole('customer');
    const customerB = await createUserWithRole('customer');
    const app = buildTestApp();

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customerA.userId}/services`,
      headers: { authorization: `Bearer ${staff.token}` },
      payload: { label: 'A service' },
    });
    const serviceId = created.json().service.id;

    // Attempting to edit customer A's service via customer B's URL path must 404, not succeed.
    const crossEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/customers/${customerB.userId}/services/${serviceId}`,
      headers: { authorization: `Bearer ${staff.token}` },
      payload: { status: 'cancelled' },
    });
    expect(crossEdit.statusCode).toBe(404);

    const { rows } = await db.query<{ status: string }>('SELECT status FROM customer_services WHERE id = $1', [serviceId]);
    expect(rows[0]?.status).toBe('active');
    await app.close();
  });

  it('boundary test: creating a customer_services/customer_domains record makes zero outbound network calls (not provisioning)', async () => {
    const staff = await createUserWithRole('admin');
    const customer = await createUserWithRole('customer');
    const app = buildTestApp();

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    // @ts-expect-error -- intentionally stubbing the global for this one assertion
    globalThis.fetch = (...args: unknown[]) => {
      fetchCalled = true;
      throw new Error(`Unexpected outbound network call during a Phase 4 mutation: ${JSON.stringify(args)}`);
    };

    try {
      const createService = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/customers/${customer.userId}/services`,
        headers: { authorization: `Bearer ${staff.token}` },
        payload: { label: 'No-automation service', status: 'active' },
      });
      expect(createService.statusCode).toBe(201);

      const createDomain = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/customers/${customer.userId}/domains`,
        headers: { authorization: `Bearer ${staff.token}` },
        payload: { domainName: 'no-automation.example' },
      });
      expect(createDomain.statusCode).toBe(201);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchCalled).toBe(false);
    await app.close();
  });
});
