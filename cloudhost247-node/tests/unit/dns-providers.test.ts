/**
 * DNS provider adapters — the live connectors for A11.
 *
 * Cloudflare is exercised through tests/helpers/MockCloudflare, which serves a scripted v4 API into
 * the REAL CloudflareClient, so these tests run the genuine client + zone/record code paths rather
 * than a stand-in. Route53 is exercised through a fake SDK client injected at the boundary, which
 * still runs the adapter's own change-batch construction, idempotency and fail-closed guards.
 */
import { describe, expect, it } from 'vitest';
import {
  CloudflareDnsProvider,
  Route53DnsProvider,
  createDnsProvider,
  type Route53LikeClient,
} from '../../src/dns/providers';
import { CloudflareClient } from '../../src/integrations/cloudflare/client';
import { CloudflareError } from '../../src/integrations/cloudflare/errors';
import { MockCloudflare } from '../helpers/mock-cloudflare';

const noSleep = () => Promise.resolve();

/**
 * `null` (not `undefined`) is the sentinel for "no account id", because a JS default parameter
 * would silently substitute the real id for an explicit `undefined` and hide the fail-closed path.
 */
function cloudflareProvider(mock: MockCloudflare, accountId: string | null = mock.accountId) {
  const client = new CloudflareClient({
    baseUrl: 'https://api.cloudflare.test/client/v4',
    apiToken: mock.validToken,
    fetchImpl: mock.fetch,
    sleep: noSleep,
  });
  return new CloudflareDnsProvider({ client, accountId: accountId ?? undefined });
}

