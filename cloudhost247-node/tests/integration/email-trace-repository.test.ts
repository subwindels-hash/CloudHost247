/**
 * Email Trace repository against a real PostgreSQL engine (PGlite + the real migration runner).
 *
 * This is the storage half of Slice 1: schema, deduplication, tenant scoping, pagination, summary,
 * collection runs and retention. It exercises `database/migrations/0089_create_email_trace_centre.sql`
 * exactly as production would apply it — no mocks, no hand-written DDL in the test.
 *
 * What it cannot prove: that any of this is ever populated, because no collector exists yet (Slice 2)
 * and no mail server has been read. The data below is fabricated for the test and is labelled as such.
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import {
  completeEmailTraceCollectionRun,
  ensureEmailTraceSource,
  findEmailTraceSourceById,
  findEmailTraceSourceByServer,
  findEmailTraceTimeline,
  insertEmailTraceEvents,
  listEmailTraceCollectionRuns,
  listEmailTraceEvents,
  listEmailTraceSources,
  listLatestQueueSnapshots,
  markEmailTraceSourceFailure,
  markEmailTraceSourceSuccess,
  startEmailTraceCollectionRun,
  summariseEmailTraceEvents,
  trimEmailTraceCollectionRuns,
  trimEmailTraceEvents,
  updateEmailTraceSource,
  type EmailTraceEventInsert,
} from '../../src/db/email-trace';

const SERVER = randomUUID();
const OTHER_SERVER = randomUUID();
const CUSTOMER_A = randomUUID();
const CUSTOMER_B = randomUUID();

function event(overrides: Partial<EmailTraceEventInsert> = {}): EmailTraceEventInsert {
  const traceId = overrides.traceId ?? '1xYzAb-000123-CD';
  const eventTimestamp = overrides.eventTimestamp ?? new Date('2026-11-08T09:14:03.000Z');
  const recipient = overrides.recipient ?? 'recipient@example.org';
  return {
    traceId,
    providerMessageId: traceId,
    sender: 'sender@example.com',
    recipient,
    senderDomain: 'example.com',
    recipientDomain: recipient.split('@')[1] ?? 'example.org',
    eventType: 'delivery',
    deliveryStatus: 'DELIVERED',
    smtpResponseCode: 250,
    smtpResponseText: '250 2.0.0 Ok',
    remoteHostname: 'mx.example.org',
    eventTimestamp,
    // Unique per event unless a test deliberately reuses one to prove deduplication.
    sourceEventHash: overrides.sourceEventHash ?? randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
    ...overrides,
  };
}

describe('email trace repository', () => {
  let db: PGlite;
  let client: PgliteClient;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });

    for (const [userId, email] of [
      [CUSTOMER_A, 'customer-a@example.test'],
      [CUSTOMER_B, 'customer-b@example.test'],
    ] as const) {
      await db.query(
        `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,'customer')`,
        [userId, email, 'x'.repeat(60), 'Test Customer']
      );
    }

    for (const [serverId, hostname] of [
      [SERVER, 'mail1.example.test'],
      [OTHER_SERVER, 'mail2.example.test'],
    ] as const) {
      await db.query(
        `INSERT INTO servers (id, name, hostname, server_type, status) VALUES ($1,$2,$3,'CPANEL','active')`,
        [serverId, hostname, hostname]
      );
    }
  });

  afterEach(async () => {
    await db.close();
  });

  it('stores events and refuses to store the same event twice', async () => {
    const batch = [
      event({ customerId: CUSTOMER_A, sourceEventHash: 'a'.repeat(64) }),
      event({ customerId: CUSTOMER_A, sourceEventHash: 'b'.repeat(64), eventType: 'submission', deliveryStatus: 'ACCEPTED' }),
    ];

    const first = await insertEmailTraceEvents(client, SERVER, batch);
    expect(first).toEqual({ inserted: 2, duplicates: 0 });

    // Re-collecting the same window (crash recovery, rotated file, manual run) must not double-count.
    const second = await insertEmailTraceEvents(client, SERVER, batch);
    expect(second).toEqual({ inserted: 0, duplicates: 2 });

    const listed = await listEmailTraceEvents(client, {});
    expect(listed.total).toBe(2);
  });

  it('treats the same hash on a different server as a different event', async () => {
    const shared = 'c'.repeat(64);
    await insertEmailTraceEvents(client, SERVER, [event({ sourceEventHash: shared, customerId: CUSTOMER_A })]);
    await insertEmailTraceEvents(client, OTHER_SERVER, [event({ sourceEventHash: shared, customerId: CUSTOMER_A })]);

    const listed = await listEmailTraceEvents(client, {});
    expect(listed.total).toBe(2);
    expect(new Set(listed.events.map((row) => row.source_server_id)).size).toBe(2);
  });

  it('filters by status, domain, message id, reply code and date range', async () => {
    await insertEmailTraceEvents(client, SERVER, [
      event({ traceId: '1xYzAb-000123-CD', customerId: CUSTOMER_A, deliveryStatus: 'DELIVERED' }),
      event({
        traceId: '1xYzAb-000124-EF',
        customerId: CUSTOMER_A,
        recipient: 'bounced@example.net',
        recipientDomain: 'example.net',
        deliveryStatus: 'BOUNCED',
        eventType: 'bounce',
        smtpResponseCode: 550,
        eventTimestamp: new Date('2026-11-09T10:00:00.000Z'),
      }),
      event({
        traceId: '1xYzAb-000125-GH',
        customerId: CUSTOMER_B,
        deliveryStatus: 'DEFERRED',
        eventType: 'deferral',
        smtpResponseCode: 450,
      }),
    ]);

    expect((await listEmailTraceEvents(client, { statuses: ['BOUNCED'] })).total).toBe(1);
    expect((await listEmailTraceEvents(client, { domain: 'example.net' })).total).toBe(1);
    expect((await listEmailTraceEvents(client, { messageId: '1xYzAb-000125-GH' })).total).toBe(1);
    expect((await listEmailTraceEvents(client, { smtpCode: 450 })).total).toBe(1);
    expect(
      (await listEmailTraceEvents(client, { from: new Date('2026-11-09T00:00:00.000Z') })).total
    ).toBe(1);
  });

  it('pages newest first and reports the unpaged total', async () => {
    await insertEmailTraceEvents(client, SERVER, [
      event({ traceId: '1xYzAb-000123-CD', eventTimestamp: new Date('2026-11-08T09:00:00.000Z') }),
      event({ traceId: '1xYzAb-000124-EF', eventTimestamp: new Date('2026-11-08T10:00:00.000Z') }),
      event({ traceId: '1xYzAb-000125-GH', eventTimestamp: new Date('2026-11-08T11:00:00.000Z') }),
    ]);

    const page = await listEmailTraceEvents(client, { limit: 2, offset: 0 });
    expect(page.events.map((row) => row.trace_id)).toEqual(['1xYzAb-000125-GH', '1xYzAb-000124-EF']);
    expect(page.total).toBe(3);

    const next = await listEmailTraceEvents(client, { limit: 2, offset: 2 });
    expect(next.events.map((row) => row.trace_id)).toEqual(['1xYzAb-000123-CD']);
  });

  it('caps the page size instead of trusting the caller', async () => {
    const page = await listEmailTraceEvents(client, { limit: 10_000 });
    expect(page.limit).toBe(200);
  });

  it('scopes reads to the caller and hides another customer’s trace completely', async () => {
    await insertEmailTraceEvents(client, SERVER, [
      event({ traceId: '1xYzAb-000123-CD', customerId: CUSTOMER_A }),
      event({ traceId: '1xYzAb-000124-EF', customerId: CUSTOMER_B }),
    ]);

    const own = await listEmailTraceEvents(client, {}, { customerIds: [CUSTOMER_A] });
    expect(own.total).toBe(1);
    expect(own.events[0]?.trace_id).toBe('1xYzAb-000123-CD');

    // Not 403: a customer must not be able to tell "exists but not yours" from "does not exist".
    expect(await findEmailTraceTimeline(client, '1xYzAb-000124-EF', { customerIds: [CUSTOMER_A] })).toBeNull();
    expect(await findEmailTraceTimeline(client, '1xYzAb-000124-EF', { customerIds: [CUSTOMER_B] })).toHaveLength(1);
  });

  it('treats an empty scope as a closed scope, not as "no filter"', async () => {
    await insertEmailTraceEvents(client, SERVER, [event({ customerId: CUSTOMER_A })]);
    const closed = await listEmailTraceEvents(client, {}, { customerIds: [] });
    expect(closed.total).toBe(0);
  });

  it('returns a timeline oldest-first', async () => {
    await insertEmailTraceEvents(client, SERVER, [
      event({ traceId: '1xYzAb-000123-CD', eventType: 'delivery', deliveryStatus: 'DELIVERED', eventTimestamp: new Date('2026-11-08T09:14:05.000Z') }),
      event({ traceId: '1xYzAb-000123-CD', eventType: 'submission', deliveryStatus: 'ACCEPTED', eventTimestamp: new Date('2026-11-08T09:14:02.000Z'), smtpResponseCode: null }),
    ]);

    const timeline = await findEmailTraceTimeline(client, '1xYzAb-000123-CD');
    expect(timeline?.map((row) => row.event_type)).toEqual(['submission', 'delivery']);
  });

  it('summarises status counts for a window and a scope', async () => {
    await insertEmailTraceEvents(client, SERVER, [
      event({ customerId: CUSTOMER_A, deliveryStatus: 'DELIVERED' }),
      event({ customerId: CUSTOMER_A, deliveryStatus: 'DELIVERED' }),
      event({ customerId: CUSTOMER_A, deliveryStatus: 'DEFERRED', eventType: 'deferral', smtpResponseCode: 450 }),
      event({ customerId: CUSTOMER_B, deliveryStatus: 'BOUNCED', eventType: 'bounce', smtpResponseCode: 550 }),
    ]);

    const summary = await summariseEmailTraceEvents(client, {}, { customerIds: [CUSTOMER_A] });
    expect(summary.total).toBe(3);
    expect(summary.byStatus.DELIVERED).toBe(2);
    expect(summary.byStatus.DEFERRED).toBe(1);
    expect(summary.byStatus.BOUNCED).toBe(0);
    expect(Object.keys(summary.byStatus)).toHaveLength(9);
  });

  it('deletes expired events but holds back the ones pinned by an investigation', async () => {
    const old = new Date(Date.now() - 60 * 86_400_000);
    await insertEmailTraceEvents(client, SERVER, [
      event({ traceId: '1xYzAb-000123-CD', eventTimestamp: old }),
      event({ traceId: '1xYzAb-000124-EF', eventTimestamp: old }),
      event({ traceId: '1xYzAb-000125-GH', eventTimestamp: new Date() }),
    ]);
    await db.query(`UPDATE email_trace_events SET retention_hold = true WHERE trace_id = '1xYzAb-000124-EF'`);

    const trimmed = await trimEmailTraceEvents(client, 30);
    expect(trimmed).toEqual({ deleted: 1, held: 1 });

    const remaining = await listEmailTraceEvents(client, {});
    expect(remaining.total).toBe(2);
  });

  it('keeps source configuration, checkpoint and failure state', async () => {
    const created = await ensureEmailTraceSource(client, {
      serverId: SERVER,
      providerType: 'exim_cpanel',
      collectionMethod: 'agent',
      configReference: 'agent_secret',
    });
    expect(created.status).toBe('not_configured');
    expect(created.collection_enabled).toBe(false);
    // The source row references a credential by name only — never a secret.
    expect(created.config_reference).toBe('agent_secret');

    // A second call must not create a duplicate row for the same server.
    const again = await ensureEmailTraceSource(client, { serverId: SERVER });
    expect(again.id).toBe(created.id);
    expect(await listEmailTraceSources(client)).toHaveLength(1);

    const enabled = await updateEmailTraceSource(client, created.id, {
      collectionEnabled: true,
      status: 'degraded',
      capability: { mainlog: 'available', queue: 'unsupported' },
      retentionDaysOverride: 14,
    });
    expect(enabled?.collection_enabled).toBe(true);
    expect(enabled?.capability).toEqual({ mainlog: 'available', queue: 'unsupported' });

    await markEmailTraceSourceSuccess(client, created.id, { offset: 4096 }, { mainlog: 'available' });
    const healthy = await findEmailTraceSourceById(client, created.id);
    expect(healthy?.status).toBe('ok');
    expect(healthy?.checkpoint).toEqual({ offset: 4096 });
    expect(healthy?.last_success_at).not.toBeNull();

    await markEmailTraceSourceFailure(client, created.id, 'agent_unreachable', 'The agent did not answer');
    const broken = await findEmailTraceSourceByServer(client, SERVER);
    expect(broken?.status).toBe('error');
    expect(broken?.last_error_code).toBe('agent_unreachable');
    // The checkpoint survives a failure, so the retry re-reads rather than skips.
    expect(broken?.checkpoint).toEqual({ offset: 4096 });
  });

  it('records a collection run and exposes the queue as of that run', async () => {
    const source = await ensureEmailTraceSource(client, { serverId: SERVER, collectionMethod: 'agent' });
    const run = await startEmailTraceCollectionRun(client, { sourceId: source.id, serverId: SERVER });
    expect(run.status).toBe('running');

    const completed = await completeEmailTraceCollectionRun(client, run.id, {
      status: 'ok',
      recordsSeen: 12,
      recordsCollected: 10,
      recordsRejected: 2,
      queueCount: 4,
      queueOldestSeconds: 172_800,
      queueDeferred: 1,
      checkpointAfter: { offset: 8192 },
    });
    expect(completed?.status).toBe('ok');
    expect(completed?.records_collected).toBe(10);

    const runs = await listEmailTraceCollectionRuns(client, { sourceId: source.id });
    expect(runs.total).toBe(1);

    const snapshots = await listLatestQueueSnapshots(client);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ server_id: SERVER, queue_count: 4, queue_deferred: 1 });
  });

  it('trims old collection runs without touching recent ones', async () => {
    const source = await ensureEmailTraceSource(client, { serverId: SERVER });
    const run = await startEmailTraceCollectionRun(client, { sourceId: source.id, serverId: SERVER });
    await db.query(`UPDATE email_trace_collection_runs SET started_at = now() - interval '120 days' WHERE id = $1`, [run.id]);
    await startEmailTraceCollectionRun(client, { sourceId: source.id, serverId: SERVER });

    expect(await trimEmailTraceCollectionRuns(client, 90)).toBe(1);
    expect((await listEmailTraceCollectionRuns(client, {})).total).toBe(1);
  });

  it('enforces the schema’s own guard rails rather than trusting the caller', async () => {
    await expect(
      db.query(
        `INSERT INTO email_trace_events (id, trace_id, sender, recipient, event_type, delivery_status,
           event_timestamp, source_server_id, source_event_hash)
         VALUES ($1,'1xYzAb-000123-CD','sender@example.com','recipient@example.org','delivery','SENT', now(), $2, $3)`,
        [randomUUID(), SERVER, 'd'.repeat(64)]
      )
    ).rejects.toThrow();

    await expect(
      db.query(
        `INSERT INTO email_trace_events (id, trace_id, sender, recipient, event_type, delivery_status,
           event_timestamp, source_server_id, source_event_hash)
         VALUES ($1,'1xYzAb-000123-CD','sender@example.com','recipient@example.org','delivery','DELIVERED', now(), $2, $3)`,
        [randomUUID(), SERVER, 'short']
      )
    ).rejects.toThrow();

    await expect(
      db.query(
        `INSERT INTO email_trace_events (id, trace_id, sender, recipient, event_type, delivery_status,
           event_timestamp, source_server_id, source_event_hash, smtp_response_code)
         VALUES ($1,'1xYzAb-000123-CD','sender@example.com','recipient@example.org','delivery','DELIVERED', now(), $2, $3, 700)`,
        [randomUUID(), SERVER, 'e'.repeat(64)]
      )
    ).rejects.toThrow();
  });
});
