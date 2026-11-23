/**
 * IP address inventory (E12 — E VPS).
 *
 *   GET    /api/v1/ip-addresses              — list IP addresses (optional filters: status, version, server_id, customer_id)
 *   GET    /api/v1/ip-addresses/reconcile    — IP reconciliation audit (staff only)
 *   POST   /api/v1/ip-addresses              — register a new IP address in the inventory
 *   POST   /api/v1/ip-addresses/:id/assign   — assign a free IP to a server + customer
 *   DELETE /api/v1/ip-addresses/:id          — release an assigned IP back to the pool
 *
 * Authorization:
 *   - Customers can list and view IPs assigned to them.
 *   - Staff / admin / super_admin can manage any IP.
 *
 * No external provider is called — this is an internal inventory only. Actual IP
 * allocation from a provider is not yet configured.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  assignIpAddress,
  createIpAddress,
  getIpAddress,
  getIpAddressByAddress,
  listIpAddresses,
  releaseIpAddress,
  reconcileIpAddresses,
  type CreateIpAddressInput,
  type IpAddressRow,
  type IpReconciliationReport,
  type ListIpAddressesFilters,
} from '../db/ip-addresses';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;

const ipIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

const ipListQuerySchema = z.object({
  status: z.enum(['free', 'assigned', 'reserved']).optional(),
  version: z.enum(['ipv4', 'ipv6']).optional(),
  server_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
});

const ipCreateBodySchema = z.object({
  address: z.string().min(1, 'address is required'),
  version: z.enum(['ipv4', 'ipv6']),
  status: z.enum(['free', 'assigned', 'reserved']).optional(),
  customer_id: z.string().uuid().optional(),
});

const ipAssignBodySchema = z.object({
  server_id: z.string().uuid('server_id must be a valid UUID'),
  customer_id: z.string().uuid('customer_id must be a valid UUID'),
  status: z.enum(['assigned', 'reserved']).optional(),
});

type IpAddressDto = {
  id: string;
  address: string;
  version: 'ipv4' | 'ipv6';
  status: 'free' | 'assigned' | 'reserved';
  server_id: string | null;
  customer_id: string | null;
  assigned_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toIpAddressDto(row: IpAddressRow): IpAddressDto {
  return {
    id: row.id,
    address: row.address,
    version: row.version,
    status: row.status,
    server_id: row.server_id,
    customer_id: row.customer_id,
    assigned_at: row.assigned_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function registerIpAddressRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- List IP addresses -----------------------------------------------------

  app.get<{ Querystring: z.infer<typeof ipListQuerySchema> }>(
    '/api/v1/ip-addresses',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = ipListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const filters: ListIpAddressesFilters = {};
      if (parsed.data.status) filters.status = parsed.data.status;
      if (parsed.data.version) filters.version = parsed.data.version;
      if (parsed.data.server_id) filters.server_id = parsed.data.server_id;
      if (parsed.data.customer_id) filters.customer_id = parsed.data.customer_id;

      // Non-staff customers only see their own IPs (or unassigned free pool is staff-only).
      if (!isStaff) {
        filters.customer_id = auth.userId;
      }

      const rows = await listIpAddresses(db, filters);
      return { ip_addresses: rows.map(toIpAddressDto) };
    },
  );

  // --- Reconcile IP address inventory ----------------------------------------

  app.get('/api/v1/ip-addresses/reconcile', async (request, reply) => {
    const auth = await authenticate(request, env, db);
    const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
    if (!isStaff) {
      reply.code(403);
      return { error: 'FORBIDDEN', message: 'Only staff can reconcile IP addresses' };
    }

    const report = await reconcileIpAddresses(db);
    return { reconciliation: report };
  });

  // --- Register a new IP address ---------------------------------------------

  app.post<{ Body: z.infer<typeof ipCreateBodySchema> }>(
    '/api/v1/ip-addresses',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      if (!isStaff) {
        reply.code(403);
        return { error: 'FORBIDDEN', message: 'Only staff can register IP addresses' };
      }

      const parsed = ipCreateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const existing = await getIpAddressByAddress(db, parsed.data.address);
      if (existing) {
        throw new ValidationError(`IP address ${parsed.data.address} already exists`);
      }

      const row = await createIpAddress(db, {
        address: parsed.data.address,
        version: parsed.data.version,
        status: parsed.data.status,
        customer_id: parsed.data.customer_id ?? null,
      });
      reply.code(201);
      return { ip_address: toIpAddressDto(row) };
    },
  );

  // --- Assign an IP to a server + customer -----------------------------------

  app.post<{ Params: z.infer<typeof ipIdParamSchema>; Body: z.infer<typeof ipAssignBodySchema> }>(
    '/api/v1/ip-addresses/:id/assign',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      if (!isStaff) {
        reply.code(403);
        return { error: 'FORBIDDEN', message: 'Only staff can assign IP addresses' };
      }

      const paramsParsed = ipIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const existing = await getIpAddress(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'IP address not found' };
      }
      if (existing.status !== 'free') {
        throw new ValidationError(`IP address ${existing.address} is not free`);
      }

      const bodyParsed = ipAssignBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }

      const row = await assignIpAddress(db, paramsParsed.data.id, {
        server_id: bodyParsed.data.server_id,
        customer_id: bodyParsed.data.customer_id,
        status: bodyParsed.data.status,
      });
      if (!row) {
        reply.code(400);
        return { error: 'BAD_REQUEST', message: 'IP address is not free or could not be assigned' };
      }
      return { ip_address: toIpAddressDto(row) };
    },
  );

  // --- Release an IP back to the pool ----------------------------------------

  app.delete<{ Params: z.infer<typeof ipIdParamSchema> }>(
    '/api/v1/ip-addresses/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      if (!isStaff) {
        reply.code(403);
        return { error: 'FORBIDDEN', message: 'Only staff can release IP addresses' };
      }

      const paramsParsed = ipIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const existing = await getIpAddress(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'IP address not found' };
      }
      if (existing.status === 'free') {
        throw new ValidationError(`IP address ${existing.address} is already free`);
      }

      const row = await releaseIpAddress(db, paramsParsed.data.id);
      if (!row) {
        reply.code(400);
        return { error: 'BAD_REQUEST', message: 'IP address could not be released' };
      }
      return { ip_address: toIpAddressDto(row) };
    },
  );
}
