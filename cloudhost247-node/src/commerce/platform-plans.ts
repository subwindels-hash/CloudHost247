/**
 * CloudHost247 platform service plans — the single admin-managed price list for packaged services
 * that are not hosting catalogue products (Website Builder tiers, AI Website Builder, Online Store,
 * Digital Marketing, Unified Inbox, Logo Maker packs).
 *
 * Two rules this module exists to keep:
 *
 *  1. **No price is ever invented.** The table ships empty and every read path here returns an
 *     empty set rather than a default, a "starting at" guess, or a placeholder. A service with no
 *     published plan renders the same honest "no plan has been published yet" state the hosting
 *     catalogue uses.
 *  2. **The server always decides the price.** `resolvePublishedPlan` is the only function that
 *     turns a plan reference into an amount, and it only ever reads a `published`, USD row. A
 *     caller can supply an id; it can never supply a price.
 */
import type { Queryable } from '../db/types';

export type PlatformServiceKind =
  | 'website_builder'
  | 'ai_builder'
  | 'online_store'
  | 'marketing'
  | 'inbox'
  | 'logo_maker';

export type BillingPeriod = 'one_time' | 'monthly' | 'quarterly' | 'semi_annually' | 'annually';

export interface PlatformServicePlanRow {
  id: string;
  service_kind: PlatformServiceKind;
  code: string;
  name: string;
  description: string | null;
  billing_period: BillingPeriod;
  price_amount: string;
  currency: string;
  features: unknown;
  limits: Record<string, number> | null;
  status: 'draft' | 'published' | 'archived';
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformPlanInput {
  serviceKind: PlatformServiceKind;
  code: string;
  name: string;
  description?: string | null;
  billingPeriod: BillingPeriod;
  priceAmount: string;
  currency?: string;
  features?: unknown;
  limits?: Record<string, number>;
  status?: 'draft' | 'published' | 'archived';
  sortOrder?: number;
  createdBy?: string | null;
}

const SELECT_COLUMNS = `id, service_kind, code, name, description, billing_period, price_amount,
  currency, features, limits, status, sort_order, created_by, created_at, updated_at`;

/** Every published plan for a service, cheapest-first — the customer-facing list. */
export async function listPublishedPlans(
  db: Queryable,
  serviceKind: PlatformServiceKind
): Promise<PlatformServicePlanRow[]> {
  const { rows } = await db.query<PlatformServicePlanRow>(
    `SELECT ${SELECT_COLUMNS} FROM platform_service_plans
      WHERE service_kind = $1 AND status = 'published'
      ORDER BY price_amount ASC, sort_order ASC, name ASC`,
    [serviceKind]
  );
  return rows;
}

/** Every plan of every state — admin only. */
export async function listAllPlans(
  db: Queryable,
  serviceKind?: PlatformServiceKind
): Promise<PlatformServicePlanRow[]> {
  const { rows } = serviceKind
    ? await db.query<PlatformServicePlanRow>(
        `SELECT ${SELECT_COLUMNS} FROM platform_service_plans WHERE service_kind = $1
          ORDER BY service_kind ASC, price_amount ASC, name ASC`,
        [serviceKind]
      )
    : await db.query<PlatformServicePlanRow>(
        `SELECT ${SELECT_COLUMNS} FROM platform_service_plans
          ORDER BY service_kind ASC, price_amount ASC, name ASC`
      );
  return rows;
}

export async function findPlanById(db: Queryable, id: string): Promise<PlatformServicePlanRow | null> {
  const { rows } = await db.query<PlatformServicePlanRow>(
    `SELECT ${SELECT_COLUMNS} FROM platform_service_plans WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * The pricing authority for every packaged platform service. Returns null — never a fallback price
 * — when the plan does not exist, is not published, or is not priced in the platform's single
 * supported currency. A caller that receives null must render an unavailable state.
 */
export async function resolvePublishedPlan(
  db: Queryable,
  planId: string,
  serviceKind: PlatformServiceKind
): Promise<PlatformServicePlanRow | null> {
  const plan = await findPlanById(db, planId);
  if (!plan) return null;
  if (plan.service_kind !== serviceKind) return null;
  if (plan.status !== 'published') return null;
  if (plan.currency.toUpperCase() !== 'USD') return null;
  return plan;
}

export async function createPlan(
  db: Queryable,
  id: string,
  input: PlatformPlanInput
): Promise<PlatformServicePlanRow> {
  const { rows } = await db.query<PlatformServicePlanRow>(
    `INSERT INTO platform_service_plans
       (id, service_kind, code, name, description, billing_period, price_amount, currency,
        features, limits, status, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      input.serviceKind,
      input.code,
      input.name,
      input.description ?? null,
      input.billingPeriod,
      input.priceAmount,
      (input.currency ?? 'USD').toUpperCase(),
      JSON.stringify(input.features ?? []),
      JSON.stringify(input.limits ?? {}),
      input.status ?? 'draft',
      input.sortOrder ?? 0,
      input.createdBy ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('createPlan: insert returned no row');
  return row;
}

export interface PlatformPlanPatch {
  name?: string;
  description?: string | null;
  priceAmount?: string;
  features?: unknown;
  limits?: Record<string, number>;
  status?: 'draft' | 'published' | 'archived';
  sortOrder?: number;
}

export async function updatePlan(
  db: Queryable,
  id: string,
  patch: PlatformPlanPatch
): Promise<PlatformServicePlanRow | null> {
  const { rows } = await db.query<PlatformServicePlanRow>(
    `UPDATE platform_service_plans SET
        name = COALESCE($2, name),
        description = CASE WHEN $3::boolean THEN $4 ELSE description END,
        price_amount = COALESCE($5, price_amount),
        features = COALESCE($6, features),
        limits = COALESCE($7, limits),
        status = COALESCE($8, status),
        sort_order = COALESCE($9, sort_order),
        updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      patch.name ?? null,
      Object.prototype.hasOwnProperty.call(patch, 'description'),
      patch.description ?? null,
      patch.priceAmount ?? null,
      patch.features === undefined ? null : JSON.stringify(patch.features),
      patch.limits === undefined ? null : JSON.stringify(patch.limits),
      patch.status ?? null,
      patch.sortOrder ?? null,
    ]
  );
  return rows[0] ?? null;
}

/** Parses the stored `limits` JSON into a typed map, ignoring anything that is not a positive int. */
export function parseLimits(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric) && numeric > 0) out[key] = Math.floor(numeric);
  }
  return out;
}
