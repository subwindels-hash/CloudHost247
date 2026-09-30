/**
 * DNS Management & Provider Types.
 */

export type DnsRecordType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'TXT'
  | 'MX'
  | 'NS'
  | 'SRV'
  | 'CAA'
  | 'PTR'
  | 'SOA';

export type DnsZoneStatus = 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'DELETED';
export type DnsRecordStatus = 'ACTIVE' | 'DISABLED';

export interface DnsZoneRow {
  id: string;
  user_id: string;
  domain_name: string;
  provider: string;
  status: DnsZoneStatus;
  nameservers: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DnsRecordRow {
  id: string;
  zone_id: string;
  name: string;
  type: DnsRecordType;
  content: string;
  ttl: number;
  priority: number | null;
  proxied: boolean;
  status: DnsRecordStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateDnsZoneInput {
  userId: string;
  domainName: string;
  provider?: string;
  nameservers?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateDnsRecordInput {
  zoneId: string;
  name: string;
  type: DnsRecordType;
  content: string;
  ttl?: number;
  priority?: number | null;
  proxied?: boolean;
  status?: DnsRecordStatus;
}

export interface UpdateDnsRecordInput {
  name?: string;
  type?: DnsRecordType;
  content?: string;
  ttl?: number;
  priority?: number | null;
  proxied?: boolean;
  status?: DnsRecordStatus;
}

export interface DnsProvider {
  readonly name: string;
  createZone(domainName: string): Promise<{ zoneId: string; nameservers: string[] }>;
  deleteZone(zoneId: string): Promise<void>;
  createRecord(zoneId: string, record: CreateDnsRecordInput): Promise<{ recordId: string }>;
  updateRecord(zoneId: string, recordId: string, record: UpdateDnsRecordInput): Promise<void>;
  deleteRecord(zoneId: string, recordId: string): Promise<void>;
}
