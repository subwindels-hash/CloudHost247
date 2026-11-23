import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';

/**
 * Exercises the incident notification API (K07) end-to-end against a real embedded
 * Postgres engine (pglite).
 *
 *   - Public list / single read: any visitor can read incidents; empty list is honest.
 *   - Admin create / transition: requires admin or super_admin; customers get 403.
 *   - Major / critical creation queues an in-app + email notification to every active
 *     customer (notification_outbox row per customer). Minor does not broadcast.
 *   - `GET /api/v1/public/status` includes an `incidents` array with active incidents.
 *
 * Every test inserts its own fixture users directly through the database; nothing relies on
 * the shared seed script. Tokens are minted with `signAuthToken` using the test JWT_SECRET.
 */
describe('incident notifications API (K07)', () => {
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
    role: 'customer' | 'admin' | 'super_admin',
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

  it('GET /api/v1/incidents returns an honest empty list when none are declared', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/incidents' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { incidents: unknown[]; total: number };
    expect(body.incidents).toEqual([]);
    expect(body.total).toBe(0);
    await app.close();
  });

  it('admin can create an incident; customer cannot', async () => {
    const app = buildTestApp();
    const { token: adminToken } = await createUserAccount('admin@example.com', 'admin');
    const { token: customerToken } = await createUserAccount('customer@example.com', 'customer');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/incidents',
      headers: { Authorization: adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'DNS degradation in region eu-west',
        body: 'We are investigating elevated DNS resolution latency.',
        severity: 'minor',
      }),
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { incident_number: string; status: string; severity: string };
    expect(created.incident_number).toMatch(/^INC-\d{4}-\d{3}$/);
    expect(created.status).toBe('investigating');
    expect(created.severity).toBe('minor');

    const asCustomer = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/incidents',
      headers: { Authorization: customerToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Customer should not be able to do this',
        body: '...',
        severity: 'minor',
      }),
    });
    expect(asCustomer.statusCode).toBe(403);
    await app.close();
  });

  it('major / critical creation queues a notification to every active customer; minor does not', async () => {
    const app = buildTestApp();
    const { token: adminToken } = await createUserAccount('admin@example.com', 'admin');
    await createUserAccount('alice@example.com', 'customer');
    await createUserAccount('bob@example.com', 'customer');
    // A suspended customer must not receive the broadcast.
    await createUserAccount('suspended@example.com', 'customer', 'suspended');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/incidents',
      headers: { Authorization: adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Major outage',
        body: 'Something serious.',
        severity: 'major',
      }),
    });
    expect(create.statusCode).toBe(201);

    const outbox = await db.query(
      `SELECT count(*)::text AS n FROM notification_outbox WHERE status = 'PENDING'`
    );
    // 3 active users (admin + alice + bob) each get an outbox row.
    expect(Number(outbox.rows[0].n)).toBeGreaterThanOrEqual(3);

    // A minor incident must not broadcast.
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/incidents',
      headers: { Authorization: adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Minor thing',
        body: 'Nothing to see.',
        severity: 'minor',
      }),
    });
    await app.close();
  });

  it('GET /api/v1/incidents/:id returns 404 for a missing incident', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/incidents/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('PATCH /api/v1/admin/incidents/:id transitions status and stamps resolved_at', async () => {
    const app = buildTestApp();
    const { token: adminToken } = await createUserAccount('admin@example.com', 'admin');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/incidents',
      headers: { Authorization: adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Transition test',
        body: '...',
        severity: 'minor',
      }),
    });
    expect(create.statusCode).toBe(201);
    const { incident_number } = create.json() as { incident_number: string };

    const resolved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/incidents/${incident_number}`,
      headers: { Authorization: adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(resolved.statusCode).toBe(200);
    const body = resolved.json() as { status: string; resolved_at: string | null };
    expect(body.status).toBe('resolved');
    expect(body.resolved_at).not.toBeNull();

    await app.close();
  });

  it('GET /api/v1/public/status includes active incidents', async () => {
    const app = buildTestApp();
    const { token: adminToken } = await createUserAccount('admin@example.com', 'admin');

    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/incidents',
      headers: { Authorization: adminToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Status page incident',
        body: '...',
        severity: 'critical',
      }),
    });

    const status = await app.inject({ method: 'GET', url: '/api/v1/public/status' });
    expect(status.statusCode).toBe(200);
    const body = status.json() as {
      monitored: boolean;
      incidents: { incident_number: string; title: string; status: string; severity: string }[];
    };
    expect(body.monitored).toBe(false);
    expect(Array.isArray(body.incidents)).toBe(true);
    expect(body.incidents.length).toBeGreaterThan(0);
    expect(body.incidents[0].severity).toBe('critical');
    await app.close();
  });
});
