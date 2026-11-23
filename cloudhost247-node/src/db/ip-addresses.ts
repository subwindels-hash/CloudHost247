/**
 * IP address inventory (E12 — E VPS).
 *
 * Tracks the platform's IP address pool. Each row is a single IPv4/IPv6 address
 * with a status (free / assigned / reserved) and an optional link to the server
 * and customer it is assigned to.
 *
 * This is an internal inventory only. No external provider is called to allocate
 * or release addresses — honest about the absence rather than fabricating
 * provider-backed IP provisioning.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export interface IpAddressRow {
  id: string;
  address: string;
  version: 'ipv4' | 'ipv6';
  status: 'free' | 'assigned' | 'reserved';
  server_id: string | null;
  customer_id: string | null;
  assigned_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListIpAddressesFilters {
  status?: 'free' | 'assigned' | 'reserved';
  version?: 'ipv4' | 'ipv6';
  server_id?: string;
  customer_id?: string;
}

export async function listIpAddresses(
  db: Queryable,
  filters: ListIpAddressesFilters = {},
): Promise<IpAddressRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.version) {
    params.push(filters.version);
    conditions.push(`version = $${params.length}`);
  }
  if (filters.server_id) {
    params.push(filters.server_id);
    conditions.push(`server_id = $${params.length}`);
  }
  if (filters.customer_id) {
    params.push(filters.customer_id);
    conditions.push(`customer_id = $${params.length}`);
  }

  const { rows } = await db.query<IpAddressRow>(
    `SELECT id, address, version, status, server_id, customer_id, assigned_at, created_at, updated_at
     FROM ip_addresses
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY address`,
    params,
  );
  return rows;
}

export async function getIpAddress(
  db: Queryable,
  id: string,
): Promise<IpAddressRow | null> {
  const { rows } = await db.query<IpAddressRow>(
    `SELECT id, address, version, status, server_id, customer_id, assigned_at, created_at, updated_at
     FROM ip_addresses
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getIpAddressByAddress(
  db: Queryable,
  address: string,
): Promise<IpAddressRow | null> {
  const { rows } = await db.query<IpAddressRow>(
    `SELECT id, address, version, status, server_id, customer_id, assigned_at, created_at, updated_at
     FROM ip_addresses
     WHERE address = $1`,
    [address],
  );
  return rows[0] ?? null;
}

export interface CreateIpAddressInput {
  address: string;
  version: 'ipv4' | 'ipv6';
  status?: 'free' | 'assigned' | 'reserved';
  customer_id?: string | null;
}

export async function createIpAddress(
  db: Queryable,
  input: CreateIpAddressInput,
): Promise<IpAddressRow> {
  const { rows } = await db.query<IpAddressRow>(
    `INSERT INTO ip_addresses (id, address, version, status, customer_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     RETURNING id, address, version, status, server_id, customer_id, assigned_at, created_at, updated_at`,
    [
      randomUUID(),
      input.address,
      input.version,
      input.status ?? 'free',
      input.customer_id ?? null,
    ],
  );
  return rows[0]!;
}

export interface AssignIpAddressInput {
  server_id: string;
  customer_id: string;
  status?: 'assigned' | 'reserved';
}

export async function assignIpAddress(
  db: Queryable,
  id: string,
  input: AssignIpAddressInput,
): Promise<IpAddressRow | null> {
  const { rows } = await db.query<IpAddressRow>(
    `UPDATE ip_addresses
     SET server_id = $1, customer_id = $2, status = $3, assigned_at = now(), updated_at = now()
     WHERE id = $4 AND status = 'free'
     RETURNING id, address, version, status, server_id, customer_id, assigned_at, created_at, updated_at`,
    [input.server_id, input.customer_id, input.status ?? 'assigned', id],
  );
  return rows[0] ?? null;
}

export async function releaseIpAddress(
  db: Queryable,
  id: string,
): Promise<IpAddressRow | null> {
  const { rows } = await db.query<IpAddressRow>(
    `UPDATE ip_addresses
     SET server_id = NULL, customer_id = NULL, status = 'free', assigned_at = NULL, updated_at = now()
     WHERE id = $1 AND status IN ('assigned', 'reserved')
     RETURNING id, address, version, status, server_id, customer_id, assigned_at, created_at, updated_at`,
    [id],
  );
  return rows[0] ?? null;
}
