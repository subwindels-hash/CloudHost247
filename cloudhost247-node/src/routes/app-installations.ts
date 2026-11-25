/**
 * Phase 6 — customer application installation API (spec §23).
 *
 * POST /api/v1/app-installations creates the installation + unpaid order and returns payment
 * instructions. It does NOT deploy anything synchronously — deployment happens exclusively via
 * the paid-order provisioning hook (spec §20, §23: "This endpoint must create a deployment job.
 * It must NOT perform the entire deployment synchronously").
 *
 * Action endpoints (start/stop/restart/update/backup/restore/uninstall) enqueue idempotent
 * deployment jobs; every one is ownership-checked (404, never 403) and status-guarded.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import { createInstallationRequest, getMyInstallationDetail, listMyInstallations } from '../services/installation-service';
import { findInstallationById, listInstallationsForCustomer } from '../db/application-installations';
import { findServerById, getServerAllocation } from '../db/servers';
import { findApplicationBySlug, findApplicationVersionById } from '../db/applications';
import { findOwnedCustomerServer } from '../db/server-provisioning';
import { deploymentCapabilities, type InstallationOperation } from '../deployments/capabilities';
import { validateManifest, type ApplicationManifest } from '../marketplace/manifest-schema';
import { enqueueDeployment, listDeployments } from '../db/deployments';
import { listEnvironmentKeys, upsertEnvironmentEntry, deleteEnvironmentEntry } from '../db/application-config';
import { listBackupsForInstallation, findBackupById } from '../db/ops-tables';
import { listDomainsForInstallation, attachDomainToInstallation, detachDomainFromInstallation, findDomainById } from '../db/customer-domains';
import { getKeyRing } from '../lib/keyring';
import { applicationLogs as fetchLogs } from '../services/instance-operations';

const idSchema = z.string().uuid('id must be a valid UUID');
const installationCapabilitySchema = z.object({
  applicationId: z.string().min(1).max(160),
  versionId: z.string().uuid(),
  serverId: z.string().uuid(),
});

const createInstallationSchema = z.object({
  applicationId: z.string().min(1).max(160),
  versionId: z.string().uuid().optional(),
  serverId: z.string().uuid().optional(),
  name: z.string().min(1).max(160).optional(),
  domain: z.string().max(253).nullable().optional(),
  planId: z.string().uuid().optional(),
  billingPeriod: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']).optional(),
  environment: z.record(z.string(), z.string().max(2000)).optional(),
  backupEnabled: z.boolean().optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/** Ownership-checked installation fetch — indistinguishable 404 for other customers' rows. */
async function myInstallationOrThrow(pool: Queryable, userId: string, installationId: string) {
  const installation = await findInstallationById(pool, installationId);
  if (!installation || installation.customer_id !== userId) {
    throw new NotFoundError('No installation was found with that id');
  }
  return installation;
}

async function installableServerOrThrow(pool: Queryable, userId: string, serverId: string) {
  const server = await findServerById(pool, serverId);
  if (!server || server.status !== 'active') {
    throw new NotFoundError('No active deployment server was found with that id');
  }
  // Platform targets are shared scheduling inventory (customer_id = null). Customer-owned
  // servers may only be used by their owner; a guessed UUID must not cross tenant boundaries.
  if (server.customer_id !== null) {
    const owned = server.customer_id === userId
      ? await findOwnedCustomerServer(pool, serverId, userId)
      : null;
    if (!owned) throw new NotFoundError('No active deployment server was found with that id');
  }
  return server;
}

async function capabilityForInstallation(pool: Queryable, env: Env, installation: Awaited<ReturnType<typeof myInstallationOrThrow>>) {
  const version = await findApplicationVersionById(pool, installation.application_version_id);
  if (!version) throw new ConflictError('The installation version is missing; operation support cannot be determined.');
  const server = installation.server_id ? await findServerById(pool, installation.server_id) : null;
  if (!server) throw new ConflictError('The installation has no assigned server; operation support cannot be determined.');
  return deploymentCapabilities(server, version.manifest as ApplicationManifest, {
    kubernetesEnabled: env.KUBERNETES_ADAPTER_ENABLED,
    simulationMode: env.DEPLOYMENT_SIMULATION_MODE,
  });
}

