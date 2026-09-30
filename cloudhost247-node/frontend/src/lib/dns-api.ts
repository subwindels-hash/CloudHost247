import { apiFetch } from './api';

export type DnsRecordType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'TXT'
  | 'MX'
  | 'NS'
  | 'SRV'
  | 'CAA'
  | 'PTR';

export interface DnsZone {
  id: string;
  domain_name: string;
  provider: string;
  status: string;
  nameservers: string[];
  created_at: string;
}

export interface DnsRecord {
  id: string;
  zone_id: string;
  name: string;
  type: DnsRecordType;
  content: string;
  ttl: number;
  priority: number | null;
  proxied: boolean;
  status: string;
  created_at: string;
}

export function fetchDnsZones() {
  return apiFetch<{ zones: DnsZone[] }>('/api/v1/dns/zones');
}

export function fetchDnsZone(id: string) {
  return apiFetch<{ zone: DnsZone; records: DnsRecord[] }>(`/api/v1/dns/zones/${id}`);
}

export function createDnsZone(domainName: string, provider: string = 'INTERNAL') {
  return apiFetch<{ zone: DnsZone }>('/api/v1/dns/zones', {
    method: 'POST',
    body: JSON.stringify({ domainName, provider }),
  });
}

export function deleteDnsZone(id: string) {
  return apiFetch<void>(`/api/v1/dns/zones/${id}`, {
    method: 'DELETE',
  });
}

export function createDnsRecord(zoneId: string, record: {
  name: string;
  type: DnsRecordType;
  content: string;
  ttl?: number;
  priority?: number | null;
}) {
  return apiFetch<{ record: DnsRecord }>(`/api/v1/dns/zones/${zoneId}/records`, {
    method: 'POST',
    body: JSON.stringify(record),
  });
}

export function deleteDnsRecord(zoneId: string, recordId: string) {
  return apiFetch<void>(`/api/v1/dns/zones/${zoneId}/records/${recordId}`, {
    method: 'DELETE',
  });
}
