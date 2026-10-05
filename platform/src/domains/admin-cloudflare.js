/**
 * Admin views over the Cloudflare integration.
 *
 * Ported from cloudhost247-node/src/routes/admin-cloudflare.ts. Read views over accounts, services,
 * jobs and logs, plus plan-mapping config that decides which CF plan a service gets.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin, asStaff } = require('../lib/auth');

const name = 'admin-cloudflare';

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/admin/cloudflare/accounts', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('cloudflare_accounts').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ accounts: rows.map((a) => ({ id: a.id, userId: a.user_id, accountName: a.account_name, status: a.status })), total });
  });

  router.get('/api/v1/admin/cloudflare/services', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('cloudflare_services').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ services: rows.map((s) => ({ id: s.id, userId: s.user_id, zoneName: s.zone_name, status: s.status })), total });
  });

  router.get('/api/v1/admin/cloudflare/jobs', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('cloudflare_jobs').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ jobs: rows, total });
  });

  router.get('/api/v1/admin/cloudflare/logs', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('cloudflare_logs').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ logs: rows, total });
  });

  // ---- plan mappings ------------------------------------------------------
  router.get('/api/v1/admin/cloudflare/plan-mappings', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('cloudflare_plan_mappings').all();
    ctx.json({ mappings: rows.map((m) => ({ id: m.id, productId: m.product_id, planName: m.plan_name })) });
  });

  router.post('/api/v1/admin/cloudflare/plan-mappings', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ productId: v.string().min(1), planName: v.string().trim().min(1).max(120) }));
    const row = await store.table('cloudflare_plan_mappings').insert({ id: uuidv7(), product_id: body.productId, plan_name: body.planName });
    ctx.code(201).json({ mapping: { id: row.id, productId: row.product_id, planName: row.plan_name } });
  });

  router.delete('/api/v1/admin/cloudflare/plan-mappings/:id', async (ctx) => {
    await asStaff(ctx, deps);
    const row = await store.table('cloudflare_plan_mappings').findById(ctx.params.id);
    if (!row) throw new NotFoundError('Mapping not found');
    await store.table('cloudflare_plan_mappings').deleteById(row.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
