/**
 * DNS propagation — end-to-end through the real route handlers (A11b).
 *
 * The customer DNS API used to write only to the platform's own tables, so a zone whose `provider`
 * column said CLOUDFLARE could exist locally while never having been created at Cloudflare. These
 * tests drive `buildApp` with an injected provider so the genuine handlers, the genuine propagation
 * layer and the genuine Postgres schema all run, and assert the two properties that matter:
 *
 *   1. an external zone's changes reach the provider, and the local row records what the provider
 *      actually returned (its nameservers, its zone id) — never the platform's defaults;
 *   2. when the provider cannot be reached or is not configured, the request fails and NOTHING is
 *      written locally — the store never claims a resource that does not exist upstream.
 *
 * INTERNAL zones are asserted to be untouched, so the pre-existing behaviour is pinned too.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import type {
  CreateDnsRecordInput,
  DnsProvider,
  UpdateDnsRecordInput,
} from '../../src/dns/types';
import { randomUUID } from 'node:crypto';

interface Call {
  op: string;
  zoneId?: string;
  recordId?: string;
  record?: Partial<CreateDnsRecordInput & UpdateDnsRecordInput>;
  domain?: string;
}

/** A scripted provider that records every call and can be told to fail. */
class RecordingProvider implements DnsProvider {
  readonly name = 'CLOUDFLARE';
  calls: Call[] = [];
  failWith: Error | null = null;
  nameservers = ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'];
  zoneId = 'cf-zone-1';

  async createZone(domainName: string) {
    this.calls.push({ op: 'createZone', domain: domainName });
    if (this.failWith) throw this.failWith;
    return { zoneId: this.zoneId, nameservers: this.nameservers };
  }
  async deleteZone(zoneId: string) {
    this.calls.push({ op: 'deleteZone', zoneId });
    if (this.failWith) throw this.failWith;
  }
  async createRecord(zoneId: string, record: CreateDnsRecordInput) {
    this.calls.push({ op: 'createRecord', zoneId, record });
    if (this.failWith) throw this.failWith;
    return { recordId: 'cf-rec-1' };
  }
  async updateRecord(zoneId: string, recordId: string, record: UpdateDnsRecordInput) {
    this.calls.push({ op: 'updateRecord', zoneId, recordId, record });
    if (this.failWith) throw this.failWith;
  }
  async deleteRecord(zoneId: string, recordId: string) {
    this.calls.push({ op: 'deleteRecord', zoneId, recordId });
    if (this.failWith) throw this.failWith;
  }
  async deleteRecordByValues(zoneId: string, record: { name: string; type: CreateDnsRecordInput['type'] }) {
    this.calls.push({ op: 'deleteRecordByValues', zoneId, record });
    if (this.failWith) throw this.failWith;
    return 'cf-rec-1';
  }
  ops(): string[] {
    return this.calls.map((c) => c.op);
  }
}

