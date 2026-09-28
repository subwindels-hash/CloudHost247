import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  createProduct,
  findProductById,
  listAllProducts,
  setProductStatus,
  updateProduct,
} from '../db/catalog-products';
import { createPlan, findPlanById, listAllPlansForProduct, setPlanStatus, updatePlan } from '../db/catalog-plans';
import { createPricing, findPricingById, listAllPricingForPlan, updatePricing } from '../db/catalog-pricing';
import { listAllFeaturesForPlan, replacePlanFeatures } from '../db/catalog-features';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';
import { toAdminFeature, toAdminPlan, toAdminPricing, toAdminProduct } from '../dto/catalog';

// Catalog administration is deliberately restricted to 'super_admin' for Phase 3 — see
// docs/API_CATALOG.md "Authorization model" for why this is intentionally the narrower of the two
// privileged roles the users table already supports (users.role also allows 'admin'; broadening
// catalog management to that role is a one-line change here once an operational need for it is
// confirmed, not a schema change).
const CATALOG_ADMIN_ROLES = ['super_admin'] as const;

const statusSchema = z.object({ status: z.enum(['draft', 'active', 'disabled']) });

const createProductSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase letters, numbers, and single hyphens only'),
  name: z.string().min(1).max(255),
  description: z.string().max(4000).nullable().optional(),
  productType: z.enum(['hosting', 'domain', 'service']),
  status: z.enum(['draft', 'active', 'disabled']).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  displayOrder: z.number().int().optional(),
});

const updateProductSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(4000).nullable().optional(),
    productType: z.enum(['hosting', 'domain', 'service']).optional(),
    visibility: z.enum(['public', 'private']).optional(),
    displayOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

const createPlanSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase letters, numbers, and single hyphens only'),
  name: z.string().min(1).max(255),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(['draft', 'active', 'disabled']).optional(),
  billingModel: z.enum(['one_time', 'recurring']).optional(),
  displayOrder: z.number().int().optional(),
});

const updatePlanSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(4000).nullable().optional(),
    billingModel: z.enum(['one_time', 'recurring']).optional(),
    displayOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

const createPricingSchema = z.object({
  billingPeriod: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']),
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter ISO 4217 code'),
  amount: z.number().nonnegative().nullable().optional(),
  setupFee: z.number().nonnegative().nullable().optional(),
  effectiveStatus: z.enum(['draft', 'published']).optional(),
});

