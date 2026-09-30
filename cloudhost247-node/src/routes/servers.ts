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
import { createHash, randomUUID } from 'node:crypto';
import { createServerOrder } from '../services/server-order-service';
import {
  enqueueServerProvisioningJob,
  findOwnedCustomerServer,
  findCustomerServerById,
  findProvisioningJobById,
  listCustomerServers,
} from '../db/server-provisioning';
import { ImageResolutionError, resolveReinstallTarget } from '../infrastructure/services/image-resolver';
import { findProviderById } from '../db/infrastructure-providers';
import { createInfrastructureProviderAdapter } from '../infrastructure/providers/registry';
import { providerErrorToHttpError } from '../infrastructure/providers/error-mapping';

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

const orderServerSchema = z.object({
  planId: z.string().uuid(),
  billingPeriod: z.enum(['one_time','monthly','quarterly','semi_annually','annually']),
  providerId: z.string().uuid(),
  regionId: z.string().uuid(),
  datacenterId: z.string().uuid().nullable().optional(),
  operatingSystemVersionId: z.string().uuid(),
  architecture: z.enum(['x86_64','arm64']),
  serverType: z.enum(['VPS','DEDICATED','CLOUD']),
  sshKeyIds: z.array(z.string().uuid()).min(1).max(20),
  hostname: z.string().min(1).max(253),
  controlPanelId: z.string().uuid().nullable().optional(),
});

const reinstallServerSchema = z.object({
  operatingSystemVersionId: z.string().uuid(),
  architecture: z.enum(['x86_64','arm64']),
  confirmation: z.literal('REINSTALL'),
});

const resizeServerSchema = z.object({
  targetPlanId: z.string().uuid().optional(),
  planMetadata: z.record(z.unknown()).optional(),
});

const createSnapshotSchema = z.object({
  description: z.string().min(1).max(255).optional(),
});

