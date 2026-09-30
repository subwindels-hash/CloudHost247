/**
 * DNS record operations (spec §12–§15). Records are always addressed by Cloudflare's record id,
 * never by name/type alone.
 */
import type { CloudflareClient } from './client';
import type { CfDnsRecord } from './types';

export const SUPPORTED_DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'] as const;

export interface DnsRecordInput {
  type: string;
  name: string;
  content: string;
  ttl?: number; // 1 = automatic
  proxied?: boolean;
  priority?: number;
  comment?: string | null;
}

export async function listDnsRecords(client: CloudflareClient, zoneId: string): Promise<CfDnsRecord[]> {
  const records: CfDnsRecord[] = [];
  let page = 1;
  for (;;) {
    const { result, resultInfo } = await client.request<CfDnsRecord[]>(
      'dns.list',
      'GET',
      `/zones/${encodeURIComponent(zoneId)}/dns_records`,
      undefined,
      { page, per_page: 100 }
    );
    records.push(...(result ?? []));
    const total = resultInfo?.total_count ?? records.length;
    if (records.length >= total || (result ?? []).length === 0) break;
    page += 1;
    if (page > 50) break; // hard stop — never loop unbounded against the provider
  }
  return records;
}

export async function createDnsRecord(client: CloudflareClient, zoneId: string, input: DnsRecordInput): Promise<CfDnsRecord> {
  const { result } = await client.request<CfDnsRecord>('dns.create', 'POST', `/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    type: input.type,
    name: input.name,
    content: input.content,
    ttl: input.ttl ?? 1,
    proxied: input.proxied,
    priority: input.priority,
    comment: input.comment ?? undefined,
  });
  return result;
}

export async function updateDnsRecord(
  client: CloudflareClient,
  zoneId: string,
  recordId: string,
  input: Partial<DnsRecordInput>
): Promise<CfDnsRecord> {
  const { result } = await client.request<CfDnsRecord>(
    'dns.update',
    'PATCH',
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
    {
      type: input.type,
      name: input.name,
      content: input.content,
      ttl: input.ttl,
      proxied: input.proxied,
      priority: input.priority,
      comment: input.comment,
    }
  );
  return result;
}

export async function deleteDnsRecord(client: CloudflareClient, zoneId: string, recordId: string): Promise<void> {
  await client.request<{ id: string }>(
    'dns.delete',
    'DELETE',
    `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`
  );
}

/** Exact-match lookup used by idempotent system provisioning (spec §42). */
export async function findDnsRecord(
  client: CloudflareClient,
  zoneId: string,
  type: string,
  name: string
): Promise<CfDnsRecord | null> {
  const { result } = await client.request<CfDnsRecord[]>(
    'dns.find',
    'GET',
    `/zones/${encodeURIComponent(zoneId)}/dns_records`,
    undefined,
    { type, name, per_page: 5 }
  );
  return (result ?? [])[0] ?? null;
}
