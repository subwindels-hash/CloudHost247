/**
 * Server monitoring.
 *
 * Ported from cloudhost247-node/src/routes/monitoring.ts. Metrics are collected into server_metrics
 * by an agent (deferred here) and read back. Customers see their own servers' latest metrics;
 * admins see health across all.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { authenticate, asAdmin } = require('../lib/auth');

const name = 'monitoring';

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/monitoring/servers/:id/metrics', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!server) throw new NotFoundError('Server not found');

    const query = await ctx.validateQuery(v.object({ limit: v.coerce.number().int().min(1).max(500).default(60) }));
    const rows = await store.table('server_metrics').all();
    const metrics = rows
      .filter((m) => m.server_id === server.id)
      .sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)))
      .slice(-query.limit);
    ctx.json({ serverId: server.id, metrics });
  });

  router.get('/api/v1/admin/monitoring/server-health', async (ctx) => {
    await asAdmin(ctx, deps);
    const servers = await store.table('servers').all();
    const metrics = await store.table('server_metrics').all();
    // Latest metric per server.
    const latest = new Map();
    for (const m of metrics) {
      const prev = latest.get(m.server_id);
      if (!prev || String(m.collected_at) > String(prev.collected_at)) latest.set(m.server_id, m);
    }
    ctx.json({
      servers: servers.map((s) => {
        const m = latest.get(s.id);
        return {
          id: s.id, name: s.name, status: s.status,
          cpuPercent: m ? m.cpu_percent : null,
          memoryPercent: m ? m.memory_percent : null,
          diskPercent: m ? m.disk_percent : null,
        };
      }),
    });
  });
}

module.exports = { name, register };