const updatePricingSchema = z
  .object({
    amount: z.number().nonnegative().nullable().optional(),
    setupFee: z.number().nonnegative().nullable().optional(),
    effectiveStatus: z.enum(['draft', 'published']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

const featureItemSchema = z.object({
  featureName: z.string().min(1).max(160),
  featureValue: z.string().max(2000).nullable().optional(),
  displayOrder: z.number().int().optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

const replaceFeaturesSchema = z.object({
  features: z.array(featureItemSchema).max(100),
});

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * Protected catalog administration API — see docs/API_CATALOG.md for the full contract.
 *
 * Every route here calls `requireRole(request, env, pool, CATALOG_ADMIN_ROLES)` before touching
 * the database. That check re-verifies the caller's role directly against the `users` table (not
 * just the JWT claim — see src/lib/require-role.ts), so a revoked admin role takes effect
 * immediately rather than only once their existing token expires. All mutations are persisted to
 * PostgreSQL through the same repository functions the rest of the app uses — there is no
 * in-memory or client-side-only admin state.
 */
export async function registerCatalogAdminRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  async function assertAdmin(request: FastifyRequest) {
    return requireRole(request, env, pool, CATALOG_ADMIN_ROLES);
  }

  // --- Products ---------------------------------------------------------------------------------

  app.get('/api/v1/admin/catalog/products', async (request) => {
    await assertAdmin(request);
    const products = await listAllProducts(pool);
    return { products: products.map(toAdminProduct) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/catalog/products/:id', async (request) => {
    await assertAdmin(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const product = await findProductById(pool, id);
    if (!product) throw new NotFoundError('No product was found with that id');

    const plans = await listAllPlansForProduct(pool, product.id);
    const plansWithDetail = await Promise.all(
      plans.map(async (plan) => {
        const [pricing, features] = await Promise.all([
          listAllPricingForPlan(pool, plan.id),
          listAllFeaturesForPlan(pool, plan.id),
        ]);
        return {
          ...toAdminPlan(plan),
          pricing: pricing.map(toAdminPricing),
          features: features.map(toAdminFeature),
        };
      })
    );

    return { product: toAdminProduct(product), plans: plansWithDetail };
  });

  app.post('/api/v1/admin/catalog/products', async (request, reply) => {
    await assertAdmin(request);
    const input = parseOrThrow(createProductSchema, request.body);
    const product = await createProduct(pool, { id: randomUUID(), ...input });
    reply.code(201);
    return { product: toAdminProduct(product) };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/catalog/products/:id', async (request) => {
    await assertAdmin(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const patch = parseOrThrow(updateProductSchema, request.body);
    const product = await updateProduct(pool, id, patch);
    if (!product) throw new NotFoundError('No product was found with that id');
    return { product: toAdminProduct(product) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/catalog/products/:id/status', async (request) => {
    await assertAdmin(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { status } = parseOrThrow(statusSchema, request.body);
    const product = await setProductStatus(pool, id, status);
    if (!product) throw new NotFoundError('No product was found with that id');
    return { product: toAdminProduct(product) };
  });

  // --- Plans --------------------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/v1/admin/catalog/products/:id/plans', async (request, reply) => {
    await assertAdmin(request);
    const { id: productId } = parseOrThrow(idParamSchema, request.params);
    const product = await findProductById(pool, productId);
    if (!product) throw new NotFoundError('No product was found with that id');

    const input = parseOrThrow(createPlanSchema, request.body);
    const plan = await createPlan(pool, { id: randomUUID(), productId, ...input });
    reply.code(201);
    return { plan: toAdminPlan(plan) };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/catalog/plans/:id', async (request) => {
    await assertAdmin(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const patch = parseOrThrow(updatePlanSchema, request.body);
    const plan = await updatePlan(pool, id, patch);
    if (!plan) throw new NotFoundError('No plan was found with that id');
    return { plan: toAdminPlan(plan) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/catalog/plans/:id/status', async (request) => {
    await assertAdmin(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { status } = parseOrThrow(statusSchema, request.body);
    const plan = await setPlanStatus(pool, id, status);
    if (!plan) throw new NotFoundError('No plan was found with that id');
    return { plan: toAdminPlan(plan) };
  });

  // --- Pricing ------------------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/v1/admin/catalog/plans/:id/pricing', async (request, reply) => {
    await assertAdmin(request);
    const { id: planId } = parseOrThrow(idParamSchema, request.params);
    const plan = await findPlanById(pool, planId);
    if (!plan) throw new NotFoundError('No plan was found with that id');

    const input = parseOrThrow(createPricingSchema, request.body);
    if (input.effectiveStatus === 'published' && (input.amount === null || input.amount === undefined)) {
      // The database CHECK constraint (plan_pricing_published_requires_amount_check) would also
      // reject this, but catching it here returns a clean, expected 400 instead of an opaque
      // constraint-violation 500 — the database constraint remains the real, load-bearing
      // guarantee (defense in depth), this is purely a better error for the API caller.
      throw new ValidationError('A price cannot be published without a real amount');
    }
    const pricing = await createPricing(pool, { id: randomUUID(), planId, ...input });
    reply.code(201);
    return { pricing: toAdminPricing(pricing) };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/catalog/pricing/:id', async (request) => {
    await assertAdmin(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const patch = parseOrThrow(updatePricingSchema, request.body);

    const existing = await findPricingById(pool, id);
    if (!existing) throw new NotFoundError('No pricing entry was found with that id');

    const resultingStatus = patch.effectiveStatus ?? existing.effective_status;
    const resultingAmount = patch.amount !== undefined ? patch.amount : existing.amount;
    if (resultingStatus === 'published' && (resultingAmount === null || resultingAmount === undefined)) {
      throw new ValidationError('A price cannot be published without a real amount');
    }

    const pricing = await updatePricing(pool, id, patch);
    if (!pricing) throw new NotFoundError('No pricing entry was found with that id');
    return { pricing: toAdminPricing(pricing) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/catalog/pricing/:id', async (request) => {
    await assertAdmin(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const pricing = await findPricingById(pool, id);
    if (!pricing) throw new NotFoundError('No pricing entry was found with that id');
    return { pricing: toAdminPricing(pricing) };
  });

  // --- Features -----------------------------------------------------------------------------------

  app.put<{ Params: { id: string } }>('/api/v1/admin/catalog/plans/:id/features', async (request) => {
    await assertAdmin(request);
    const { id: planId } = parseOrThrow(idParamSchema, request.params);
    const plan = await findPlanById(pool, planId);
    if (!plan) throw new NotFoundError('No plan was found with that id');

    const { features } = parseOrThrow(replaceFeaturesSchema, request.body);
    const created = await replacePlanFeatures(pool, planId, features, randomUUID);
    return { features: created.map(toAdminFeature) };
  });
}
