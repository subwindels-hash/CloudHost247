/**
 * Infrastructure admin: providers, regions, OS images, server plans, notification outbox.
 *
 * Ported from cloudhost247-node/src/routes/infrastructure.ts. These are admin-managed catalog and
 * config tables. The live provider adapters (AWS EC2, etc.) are deferred; this module manages the
 * definitions the adapters consume, plus a notification outbox that is drained by a worker.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asStaff } = require('../lib/auth');

const name = 'infrastructure';

function register(router, deps) {
  const { store } = deps;

  // ---- customer notification centre ---------------------------------------
  router.get('/api/v1/notifications', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = await store.table('notifications').all();
    const mine = rows.filter((n) => n.user_id === auth.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const unread = mine.filter((n) => !n.read_at).length;
    ctx.json({
      notifications: mine.map((n) => ({ id: n.id, title: n.title, body: n.body, readAt: n.read_at, createdAt: n.created_at })),
      unread,
    });
  });

  router.post('/api/v1/notifications/:id/read', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const note = await store.table('notifications').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!note) throw new NotFoundError('No notification was found with that id');
    await store.table('notifications').updateById(note.id, { read_at: new Date().toISOString() });
    ctx.json({ read: true });
  });

  router.post('/api/v1/notifications/read-all', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = await store.table('notifications').all();
    let read = 0;
    for (const n of rows) {
      if (n.user_id === auth.id && !n.read_at) {
        await store.table('notifications').updateById(n.id, { read_at: new Date().toISOString() });
        read += 1;
      }
    }
    ctx.json({ read });
  });

  // ---- providers ----------------------------------------------------------
  router.get('/api/v1/admin/providers', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('infra_providers').all();
    ctx.json({ providers: rows.map((p) => ({ id: p.id, name: p.name, type: p.type, active: p.active })) });
  });
  router.post('/api/v1/admin/providers', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120),
      type: v.string().trim().min(1).max(64),
      config: v.object({}).passthrough().default({}),
    }));
    const row = await store.table('infra_providers').insert({ id: uuidv7(), name: body.name, type: body.type, config: body.config, active: true });
    ctx.code(201).json({ provider: { id: row.id, name: row.name, type: row.type } });
  });
  router.delete('/api/v1/admin/providers/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('infra_providers').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });

  // ---- regions ------------------------------------------------------------
  router.get('/api/v1/admin/regions', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('regions').all();
    ctx.json({ regions: rows.map((r) => ({ id: r.id, name: r.name, code: r.code, providerId: r.provider_id, active: r.active })) });
  });
  router.post('/api/v1/admin/regions', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120),
      code: v.string().trim().min(1).max(64),
      providerId: v.string().optional(),
    }));
    const row = await store.table('regions').insert({ id: uuidv7(), name: body.name, code: body.code, provider_id: body.providerId ?? null, active: true });
    ctx.code(201).json({ region: { id: row.id, name: row.name, code: row.code } });
  });

  // ---- os images ----------------------------------------------------------
  router.get('/api/v1/admin/os-images', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('os_images').all();
    ctx.json({ images: rows.map((i) => ({ id: i.id, osId: i.os_id, providerImageId: i.provider_image_id, active: i.active })) });
  });
  router.post('/api/v1/admin/os-images', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      osId: v.string().min(1), providerImageId: v.string().trim().min(1).max(120), regionId: v.string().optional(),
    }));
    const row = await store.table('os_images').insert({ id: uuidv7(), os_id: body.osId, provider_image_id: body.providerImageId, region_id: body.regionId ?? null, active: true });
    ctx.code(201).json({ image: { id: row.id } });
  });

  // ---- server plans -------------------------------------------------------
  router.get('/api/v1/admin/server-plans', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('server_plans').all();
    ctx.json({ plans: rows.map((p) => ({ id: p.id, name: p.name, priceCents: p.price_cents, active: p.active })) });
  });
  router.post('/api/v1/admin/server-plans', async (ctx) => {
    await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({
      name: v.string().trim().min(1).max(120),
      priceCents: v.coerce.number().int().min(0),
      spec: v.object({}).passthrough().default({}),
    }));
    const row = await store.table('server_plans').insert({ id: uuidv7(), name: body.name, price_cents: body.priceCents, spec: body.spec, active: true });
    ctx.code(201).json({ plan: { id: row.id, name: row.name } });
  });
  router.delete('/api/v1/admin/server-plans/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('server_plans').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });

  // ---- notification outbox ------------------------------------------------
  router.get('/api/v1/admin/notifications', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('notification_outbox').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ notifications: rows, total });
  });
  router.post('/api/v1/admin/notifications/drain', async (ctx) => {
    await asStaff(ctx, deps);
    const rows = await store.table('notification_outbox').all();
    let drained = 0;
    for (const row of rows) {
      if (row.status === 'pending') {
        await store.table('notification_outbox').updateById(row.id, { status: 'sent', updated_at: new Date().toISOString() });
        drained += 1;
      }
    }
    ctx.json({ drained });
  });

  // ---- infrastructure logs ------------------------------------------------
  router.get('/api/v1/admin/infrastructure-logs', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('infrastructure_logs').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ logs: rows, total });
  });
}

module.exports = { name, register };
