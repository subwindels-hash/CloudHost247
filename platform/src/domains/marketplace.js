/**
 * App marketplace — browse the catalogue.
 *
 * Ported from cloudhost247-node/src/routes/marketplace.ts. Categories and applications are
 * admin-managed; the marketplace endpoints are public browsing (auth required for install).
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');

const name = 'marketplace';

function publicApp(row) {
  return {
    id: row.id, name: row.name, slug: row.slug, description: row.description,
    categoryId: row.category_id, version: row.version, icon: row.icon,
    free: row.price_cents === 0, priceCents: row.price_cents, active: row.active,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/marketplace/categories', async (ctx) => {
    const rows = await store.table('application_categories').all();
    ctx.json({ categories: rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug, active: c.active })) });
  });

  router.get('/api/v1/marketplace/apps', async (ctx) => {
    const query = await ctx.validateQuery(v.object({
      search: v.string().trim().max(100).optional(),
      category: v.string().trim().max(64).optional(),
    }));

    let rows = await store.table('applications').all();
    rows = rows.filter((a) => a.active);
    if (query.category) {
      const cat = await store.table('application_categories').findOne({ slug: query.category });
      if (cat) rows = rows.filter((a) => a.category_id === cat.id);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      rows = rows.filter((a) => a.name.toLowerCase().includes(s) || (a.description || '').toLowerCase().includes(s));
    }
    ctx.json({ apps: rows.map(publicApp), total: rows.length });
  });

  router.get('/api/v1/marketplace/apps/:id', async (ctx) => {
    const app = await store.table('applications').findById(ctx.params.id);
    if (!app || !app.active) throw new NotFoundError('Application not found');
    ctx.json({ app: publicApp(app) });
  });
}

module.exports = { name, register };
