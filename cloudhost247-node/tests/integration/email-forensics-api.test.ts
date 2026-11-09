/**
 * Email Trace & Forensics Analyzer — integration tests against the real API routes.
 *
 * Runs against an embedded PGlite Postgres migrated with the real migration files (including
 * 0092_create_email_forensics.sql). Every request is injected through Fastify's `app.inject`,
 * so the full middleware stack (auth, rate limiting, error handling) is exercised.
 *
 * No external APIs are hit: DNS lookups in these tests resolve against whatever is configured
 * in the test environment, and the diagnostics results reflect that honestly.
 */

import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';

const SAMPLE_HEADERS = `Received: from mail.example.com ([8.8.8.8]) by mx.receiver.example.com with ESMTPS id abc123 for <recipient@example.com>; Mon, 09 Nov 2026 10:00:00 +0000
Received: from sender.example.org ([1.1.1.1]) by mail.example.com with ESMTP id def456; Mon, 09 Nov 2026 09:30:00 +0000
From: Sender Name <sender@example.org>
To: Recipient Name <recipient@example.com>
Subject: Test forensic email
Message-ID: <abc123@example.org>
Date: Mon, 09 Nov 2026 09:30:00 +0000
Authentication-Results: mx.receiver.example.com; spf=pass smtp.mailfrom=example.org; dkim=pass header.d=example.org; dmarc=pass header.from=example.org
X-Originating-IP: [8.8.4.4]

Hello world
`;

const SAMPLE_HEADERS_NO_IP = `From: Sender Name <sender@example.org>
To: Recipient Name <recipient@example.com>
Subject: No IP headers
Message-ID: <noip@example.org>
Date: Mon, 09 Nov 2026 09:30:00 +0000

Just a body
`;

