/**
 * AWS Route 53 DNS connector (A11).
 *
 * Route 53 has no per-record identifiers: a record set is addressed by (name, type), and every
 * change must carry the *complete* set including its exact current values. This connector honours
 * that contract instead of pretending otherwise:
 *
 *  - `recordId` is `"<relative name>|<type>"` (e.g. `www|A`, `@|MX`) — the provider's own identity
 *    for the set, so update/delete can locate it deterministically and never by guesswork.
 *  - update/delete read the live record set first and submit the merged / exact values, because
 *    Route 53 rejects a change whose values do not match what is deployed.
 *  - changing a record's name or type is a *different record set*; that is refused with the reason
 *    rather than silently creating a second set.
 *  - MX/SRV priority is folded into the value the way Route 53 models it, TXT values are quoted and
 *    chunked, and target names are written fully qualified.
 *
 * Credentials come from the deployment environment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY,
 * optional AWS_SESSION_TOKEN). Every operation fails closed *before* any network call when they are
 * absent. `client` is an injectable transport so tests exercise the real command construction
 * against a scripted Route 53; there is no simulated fallback in production code.
 */
import { randomUUID } from 'node:crypto';
import {
  ChangeResourceRecordSetsCommand,
  CreateHostedZoneCommand,
  DeleteHostedZoneCommand,
  GetHostedZoneCommand,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
} from '@aws-sdk/client-route-53';
import type { ResourceRecordSet, RRType } from '@aws-sdk/client-route-53';
import type { CreateDnsRecordInput, DnsProvider, DnsRecordType, UpdateDnsRecordInput } from './types';
import {
  DnsProviderError,
  dnsConfigurationRequired,
  dnsNotFound,
  mapAwsRoute53Failure,
  unsupportedDnsOperation,
} from './errors';

/** Minimal command transport surface, which also makes command construction unit-testable. */
export type Route53Transport = { send(command: object): Promise<unknown> };

/** Route 53 requires a TTL of 60 or greater (or an alias with no TTL, which we never create). */
export const ROUTE53_MIN_TTL = 60;

const RECORD_ID_SEPARATOR = '|';

export function route53RecordId(name: string, type: DnsRecordType): string {
  return `${name}${RECORD_ID_SEPARATOR}${type}`;
}

export interface ParsedRoute53RecordId {
  name: string;
  type: DnsRecordType;
}

export function parseRoute53RecordId(recordId: string): ParsedRoute53RecordId {
  const separator = recordId.lastIndexOf(RECORD_ID_SEPARATOR);
  if (separator <= 0 || separator === recordId.length - 1) {
    throw new DnsProviderError('DNS_PROVIDER_REJECTED', {
      detail: `ROUTE53: record identifier "${recordId}" is not a name|type pair produced by this connector`,
    });
  }
  return { name: recordId.slice(0, separator), type: recordId.slice(separator + 1) as DnsRecordType };
}

/* ------------------------------------------------------------------------------------------------
 * Value shaping — the part of the Route 53 contract that differs from a per-record provider.
 * ---------------------------------------------------------------------------------------------- */

function isIpv4(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

function isIpv6(value: string): boolean {
  return value.includes(':') && /^[0-9a-fA-F:.]+$/.test(value);
}

/** Route 53 wants target names fully qualified, and treats missing dots as such only for CNAME. */
function ensureFqdn(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith('.')) return trimmed;
  if (isIpv4(trimmed) || isIpv6(trimmed)) return trimmed;
  return `${trimmed}.`;
}

/** Only the target (last field) of a SRV value is a name. */
function ensureSrvTargetFqdn(value: string): string {
  const fields = value.trim().split(/\s+/);
  const last = fields[fields.length - 1];
  if (!last || fields.length < 2) return value.trim();
  fields[fields.length - 1] = ensureFqdn(last);
  return fields.join(' ');
}

function alreadyCarriesPriority(content: string): boolean {
  return /^\d+\s/.test(content.trim());
}

