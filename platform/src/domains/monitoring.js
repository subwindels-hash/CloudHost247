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

    ctx.json({
      monitoring: {
        serverId: server.id, serverName: server.name, hostname: server.hostname ?? null,
        ipAddress: server.ip_address ?? null, status: server.status,
        healthStatus: healthFromStatus(server.status, latest),
        panelHealth: server.panel ? (online ? 'HEALTHY' : 'DEGRADED') : 'UNKNOWN',
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
