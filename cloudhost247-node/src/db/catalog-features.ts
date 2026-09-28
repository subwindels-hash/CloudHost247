import type { Queryable } from './types';

export interface FeatureRow {
  id: string;
  plan_id: string;
  feature_name: string;
  feature_value: string | null;
  display_order: number;
  visibility: string;
  created_at: string;
  updated_at: string;
}

export type FeatureVisibility = 'public' | 'private';

export async function listPublicFeaturesForPlan(pool: Queryable, planId: string): Promise<FeatureRow[]> {
  const { rows } = await pool.query<FeatureRow>(
    `SELECT * FROM plan_features WHERE plan_id = $1 AND visibility = 'public' ORDER BY display_order ASC, feature_name ASC`,
    [planId]
  );
  return rows;
}

export async function listAllFeaturesForPlan(pool: Queryable, planId: string): Promise<FeatureRow[]> {
  const { rows } = await pool.query<FeatureRow>(
    'SELECT * FROM plan_features WHERE plan_id = $1 ORDER BY display_order ASC, feature_name ASC',
    [planId]
  );
  return rows;
}

export interface FeatureInput {
  featureName: string;
  featureValue?: string | null;
  displayOrder?: number;
  visibility?: FeatureVisibility;
}

/**
 * Replaces the entire feature list for a plan with the given set (delete-then-insert). This is the
 * simplest correct way to let an admin submit "here is the full feature list for this plan" from a
 * single form without needing separate add/remove/reorder endpoints for Phase 3's scope.
 *
 * Known limitation: this is not wrapped in a database transaction (the shared `Queryable`
 * abstraction used across this codebase — see src/db/types.ts — does not expose transaction
 * control, and a `pg.Pool` cannot safely run BEGIN/COMMIT across separate `.query()` calls because
 * each call may be served by a different pooled connection). A failure partway through would leave
 * a partial feature list rather than either the old or the new list intact. Acceptable for Phase
 * 3's catalog-configuration scope; should be revisited (e.g. by checking out a single `PoolClient`
 * for the duration of the write) before this endpoint is relied on for anything customer-facing.
 */
export async function replacePlanFeatures(
  pool: Queryable,
  planId: string,
  features: FeatureInput[],
  idGenerator: () => string
): Promise<FeatureRow[]> {
  await pool.query('DELETE FROM plan_features WHERE plan_id = $1', [planId]);

  const created: FeatureRow[] = [];
  for (const feature of features) {
    const { rows } = await pool.query<FeatureRow>(
      `INSERT INTO plan_features (id, plan_id, feature_name, feature_value, display_order, visibility)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        idGenerator(),
        planId,
        feature.featureName,
        feature.featureValue ?? null,
        feature.displayOrder ?? 0,
        feature.visibility ?? 'public',
      ]
    );
    const row = rows[0];
    if (row) created.push(row);
  }
  return created;
}
