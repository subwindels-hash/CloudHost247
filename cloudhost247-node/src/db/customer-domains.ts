import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

/**
 * A customer_domains row (database/migrations/0009_create_customer_domains.sql, extended by
 * 0034 for Phase 6). Phases 1–5 kept this purely informational and staff-entered; Phase 6 adds
 * customer-initiated domain management: a customer can add a domain, prove control via a DNS TXT
 * token, and attach it to a marketplace installation (application_domains).
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
  // --- Phase 6 (migration 0034) ---
  domain_type: string;
  provider: string | null;
  verification_status: string;
  verification_method: string | null;
  verification_token: string | null;
  verified_at: string | null;
  ssl_status: string;
  ssl_issued_at: string | null;
  ssl_expires_at: string | null;
  created_by_user: boolean;
  points_to: string | null;
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
  /** Phase 6: customer-added domains record who created them and why. */
  createdByUser?: boolean;
  domainType?: string;
  provider?: string | null;
  verificationToken?: string | null;
}

export async function createCustomerDomain(pool: Queryable, input: CreateCustomerDomainInput): Promise<CustomerDomainRow> {
  const { rows } = await pool.query<CustomerDomainRow>(
    `INSERT INTO customer_domains (
       id, user_id, domain_name, registrar, status, expires_at, external_reference, notes, created_by,
       created_by_user, domain_type, provider, verification_token
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
      input.createdByUser ?? false,
      input.domainType ?? 'custom',
      input.provider ?? null,
      input.verificationToken ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create customer domain record');
  return row;
}

// --- Phase 6: verification, SSL, and installation attachment (spec §15, §34) ---------------------

export async function setDomainVerification(
  pool: Queryable,
  id: string,
  status: 'unverified' | 'pending' | 'verified' | 'failed',
  verifiedAt?: string | null
): Promise<CustomerDomainRow | null> {
  const { rows } = await pool.query<CustomerDomainRow>(
    `UPDATE customer_domains
     SET verification_status = $2, verified_at = $3, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, status === 'verified' ? (verifiedAt ?? new Date().toISOString()) : null]
  );
  return rows[0] ?? null;
}

export async function setDomainSslStatus(
  pool: Queryable,
  id: string,
  status: 'none' | 'pending' | 'issued' | 'renewing' | 'failed' | 'expired',
  issuedAt?: string | null,
  expiresAt?: string | null
): Promise<CustomerDomainRow | null> {
  const { rows } = await pool.query<CustomerDomainRow>(
    `UPDATE customer_domains
     SET ssl_status = $2,
         ssl_issued_at = CASE WHEN $2 IN ('issued') THEN COALESCE($3, now()) ELSE ssl_issued_at END,
         ssl_expires_at = CASE WHEN $2 IN ('issued', 'renewing') THEN $4 ELSE ssl_expires_at END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, issuedAt ?? null, expiresAt ?? null]
  );
  return rows[0] ?? null;
}

export async function findDomainByNameForUser(
  pool: Queryable,
  userId: string,
  domainName: string
): Promise<CustomerDomainRow | null> {
  const { rows } = await pool.query<CustomerDomainRow>(
    `SELECT * FROM customer_domains WHERE user_id = $1 AND lower(domain_name) = lower($2) LIMIT 1`,
    [userId, domainName]
  );
  return rows[0] ?? null;
}

export interface ApplicationDomainRow {
  id: string;
  installation_id: string;
  domain_id: string;
  primary_domain: boolean;
  created_at: string;
}

export async function attachDomainToInstallation(
  pool: Queryable,
  installationId: string,
  domainId: string,
  primary: boolean
): Promise<ApplicationDomainRow> {
  const { rows } = await pool.query<ApplicationDomainRow>(
    `INSERT INTO application_domains (id, installation_id, domain_id, primary_domain)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [randomUUID(), installationId, domainId, primary]
  );
  // ON CONFLICT DO NOTHING has no single natural key (one-primary is deferrable), so re-read.
  if (rows[0]) return rows[0];
  const existing = await pool.query<ApplicationDomainRow>(
    `SELECT * FROM application_domains WHERE installation_id = $1 AND domain_id = $2 LIMIT 1`,
    [installationId, domainId]
  );
  const row = existing.rows[0];
  if (!row) throw new Error('attachDomainToInstallation: attach returned no row');
  return row;
}

export async function listDomainsForInstallation(
  pool: Queryable,
  installationId: string
): Promise<Array<ApplicationDomainRow & { domain_name: string; verification_status: string; ssl_status: string }>> {
  const { rows } = await pool.query<
    ApplicationDomainRow & { domain_name: string; verification_status: string; ssl_status: string }
  >(
    `SELECT ad.*, cd.domain_name, cd.verification_status, cd.ssl_status
     FROM application_domains ad
     JOIN customer_domains cd ON cd.id = ad.domain_id
     WHERE ad.installation_id = $1
     ORDER BY ad.primary_domain DESC, cd.domain_name ASC`,
    [installationId]
  );
  return rows;
}

export async function detachDomainFromInstallation(pool: Queryable, installationId: string, domainId: string): Promise<void> {
  await pool.query(
    `DELETE FROM application_domains WHERE installation_id = $1 AND domain_id = $2`,
    [installationId, domainId]
  );
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
