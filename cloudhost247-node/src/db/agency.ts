/**
 * Agency / reseller hosting (W10, J Agency core).
 *
 * Backend surface for agency hosting pages. Agencies are reseller accounts that can manage
 * multiple client accounts under one umbrella. Reseller packages are catalogue descriptions
 * only — display-only pricing under the D2 financial freeze; no order or payment flow is
 * activated here.
 */
import type { Queryable } from './types';
import { randomUUID } from 'node:crypto';

export type AgencyStatus = 'active' | 'suspended' | 'disabled';
export type AgencyClientRole = 'owner' | 'client' | 'billing';
export type ResellerPackageStatus = 'active' | 'disabled' | 'archived';

export interface AgencyRow {
  id: string;
  name: string;
  slug: string;
  contact_email: string;
  status: AgencyStatus;
  created_at: Date;
  updated_at: Date;
}

export interface AgencyClientRow {
  id: string;
  agency_id: string;
  user_id: string;
  role: AgencyClientRole;
  created_at: Date;
}

export interface ResellerPackageRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  currency: string;
  status: ResellerPackageStatus;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAgencyInput {
  name: string;
  slug: string;
  contact_email: string;
  status?: AgencyStatus;
}

export interface ListAgenciesFilter {
  status?: AgencyStatus;
  limit?: number;
  offset?: number;
}

export interface UpdateAgencyInput {
  name?: string;
  contact_email?: string;
  status?: AgencyStatus;
}

export interface AddAgencyClientInput {
  agency_id: string;
  user_id: string;
  role?: AgencyClientRole;
}

export interface CreateResellerPackageInput {
  name: string;
  slug: string;
  description?: string | null;
  price_cents?: number;
  currency?: string;
  status?: ResellerPackageStatus;
}

export async function createAgency(db: Queryable, input: CreateAgencyInput): Promise<AgencyRow> {
  const id = randomUUID();
  const { rows } = await db.query<AgencyRow>(
    `INSERT INTO agencies
       (id, name, slug, contact_email, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, slug, contact_email, status, created_at, updated_at`,
    [
      id,
      input.name,
      input.slug,
      input.contact_email,
      input.status ?? 'active',
    ]
  );
  const agency = rows[0];
  if (!agency) throw new Error('Failed to create agency');
  return agency;
}

export async function listAgencies(
  db: Queryable,
  filter: ListAgenciesFilter = {}
): Promise<AgencyRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 100);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);

  const { rows } = await db.query<AgencyRow>(
    `SELECT id, name, slug, contact_email, status, created_at, updated_at
     FROM agencies
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return rows;
}

export async function countAgencies(
  db: Queryable,
  filter: ListAgenciesFilter = {}
): Promise<number> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM agencies ${where}`,
    params
  );
  return Number(rows[0]?.count ?? '0');
}

