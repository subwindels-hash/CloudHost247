/**
 * Product catalog — public (unauthenticated) reads and admin (role-gated) administration.
 *
 * Ported from cloudhost247-node/src/routes/catalog-public.ts and catalog-admin.ts, and from
 * src/services/catalog-service.ts (whose "public visibility" rules are enforced inline here).
 *
 * The public handlers return only publicly-safe DTOs: no database ids, no internal status flags,
 * and no unpublished pricing ever reach those responses. Draft and archived products, and any
 * pricing row with is_active = false, are invisible to unauthenticated callers.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');

const name = 'catalog';

const slugSchema = v
  .string()
  .min(1, 'slug is required')
  .max(160, 'slug is too long')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase letters, numbers, and single hyphens only');

const listQuerySchema = v.object({
  category: v.string().max(60).optional(),
});

const productSchema = v.object({
  slug: slugSchema,
  name: v.string().trim().min(1).max(160),
  category: v.string().trim().max(60).optional(),
  description: v.string().trim().max(4000).optional(),
  status: v.enum(['draft', 'active', 'archived']).default('draft'),
  sortOrder: v.coerce.number().int().default(0),
  metadata: v.record(v.any()).default({}),
});

const planSchema = v.object({
  slug: slugSchema,
  name: v.string().trim().min(1).max(160),
  description: v.string().trim().max(4000).optional(),
  status: v.enum(['draft', 'active', 'archived']).default('draft'),
  sortOrder: v.coerce.number().int().default(0),
  limits: v.record(v.any()).default({}),
  metadata: v.record(v.any()).default({}),
});

const pricingSchema = v.object({
  currency: v.string().trim().length(3).default('USD'),
  billingCycle: v.enum(['monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'once']),
  price: v.coerce.number().min(0),
  setupFee: v.coerce.number().min(0).default(0),
  isActive: v.boolean().default(true),
});

const featureSchema = v.object({
  label: v.string().trim().min(1).max(200),
  value: v.string().trim().max(200).optional(),
  icon: v.string().trim().max(60).optional(),
  sortOrder: v.coerce.number().int().default(0),
});

// ---------------------------------------------------------------- public DTOs

function publicProduct(row) {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    description: row.description,
  };
}

function publicPlan(row, pricing) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    limits: row.limits ?? {},
    pricing: (pricing ?? []).map((p) => ({
      currency: p.currency,
      billingCycle: p.billing_cycle,
      price: p.price,
      setupFee: p.setup_fee,
    })),
  };
}

async function activePricingFor(store, planIds) {
  if (planIds.length === 0) return new Map();
  const { rows } = await store.table('catalog_plan_pricing').find(
    { plan_id: { $in: planIds }, is_active: true },
    { orderBy: ['currency', 'billing_cycle'] }
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.plan_id)) grouped.set(row.plan_id, []);
    grouped.get(row.plan_id).push(row);
  }
  return grouped;
}

async function featuresFor(store, planIds) {
  if (planIds.length === 0) return new Map();
  const { rows } = await store.table('catalog_plan_features').find(
    { plan_id: { $in: planIds } },
    { orderBy: 'sort_order' }
  );
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.plan_id)) grouped.set(row.plan_id, []);
    grouped.get(row.plan_id).push({ label: row.label, value: row.value, icon: row.icon });
  }
  return grouped;
}

function register(router, deps) {
  const { store } = deps;

  // ================================================================ public ===

  /** GET /api/v1/catalog — the whole published catalog in one round trip. */
  router.get('/api/v1/catalog', async (ctx) => {
    const { rows: products } = await store.table('catalog_products').find(
      { status: 'active' },
      { orderBy: ['sort_order', 'name'] }
    );

    const productIds = products.map((p) => p.id);
    const { rows: plans } = productIds.length
      ? await store.table('catalog_product_plans').find(
        { product_id: { $in: productIds }, status: 'active' },
        { orderBy: ['sort_order', 'name'] }
      )
      : { rows: [] };

    const pricing = await activePricingFor(store, plans.map((p) => p.id));
    const features = await featuresFor(store, plans.map((p) => p.id));

    const byProduct = new Map();
    for (const plan of plans) {
      if (!byProduct.has(plan.product_id)) byProduct.set(plan.product_id, []);
      byProduct.get(plan.product_id).push({
        ...publicPlan(plan, pricing.get(plan.id)),
        features: features.get(plan.id) ?? [],
      });
    }

    ctx.json({
      products: products.map((product) => ({
        ...publicProduct(product),
        plans: byProduct.get(product.id) ?? [],
      })),
    });
  });

  router.get('/api/v1/catalog/products', async (ctx) => {
    const query = listQuerySchema.parseHttp(ctx.query);
    const predicate = { status: 'active' };
    if (query.category) predicate.category = query.category;

    const { rows } = await store.table('catalog_products').find(predicate, {
      orderBy: ['sort_order', 'name'],
    });
    ctx.json({ products: rows.map(publicProduct) });
  });

  router.get('/api/v1/catalog/products/:slug', async (ctx) => {
    const slug = slugSchema.parseHttp(ctx.params.slug);
    const product = await store.table('catalog_products').findOne({ slug, status: 'active' });
    if (!product) throw new NotFoundError('No product was found with that identifier');
    ctx.json({ product: publicProduct(product) });
  });

  router.get('/api/v1/catalog/products/:slug/plans', async (ctx) => {
    const slug = slugSchema.parseHttp(ctx.params.slug);
    const product = await store.table('catalog_products').findOne({ slug, status: 'active' });
    if (!product) throw new NotFoundError('No product was found with that identifier');

    const { rows: plans } = await store.table('catalog_product_plans').find(
      { product_id: product.id, status: 'active' },
      { orderBy: ['sort_order', 'name'] }
    );
    const pricing = await activePricingFor(store, plans.map((p) => p.id));
    const features = await featuresFor(store, plans.map((p) => p.id));

    ctx.json({
      product: publicProduct(product),
      plans: plans.map((plan) => ({
        ...publicPlan(plan, pricing.get(plan.id)),
        features: features.get(plan.id) ?? [],
      })),
    });
  });

  // ================================================================ admin ====

  const admin = (handler) => async (ctx) => {
    await asAdmin(ctx, deps);
    return handler(ctx);
  };

  router.get('/api/v1/admin/catalog/products', admin(async (ctx) => {
    const { rows, total } = await store.table('catalog_products').find({}, { orderBy: ['sort_order', 'name'] });
    ctx.json({ products: rows, total });
  }));

  // Product detail with its plans, and each plan's pricing + features (admin sees everything,
  // including draft/archived rows and inactive pricing — unlike the public surface).
  router.get('/api/v1/admin/catalog/products/:id', admin(async (ctx) => {
    const product = await store.table('catalog_products').findById(ctx.params.id);
    if (!product) throw new NotFoundError('No product was found with that id');
    const { rows: plans } = await store.table('catalog_product_plans').find(
      { product_id: product.id }, { orderBy: ['sort_order', 'name'] }
    );
    const plansWithDetail = [];
    for (const plan of plans) {
      const { rows: pricing } = await store.table('catalog_plan_pricing').find(
        { plan_id: plan.id }, { orderBy: ['currency', 'billing_cycle'] }
      );
      const { rows: features } = await store.table('catalog_plan_features').find(
        { plan_id: plan.id }, { orderBy: 'sort_order' }
      );
      plansWithDetail.push({ ...plan, pricing, features });
    }
    ctx.json({ product, plans: plansWithDetail });
  }));

  router.post('/api/v1/admin/catalog/products', admin(async (ctx) => {
    const input = await ctx.validate(productSchema);
    const product = await store.table('catalog_products').insert({
      id: uuidv7(),
      slug: input.slug,
      name: input.name,
      category: input.category ?? null,
      description: input.description ?? null,
      status: input.status,
      sort_order: input.sortOrder,
      metadata: input.metadata,
    });
    ctx.code(201).json({ product });
  }));

  router.patch('/api/v1/admin/catalog/products/:id', admin(async (ctx) => {
    const input = await ctx.validate(productSchema.partial());
    const patch = {};
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.name !== undefined) patch.name = input.name;
    if (input.category !== undefined) patch.category = input.category;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (input.metadata !== undefined) patch.metadata = input.metadata;

    const product = await store.table('catalog_products').updateById(ctx.params.id, patch);
    if (!product) throw new NotFoundError('Product not found');
    ctx.json({ product });
  }));

  router.post('/api/v1/admin/catalog/products/:id/status', admin(async (ctx) => {
    const body = await ctx.validate(v.object({ status: v.enum(['draft', 'active', 'archived']) }));
    const product = await store.table('catalog_products').updateById(ctx.params.id, { status: body.status });
    if (!product) throw new NotFoundError('No product was found with that id');
    ctx.json({ product });
  }));

  router.delete('/api/v1/admin/catalog/products/:id', admin(async (ctx) => {
    // Cascade by hand: the JSON store has no foreign keys to enforce this for us.
    const product = await store.table('catalog_products').findById(ctx.params.id);
    if (!product) throw new NotFoundError('Product not found');

    const { rows: plans } = await store.table('catalog_product_plans').find({ product_id: product.id });
    const planIds = plans.map((p) => p.id);
    if (planIds.length > 0) {
      await store.table('catalog_plan_pricing').deleteMany({ plan_id: { $in: planIds } });
      await store.table('catalog_plan_features').deleteMany({ plan_id: { $in: planIds } });
      await store.table('catalog_product_plans').deleteMany({ product_id: product.id });
    }
    await store.table('catalog_products').deleteById(product.id);
    ctx.json({ ok: true });
  }));

  // ---- plans ---------------------------------------------------------------

  router.get('/api/v1/admin/catalog/products/:id/plans', admin(async (ctx) => {
    const { rows, total } = await store.table('catalog_product_plans').find(
      { product_id: ctx.params.id },
      { orderBy: ['sort_order', 'name'] }
    );
    ctx.json({ plans: rows, total });
  }));

  router.post('/api/v1/admin/catalog/products/:id/plans', admin(async (ctx) => {
    const product = await store.table('catalog_products').findById(ctx.params.id);
    if (!product) throw new NotFoundError('Product not found');

    const input = await ctx.validate(planSchema);
    const plan = await store.table('catalog_product_plans').insert({
      id: uuidv7(),
      product_id: product.id,
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      sort_order: input.sortOrder,
      limits: input.limits,
      metadata: input.metadata,
    });
    ctx.code(201).json({ plan });
  }));

  router.patch('/api/v1/admin/catalog/plans/:id', admin(async (ctx) => {
    const input = await ctx.validate(planSchema.partial());
    const patch = {};
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined) patch.status = input.status;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
    if (input.limits !== undefined) patch.limits = input.limits;
    if (input.metadata !== undefined) patch.metadata = input.metadata;

    const plan = await store.table('catalog_product_plans').updateById(ctx.params.id, patch);
    if (!plan) throw new NotFoundError('Plan not found');
    ctx.json({ plan });
  }));

  router.post('/api/v1/admin/catalog/plans/:id/status', admin(async (ctx) => {
    const body = await ctx.validate(v.object({ status: v.enum(['draft', 'active', 'archived']) }));
    const plan = await store.table('catalog_product_plans').updateById(ctx.params.id, { status: body.status });
    if (!plan) throw new NotFoundError('No plan was found with that id');
    ctx.json({ plan });
  }));

  // ---- pricing -------------------------------------------------------------

  router.get('/api/v1/admin/catalog/plans/:id/pricing', admin(async (ctx) => {
    const { rows } = await store.table('catalog_plan_pricing').find(
      { plan_id: ctx.params.id },
      { orderBy: ['currency', 'billing_cycle'] }
    );
    ctx.json({ pricing: rows });
  }));

  router.post('/api/v1/admin/catalog/plans/:id/pricing', admin(async (ctx) => {
    const plan = await store.table('catalog_product_plans').findById(ctx.params.id);
    if (!plan) throw new NotFoundError('Plan not found');

    const input = await ctx.validate(pricingSchema);
    const existing = await store.table('catalog_plan_pricing').findOne({
      plan_id: plan.id,
      currency: input.currency,
      billing_cycle: input.billingCycle,
    });
    if (existing) throw new ValidationError('Pricing already exists for that currency and billing cycle');

    const pricing = await store.table('catalog_plan_pricing').insert({
      id: uuidv7(),
      plan_id: plan.id,
      currency: input.currency,
      billing_cycle: input.billingCycle,
      price: input.price,
      setup_fee: input.setupFee,
      is_active: input.isActive,
    });
    ctx.code(201).json({ pricing });
  }));

  router.patch('/api/v1/admin/catalog/pricing/:id', admin(async (ctx) => {
    const input = await ctx.validate(pricingSchema.partial());
    const patch = {};
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.billingCycle !== undefined) patch.billing_cycle = input.billingCycle;
    if (input.price !== undefined) patch.price = input.price;
    if (input.setupFee !== undefined) patch.setup_fee = input.setupFee;
    if (input.isActive !== undefined) patch.is_active = input.isActive;

    const pricing = await store.table('catalog_plan_pricing').updateById(ctx.params.id, patch);
    if (!pricing) throw new NotFoundError('Pricing not found');
    ctx.json({ pricing });
  }));

  router.get('/api/v1/admin/catalog/pricing/:id', admin(async (ctx) => {
    const pricing = await store.table('catalog_plan_pricing').findById(ctx.params.id);
    if (!pricing) throw new NotFoundError('No pricing entry was found with that id');
    ctx.json({ pricing });
  }));

  // ---- features ------------------------------------------------------------

  router.get('/api/v1/admin/catalog/plans/:id/features', admin(async (ctx) => {
    const { rows } = await store.table('catalog_plan_features').find(
      { plan_id: ctx.params.id },
      { orderBy: 'sort_order' }
    );
    ctx.json({ features: rows });
  }));

  router.post('/api/v1/admin/catalog/plans/:id/features', admin(async (ctx) => {
    const plan = await store.table('catalog_product_plans').findById(ctx.params.id);
    if (!plan) throw new NotFoundError('Plan not found');

    const input = await ctx.validate(featureSchema);
    const feature = await store.table('catalog_plan_features').insert({
      id: uuidv7(),
      plan_id: plan.id,
      label: input.label,
      value: input.value ?? null,
      icon: input.icon ?? null,
      sort_order: input.sortOrder,
    });
    ctx.code(201).json({ feature });
  }));

  // Replace the entire feature set for a plan in one atomic call (the original's PUT contract).
  router.put('/api/v1/admin/catalog/plans/:id/features', admin(async (ctx) => {
    const plan = await store.table('catalog_product_plans').findById(ctx.params.id);
    if (!plan) throw new NotFoundError('No plan was found with that id');
    const input = await ctx.validate(v.object({ features: v.array(featureSchema).max(100) }));
    await store.table('catalog_plan_features').deleteMany({ plan_id: plan.id });
    const created = [];
    for (const f of input.features) {
      created.push(await store.table('catalog_plan_features').insert({
        id: uuidv7(), plan_id: plan.id, label: f.label, value: f.value ?? null,
        icon: f.icon ?? null, sort_order: f.sortOrder,
      }));
    }
    ctx.json({ features: created });
  }));

  router.delete('/api/v1/admin/catalog/features/:id', admin(async (ctx) => {
    const deleted = await store.table('catalog_plan_features').deleteById(ctx.params.id);
    if (!deleted) throw new NotFoundError('Feature not found');
    ctx.json({ ok: true });
  }));
}

module.exports = { name, register };