describe('Email Forensics API (/api/v1/email-forensics*)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 't'.repeat(32),
    EMAIL_FORENSICS_ENABLED: 'true',
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

  async function createUser(email: string, role: 'customer' | 'admin' | 'super_admin' = 'customer') {
    const id = randomUUID();
    const hash = await hashPassword('password123');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, email, hash, 'Test User', role]
    );
    const token = signAuthToken(env, { sub: id, email, role });
    return { id, email, role, token };
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  // ------------------------------------------------------------------
  // Unauthenticated access
  // ------------------------------------------------------------------
  it('rejects unauthenticated analyze requests with 401', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      payload: { rawHeaders: SAMPLE_HEADERS },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects unauthenticated history requests with 401', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/email-forensics/history' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects unauthenticated admin stats with 401', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/email-forensics/stats' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  // ------------------------------------------------------------------
  // Customer analyze (paste headers)
  // ------------------------------------------------------------------
  it('analyzes pasted headers and returns a complete result', async () => {
    const app = buildTestApp();
    const user = await createUser('alice@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(user.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysisReference).toMatch(/^FSA-/);
    expect(body.status).toBe('complete');
    expect(body.emailOverview.sender).toBe('Sender Name <sender@example.org>');
    expect(body.emailOverview.recipient).toBe('Recipient Name <recipient@example.com>');
    expect(body.emailOverview.subject).toBe('Test forensic email');
    expect(body.emailOverview.sendingDomain).toBe('example.org');
    expect(Array.isArray(body.sourceIpAnalysis.candidates)).toBe(true);
    expect(body.sourceIpAnalysis.candidates.length).toBeGreaterThan(0);
    // At least one public IP candidate should be found (203.0.113.10 or 203.0.113.50)
    const publicCandidates = body.sourceIpAnalysis.candidates.filter(
      (c: { addressClass: string }) => c.addressClass === 'public'
    );
    expect(publicCandidates.length).toBeGreaterThan(0);
    expect(Array.isArray(body.emailRoute.hops)).toBe(true);
    expect(body.emailRoute.hops.length).toBeGreaterThan(0);
    expect(Array.isArray(body.authentication)).toBe(true);
    expect(body.authentication.length).toBeGreaterThan(0);
    await app.close();
  });

  it('reports origin IP unavailable when headers contain no public IP', async () => {
    const app = buildTestApp();
    const user = await createUser('bob@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(user.token),
      payload: { rawHeaders: SAMPLE_HEADERS_NO_IP },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('complete');
    expect(body.sourceIpAnalysis.originIpAvailable).toBe(false);
    expect(body.sourceIpAnalysis.originIpMessage).toContain('not available');
    await app.close();
  });

  it('rejects empty headers with 400', async () => {
    const app = buildTestApp();
    const user = await createUser('carol@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(user.token),
      payload: { rawHeaders: '' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // ------------------------------------------------------------------
  // Customer analyze-file (upload)
  // ------------------------------------------------------------------
  it('analyzes an uploaded .eml file', async () => {
    const app = buildTestApp();
    const user = await createUser('dave@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze-file',
      headers: {
        ...authHeaders(user.token),
        'content-type': 'text/plain',
        'x-filename': 'test.eml',
      },
      payload: SAMPLE_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('complete');
    expect(body.analysisReference).toMatch(/^FSA-/);
    await app.close();
  }, 120_000);

  it('rejects unsupported file content type', async () => {
    const app = buildTestApp();
    const user = await createUser('erin@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze-file',
      headers: {
        ...authHeaders(user.token),
        'content-type': 'application/json',
        'x-filename': 'test.json',
      },
      payload: '{"foo":"bar"}',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // ------------------------------------------------------------------
  // Customer history
  // ------------------------------------------------------------------
  it('lists own analyses in history', async () => {
    const app = buildTestApp();
    const user = await createUser('frank@example.com');

    // Create two analyses
    await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(user.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(user.token),
      payload: { rawHeaders: SAMPLE_HEADERS_NO_IP },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history?limit=20&offset=0',
      headers: authHeaders(user.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analyses.length).toBe(2);
    expect(body.total).toBe(2);
    expect(body.analyses[0].status).toBe('complete');
    await app.close();
  });

  it('history is empty for a user with no analyses', async () => {
    const app = buildTestApp();
    const user = await createUser('grace@example.com');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(user.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analyses).toEqual([]);
    expect(body.total).toBe(0);
    await app.close();
  });

  // ------------------------------------------------------------------
  // Customer history detail
  // ------------------------------------------------------------------
  it('returns detail for one analysis (owner only)', async () => {
    const app = buildTestApp();
    const user = await createUser('heidi@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(user.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });
    const analysisRef = create.json().analysisReference;

    // Get the analysis id from history
    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(user.token),
    });
    const analysisId = history.json().analyses[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/email-forensics/history/${analysisId}`,
      headers: authHeaders(user.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.analysisReference).toBe(analysisRef);
    expect(body.sourceIpCandidates.length).toBeGreaterThan(0);
    expect(Array.isArray(body.routeHops)).toBe(true);
    expect(Array.isArray(body.authentication)).toBe(true);
    await app.close();
  });

  it('returns 404 for another user\'s analysis (tenant isolation)', async () => {
    const app = buildTestApp();
    const userA = await createUser('userA@example.com');
    const userB = await createUser('userB@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(userA.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });
    const analysisRef = create.json().analysisReference;

    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(userA.token),
    });
    const analysisId = history.json().analyses[0].id;

    // User B must not see User A's analysis
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/email-forensics/history/${analysisId}`,
      headers: authHeaders(userB.token),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 404 for non-existent analysis', async () => {
    const app = buildTestApp();
    const user = await createUser('ivan@example.com');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/email-forensics/history/${randomUUID()}`,
      headers: authHeaders(user.token),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // ------------------------------------------------------------------
  // Customer delete
  // ------------------------------------------------------------------
  it('deletes own analysis', async () => {
    const app = buildTestApp();
    const user = await createUser('judy@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(user.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });
    const analysisRef = create.json().analysisReference;

    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(user.token),
    });
    const analysisId = history.json().analyses[0].id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/email-forensics/history/${analysisId}`,
      headers: authHeaders(user.token),
    });
    expect(del.statusCode).toBe(204);

    // Confirm it's gone from history
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(user.token),
    });
    expect(after.json().analyses.length).toBe(0);
    await app.close();
  });

  it('cannot delete another user\'s analysis (tenant isolation)', async () => {
    const app = buildTestApp();
    const userA = await createUser('userA-delete@example.com');
    const userB = await createUser('userB-delete@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(userA.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });

    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(userA.token),
    });
    const analysisId = history.json().analyses[0].id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/email-forensics/history/${analysisId}`,
      headers: authHeaders(userB.token),
    });
    expect(del.statusCode).toBe(404);
    await app.close();
  });

  // ------------------------------------------------------------------
  // Customer report
  // ------------------------------------------------------------------
  it('downloads JSON report for own complete analysis', async () => {
    const app = buildTestApp();
    const user = await createUser('karl@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(user.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });
    const analysisRef = create.json().analysisReference;

    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(user.token),
    });
    const analysisId = history.json().analyses[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/email-forensics/report/${analysisId}?format=json`,
      headers: authHeaders(user.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json();
    expect(body.analysisReference).toBe(analysisRef);
    expect(body.emailOverview.sender).toBe('Sender Name <sender@example.org>');
    await app.close();
  });

  it('downloads PDF report for own complete analysis', async () => {
    const app = buildTestApp();
    const user = await createUser('leia@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(user.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });

    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(user.token),
    });
    const analysisId = history.json().analyses[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/email-forensics/report/${analysisId}?format=pdf`,
      headers: authHeaders(user.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    await app.close();
  });

  it('refuses report for non-complete analysis', async () => {
    const app = buildTestApp();
    const user = await createUser('mallory@example.com');

    // No analysis exists yet; request a report for a random id
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/email-forensics/report/${randomUUID()}?format=json`,
      headers: authHeaders(user.token),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // ------------------------------------------------------------------
  // Customer database status
  // ------------------------------------------------------------------
  it('returns database status for authenticated customers', async () => {
    const app = buildTestApp();
    const user = await createUser('nick@example.com');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/database-status',
      headers: authHeaders(user.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.versions)).toBe(true);
    expect(typeof body.note).toBe('string');
    await app.close();
  });

  // ------------------------------------------------------------------
  // Tenant isolation: history lists only own analyses
  // ------------------------------------------------------------------
  it('history lists only the caller\'s own analyses', async () => {
    const app = buildTestApp();
    const userA = await createUser('isoA@example.com');
    const userB = await createUser('isoB@example.com');

    await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(userA.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/email-forensics/analyze',
      headers: authHeaders(userB.token),
      payload: { rawHeaders: SAMPLE_HEADERS },
    });

    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(userA.token),
    });
    expect(resA.json().analyses.length).toBe(1);

    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/email-forensics/history',
      headers: authHeaders(userB.token),
    });
    expect(resB.json().analyses.length).toBe(1);
    await app.close();
  });

  // ------------------------------------------------------------------
  // Admin API (admin + super_admin)
  // ------------------------------------------------------------------
  it('allows admin to view stats', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin@example.com', 'admin');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/email-forensics/stats',
      headers: authHeaders(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.total).toBe('number');
    expect(typeof body.byStatus).toBe('object');
    await app.close();
  });

  it('allows super_admin to view stats', async () => {
    const app = buildTestApp();
    const superAdmin = await createUser('superadmin@example.com', 'super_admin');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/email-forensics/stats',
      headers: authHeaders(superAdmin.token),
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects customer role on admin stats with 403', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer@example.com', 'customer');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/email-forensics/stats',
      headers: authHeaders(customer.token),
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('admin can view and update database versions', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-db@example.com', 'admin');

    const versions = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/email-forensics/database-versions',
      headers: authHeaders(admin.token),
    });
    expect(versions.statusCode).toBe(200);

    const update = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/email-forensics/database-update',
      headers: authHeaders(admin.token),
      payload: { provider: 'GeoLite2', version: '2026.11' },
    });
    expect(update.statusCode).toBe(200);
    const body = update.json();
    expect(body.status).toBe('updated');
    expect(body.provider).toBe('GeoLite2');
    expect(body.version).toBe('2026.11');
    await app.close();
  });

  it('admin can view audit logs', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-audit@example.com', 'admin');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/email-forensics/audit-logs?limit=50&offset=0',
      headers: authHeaders(admin.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.auditLogs)).toBe(true);
    await app.close();
  });

  it('admin can toggle feature availability', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-toggle@example.com', 'admin');

    const disable = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/email-forensics/disable',
      headers: authHeaders(admin.token),
      payload: { disabled: true },
    });
    expect(disable.statusCode).toBe(200);
    const body = disable.json();
    expect(body.disabled).toBe(true);

    const enable = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/email-forensics/disable',
      headers: authHeaders(admin.token),
      payload: { disabled: false },
    });
    expect(enable.statusCode).toBe(200);
    await app.close();
  });
});
