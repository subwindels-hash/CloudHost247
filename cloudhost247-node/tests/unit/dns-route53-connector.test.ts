import { describe, expect, it } from 'vitest';
import {
  ROUTE53_MIN_TTL,
  Route53DnsProvider,
  parseRoute53RecordId,
  route53ContentFromRecordSet,
  route53Fqdn,
  route53RecordId,
  route53RecordValues,
  route53TxtStrings,
  type Route53Transport,
} from '../../src/dns/route53-provider';
import { DnsProviderError, unsupportedDnsOperation } from '../../src/dns/errors';
import { SUPPORTED_DNS_PROVIDERS, createDnsProvider, isSupportedDnsProvider } from '../../src/dns/providers';

/**
 * A11 — the Route 53 connector must speak Route 53's real contract: record sets addressed by
 * (name, type), complete values on every change, priority folded into MX/SRV values, quoted TXT
 * strings, and no live call at all until credentials exist.
 */
interface ScriptedCall {
  name: string;
  input: Record<string, unknown>;
}

function commandName(command: object): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

function changeBatchOf(calls: ScriptedCall[]): {
  Changes: Array<{ Action: string; ResourceRecordSet: Record<string, unknown> }>;
} {
  const change = calls.filter((call) => call.name === 'ChangeResourceRecordSetsCommand').pop();
  expect(change, 'a ChangeResourceRecordSets call').toBeDefined();
  const input = change!.input as { ChangeBatch?: { Changes?: Array<{ Action: string; ResourceRecordSet: Record<string, unknown> }> } };
  expect(input.ChangeBatch?.Changes, 'ChangeBatch.Changes').toBeDefined();
  return { Changes: input.ChangeBatch!.Changes! };
}

function scriptedTransport(
  handler: (call: ScriptedCall) => unknown,
): { transport: Route53Transport; calls: ScriptedCall[] } {
  const calls: ScriptedCall[] = [];
  return {
    calls,
    transport: {
      async send(command: object) {
        const call = { name: commandName(command), input: (command as { input: Record<string, unknown> }).input };
        calls.push(call);
        return handler(call);
      },
    },
  };
}

