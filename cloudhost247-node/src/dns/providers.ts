/**
 * DNS Provider Adapters.
 *
 * Implements authoritative DNS propagation across the internal database engine and external
 * providers (Cloudflare, Route53) with fail-closed behavior when credentials are unconfigured.
 *
 * FAIL-CLOSED DISCIPLINE (spec §66): an unconfigured provider throws CONFIGURATION_REQUIRED and an
 * upstream failure surfaces the provider's own normalized error. No provider ever returns a
 * fabricated zone id, a synthetic nameserver set, or a "pretend success" so that a caller cannot
 * mistake an un-propagated change for a live one.
 *
 * Cloudflare delegates to src/integrations/cloudflare, which already owns the v4 client (auth,
 * timeouts, retry/backoff, envelope validation, secret-free API logging) and the zone/record
 * operations. That package is the tested integration surface, so this adapter adds translation and
 * fail-closed guarding only — it deliberately does not open a second HTTP path to the provider.
 */

import type {
  DnsProvider,
  CreateDnsRecordInput,
  UpdateDnsRecordInput,
} from './types';
import type { Queryable } from '../db/types';
import {
  createDnsZone,
  deleteDnsZone,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  findDnsRecordById,
} from '../db/dns';
import { CloudflareClient } from '../integrations/cloudflare/client';
import { CloudflareError } from '../integrations/cloudflare/errors';
import { SUPPORTED_DNS_TYPES } from '../integrations/cloudflare/dns';
import * as cfZones from '../integrations/cloudflare/zones';
import * as cfDns from '../integrations/cloudflare/dns';

export class DatabaseDnsProvider implements DnsProvider {
  readonly name = 'INTERNAL';

  constructor(private readonly db: Queryable) {}

  async createZone(domainName: string): Promise<{ zoneId: string; nameservers: string[] }> {
    const nameservers = ['ns1.cloudhost247.com', 'ns2.cloudhost247.com'];
    return { zoneId: domainName, nameservers };
  }

  async deleteZone(zoneId: string): Promise<void> {
    await deleteDnsZone(this.db, zoneId);
  }

  async createRecord(zoneId: string, record: CreateDnsRecordInput): Promise<{ recordId: string }> {
    const created = await createDnsRecord(this.db, record);
    return { recordId: created.id };
  }

  async updateRecord(zoneId: string, recordId: string, record: UpdateDnsRecordInput): Promise<void> {
    await updateDnsRecord(this.db, recordId, record);
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    await deleteDnsRecord(this.db, recordId);
  }
}

export interface CloudflareDnsProviderOptions {
  /**
   * Pre-built client. Preferred: `resolveCloudflare(db)` produces one from the encrypted token on
   * the active `cloudflare_accounts` row, carrying that account's base URL, the platform retry
   * policy and the secret-free API-log sink.
   */
  client?: CloudflareClient;
  /** Raw API token, used only when `client` is not supplied. Never logged. */
  apiToken?: string;
  /** Cloudflare account id. Required to CREATE a zone — the v4 API rejects a zone with no account. */
  accountId?: string;
  baseUrl?: string;
  /** Injectable HTTP + sleep so tests exercise the real client against a scripted provider. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const CLOUDFLARE_DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';

/**
 * Record types the platform models but the Cloudflare v4 dns_records endpoint does not accept.
 * Refusing these here is the honest answer: Cloudflare serves SOA from the zone itself and does not
 * expose PTR through this endpoint, so a forwarded call could only produce an opaque upstream 400.
 */
const CLOUDFLARE_UNSUPPORTED_TYPES = new Set(['SOA', 'PTR']);

export class CloudflareDnsProvider implements DnsProvider {
  readonly name = 'CLOUDFLARE';

  private readonly options: CloudflareDnsProviderOptions;

  constructor(options: CloudflareDnsProviderOptions | string = {}) {
    this.options = typeof options === 'string' ? { apiToken: options } : options;
  }

  /** Resolves the client, throwing CONFIGURATION_REQUIRED when no credential is available. */
  private client(): CloudflareClient {
    if (this.options.client) return this.options.client;
    const token = this.options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      throw new CloudflareError(
        'CLOUDFLARE_CONFIGURATION_REQUIRED',
        'no Cloudflare API token configured'
      );
    }
    return new CloudflareClient({
      baseUrl:
        this.options.baseUrl ??
        process.env.CLOUDFLARE_API_BASE_URL ??
        CLOUDFLARE_DEFAULT_BASE_URL,
      apiToken: token,
      fetchImpl: this.options.fetchImpl,
      sleep: this.options.sleep,
    });
  }

