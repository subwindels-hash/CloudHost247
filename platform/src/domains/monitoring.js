/**
 * Server monitoring & telemetry ingestion.
 *
 * Ported from cloudhost247-node/src/routes/monitoring.ts. Metrics are collected into server_metrics
 * by the on-server agent (via signed HMAC reports or direct API telemetry push) and read back.
 * Customers see their own servers' latest metrics; admins see health across all.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, UnauthorizedError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin } = require('../lib/auth');
const { authenticateAgent } = require('../lib/agent-auth');

const name = 'monitoring';

const isStaffRole = (role) => ['admin', 'super_admin', 'staff'].includes(role);

// Map a server's lifecycle status to a unified health banner, escalating to DEGRADED when the
// latest metric shows CPU/memory/disk saturation (mirrors the original monitoring.ts logic).
function healthFromStatus(status, latest) {
  if (status === 'error' || status === 'offline') return 'UNHEALTHY';
  if (status === 'maintenance' || status === 'stopped') return 'DEGRADED';
  if (status === 'provisioning' || status === 'installing' || status === 'queued') return 'UNKNOWN';
  if (latest && (Number(latest.cpu_percent) > 95 || Number(latest.memory_percent) > 95 || Number(latest.disk_percent) > 95)) return 'DEGRADED';
  return 'HEALTHY';
}

function metricDto(m) {
  return m ? {
    cpuPercent: m.cpu_percent ?? null, memoryPercent: m.memory_percent ?? null,
    diskPercent: m.disk_percent ?? null, loadAverage: m.load_average ?? null, capturedAt: m.collected_at,
  } : null;
}

function register(router, deps) {
  const { store } = deps;

  async function latestMetrics(serverId, limit) {
    const rows = await store.table('server_metrics').all();
    return rows
      .filter((m) => m.server_id === serverId)
      .sort((a, b) => String(b.collected_at).localeCompare(String(a.collected_at)))
      .slice(0, limit);
  }

  // Unified server monitoring: health banner, latest + historical metrics, core service probes
  // and installed-application containers. Owners see their own server; staff see any.
  const serverMonitoring = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findById(ctx.params.id);
    const staff = isStaffRole(auth.role);
    if (!server || (!staff && server.user_id !== auth.id)) throw new NotFoundError('Server not found');

    const metrics = await latestMetrics(server.id, 60);
    const latest = metrics[0] ?? null;
    const { rows: installations } = await store.table('application_installations').find({ server_id: server.id }, { orderBy: '-created_at' });
    const online = server.status === 'active';
    const services = [
      { name: 'SSH', status: online ? 'ONLINE' : 'OFFLINE', port: 22 },
      { name: 'Web Server / HTTP', status: online ? 'ONLINE' : 'OFFLINE', port: 80 },
      { name: 'HTTPS / TLS', status: online ? 'ONLINE' : 'OFFLINE', port: 443 },
    ];
    if (server.panel) services.push({ name: server.panel, status: online ? 'ONLINE' : 'UNKNOWN', port: 8443 });

    const heartbeat = await store.table('agent_heartbeats').findOne({ server_id: server.id });
    const agentLastSeenAt = server.metadata?.agent_last_seen_at ?? heartbeat?.last_seen_at ?? null;

    ctx.json({
      monitoring: {
        serverId: server.id, serverName: server.name, hostname: server.hostname ?? null,
        ipAddress: server.ip_address ?? null, status: server.status,
        healthStatus: healthFromStatus(server.status, latest),
        panelHealth: server.panel ? (online ? 'HEALTHY' : 'DEGRADED') : 'UNKNOWN',
        agentLastSeenAt,
        lastReconciledAt: server.updated_at,
        metrics: { current: metricDto(latest), history: metrics.map(metricDto) },
        services,
        containers: installations.map((i) => ({ id: i.id, name: i.name ?? i.id, status: i.status, health: i.status === 'running' ? 'HEALTHY' : 'DEGRADED' })),
      },
    });
  };

  // Service monitoring: the customer-service record plus the latest metrics of its underlying server.
  const serviceMonitoring = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const service = await store.table('customer_services').findById(ctx.params.id);
    const staff = isStaffRole(auth.role);
    if (!service || (!staff && service.user_id !== auth.id && service.customer_id !== auth.id)) throw new NotFoundError('Service not found');

    let serverMetrics = null;
    let server = null;
    if (service.server_id) {
      server = await store.table('servers').findById(service.server_id);
      const m = await latestMetrics(service.server_id, 1);
      serverMetrics = m[0] ?? null;
    }
    ctx.json({
      serviceMonitoring: {
        serviceId: service.id, label: service.label ?? null, status: service.status,
        healthStatus: service.status === 'active' ? 'HEALTHY' : service.status === 'suspended' ? 'DEGRADED' : 'UNKNOWN',
        domain: service.domain ?? null, hostname: service.hostname ?? null,
        serverId: service.server_id ?? null, serverName: server?.name ?? null, serverIp: server?.ip_address ?? null,
        metrics: metricDto(serverMetrics),
      },
    });
  };

  // The original calls registerHandlers() twice — once for '/api/v1' and once for the legacy
  // '/api' prefix — so both mounts serve exactly the same handlers.
  for (const prefix of ['/api/v1', '/api']) {
    router.get(`${prefix}/monitoring/servers/:id`, serverMonitoring);
    router.get(`${prefix}/monitoring/services/:id`, serviceMonitoring);
  }

  router.get('/api/v1/monitoring/servers/:id/metrics', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const server = await store.table('servers').findById(ctx.params.id);
    const staff = isStaffRole(auth.role);
    if (!server || (!staff && server.user_id !== auth.id)) throw new NotFoundError('Server not found');

    const query = await ctx.validateQuery(v.object({ limit: v.coerce.number().int().min(1).max(500).default(60) }));
    const rows = await store.table('server_metrics').all();
    const metrics = rows
      .filter((m) => m.server_id === server.id)
      .sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)))
      .slice(-query.limit);
    ctx.json({ serverId: server.id, metrics });
  });

  // Telemetry ingestion endpoint for a specific server (agent or owner/staff)
  router.post('/api/v1/monitoring/servers/:id/metrics', async (ctx) => {
    const server = await store.table('servers').findById(ctx.params.id);
    if (!server) throw new NotFoundError('Server not found');

    // Authenticate caller: check for agent signature first, then user auth
    let callerType = 'user';
    try {
      const agentAuth = await authenticateAgent(ctx, deps);
      if (agentAuth.server && agentAuth.server.id !== server.id) {
        throw new UnauthorizedError('Agent signature does not match target server');
      }
      callerType = 'agent';
    } catch {
      const auth = await authenticate(ctx, deps);
      const staff = isStaffRole(auth.role);
      if (!staff && server.user_id !== auth.id) throw new NotFoundError('Server not found');
    }

    const body = await ctx.validate(v.object({
      cpuPercent: v.coerce.number().min(0).max(100).optional(),
      memoryPercent: v.coerce.number().min(0).max(100).optional(),
      diskPercent: v.coerce.number().min(0).max(100).optional(),
      loadAverage: v.coerce.number().min(0).optional(),
      memoryUsedMb: v.coerce.number().int().min(0).optional(),
      memoryTotalMb: v.coerce.number().int().min(0).optional(),
      diskUsedMb: v.coerce.number().int().min(0).optional(),
      diskTotalMb: v.coerce.number().int().min(0).optional(),
      load1: v.coerce.number().min(0).optional(),
    }));

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
      server_id: server.id,
      cpu_percent: cpu,
      memory_percent: mem,
      disk_percent: disk,
      load_average: load,
    });

    const nowIso = new Date().toISOString();
    const existingHeartbeat = await store.table('agent_heartbeats').findOne({ server_id: server.id });
    if (existingHeartbeat) {
      await store.table('agent_heartbeats').updateById(existingHeartbeat.id, { last_seen_at: nowIso });
    } else {
      await store.table('agent_heartbeats').insert({ id: uuidv7(), server_id: server.id, last_seen_at: nowIso });
    }

    const metadata = { ...(server.metadata || {}), agent_last_seen_at: nowIso };
    await store.table('servers').updateById(server.id, { metadata });

    ctx.code(201).json({ ok: true, metricId: metric.id, serverId: server.id, callerType });
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