export async function findAgencyById(db: Queryable, id: string): Promise<AgencyRow | null> {
  const { rows } = await db.query<AgencyRow>(
    `SELECT id, name, slug, contact_email, status, created_at, updated_at
     FROM agencies
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findAgencyBySlug(db: Queryable, slug: string): Promise<AgencyRow | null> {
  const { rows } = await db.query<AgencyRow>(
    `SELECT id, name, slug, contact_email, status, created_at, updated_at
     FROM agencies
     WHERE slug = $1`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function updateAgency(
  db: Queryable,
  id: string,
  input: UpdateAgencyInput,
): Promise<AgencyRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    params.push(input.name);
    sets.push(`name = $${params.length}`);
  }
  if (input.contact_email !== undefined) {
    params.push(input.contact_email);
    sets.push(`contact_email = $${params.length}`);
  }
  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }

  if (sets.length === 0) return findAgencyById(db, id);

  sets.push(`updated_at = now()`);

  const { rows } = await db.query<AgencyRow>(
    `UPDATE agencies
     SET ${sets.join(', ')}
     WHERE id = $${params.length + 1}
     RETURNING id, name, slug, contact_email, status, created_at, updated_at`,
    [...params, id]
  );
  return rows[0] ?? null;
}

export async function deleteAgency(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM agencies WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function addAgencyClient(
  db: Queryable,
  input: AddAgencyClientInput,
): Promise<AgencyClientRow> {
  const id = randomUUID();
  const { rows } = await db.query<AgencyClientRow>(
    `INSERT INTO agency_clients
       (id, agency_id, user_id, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, agency_id, user_id, role, created_at`,
    [id, input.agency_id, input.user_id, input.role ?? 'client']
  );
  const client = rows[0];
  if (!client) throw new Error('Failed to add agency client');
  return client;
}

export async function listAgencyClients(
  db: Queryable,
  agencyId: string,
): Promise<AgencyClientRow[]> {
  const { rows } = await db.query<AgencyClientRow>(
    `SELECT id, agency_id, user_id, role, created_at
     FROM agency_clients
     WHERE agency_id = $1
     ORDER BY created_at DESC`,
    [agencyId]
  );
  return rows;
}

export async function removeAgencyClient(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM agency_clients WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function createResellerPackage(
  db: Queryable,
  input: CreateResellerPackageInput,
): Promise<ResellerPackageRow> {
  const id = randomUUID();
  const { rows } = await db.query<ResellerPackageRow>(
    `INSERT INTO reseller_packages
       (id, name, slug, description, price_cents, currency, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, slug, description, price_cents, currency, status, created_at, updated_at`,
    [
      id,
      input.name,
      input.slug,
      input.description ?? null,
      input.price_cents ?? 0,
      input.currency ?? 'USD',
      input.status ?? 'active',
    ]
  );
  const pkg = rows[0];
  if (!pkg) throw new Error('Failed to create reseller package');
  return pkg;
}

export async function listResellerPackages(
  db: Queryable,
  filter: { status?: ResellerPackageStatus; limit?: number; offset?: number } = {}
): Promise<ResellerPackageRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 100);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);

  const { rows } = await db.query<ResellerPackageRow>(
    `SELECT id, name, slug, description, price_cents, currency, status, created_at, updated_at
     FROM reseller_packages
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return rows;
}

export async function findResellerPackageById(
  db: Queryable,
  id: string,
): Promise<ResellerPackageRow | null> {
  const { rows } = await db.query<ResellerPackageRow>(
    `SELECT id, name, slug, description, price_cents, currency, status, created_at, updated_at
     FROM reseller_packages
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findResellerPackageBySlug(
  db: Queryable,
  slug: string,
): Promise<ResellerPackageRow | null> {
  const { rows } = await db.query<ResellerPackageRow>(
    `SELECT id, name, slug, description, price_cents, currency, status, created_at, updated_at
     FROM reseller_packages
     WHERE slug = $1`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function updateResellerPackage(
  db: Queryable,
  id: string,
  input: Partial<CreateResellerPackageInput>,
): Promise<ResellerPackageRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    params.push(input.name);
    sets.push(`name = $${params.length}`);
  }
  if (input.slug !== undefined) {
    params.push(input.slug);
    sets.push(`slug = $${params.length}`);
  }
  if (input.description !== undefined) {
    params.push(input.description);
    sets.push(`description = $${params.length}`);
  }
  if (input.price_cents !== undefined) {
    params.push(input.price_cents);
    sets.push(`price_cents = $${params.length}`);
  }
  if (input.currency !== undefined) {
    params.push(input.currency);
    sets.push(`currency = $${params.length}`);
  }
  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }

  if (sets.length === 0) return findResellerPackageById(db, id);

  sets.push(`updated_at = now()`);

  const { rows } = await db.query<ResellerPackageRow>(
    `UPDATE reseller_packages
     SET ${sets.join(', ')}
     WHERE id = $${params.length + 1}
     RETURNING id, name, slug, description, price_cents, currency, status, created_at, updated_at`,
    [...params, id]
  );
  return rows[0] ?? null;
}

export async function deleteResellerPackage(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM reseller_packages WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}