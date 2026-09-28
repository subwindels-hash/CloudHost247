import type { Queryable } from './types';

/**
 * A customer_domains row (database/migrations/0009_create_customer_domains.sql) — purely
 * informational, staff-entered. See src/db/customer-services.ts for the shared design rationale;
 * this module never calls a registrar API and never performs a live availability check.
 */
export interface CustomerDomainRow {
  id: string;
  user_id: string;
  domain_name: string;
  registrar: string | null;
  status: string;
  expires_at: string | null;
  external_reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CustomerDomainStatus = 'active' | 'expired' | 'pending_transfer' | 'pending_migration';

export async function listDomainsForUser(pool: Queryable, userId: string): Promise<CustomerDomainRow[]> {
  const { rows } = await pool.query<CustomerDomainRow>(
    'SELECT * FROM customer_domains WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

export async function findDomainById(pool: Queryable, id: string): Promise<CustomerDomainRow | null> {
  const { rows } = await pool.query<CustomerDomainRow>('SELECT * FROM customer_domains WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export interface CreateCustomerDomainInput {
  id: string;
  userId: string;
  domainName: string;
  registrar?: string | null;
  status?: CustomerDomainStatus;
  expiresAt?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  createdBy: string;
}

export async function createCustomerDomain(pool: Queryable, input: CreateCustomerDomainInput): Promise<CustomerDomainRow> {
  const { rows } = await pool.query<CustomerDomainRow>(
    `INSERT INTO customer_domains (id, user_id, domain_name, registrar, status, expires_at, external_reference, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.id,
      input.userId,
      input.domainName,
      input.registrar ?? null,
      input.status ?? 'active',
      input.expiresAt ?? null,
      input.externalReference ?? null,
      input.notes ?? null,
      input.createdBy,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create customer domain record');
  return row;
}

export interface UpdateCustomerDomainInput {
  domainName?: string;
  registrar?: string | null;
  status?: CustomerDomainStatus;
  expiresAt?: string | null;
  externalReference?: string | null;
  notes?: string | null;
}

export async function updateCustomerDomain(
  pool: Queryable,
  id: string,
  patch: UpdateCustomerDomainInput
): Promise<CustomerDomainRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  function set(column: string, value: unknown) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (patch.domainName !== undefined) set('domain_name', patch.domainName);
  if (patch.registrar !== undefined) set('registrar', patch.registrar);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.expiresAt !== undefined) set('expires_at', patch.expiresAt);
  if (patch.externalReference !== undefined) set('external_reference', patch.externalReference);
  if (patch.notes !== undefined) set('notes', patch.notes);

  if (sets.length === 0) {
    return findDomainById(pool, id);
  }

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await pool.query<CustomerDomainRow>(
    `UPDATE customer_domains SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] ?? null;
}