/** Splits a TXT value into the ≤255-character quoted strings Route 53 requires. */
export function route53TxtStrings(content: string): string[] {
  const unquoted = content.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/\\"/g, '"');
  const escaped = unquoted.replace(/"/g, '\\"');
  const chunks: string[] = [];
  for (let index = 0; index < escaped.length; index += 255) {
    chunks.push(escaped.slice(index, index + 255));
  }
  return (chunks.length > 0 ? chunks : ['']).map((chunk) => `"${chunk}"`);
}

/**
 * Shapes one platform record into the Route 53 wire value(s). Types whose Route 53 encoding carries
 * the priority in the value string (MX, SRV) fold the column in exactly once, so a call cannot
 * produce `10 10 mail.` when the value already carried its own priority.
 */
export function route53RecordValues(
  type: DnsRecordType,
  content: string,
  priority: number | null | undefined,
): string[] {
  const value = content.trim();
  const carriesPriority = priority !== null && priority !== undefined && !alreadyCarriesPriority(value);

  switch (type) {
    case 'TXT':
      return route53TxtStrings(value);
    case 'MX':
      return carriesPriority ? [`${priority} ${ensureFqdn(value)}`] : [ensureFqdn(value)];
    case 'SRV': {
      // Route 53's SRV value is "priority weight port target". A four-field value already carries
      // its priority; a three-field value (weight port target) takes the priority column.
      const fields = value.split(/\s+/).filter(Boolean);
      const carriesOwnPriority = fields.length >= 4;
      const priorityGiven = priority !== null && priority !== undefined;
      const withPriority = !carriesOwnPriority && priorityGiven ? `${priority} ${value}` : value;
      return [ensureSrvTargetFqdn(withPriority)];
    }
    case 'CNAME':
    case 'NS':
    case 'PTR':
      return [ensureFqdn(value)];
    default:
      return [value];
  }
}

function isQuotedTxt(value: string): boolean {
  return /^".*"$/s.test(value.trim());
}

/** Turns a deployed Route 53 record set back into the platform's single content column. */
export function route53ContentFromRecordSet(recordSet: ResourceRecordSet): string {
  const first = recordSet.ResourceRecords?.[0]?.Value ?? '';
  if ((recordSet.Type ?? '').toUpperCase() === 'TXT' && isQuotedTxt(first)) {
    return first.trim().replace(/^"(.*)"$/s, '$1').replace(/\\"/g, '"');
  }
  return first;
}

function normalizeZoneName(name: string): string {
  return name.trim().replace(/\.$/, '').toLowerCase();
}

/** Maps a platform record name (`@`, `www`, or an already-qualified name) onto Route 53's FQDN. */
export function route53Fqdn(zoneName: string, name: string): string {
  const zone = normalizeZoneName(zoneName);
  const candidate = name.trim().toLowerCase();
  if (candidate === '@' || candidate === '') return `${zone}.`;
  if (candidate === zone) return `${zone}.`;
  if (candidate.endsWith(`.${zone}`)) return `${candidate.replace(/\.$/, '')}.`;
  return `${candidate}.${zone}.`;
}

export class Route53DnsProvider implements DnsProvider {
  readonly name = 'ROUTE53';
  private readonly client: Route53Transport;
  private readonly credentialsPresent: boolean;
  /** Per-instance zone-name memo for the (name, type) → record-set addressing. */
  private readonly zoneNames = new Map<string, string>();

  constructor(source: NodeJS.ProcessEnv = process.env, client?: Route53Transport) {
    const accessKeyId = source.AWS_ACCESS_KEY_ID;
    const secretAccessKey = source.AWS_SECRET_ACCESS_KEY;
    const sessionToken = source.AWS_SESSION_TOKEN;
    this.credentialsPresent = Boolean(accessKeyId && secretAccessKey);

    // Route 53 is a global service signed in us-east-1; an EC2 region setting must not leak in.
    this.client = client ?? new Route53Client({
      region: 'us-east-1',
      ...(this.credentialsPresent
        ? {
            credentials: {
              accessKeyId: accessKeyId!,
              secretAccessKey: secretAccessKey!,
              ...(sessionToken ? { sessionToken } : {}),
            },
          }
        : {}),
    });
  }

  /** Fail-closed guard: every operation calls this before touching the network. */
  private requireConfigured(): void {
    if (!this.credentialsPresent) {
      throw dnsConfigurationRequired(
        'ROUTE53',
        'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for the Route 53 connector',
      );
    }
  }

  private async send<T>(command: object): Promise<T> {
    this.requireConfigured();
    try {
      return await this.client.send(command) as T;
    } catch (error) {
      throw mapAwsRoute53Failure(error);
    }
  }

  static normalizeHostedZoneId(rawId: string): string {
    return rawId.replace(/^\/hostedzone\//, '');
  }

  private async zoneNameFor(zoneId: string): Promise<string> {
    const cached = this.zoneNames.get(zoneId);
    if (cached) return cached;
    const zone = await this.send<{ HostedZone?: { Name?: string } }>(new GetHostedZoneCommand({ Id: zoneId }));
    const name = zone.HostedZone?.Name;
    if (!name) throw dnsNotFound('ROUTE53', 'the hosted zone could not be read');
    this.zoneNames.set(zoneId, name);
    return name;
  }

  /** Exact-name lookup — the idempotency core of createZone. */
  private async findHostedZoneByName(domainName: string): Promise<{ zoneId: string; nameservers: string[] } | null> {
    const requested = normalizeZoneName(domainName);
    const listed = await this.send<{ HostedZones?: Array<{ Id?: string; Name?: string }> }>(
      new ListHostedZonesByNameCommand({ DNSName: requested, MaxItems: 1 }),
    );
    const candidate = (listed.HostedZones ?? [])[0];
    if (!candidate?.Id || !candidate.Name) return null;
    if (normalizeZoneName(candidate.Name) !== requested) return null;

    const zoneId = Route53DnsProvider.normalizeHostedZoneId(candidate.Id);
    const detail = await this.send<{ DelegationSet?: { NameServers?: string[] } }>(
      new GetHostedZoneCommand({ Id: zoneId }),
    );
    return { zoneId, nameservers: detail.DelegationSet?.NameServers ?? [] };
  }

  async createZone(domainName: string): Promise<{ zoneId: string; nameservers: string[] }> {
    this.requireConfigured();
    const requested = normalizeZoneName(domainName);

    // Search-by-exact-name first: a retried provisioning run can never create a duplicate zone.
    const existing = await this.findHostedZoneByName(requested);
    if (existing) {
      this.zoneNames.set(existing.zoneId, `${requested}.`);
      return existing;
    }

    const created = await this.send<{
      HostedZone?: { Id?: string; Name?: string };
      DelegationSet?: { NameServers?: string[] };
    }>(new CreateHostedZoneCommand({ Name: requested, CallerReference: randomUUID() }));

    const rawId = created.HostedZone?.Id;
    if (!rawId) {
      throw new DnsProviderError('DNS_PROVIDER_UPSTREAM_ERROR', {
        detail: 'ROUTE53: create did not return a hosted zone id',
      });
    }
    const zoneId = Route53DnsProvider.normalizeHostedZoneId(rawId);
    this.zoneNames.set(zoneId, created.HostedZone?.Name ?? `${requested}.`);
    return { zoneId, nameservers: created.DelegationSet?.NameServers ?? [] };
  }

  async deleteZone(zoneId: string): Promise<void> {
    this.requireConfigured();
    await this.send(new DeleteHostedZoneCommand({ Id: zoneId }));
  }

  private async readRecordSet(
    zoneId: string,
    name: string,
    type: DnsRecordType,
  ): Promise<ResourceRecordSet | null> {
    const zoneName = await this.zoneNameFor(zoneId);
    const wanted = route53Fqdn(zoneName, name);
    const response = await this.send<{ ResourceRecordSets?: ResourceRecordSet[] }>(
      new ListResourceRecordSetsCommand({
        HostedZoneId: zoneId,
        StartRecordName: wanted,
        StartRecordType: type as RRType,
        MaxItems: 1,
      }),
    );
    const candidate = response.ResourceRecordSets?.[0];
    if (!candidate) return null;
    const candidateName = (candidate.Name ?? '').toLowerCase().replace(/\.$/, '');
    const candidateType = (candidate.Type ?? '').toUpperCase();
    if (candidateName !== wanted.replace(/\.$/, '') || candidateType !== type.toUpperCase()) return null;
    return candidate;
  }

  private buildRecordSet(
    zoneName: string,
    name: string,
    type: DnsRecordType,
    content: string,
    ttl: number | undefined,
    priority: number | null | undefined,
  ): ResourceRecordSet {
    const effectiveTtl = ttl ?? 3600;
    if (!Number.isFinite(effectiveTtl) || effectiveTtl < ROUTE53_MIN_TTL) {
      throw unsupportedDnsOperation(
        'ROUTE53',
        `Route 53 requires a record TTL of at least ${ROUTE53_MIN_TTL} seconds and has no "automatic" TTL option`,
      );
    }
    return {
      Name: route53Fqdn(zoneName, name),
      Type: type.toUpperCase() as RRType,
      TTL: effectiveTtl,
      ResourceRecords: route53RecordValues(type, content, priority).map((Value) => ({ Value })),
    };
  }

  private async change(zoneId: string, action: 'CREATE' | 'UPSERT' | 'DELETE', recordSet: ResourceRecordSet): Promise<void> {
    await this.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: { Changes: [{ Action: action, ResourceRecordSet: recordSet }] },
    }));
  }

  async createRecord(zoneId: string, record: CreateDnsRecordInput): Promise<{ recordId: string }> {
    this.requireConfigured();
    const zoneName = await this.zoneNameFor(zoneId);
    const recordSet = this.buildRecordSet(
      zoneName,
      record.name,
      record.type,
      record.content,
      record.ttl,
      record.priority,
    );
    await this.change(zoneId, 'CREATE', recordSet);
    return { recordId: route53RecordId(record.name, record.type) };
  }

  async updateRecord(zoneId: string, recordId: string, patch: UpdateDnsRecordInput): Promise<void> {
    this.requireConfigured();
    const { name, type } = parseRoute53RecordId(recordId);

    if (patch.type && patch.type !== type) {
      throw unsupportedDnsOperation(
        'ROUTE53',
        `a Route 53 record set is identified by name and type; changing ${name}|${type} to type ${patch.type} requires deleting and recreating it`,
      );
    }
    if (patch.name && patch.name !== name) {
      throw unsupportedDnsOperation(
        'ROUTE53',
        `a Route 53 record set is identified by name and type; renaming ${name}|${type} requires deleting and recreating it`,
      );
    }

    const zoneName = await this.zoneNameFor(zoneId);
    const current = await this.readRecordSet(zoneId, name, type);
    if (!current) throw dnsNotFound('ROUTE53', 'the record set no longer exists at Route 53');
    if (current.AliasTarget) {
      throw unsupportedDnsOperation(
        'ROUTE53',
        'that record is an alias record created outside CloudHost247; edit it in Route 53 directly',
      );
    }

    const content = patch.content ?? route53ContentFromRecordSet(current);
    const ttl = patch.ttl ?? Number(current.TTL ?? 3600);
    const recordSet = this.buildRecordSet(zoneName, name, type, content, ttl, patch.priority);
    await this.change(zoneId, 'UPSERT', recordSet);
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    this.requireConfigured();
    const { name, type } = parseRoute53RecordId(recordId);

    const current = await this.readRecordSet(zoneId, name, type);
    if (!current) throw dnsNotFound('ROUTE53', 'the record set no longer exists at Route 53');
    if (current.AliasTarget) {
      throw unsupportedDnsOperation(
        'ROUTE53',
        'that record is an alias record created outside CloudHost247; delete it in Route 53 directly',
      );
    }

    // Route 53 DELETE requires the exact deployed record set, so the read-back set is echoed.
    await this.change(zoneId, 'DELETE', current);
  }

  /**
   * Route 53 record sets are addressed by (name, type); the deterministic identifier *is* the
   * provider's own identity, so resolution can never be ambiguous.
   */
  async resolveRecordId(zoneId: string, name: string, type: DnsRecordType): Promise<string | null> {
    this.requireConfigured();
    const current = await this.readRecordSet(zoneId, name, type);
    return current ? route53RecordId(name, type) : null;
  }
}
