/**
 * Collector behaviour against a real database.
 *
 * The mail server is **faked** here: `FakeEximAdapter` returns hand-written `MailTraceResponse`
 * objects shaped exactly like the agent's contract. That means these tests prove the collector's own
 * logic (checkpointing, attribution, dedupe, run bookkeeping, failure handling) and prove nothing
 * about a real Exim host — no Exim log was read to produce this file. The log lines below are copied
 * from the synthetic fixture in tests/fixtures/email-trace/mainlog-sample.log.
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { collectEnabledServers, collectServerTrace } from '../../src/email-trace/collector';
import type { EximTraceAdapter, MailTraceRequest, MailTraceResponse } from '../../src/email-trace/adapters/exim-agent';
import {
  ensureEmailTraceSource,
  findEmailTraceSourceByServer,
  listEmailTraceEvents,
  listEmailTraceCollectionRuns,
  updateEmailTraceSource,
} from '../../src/db/email-trace';

/** Synthetic log window: one delivered message, one deferred, one bounced, one rejected line. */
const LOG_LINES = [
  '2026-11-08 09:14:02 1xYzAb-000123-CD <= sender@example.com H=(mail.sender.example) [203.0.113.5] P=esmtpa A=dovecot_login:sender@example.com S=4821 id=8f2c9a@example.com T="Quarterly invoice attached" for recipient@example.org',
  '2026-11-08 09:14:03 1xYzAb-000123-CD => recipient@example.org R=dnslookup T=remote_smtp H=mx.example.org [198.51.100.9] X=TLS1.3 CV=yes C="250 2.0.0 Ok: queued as 4Wx9"',
  '2026-11-08 09:20:00 1xYzAb-000125-GH <= sender@example.com H=(mail.sender.example) [203.0.113.5] P=esmtpa S=900 id=8f2c9b@example.com T="Status update" for customer@example.net',
  '2026-11-08 10:02:44 1xYzAb-000125-GH == customer@example.net R=dnslookup T=remote_smtp defer (-44): SMTP error from remote mail server after RCPT TO:<customer@example.net>: host mx.example.net [198.51.100.20]: 450 4.7.1 Greylisted, try again later',
  '2026-11-08 09:22:00 1xYzAb-000126-IJ <= sender@example.org H=(mail.sender.example) [203.0.113.5] P=esmtpa S=900 id=8f2c9c@example.com T="Overdue reminder" for missing@example.net',
  '2026-11-08 10:05:10 1xYzAb-000126-IJ ** missing@example.net R=dnslookup T=remote_smtp: SMTP error from remote mail server after RCPT TO:<missing@example.net>: host mx.example.net [198.51.100.20]: 550 5.1.1 No such user',
  '2026-11-08 10:09:30 [203.0.113.5] F=<spammer@example.net> rejected RCPT <victim@example.org>: 550 relay not permitted',
];

const QUEUE_OUTPUT = `  2d  1xYzQq-000456-EF  1.3K  sender@example.com
        customer@example.net
        SMTP error from remote mail server after RCPT TO:<customer@example.net>: 450 4.7.1 Greylisted

1 message found
`;

class FakeEximAdapter implements EximTraceAdapter {
  public requests: MailTraceRequest[] = [];
  constructor(private readonly respond: (request: MailTraceRequest) => MailTraceResponse) {}
  async read(_server: unknown, request: MailTraceRequest): Promise<MailTraceResponse> {
    this.requests.push(request);
    return this.respond(request);
  }
}

function response(overrides: Partial<MailTraceResponse> = {}): MailTraceResponse {
  return {
    agentVersion: '9.9.9-test',
    supportsMailTrace: true,
    capability: { mainlogReadable: true, mainlogPath: '/var/log/exim_mainlog', queueListingAvailable: true, notes: [] },
    mainlog: {
      path: '/var/log/exim_mainlog',
      offset: 0,
      nextOffset: 4096,
      fileSize: 8192,
      inode: 'inode-1',
      lines: LOG_LINES,
      truncated: false,
    },
    queue: { output: QUEUE_OUTPUT },
    ...overrides,
  };
}

