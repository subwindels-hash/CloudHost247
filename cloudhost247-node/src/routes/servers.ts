/**
 * Phase 6 — server management API (spec §5, §25, §6).
 *
 * Admin routes (POST/PATCH/DELETE) require admin/super_admin and are audit-logged. Credential
 * storage encrypts at rest and NEVER returns values — only metadata (type, key version, rotated).
 * Customer routes expose only the public metadata needed to choose hosting in the wizard; the
 * metrics/health endpoints are open to the customer whose installations run on that server.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import {
  createServer,
  findServerById,
  getServerAllocation,
  listCredentialMetadata,
  listServers,
  retireServer,
  rotateServerCredentials,
  storeCredential,
  updateServer,
  type CredentialType,
} from '../db/servers';
import { listServerMetrics, trimServerMetrics } from '../db/ops-tables';
import { listInstallationsForServer } from '../db/application-installations';
import { getKeyRing } from '../lib/keyring';
import { generateSecret } from '../lib/crypto';

const idSchema = z.string().uuid('id must be a valid UUID');

const createServerSchema = z.object({
  name: z.string().min(1).max(255),
  hostname: z.string().min(1).max(255),
  ipAddress: z.string().max(64).nullable().optional(),
  serverType: z.enum(['VPS', 'DEDICATED', 'CPANEL', 'KUBERNETES', 'SHARED']),
  provider: z.string().max(64).nullable().optional(),
  region: z.string().max(64).nullable().optional(),
  cpuCores: z.coerce.number().int().min(1).max(1024),
  memoryMb: z.coerce.number().int().min(256).max(4_194_304),
  storageMb: z.coerce.number().int().min(1024).max(67_108_864),
  dockerEnabled: z.boolean().default(false),
  kubernetesEnabled: z.boolean().default(false),
  cpanelEnabled: z.boolean().default(false),
  agentUrl: z.string().url().optional(),
  whmUrl: z.string().url().optional(),
  whmUser: z.string().max(64).optional(),
  agentSecret: z.string().min(24).max(512).optional(),
  whmApiToken: z.string().min(16).max(512).optional(),
});

const patchServerSchema = createServerSchema.partial().extend({
  status: z.enum(['active', 'provisioning', 'maintenance', 'offline', 'retired']).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

function publicServerDto(server: Awaited<ReturnType<typeof findServerById>>) {
  if (!server) return null;
  return {
    id: server.id,
    name: server.name,
    serverType: server.server_type,
    region: server.region,
    status: server.status,
    dockerEnabled: server.docker_enabled,
    kubernetesEnabled: server.kubernetes_enabled,
    cpanelEnabled: server.cpanel_enabled,
    cpuCores: server.cpu_cores,
    memoryMb: server.memory_mb,
    storageMb: server.storage_mb,
  };
}

export async function registerServerRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  // --- Admin: server registry (spec §5 "The admin dashboard must allow administrators to
  //     register and manage servers") ----------------------------------------------------------
  app.get('/api/v1/admin/servers', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const query = parseOrThrow(z.object({ type: z.string().max(16).optional(), status: z.string().max(24).optional() }), request.query ?? {});
    const servers = await listServers(pool, { type: query.type, status: query.status });
    const withUsage = await Promise.all(
      servers.map(async (server) => ({
        ...server,
        allocation: await getServerAllocation(pool, server.id),
      }))
    );
    return { servers: withUsage };
  });

  app.post('/api/v1/admin/servers', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const input = parseOrThrow(createServerSchema, request.body);

    const metadata: Record<string, unknown> = {};
    if (input.agentUrl) metadata.agent_url = input.agentUrl;
    if (input.whmUrl) metadata.whm_url = input.whmUrl;
    if (input.whmUser) metadata.whm_user = input.whmUser;

    const agentId = input.agentUrl || input.agentSecret ? `agent-${generateSecret(6).toLowerCase()}` : null;

    const server = await createServer(pool, {
      name: input.name,
      hostname: input.hostname,
      ipAddress: input.ipAddress ?? null,
      serverType: input.serverType,
      provider: input.provider ?? null,
      region: input.region ?? null,
      cpuCores: input.cpuCores,
      memoryMb: input.memoryMb,
      storageMb: input.storageMb,
      dockerEnabled: input.dockerEnabled,
      kubernetesEnabled: input.kubernetesEnabled,
      cpanelEnabled: input.cpanelEnabled,
      metadata,
    });

    // Register agent identity + secrets (spec §6): encrypted immediately, never returned.
    if (agentId) {
      await pool.query(`UPDATE servers SET agent_id = $2 WHERE id = $1`, [server.id, agentId]);
    }
    const secretValue = input.agentSecret ?? (agentId ? generateSecret(32) : null);
    if (agentId && secretValue) {
      await storeCredential(pool, getKeyRing(), server.id, 'agent_secret', secretValue);
    }
    if (input.whmApiToken && input.whmUser && input.whmUrl) {
      await storeCredential(pool, getKeyRing(), server.id, 'whm_api_token', input.whmApiToken);
    }

    await auditRequest(pool, request, auth.userId, {
      action: 'server.registered',
      resourceType: 'server',
      resourceId: server.id,
      metadata: { name: server.name, type: server.server_type, agentGenerated: !!agentId && !input.agentSecret },
    });
    reply.code(201);
    return {
      server: { ...server, agent_id: agentId ?? server.agent_id },
      // The generated agent secret is returned EXACTLY ONCE at registration so the operator can
      // install it on the server; it is never retrievable again (only rotatable).
      agentSecret: agentId && !input.agentSecret ? secretValue : undefined,
    };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/servers/:id', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const server = await findServerById(pool, id);
    if (!server) throw new NotFoundError('No server was found with that id');
    return {
      server,
      allocation: await getServerAllocation(pool, id),
      credentials: await listCredentialMetadata(pool, id),
      installations: (await listInstallationsForServer(pool, id)).length,
    };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/servers/:id', async (request) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const patch = parseOrThrow(patchServerSchema, request.body);

    const existing = await findServerById(pool, id);
    if (!existing) throw new NotFoundError('No server was found with that id');

    const metadata = { ...(existing.metadata ?? {}) } as Record<string, unknown>;
    if (patch.agentUrl !== undefined) metadata.agent_url = patch.agentUrl;
    if (patch.whmUrl !== undefined) metadata.whm_url = patch.whmUrl;
    if (patch.whmUser !== undefined) metadata.whm_user = patch.whmUser;

    const server = await updateServer(pool, id, {
      name: patch.name,
      hostname: patch.hostname,
      ipAddress: patch.ipAddress,
      serverType: patch.serverType,
      provider: patch.provider,
      region: patch.region,
      status: patch.status,
      cpuCores: patch.cpuCores,
      memoryMb: patch.memoryMb,
      storageMb: patch.storageMb,
      dockerEnabled: patch.dockerEnabled,
      kubernetesEnabled: patch.kubernetesEnabled,
      cpanelEnabled: patch.cpanelEnabled,
      metadata,
    });
    if (!server) throw new NotFoundError('No server was found with that id');

    if (patch.agentSecret) {
      await storeCredential(pool, getKeyRing(), id, 'agent_secret', patch.agentSecret);
    }
    if (patch.whmApiToken) {
      await storeCredential(pool, getKeyRing(), id, 'whm_api_token', patch.whmApiToken);
    }

    await auditRequest(pool, request, auth.userId, {
      action: 'server.updated',
      resourceType: 'server',
      resourceId: id,
      metadata: { ...patch, agentSecret: patch.agentSecret ? '[redacted]' : undefined, whmApiToken: undefined },
    });
    return { server };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/servers/:id', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const server = await findServerById(pool, id);
    if (!server) throw new NotFoundError('No server was found with that id');
    const installations = await listInstallationsForServer(pool, id);
    if (installations.length > 0) {
      throw new ConflictError(
        `${installations.length} active installation(s) still run on this server — migrate them before retiring it`
      );
    }
    await retireServer(pool, id);
    await auditRequest(pool, request, auth.userId, {
      action: 'server.retired',
      resourceType: 'server',
      resourceId: id,
      metadata: { name: server.name },
    });
    reply.code(204);
    return null;
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/servers/:id/rotate-credentials', async (request, reply) => {
    const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const { newAgentSecret } = parseOrThrow(
      z.object({ newAgentSecret: z.string().min(24).max(512).optional() }),
      request.body ?? {}
    );
    const secret = newAgentSecret ?? generateSecret(32);
    await storeCredential(pool, getKeyRing(), id, 'agent_secret', secret);
    const rotated = await rotateServerCredentials(pool, getKeyRing(), id);
    await auditRequest(pool, request, auth.userId, {
      action: 'server.credentials_rotated',
      resourceType: 'server',
      resourceId: id,
      metadata: { reEncrypted: rotated },
    });
    reply.code(200);
    // New secret shown exactly once (rotation): the operator updates the agent and the old
    // secret stops working immediately.
    return { agentSecret: secret, reEncryptedEnvelopes: rotated };
  });

  // --- Customer-facing server metadata (spec §25) ------------------------------------------------
  /** Credential metadata only — type, versions, rotation times. Values are never readable. */
  app.get<{ Params: { id: string } }>('/api/v1/admin/servers/:id/credentials', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    const id = parseOrThrow(idSchema, request.params.id);
    const server = await findServerById(pool, id);
    if (!server) throw new NotFoundError('No server was found with that id');
    return { credentials: await listCredentialMetadata(pool, id) };
  });

  app.get('/api/v1/servers', async (request) => {
    await authenticate(request, env, pool);
    const servers = await listServers(pool, { status: 'active' });
    return { servers: servers.map(publicServerDto).filter(Boolean) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/servers/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const server = await findServerById(pool, id);
    if (!server || server.status !== 'active') throw new NotFoundError('No server was found with that id');
    const hasInstallationThere = (await listInstallationsForServer(pool, id)).some(
      (i) => i.customer_id === auth.userId
    );
    if (!hasInstallationThere) {
      // Customers get public metadata for active servers (needed by the wizard), full detail
      // only for servers hosting their own installations.
      return { server: publicServerDto(server) };
    }
    return { server: publicServerDto(server), allocation: await getServerAllocation(pool, id) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/servers/:id/metrics', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const server = await findServerById(pool, id);
    if (!server) throw new NotFoundError('No server was found with that id');
    const mine = (await listInstallationsForServer(pool, id)).some((i) => i.customer_id === auth.userId);
    const user = (await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [auth.userId])).rows[0];
    if (!mine && user?.role !== 'admin' && user?.role !== 'super_admin' && user?.role !== 'staff') {
      throw new NotFoundError('No server was found with that id');
    }
    return { metrics: await listServerMetrics(pool, id) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/servers/:id/health', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const server = await findServerById(pool, id);
    if (!server) throw new NotFoundError('No server was found with that id');
    const latest = (await listServerMetrics(pool, id, 1))[0];
    return {
      status: server.status,
      agent: {
        version: server.agent_version,
        lastSeenAt: server.agent_last_seen_at,
        reachable: server.agent_last_seen_at
          ? Date.now() - new Date(server.agent_last_seen_at).getTime() < 5 * 60_000
          : false,
      },
      latest,
    };
  });

  app.get<{ Params: { id: string } }>('/api/v1/servers/:id/applications', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const server = await findServerById(pool, id);
    if (!server) throw new NotFoundError('No server was found with that id');
    const user = (await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [auth.userId])).rows[0];
    const isStaff = ['admin', 'super_admin', 'staff'].includes(user?.role ?? '');
    const installations = await listInstallationsForServer(pool, id);
    const visible = isStaff ? installations : installations.filter((i) => i.customer_id === auth.userId);
    return { installations: visible };
  });

  // Metrics retention trim (admin utility — normally called by the monitoring worker loop).
  app.post('/api/v1/admin/servers/trim-metrics', async (request) => {
    await requireRole(request, env, pool, ['admin', 'super_admin']);
    await trimServerMetrics(pool);
    return { ok: true };
  });
}