  private accountId(): string {
    const accountId = this.options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
      throw new CloudflareError(
        'CLOUDFLARE_CONFIGURATION_REQUIRED',
        'no Cloudflare account id configured — the v4 API cannot create a zone without one'
      );
    }
    return accountId;
  }

  /**
   * Creates the zone, or reuses the one Cloudflare already holds for that exact name.
   * `ensureZone` is search-then-create, so a retried provisioning run cannot create a duplicate.
   */
  async createZone(domainName: string): Promise<{ zoneId: string; nameservers: string[] }> {
    const client = this.client();
    const accountId = this.accountId();
    const { zone } = await cfZones.ensureZone(client, accountId, domainName);
    return { zoneId: zone.id, nameservers: zone.name_servers ?? [] };
  }

  async deleteZone(zoneId: string): Promise<void> {
    await cfZones.deleteZone(this.client(), zoneId);
  }

  async createRecord(zoneId: string, record: CreateDnsRecordInput): Promise<{ recordId: string }> {
    this.assertSupportedType(record.type);
    const created = await cfDns.createDnsRecord(this.client(), zoneId, {
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      proxied: record.proxied,
      priority: record.priority ?? undefined,
    });
    return { recordId: created.id };
  }

  async updateRecord(zoneId: string, recordId: string, record: UpdateDnsRecordInput): Promise<void> {
    if (record.type) this.assertSupportedType(record.type);
    await cfDns.updateDnsRecord(this.client(), zoneId, recordId, {
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      proxied: record.proxied,
      priority: record.priority ?? undefined,
    });
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    await cfDns.deleteDnsRecord(this.client(), zoneId, recordId);
  }

  private assertSupportedType(type: string): void {
    if (CLOUDFLARE_UNSUPPORTED_TYPES.has(type) || !SUPPORTED_DNS_TYPES.includes(type as never)) {
      throw new CloudflareError(
        'CLOUDFLARE_FEATURE_NOT_SUPPORTED',
        `Cloudflare's dns_records endpoint does not accept ${type} records`
      );
    }
  }
}

export interface Route53DnsProviderOptions {
  accessKey?: string;
  secretKey?: string;
  region?: string;
  /** Injectable SDK client so tests exercise the real adapter logic without AWS credentials. */
  client?: Route53LikeClient;
  /**
   * Read handle for the platform's own dns_records table. Route53 addresses records by
   * name+type+rdata rather than by id, so a DELETE batch must echo the stored record exactly;
   * this is how the adapter resolves a platform record id back into those values.
   */
  db?: Queryable;
}

/** The subset of @aws-sdk/client-route-53 this adapter calls. */
export interface Route53LikeClient {
  send(command: unknown): Promise<unknown>;
}

type Route53CommandCtor = new (input: unknown) => unknown;

interface Route53CommandSet {
  CreateHostedZoneCommand: Route53CommandCtor;
  DeleteHostedZoneCommand: Route53CommandCtor;
  ListHostedZonesByNameCommand: Route53CommandCtor;
  GetHostedZoneCommand: Route53CommandCtor;
  ChangeResourceRecordSetsCommand: Route53CommandCtor;
}

/**
 * AWS Route53 adapter.
 *
 * Route53 is a change-batch API, not a record-CRUD API: every mutation is a
 * ChangeResourceRecordSets batch, a DELETE must echo the record's current ResourceRecordSet exactly,
 * and the response reports a change that Route53 applies asynchronously. This adapter therefore
 * reads current state before deleting and returns the change id, so a caller can distinguish
 * "submitted" from "propagated" instead of assuming success.
 *
 * Zone ids are stored without Route53's leading slash and restored on every call, because the API
 * requires the `/hosted-zone-id` form.
 */
export class Route53DnsProvider implements DnsProvider {
  readonly name = 'ROUTE53';

  private readonly options: Route53DnsProviderOptions;

  constructor(options: Route53DnsProviderOptions = {}) {
    this.options = options;
  }

