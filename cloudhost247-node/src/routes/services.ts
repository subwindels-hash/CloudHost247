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
  listServicesForUser,
  listAllServices,
  findServiceById,
  createCustomerService,
  updateCustomerService,
  suspendService,
  unsuspendService,
  terminateService,
} from '../db/customer-services';
import { toCustomerServiceDTO, toAdminCustomerServiceDTO } from '../dto/account';
import { findCustomerServerById, enqueueServerProvisioningJob } from '../db/server-provisioning';
import { createServerOrder } from '../services/server-order-service';

const idParamSchema = z.string().uuid('id must be a valid UUID');

const createServiceSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid().nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  serverId: z.string().uuid().nullable().optional(),
  controlPanelId: z.string().uuid().nullable().optional(),
  licenseId: z.string().uuid().nullable().optional(),
  domain: z.string().max(255).nullable().optional(),
  hostname: z.string().max(255).nullable().optional(),
  username: z.string().max(64).nullable().optional(),
  label: z.string().min(1).max(255),
  status: z.enum(['active', 'pending', 'provisioning', 'suspended', 'cancelled', 'terminated', 'pending_migration', 'degraded']).optional(),
  billingCycle: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']).optional(),
  amount: z.coerce.number().min(0).max(100000).optional(),
  currency: z.string().length(3).optional(),
  nextDueDate: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  externalReference: z.string().max(255).nullable().optional(),
});

const patchServiceSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  status: z.enum(['active', 'pending', 'provisioning', 'suspended', 'cancelled', 'terminated', 'pending_migration', 'degraded']).optional(),
  domain: z.string().max(255).nullable().optional(),
  hostname: z.string().max(255).nullable().optional(),
  username: z.string().max(64).nullable().optional(),
  serverId: z.string().uuid().nullable().optional(),
  controlPanelId: z.string().uuid().nullable().optional(),
  licenseId: z.string().uuid().nullable().optional(),
  billingCycle: z.enum(['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually']).optional(),
  amount: z.coerce.number().min(0).max(100000).optional(),
  currency: z.string().length(3).optional(),
  nextDueDate: z.string().datetime().nullable().optional(),
  suspensionDate: z.string().datetime().nullable().optional(),
  terminationDate: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  externalReference: z.string().max(255).nullable().optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

