import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import {
  listProvisioningJobs,
  findProvisioningJobById,
  retryProvisioningJob,
  cancelProvisioningJob,
  findCustomerServerById,
} from '../db/server-provisioning';
import { listDeploymentSteps, listDeploymentEvents } from '../db/deployments';

const idParamSchema = z.string().uuid('id must be a valid UUID');

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

export async function registerProvisioningRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  const registerHandlers = (prefix: string) => {
    /**
     * List provisioning jobs.
     */
    app.get(`${prefix}/provisioning/jobs`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const isStaff = auth.role === 'admin' || auth.role === 'super_admin' || auth.role === 'staff';

      const query = request.query as { status?: string; serverId?: string; limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 50;

      if (!isStaff) {
        // A server id is not an authorization boundary: resolve it and verify ownership before
        // allowing a customer to inspect its infrastructure history.
        if (!query.serverId) throw new ValidationError('serverId is required');
        const serverId = parseOrThrow(idParamSchema, query.serverId);
        const server = await findCustomerServerById(pool, serverId);
        if (!server || server.customer_id !== auth.userId) {
          // Deliberately avoid revealing whether another customer's server exists.
          throw new NotFoundError('Server not found');
        }
      }

      const jobs = await listProvisioningJobs(pool, {
        status: query.status,
        serverId: query.serverId,
        limit,
      });

      return { jobs };
    });

    /**
     * Get single provisioning job details with step breakdown and progress events.
     */
    app.get<{ Params: { id: string } }>(`${prefix}/provisioning/jobs/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idParamSchema, request.params.id);

      const job = await findProvisioningJobById(pool, id);
      if (!job) throw new NotFoundError('Provisioning job not found');
      const isStaff = auth.role === 'admin' || auth.role === 'super_admin' || auth.role === 'staff';
      if (!isStaff) {
        const server = await findCustomerServerById(pool, job.server_id);
        if (!server || server.customer_id !== auth.userId) {
          throw new NotFoundError('Provisioning job not found');
        }
      }

      const [steps, events] = await Promise.all([
        listDeploymentSteps(pool, job.deployment_id),
        listDeploymentEvents(pool, job.deployment_id),
      ]);

      return { job, steps, events };
    });

    /**
     * Retry a failed provisioning job.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/provisioning/jobs/:id/retry`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idParamSchema, request.params.id);

      const retried = await retryProvisioningJob(pool, id);
      if (!retried) {
        throw new ConflictError('Only retryable failed jobs can be retried');
      }

      await auditRequest(pool, request, auth.userId, {
        action: 'PROVISIONING_JOB_RETRIED',
        resourceType: 'provisioning_job',
        resourceId: id,
      });

      return { queued: true, message: 'Provisioning job queued for retry' };
    });

    /**
     * Cancel a queued provisioning job.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/provisioning/jobs/:id/cancel`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idParamSchema, request.params.id);

      const cancelled = await cancelProvisioningJob(pool, id);
      if (!cancelled) {
        throw new ConflictError('Only queued jobs can be cancelled');
      }

      await auditRequest(pool, request, auth.userId, {
        action: 'PROVISIONING_JOB_CANCELLED',
        resourceType: 'provisioning_job',
        resourceId: id,
      });

      return { cancelled: true, message: 'Provisioning job cancelled' };
    });
  };

  registerHandlers('/api/v1');
  registerHandlers('/api');
}