describe('DNS propagation through the customer API', () => {
  let db: PGlite;
  let client: PgliteClient;
  let env: Env;
  let provider: RecordingProvider;
  let app: ReturnType<typeof buildApp> | undefined;
  let token: string;
  const userId = randomUUID();

  async function build(providerImpl: RecordingProvider | 'unconfigured') {
    app = buildApp(env, {
      pool: client,
      dnsPropagation: {
        factory: () => {
          if (providerImpl === 'unconfigured') {
            return {
              name: 'CLOUDFLARE',
              createZone: async () => {
                throw new Error('CONFIGURATION_REQUIRED: no Cloudflare API token configured');
              },
              deleteZone: async () => {},
              createRecord: async () => ({ recordId: 'x' }),
              updateRecord: async () => {},
              deleteRecord: async () => {},
            } as unknown as DnsProvider;
          }
          return providerImpl;
        },
      },
    });
    await app.ready();
  }

  afterEach(async () => {
    // A new embedded database is created for every case. Release both resources,
    // including when a handler/assertion fails, before starting the next one.
    try {
      await app?.close();
    } finally {
      app = undefined;
      await db?.close();
    }
  });

  beforeEach(async () => {
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
    } as NodeJS.ProcessEnv);

    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { allowProduction: true });
    await client.exec(
      `INSERT INTO users (id, email, password_hash, full_name, role, status)
       VALUES ('${userId}', 'dns@example.com', 'hash', 'DNS User', 'customer', 'active');`
    );
    token = signAuthToken(env, { sub: userId, email: 'dns@example.com', role: 'customer' });
    provider = new RecordingProvider();
  });

  async function post(url: string, payload: unknown) {
    return app!.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token}` }, payload });
  }
  async function patch(url: string, payload: unknown) {
    return app!.inject({ method: 'PATCH', url, headers: { authorization: `Bearer ${token}` }, payload });
  }
  async function del(url: string) {
    return app!.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${token}` } });
  }

  it('creates an external zone at the provider and records the provider\'s own nameservers', async () => {
    await build(provider);
    const res = await post('/api/v1/dns/zones', { domainName: 'propagated.com', provider: 'CLOUDFLARE' });

    expect(res.statusCode).toBe(201);
    const zone = JSON.parse(res.payload).zone;
    expect(provider.ops()).toEqual(['createZone']);
    // The provider's delegation set, never the platform's internal defaults.
    expect(zone.nameservers).toEqual(['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
    expect(zone.nameservers).not.toContain('ns1.cloudhost247.com');
    expect(zone.provider).toBe('CLOUDFLARE');
    expect(zone.metadata.providerZoneId).toBe('cf-zone-1');

    // The auto-seeded NS records point at the provider's nameservers, not the platform's.
    const detail = await app!.inject({
      method: 'GET',
      url: `/api/v1/dns/zones/${zone.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const ns = JSON.parse(detail.payload).records.filter((r: { type: string }) => r.type === 'NS');
    expect(ns.map((r: { content: string }) => r.content)).toEqual([
      'ada.ns.cloudflare.com',
      'bob.ns.cloudflare.com',
    ]);
  });

  it('writes nothing locally when the provider is not configured', async () => {
    await build('unconfigured');
    const res = await post('/api/v1/dns/zones', { domainName: 'ghost.com', provider: 'CLOUDFLARE' });

    expect(res.statusCode).toBe(503);
    const rows = await client.query<{ id: string }>('SELECT id FROM dns_zones');
    expect(rows.rows).toHaveLength(0); // no orphan local zone claiming to exist upstream
  });

  it('refuses a zone the provider created without a delegation set, rather than inventing nameservers', async () => {
    provider.nameservers = [];
    await build(provider);
    const res = await post('/api/v1/dns/zones', { domainName: 'nodelegation.com', provider: 'CLOUDFLARE' });

    expect(res.statusCode).toBe(502);
    const rows = await client.query<{ id: string }>('SELECT id FROM dns_zones');
    expect(rows.rows).toHaveLength(0);
  });

  it('propagates record create, update and delete for an external zone', async () => {
    await build(provider);
    const zone = JSON.parse((await post('/api/v1/dns/zones', { domainName: 'records.com', provider: 'CLOUDFLARE' })).payload).zone;

    const created = await post(`/api/v1/dns/zones/${zone.id}/records`, {
      name: 'www.records.com',
      type: 'A',
      content: '203.0.113.10',
      ttl: 300,
    });
    expect(created.statusCode).toBe(201);
    const recordId = JSON.parse(created.payload).record.id;

    const updated = await patch(`/api/v1/dns/zones/${zone.id}/records/${recordId}`, { content: '203.0.113.99' });
    expect(updated.statusCode).toBe(200);

    const removed = await del(`/api/v1/dns/zones/${zone.id}/records/${recordId}`);
    expect(removed.statusCode).toBe(204);

    expect(provider.ops()).toEqual(['createZone', 'createRecord', 'updateRecord', 'deleteRecordByValues']);

    // Every record call carried the provider's zone id, not the platform's uuid.
    const recordCalls = provider.calls.filter((c) => c.op !== 'createZone');
    expect(recordCalls.every((c) => c.zoneId === 'cf-zone-1')).toBe(true);

    // A content-only PATCH must not have blanked the record's name upstream.
    const updateCall = provider.calls.find((c) => c.op === 'updateRecord');
    expect(updateCall?.record).toMatchObject({ name: 'www.records.com', type: 'A', content: '203.0.113.99', ttl: 300 });
  });

  it('propagates a zone delete upstream before marking the local row deleted', async () => {
    await build(provider);
    const zone = JSON.parse((await post('/api/v1/dns/zones', { domainName: 'deleteme.com', provider: 'CLOUDFLARE' })).payload).zone;

    const res = await del(`/api/v1/dns/zones/${zone.id}`);
    expect(res.statusCode).toBe(204);
    expect(provider.ops()).toEqual(['createZone', 'deleteZone']);
    expect(provider.calls.find((c) => c.op === 'deleteZone')?.zoneId).toBe('cf-zone-1');
  });

  it('keeps the local zone when the upstream delete fails', async () => {
    await build(provider);
    const zone = JSON.parse((await post('/api/v1/dns/zones', { domainName: 'sticky.com', provider: 'CLOUDFLARE' })).payload).zone;

    provider.failWith = new Error('upstream refused');
    const res = await del(`/api/v1/dns/zones/${zone.id}`);
    expect(res.statusCode).toBe(502);

    const rows = await client.query<{ status: string }>('SELECT status FROM dns_zones WHERE id = $1', [zone.id]);
    expect(rows.rows[0]?.status).toBe('ACTIVE'); // still there — the row keeps telling the truth
  });

  it('fails closed for a record change on an external zone that has no upstream zone id', async () => {
    await build(provider);
    // Simulate a zone that predates propagation: external provider, no providerZoneId in metadata.
    const rows = await client.query<{ id: string }>(
      `INSERT INTO dns_zones (user_id, domain_name, provider, nameservers, metadata)
       VALUES ($1, 'legacy.com', 'CLOUDFLARE', ARRAY['ada.ns.cloudflare.com'], '{}'::jsonb)
       RETURNING id`,
      [userId]
    );
    const legacyZoneId = rows.rows[0]!.id;

    const res = await post(`/api/v1/dns/zones/${legacyZoneId}/records`, {
      name: 'www.legacy.com',
      type: 'A',
      content: '203.0.113.5',
    });
    expect(res.statusCode).toBe(503);
    expect(provider.ops()).toEqual([]); // nothing was sent to the provider
  });

  it('never touches a provider for an INTERNAL zone, preserving the previous behaviour', async () => {
    await build(provider);
    const res = await post('/api/v1/dns/zones', { domainName: 'internal.com' });

    expect(res.statusCode).toBe(201);
    const zone = JSON.parse(res.payload).zone;
    expect(zone.nameservers).toContain('ns1.cloudhost247.com');
    expect(provider.calls).toHaveLength(0);

    const created = await post(`/api/v1/dns/zones/${zone.id}/records`, {
      name: 'www.internal.com',
      type: 'A',
      content: '203.0.113.20',
    });
    expect(created.statusCode).toBe(201);
    expect(provider.calls).toHaveLength(0);
  });

  it('treats an explicitly INTERNAL provider the same as an omitted one', async () => {
    await build(provider);
    const res = await post('/api/v1/dns/zones', { domainName: 'explicit-internal.com', provider: 'internal' });
    expect(res.statusCode).toBe(201);
    expect(provider.calls).toHaveLength(0);
  });
});
