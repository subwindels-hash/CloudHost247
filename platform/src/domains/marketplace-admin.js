/**
 * Marketplace admin — manage application categories and applications.
 *
 * Ported from cloudhost247-node/src/routes/marketplace-admin.ts. Admin/staff CRUD over the
 * catalogue the public marketplace browses.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin, asStaff } = require('../lib/auth');

const name = 'marketplace-admin';

function publicApp(row) {
  return { id: row.id, name: row.name, slug: row.slug, categoryId: row.category_id, version: row.version, priceCents: row.price_cents, active: row.active };
}

function register(router, deps) {
  const { store } = deps;

  // ---- categories ---------------------------------------------------------
  router.get('/api/v1/admin/marketplace/categories', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('application_categories').all();
    ctx.json({ categories: rows });
  });

  router.post('/api/v1/admin/marketplace/categories', async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), slug: v.string().trim().min(1).max(120) }));
    const row = await store.table('application_categories').insert({ id: uuidv7(), name: body.name, slug: body.slug, active: true });
    ctx.code(201).json({ category: row });
  });

  router.delete('/api/v1/admin/marketplace/categories/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('application_categories').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });

  // ---- applications -------------------------------------------------------
  router.get('/api/v1/admin/marketplace/apps', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('applications').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ apps: rows.map(publicApp), total });
  });

  router.post('/api/v1/admin/marketplace/apps', async (ctx) => {
    await asStaff(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120),
      slug: v.string().trim().min(1).max(120),
      categoryId: v.string().optional(),
      version: v.string().trim().max(40).optional(),
      description: v.string().trim().max(2000).optional(),
      priceCents: v.coerce.number().int().min(0).default(0),
    }));
    const app = await store.table('applications').insert({
      id: uuidv7(), name: body.name, slug: body.slug, category_id: body.categoryId ?? null,
      version: body.version ?? null, description: body.description ?? null,
      price_cents: body.priceCents, active: true,
    });
    ctx.code(201).json({ app: publicApp(app) });
  });

  router.patch('/api/v1/admin/marketplace/apps/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const app = await store.table('applications').findById(ctx.params.id);
    if (!app) throw new NotFoundError('Application not found');
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120).optional(),
      version: v.string().trim().max(40).optional(),
      priceCents: v.coerce.number().int().min(0).optional(),
      active: v.boolean().optional(),
      description: v.string().trim().max(2000).optional(),
    }));
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.version !== undefined) patch.version = body.version;
    if (body.priceCents !== undefined) patch.price_cents = body.priceCents;
    if (body.active !== undefined) patch.active = body.active;
    if (body.description !== undefined) patch.description = body.description;
    const updated = await store.table('applications').updateById(app.id, patch);
    ctx.json({ app: publicApp(updated) });
  });

  router.delete('/api/v1/admin/marketplace/apps/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('applications').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
