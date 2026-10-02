/**
 * Cloudflare DNS connector for the authoritative-DNS engine (A11).
 *
 * This is a thin, honest adapter over the existing Cloudflare integration — it reuses the shared
 * client, zone and record operations rather than re-implementing HTTP:
 *
 *  - the API token lives in the vault-backed `cloudflare_accounts` row (encrypted with the platform
 *    key ring) and is decrypted only server-side, only when a client is built;
 *  - zone creation is search-then-create, so a retried run cannot create a duplicate zone;
 *  - Cloudflare addresses records by its own record id, which this connector returns from
 *    `createRecord` and requires for update/delete. `resolveRecordId` is the explicit,
 *    ambiguity-refusing fallback for rows that predate the wiring — it never guesses between
 *    multiple records that share a name and type;
 *  - record types Cloudflare's DNS module does not serve (PTR, SOA) are refused with the reason, and
 *    proxying is only offered for the types Cloudflare proxies (A, AAAA, CNAME).
 */
import type { CloudflareClient } from '../integrations/cloudflare/client';
import { resolveCloudflare } from '../integrations/cloudflare/config';
import {
  SUPPORTED_DNS_TYPES,
  createDnsRecord as cfCreateDnsRecord,
  deleteDnsRecord as cfDeleteDnsRecord,
  listDnsRecords as cfListDnsRecords,
  updateDnsRecord as cfUpdateDnsRecord,
} from '../integrations/cloudflare/dns';
import { getZone as cfGetZone, deleteZone as cfDeleteZone, ensureZone as cfEnsureZone } from '../integrations/cloudflare/zones';
import type { Queryable } from '../db/types';
import type { CreateDnsRecordInput, DnsProvider, DnsRecordType, UpdateDnsRecordInput } from './types';
import { dnsConflict, dnsNotFound, unsupportedDnsOperation } from './errors';

const CF_SUPPORTED_TYPES: readonly string[] = SUPPORTED_DNS_TYPES;
const PROXYABLE_TYPES: readonly DnsRecordType[] = ['A', 'AAAA', 'CNAME'];

/** An already-resolved client + account id (used by callers and by tests). Production resolves the
 * vault-backed account row through `resolveCloudflare`. */
export interface CloudflareDnsSeam {
  client: CloudflareClient;
  accountId: string;
  accountName?: string;
}

export class CloudflareDnsProvider implements DnsProvider {
  readonly name = 'CLOUDFLARE';
  private resolved: CloudflareDnsSeam | null;

  constructor(private readonly db: Queryable, seam?: CloudflareDnsSeam) {
    this.resolved = seam ?? null;
  }

  private async resolve(): Promise<CloudflareDnsSeam> {
    if (this.resolved) return this.resolved;
    // Fails closed with CLOUDFLARE_CONFIGURATION_REQUIRED when no active account/token exists.
    const { account, client } = await resolveCloudflare(this.db);
    this.resolved = {
      client,
      accountId: account.cloudflare_account_id,
      accountName: account.account_name,
    };
    return this.resolved;
  }

  private assertTypeSupported(type: string): asserts type is DnsRecordType {
    if (!CF_SUPPORTED_TYPES.includes(type)) {
      throw unsupportedDnsOperation(
        'CLOUDFLARE',
        `Cloudflare's DNS module does not serve ${type} records (supported: ${CF_SUPPORTED_TYPES.join(', ')})`,
      );
    }
  }

  private assertProxiable(type: string, proxied: boolean | undefined): void {
    if (proxied && !PROXYABLE_TYPES.includes(type as DnsRecordType)) {
      throw unsupportedDnsOperation(
        'CLOUDFLARE',
        `only ${PROXYABLE_TYPES.join(', ')} records can be proxied through Cloudflare; ${type} records cannot`,
      );
    }
  }

  /** Maps a platform record name onto Cloudflare's fully-qualified name for lookup purposes. */
  private static qualifiedName(zoneName: string, name: string): string {
    const zone = zoneName.trim().replace(/\.$/, '').toLowerCase();
    const candidate = name.trim().toLowerCase();
    if (candidate === '@' || candidate === '') return zone;
    if (candidate === zone || candidate.endsWith(`.${zone}`)) return candidate;
    return `${candidate}.${zone}`;
  }

  /**
   * The provider's own record id for a (name, type) pair. Refuses when several records match, so an
   * ambiguous zone is reported for reconciliation instead of one record being edited by accident.
   */
  async resolveRecordId(zoneId: string, name: string, type: DnsRecordType): Promise<string | null> {
    const { client } = await this.resolve();
    const zone = await cfGetZone(client, zoneId);
    const wanted = CloudflareDnsProvider.qualifiedName(zone.name, name).toLowerCase();
    const matches = (await cfListDnsRecords(client, zoneId)).filter(
      (record) => record.type.toUpperCase() === type.toUpperCase() && record.name.toLowerCase() === wanted,
    );
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw dnsConflict(
        'CLOUDFLARE',
        `${matches.length} records named ${wanted} of type ${type} exist in this zone; reconcile them in Cloudflare before changing them from here`,
      );
    }
    return matches[0]!.id;
  }

  async createZone(domainName: string): Promise<{ zoneId: string; nameservers: string[] }> {
    const { client, accountId } = await this.resolve();
    const { zone } = await cfEnsureZone(client, accountId, domainName.toLowerCase());
    return { zoneId: zone.id, nameservers: zone.name_servers ?? [] };
  }

  async deleteZone(zoneId: string): Promise<void> {
    const { client } = await this.resolve();
    await cfDeleteZone(client, zoneId);
  }

  async createRecord(zoneId: string, record: CreateDnsRecordInput): Promise<{ recordId: string }> {
    this.assertTypeSupported(record.type);
    this.assertProxiable(record.type, record.proxied);
    const { client } = await this.resolve();
    const created = await cfCreateDnsRecord(client, zoneId, {
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      proxied: record.proxied,
      priority: record.priority ?? undefined,
    });
    return { recordId: created.id };
  }

  async updateRecord(zoneId: string, recordId: string, patch: UpdateDnsRecordInput): Promise<void> {
    if (patch.type) this.assertTypeSupported(patch.type);
    this.assertProxiable(patch.type ?? '', patch.proxied);
    const { client } = await this.resolve();
    await cfUpdateDnsRecord(client, zoneId, recordId, {
      ...(patch.type ? { type: patch.type } : {}),
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.content ? { content: patch.content } : {}),
      ...(patch.ttl !== undefined ? { ttl: patch.ttl } : {}),
      ...(patch.proxied !== undefined ? { proxied: patch.proxied } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority ?? undefined } : {}),
    });
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    const { client } = await this.resolve();
    try {
      await cfDeleteDnsRecord(client, zoneId, recordId);
    } catch (error) {
      // A record that is already gone is not an error for a delete: report it as done.
      const shape = error as { code?: string };
      if (shape.code === 'CLOUDFLARE_RECORD_NOT_FOUND') return;
      if (shape.code === 'CLOUDFLARE_ZONE_NOT_FOUND') {
        throw dnsNotFound('CLOUDFLARE', 'the zone no longer exists at Cloudflare');
      }
      throw error;
    }
  }
}
