import type { Queryable } from './types';

export interface PricingRow {
  id: string;
  plan_id: string;
  billing_period: string;
  currency: string;
  amount: string | null; // numeric columns come back as strings from pg to avoid float rounding
  setup_fee: string | null;
  effective_status: string;
  created_at: string;
  updated_at: string;
}

export type BillingPeriod = 'one_time' | 'monthly' | 'quarterly' | 'semi_annually' | 'annually';
export type EffectiveStatus = 'draft' | 'published';

export async function listPublishedPricingForPlan(pool: Queryable, planId: string): Promise<PricingRow[]> {
  const { rows } = await pool.query<PricingRow>(
    `SELECT * FROM plan_pricing WHERE plan_id = $1 AND effective_status = 'published' ORDER BY billing_period ASC`,
    [planId]
  );
  return rows;
}

export async function listAllPricingForPlan(pool: Queryable, planId: string): Promise<PricingRow[]> {
  const { rows } = await pool.query<PricingRow>(
    'SELECT * FROM plan_pricing WHERE plan_id = $1 ORDER BY billing_period ASC',
    [planId]
  );
  return rows;
}

export async function findPricingById(pool: Queryable, id: string): Promise<PricingRow | null> {
  const { rows } = await pool.query<PricingRow>('SELECT * FROM plan_pricing WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export interface CreatePricingInput {
  id: string;
  planId: string;
  billingPeriod: BillingPeriod;
  currency: string;
  amount?: number | null;
  setupFee?: number | null;
  effectiveStatus?: EffectiveStatus;
}

export async function createPricing(pool: Queryable, input: CreatePricingInput): Promise<PricingRow> {
  const { rows } = await pool.query<PricingRow>(
    `INSERT INTO plan_pricing (id, plan_id, billing_period, currency, amount, setup_fee, effective_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.id,
      input.planId,
      input.billingPeriod,
      input.currency.toUpperCase(),
      input.amount ?? null,
      input.setupFee ?? null,
      input.effectiveStatus ?? 'draft',
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create pricing row');
  return row;
}

export interface UpdatePricingInput {
  amount?: number | null;
  setupFee?: number | null;
  effectiveStatus?: EffectiveStatus;
}

export async function updatePricing(pool: Queryable, id: string, patch: UpdatePricingInput): Promise<PricingRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.amount !== undefined) {
    params.push(patch.amount);
    sets.push(`amount = $${params.length}`);
  }
  if (patch.setupFee !== undefined) {
    params.push(patch.setupFee);
    sets.push(`setup_fee = $${params.length}`);
  }
  if (patch.effectiveStatus !== undefined) {
    params.push(patch.effectiveStatus);
    sets.push(`effective_status = $${params.length}`);
  }

  if (sets.length === 0) {
    return findPricingById(pool, id);
  }

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await pool.query<PricingRow>(
    `UPDATE plan_pricing SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0] ?? null;
}
