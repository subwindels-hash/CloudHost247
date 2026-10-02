import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import type {
  DnsZoneRow,
  DnsRecordRow,
  CreateDnsZoneInput,
  CreateDnsRecordInput,
  UpdateDnsRecordInput,
} from '../dns/types';

export async function listDnsZonesForUser(db: Queryable, userId: string): Promise<DnsZoneRow[]> {
  const { rows } = await db.query<DnsZoneRow>(
    `SELECT * FROM dns_zones WHERE user_id = $1 AND status != 'DELETED' ORDER BY domain_name ASC`,
    [userId]
  );
  return rows;
}

export async function findDnsZoneById(db: Queryable, id: string): Promise<DnsZoneRow | null> {
  const { rows } = await db.query<DnsZoneRow>(
    `SELECT * FROM dns_zones WHERE id = $1 AND status != 'DELETED'`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findDnsZoneByDomain(db: Queryable, domainName: string): Promise<DnsZoneRow | null> {
  const { rows } = await db.query<DnsZoneRow>(
    `SELECT * FROM dns_zones WHERE lower(domain_name) = lower($1) AND status != 'DELETED'`,
    [domainName]
  );
  return rows[0] ?? null;
}

export async function createDnsZone(db: Queryable, input: CreateDnsZoneInput): Promise<DnsZoneRow> {
  const id = randomUUID();
  const provider = input.provider ?? 'INTERNAL';
  const nameservers = input.nameservers ?? ['ns1.cloudhost247.com', 'ns2.cloudhost247.com'];
  const metadata = input.metadata ?? {};

  const { rows } = await db.query<DnsZoneRow>(
    `INSERT INTO dns_zones (id, user_id, domain_name, provider, status, nameservers, metadata)
     VALUES ($1, $2, lower($3), $4, 'ACTIVE', $5, $6)
     RETURNING *`,
    [id, input.userId, input.domainName, provider, nameservers, JSON.stringify(metadata)]
  );

  // Seed the zone's apex NS records from the nameservers actually in effect: the platform pair for
  // the internal engine, or the provider's delegation for an external connector (A11).
  for (const nameserver of nameservers) {
    await db.query(
      `INSERT INTO dns_records (id, zone_id, name, type, content, ttl) VALUES ($1, $2, '@', 'NS', $3, 86400)`,
      [randomUUID(), id, nameserver]
    );
  }

  return rows[0]!;
}

export async function deleteDnsZone(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE dns_zones SET status = 'DELETED', updated_at = now() WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

export async function listDnsRecordsForZone(db: Queryable, zoneId: string): Promise<DnsRecordRow[]> {
  const { rows } = await db.query<DnsRecordRow>(
    `SELECT * FROM dns_records WHERE zone_id = $1 ORDER BY type ASC, name ASC`,
    [zoneId]
  );
  return rows;
}

export async function findDnsRecordById(db: Queryable, id: string): Promise<DnsRecordRow | null> {
  const { rows } = await db.query<DnsRecordRow>(
    `SELECT * FROM dns_records WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function createDnsRecord(db: Queryable, input: CreateDnsRecordInput): Promise<DnsRecordRow> {
  const id = randomUUID();
  const ttl = input.ttl ?? 3600;
  const priority = input.priority ?? null;
  const proxied = input.proxied ?? false;
  const status = input.status ?? 'ACTIVE';

  const { rows } = await db.query<DnsRecordRow>(
    `INSERT INTO dns_records (id, zone_id, name, type, content, ttl, priority, proxied, status, provider_record_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [id, input.zoneId, input.name, input.type, input.content, ttl, priority, proxied, status, input.providerRecordId ?? null]
  );
  return rows[0]!;
}

export async function updateDnsRecord(
  db: Queryable,
  id: string,
  patch: UpdateDnsRecordInput
): Promise<DnsRecordRow | null> {
  const current = await findDnsRecordById(db, id);
  if (!current) return null;

  const { rows } = await db.query<DnsRecordRow>(
    `UPDATE dns_records
     SET name = $1, type = $2, content = $3, ttl = $4, priority = $5, proxied = $6, status = $7,
         provider_record_id = $8, updated_at = now()
     WHERE id = $9
     RETURNING *`,
    [
      patch.name ?? current.name,
      patch.type ?? current.type,
      patch.content ?? current.content,
      patch.ttl ?? current.ttl,
      patch.priority !== undefined ? patch.priority : current.priority,
      patch.proxied !== undefined ? patch.proxied : current.proxied,
      patch.status ?? current.status,
      patch.providerRecordId !== undefined ? patch.providerRecordId : current.provider_record_id,
      id,
    ]
  );
  return rows[0] ?? null;
}

export async function deleteDnsRecord(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM dns_records WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows.length > 0;
}