describe('CloudflareDnsProvider — fail-closed configuration', () => {
  it('throws CONFIGURATION_REQUIRED when no token is available, before any HTTP call', async () => {
    const provider = new CloudflareDnsProvider({});
    const error = await provider.deleteZone('z-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudflareError);
    expect((error as CloudflareError).code).toBe('CLOUDFLARE_CONFIGURATION_REQUIRED');
  });

  it('throws CONFIGURATION_REQUIRED when creating a zone without an account id', async () => {
    const mock = new MockCloudflare();
    const provider = cloudflareProvider(mock, null);
    const error = await provider.createZone('example.com').catch((e: unknown) => e);
    expect((error as CloudflareError).code).toBe('CLOUDFLARE_CONFIGURATION_REQUIRED');
    // The account id is required by the v4 API, so nothing may be sent without it.
    expect(mock.requests).toHaveLength(0);
  });

  it('accepts the legacy string-token constructor form', () => {
    expect(() => new CloudflareDnsProvider('a-token')).not.toThrow();
  });
});

describe('CloudflareDnsProvider — live zone operations', () => {
  it('creates a zone and returns Cloudflare\'s real zone id and nameservers', async () => {
    const mock = new MockCloudflare();
    const provider = cloudflareProvider(mock);
    const zone = await provider.createZone('example.com');

    expect(zone.zoneId).toMatch(/^z-/);
    expect(zone.nameservers).toEqual(['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
    expect([...mock.zones.values()].map((z) => z.name)).toEqual(['example.com']);
  });

  it('is idempotent: a retried create reuses the existing zone instead of duplicating it', async () => {
    const mock = new MockCloudflare();
    const provider = cloudflareProvider(mock);
    const first = await provider.createZone('example.com');
    const second = await provider.createZone('example.com');

    expect(second.zoneId).toBe(first.zoneId);
    expect(mock.zones.size).toBe(1);
  });

  it('deletes a zone through the provider', async () => {
    const mock = new MockCloudflare();
    const provider = cloudflareProvider(mock);
    const zone = await provider.createZone('example.com');
    await provider.deleteZone(zone.zoneId);
    expect(mock.zones.size).toBe(0);
  });

  it('surfaces an upstream auth failure rather than pretending success', async () => {
    const mock = new MockCloudflare();
    const client = new CloudflareClient({
      baseUrl: 'https://api.cloudflare.test/client/v4',
      apiToken: 'wrong-token',
      fetchImpl: mock.fetch,
      sleep: noSleep,
    });
    const provider = new CloudflareDnsProvider({ client, accountId: mock.accountId });
    const error = await provider.createZone('example.com').catch((e: unknown) => e);
    expect((error as CloudflareError).code).toBe('CLOUDFLARE_AUTH_FAILED');
  });
});

describe('CloudflareDnsProvider — live record operations', () => {
  async function withZone() {
    const mock = new MockCloudflare();
    const provider = cloudflareProvider(mock);
    const zone = await provider.createZone('example.com');
    return { mock, provider, zoneId: zone.zoneId };
  }

  it('creates a record and returns Cloudflare\'s record id', async () => {
    const { mock, provider, zoneId } = await withZone();
    const { recordId } = await provider.createRecord(zoneId, {
      zoneId,
      name: 'www.example.com',
      type: 'A',
      content: '203.0.113.10',
      ttl: 300,
    });

    expect(recordId).toMatch(/^r-/);
    const stored = [...mock.records.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ type: 'A', name: 'www.example.com', content: '203.0.113.10', ttl: 300 });
  });

  it('propagates an update to the provider', async () => {
    const { mock, provider, zoneId } = await withZone();
    const { recordId } = await provider.createRecord(zoneId, {
      zoneId,
      name: 'www.example.com',
      type: 'A',
      content: '203.0.113.10',
    });
    await provider.updateRecord(zoneId, recordId, { content: '203.0.113.99', ttl: 600 });

    expect([...mock.records.values()][0]).toMatchObject({ content: '203.0.113.99', ttl: 600 });
  });

  it('deletes a record at the provider', async () => {
    const { mock, provider, zoneId } = await withZone();
    const { recordId } = await provider.createRecord(zoneId, {
      zoneId,
      name: 'www.example.com',
      type: 'A',
      content: '203.0.113.10',
    });
    await provider.deleteRecord(zoneId, recordId);
    expect(mock.records.size).toBe(0);
  });

  it('maps a null priority to undefined rather than sending null upstream', async () => {
    const { mock, provider, zoneId } = await withZone();
    await provider.createRecord(zoneId, {
      zoneId,
      name: 'mail.example.com',
      type: 'MX',
      content: 'mail.example.com',
      priority: null,
    });
    const posted = mock.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/dns_records'));
    expect(posted).toHaveLength(1);
    expect([...mock.records.values()][0]?.priority).toBeUndefined();
  });

  it('refuses SOA and PTR before any HTTP call, because the v4 endpoint does not accept them', async () => {
    const { mock, provider, zoneId } = await withZone();
    const before = mock.requests.length;

    for (const type of ['SOA', 'PTR'] as const) {
      const error = await provider
        .createRecord(zoneId, { zoneId, name: 'example.com', type, content: 'x' })
        .catch((e: unknown) => e);
      expect((error as CloudflareError).code).toBe('CLOUDFLARE_FEATURE_NOT_SUPPORTED');
    }
    expect(mock.requests).toHaveLength(before); // no request reached the provider
  });

  it('refuses an unsupported type on update too', async () => {
    const { provider, zoneId } = await withZone();
    const error = await provider
      .updateRecord(zoneId, 'r-1', { type: 'PTR', name: 'example.com' })
      .catch((e: unknown) => e);
    expect((error as CloudflareError).code).toBe('CLOUDFLARE_FEATURE_NOT_SUPPORTED');
  });
});

/** Records the commands the adapter submits, dispatching on the real SDK command class name. */
class FakeRoute53 implements Route53LikeClient {
  calls: Array<{ command: string; input: Record<string, unknown> }> = [];
  existingZones: Array<{ Id: string; Name: string }> = [];
  nameServers = ['ns-1.awsdns-00.net.', 'ns-2.awsdns-01.org.'];
  failWith: Error | null = null;

  async send(command: unknown): Promise<unknown> {
    const name = (command as { constructor: { name: string } }).constructor.name;
    const input = ((command as { input?: Record<string, unknown> }).input ?? {}) as Record<string, unknown>;
    this.calls.push({ command: name, input });
    if (this.failWith) throw this.failWith;

    switch (name) {
      case 'ListHostedZonesByNameCommand':
        return { HostedZones: this.existingZones };
      case 'GetHostedZoneCommand':
        return { DelegationSet: { NameServers: this.nameServers } };
      case 'CreateHostedZoneCommand':
        return {
          HostedZone: { Id: '/Z0123456789ABCDEFGHIJ' },
          DelegationSet: { NameServers: this.nameServers },
        };
      case 'ChangeResourceRecordSetsCommand':
        return { ChangeInfo: { Id: '/change/C123', Status: 'PENDING' } };
      default:
        return {};
    }
  }

  last(command: string): Record<string, unknown> | undefined {
    return [...this.calls].reverse().find((c) => c.command === command)?.input;
  }
}

/** A read-only stand-in for the platform's dns_records table. */
function fakeDbWithRecord(record: { id: string; name: string; type: string; content: string; ttl: number; priority: number | null }) {
  return {
    query: async () => ({ rows: [record] }),
  } as never;
}

describe('Route53DnsProvider', () => {
  it('throws CONFIGURATION_REQUIRED when no credentials and no client are supplied', async () => {
    const saved = { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY };
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    try {
      const provider = new Route53DnsProvider({});
      await expect(provider.createZone('example.com')).rejects.toThrow(/CONFIGURATION_REQUIRED/);
    } finally {
      if (saved.id !== undefined) process.env.AWS_ACCESS_KEY_ID = saved.id;
      if (saved.secret !== undefined) process.env.AWS_SECRET_ACCESS_KEY = saved.secret;
    }
  });

  it('creates a hosted zone, strips the leading slash and returns the delegation set', async () => {
    const sdk = new FakeRoute53();
    const provider = new Route53DnsProvider({ client: sdk });
    const zone = await provider.createZone('example.com');

    expect(zone.zoneId).toBe('Z0123456789ABCDEFGHIJ');
    expect(zone.nameservers).toEqual(sdk.nameServers);
    // Route53 requires the trailing dot on the zone name.
    expect(sdk.last('CreateHostedZoneCommand')).toMatchObject({ Name: 'example.com.' });
  });

  it('reuses an existing hosted zone for the same name instead of creating a duplicate', async () => {
    const sdk = new FakeRoute53();
    sdk.existingZones = [{ Id: '/ZEXISTING', Name: 'example.com.' }];
    const provider = new Route53DnsProvider({ client: sdk });
    const zone = await provider.createZone('example.com');

    expect(zone.zoneId).toBe('ZEXISTING');
    expect(sdk.calls.some((c) => c.command === 'CreateHostedZoneCommand')).toBe(false);
    expect(zone.nameservers).toEqual(sdk.nameServers);
  });

  it('submits a change batch for a new record and returns the change id', async () => {
    const sdk = new FakeRoute53();
    const provider = new Route53DnsProvider({ client: sdk });
    const { recordId } = await provider.createRecord('Z1', {
      zoneId: 'Z1',
      name: 'www.example.com',
      type: 'A',
      content: '203.0.113.10',
      ttl: 600,
    });

    expect(recordId).toBe('/change/C123');
    const change = sdk.last('ChangeResourceRecordSetsCommand');
    expect(change).toMatchObject({ HostedZoneId: '/Z1' });
    expect(change?.ChangeBatch).toEqual({
      Changes: [
        {
          Action: 'CREATE',
          ResourceRecordSet: {
            Name: 'www.example.com',
            Type: 'A',
            TTL: 600,
            ResourceRecords: [{ Value: '203.0.113.10' }],
          },
        },
      ],
    });
  });

  it('prefixes an MX priority into the rdata instead of dropping it', async () => {
    const sdk = new FakeRoute53();
    const provider = new Route53DnsProvider({ client: sdk });
    await provider.createRecord('Z1', {
      zoneId: 'Z1',
      name: 'example.com',
      type: 'MX',
      content: 'mail.example.com.',
      priority: 10,
    });
    const set = (sdk.last('ChangeResourceRecordSetsCommand')?.ChangeBatch as {
      Changes: Array<{ ResourceRecordSet: { ResourceRecords: Array<{ Value: string }> } }>;
    }).Changes[0].ResourceRecordSet;
    expect(set.ResourceRecords).toEqual([{ Value: '10' }, { Value: 'mail.example.com.' }]);
  });

  it('does not double-prefix when the content already carries the priority', async () => {
    const sdk = new FakeRoute53();
    const provider = new Route53DnsProvider({ client: sdk });
    await provider.createRecord('Z1', {
      zoneId: 'Z1',
      name: 'example.com',
      type: 'MX',
      content: '10 mail.example.com.',
      priority: 10,
    });
    const set = (sdk.last('ChangeResourceRecordSetsCommand')?.ChangeBatch as {
      Changes: Array<{ ResourceRecordSet: { ResourceRecords: Array<{ Value: string }> } }>;
    }).Changes[0].ResourceRecordSet;
    expect(set.ResourceRecords).toEqual([{ Value: '10' }, { Value: 'mail.example.com.' }]);
  });

  it('rejects an update that omits name or type, since Route53 addresses records by name+type', async () => {
    const sdk = new FakeRoute53();
    const provider = new Route53DnsProvider({ client: sdk });
    await expect(provider.updateRecord('Z1', '/change/C1', { content: '203.0.113.11' })).rejects.toThrow(
      /require name and type/
    );
    expect(sdk.calls).toHaveLength(0);
  });

  it('upserts on update, falling back to the stored record for omitted fields', async () => {
    const sdk = new FakeRoute53();
    const provider = new Route53DnsProvider({
      client: sdk,
      db: fakeDbWithRecord({
        id: 'rec-1',
        name: 'www.example.com',
        type: 'A',
        content: '203.0.113.10',
        ttl: 300,
        priority: null,
      }),
    });
    await provider.updateRecord('Z1', 'rec-1', { name: 'www.example.com', type: 'A', content: '203.0.113.99' });

    const set = (sdk.last('ChangeResourceRecordSetsCommand')?.ChangeBatch as {
      Changes: Array<{ Action: string; ResourceRecordSet: { Name: string; ResourceRecords: Array<{ Value: string }> } }>;
    }).Changes[0];
    expect(set.Action).toBe('UPSERT');
    expect(set.ResourceRecordSet.ResourceRecords).toEqual([{ Value: '203.0.113.99' }]);
  });

  it('deletes by echoing the stored record exactly, which is what a Route53 DELETE requires', async () => {
    const sdk = new FakeRoute53();
    const provider = new Route53DnsProvider({
      client: sdk,
      db: fakeDbWithRecord({
        id: 'rec-1',
        name: 'www.example.com',
        type: 'A',
        content: '203.0.113.10',
        ttl: 300,
        priority: null,
      }),
    });
    await provider.deleteRecord('Z1', 'rec-1');

    const change = sdk.last('ChangeResourceRecordSetsCommand')?.ChangeBatch as {
      Changes: Array<{ Action: string; ResourceRecordSet: Record<string, unknown> }>;
    };
    expect(change.Changes[0].Action).toBe('DELETE');
    expect(change.Changes[0].ResourceRecordSet).toMatchObject({
      Name: 'www.example.com',
      Type: 'A',
      TTL: 300,
      ResourceRecords: [{ Value: '203.0.113.10' }],
    });
  });

  it('fails closed on delete when it cannot resolve the record id to exact values', async () => {
    const sdk = new FakeRoute53();
    const provider = new Route53DnsProvider({ client: sdk });
    await expect(provider.deleteRecord('Z1', 'rec-1')).rejects.toThrow(/CONFIGURATION_REQUIRED/);
    expect(sdk.calls).toHaveLength(0); // nothing partial is sent to the provider
  });

  it('surfaces a provider failure instead of swallowing it', async () => {
    const sdk = new FakeRoute53();
    sdk.failWith = new Error('AccessDenied');
    const provider = new Route53DnsProvider({ client: sdk });
    await expect(provider.createZone('example.com')).rejects.toThrow('AccessDenied');
  });
});

describe('createDnsProvider factory', () => {
  const db = { query: async () => ({ rows: [] }) } as never;

  it('selects the provider by name and defaults to the internal engine', () => {
    expect(createDnsProvider('INTERNAL', db).name).toBe('INTERNAL');
    expect(createDnsProvider('DEFAULT', db).name).toBe('INTERNAL');
    expect(createDnsProvider('CLOUDFLARE', db).name).toBe('CLOUDFLARE');
    expect(createDnsProvider('ROUTE53', db).name).toBe('ROUTE53');
    expect(createDnsProvider('SOMETHING-ELSE', db).name).toBe('INTERNAL');
  });

  it('passes injected options through to the selected provider', async () => {
    const sdk = new FakeRoute53();
    const provider = createDnsProvider('route53', db, { route53: { client: sdk } });
    const zone = await provider.createZone('example.com');
    expect(zone.zoneId).toBe('Z0123456789ABCDEFGHIJ');
  });
});
