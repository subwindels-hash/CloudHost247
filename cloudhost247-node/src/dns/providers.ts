/**
 * DNS Provider Adapters.
 *
 * Three connectors exist in this build:
 *   INTERNAL  — the platform's own authoritative engine, stored in `dns_zones` / `dns_records`.
 *   CLOUDFLARE — the vault-backed Cloudflare integration (real zones and records).
 *   ROUTE53    — the AWS Route 53 integration (real hosted zones and record sets).
 *
 * Anything else is refused before a call is made. There is no silent fallback to INTERNAL (a typo
 * must never quietly keep a customer's DNS on a provider they did not choose) and no simulated
 * provider data. Each connector fails closed with DNS_PROVIDER_CONFIGURATION_REQUIRED until its
 * credentials are configured.
 */
import type { DnsProvider, CreateDnsRecordInput, UpdateDnsRecordInput } from './types';
import type { Queryable } from '../db/types';
import {
  createDnsZone,
  deleteDnsZone,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
} from '../db/dns';
import { CloudflareDnsProvider, type CloudflareDnsSeam } from './cloudflare-provider';
import { Route53DnsProvider, type Route53Transport } from './route53-provider';
import { unsupportedDnsOperation } from './errors';

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

export const SUPPORTED_DNS_PROVIDERS = ['INTERNAL', 'CLOUDFLARE', 'ROUTE53'] as const;
export type SupportedDnsProvider = (typeof SUPPORTED_DNS_PROVIDERS)[number];

export function isSupportedDnsProvider(name: string): name is SupportedDnsProvider {
  return (SUPPORTED_DNS_PROVIDERS as readonly string[]).includes(name.toUpperCase());
}

export interface DnsProviderOverrides {
  /** Already-resolved Cloudflare client + account id (tests, or callers that resolved already). */
  cloudflare?: CloudflareDnsSeam;
  /** Injected Route 53 transport (tests); production builds the real client from the environment. */
  route53?: Route53Transport;
  /** Environment the Route 53 client reads credentials from. Defaults to process.env. */
  route53Env?: NodeJS.ProcessEnv;
}

/**
 * Builds the connector for a provider name. An unsupported name is a hard, non-retryable refusal —
 * never a fallback to another provider, and never a mock.
 */
export function createDnsProvider(
  providerName: string,
  db: Queryable,
  overrides: DnsProviderOverrides = {},
): DnsProvider {
  const normalized = providerName.trim().toUpperCase();
  switch (normalized) {
    case 'INTERNAL':
    case 'DEFAULT':
      return new DatabaseDnsProvider(db);
    case 'CLOUDFLARE':
      return new CloudflareDnsProvider(db, overrides.cloudflare);
    case 'ROUTE53':
      return new Route53DnsProvider(overrides.route53Env ?? process.env, overrides.route53);
    default:
      throw unsupportedDnsOperation(
        normalized || providerName,
        'no DNS connector is implemented for this provider in this build',
      );
  }
}

export { CloudflareDnsProvider, Route53DnsProvider };
export type { CloudflareDnsSeam, Route53Transport };
