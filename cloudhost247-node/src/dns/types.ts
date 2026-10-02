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
  /** The external provider's identifier for this record; null on the internal engine. */
  provider_record_id: string | null;
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
  /** The external provider's identifier for this record; null for the internal engine. */
  providerRecordId?: string | null;
}

export interface UpdateDnsRecordInput {
  name?: string;
  type?: DnsRecordType;
  content?: string;
  ttl?: number;
  priority?: number | null;
  proxied?: boolean;
  status?: DnsRecordStatus;
  /** Set when the connector's identifier for the record changes (for example after a re-resolve). */
  providerRecordId?: string | null;
}

export interface DnsProvider {
  readonly name: string;
  createZone(domainName: string): Promise<{ zoneId: string; nameservers: string[] }>;
  deleteZone(zoneId: string): Promise<void>;
  createRecord(zoneId: string, record: CreateDnsRecordInput): Promise<{ recordId: string }>;
  updateRecord(zoneId: string, recordId: string, record: UpdateDnsRecordInput): Promise<void>;
  deleteRecord(zoneId: string, recordId: string): Promise<void>;
  /**
   * The provider's own identifier for a (name, type) pair, used only as a fallback for rows that
   * were created before the connector was wired. Returns null when no such record exists, and
   * refuses when the pair is ambiguous rather than guessing (see the connector implementations).
   */
  resolveRecordId?(zoneId: string, name: string, type: DnsRecordType): Promise<string | null>;
}
