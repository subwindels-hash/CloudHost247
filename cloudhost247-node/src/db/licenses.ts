/**
 * Licenses Database Repository (Section 22).
 *
 * Manages commercial and open-source control panel licenses, activation tokens,
 * provider tracking, and expiration lifecycles.
 */
import type { Queryable } from './types';

export interface LicenseRow {
  id: string;
  customer_id: string;
  service_id: string | null;
  control_panel_id: string;
  license_key: string;
  license_type: string;
  provider: string;
  status: 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED' | 'TERMINATED';
  activated_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  panel_name?: string;
  panel_slug?: string;
  customer_email?: string;
  customer_name?: string;
}

const SELECT_LICENSE_WITH_JOINS = `
  SELECT
    l.*,
    cp.name AS panel_name,
    cp.slug AS panel_slug,
    u.email AS customer_email,
    u.full_name AS customer_name
  FROM licenses l
  LEFT JOIN control_panels cp ON cp.id = l.control_panel_id
  LEFT JOIN users u ON u.id = l.customer_id
`;

export async function listLicensesForUser(pool: Queryable, customerId: string): Promise<LicenseRow[]> {
  const { rows } = await pool.query<LicenseRow>(
    `${SELECT_LICENSE_WITH_JOINS} WHERE l.customer_id = $1 ORDER BY l.created_at DESC`,
    [customerId]
  );
  return rows;
}

export async function listAllLicenses(
  pool: Queryable,
  filters?: { status?: string; controlPanelId?: string; search?: string }
): Promise<LicenseRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    params.push(filters.status.toUpperCase());
    clauses.push(`l.status = $${params.length}`);
  }

  if (filters?.controlPanelId) {
    params.push(filters.controlPanelId);
    clauses.push(`l.control_panel_id = $${params.length}`);
  }

  if (filters?.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    clauses.push(`(lower(cp.name) LIKE $${params.length} OR lower(u.email) LIKE $${params.length} OR lower(l.license_type) LIKE $${params.length})`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query<LicenseRow>(
    `${SELECT_LICENSE_WITH_JOINS} ${where} ORDER BY l.created_at DESC`,
    params
  );
  return rows;
}

export async function findLicenseById(pool: Queryable, id: string): Promise<LicenseRow | null> {
  const { rows } = await pool.query<LicenseRow>(
    `${SELECT_LICENSE_WITH_JOINS} WHERE l.id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export interface CreateLicenseInput {
  customerId: string;
  serviceId?: string | null;
  controlPanelId: string;
  licenseKey: string;
  licenseType?: string;
  provider?: string;
  status?: LicenseRow['status'];
  activatedAt?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createLicense(pool: Queryable, input: CreateLicenseInput): Promise<LicenseRow> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO licenses (
       customer_id, service_id, control_panel_id, license_key, license_type,
       provider, status, activated_at, expires_at, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.customerId,
      input.serviceId ?? null,
      input.controlPanelId,
      input.licenseKey,
      input.licenseType ?? 'STANDARD',
      input.provider ?? 'INTERNAL',
      input.status ?? 'ACTIVE',
      input.activatedAt ?? new Date().toISOString(),
      input.expiresAt ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to create license record');
  const created = await findLicenseById(pool, id);
  if (!created) throw new Error('Failed to load newly created license record');
  return created;
}

export interface UpdateLicenseInput {
  status?: LicenseRow['status'];
  licenseKey?: string;
  expiresAt?: string | null;
  activatedAt?: string | null;
  serviceId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function updateLicense(
  pool: Queryable,
  id: string,
  patch: UpdateLicenseInput
): Promise<LicenseRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  function set(column: string, value: unknown) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (patch.status !== undefined) set('status', patch.status);
  if (patch.licenseKey !== undefined) set('license_key', patch.licenseKey);
  if (patch.expiresAt !== undefined) set('expires_at', patch.expiresAt);
  if (patch.activatedAt !== undefined) set('activated_at', patch.activatedAt);
  if (patch.serviceId !== undefined) set('service_id', patch.serviceId);
  if (patch.metadata !== undefined) set('metadata', JSON.stringify(patch.metadata));

  if (sets.length === 0) {
    return findLicenseById(pool, id);
  }

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE licenses SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
    params
  );
  if (!rows[0]) return null;
  return findLicenseById(pool, id);
}

export async function activateLicense(pool: Queryable, id: string): Promise<LicenseRow | null> {
  return updateLicense(pool, id, {
    status: 'ACTIVE',
    activatedAt: new Date().toISOString(),
  });
}

export async function renewLicense(pool: Queryable, id: string, newExpiry: string): Promise<LicenseRow | null> {
  return updateLicense(pool, id, {
    status: 'ACTIVE',
    expiresAt: newExpiry,
  });
}

export async function cancelLicense(pool: Queryable, id: string): Promise<LicenseRow | null> {
  return updateLicense(pool, id, {
    status: 'CANCELLED',
  });
}
