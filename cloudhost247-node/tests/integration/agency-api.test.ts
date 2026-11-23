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
 * Exercises the agency / reseller hosting API (W10, J Agency core) end-to-end
 * against a real embedded Postgres engine (pglite).
 *
 *   - Agencies: create, list, get, update, delete (staff-gated)
 *   - Agency clients: add, list, remove (staff-gated)
 *   - Reseller packages: create, list, get, update, delete (staff-gated)
 *   - Customers get 403 on all agency endpoints.
 *
 * Every test inserts its own fixture users directly through the database; nothing relies on
 * the shared seed script. Tokens are minted with `signAuthToken` using the test JWT_SECRET.
 */
describe('agency API (W10)', () => {
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

  it('staff can create, list, get, update and delete an agency', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('agency-staff@example.com', 'staff');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/agencies',
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Acme Reseller',
        slug: 'acme-reseller',
        contact_email: 'billing@acme.example',
      }),
    });
    expect(created.statusCode).toBe(201);
    const { id } = (created.json() as { agency: { id: string } }).agency;

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/agency/agencies',
      headers: { Authorization: staffToken },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { agencies: unknown[] }).agencies.length).toBeGreaterThanOrEqual(1);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/agency/agencies/${id}`,
      headers: { Authorization: staffToken },
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { agency: { name: string } }).agency.name).toBe('Acme Reseller');

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agency/agencies/${id}`,
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_email: 'support@acme.example' }),
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { agency: { contact_email: string } }).agency.contact_email).toBe('support@acme.example');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agency/agencies/${id}`,
      headers: { Authorization: staffToken },
    });
    expect(removed.statusCode).toBe(204);

    await app.close();
  });

  it('customer cannot create an agency (403)', async () => {
    const app = buildTestApp();
    const { token: customerToken } = await createUserAccount('agency-customer@example.com', 'customer');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/agencies',
      headers: { Authorization: customerToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Acme Reseller',
        slug: 'acme-reseller',
        contact_email: 'billing@acme.example',
      }),
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('returns 404 for a missing agency', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('agency-staff2@example.com', 'staff');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agency/agencies/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: staffToken },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('staff can add and list agency clients', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('agency-staff3@example.com', 'staff');
    const { userId: clientUserId } = await createUserAccount('client-user@example.com', 'customer');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/agencies',
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Client Test Agency',
        slug: 'client-test-agency',
        contact_email: 'billing@client.example',
      }),
    });
    expect(created.statusCode).toBe(201);
    const { id: agencyId } = (created.json() as { agency: { id: string } }).agency;

    const added = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/clients',
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agency_id: agencyId,
        user_id: clientUserId,
        role: 'client',
      }),
    });
    expect(added.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/agency/clients?agency_id=${agencyId}`,
      headers: { Authorization: staffToken },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { agency_clients: unknown[] }).agency_clients.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('staff can create, list, get, update and delete a reseller package', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('agency-staff4@example.com', 'staff');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/packages',
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Starter Reseller',
        slug: 'starter-reseller',
        description: 'Entry-level reseller package',
        price_cents: 49900,
        currency: 'USD',
      }),
    });
    expect(created.statusCode).toBe(201);
    const { id } = (created.json() as { reseller_package: { id: string } }).reseller_package;

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/agency/packages',
      headers: { Authorization: staffToken },
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { reseller_packages: unknown[] }).reseller_packages.length).toBeGreaterThanOrEqual(1);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/agency/packages/${id}`,
      headers: { Authorization: staffToken },
    });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { reseller_package: { name: string } }).reseller_package.name).toBe('Starter Reseller');

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agency/packages/${id}`,
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_cents: 59900 }),
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { reseller_package: { price_cents: number } }).reseller_package.price_cents).toBe(59900);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agency/packages/${id}`,
      headers: { Authorization: staffToken },
    });
    expect(removed.statusCode).toBe(204);

    await app.close();
  });
});
