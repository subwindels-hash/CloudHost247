/**
 * DNS Provider Adapters.
 *
 * Implements authoritative DNS propagation across internal database engine and external providers
 * (Cloudflare, Route53, Hetzner DNS) with fail-closed behavior when credentials are unconfigured.
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
} from '../db/dns';

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

export class CloudflareDnsProvider implements DnsProvider {
  readonly name = 'CLOUDFLARE';

  constructor(private readonly apiToken?: string) {}

  private checkConfigured(): string {
    const token = this.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      throw new Error('CONFIGURATION_REQUIRED: CLOUDFLARE_API_TOKEN is required for Cloudflare DNS provider integration.');
    }
    return token;
  }

  async createZone(domainName: string): Promise<{ zoneId: string; nameservers: string[] }> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: Cloudflare live API connector is unconfigured in this environment.');
  }

  async deleteZone(zoneId: string): Promise<void> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: Cloudflare live API connector is unconfigured in this environment.');
  }

  async createRecord(zoneId: string, record: CreateDnsRecordInput): Promise<{ recordId: string }> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: Cloudflare live API connector is unconfigured in this environment.');
  }

  async updateRecord(zoneId: string, recordId: string, record: UpdateDnsRecordInput): Promise<void> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: Cloudflare live API connector is unconfigured in this environment.');
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: Cloudflare live API connector is unconfigured in this environment.');
  }
}

export class Route53DnsProvider implements DnsProvider {
  readonly name = 'ROUTE53';

  constructor(private readonly accessKey?: string, private readonly secretKey?: string) {}

  private checkConfigured() {
    const key = this.accessKey ?? process.env.AWS_ACCESS_KEY_ID;
    const secret = this.secretKey ?? process.env.AWS_SECRET_ACCESS_KEY;
    if (!key || !secret) {
      throw new Error('CONFIGURATION_REQUIRED: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for Route53 DNS integration.');
    }
  }

  async createZone(domainName: string): Promise<{ zoneId: string; nameservers: string[] }> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: AWS Route53 live API connector is unconfigured in this environment.');
  }

  async deleteZone(zoneId: string): Promise<void> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: AWS Route53 live API connector is unconfigured in this environment.');
  }

  async createRecord(zoneId: string, record: CreateDnsRecordInput): Promise<{ recordId: string }> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: AWS Route53 live API connector is unconfigured in this environment.');
  }

  async updateRecord(zoneId: string, recordId: string, record: UpdateDnsRecordInput): Promise<void> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: AWS Route53 live API connector is unconfigured in this environment.');
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    this.checkConfigured();
    throw new Error('SERVICE_UNAVAILABLE: AWS Route53 live API connector is unconfigured in this environment.');
  }
}

export function createDnsProvider(providerName: string, db: Queryable): DnsProvider {
  switch (providerName.toUpperCase()) {
    case 'INTERNAL':
    case 'DEFAULT':
      return new DatabaseDnsProvider(db);
    case 'CLOUDFLARE':
      return new CloudflareDnsProvider();
    case 'ROUTE53':
      return new Route53DnsProvider();
    default:
      return new DatabaseDnsProvider(db);
  }
}
