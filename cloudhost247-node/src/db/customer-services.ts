import type { Queryable } from './types';

/**
 * A customer_services row, left-joined with its optional Phase 3 catalog product/plan so callers
 * can resolve a human-readable slug/name without ever exposing the raw product_id/plan_id uuid to
 * a customer-facing response (see src/dto/account.ts).
 *
 * This table (database/migrations/0008_create_customer_services.sql) is a purely informational,
 * staff-entered record. Nothing in this module ever calls an external API, provisions anything,
 * or verifies anything technical — it is plain CRUD against Postgres, same as every other
 * repository module in this codebase.
 */
export interface CustomerServiceRow {
  id: string;
  user_id: string;
  product_id: string | null;
  plan_id: string | null;
  label: string;
  status: string;
  external_reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  product_slug: string | null;
  product_name: string | null;
  plan_slug: string | null;
  plan_name: string | null;
}

export type CustomerServiceStatus = 'active' | 'suspended' | 'cancelled' | 'pending_migration';

const SELECT_WITH_CATALOG = `
  SELECT
    cs.*,
    p.slug AS product_slug,
    p.name AS product_name,
    pl.slug AS plan_slug,
    pl.name AS plan_name
  FROM customer_services cs
  LEFT JOIN products p ON p.id = cs.product_id
  LEFT JOIN product_plans pl ON pl.id = cs.plan_id
`;

export async function listServicesForUser(pool: Queryable, userId: string): Promise<CustomerServiceRow[]> {
  const { rows } = await pool.query<CustomerServiceRow>(
    `${SELECT_WITH_CATALOG} WHERE cs.user_id = $1 ORDER BY cs.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function findServiceById(pool: Queryable, id: string): Promise<CustomerServiceRow | null> {
  const { rows } = await pool.query<CustomerServiceRow>(`${SELECT_WITH_CATALOG} WHERE cs.id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export interface CreateCustomerServiceInput {
  id: string;
  userId: string;
  productId?: string | null;
  planId?: string | null;
  label: string;
  status?: CustomerServiceStatus;
  externalReference?: string | null;
  notes?: string | null;
  createdBy: string;
}

export async function createCustomerService(pool: Queryable, input: CreateCustomerServiceInput): Promise<CustomerServiceRow> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO customer_services (id, user_id, product_id, plan_id, label, status, external_reference, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.id,
      input.userId,
      input.productId ?? null,
      input.planId ?? null,
      input.label,
      input.status ?? 'active',
      input.externalReference ?? null,
      input.notes ?? null,
      input.createdBy,
    ]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to create customer service record');
  const created = await findServiceById(pool, id);
  if (!created) throw new Error('Failed to load newly created customer service record');
  return created;
}

export interface UpdateCustomerServiceInput {
  label?: string;
  status?: CustomerServiceStatus;
  externalReference?: string | null;
  notes?: string | null;
  productId?: string | null;
  planId?: string | null;
}

export async function updateCustomerService(
  pool: Queryable,
  id: string,
  patch: UpdateCustomerServiceInput
): Promise<CustomerServiceRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  function set(column: string, value: unknown) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (patch.label !== undefined) set('label', patch.label);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.externalReference !== undefined) set('external_reference', patch.externalReference);
  if (patch.notes !== undefined) set('notes', patch.notes);
  if (patch.productId !== undefined) set('product_id', patch.productId);
  if (patch.planId !== undefined) set('plan_id', patch.planId);

  if (sets.length === 0) {
    return findServiceById(pool, id);
  }

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE customer_services SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
    params
  );
  if (!rows[0]) return null;
  return findServiceById(pool, id);
}
