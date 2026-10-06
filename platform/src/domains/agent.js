/**
 * Agent endpoints — used by the on-server monitoring/provisioning agent.
 *
 * Ported from cloudhost247-node/src/routes/agent.ts. Authenticates incoming agent requests
 * using HMAC-SHA256 request signatures (per-server secret) or fallback shared AGENT_TOKEN.
 * Stores telemetry in server_metrics and tracks agent heartbeats and health status.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');
const { authenticateAgent } = require('../lib/agent-auth');

const name = 'agent';

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/agent/ping', async (ctx) => {
    const auth = await authenticateAgent(ctx, deps);
    const nowIso = new Date().toISOString();
    if (auth.server) {
      const existing = await store.table('agent_heartbeats').findOne({ server_id: auth.server.id });
      if (existing) {
        await store.table('agent_heartbeats').updateById(existing.id, { last_seen_at: nowIso });
      } else {
        await store.table('agent_heartbeats').insert({ id: uuidv7(), server_id: auth.server.id, last_seen_at: nowIso });
      }
      const metadata = { ...(auth.server.metadata || {}), agent_last_seen_at: nowIso };
      await store.table('servers').updateById(auth.server.id, { metadata });
    }
    ctx.json({ ok: true, pong: Date.now(), serverTime: nowIso });
  });

  router.post('/api/v1/agent/report', async (ctx) => {
    const auth = await authenticateAgent(ctx, deps);
    const body = await ctx.validate(v.object({
      serverId: v.string().min(1).optional(),
      cpuPercent: v.coerce.number().min(0).max(100).optional(),
      memoryPercent: v.coerce.number().min(0).max(100).optional(),
      diskPercent: v.coerce.number().min(0).max(100).optional(),
      loadAverage: v.coerce.number().min(0).optional(),
      // Raw telemetry metrics from server agent
      memoryUsedMb: v.coerce.number().int().min(0).optional(),
      memoryTotalMb: v.coerce.number().int().min(0).optional(),
      diskUsedMb: v.coerce.number().int().min(0).optional(),
      diskTotalMb: v.coerce.number().int().min(0).optional(),
      load1: v.coerce.number().min(0).optional(),
      load5: v.coerce.number().min(0).optional(),
      load15: v.coerce.number().min(0).optional(),
      uptimeSeconds: v.coerce.number().int().min(0).optional(),
      agentVersion: v.string().max(32).optional(),
      dockerContainers: v.coerce.number().int().min(0).optional(),
      dockerContainersHealthy: v.coerce.number().int().min(0).optional(),
      osId: v.string().max(64).optional(),
      osVersion: v.string().max(128).optional(),
      hostname: v.string().max(255).optional(),
    }));

    const targetServerId = auth.server ? auth.server.id : body.serverId;
    if (!targetServerId) {
      throw new ValidationError('serverId is required when not authenticated as a registered agent');
    }

    let cpu = body.cpuPercent ?? null;
    let mem = body.memoryPercent ?? null;
    let disk = body.diskPercent ?? null;
    let load = body.loadAverage ?? body.load1 ?? null;

    if (mem === null && body.memoryUsedMb !== undefined && body.memoryTotalMb && body.memoryTotalMb > 0) {
      mem = Math.round((body.memoryUsedMb / body.memoryTotalMb) * 10000) / 100;
    }
    if (disk === null && body.diskUsedMb !== undefined && body.diskTotalMb && body.diskTotalMb > 0) {
      disk = Math.round((body.diskUsedMb / body.diskTotalMb) * 10000) / 100;
    }

    const metric = await store.table('server_metrics').insert({
      id: uuidv7(),
      server_id: targetServerId,
      cpu_percent: cpu,
      memory_percent: mem,
      disk_percent: disk,
      load_average: load,
    });

    const nowIso = new Date().toISOString();
    const existing = await store.table('agent_heartbeats').findOne({ server_id: targetServerId });
    if (existing) {
      await store.table('agent_heartbeats').updateById(existing.id, { last_seen_at: nowIso });
    } else {
      await store.table('agent_heartbeats').insert({ id: uuidv7(), server_id: targetServerId, last_seen_at: nowIso });
    }

    const serverRow = auth.server || await store.table('servers').findById(targetServerId);
    if (serverRow) {
      const metadata = { ...(serverRow.metadata || {}), agent_last_seen_at: nowIso };
      if (body.agentVersion) metadata.agent_version = body.agentVersion;
      if (body.osId && body.osVersion) {
        metadata.provisioningHealth = {
          osId: body.osId,
          osVersion: body.osVersion,
          hostname: body.hostname || serverRow.hostname,
          reportedAt: nowIso,
        };
      }
      await store.table('servers').updateById(serverRow.id, { metadata });
    }

    ctx.json({ ok: true, metricId: metric.id });
  });

  /**
   * The agent reporting an installation's health (agent.ts POST /agent/health).
   */
  router.post('/api/v1/agent/health', async (ctx) => {
    const auth = await authenticateAgent(ctx, deps);
    const body = await ctx.validate(v.object({
      project: v.string().min(1).max(120),
      healthy: v.boolean(),
      detail: v.string().max(500).optional(),
      serverId: v.string().uuid().optional(),
    }));

    const effectiveServerId = auth.server ? auth.server.id : body.serverId;
    const predicate = effectiveServerId
      ? { container_project: body.project, server_id: effectiveServerId }
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
