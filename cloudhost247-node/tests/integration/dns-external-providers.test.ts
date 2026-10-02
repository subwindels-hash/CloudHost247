import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { CloudflareClient } from '../../src/integrations/cloudflare/client';
import type { Route53Transport } from '../../src/dns/route53-provider';

/**
 * A11 — the Cloudflare and Route 53 connectors are reachable through the DNS API: a zone created
 * with a connector is created at the provider first and only then recorded locally, its records
 * are created/updated/deleted at the provider, and an unconfigured connector fails closed without
 * writing anything.
 *
 * The provider HTTP/command layers are scripted (never a production fallback — the same pattern the
 * Cloudflare integration's own tests use); the real client, connector and route code runs.
 */
interface ScriptedRequest {
  method: string;
  path: string;
  body: unknown;
}

function jsonResponse(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status < 400, result, result_info: { total_count: Array.isArray(result) ? result.length : 1 } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function scriptedCloudflare(handler: (request: ScriptedRequest) => Response | undefined): {
  client: CloudflareClient;
  requests: ScriptedRequest[];
} {
  const requests: ScriptedRequest[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const parsed = new URL(href);
    const request: ScriptedRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: parsed.pathname + parsed.search,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    const response = handler(request);
    if (!response) throw new Error(`unexpected Cloudflare request: ${request.method} ${request.path}`);
    return response;
  }) as unknown as typeof fetch;

  return {
    requests,
    client: new CloudflareClient({
      baseUrl: 'https://api.cloudflare.com/client/v4',
      apiToken: 'cf-test-token',
      fetchImpl,
      sleep: async () => undefined,
      maxRetries: 0,
    }),
  };
}

