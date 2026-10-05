/**
 * Admin platform: settings, and cross-cutting read views (deployments, installations,
 * subscriptions).
 *
 * Ported from cloudhost247-node/src/routes/admin-platform.ts. Platform settings are a typed
 * key/value store in platform_settings; writes are super_admin and audited.
 */
'use strict';

const { v } = require('../core/validate');
const { uuidv7 } = require('../lib/ids');
const { asAdmin, asSuperAdmin } = require('../lib/auth');

const name = 'admin-platform';

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/admin/settings', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('platform_settings').all();
    ctx.json({ settings: rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at })) });
  });

  router.put('/api/v1/admin/settings/:key', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ value: v.any() }));

    const existing = await store.table('platform_settings').findById(ctx.params.key);
    if (existing) {
      await store.table('platform_settings').updateById(ctx.params.key, {
        value: body.value, updated_by: auth.id,
      });
    } else {
      await store.table('platform_settings').insert({
        key: ctx.params.key, value: body.value, updated_by: auth.id,
      });
    }

    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'platform_setting_update', entity_type: 'platform_settings', entity_id: ctx.params.key,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
    });
    ctx.json({ ok: true, key: ctx.params.key });
  });

  router.get('/api/v1/admin/deployments', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('deployments').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ deployments: rows.map((d) => ({ id: d.id, userId: d.user_id, status: d.status, source: d.source, createdAt: d.created_at })), total });
  });

  router.get('/api/v1/admin/installations', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('application_installations').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ installations: rows.map((i) => ({ id: i.id, userId: i.user_id, applicationId: i.application_id, status: i.status })), total });
  });

  router.get('/api/v1/admin/subscriptions', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('subscriptions').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ subscriptions: rows.map((s) => ({ id: s.id, userId: s.user_id, status: s.status, renewsAt: s.renews_at })), total });
  });
}

module.exports = { name, register };
