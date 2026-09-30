/**
 * Phase 6 — the control-plane endpoints the CloudHost247 Server Agent calls (spec §30, §31).
 *
 * Authentication is the reverse direction of agent-client.ts: the agent signs each request with
 * its per-server secret (HMAC over agentId+timestamp+nonce+method+path+bodyHash); we verify the
 * signature, timestamp skew, and nonce freshness before touching the database. Compromised or
 * replayed requests fail closed. Metrics reports are stored in server_metrics (spec §51).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { UnauthorizedError, ValidationError, NotFoundError } from '../lib/errors';
import { NonceCache, verifySignedRequest } from '../deployments/agent-protocol';
import { findServerByAgentId, updateServer } from '../db/servers';
import { insertServerMetric } from '../db/ops-tables';
import { getKeyRing } from '../lib/keyring';
import { getCredential } from '../db/servers';

/** Per-process nonce cache — replay protection for inbound agent requests (spec §31). */
const inboundNonces = new NonceCache();

const reportSchema = z.object({
  agentVersion: z.string().max(32),
  cpuPercent: z.coerce.number().min(0).max(100).nullable().optional(),
  load1: z.coerce.number().nullable().optional(),
  load5: z.coerce.number().nullable().optional(),
  load15: z.coerce.number().nullable().optional(),
  memoryUsedMb: z.coerce.number().int().min(0).nullable().optional(),
  memoryTotalMb: z.coerce.number().int().min(0).nullable().optional(),
  diskUsedMb: z.coerce.number().int().min(0).nullable().optional(),
  diskTotalMb: z.coerce.number().int().min(0).nullable().optional(),
  networkInBytes: z.coerce.number().int().min(0).nullable().optional(),
  networkOutBytes: z.coerce.number().int().min(0).nullable().optional(),
  uptimeSeconds: z.coerce.number().int().min(0).nullable().optional(),
  dockerContainers: z.coerce.number().int().min(0).nullable().optional(),
  dockerContainersHealthy: z.coerce.number().int().min(0).nullable().optional(),
  // Provisioning attestation. New server agents report these from the running machine; older
  // agents may omit them and remain valid for legacy application hosting, but a newly provisioned
  // server is not marked READY until all are present and verified by the worker.
  osId: z.string().max(64).optional(),
  osVersion: z.string().max(128).optional(),
  hostname: z.string().max(255).optional(),
  securityConfigured: z.boolean().optional(),
  monitoringRunning: z.boolean().optional(),
});

export async function registerAgentRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  /**
   * Verifies an inbound agent request and returns the authenticated server row. Throws
   * UnauthorizedError on any failure — never revealing whether the agent id exists.
   */
  async function authenticateAgent(request: { headers: Record<string, string | string[] | undefined>; rawBody?: Buffer; method: string; raw: { url?: string } }) {
    const agentIdHeader = request.headers['x-ch247-agent-id'];
    const agentId = Array.isArray(agentIdHeader) ? agentIdHeader[0] : agentIdHeader;
    if (!agentId) throw new UnauthorizedError('Missing agent identity');

    const server = await findServerByAgentId(pool, agentId);
    if (!server) throw new UnauthorizedError('Unknown agent');

    const secret = await getCredential(pool, getKeyRing(), server.id, 'agent_secret');
    if (!secret) throw new UnauthorizedError('Agent has no secret registered');

    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const path = (request.raw.url ?? '/').split('?')[0] ?? '/';
    const result = verifySignedRequest(secret, request.headers, request.method, path, rawBody.toString('utf8'), inboundNonces);
    if (!result.valid) throw new UnauthorizedError(`Agent request rejected: ${result.reason}`);
    return server;
  }

  app.get('/api/v1/agent/ping', async (request) => {
    const server = await authenticateAgent(request as never);
    await updateServer(pool, server.id, { agentLastSeenAt: new Date().toISOString() });
    return { ok: true, serverTime: new Date().toISOString() };
  });

  app.post('/api/v1/agent/report', async (request) => {
    const server = await authenticateAgent(request as never);
    const parsed = reportSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const report = parsed.data;
    await insertServerMetric(pool, {
      server_id: server.id,
      cpu_percent: report.cpuPercent !== undefined && report.cpuPercent !== null ? String(report.cpuPercent) : null,
      load_1: report.load1 !== undefined && report.load1 !== null ? String(report.load1) : null,
      load_5: report.load5 !== undefined && report.load5 !== null ? String(report.load5) : null,
      load_15: report.load15 !== undefined && report.load15 !== null ? String(report.load15) : null,
      memory_used_mb: report.memoryUsedMb ?? null,
      memory_total_mb: report.memoryTotalMb ?? null,
      disk_used_mb: report.diskUsedMb ?? null,
      disk_total_mb: report.diskTotalMb ?? null,
      network_in_bytes: report.networkInBytes ?? null,
      network_out_bytes: report.networkOutBytes ?? null,
      uptime_seconds: report.uptimeSeconds ?? null,
      docker_containers: report.dockerContainers ?? null,
      docker_containers_healthy: report.dockerContainersHealthy ?? null,
    });
    const provisioningHealth = report.osId && report.osVersion && report.hostname
      ? {
          osId: report.osId,
          osVersion: report.osVersion,
          hostname: report.hostname,
          securityConfigured: report.securityConfigured === true,
          monitoringRunning: report.monitoringRunning === true,
          reportedAt: new Date().toISOString(),
        }
      : undefined;
    await updateServer(pool, server.id, {
      agentVersion: report.agentVersion,
      agentLastSeenAt: new Date().toISOString(),
      metadata: provisioningHealth
        ? { ...(server.metadata ?? {}), provisioningHealth }
        : server.metadata,
    });
    return { ok: true };
  });

  // Health-check result push: agents can report out-of-band health transitions (spec §52).
  app.post('/api/v1/agent/health', async (request) => {
    const server = await authenticateAgent(request as never);
    const { project, healthy, detail } = z
      .object({ project: z.string().min(1).max(120), healthy: z.boolean(), detail: z.string().max(500).optional() })
      .parse(request.body);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM application_installations WHERE container_project = $1 AND server_id = $2`,
      [project, server.id]
    );
    const installation = rows[0];
    if (!installation) throw new NotFoundError('No installation found for that project on this server');
    await pool.query(
      `UPDATE application_installations
       SET health_status = $2, last_health_check_at = now(), updated_at = now()
       WHERE id = $1`,
      [installation.id, healthy ? 'healthy' : 'unhealthy']
    );
    return { ok: true };
  });
}