describe('DNS connectors through the API (A11)', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: ReturnType<typeof buildApp>;
  let env: Env;
  let token: string;
  const userId = randomUUID();

  beforeEach(async () => {
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
    } as NodeJS.ProcessEnv);

    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });

    await client.exec(`
      INSERT INTO users (id, email, password_hash, full_name, role, status)
      VALUES ('${userId}', 'dns-owner@example.com', 'hash', 'DNS Owner', 'customer', 'active');
    `);
    token = signAuthToken(env, { sub: userId, email: 'dns-owner@example.com', role: 'customer' });
  });

  afterEach(async () => {
    if (app) await app.close();
    await db.close();
  });

  const buildAppWith = (options: Parameters<typeof buildApp>[1] & { dnsProviders?: unknown }) => {
    app = buildApp(env, { serveFrontend: false, pool: client as never, dnsProviders: options.dnsProviders } as never);
    return app;
  };

  const authHeaders = () => ({ authorization: `Bearer ${token}` });

  it('fails closed when the Cloudflare connector has no configured account: no zone row is written', async () => {
    buildAppWith({});
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: authHeaders(),
      payload: { domainName: 'unconfigured-example.com', provider: 'CLOUDFLARE' },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe('DNS_PROVIDER_CONFIGURATION_REQUIRED');
    expect(body.message).toMatch(/not connected yet/i);

    const zones = await client.query<{ count: string }>('SELECT count(*) AS count FROM dns_zones');
    expect(Number(zones.rows[0]!.count)).toBe(0);
  });

  it('creates the real Cloudflare zone first, stores the provider zone id, and uses its nameservers', async () => {
    const { client: cfClient, requests } = scriptedCloudflare((request) => {
      if (request.method === 'GET' && request.path.startsWith('/client/v4/zones')) return jsonResponse([]);
      if (request.method === 'POST' && request.path === '/client/v4/zones') {
        return jsonResponse({
          id: 'cf-zone-1',
          name: 'example-company.com',
          status: 'pending',
          paused: false,
          name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
        });
      }
      return undefined;
    });

    buildAppWith({ dnsProviders: { cloudflare: { client: cfClient, accountId: 'acct-1' } } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: authHeaders(),
      payload: { domainName: 'example-company.com', provider: 'CLOUDFLARE' },
    });

    expect(res.statusCode).toBe(201);
    const zone = (res.json() as { zone: { id: string; provider: string; metadata: Record<string, unknown>; nameservers: string[] } }).zone;
    expect(zone.provider).toBe('CLOUDFLARE');
    expect(zone.metadata.remoteZoneId).toBe('cf-zone-1');
    expect(zone.nameservers).toEqual(['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
    expect(requests.map((request) => `${request.method} ${request.path.split('?')[0]}`)).toEqual([
      'GET /client/v4/zones',
      'POST /client/v4/zones',
    ]);

    // The apex NS records mirror the provider's delegation, not the platform nameservers.
    const records = await client.query<{ content: string }>(
      `SELECT content FROM dns_records WHERE zone_id = $1 AND type = 'NS' ORDER BY content`,
      [zone.id]
    );
    expect(records.rows.map((row) => row.content)).toEqual(['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
  });

  it('reuses an existing Cloudflare zone instead of creating a duplicate', async () => {
    const { client: cfClient, requests } = scriptedCloudflare((request) => {
      if (request.method === 'GET' && request.path.startsWith('/client/v4/zones')) {
        return jsonResponse([
          { id: 'cf-existing', name: 'reuse-example.com', status: 'active', paused: false, name_servers: ['ns1.cf.example'] },
        ]);
      }
      return undefined;
    });

    buildAppWith({ dnsProviders: { cloudflare: { client: cfClient, accountId: 'acct-1' } } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: authHeaders(),
      payload: { domainName: 'reuse-example.com', provider: 'CLOUDFLARE' },
    });

    expect(res.statusCode).toBe(201);
    expect((res.json() as { zone: { metadata: Record<string, unknown> } }).zone.metadata.remoteZoneId).toBe('cf-existing');
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('creates, updates and deletes records at Cloudflare, keeping the row as a mirror', async () => {
    const cfRecord = {
      id: 'cf-record-1',
      type: 'A',
      name: 'www.example-app.com',
      content: '203.0.113.10',
      ttl: 300,
      proxied: false,
    };
    const { client: cfClient, requests } = scriptedCloudflare((request) => {
      if (request.method === 'GET' && request.path.startsWith('/client/v4/zones')) return jsonResponse([]);
      if (request.method === 'POST' && request.path === '/client/v4/zones') {
        return jsonResponse({ id: 'cf-zone-9', name: 'example-app.com', status: 'active', paused: false, name_servers: ['ns1.cf.example'] });
      }
      if (request.method === 'POST' && request.path === '/client/v4/zones/cf-zone-9/dns_records') return jsonResponse(cfRecord);
      if (request.method === 'PATCH' && request.path === '/client/v4/zones/cf-zone-9/dns_records/cf-record-1') {
        return jsonResponse({ ...cfRecord, content: '203.0.113.11' });
      }
      if (request.method === 'DELETE' && request.path === '/client/v4/zones/cf-zone-9/dns_records/cf-record-1') {
        return jsonResponse({ id: 'cf-record-1' });
      }
      return undefined;
    });

    buildAppWith({ dnsProviders: { cloudflare: { client: cfClient, accountId: 'acct-1' } } });
    const zoneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: authHeaders(),
      payload: { domainName: 'example-app.com', provider: 'CLOUDFLARE' },
    });
    const zoneId = (zoneRes.json() as { zone: { id: string } }).zone.id;

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dns/zones/${zoneId}/records`,
      headers: authHeaders(),
      payload: { name: 'www', type: 'A', content: '203.0.113.10', ttl: 300 },
    });
    expect(createRes.statusCode).toBe(201);
    const created = (createRes.json() as { record: { id: string; provider_record_id: string } }).record;
    expect(created.provider_record_id).toBe('cf-record-1');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dns/records/${created.id}`,
      headers: authHeaders(),
      payload: { content: '203.0.113.11' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect((patchRes.json() as { record: { content: string } }).record.content).toBe('203.0.113.11');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dns/zones/${zoneId}/records/${created.id}`,
      headers: authHeaders(),
    });
    expect(deleteRes.statusCode).toBe(204);

    expect(requests.map((request) => `${request.method} ${request.path.split('?')[0]}`)).toEqual([
      'GET /client/v4/zones',
      'POST /client/v4/zones',
      'POST /client/v4/zones/cf-zone-9/dns_records',
      'PATCH /client/v4/zones/cf-zone-9/dns_records/cf-record-1',
      'DELETE /client/v4/zones/cf-zone-9/dns_records/cf-record-1',
    ]);

    const remaining = await client.query<{ count: string }>('SELECT count(*) AS count FROM dns_records WHERE id = $1', [created.id]);
    expect(Number(remaining.rows[0]!.count)).toBe(0);
  });

  it('refuses record types Cloudflare does not serve, with the reason and no live call', async () => {
    const { client: cfClient, requests } = scriptedCloudflare((request) => {
      if (request.method === 'GET' && request.path.startsWith('/client/v4/zones')) return jsonResponse([]);
      if (request.method === 'POST' && request.path === '/client/v4/zones') {
        return jsonResponse({ id: 'cf-zone-ptr', name: 'ptr-example.com', status: 'active', paused: false, name_servers: ['ns1.cf.example'] });
      }
      return undefined;
    });

    buildAppWith({ dnsProviders: { cloudflare: { client: cfClient, accountId: 'acct-1' } } });
    const zoneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: authHeaders(),
      payload: { domainName: 'ptr-example.com', provider: 'CLOUDFLARE' },
    });
    const zoneId = (zoneRes.json() as { zone: { id: string } }).zone.id;
    const callsBefore = requests.length;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dns/zones/${zoneId}/records`,
      headers: authHeaders(),
      payload: { name: '1.0.0.203.in-addr.arpa', type: 'PTR', content: 'www.example.com' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('DNS_PROVIDER_UNSUPPORTED_OPERATION');
    expect((res.json() as { message: string }).message).toMatch(/does not serve PTR/);
    expect(requests.length).toBe(callsBefore);

    const rows = await client.query<{ count: string }>('SELECT count(*) AS count FROM dns_records WHERE zone_id = $1 AND type = $2', [zoneId, 'PTR']);
    expect(Number(rows.rows[0]!.count)).toBe(0);
  });

  it('creates a real Route 53 hosted zone and record set through the API', async () => {
    const calls: string[] = [];
    const transport: Route53Transport = {
      async send(command: object) {
        const name = (command as { constructor: { name: string } }).constructor.name;
        calls.push(name);
        if (name === 'ListHostedZonesByNameCommand') return { HostedZones: [] };
        if (name === 'CreateHostedZoneCommand') {
          return {
            HostedZone: { Id: '/hostedzone/ZAPI1', Name: 'route53-example.com.' },
            DelegationSet: { NameServers: ['ns-1.awsdns-01.com', 'ns-2.awsdns-02.net'] },
          };
        }
        if (name === 'GetHostedZoneCommand') return { HostedZone: { Name: 'route53-example.com.' } };
        if (name === 'ChangeResourceRecordSetsCommand') return {};
        return {};
      },
    };

    buildAppWith({ dnsProviders: { route53: transport, route53Env: { AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 'secret' } } });
    const zoneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: authHeaders(),
      payload: { domainName: 'route53-example.com', provider: 'ROUTE53' },
    });

    expect(zoneRes.statusCode).toBe(201);
    const zone = (zoneRes.json() as { zone: { id: string; metadata: Record<string, unknown>; nameservers: string[] } }).zone;
    expect(zone.metadata.remoteZoneId).toBe('ZAPI1');
    expect(zone.nameservers).toEqual(['ns-1.awsdns-01.com', 'ns-2.awsdns-02.net']);

    const recordRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dns/zones/${zone.id}/records`,
      headers: authHeaders(),
      payload: { name: '@', type: 'MX', content: 'mail.route53-example.com', priority: 10 },
    });
    expect(recordRes.statusCode).toBe(201);
    const record = (recordRes.json() as { record: { provider_record_id: string } }).record;
    // Route 53 identity is the record set itself: name|type.
    expect(record.provider_record_id).toBe('@|MX');
    expect(calls).toContain('ChangeResourceRecordSetsCommand');
  });

  it('refuses a provider name that has no connector in this build', async () => {
    buildAppWith({});
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: authHeaders(),
      payload: { domainName: 'unsupported-example.com', provider: 'HETZNER_DNS' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('VALIDATION_ERROR');

    const zones = await client.query<{ count: string }>('SELECT count(*) AS count FROM dns_zones');
    expect(Number(zones.rows[0]!.count)).toBe(0);
  });

  it('keeps the internal engine exactly as it was when no provider is given', async () => {
    buildAppWith({});
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: authHeaders(),
      payload: { domainName: 'internal-example.com' },
    });

    expect(res.statusCode).toBe(201);
    const zone = (res.json() as { zone: { provider: string; nameservers: string[]; metadata: Record<string, unknown> } }).zone;
    expect(zone.provider).toBe('INTERNAL');
    expect(zone.nameservers).toContain('ns1.cloudhost247.com');
    expect(zone.metadata.remoteZoneId).toBeUndefined();
  });
});