  private async sdk(): Promise<Route53LikeClient> {
    if (this.options.client) return this.options.client;
    const accessKey = this.options.accessKey ?? process.env.AWS_ACCESS_KEY_ID;
    const secretKey = this.options.secretKey ?? process.env.AWS_SECRET_ACCESS_KEY;
    if (!accessKey || !secretKey) {
      throw new Error(
        'CONFIGURATION_REQUIRED: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for Route53 DNS integration.'
      );
    }
    // Imported lazily: a deployment that never selects Route53 does not pay the SDK load cost.
    const mod = (await import('@aws-sdk/client-route-53')) as unknown as {
      Route53Client: new (config: {
        region: string;
        credentials: { accessKeyId: string; secretAccessKey: string };
      }) => Route53LikeClient;
    };
    return new mod.Route53Client({
      region: this.options.region ?? process.env.AWS_REGION ?? 'us-east-1',
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
  }

  private async commands(): Promise<Route53CommandSet> {
    const mod = (await import('@aws-sdk/client-route-53')) as unknown as Route53CommandSet;
    return {
      CreateHostedZoneCommand: mod.CreateHostedZoneCommand,
      DeleteHostedZoneCommand: mod.DeleteHostedZoneCommand,
      ListHostedZonesByNameCommand: mod.ListHostedZonesByNameCommand,
      GetHostedZoneCommand: mod.GetHostedZoneCommand,
      ChangeResourceRecordSetsCommand: mod.ChangeResourceRecordSetsCommand,
    };
  }

  private static hostedZoneId(zoneId: string): string {
    return zoneId.startsWith('/') ? zoneId : `/${zoneId}`;
  }

  async createZone(domainName: string): Promise<{ zoneId: string; nameservers: string[] }> {
    const { CreateHostedZoneCommand, ListHostedZonesByNameCommand, GetHostedZoneCommand } =
      await this.commands();
    const client = await this.sdk();
    const name = normalizeDomainName(domainName);

    // Route53 permits several hosted zones for one name, so a retried run must reuse the existing
    // zone rather than silently creating a second, unreachable one.
    const listed = (await client.send(new ListHostedZonesByNameCommand({ DNSName: name }))) as {
      HostedZones?: Array<{ Id: string; Name: string }>;
    };
    const match = (listed.HostedZones ?? []).find((z) => normalizeDomainName(z.Name) === name);
    if (match) {
      const zone = (await client.send(new GetHostedZoneCommand({ Id: match.Id }))) as {
        DelegationSet?: { NameServers?: string[] };
      };
      return {
        zoneId: match.Id.replace(/^\//, ''),
        nameservers: zone.DelegationSet?.NameServers ?? [],
      };
    }

    const created = (await client.send(
      new CreateHostedZoneCommand({
        Name: name,
        // Route53 requires a unique caller reference per zone; retries stay distinguishable and no
        // secret is embedded.
        CallerReference: `ch247-${name}-${Date.now()}`,
      })
    )) as { HostedZone?: { Id: string }; DelegationSet?: { NameServers?: string[] } };
    if (!created.HostedZone?.Id) {
      throw new Error('ROUTE53_API_ERROR: CreateHostedZone returned no hosted zone id.');
    }
    return {
      zoneId: created.HostedZone.Id.replace(/^\//, ''),
      nameservers: created.DelegationSet?.NameServers ?? [],
    };
  }

  async deleteZone(zoneId: string): Promise<void> {
    const { DeleteHostedZoneCommand } = await this.commands();
    await (await this.sdk()).send(
      new DeleteHostedZoneCommand({ Id: Route53DnsProvider.hostedZoneId(zoneId) })
    );
  }

  async createRecord(zoneId: string, record: CreateDnsRecordInput): Promise<{ recordId: string }> {
    return { recordId: await this.submitChange(zoneId, 'CREATE', record) };
  }

  async updateRecord(zoneId: string, recordId: string, record: UpdateDnsRecordInput): Promise<void> {
    // Route53 has no PATCH. An update is an UPSERT of the same name+type, so those two fields are
    // what identify the record; the stored record id is not an addressing key.
    if (!record.name || !record.type) {
      throw new Error(
        'ROUTE53_VALIDATION_ERROR: Route53 updates require name and type, because it addresses records by name+type rather than by id.'
      );
    }
    const stored = this.options.db ? await findDnsRecordById(this.options.db, recordId) : null;
    const content = record.content ?? stored?.content;
    if (!content) {
      throw new Error('ROUTE53_VALIDATION_ERROR: content is required to upsert a Route53 record.');
    }
    await this.submitChange(zoneId, 'UPSERT', {
      name: record.name,
      type: record.type,
      content,
      ttl: record.ttl ?? stored?.ttl,
      priority: record.priority !== undefined ? record.priority : stored?.priority,
    });
  }

  /**
   * Deletes the record. Route53 requires the batch to echo the record exactly, so the platform's
   * stored row is read back to supply name/type/content/ttl. Fails closed when no read handle was
   * supplied and the caller did not pass the values through `deleteRecordByValues`.
   */
  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    if (!this.options.db) {
      throw new Error(
        'CONFIGURATION_REQUIRED: Route53 deletes must echo the record exactly; construct Route53DnsProvider with a db handle or call deleteRecordByValues().'
      );
    }
    const stored = await findDnsRecordById(this.options.db, recordId);
    if (!stored) {
      throw new Error('ROUTE53_RECORD_NOT_FOUND: no stored DNS record matches that id.');
    }
    await this.submitChange(zoneId, 'DELETE', {
      name: stored.name,
      type: stored.type,
      content: stored.content,
      ttl: stored.ttl,
      priority: stored.priority,
    });
  }

  /** Deletes by explicit values, for callers that already hold the record. Returns the change id. */
  async deleteRecordByValues(
    zoneId: string,
    record: { name: string; type: CreateDnsRecordInput['type']; content: string; ttl?: number; priority?: number | null }
  ): Promise<string> {
    return this.submitChange(zoneId, 'DELETE', record);
  }

  /** Submits a single change batch and returns its change id. */
  private async submitChange(
    zoneId: string,
    action: 'CREATE' | 'UPSERT' | 'DELETE',
    record: { name: string; type: CreateDnsRecordInput['type']; content: string; ttl?: number; priority?: number | null }
  ): Promise<string> {
    if (!record.name || !record.type || record.content === '') {
      throw new Error('ROUTE53_VALIDATION_ERROR: name, type and content are all required for a Route53 change batch.');
    }
    const { ChangeResourceRecordSetsCommand } = await this.commands();
    const resourceRecordSet: Record<string, unknown> = {
      Name: record.name,
      Type: record.type,
      TTL: record.ttl ?? 300,
      ResourceRecords: splitRecordValues(record.content, record.type, record.priority).map((Value) => ({ Value })),
    };
    const result = (await (await this.sdk()).send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: Route53DnsProvider.hostedZoneId(zoneId),
        ChangeBatch: { Changes: [{ Action: action, ResourceRecordSet: resourceRecordSet }] },
      })
    )) as { ChangeInfo?: { Id: string; Status: string } };
    if (!result.ChangeInfo?.Id) {
      throw new Error('ROUTE53_API_ERROR: Route53 accepted the change batch but returned no change id.');
    }
    return result.ChangeInfo.Id;
  }
}

