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
 * Exercises the abuse reporting API (F13) end-to-end against a real embedded
 * Postgres engine (pglite).
 *
 *   - Public submission: anyone can file an abuse report without an account; rate-limited.
 *   - Staff review: staff/admin/super_admin can list, view, and update reports;
 *     customers get 403.
 *   - Nothing is auto-delivered: the response confirms receipt only.
 *
 * Every test inserts its own fixture users directly through the database; nothing relies on
 * the shared seed script. Tokens are minted with `signAuthToken` using the test JWT_SECRET.
 */
describe('abuse reporting API (F13)', () => {
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

  it('public submission creates an abuse report and confirms receipt only', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/abuse/reports',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reporter_name: 'A Reporter',
        reporter_email: 'reporter@example.com',
        category: 'phishing',
        subject: 'Phishing site hosted on your platform',
        body: 'The site at http://example.com/phish is harvesting credentials.',
        target: 'example.com',
        priority: 'high',
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      received: boolean;
      abuse_report: { id: string; category: string; status: string; priority: string };
      notice: string;
    };
    expect(body.received).toBe(true);
    expect(body.abuse_report.category).toBe('phishing');
    expect(body.abuse_report.status).toBe('received');
    expect(body.abuse_report.priority).toBe('high');
    expect(body.notice).toContain('staff review');
    await app.close();
  });

  it('anonymous submission without contact details is accepted', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/abuse/reports',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'spam',
        subject: 'Spam',
        body: 'Unsolicited bulk email from a hosted service.',
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { abuse_report: { reporter_email: string | null } };
    expect(body.abuse_report.reporter_email).toBeNull();
    await app.close();
  });

  it('staff can list and view abuse reports; customer cannot', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('staff@example.com', 'staff');
    const { token: customerToken } = await createUserAccount('customer@example.com', 'customer');

    // Submit a report first.
    await app.inject({
      method: 'POST',
      url: '/api/v1/abuse/reports',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'copyright',
        subject: 'Copyright infringement',
        body: 'A hosted site is infringing copyright.',
      }),
    });

    // Staff can list.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/abuse/reports',
      headers: { Authorization: staffToken },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { abuse_reports: unknown[]; total: number };
    expect(listBody.total).toBeGreaterThan(0);

    // Customer gets 403.
    const asCustomer = await app.inject({
      method: 'GET',
      url: '/api/v1/abuse/reports',
      headers: { Authorization: customerToken },
    });
    expect(asCustomer.statusCode).toBe(403);
    await app.close();
  });

  it('staff can update a report status and priority', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('staff@example.com', 'staff');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/abuse/reports',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'security',
        subject: 'Security issue',
        body: 'A potential security issue.',
      }),
    });
    expect(create.statusCode).toBe(201);
    const { id } = (create.json() as { abuse_report: { id: string } }).abuse_report;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/abuse/reports/${id}`,
      headers: { Authorization: staffToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'actioned', priority: 'critical', staff_notes: 'Contacted the site owner.' }),
    });
    expect(updated.statusCode).toBe(200);
    const body = updated.json() as { status: string; priority: string; staff_notes: string | null };
    expect(body.status).toBe('actioned');
    expect(body.priority).toBe('critical');
    expect(body.staff_notes).toBe('Contacted the site owner.');
    await app.close();
  });

  it('returns 404 for a missing report', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('staff@example.com', 'staff');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/abuse/reports/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: staffToken },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects an invalid category', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/abuse/reports',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'not_a_category',
        subject: 'x',
        body: 'y',
      }),
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
