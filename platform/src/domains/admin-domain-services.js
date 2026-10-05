/**
 * Admin views over the domain aftermarket.
 *
 * Ported from cloudhost247-node/src/routes/admin-domain-services.ts. Read views over registrations,
 * transfers, auctions and brokerage providers, plus brokerage provider config.
 */
'use strict';

const { v } = require('../core/validate');
const { uuidv7 } = require('../lib/ids');
const { asAdmin, asStaff } = require('../lib/auth');

const name = 'admin-domain-services';

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/admin/domain-registrations', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('domain_registrations').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ registrations: rows.map((r) => ({ id: r.id, userId: r.user_id, domainName: r.domain_name, status: r.status })), total });
  });

  router.get('/api/v1/admin/domain-transfers', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('domain_transfers').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ transfers: rows.map((r) => ({ id: r.id, userId: r.user_id, domainName: r.domain_name, status: r.status })), total });
  });

  router.get('/api/v1/admin/domain-auctions', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('domain_auctions').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ auctions: rows.map((a) => ({ id: a.id, domainName: a.domain_name, status: a.status, currentBidCents: a.current_bid_cents })), total });
  });

  router.get('/api/v1/admin/domain-watches', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('domain_watches').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ watches: rows.map((w) => ({ id: w.id, userId: w.user_id, domainName: w.domain_name })), total });
  });

  // ---- brokerage providers ------------------------------------------------
  router.get('/api/v1/admin/brokerage/providers', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('domain_brokerage_providers').all();
    ctx.json({ providers: rows.map((p) => ({ id: p.id, name: p.name, type: p.type, active: p.active })) });
  });

  router.post('/api/v1/admin/brokerage/providers', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ name: v.string().trim().min(1).max(120), type: v.string().trim().min(1).max(64) }));
    const row = await store.table('domain_brokerage_providers').insert({ id: uuidv7(), name: body.name, type: body.type, active: true });
    ctx.code(201).json({ provider: { id: row.id, name: row.name, type: row.type } });
  });

  router.delete('/api/v1/admin/brokerage/providers/:id', async (ctx) => {
    await asStaff(ctx, deps);
    await store.table('domain_brokerage_providers').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
