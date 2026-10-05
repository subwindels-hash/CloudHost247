/**
 * Agent endpoints — used by the on-server monitoring/provisioning agent.
 *
 * Ported from cloudhost247-node/src/routes/agent.ts. The agent authenticates with a shared secret
 * (AGENT_TOKEN) rather than a customer JWT, and reports heartbeats + metrics.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { UnauthorizedError, NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');

const name = 'agent';

function constantTimeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireAgentToken(ctx, config) {
  const expected = config.AGENT_TOKEN;
  if (!expected) throw new UnauthorizedError('Agent endpoints are disabled (no AGENT_TOKEN configured)');
  const header = ctx.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !constantTimeEqual(token, expected)) throw new UnauthorizedError('Invalid agent token');
}

function register(router, deps) {
  const { store, config } = deps;

  router.get('/api/v1/agent/ping', async (ctx) => {
    requireAgentToken(ctx, config);
    ctx.json({ ok: true, pong: Date.now() });
  });

  router.post('/api/v1/agent/report', async (ctx) => {
    requireAgentToken(ctx, config);
    const body = await ctx.validate(v.object({
      serverId: v.string().min(1),
      cpuPercent: v.coerce.number().min(0).max(100).optional(),
      memoryPercent: v.coerce.number().min(0).max(100).optional(),
      diskPercent: v.coerce.number().min(0).max(100).optional(),
      loadAverage: v.coerce.number().min(0).optional(),
    }));

    await store.table('server_metrics').insert({
      id: uuidv7(),
      server_id: body.serverId,
      cpu_percent: body.cpuPercent ?? null,
      memory_percent: body.memoryPercent ?? null,
      disk_percent: body.diskPercent ?? null,
      load_average: body.loadAverage ?? null,
    });

    const existing = await store.table('agent_heartbeats').findOne({ server_id: body.serverId });
    if (existing) {
      await store.table('agent_heartbeats').updateById(existing.id, { last_seen_at: new Date().toISOString() });
    } else {
      await store.table('agent_heartbeats').insert({ id: uuidv7(), server_id: body.serverId, last_seen_at: new Date().toISOString() });
    }
    ctx.json({ ok: true });
  });

  /**
   * The agent reporting an installation's health (agent.ts POST /agent/health). The original
   * derives the server from the signed agent identity; this port's shared-token auth carries no
   * server identity, so serverId is taken from the body when supplied and the project name alone
   * otherwise.
   */
  router.post('/api/v1/agent/health', async (ctx) => {
    requireAgentToken(ctx, config);
    const body = await ctx.validate(v.object({
      project: v.string().min(1).max(120),
      healthy: v.boolean(),
      detail: v.string().max(500).optional(),
      serverId: v.string().uuid().optional(),
    }));

    const predicate = body.serverId
      ? { container_project: body.project, server_id: body.serverId }
      : { container_project: body.project };
    const installation = await store.table('application_installations').findOne(predicate);
    if (!installation) throw new NotFoundError('No installation found for that project on this server');

    await store.table('application_installations').updateById(installation.id, {
      health_status: body.healthy ? 'healthy' : 'unhealthy',
      last_health_check_at: new Date().toISOString(),
    });

    ctx.json({ ok: true, installationId: installation.id, status: body.healthy ? 'healthy' : 'unhealthy' });
  });

  router.get('/api/v1/agent/health', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('agent_heartbeats').all();
    const now = Date.now();
    ctx.json({
      agents: rows.map((r) => {
        const age = now - new Date(r.last_seen_at).getTime();
        return { serverId: r.server_id, lastSeenAt: r.last_seen_at, online: age < 90_000 };
      }),
    });
  });
}

module.exports = { name, register };