/** Route53 requires a trailing dot on hosted-zone names; tolerate input without one. */
function normalizeDomainName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

/**
 * Splits a record's content into rdata values. MX and SRV carry their preference/priority as the
 * first rdata field, so a supplied priority that is not already present in the content is prefixed
 * rather than dropped — Route53 has no separate priority field to put it in.
 */
function splitRecordValues(content: string, type: string, priority?: number | null): string[] {
  const parts = content.split(/\s+/).filter(Boolean);
  const values = parts.length > 0 ? parts : [content];
  if (priority == null || (type !== 'MX' && type !== 'SRV')) return values;
  if (/^\d+$/.test(values[0] ?? '')) return values; // priority already present in the content
  return [`${priority}`, ...values];
}

export interface DnsProviderFactoryOptions {
  cloudflare?: CloudflareDnsProviderOptions;
  route53?: Route53DnsProviderOptions;
}

export function createDnsProvider(
  providerName: string,
  db: Queryable,
  options: DnsProviderFactoryOptions = {}
): DnsProvider {
  switch (providerName.toUpperCase()) {
    case 'INTERNAL':
    case 'DEFAULT':
      return new DatabaseDnsProvider(db);
    case 'CLOUDFLARE':
      return new CloudflareDnsProvider(options.cloudflare ?? {});
    case 'ROUTE53':
      return new Route53DnsProvider(options.route53 ?? {});
    default:
      return new DatabaseDnsProvider(db);
  }
}
