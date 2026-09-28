import type { Queryable } from './types';
import type { CatalogStatus } from './catalog-products';

export interface PlanRow {
  id: string;
  product_id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  billing_model: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export type BillingModel = 'one_time' | 'recurring';

export async function listActivePlansForProduct(pool: Queryable, productId: string): Promise<PlanRow[]> {
  const { rows } = await pool.query<PlanRow>(
    `SELECT * FROM product_plans WHERE product_id = $1 AND status = 'active' ORDER BY display_order ASC, name ASC`,
    [productId]
  );
  return rows;
}

export async function listAllPlansForProduct(pool: Queryable, productId: string): Promise<PlanRow[]> {
  const { rows } = await pool.query<PlanRow>(
    'SELECT * FROM product_plans WHERE product_id = $1 ORDER BY display_order ASC, name ASC',
    [productId]
  );
  return rows;
}

export async function findPlanById(pool: Queryable, id: string): Promise<PlanRow | null> {
  const { rows } = await pool.query<PlanRow>('SELECT * FROM product_plans WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export interface CreatePlanInput {
  id: string;
  productId: string;
  slug: string;
  name: string;
  description?: string | null;
  status?: CatalogStatus;
  billingModel?: BillingModel;
  displayOrder?: number;
}

export async function createPlan(pool: Queryable, input: CreatePlanInput): Promise<PlanRow> {
  const { rows } = await pool.query<PlanRow>(
    `INSERT INTO product_plans (id, product_id, slug, name, description, status, billing_model, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.id,
      input.productId,
      input.slug,
      input.name,
      input.description ?? null,
      input.status ?? 'draft',
      input.billingModel ?? 'recurring',
      input.displayOrder ?? 0,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create plan');
  return row;
}

export interface UpdatePlanInput {
  name?: string;
  description?: string | null;
  billingModel?: BillingModel;
  displayOrder?: number;
}

export async function updatePlan(pool: Queryable, id: string, patch: UpdatePlanInput): Promise<PlanRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description);
    sets.push(`description = $${params.length}`);
  }
  if (patch.billingModel !== undefined) {
    params.push(patch.billingModel);
    sets.push(`billing_model = $${params.length}`);
  }
  if (patch.displayOrder !== undefined) {
    params.push(patch.displayOrder);
    sets.push(`display_order = $${params.length}`);
  }

  if (sets.length === 0) {
    return findPlanById(pool, id);
  }

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await pool.query<PlanRow>(
    `UPDATE product_plans SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

export async function setPlanStatus(pool: Queryable, id: string, status: CatalogStatus): Promise<PlanRow | null> {
  const { rows } = await pool.query<PlanRow>(
    `UPDATE product_plans SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] ?? null;
}
