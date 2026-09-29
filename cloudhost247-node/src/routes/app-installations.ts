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
import { enqueueDeployment, listDeployments } from '../db/deployments';
import { listEnvironmentKeys, upsertEnvironmentEntry, deleteEnvironmentEntry } from '../db/application-config';
import { listBackupsForInstallation, findBackupById } from '../db/ops-tables';
import { listDomainsForInstallation, attachDomainToInstallation, detachDomainFromInstallation, findDomainById } from '../db/customer-domains';
import { getKeyRing } from '../lib/keyring';
import { applicationLogs as fetchLogs } from '../services/instance-operations';

const idSchema = z.string().uuid('id must be a valid UUID');

const createInstallationSchema = z.object({
  applicationId: z.string().min(1).max(160),
  versionId: z.string().uuid().optional(),
  serverId: z.string().uuid().optional(),
  name: z.string().min(1).max(160).optional(),
  domain: z.string().max(253).nullable().optional(),
  planId: z.string().uuid().optional(),
  billingPeriod: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']).optional(),
  environment: z.record(z.string().max(2000)).optional(),
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

export async function registerAppInstallationRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.post('/api/v1/app-installations', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(createInstallationSchema, request.body);
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

  app.get('/api/v1/app-installations', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { installations: await listMyInstallations(pool, auth.userId) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/app-installations/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    return await getMyInstallationDetail(pool, auth.userId, id);
  });

  // --- Lifecycle actions: each enqueues an idempotent deployment job ----------------------------
  const action = (
    path: string,
    actionName: 'start' | 'stop' | 'restart' | 'update' | 'backup' | 'restore' | 'reinstall',
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

  app.delete<{ Params: { id: string } }>('/api/v1/app-installations/:id', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    if (['deleting', 'deleted'].includes(installation.status)) {
      reply.code(204);
      return null;
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
    const tail = parseOrThrow(z.object({ tail: z.coerce.number().int().min(10).max(1000).optional() }), request.query ?? {});
    return await fetchLogs(pool, env, installation, tail.tail ?? 200);
  });

  app.get<{ Params: { id: string } }>('/api/v1/app-installations/:id/backups', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const installation = await myInstallationOrThrow(pool, auth.userId, id);
    return { backups: await listBackupsForInstallation(pool, installation.id) };
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
