import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';
import { findCustomerServerById } from '../db/server-provisioning';
import { findServiceById } from '../db/customer-services';
import { listServerMetrics } from '../db/ops-tables';
import { listInstallationsForServer } from '../db/application-installations';
import { getControlPanelAdapter } from '../control-panels/registry';

const idParamSchema = z.string().uuid('id must be a valid UUID');

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

export async function registerMonitoringRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  const registerHandlers = (prefix: string) => {
    /**
     * Server monitoring metrics & unified health status.
     */
    app.get<{ Params: { id: string } }>(`${prefix}/monitoring/servers/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idParamSchema, request.params.id);
      const isStaff = auth.role === 'admin' || auth.role === 'super_admin' || auth.role === 'staff';

      const server = await findCustomerServerById(pool, id);
      if (!server || (!isStaff && server.customer_id !== auth.userId)) {
        throw new NotFoundError('Server not found');
      }

      const metrics = await listServerMetrics(pool, id, 60);
      const latestMetric = metrics[0] ?? null;
      const installations = await listInstallationsForServer(pool, id);

      // Determine panel health
      let panelHealth: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN' = 'UNKNOWN';
      if (server.control_panel_id) {
        panelHealth = server.status === 'active' ? 'HEALTHY' : 'DEGRADED';
      }

      // Check critical services & health
      let healthStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN' = 'HEALTHY';
      if (server.status === 'error' || server.status === 'offline') {
        healthStatus = 'UNHEALTHY';
      } else if (server.status === 'maintenance' || server.status === 'stopped') {
        healthStatus = 'DEGRADED';
      } else if (server.status === 'provisioning' || server.status === 'installing' || server.status === 'queued') {
        healthStatus = 'UNKNOWN';
      } else if (latestMetric) {
        const memPercent = (latestMetric.memory_total_mb && latestMetric.memory_total_mb > 0 && latestMetric.memory_used_mb !== null)
          ? (latestMetric.memory_used_mb / latestMetric.memory_total_mb) * 100
          : 0;
        const diskPercent = (latestMetric.disk_total_mb && latestMetric.disk_total_mb > 0 && latestMetric.disk_used_mb !== null)
          ? (latestMetric.disk_used_mb / latestMetric.disk_total_mb) * 100
          : 0;
        const cpuNum = latestMetric.cpu_percent ? parseFloat(latestMetric.cpu_percent) : 0;
        if (cpuNum > 95 || memPercent > 95 || diskPercent > 95) {
          healthStatus = 'DEGRADED';
        }
      }

      return {
        monitoring: {
          serverId: server.id,
          serverName: server.name,
          hostname: server.hostname,
          ipAddress: server.ip_address,
          status: server.status,
          healthStatus,
          panelHealth,
          agentLastSeenAt: server.agent_last_seen_at,
          lastReconciledAt: server.updated_at,
          metrics: {
            current: latestMetric
              ? {
                  cpuPercent: latestMetric.cpu_percent,
                  load1: latestMetric.load_1,
                  load5: latestMetric.load_5,
                  load15: latestMetric.load_15,
                  memoryUsedMb: latestMetric.memory_used_mb,
                  memoryTotalMb: latestMetric.memory_total_mb,
                  diskUsedMb: latestMetric.disk_used_mb,
                  diskTotalMb: latestMetric.disk_total_mb,
                  networkInBytes: latestMetric.network_in_bytes,
                  networkOutBytes: latestMetric.network_out_bytes,
                  uptimeSeconds: latestMetric.uptime_seconds,
                  dockerContainers: latestMetric.docker_containers,
                  dockerContainersHealthy: latestMetric.docker_containers_healthy,
                  capturedAt: latestMetric.captured_at,
                }
              : null,
            history: metrics.map((m) => ({
              cpuPercent: m.cpu_percent,
              load1: m.load_1,
              memoryUsedMb: m.memory_used_mb,
              memoryTotalMb: m.memory_total_mb,
              diskUsedMb: m.disk_used_mb,
              diskTotalMb: m.disk_total_mb,
              capturedAt: m.captured_at,
            })),
          },
          services: [
            { name: 'SSH', status: server.status === 'active' ? 'ONLINE' : 'OFFLINE', port: 22 },
            { name: 'Web Server / HTTP', status: server.status === 'active' ? 'ONLINE' : 'OFFLINE', port: 80 },
            { name: 'HTTPS / TLS', status: server.status === 'active' ? 'ONLINE' : 'OFFLINE', port: 443 },
            ...(server.control_panel_id
              ? [
                  {
                    name: server.control_panel_slug ?? 'Control Panel',
                    status: server.status === 'active' ? 'ONLINE' : 'UNKNOWN',
                    port: 8443,
                  },
                ]
              : []),
          ],
          containers: installations.map((inst) => ({
            id: inst.id,
            name: inst.name ?? inst.id,
            status: inst.status,
            health: inst.status === 'running' ? 'HEALTHY' : 'DEGRADED',
          })),
        },
      };
    });

    /**
     * Service monitoring metrics & status.
     */
    app.get<{ Params: { id: string } }>(`${prefix}/monitoring/services/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idParamSchema, request.params.id);
      const isStaff = auth.role === 'admin' || auth.role === 'super_admin' || auth.role === 'staff';

      const service = await findServiceById(pool, id);
      if (!service || (!isStaff && service.user_id !== auth.userId && service.customer_id !== auth.userId)) {
        throw new NotFoundError('Service not found');
      }

      let serverMetrics = null;
      if (service.server_id) {
        const metrics = await listServerMetrics(pool, service.server_id, 1);
        serverMetrics = metrics[0] ?? null;
      }

      return {
        serviceMonitoring: {
          serviceId: service.id,
          label: service.label,
          status: service.status,
          healthStatus: service.status === 'active' ? 'HEALTHY' : service.status === 'suspended' ? 'DEGRADED' : 'UNKNOWN',
          domain: service.domain,
          hostname: service.hostname,
          serverId: service.server_id,
          serverName: service.server_name,
          serverIp: service.server_ip,
          panelName: service.panel_name,
          panelSlug: service.panel_slug,
          metrics: serverMetrics
            ? {
                cpuPercent: serverMetrics.cpu_percent,
                memoryUsedMb: serverMetrics.memory_used_mb,
                memoryTotalMb: serverMetrics.memory_total_mb,
                diskUsedMb: serverMetrics.disk_used_mb,
                diskTotalMb: serverMetrics.disk_total_mb,
                uptimeSeconds: serverMetrics.uptime_seconds,
              }
            : null,
        },
      };
    });
  };

  registerHandlers('/api/v1');
  registerHandlers('/api');
}