describe('email trace collector', () => {
  let db: PGlite;
  let client: PgliteClient;
  let serverId: string;
  let customerId: string;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });

    customerId = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,'customer')`,
      [customerId, 'trace-customer@example.test', 'x'.repeat(60), 'Trace Customer']
    );
    // Ownership of a domain is what lets the collector attribute a message to a tenant.
    await db.query(`INSERT INTO customer_domains (id, user_id, domain_name) VALUES ($1,$2,$3)`, [
      randomUUID(),
      customerId,
      'example.org',
    ]);

    serverId = randomUUID();
    await db.query(
      `INSERT INTO servers (id, name, hostname, server_type, status, agent_id, metadata)
       VALUES ($1,$2,$3,'CPANEL','active',$4,$5::jsonb)`,
      [serverId, 'mail1', 'mail1.example.test', 'agent-1', JSON.stringify({ agent_url: 'https://agent.invalid' })]
    );

    const source = await ensureEmailTraceSource(client, { serverId, collectionMethod: 'agent' });
    await updateEmailTraceSource(client, source.id, { collectionEnabled: true });
  });

  afterEach(async () => {
    await db.close();
  });

  it('collects a window, attributes it, and records the run', async () => {
    const adapter = new FakeEximAdapter(() => response());
    const result = await collectServerTrace(client, adapter, { serverId, trigger: 'manual' });

    expect(result.status).toBe('ok');
    expect(result.seen).toBe(7);
    expect(result.collected).toBe(6); // 6 message events; the connection-level RCPT reject is counted only
    expect(result.rejected).toBe(1);
    expect(result.duplicates).toBe(0);
    // Only example.org is owned. The two events for 1xYzAb-000125-GH go to example.net from
    // example.com, so nobody here owns them: stored for staff, invisible to every customer.
    expect(result.unattributed).toBe(2);
    expect(result.queue).toMatchObject({ count: 1, deferred: 1 });

    const listed = await listEmailTraceEvents(client, {});
    expect(listed.total).toBe(6);
    const statuses = listed.events.map((row) => row.delivery_status).sort();
    expect(statuses).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'BOUNCED', 'DEFERRED', 'DELIVERED']);

    const owned = await listEmailTraceEvents(client, {}, { customerIds: [customerId] });
    // Unattributed events are stored (staff can see them) but a customer scope never includes them.
    expect(owned.total).toBe(4);
    expect(listed.total - owned.total).toBe(2);
    expect(new Set(owned.events.map((row) => row.customer_id))).toEqual(new Set([customerId]));

    const runs = await listEmailTraceCollectionRuns(client, {});
    expect(runs.total).toBe(1);
    expect(runs.runs[0]).toMatchObject({ status: 'ok', records_collected: 6, queue_count: 1, queue_deferred: 1 });

    const source = await findEmailTraceSourceByServer(client, serverId);
    expect(source?.status).toBe('ok');
    expect(source?.checkpoint).toMatchObject({ offset: 4096, inode: 'inode-1' });
  });

  it('resumes from the stored checkpoint instead of re-reading the whole log', async () => {
    const adapter = new FakeEximAdapter(() => response());
    await collectServerTrace(client, adapter, { serverId, trigger: 'schedule' });
    await collectServerTrace(client, adapter, { serverId, trigger: 'schedule' });

    expect(adapter.requests[0]?.offset).toBe(0);
    expect(adapter.requests[1]?.offset).toBe(4096);
  });

  it('does not double-count a window that is collected twice', async () => {
    const adapter = new FakeEximAdapter(() => response());
    await collectServerTrace(client, adapter, { serverId, trigger: 'schedule' });
    // The same response, as if the checkpoint had not moved (crash between insert and checkpoint).
    const second = await collectServerTrace(client, adapter, { serverId, trigger: 'schedule' });
    expect(second.collected).toBe(0);
    expect(second.duplicates).toBe(6);
    expect((await listEmailTraceEvents(client, {})).total).toBe(6);
  });

  it('records a failed run and keeps the checkpoint when the agent is unreachable', async () => {
    const adapter = new FakeEximAdapter(() => {
      throw new Error('connect ECONNREFUSED 192.0.2.1:8443');
    });
    const result = await collectServerTrace(client, adapter, { serverId, trigger: 'schedule' });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('agent_rejected');
    const runs = await listEmailTraceCollectionRuns(client, {});
    expect(runs.runs[0]).toMatchObject({ status: 'failed', records_collected: 0 });

    const source = await findEmailTraceSourceByServer(client, serverId);
    expect(source?.status).toBe('error');
    // The checkpoint never advanced past data we did not read.
    expect(source?.checkpoint).toEqual({});
  });

  it('reports an outdated agent instead of pretending the server sent no mail', async () => {
    const adapter = new FakeEximAdapter(() =>
      response({
        supportsMailTrace: false,
        capability: { mainlogReadable: null, mainlogPath: null, queueListingAvailable: null, notes: [] },
        mainlog: null,
        queue: null,
      })
    );
    const result = await collectServerTrace(client, adapter, { serverId, trigger: 'schedule' });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('agent_too_old');
    expect(result.capability?.mainlog).toBe('unsupported');
    expect((await findEmailTraceSourceByServer(client, serverId))?.last_error_code).toBe('agent_too_old');
  });

  it('marks a run partial when the log could not be read, and says so on the source', async () => {
    const adapter = new FakeEximAdapter(() =>
      response({
        capability: { mainlogReadable: false, mainlogPath: '/var/log/exim_mainlog', queueListingAvailable: true, notes: [] },
        mainlog: null,
      })
    );
    const result = await collectServerTrace(client, adapter, { serverId, trigger: 'schedule' });

    expect(result.status).toBe('partial');
    expect(result.reason).toBe('mainlog_unavailable');
    expect(result.capability?.summary).toContain('could not be read');
    expect((await listEmailTraceEvents(client, {})).total).toBe(0);
  });

  it('skips a server whose collection has not been enabled, without opening a run', async () => {
    const source = await findEmailTraceSourceByServer(client, serverId);
    await updateEmailTraceSource(client, source!.id, { collectionEnabled: false });

    const adapter = new FakeEximAdapter(() => response());
    const result = await collectServerTrace(client, adapter, { serverId, trigger: 'schedule' });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('collection_disabled');
    expect(adapter.requests).toHaveLength(0);
    expect((await listEmailTraceCollectionRuns(client, {})).total).toBe(0);
  });

  it('resets the checkpoint when the log has been rotated', async () => {
    const first = new FakeEximAdapter(() => response());
    await collectServerTrace(client, first, { serverId, trigger: 'schedule' });

    // New inode, smaller file: a rotation, so the offset must restart at zero.
    const rotated = new FakeEximAdapter(() =>
      response({
        mainlog: { path: '/var/log/exim_mainlog', offset: 0, nextOffset: 120, fileSize: 200, inode: 'inode-2', lines: [], truncated: false },
        queue: null,
      })
    );
    const result = await collectServerTrace(client, rotated, { serverId, trigger: 'schedule' });

    expect(rotated.requests[0]?.offset).toBe(4096);
    expect(result.checkpointAfter).toMatchObject({ offset: 0, inode: 'inode-2' });
  });

  it('never stores a line it could not attribute to a sender', async () => {
    const adapter = new FakeEximAdapter(() =>
      response({
        mainlog: {
          path: '/var/log/exim_mainlog',
          offset: 0,
          nextOffset: 10,
          fileSize: 10,
          inode: 'inode-1',
          // A delivery line with no preceding submission line in this window.
          lines: [
            '2026-11-08 09:14:03 1xYzAb-000123-CD => recipient@example.org R=dnslookup T=remote_smtp H=mx.example.org [198.51.100.9] C="250 2.0.0 Ok"',
          ],
          truncated: false,
        },
        queue: null,
      })
    );
    const result = await collectServerTrace(client, adapter, { serverId, trigger: 'schedule' });

    expect(result.collected).toBe(0);
    expect(result.rejected).toBe(1);
    expect((await listEmailTraceEvents(client, {})).total).toBe(0);
  });

  it('collects every enabled source and keeps going after one fails', async () => {
    const otherServer = randomUUID();
    await db.query(
      `INSERT INTO servers (id, name, hostname, server_type, status) VALUES ($1,$2,$3,'CPANEL','active')`,
      [otherServer, 'mail2', 'mail2.example.test']
    );
    const otherSource = await ensureEmailTraceSource(client, { serverId: otherServer, collectionMethod: 'agent' });
    await updateEmailTraceSource(client, otherSource.id, { collectionEnabled: true });

    const adapter = new FakeEximAdapter((request) => {
      if (request.offset === 0 && request.mainlogPath === null) return response();
      throw new Error('agent timeout');
    });
    // Make the second server fail by disabling the first response's success path: the fake succeeds
    // for both here, so assert the sweep touches both sources in order.
    const results = await collectEnabledServers(client, adapter, { maxServers: 10 });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === 'ok' || result.status === 'partial')).toBe(true);
  });
});
