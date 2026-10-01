import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import {
  listLicensesForUser,
  listAllLicenses,
  findLicenseById,
  createLicense,
  updateLicense,
  activateLicense,
  renewLicense,
  cancelLicense,
  type LicenseRow,
} from '../db/licenses';
import { findControlPanelById } from '../db/control-panels';

const idParamSchema = z.string().uuid('id must be a valid UUID');

const createLicenseSchema = z.object({
  customerId: z.string().uuid(),
  serviceId: z.string().uuid().nullable().optional(),
  controlPanelId: z.string().uuid(),
  licenseKey: z.string().min(1).max(512),
  licenseType: z.string().min(1).max(64).optional(),
  provider: z.string().min(1).max(64).optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'EXPIRED', 'SUSPENDED', 'CANCELLED', 'TERMINATED']).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const renewLicenseSchema = z.object({
  expiresAt: z.string().datetime(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function toPublicLicenseDTO(row: LicenseRow, isStaff = false) {
  return {
    id: row.id,
    customerId: row.customer_id,
    serviceId: row.service_id,
    controlPanelId: row.control_panel_id,
    panelName: row.panel_name,
    panelSlug: row.panel_slug,
    licenseType: row.license_type,
    provider: row.provider,
    status: row.status,
    licenseKey: isStaff ? row.license_key : maskKey(row.license_key),
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    customerEmail: isStaff ? row.customer_email : undefined,
    customerName: isStaff ? row.customer_name : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function registerLicenseRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  const registerHandlers = (prefix: string) => {
    /**
     * List licenses:
     * - Staff/Admin gets all licenses.
     * - Customer gets only their own licenses.
     */
    app.get(`${prefix}/licenses`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const isStaff = auth.role === 'admin' || auth.role === 'super_admin' || auth.role === 'staff';

      if (isStaff) {
        const query = request.query as { status?: string; controlPanelId?: string; search?: string };
        const rows = await listAllLicenses(pool, query);
        return { licenses: rows.map((r) => toPublicLicenseDTO(r, true)) };
      }

      const rows = await listLicensesForUser(pool, auth.userId);
      return { licenses: rows.map((r) => toPublicLicenseDTO(r, false)) };
    });

    /**
     * Get single license detail.
     */
    app.get<{ Params: { id: string } }>(`${prefix}/licenses/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = parseOrThrow(idParamSchema, request.params.id);
      const isStaff = auth.role === 'admin' || auth.role === 'super_admin' || auth.role === 'staff';

      const license = await findLicenseById(pool, id);
      if (!license || (!isStaff && license.customer_id !== auth.userId)) {
        throw new NotFoundError('License not found');
      }

      return { license: toPublicLicenseDTO(license, isStaff) };
    });

    /**
     * Create license (Admin only).
     */
    app.post(`${prefix}/licenses`, async (request, reply) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const input = parseOrThrow(createLicenseSchema, request.body);

      const panel = await findControlPanelById(pool, input.controlPanelId);
      if (!panel) throw new NotFoundError('Control panel not found');

      const license = await createLicense(pool, input);

      await auditRequest(pool, request, auth.userId, {
        action: 'LICENSE_CREATED',
        resourceType: 'license',
        resourceId: license.id,
        metadata: { customerId: input.customerId, panel: panel.slug, type: input.licenseType },
      });

      reply.code(201);
      return { license: toPublicLicenseDTO(license, true) };
    });

    /**
     * Activate a license.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/licenses/:id/activate`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idParamSchema, request.params.id);

      const license = await findLicenseById(pool, id);
      if (!license) throw new NotFoundError('License not found');

      const activated = await activateLicense(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'LICENSE_ACTIVATED',
        resourceType: 'license',
        resourceId: id,
      });

      return { license: activated ? toPublicLicenseDTO(activated, true) : null };
    });

    /**
     * Renew a license.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/licenses/:id/renew`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idParamSchema, request.params.id);
      const input = parseOrThrow(renewLicenseSchema, request.body);

      const license = await findLicenseById(pool, id);
      if (!license) throw new NotFoundError('License not found');

      const renewed = await renewLicense(pool, id, input.expiresAt);

      await auditRequest(pool, request, auth.userId, {
        action: 'LICENSE_RENEWED',
        resourceType: 'license',
        resourceId: id,
        metadata: { newExpiresAt: input.expiresAt },
      });

      return { license: renewed ? toPublicLicenseDTO(renewed, true) : null };
    });

    /**
     * Cancel a license.
     */
    app.post<{ Params: { id: string } }>(`${prefix}/licenses/:id/cancel`, async (request) => {
      const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
      const id = parseOrThrow(idParamSchema, request.params.id);

      const license = await findLicenseById(pool, id);
      if (!license) throw new NotFoundError('License not found');

      const cancelled = await cancelLicense(pool, id);

      await auditRequest(pool, request, auth.userId, {
        action: 'LICENSE_CANCELLED',
        resourceType: 'license',
        resourceId: id,
      });

      return { license: cancelled ? toPublicLicenseDTO(cancelled, true) : null };
    });
  };

  registerHandlers('/api/v1');
  registerHandlers('/api');
}
