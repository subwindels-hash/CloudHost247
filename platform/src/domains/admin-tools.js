/**
 * Admin views over the free-tools subsystem.
 *
 * Ported from cloudhost247-node/src/tools (admin surface). Read views over all users' tool reports
 * and monitors for moderation, plus the static catalogue.
 */
'use strict';

const { asAdmin } = require('../lib/auth');

const name = 'admin-tools';

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/admin/tools/reports', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('tools_reports').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ reports: rows.map((r) => ({ id: r.id, userId: r.user_id, toolSlug: r.tool_slug, title: r.title, createdAt: r.created_at })), total });
  });

  router.get('/api/v1/admin/tools/monitors', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('tools_monitors').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ monitors: rows.map((m) => ({ id: m.id, userId: m.user_id, url: m.url, status: m.status })), total });
  });

  router.delete('/api/v1/admin/tools/reports/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    await store.table('tools_reports').deleteById(ctx.params.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