const sshKeySchema = z.object({
  name: z.string().min(1).max(160),
  publicKey: z.string().min(40).max(16_384).regex(/^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/=]+(?:\s+.*)?$/, 'Enter a valid OpenSSH public key'),
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

  // --- Customer server ordering -----------------------------------------------------------------
  app.get('/api/v1/ssh-keys', async (request) => {
    const auth = await authenticate(request,env,pool);
    const { rows } = await pool.query(
      `SELECT id,name,fingerprint,created_at FROM customer_ssh_keys WHERE user_id=$1 ORDER BY created_at DESC`,
      [auth.userId]
    );
    return { sshKeys: rows };
  });

  app.post('/api/v1/ssh-keys', async (request,reply) => {
    const auth = await authenticate(request,env,pool);
    const input = parseOrThrow(sshKeySchema,request.body);
    const normalized = input.publicKey.trim().replace(/\s+/g,' ');
    const fingerprint = `SHA256:${createHash('sha256').update(normalized).digest('base64url')}`;
    const keyId = randomUUID();
    await pool.query(
      `INSERT INTO customer_ssh_keys (id,user_id,name,fingerprint,public_key) VALUES ($1,$2,$3,$4,$5)`,
      [keyId,auth.userId,input.name,fingerprint,normalized]
    );
    await auditRequest(pool,request,auth.userId,{ action: 'SSH_KEY_ADDED',resourceType: 'ssh_key',resourceId: keyId });
    reply.code(201);
    return { sshKey: { id: keyId,name: input.name,fingerprint } };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/ssh-keys/:id', async (request,reply) => {
    const auth = await authenticate(request,env,pool);
    const keyId = parseOrThrow(idSchema,request.params.id);
    const { rows } = await pool.query(`DELETE FROM customer_ssh_keys WHERE id=$1 AND user_id=$2 RETURNING id`,[keyId,auth.userId]);
    if (!rows[0]) throw new NotFoundError('No SSH key was found with that id');
    await auditRequest(pool,request,auth.userId,{ action: 'SSH_KEY_DELETED',resourceType: 'ssh_key',resourceId: keyId });
    reply.code(204); return null;
  });

  app.post('/api/v1/servers', async (request,reply) => {
    const auth = await authenticate(request,env,pool);
    const input = parseOrThrow(orderServerSchema,request.body);
    const result = await createServerOrder(pool,auth.userId,input);
    await auditRequest(pool,request,auth.userId,{
      action: 'SERVER_ORDER_CREATED',resourceType: 'server',resourceId: result.serverId,
      metadata: { orderId: result.orderId,provisioningStatus: result.provisioningStatus },
    });
    reply.code(201);
    return result;
  });

  app.get('/api/v1/servers', async (request) => {
    // Platform deployment targets were public before customer compute was added and remain public
    // scheduling metadata. Customer inventory is returned only after full authentication.
    const auth = request.headers.authorization?.startsWith('Bearer ')
      ? await authenticate(request,env,pool)
      : null;
    const [owned,targets] = await Promise.all([
      auth ? listCustomerServers(pool,auth.userId) : Promise.resolve([]),
      listServers(pool,{ status: 'active' }),
    ]);
    return {
      servers: owned,
      deploymentTargets: targets.filter((server) => !server.customer_id).map(publicServerDto).filter(Boolean),
    };
  });

  app.get<{ Params: { id: string } }>('/api/v1/servers/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const serverId = parseOrThrow(idSchema, request.params.id);
    const owned = await findOwnedCustomerServer(pool,serverId,auth.userId);
    if (owned) return { server: owned };

    const server = await findServerById(pool, serverId);
    if (!server || server.customer_id || server.status !== 'active') throw new NotFoundError('No server was found with that id');
    const hasInstallationThere = (await listInstallationsForServer(pool, serverId)).some(
      (i) => i.customer_id === auth.userId
    );
    // Non-owned platform targets expose only the same public scheduling metadata the app wizard
    // needs. Hostname, provider resource id, IP and credentials stay hidden.
    return hasInstallationThere
      ? { server: publicServerDto(server),allocation: await getServerAllocation(pool,serverId) }
      : { server: publicServerDto(server) };
  });

  function requestIdempotencyKey(request: { headers: Record<string,string | string[] | undefined> },serverId: string,action: string): string {
    const raw = request.headers['idempotency-key'];
    const supplied = Array.isArray(raw) ? raw[0] : raw;
    if (supplied && !/^[A-Za-z0-9._:-]{8,120}$/.test(supplied)) throw new ValidationError('Idempotency-Key must be 8-120 safe characters');
    const digest = createHash('sha256').update(`${serverId}:${action}:${supplied ?? randomUUID()}`).digest('hex');
    return `srv-act:${serverId.slice(0, 8)}:${action.slice(0, 16)}:${digest}`;
  }

  async function queueOwnedAction(
    request: Parameters<typeof authenticate>[0],
    serverId: string,
    operation: 'START'|'STOP'|'REBOOT'|'SHUTDOWN'|'RESCUE'|'DELETE'
  ) {
    const auth = await authenticate(request,env,pool);
    const server = await findOwnedCustomerServer(pool,serverId,auth.userId);
    if (!server || !server.provider_id) throw new NotFoundError('No server was found with that id');
    const capability = operation.toLowerCase();
    if (server.capabilities?.[capability] !== true) throw new ValidationError(`${operation} is not supported for this server`);
    if (!server.provider_server_id) throw new ConflictError('The server has not been created at the provider yet');
    const result = await enqueueServerProvisioningJob(pool,{
      serverId: server.id,providerId: server.provider_id,osImageId: server.os_image_id,
      operation,requestedBy: auth.userId,idempotencyKey: requestIdempotencyKey(request,server.id,operation),
    });
    await auditRequest(pool,request,auth.userId,{ action: `SERVER_${operation}_QUEUED`,resourceType: 'server',resourceId: server.id,metadata: { jobId: result.job.id } });
    return { jobId: result.job.id,status: result.job.status,queued: result.created };
  }

  for (const [path,operation] of Object.entries({
    start: 'START',
    'power-on': 'START',
    stop: 'STOP',
    'power-off': 'SHUTDOWN',
    reboot: 'REBOOT',
    shutdown: 'SHUTDOWN',
    rescue: 'RESCUE',
  }) as Array<[string,'START'|'STOP'|'REBOOT'|'SHUTDOWN'|'RESCUE']>) {
    app.post<{ Params: { id: string } }>(`/api/v1/servers/:id/${path}`,async (request) =>
      queueOwnedAction(request,parseOrThrow(idSchema,request.params.id),operation)
    );
  }

  app.post<{ Params: { id: string } }>('/api/v1/servers/:id/resize', async (request) => {
    const auth = await authenticate(request, env, pool);
    const serverId = parseOrThrow(idSchema, request.params.id);
    const input = parseOrThrow(resizeServerSchema, request.body ?? {});
    const server = await findOwnedCustomerServer(pool, serverId, auth.userId);
    if (!server || !server.provider_id) throw new NotFoundError('No server was found with that id');
    if (!server.provider_server_id) throw new ConflictError('The server has not been created at the provider yet');
    const result = await enqueueServerProvisioningJob(pool, {
      serverId: server.id,
      providerId: server.provider_id,
      osImageId: server.os_image_id,
      operation: 'RESIZE',
      requestedBy: auth.userId,
      idempotencyKey: requestIdempotencyKey(request, server.id, 'RESIZE'),
      payload: { planMetadata: input.planMetadata ?? {}, targetPlanId: input.targetPlanId },
    });
    await auditRequest(pool, request, auth.userId, { action: 'SERVER_RESIZE_QUEUED', resourceType: 'server', resourceId: server.id, metadata: { jobId: result.job.id } });
    return { jobId: result.job.id, status: result.job.status, queued: result.created };
  });

  app.post<{ Params: { id: string } }>('/api/v1/servers/:id/snapshots', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const serverId = parseOrThrow(idSchema, request.params.id);
    const input = parseOrThrow(createSnapshotSchema, request.body ?? {});
    const server = await findOwnedCustomerServer(pool, serverId, auth.userId);
    if (!server || !server.provider_id) throw new NotFoundError('No server was found with that id');
    if (!server.provider_server_id) throw new ConflictError('The server has not been created at the provider yet');
    const result = await enqueueServerProvisioningJob(pool, {
      serverId: server.id,
      providerId: server.provider_id,
      osImageId: server.os_image_id,
      operation: 'SNAPSHOT_CREATE',
      requestedBy: auth.userId,
      idempotencyKey: requestIdempotencyKey(request, server.id, 'SNAPSHOT_CREATE'),
      payload: { description: input.description },
    });
    await auditRequest(pool, request, auth.userId, { action: 'SERVER_SNAPSHOT_CREATE_QUEUED', resourceType: 'server', resourceId: server.id, metadata: { jobId: result.job.id } });
    reply.code(202);
    return { jobId: result.job.id, status: result.job.status, queued: result.created };
  });

  app.delete<{ Params: { id: string; snapshotId: string } }>('/api/v1/servers/:id/snapshots/:snapshotId', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const serverId = parseOrThrow(idSchema, request.params.id);
    const snapshotId = parseOrThrow(z.string().min(1).max(255), request.params.snapshotId);
    const server = await findOwnedCustomerServer(pool, serverId, auth.userId);
    if (!server || !server.provider_id) throw new NotFoundError('No server was found with that id');
    if (!server.provider_server_id) throw new ConflictError('The server has not been created at the provider yet');
    const result = await enqueueServerProvisioningJob(pool, {
      serverId: server.id,
      providerId: server.provider_id,
      osImageId: server.os_image_id,
      operation: 'SNAPSHOT_DELETE',
      requestedBy: auth.userId,
      idempotencyKey: requestIdempotencyKey(request, server.id, `SNAPSHOT_DELETE:${snapshotId}`),
      payload: { snapshotId },
    });
    await auditRequest(pool, request, auth.userId, { action: 'SERVER_SNAPSHOT_DELETE_QUEUED', resourceType: 'server', resourceId: server.id, metadata: { jobId: result.job.id, snapshotId } });
    reply.code(202);
    return { jobId: result.job.id, status: result.job.status, queued: result.created };
  });

  app.post<{ Params: { id: string; snapshotId: string } }>('/api/v1/servers/:id/snapshots/:snapshotId/restore', async (request) => {
    const auth = await authenticate(request, env, pool);
    const serverId = parseOrThrow(idSchema, request.params.id);
    const snapshotId = parseOrThrow(z.string().min(1).max(255), request.params.snapshotId);
    const server = await findOwnedCustomerServer(pool, serverId, auth.userId);
    if (!server || !server.provider_id) throw new NotFoundError('No server was found with that id');
    if (!server.provider_server_id) throw new ConflictError('The server has not been created at the provider yet');
    const result = await enqueueServerProvisioningJob(pool, {
      serverId: server.id,
      providerId: server.provider_id,
      osImageId: server.os_image_id,
      operation: 'SNAPSHOT_RESTORE',
      requestedBy: auth.userId,
      idempotencyKey: requestIdempotencyKey(request, server.id, `SNAPSHOT_RESTORE:${snapshotId}`),
      payload: { snapshotId },
    });
    await auditRequest(pool, request, auth.userId, { action: 'SERVER_SNAPSHOT_RESTORE_QUEUED', resourceType: 'server', resourceId: server.id, metadata: { jobId: result.job.id, snapshotId } });
    return { jobId: result.job.id, status: result.job.status, queued: result.created };
  });

  app.post<{ Params: { id: string } }>('/api/v1/servers/:id/reinstall',async (request) => {
    const auth = await authenticate(request,env,pool);
    const serverId = parseOrThrow(idSchema,request.params.id);
    const input = parseOrThrow(reinstallServerSchema,request.body);
    const server = await findOwnedCustomerServer(pool,serverId,auth.userId);
    if (!server || !server.plan_id || !server.provider_id || !server.region_id) throw new NotFoundError('No server was found with that id');
    if (server.capabilities?.reinstall !== true) throw new ValidationError('OS reinstall is not supported for this server');
    if (!server.provider_server_id || !['active','stopped','error'].includes(server.status)) throw new ConflictError('This server cannot be reinstalled in its current state');
    // The target OS is re-resolved server-side through the shared image resolver: the client's
    // selection is only a pair of catalog ids, never a provider image reference.
    let configuration;
    try {
      configuration = await resolveReinstallTarget(pool,{
        planId: server.plan_id,providerId: server.provider_id,regionId: server.region_id,
        datacenterId: server.datacenter_id,operatingSystemVersionId: input.operatingSystemVersionId,
        architecture: input.architecture,serverType: server.server_type,
      });
    } catch (error) {
      if (error instanceof ImageResolutionError) throw new ValidationError(error.message);
      throw error;
    }
    const result = await enqueueServerProvisioningJob(pool,{
      serverId: server.id,providerId: server.provider_id,osImageId: configuration.image_id,
      operation: 'REINSTALL',requestedBy: auth.userId,
      idempotencyKey: requestIdempotencyKey(request,server.id,'REINSTALL'),
      payload: { targetOperatingSystemVersionId: input.operatingSystemVersionId,targetArchitecture: input.architecture },
    });
    await auditRequest(pool,request,auth.userId,{ action: 'SERVER_REINSTALL_STARTED',resourceType: 'server',resourceId: server.id,metadata: { jobId: result.job.id,targetVersionId: input.operatingSystemVersionId } });
    return { jobId: result.job.id,status: result.job.status,queued: result.created };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/servers/:id',async (request) => {
    return queueOwnedAction(request,parseOrThrow(idSchema,request.params.id),'DELETE');
  });

  app.get<{ Params: { id: string } }>('/api/v1/servers/:id/status',async (request) => {
    const auth = await authenticate(request,env,pool);
    const server = await findOwnedCustomerServer(pool,parseOrThrow(idSchema,request.params.id),auth.userId);
    if (!server) throw new NotFoundError('No server was found with that id');
    return { id: server.id,status: server.status,provisioningStatus: server.provisioning_status,ipAddress: server.ip_address };
  });

  app.get<{ Params: { id: string } }>('/api/v1/servers/:id/provisioning-status',async (request) => {
    const auth = await authenticate(request,env,pool);
    const serverId = parseOrThrow(idSchema,request.params.id);
    const server = await findOwnedCustomerServer(pool,serverId,auth.userId);
    if (!server) throw new NotFoundError('No server was found with that id');
    const { rows } = await pool.query(`SELECT id,status,attempts,max_attempts,error_code,error_message,started_at,completed_at,created_at FROM provisioning_jobs WHERE server_id=$1 ORDER BY created_at DESC LIMIT 1`,[serverId]);
    return { server: { status: server.status,provisioningStatus: server.provisioning_status },job: rows[0] ?? null };
  });

  app.get<{ Params: { id: string } }>('/api/v1/servers/:id/logs',async (request) => {
    const auth = await authenticate(request,env,pool);
    const serverId = parseOrThrow(idSchema,request.params.id);
    if (!await findOwnedCustomerServer(pool,serverId,auth.userId)) throw new NotFoundError('No server was found with that id');
    const { rows } = await pool.query(`SELECT id,status,operation,logs,error_code,error_message,created_at FROM provisioning_jobs WHERE server_id=$1 ORDER BY created_at DESC LIMIT 20`,[serverId]);
    return { jobs: rows };
  });

  /**
   * Issues a provider console session for the owner of the server (spec §24).
   *
   * This is the one server action that cannot be queued: a console session is a short-lived
   * credential that is only useful in the browser that asked for it. It is still ownership- and
   * capability-checked, audited, and fails closed — a provider that is not configured returns an
   * explicit 503 rather than a fabricated console URL. The session payload is returned to the
   * owner only and never written to a log or an audit record.
   */
  app.post<{ Params: { id: string } }>('/api/v1/servers/:id/console', async (request) => {
    const auth = await authenticate(request, env, pool);
    const serverId = parseOrThrow(idSchema, request.params.id);
    const server = await findOwnedCustomerServer(pool, serverId, auth.userId);
    if (!server || !server.provider_id) throw new NotFoundError('No server was found with that id');
    if (server.capabilities?.console !== true) throw new ValidationError('Console access is not supported for this server');
    if (!server.provider_server_id) throw new ConflictError('The server has not been created at the provider yet');
    const provider = await findProviderById(pool, server.provider_id);
    if (!provider || provider.status !== 'ACTIVE') {
      throw new ValidationError('The infrastructure provider for this server is not active');
    }
    let session: Record<string, unknown>;
    try {
      const adapter = createInfrastructureProviderAdapter(provider);
      session = await adapter.getConsole(server.provider_server_id);
    } catch (error) {
      // The provider message can name internal endpoints, so it stays in the server log.
      request.log.warn({ serverId: server.id, providerId: provider.id, err: error }, 'console session failed');
      throw providerErrorToHttpError(error);
    }
    await auditRequest(pool, request, auth.userId, {
      action: 'SERVER_CONSOLE_OPENED', resourceType: 'server', resourceId: server.id,
      // Deliberately no session payload: the audit trail records that access happened, not the credential.
      metadata: { providerId: provider.id },
    });
    return { console: session };
  });

  app.get<{ Params: { id: string } }>('/api/v1/servers/:id/metrics', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const server = await findServerById(pool, id);
    if (!server) throw new NotFoundError('No server was found with that id');
    const mine = server.customer_id === auth.userId || (await listInstallationsForServer(pool, id)).some((i) => i.customer_id === auth.userId);
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
    const mine = server.customer_id === auth.userId || (await listInstallationsForServer(pool,id)).some((item) => item.customer_id === auth.userId);
    const user = (await pool.query<{ role: string }>(`SELECT role FROM users WHERE id=$1`,[auth.userId])).rows[0];
    if (!mine && !['admin','super_admin','staff'].includes(user?.role ?? '')) throw new NotFoundError('No server was found with that id');
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