export async function registerAppInstallationRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.post('/api/v1/app-installations', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(createInstallationSchema, request.body);
    if (input.serverId) await installableServerOrThrow(pool, auth.userId, input.serverId);
    const result = await createInstallationRequest(pool, auth.userId, {
      applicationIdOrSlug: input.applicationId,
      versionId: input.versionId,
      serverId: input.serverId,
      name: input.name,
      domain: input.domain ?? null,
      planId: input.planId,
      billingPeriod: input.billingPeriod,
      environment: input.environment,
      backupEnabled: input.backupEnabled,
      kubernetesAdapterEnabled: env.KUBERNETES_ADAPTER_ENABLED,
    });
    await auditRequest(pool, request, auth.userId, {
      action: 'installation.requested',
      resourceType: 'application_installation',
      resourceId: result.installationId,
      metadata: { orderId: result.orderId, total: result.totalAmount, paymentRequired: result.paymentRequired },
    });
    reply.code(201);
    return result;
  });

  app.post('/api/v1/app-installations/capabilities', async (request) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(installationCapabilitySchema, request.body);
    const application = await findApplicationBySlug(pool, input.applicationId);
    if (!application || application.status !== 'published') {
      throw new NotFoundError('No published application was found with that identifier');
    }
    const version = await findApplicationVersionById(pool, input.versionId);
    if (!version || version.application_id !== application.id || version.status !== 'published') {
      throw new NotFoundError('No published version was found for that application');
    }
    const server = await installableServerOrThrow(pool, auth.userId, input.serverId);
    const validation = validateManifest(version.manifest);
    if (!validation.valid || !validation.manifest) {
      throw new ConflictError(`The published manifest failed validation: ${validation.errors.join('; ')}`);
    }
    const allocation = await getServerAllocation(pool, server.id);
    const requirements = validation.manifest.requirements;
    const capacityAvailable =
      allocation.cpu + requirements.cpu <= server.cpu_cores
      && allocation.memoryMb + requirements.memory <= server.memory_mb
      && allocation.storageMb + requirements.storage <= server.storage_mb;
    return {
      capabilities: deploymentCapabilities(server, validation.manifest, {
        kubernetesEnabled: env.KUBERNETES_ADAPTER_ENABLED,
        simulationMode: env.DEPLOYMENT_SIMULATION_MODE,
      }),
      capacity: {
        available: capacityAvailable,
        reason: capacityAvailable ? null : 'The selected server does not currently have enough unallocated CPU, memory, or storage for this version.',
      },
    };
  });

  app.get('/api/v1/app-installations', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { installations: await listMyInstallations(pool, auth.userId) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/app-installations/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const detail = await getMyInstallationDetail(pool, auth.userId, id);
    const server = detail.installation.server_id ? await findServerById(pool, detail.installation.server_id) : null;
    const capabilities = detail.version && server
      ? deploymentCapabilities(server, detail.version.manifest as ApplicationManifest, {
          kubernetesEnabled: env.KUBERNETES_ADAPTER_ENABLED,
          simulationMode: env.DEPLOYMENT_SIMULATION_MODE,
        })
      : null;
    return { ...detail, capabilities };
  });

  // --- Lifecycle actions: each enqueues an idempotent deployment job ----------------------------
  const action = (
    path: string,
    actionName: 'start' | 'stop' | 'restart' | 'update' | 'backup' | 'restore' | 'reinstall' | 'healthcheck',
    allowedStatuses: string[],
    extra: (body: unknown) => Record<string, unknown> = () => ({})
  ) => {
    app.post<{ Params: { id: string } }>(`/api/v1/app-installations/:id/${path}`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idSchema, request.params.id);
      const installation = await myInstallationOrThrow(pool, auth.userId, id);

      if (installation.status === 'deleted' || installation.status === 'deleting') {
        throw new ConflictError('This installation is deleted');
      }
      if (!allowedStatuses.includes(installation.status)) {
        throw new ConflictError(`Cannot ${actionName} an installation with status "${installation.status}"`);
      }
      const operation: InstallationOperation = actionName === 'healthcheck' ? 'verify' : actionName;
      const capability = (await capabilityForInstallation(pool, env, installation)).operations[operation];
      if (!capability.supported) {
        throw new ConflictError(`${actionName} is not supported: ${capability.reason ?? 'the selected deployment adapter does not implement this operation'}`);
      }
      let payload: Record<string, unknown> = {};
      if (actionName === 'restore') {
        const { backupId } = parseOrThrow(z.object({ backupId: z.string().uuid() }), request.body);
        const backup = await findBackupById(pool, backupId);
        if (!backup || backup.installation_id !== installation.id || backup.status !== 'completed') {
          throw new NotFoundError('No completed backup was found with that id for this installation');
        }
        payload = { backupId };
      } else if (actionName === 'update') {
        const { versionId } = parseOrThrow(z.object({ versionId: z.string().uuid().optional() }), request.body ?? {});
        payload = versionId ? { versionId } : {};
      } else {
        payload = extra(request.body);
      }

      const { deployment, created } = await enqueueDeployment(pool, {
        installationId: installation.id,
        serverId: installation.server_id,
        action: actionName,
        idempotencyKey: `${actionName}:${installation.id}:${randomUUID()}`,
        requestedBy: auth.userId,
        payload,
      });
      await auditRequest(pool, request, auth.userId, {
        action: `installation.${actionName}`,
        resourceType: 'application_installation',
        resourceId: installation.id,
        metadata: { deploymentId: deployment.id, queued: created },
      });
      reply.code(created ? 202 : 200);
      return { deploymentId: deployment.id, status: deployment.status, queued: created };
    });
  };

  action('start', 'start', ['stopped', 'failed', 'healthy']);
  action('stop', 'stop', ['healthy', 'unhealthy', 'starting', 'failed']);
  action('restart', 'restart', ['healthy', 'unhealthy', 'stopped', 'starting', 'failed']);
  action('update', 'update', ['healthy', 'unhealthy', 'stopped']);
  action('backup', 'backup', ['healthy', 'unhealthy', 'stopped']);
  action('restore', 'restore', ['healthy', 'unhealthy', 'stopped']);
  action('reinstall', 'reinstall', ['failed', 'stopped', 'unhealthy']);
  // Manual verification is a queued health check without the periodic worker's auto-restart side effect.
  action('verify', 'healthcheck', ['healthy', 'unhealthy', 'starting', 'failed'], () => ({ manualVerification: true }));

  app.delete<{ Params: { id: string } }>('/api/v1/app-installations/:id', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    if (['deleting', 'deleted'].includes(installation.status)) {
      reply.code(204);
      return null;
    }
    const uninstallCapability = (await capabilityForInstallation(pool, env, installation)).operations.uninstall;
    if (!uninstallCapability.supported) {
      throw new ConflictError(`uninstall is not supported: ${uninstallCapability.reason ?? 'the selected deployment adapter does not implement this operation'}`);
    }
    const { deployment, created } = await enqueueDeployment(pool, {
      installationId: installation.id,
      serverId: installation.server_id,
      action: 'uninstall',
      idempotencyKey: `uninstall:${installation.id}:${Date.now()}`,
      requestedBy: auth.userId,
    });
    await pool.query(
      `UPDATE application_installations SET status = 'deleting', updated_at = now() WHERE id = $1`,
      [installation.id]
    );
    await auditRequest(pool, request, auth.userId, {
      action: 'installation.uninstall_requested',
      resourceType: 'application_installation',
      resourceId: installation.id,
      metadata: { deploymentId: deployment.id, queued: created },
    });
    reply.code(202);
    return { deploymentId: deployment.id, status: 'deleting' };
  });

  // --- Sub-resources ------------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/v1/app-installations/:id/deployments', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    return { deployments: await listDeployments(pool, { installationId: installation.id, limit: 50 }) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/app-installations/:id/logs', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    const capability = (await capabilityForInstallation(pool, env, installation)).operations.logs;
    if (!capability.supported) {
      return { logs: '', available: false, message: capability.reason };
    }
    const tail = parseOrThrow(z.object({ tail: z.coerce.number().int().min(10).max(1000).optional() }), request.query ?? {});
    return await fetchLogs(pool, env, installation, tail.tail ?? 200);
  });

  app.get<{ Params: { id: string } }>('/api/v1/app-installations/:id/backups', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    const capabilities = (await capabilityForInstallation(pool, env, installation)).operations;
    return {
      backups: await listBackupsForInstallation(pool, installation.id),
      backupSupported: capabilities.backup.supported,
      restoreSupported: capabilities.restore.supported,
      reason: capabilities.backup.supported ? capabilities.restore.reason : capabilities.backup.reason,
    };
  });

  // Environment: keys only — values (secret or not) never leave the server (spec §16).
  app.get<{ Params: { id: string } }>('/api/v1/app-installations/:id/environment', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    return { environment: await listEnvironmentKeys(pool, installation.id) };
  });

  app.put<{ Params: { id: string } }>('/api/v1/app-installations/:id/environment', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    const { key, value, isSecret } = parseOrThrow(
      z.object({
        key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'key must be UPPER_SNAKE_CASE').max(255),
        value: z.string().max(2000),
        isSecret: z.boolean().default(true),
      }),
      request.body
    );
    await upsertEnvironmentEntry(pool, getKeyRing(), installation.id, key, value, isSecret ?? true);
    await auditRequest(pool, request, auth.userId, {
      action: 'installation.environment_set',
      resourceType: 'application_installation',
      resourceId: installation.id,
      metadata: { key },
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/app-installations/:id/environment/:key', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    const key = parseOrThrow(z.string().max(255), (request.params as unknown as { key: string }).key);
    await deleteEnvironmentEntry(pool, installation.id, key);
    reply.code(204);
    return null;
  });

  // Domains: attach/detach the customer's verified domains (spec §15).
  app.get<{ Params: { id: string } }>('/api/v1/app-installations/:id/domains', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    return { domains: await listDomainsForInstallation(pool, installation.id) };
  });

  app.post<{ Params: { id: string } }>('/api/v1/app-installations/:id/domains', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    const { domainId, primary } = parseOrThrow(
      z.object({ domainId: z.string().uuid(), primary: z.boolean().default(true) }),
      request.body
    );
    const domain = await findDomainById(pool, domainId);
    if (!domain || domain.user_id !== auth.userId) {
      throw new NotFoundError('No domain was found with that id');
    }
    if (domain.verification_status !== 'verified') {
      throw new ConflictError('Verify the domain before attaching it to an application');
    }
    const isPrimary = primary ?? true;
    await attachDomainToInstallation(pool, installation.id, domain.id, isPrimary);
    if (isPrimary) {
      await pool.query(
        `UPDATE application_installations SET domain = $2, updated_at = now() WHERE id = $1`,
        [installation.id, domain.domain_name]
      );
    }
    await auditRequest(pool, request, auth.userId, {
      action: 'installation.domain_attached',
      resourceType: 'application_installation',
      resourceId: installation.id,
      metadata: { domainId: domain.id, primary: isPrimary },
    });
    reply.code(201);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; domainId: string } }>('/api/v1/app-installations/:id/domains/:domainId', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    const domainId = parseOrThrow(idSchema, (request.params as unknown as { domainId: string }).domainId);
    await detachDomainFromInstallation(pool, installation.id, domainId);
    reply.code(204);
    return null;
  });

  // Reference list for the wizard (server selection): the customer's own usable installations
  // plus their servers' public metadata is exposed via /api/v1/servers.
  app.get('/api/v1/app-installations/summary', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { installations: await listInstallationsForCustomer(pool, auth.userId) };
  });
}