const CREDS = { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secret' } as NodeJS.ProcessEnv;

describe('Route 53 connector — value shaping', () => {
  it('folds the priority column into MX values exactly once', () => {
    expect(route53RecordValues('MX', 'mail.example.com', 10)).toEqual(['10 mail.example.com.']);
    expect(route53RecordValues('MX', '10 mail.example.com', 10)).toEqual(['10 mail.example.com.']);
    expect(route53RecordValues('MX', '10 mail.example.com', null)).toEqual(['10 mail.example.com.']);
  });

  it('folds priority into SRV and qualifies only the target field', () => {
    expect(route53RecordValues('SRV', '5 443 sip.example.com', 10)).toEqual(['10 5 443 sip.example.com.']);
    expect(route53RecordValues('SRV', '10 5 443 sip.example.com', 10)).toEqual(['10 5 443 sip.example.com.']);
    expect(route53RecordValues('SRV', '10 5 443 sip.example.com', null)).toEqual(['10 5 443 sip.example.com.']);
  });

  it('quotes and chunks TXT values, and qualifies name-valued records', () => {
    expect(route53RecordValues('TXT', 'v=spf1 include:example.com ~all', null)).toEqual([
      '"v=spf1 include:example.com ~all"',
    ]);
    const long = 'x'.repeat(600);
    const chunks = route53TxtStrings(long);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.startsWith('"') && chunk.endsWith('"'))).toBe(true);
    expect(chunks.join('').replace(/"/g, '')).toHaveLength(600);

    expect(route53RecordValues('CNAME', 'target.example.net', null)).toEqual(['target.example.net.']);
    expect(route53RecordValues('A', '203.0.113.7', null)).toEqual(['203.0.113.7']);
  });

  it('maps platform record names onto Route 53 FQDNs', () => {
    expect(route53Fqdn('example.com.', '@')).toBe('example.com.');
    expect(route53Fqdn('example.com', 'www')).toBe('www.example.com.');
    expect(route53Fqdn('example.com', 'www.example.com')).toBe('www.example.com.');
    expect(route53Fqdn('example.com', '_dmarc')).toBe('_dmarc.example.com.');
  });

  it('round-trips the record-set identity and content', () => {
    expect(route53RecordId('www', 'A')).toBe('www|A');
    expect(parseRoute53RecordId('www|A')).toEqual({ name: 'www', type: 'A' });
    expect(parseRecordIdRejection('not-a-record-id')).toMatch(/name\|type/);
    expect(route53ContentFromRecordSet({ Type: 'TXT', ResourceRecords: [{ Value: '"hello"' }] })).toBe('hello');
    expect(route53ContentFromRecordSet({ Type: 'A', ResourceRecords: [{ Value: '203.0.113.1' }] })).toBe('203.0.113.1');
  });

  function parseRecordIdRejection(value: string): string {
    try {
      parseRoute53RecordId(value);
      throw new Error('expected a rejection');
    } catch (error) {
      return (error as DnsProviderError).message;
    }
  }
});

describe('Route 53 connector — fail closed before any call', () => {
  it('refuses every operation without credentials and never touches the transport', async () => {
    const { transport, calls } = scriptedTransport(() => {
      throw new Error('the transport must not be reached');
    });
    const provider = new Route53DnsProvider({} as NodeJS.ProcessEnv, transport);

    for (const invoke of [
      () => provider.createZone('example.com'),
      () => provider.deleteZone('Z1'),
      () =>
        provider.createRecord('Z1', {
          zoneId: 'z',
          name: 'www',
          type: 'A',
          content: '203.0.113.1',
        }),
      () => provider.updateRecord('Z1', 'www|A', { content: '203.0.113.2' }),
      () => provider.deleteRecord('Z1', 'www|A'),
      () => provider.resolveRecordId('Z1', 'www', 'A'),
    ]) {
      await expect(invoke()).rejects.toMatchObject({
        code: 'DNS_PROVIDER_CONFIGURATION_REQUIRED',
        statusCode: 503,
        retryable: false,
      });
    }
    expect(calls).toHaveLength(0);
  });
});

describe('Route 53 connector — live operations', () => {
  it('reuses an existing hosted zone instead of creating a duplicate', async () => {
    const { transport, calls } = scriptedTransport((call) => {
      if (call.name === 'ListHostedZonesByNameCommand') {
        return { HostedZones: [{ Id: '/hostedzone/ZEXISTING', Name: 'example.com.' }] };
      }
      if (call.name === 'GetHostedZoneCommand') {
        return { DelegationSet: { NameServers: ['ns-1.awsdns-01.com', 'ns-2.awsdns-02.net'] } };
      }
      throw new Error(`unexpected ${call.name}`);
    });
    const provider = new Route53DnsProvider(CREDS, transport);

    const zone = await provider.createZone('Example.COM');
    expect(zone).toEqual({ zoneId: 'ZEXISTING', nameservers: ['ns-1.awsdns-01.com', 'ns-2.awsdns-02.net'] });
    expect(calls.map((call) => call.name)).toEqual(['ListHostedZonesByNameCommand', 'GetHostedZoneCommand']);
  });

  it('creates a zone when none exists and returns the delegation set as nameservers', async () => {
    const { transport, calls } = scriptedTransport((call) => {
      if (call.name === 'ListHostedZonesByNameCommand') return { HostedZones: [] };
      if (call.name === 'CreateHostedZoneCommand') {
        return {
          HostedZone: { Id: '/hostedzone/ZNEW', Name: 'example.com.' },
          DelegationSet: { NameServers: ['ns-1.awsdns-01.com'] },
        };
      }
      throw new Error(`unexpected ${call.name}`);
    });
    const provider = new Route53DnsProvider(CREDS, transport);

    const zone = await provider.createZone('example.com');
    expect(zone).toEqual({ zoneId: 'ZNEW', nameservers: ['ns-1.awsdns-01.com'] });
    const create = calls.find((call) => call.name === 'CreateHostedZoneCommand');
    const changeBatch = create?.input as { Name?: string; CallerReference?: string };
    expect(changeBatch.Name).toBe('example.com');
    expect(changeBatch.CallerReference).toMatch(/[0-9a-f-]{36}/);
  });

  it('sends a CREATE change with the fully-qualified record set', async () => {
    const { transport, calls } = scriptedTransport((call) => {
      if (call.name === 'GetHostedZoneCommand') return { HostedZone: { Name: 'example.com.' } };
      if (call.name === 'ChangeResourceRecordSetsCommand') return {};
      throw new Error(`unexpected ${call.name}`);
    });
    const provider = new Route53DnsProvider(CREDS, transport);

    const created = await provider.createRecord('Z1', {
      zoneId: 'z',
      name: 'www',
      type: 'A',
      content: '203.0.113.9',
      ttl: 300,
    });

    expect(created).toEqual({ recordId: 'www|A' });
    const batch = changeBatchOf(calls);
    expect(batch.Changes[0]!.Action).toBe('CREATE');
    expect(batch.Changes[0]!.ResourceRecordSet).toMatchObject({
      Name: 'www.example.com.',
      Type: 'A',
      TTL: 300,
      ResourceRecords: [{ Value: '203.0.113.9' }],
    });
  });

  it('refuses a TTL Route 53 cannot represent instead of quietly changing it', async () => {
    const { transport, calls } = scriptedTransport((call) => {
      if (call.name === 'GetHostedZoneCommand') return { HostedZone: { Name: 'example.com.' } };
      return {};
    });
    const provider = new Route53DnsProvider(CREDS, transport);

    await expect(
      provider.createRecord('Z1', { zoneId: 'z', name: 'www', type: 'A', content: '203.0.113.9', ttl: 1 }),
    ).rejects.toMatchObject({ code: 'DNS_PROVIDER_UNSUPPORTED_OPERATION', statusCode: 400 });
    expect(calls.some((call) => call.name === 'ChangeResourceRecordSetsCommand')).toBe(false);
    expect(ROUTE53_MIN_TTL).toBe(60);
  });

  it('merges a patch onto the live record set and UPSERTs the complete values', async () => {
    const { transport, calls } = scriptedTransport((call) => {
      if (call.name === 'GetHostedZoneCommand') return { HostedZone: { Name: 'example.com.' } };
      if (call.name === 'ListResourceRecordSetsCommand') {
        return {
          ResourceRecordSets: [
            { Name: 'www.example.com.', Type: 'A', TTL: 300, ResourceRecords: [{ Value: '203.0.113.9' }] },
          ],
        };
      }
      return {};
    });
    const provider = new Route53DnsProvider(CREDS, transport);

    await provider.updateRecord('Z1', 'www|A', { ttl: 600 });

    const batch = changeBatchOf(calls);
    expect(batch.Changes[0]!.Action).toBe('UPSERT');
    expect(batch.Changes[0]!.ResourceRecordSet).toMatchObject({
      Name: 'www.example.com.',
      TTL: 600,
      ResourceRecords: [{ Value: '203.0.113.9' }],
    });
  });

  it('refuses a rename or type change: that is a different record set', async () => {
    const { transport } = scriptedTransport(() => ({}));
    const provider = new Route53DnsProvider(CREDS, transport);

    await expect(provider.updateRecord('Z1', 'www|A', { name: 'api' })).rejects.toMatchObject({
      code: 'DNS_PROVIDER_UNSUPPORTED_OPERATION',
    });
    await expect(provider.updateRecord('Z1', 'www|A', { type: 'CNAME' })).rejects.toMatchObject({
      code: 'DNS_PROVIDER_UNSUPPORTED_OPERATION',
    });
  });

  it('deletes with the exact deployed record set read back from Route 53', async () => {
    const deployed = { Name: 'www.example.com.', Type: 'A', TTL: 300, ResourceRecords: [{ Value: '203.0.113.9' }] };
    const { transport, calls } = scriptedTransport((call) => {
      if (call.name === 'GetHostedZoneCommand') return { HostedZone: { Name: 'example.com.' } };
      if (call.name === 'ListResourceRecordSetsCommand') return { ResourceRecordSets: [deployed] };
      return {};
    });
    const provider = new Route53DnsProvider(CREDS, transport);

    await provider.deleteRecord('Z1', 'www|A');

    const batch = changeBatchOf(calls);
    expect(batch.Changes[0]!.Action).toBe('DELETE');
    expect(batch.Changes[0]!.ResourceRecordSet).toEqual(deployed);
  });

  it('reports a missing record set instead of inventing one', async () => {
    const { transport } = scriptedTransport((call) => {
      if (call.name === 'GetHostedZoneCommand') return { HostedZone: { Name: 'example.com.' } };
      if (call.name === 'ListResourceRecordSetsCommand') return { ResourceRecordSets: [] };
      return {};
    });
    const provider = new Route53DnsProvider(CREDS, transport);

    await expect(provider.deleteRecord('Z1', 'www|A')).rejects.toMatchObject({
      code: 'DNS_PROVIDER_NOT_FOUND',
      statusCode: 404,
    });
    await expect(provider.resolveRecordId('Z1', 'www', 'A')).resolves.toBeNull();
  });

  it('translates Route 53 failures without leaking provider payloads', async () => {
    const cases: Array<{ error: { name: string; message: string }; code: string; status: number }> = [
      { error: { name: 'NoSuchHostedZone', message: 'no such zone' }, code: 'DNS_PROVIDER_NOT_FOUND', status: 404 },
      { error: { name: 'HostedZoneNotEmpty', message: 'still has records' }, code: 'DNS_PROVIDER_CONFLICT', status: 409 },
      { error: { name: 'AccessDenied', message: 'not authorized' }, code: 'DNS_PROVIDER_AUTH_FAILED', status: 502 },
      { error: { name: 'Throttling', message: 'slow down' }, code: 'DNS_PROVIDER_RATE_LIMITED', status: 429 },
      { error: { name: 'SomethingNew', message: 'unexpected' }, code: 'DNS_PROVIDER_UPSTREAM_ERROR', status: 502 },
    ];

    for (const testCase of cases) {
      const failing: Route53Transport = {
        async send() {
          const error = new Error(testCase.error.message);
          error.name = testCase.error.name;
          throw error;
        },
      };
      const provider = new Route53DnsProvider(CREDS, failing);
      await expect(provider.deleteZone('Z1')).rejects.toMatchObject({
        code: testCase.code,
        statusCode: testCase.status,
      });
    }
  });

  it('treats an already-existing record set as a conflict to reconcile, never a blind retry', async () => {
    const failing: Route53Transport = {
      async send(command: object) {
        if (commandName(command) === 'GetHostedZoneCommand') return { HostedZone: { Name: 'example.com.' } };
        const error = new Error('Tried to create resource record set [name=www.example.com., type=A] but it already exists');
        error.name = 'InvalidChangeBatch';
        throw error;
      },
    };
    const provider = new Route53DnsProvider(CREDS, failing);

    const rejection = await provider
      .createRecord('Z1', { zoneId: 'z', name: 'www', type: 'A', content: '203.0.113.9' })
      .catch((error: DnsProviderError) => error);
    expect(rejection).toMatchObject({ code: 'DNS_PROVIDER_CONFLICT', statusCode: 409, retryable: false });
  });
});

describe('DNS connector selection is fail-closed', () => {
  it('refuses an unknown provider instead of falling back to the internal engine', () => {
    const db = { query: async () => ({ rows: [] }) };
    expect(() => createDnsProvider('HETZNER_DNS', db as never)).toThrowError(unsupportedDnsOperation('HETZNER_DNS', 'x').constructor);
    expect(() => createDnsProvider('CLOUDFLAR', db as never)).toThrow(/no DNS connector is implemented/);
    expect(() => createDnsProvider('HETZNER_DNS', db as never)).toThrow(/HETZNER_DNS/);
  });

  it('accepts exactly the connectors that exist', () => {
    const db = { query: async () => ({ rows: [] }) };
    expect(SUPPORTED_DNS_PROVIDERS).toEqual(['INTERNAL', 'CLOUDFLARE', 'ROUTE53']);
    expect(createDnsProvider('INTERNAL', db as never).name).toBe('INTERNAL');
    expect(createDnsProvider('cloudflare', db as never).name).toBe('CLOUDFLARE');
    expect(createDnsProvider('route53', db as never).name).toBe('ROUTE53');
    expect(isSupportedDnsProvider('cloudflare')).toBe(true);
    expect(isSupportedDnsProvider('dnsmadeeasy')).toBe(false);
  });

  it('a provider refusal is a 400 the customer can act on, not a 503 retry invitation', () => {
    const error = unsupportedDnsOperation('HETZNER_DNS', 'no DNS connector is implemented for this provider in this build');
    expect(error.statusCode).toBe(400);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/no DNS connector is implemented/);
  });
});