export async function registerServicesRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  const registerHandlers = (prefix: string) => {
    /**
     * List services:
     * - Staff/Admin gets all services (with optional filters).
     * - Customer gets only their own services.
     */
    app.get(`${prefix}/services`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const isStaff = auth.role === 'admin' || auth.role === 'super_admin' || auth.role === 'staff';

      if (isStaff) {
        const query = request.query as { status?: string; search?: string; serverId?: string; panelId?: string };
        const rows = await listAllServices(pool, query);
        return { services: rows.map(toAdminCustomerServiceDTO) };
      }

      const rows = await listServicesForUser(pool, auth.userId);
      return { services: rows.map(toCustomerServiceDTO) };
    });

    /**
     * Get single service detail.
     */
    app.get<{ Params: { id: string } }>(`${prefix}/services/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idParamSchema, request.params.id);
      const isStaff = auth.role === 'admin' || auth.role === 'super_admin' || auth.role === 'staff';

      const service = await findServiceById(pool, id);
      if (!service || (!isStaff && service.user_id !== auth.userId && service.customer_id !== auth.userId)) {
        throw new NotFoundError('Service not found');
      }

      return {
        service: isStaff ? toAdminCustomerServiceDTO(service) : toCustomerServiceDTO(service),
      };
    });

    /**
     * Create service (Admin / Staff only).
     */
    app.post(`${prefix}/services`, async (request, reply) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const input = parseOrThrow(createServiceSchema, request.body);

      const service = await createCustomerService(pool, {
        userId: input.customerId,
        customerId: input.customerId,
        productId: input.productId,
        planId: input.planId,
        serverId: input.serverId,
        controlPanelId: input.controlPanelId,
        licenseId: input.licenseId,
        domain: input.domain,
        hostname: input.hostname,
        username: input.username,
        label: input.label,
        status: input.status ?? 'active',
        billingCycle: input.billingCycle ?? 'monthly',
        amount: input.amount ?? 0.0,
        currency: input.currency ?? 'USD',
        nextDueDate: input.nextDueDate,
        notes: input.notes,
        externalReference: input.externalReference,
        createdBy: auth.userId,
      });

      await auditRequest(pool, request, auth.userId, {
        action: 'SERVICE_CREATED',
        resourceType: 'service',
        resourceId: service.id,
        metadata: { customerId: input.customerId, label: input.label },
      });

      reply.code(201);
      return { service: toAdminCustomerServiceDTO(service) };
    });

    /**
     * Update service (Admin / Staff only).
     */
    app.patch<{ Params: { id: string } }>(`${prefix}/services/:id`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idParamSchema, request.params.id);
      const input = parseOrThrow(patchServiceSchema, request.body);

      const existing = await findServiceById(pool, id);
      if (!existing) throw new NotFoundError('Service not found');

      const updated = await updateCustomerService(pool, id, {
        label: input.label,
        status: input.status,
        domain: input.domain,
        hostname: input.hostname,
        username: input.username,
        serverId: input.serverId,
        controlPanelId: input.controlPanelId,
        licenseId: input.licenseId,
        billingCycle: input.billingCycle,
        amount: input.amount,
        currency: input.currency,
        nextDueDate: input.nextDueDate,
        suspensionDate: input.suspensionDate,
        terminationDate: input.terminationDate,
        notes: input.notes,
        externalReference: input.externalReference,
      });

      if (!updated) throw new NotFoundError('Service not found');

      await auditRequest(pool, request, auth.userId, {
        action: 'SERVICE_UPDATED',
        resourceType: 'service',
        resourceId: id,
        metadata: { changes: Object.keys(input) },
      });

      return { service: toAdminCustomerServiceDTO(updated) };
    });

    /**
     * Trigger / queue provisioning for a service.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/services/:id/provision`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idParamSchema, request.params.id);

      const service = await findServiceById(pool, id);
      if (!service) throw new NotFoundError('Service not found');

      await updateCustomerService(pool, id, { status: 'provisioning' });

      await auditRequest(pool, request, auth.userId, {
        action: 'SERVICE_PROVISION_QUEUED',
        resourceType: 'service',
        resourceId: id,
        metadata: { serverId: service.server_id, panelId: service.control_panel_id },
      });

      const updated = await findServiceById(pool, id);
      return { service: updated ? toAdminCustomerServiceDTO(updated) : null, message: 'Provisioning initiated' };
    });

    /**
     * Suspend a service.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/services/:id/suspend`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin', 'staff']);
      const id = parseOrThrow(idParamSchema, request.params.id);

      const service = await findServiceById(pool, id);
      if (!service) throw new NotFoundError('Service not found');

      const suspended = await suspendService(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'SERVICE_SUSPENDED',
        resourceType: 'service',
        resourceId: id,
      });

      return { service: suspended ? toAdminCustomerServiceDTO(suspended) : null };
    });

    /**
     * Unsuspend a service.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/services/:id/unsuspend`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin', 'staff']);
      const id = parseOrThrow(idParamSchema, request.params.id);

      const service = await findServiceById(pool, id);
      if (!service) throw new NotFoundError('Service not found');

      const reactivated = await unsuspendService(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'SERVICE_UNSUSPENDED',
        resourceType: 'service',
        resourceId: id,
      });

      return { service: reactivated ? toAdminCustomerServiceDTO(reactivated) : null };
    });

    /**
     * Terminate a service.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/services/:id/terminate`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idParamSchema, request.params.id);

      const service = await findServiceById(pool, id);
      if (!service) throw new NotFoundError('Service not found');

      const terminated = await terminateService(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'SERVICE_TERMINATED',
        resourceType: 'service',
        resourceId: id,
      });

      return { service: terminated ? toAdminCustomerServiceDTO(terminated) : null };
    });
  };

  // Register on both /api/v1 and /api for full spec compatibility
  registerHandlers('/api/v1');
  registerHandlers('/api');
}
