/**
 * Email Trace Centre HTTP surface.
 *
 * The *data* here is seeded directly through the repository, so these tests prove the API's
 * authorisation, scoping and response contract — not that any mail was ever collected. No mail
 * server is contacted: the one collection test drives the real collector against a server with no
 * agent configured, which is exactly the failure path an operator will meet first.
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
import { insertEmailTraceEvents, type EmailTraceEventInsert } from '../../src/db/email-trace';

describe('email trace API', () => {
  let db: PGlite;
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  } as NodeJS.ProcessEnv);

  let customerA: { userId: string; token: string };
  let customerB: { userId: string; token: string };
  let admin: { userId: string; token: string };
  let serverId: string;
  let domainA: string;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    serverId = randomUUID();
    await db.query(
      `INSERT INTO servers (id, name, hostname, server_type, status) VALUES ($1,$2,$3,'CPANEL','active')`,
      [serverId, 'mail1', 'mail1.example.test']
    );
    customerA = await createUser('trace-a@example.test');
    customerB = await createUser('trace-b@example.test');
    admin = await createUser('trace-admin@example.test', 'admin');

    domainA = randomUUID();
    await db.query(`INSERT INTO customer_domains (id, user_id, domain_name) VALUES ($1,$2,'alpha.example')`, [
      domainA,
      customerA.userId,
    ]);
    await db.query(
      `INSERT INTO customer_domains (id, user_id, domain_name) VALUES ($1,$2,'beta.example')`,
      [randomUUID(), customerB.userId]
    );

    await seedEvents();
  });

  afterEach(async () => {
    await db.close();
  });

  function app() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(email: string, role = 'customer') {
    const userId = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`,
      [userId, email, await hashPassword('correct-horse-battery'), 'Trace User', role]
    );
    return { userId, token: signAuthToken(env, { sub: userId, role, email }) };
  }

  function event(overrides: Partial<EmailTraceEventInsert>): EmailTraceEventInsert {
    const traceId = overrides.traceId ?? '1xYzAb-000123-CD';
    const recipient = overrides.recipient ?? 'recipient@alpha.example';
    return {
      traceId,
      providerMessageId: traceId,
      sender: 'sender@alpha.example',
      recipient,
      senderDomain: 'alpha.example',
      recipientDomain: recipient.split('@')[1] ?? 'alpha.example',
      eventType: 'delivery',
      deliveryStatus: 'DELIVERED',
      smtpResponseCode: 250,
      smtpResponseText: '250 2.0.0 Ok',
      remoteHostname: 'mx.example.org',
      eventTimestamp: new Date('2026-11-08T09:14:03.000Z'),
      sourceEventHash: randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
      ...overrides,
    };
  }

  async function seedEvents() {
    await insertEmailTraceEvents(db, serverId, [
      event({ customerId: customerA.userId, traceId: '1xYzAb-000123-CD' }),
      event({
        customerId: customerA.userId,
        traceId: '1xYzAb-000124-EF',
        recipient: 'missing@alpha.example',
        deliveryStatus: 'BOUNCED',
        eventType: 'bounce',
        smtpResponseCode: 550,
        smtpResponseText: '550 5.1.1 No such user',
        eventTimestamp: new Date('2026-11-08T10:00:00.000Z'),
      }),
      event({
        customerId: customerB.userId,
        traceId: '1xYzQq-000456-GH',
        sender: 'sender@beta.example',
        recipient: 'someone@beta.example',
        senderDomain: 'beta.example',
        recipientDomain: 'beta.example',
      }),
      // Unattributed: the platform could not tie this message to any customer.
      event({
        customerId: null,
        traceId: '1xYzZz-000789-IJ',
        sender: 'nobody@unclaimed.example',
        recipient: 'ghost@unclaimed.example',
        senderDomain: 'unclaimed.example',
        recipientDomain: 'unclaimed.example',
      }),
    ]);
  }

  function authed(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it('refuses unauthenticated access everywhere', async () => {
    const api = await app();
    for (const url of [
      '/api/v1/email-trace',
      '/api/v1/email-trace/summary',
      '/api/v1/email-trace/queue',
      '/api/v1/email-trace/health',
      '/api/v1/email-trace/1xYzAb-000123-CD',
      '/api/v1/admin/email-trace',
    ]) {
      const response = await api.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('publishes the status vocabulary with honest wording', async () => {
    const api = await app();
    const response = await api.inject({ method: 'GET', url: '/api/v1/email-trace/statuses', headers: authed(customerA.token) });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { statuses: Array<{ status: string; label: string; explanation: string }>; evidenceNote: string };
    expect(body.statuses.map((entry) => entry.status)).toEqual([
      'ACCEPTED',
      'QUEUED',
      'PROCESSING',
      'DEFERRED',
      'DELIVERED',
      'BOUNCED',
      'REJECTED',
      'FAILED',
      'UNKNOWN',
    ]);
    const delivered = body.statuses.find((entry) => entry.status === 'DELIVERED')!;
    expect(delivered.explanation).toContain('not inbox placement');
    expect(body.evidenceNote.toLowerCase()).not.toContain('opened by');
  });

  it('shows a customer only their own mail', async () => {
    const api = await app();
    const response = await api.inject({ method: 'GET', url: '/api/v1/email-trace', headers: authed(customerA.token) });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { events: Array<{ traceId: string }>; total: number };
    expect(body.total).toBe(2);
    expect(body.events.map((entry) => entry.traceId).sort()).toEqual(['1xYzAb-000123-CD', '1xYzAb-000124-EF']);
  });

  it('answers 404 — never 403 — for another customer’s trace', async () => {
    const api = await app();
    for (const url of ['/api/v1/email-trace/1xYzQq-000456-GH', '/api/v1/email-trace/1xYzQq-000456-GH/timeline']) {
      const response = await api.inject({ method: 'GET', url, headers: authed(customerA.token) });
      expect(response.statusCode, url).toBe(404);
    }
    // The owner can, and the unattributed message is nobody's to see.
    expect(
      (await api.inject({ method: 'GET', url: '/api/v1/email-trace/1xYzQq-000456-GH', headers: authed(customerB.token) }))
        .statusCode
    ).toBe(200);
    expect(
      (await api.inject({ method: 'GET', url: '/api/v1/email-trace/1xYzZz-000789-IJ', headers: authed(customerA.token) }))
        .statusCode
    ).toBe(404);
  });

  it('returns a trace detail with its status explained, and the timeline oldest first', async () => {
    const api = await app();
    const detail = await api.inject({ method: 'GET', url: '/api/v1/email-trace/1xYzAb-000124-EF', headers: authed(customerA.token) });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      latestStatus: string;
      statusDetail: { explanation: string };
      events: Array<{ status: string; smtpResponseCode: number | null }>;
      evidenceNote: string;
    };
    expect(body.latestStatus).toBe('BOUNCED');
    expect(body.statusDetail.explanation).toContain('rejected the message permanently');
    expect(body.events[0]?.smtpResponseCode).toBe(550);
    expect(body.evidenceNote).toContain('never observed');

    const timeline = await api.inject({
      method: 'GET',
      url: '/api/v1/email-trace/1xYzAb-000124-EF/timeline',
      headers: authed(customerA.token),
    });
    expect(timeline.statusCode).toBe(200);
    const timelineBody = timeline.json() as { events: Array<{ occurredAt: string }> };
    expect(timelineBody.events.map((entry) => entry.occurredAt)).toEqual(['2026-11-08T10:00:00.000Z']);
  });

  it('filters by status and rejects an unknown status instead of ignoring it', async () => {
    const api = await app();
    const bounced = await api.inject({
      method: 'GET',
      url: '/api/v1/email-trace?status=BOUNCED',
      headers: authed(customerA.token),
    });
    expect((bounced.json() as { total: number }).total).toBe(1);

    const bad = await api.inject({
      method: 'GET',
      url: '/api/v1/email-trace?status=SENT',
      headers: authed(customerA.token),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('summarises every status, including the ones that are zero', async () => {
    const api = await app();
    const response = await api.inject({
      method: 'GET',
      url: '/api/v1/email-trace/summary?window=30d',
      headers: authed(customerA.token),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { total: number; byStatus: Record<string, number>; evidenceNote: string };
    expect(Object.keys(body.byStatus)).toHaveLength(9);
    expect(body.byStatus.DELIVERED).toBe(1);
    expect(body.byStatus.BOUNCED).toBe(1);
    expect(body.byStatus.QUEUED).toBe(0);
    expect(body.evidenceNote).toContain('SMTP');
  });

  it('never counts another customer’s message in a summary', async () => {
    const api = await app();
    const b = await api.inject({
      method: 'GET',
      url: '/api/v1/email-trace/summary?window=30d',
      headers: authed(customerB.token),
    });
    expect((b.json() as { total: number }).total).toBe(1);
  });

  it('scopes the domain view to a domain the caller owns', async () => {
    const api = await app();
    const own = await api.inject({
      method: 'GET',
      url: `/api/v1/email-trace/domains/${domainA}`,
      headers: authed(customerA.token),
    });
    expect(own.statusCode).toBe(200);
    const body = own.json() as { domain: { name: string }; total: number };
    expect(body.domain.name).toBe('alpha.example');
    expect(body.total).toBe(2);

    const foreign = await api.inject({
      method: 'GET',
      url: `/api/v1/email-trace/domains/${domainA}`,
      headers: authed(customerB.token),
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('reports collection health honestly rather than implying an empty but healthy mailbox', async () => {
    const api = await app();
    const response = await api.inject({ method: 'GET', url: '/api/v1/email-trace/health', headers: authed(customerA.token) });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { sources: unknown[]; note: string };
    // The seeded events did not come from a configured source, so there is nothing to claim.
    expect(body.sources).toHaveLength(0);
    expect(body.note).toContain('could not be read');
  });

  it('gates every admin endpoint on an admin role', async () => {
    const api = await app();
    const customerAttempts = [
      { method: 'GET' as const, url: '/api/v1/admin/email-trace' },
      { method: 'GET' as const, url: '/api/v1/admin/email-trace/sources' },
      { method: 'GET' as const, url: '/api/v1/admin/email-trace/collection-runs' },
      { method: 'POST' as const, url: '/api/v1/admin/email-trace/collect', payload: { serverId } },
    ];
    for (const attempt of customerAttempts) {
      const response = await api.inject({ ...attempt, headers: authed(customerA.token) });
      expect(response.statusCode, attempt.url).toBe(403);
    }
  });

  it('lets an admin see unattributed mail, and only as ids', async () => {
    const api = await app();
    const response = await api.inject({ method: 'GET', url: '/api/v1/admin/email-trace', headers: authed(admin.token) });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      total: number;
      events: Array<{ traceId: string; customerId: string | null; customerEmail?: string }>;
    };
    expect(body.total).toBe(4);
    const unattributed = body.events.find((entry) => entry.traceId === '1xYzZz-000789-IJ');
    expect(unattributed?.customerId).toBeNull();
    // No tenant email/name leaks into the trace payload.
    expect(body.events.every((entry) => !('customerEmail' in entry))).toBe(true);
  });

  it('skips a server that was never opted in, and records a failure — never a success — once it is enabled', async () => {
    const api = await app();

    // No source row exists yet, so the first call creates one switched off and refuses to read.
    const first = await api.inject({
      method: 'POST',
      url: '/api/v1/admin/email-trace/collect',
      headers: authed(admin.token),
      payload: { serverId },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { results: Array<{ status: string; reason: string; collected: number; runId: string | null }> };
    expect(firstBody.results[0]).toMatchObject({ status: 'skipped', reason: 'collection_disabled', collected: 0, runId: null });

    // Enabling collection on a server with no agent configured must fail loudly, not quietly.
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM email_trace_sources WHERE server_id = $1`, [serverId]);
    const enabled = await api.inject({
      method: 'PATCH',
      url: `/api/v1/admin/email-trace/sources/${rows[0]!.id}`,
      headers: authed(admin.token),
      payload: { collectionEnabled: true },
    });
    expect(enabled.statusCode).toBe(200);

    const second = await api.inject({
      method: 'POST',
      url: '/api/v1/admin/email-trace/collect',
      headers: authed(admin.token),
      payload: { serverId },
    });
    const secondBody = second.json() as { results: Array<{ status: string; reason: string; collected: number; runId: string | null }> };
    expect(secondBody.results[0]).toMatchObject({ status: 'failed', collected: 0 });
    expect(secondBody.results[0]?.reason).toBe('agent_unavailable');
    expect(secondBody.results[0]?.runId).toBeTruthy();

    const runs = await api.inject({
      method: 'GET',
      url: '/api/v1/admin/email-trace/collection-runs',
      headers: authed(admin.token),
    });
    expect(runs.statusCode).toBe(200);
    const runsBody = runs.json() as { runs: Array<{ status: string; errorClass: string | null }>; total: number };
    expect(runsBody.total).toBe(1);
    expect(runsBody.runs[0]).toMatchObject({ status: 'failed', errorClass: 'agent_unavailable' });
    expect(runsBody.runs.every((run) => run.status !== 'ok')).toBe(true);

    const sources = await api.inject({
      method: 'GET',
      url: '/api/v1/admin/email-trace/sources',
      headers: authed(admin.token),
    });
    const sourcesBody = sources.json() as { sources: Array<{ status: string; lastErrorCode: string | null }> };
    expect(sourcesBody.sources[0]).toMatchObject({ status: 'error', lastErrorCode: 'agent_unavailable' });
  });

  it('requires a server id (or "all") to collect', async () => {
    const api = await app();
    const response = await api.inject({
      method: 'POST',
      url: '/api/v1/admin/email-trace/collect',
      headers: authed(admin.token),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('writes an audit row for an admin collection request', async () => {
    const api = await app();
    await api.inject({
      method: 'POST',
      url: '/api/v1/admin/email-trace/collect',
      headers: authed(admin.token),
      payload: { serverId },
    });
    const { rows } = await db.query<{ action: string; resource_type: string; actor_id: string | null }>(
      `SELECT action, resource_type, actor_id FROM audit_logs WHERE resource_type = 'email_trace'`
    );
    expect(rows.some((row) => row.action === 'email_trace.collect_requested' && row.actor_id === admin.userId)).toBe(true);
  });

  it('records that a trace was read, without copying addresses into the audit log', async () => {
    const api = await app();
    await api.inject({ method: 'GET', url: '/api/v1/email-trace/1xYzAb-000123-CD', headers: authed(customerA.token) });

    const { rows } = await db.query<{ action: string; resource_id: string | null; metadata: Record<string, unknown> }>(
      `SELECT action, resource_id, metadata FROM audit_logs
        WHERE action = 'email_trace.detail_view' AND actor_id = $1`,
      [customerA.userId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resource_id).toBe('1xYzAb-000123-CD');
    const serialised = JSON.stringify(rows[0]?.metadata ?? {});
    expect(serialised).not.toContain('@alpha.example');
  });

  it('does not expose raw log lines anywhere in a trace response', async () => {
    const api = await app();
    const response = await api.inject({ method: 'GET', url: '/api/v1/email-trace/1xYzAb-000123-CD', headers: authed(customerA.token) });
    const serialised = JSON.stringify(response.json());
    expect(serialised).not.toContain('P=esmtpa');
    expect(serialised).not.toContain('A=dovecot_login');
    expect(serialised).not.toContain('Quarterly invoice');
  });
});
