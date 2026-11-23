/**
 * Agency / reseller hosting (W10, J Agency core).
 *
 *   POST   /api/v1/agency/agencies             — create agency (staff+)
 *   GET    /api/v1/agency/agencies             — list agencies (staff+)
 *   GET    /api/v1/agency/agencies/:id         — get agency (staff+)
 *   PATCH  /api/v1/agency/agencies/:id         — update agency (staff+)
 *   DELETE /api/v1/agency/agencies/:id         — delete agency (staff+)
 *   POST   /api/v1/agency/clients              — add client to agency (staff+)
 *   GET    /api/v1/agency/clients              — list agency clients (staff+)
 *   DELETE /api/v1/agency/clients/:id          — remove client from agency (staff+)
 *   POST   /api/v1/agency/packages             — create reseller package (staff+)
 *   GET    /api/v1/agency/packages             — list reseller packages (staff+)
 *   GET    /api/v1/agency/packages/:id         — get reseller package (staff+)
 *   PATCH  /api/v1/agency/packages/:id         — update reseller package (staff+)
 *   DELETE /api/v1/agency/packages/:id         — delete reseller package (staff+)
 *
 * Authorization: staff / admin / super_admin only. Reseller package prices are
 * display-only under the D2 financial freeze — no order or payment flow is activated.
 *
 * This is the backend surface for agency hosting pages (W10). The frontend agency pages
 * are part of the W Website workstream.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  createAgency,
  findAgencyById,
  findAgencyBySlug,
  listAgencies,
  countAgencies,
  updateAgency,
  deleteAgency,
  addAgencyClient,
  listAgencyClients,
  removeAgencyClient,
  createResellerPackage,
  findResellerPackageById,
  findResellerPackageBySlug,
  listResellerPackages,
  updateResellerPackage,
  deleteResellerPackage,
  type AgencyRow,
  type AgencyClientRow,
  type ResellerPackageRow,
} from '../db/agency';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;

const agencySlugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const createAgencyBodySchema = z.object({
  name: z.string().min(1).max(255),
  slug: agencySlugSchema,
  contact_email: z.string().trim().email().max(255),
  status: z.enum(['active', 'suspended', 'disabled']).optional(),
});

const updateAgencyBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  contact_email: z.string().trim().email().max(255).optional(),
  status: z.enum(['active', 'suspended', 'disabled']).optional(),
});

const addAgencyClientBodySchema = z.object({
  agency_id: z.string().uuid('agency_id must be a valid UUID'),
  user_id: z.string().uuid('user_id must be a valid UUID'),
  role: z.enum(['owner', 'client', 'billing']).optional(),
});

const createResellerPackageBodySchema = z.object({
  name: z.string().min(1).max(255),
  slug: agencySlugSchema,
  description: z.string().max(2000).nullable().optional(),
  price_cents: z.coerce.number().int().min(0).max(100000000).optional(),
  currency: z.string().length(3).optional(),
  status: z.enum(['active', 'disabled', 'archived']).optional(),
});

const updateResellerPackageBodySchema = createResellerPackageBodySchema.partial();

const agencyParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

type AgencyStatus = 'active' | 'suspended' | 'disabled';
type AgencyClientRole = 'owner' | 'client' | 'billing';
type ResellerPackageStatus = 'active' | 'disabled' | 'archived';

type AgencyDto = {
  id: string;
  name: string;
  slug: string;
  contact_email: string;
  status: AgencyStatus;
  created_at: Date;
  updated_at: Date;
};

type AgencyClientDto = {
  id: string;
  agency_id: string;
  user_id: string;
  role: AgencyClientRole;
  created_at: Date;
};

type ResellerPackageDto = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  currency: string;
  status: ResellerPackageStatus;
  created_at: Date;
  updated_at: Date;
};

function toAgencyDto(row: AgencyRow): AgencyDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    contact_email: row.contact_email,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toAgencyClientDto(row: AgencyClientRow): AgencyClientDto {
  return {
    id: row.id,
    agency_id: row.agency_id,
    user_id: row.user_id,
    role: row.role,
    created_at: row.created_at,
  };
}

function toResellerPackageDto(row: ResellerPackageRow): ResellerPackageDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    price_cents: row.price_cents,
    currency: row.currency,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function registerAgencyRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- Agencies ---

  app.post<{ Body: z.infer<typeof createAgencyBodySchema> }>(
    '/api/v1/agency/agencies',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const input = createAgencyBodySchema.parse(request.body);
      const existing = await findAgencyBySlug(db, input.slug);
      if (existing) {
        throw new ValidationError('An agency with that slug already exists');
      }
      const agency = await createAgency(db, input);
      reply.code(201);
      return { agency: toAgencyDto(agency) };
    }
  );

  app.get<{ Querystring: { status?: string; limit?: string; offset?: string } }>(
    '/api/v1/agency/agencies',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const filter = {
        status: request.query.status as AgencyStatus | undefined,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        offset: request.query.offset ? Number(request.query.offset) : undefined,
      };
      const agencies = await listAgencies(db, filter);
      const total = await countAgencies(db, { status: filter.status });
      return {
        agencies: agencies.map(toAgencyDto),
        total,
        limit: filter.limit ?? 50,
        offset: filter.offset ?? 0,
      };
    }
  );

  app.get<{ Params: z.infer<typeof agencyParamSchema> }>(
    '/api/v1/agency/agencies/:id',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const parsed = agencyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const agency = await findAgencyById(db, parsed.data.id);
      if (!agency) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Agency not found' };
      }
      return { agency: toAgencyDto(agency) };
    }
  );

  app.patch<{ Params: z.infer<typeof agencyParamSchema>; Body: z.infer<typeof updateAgencyBodySchema> }>(
    '/api/v1/agency/agencies/:id',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const paramsParsed = agencyParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const existing = await findAgencyById(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Agency not found' };
      }
      const input = updateAgencyBodySchema.parse(request.body);
      const updated = await updateAgency(db, paramsParsed.data.id, input);
      return { agency: toAgencyDto(updated!) };
    }
  );

  app.delete<{ Params: z.infer<typeof agencyParamSchema> }>(
    '/api/v1/agency/agencies/:id',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const parsed = agencyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const deleted = await deleteAgency(db, parsed.data.id);
      if (!deleted) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Agency not found' };
      }
      reply.code(204);
      return null;
    }
  );

  // --- Agency clients ---

  app.post<{ Body: z.infer<typeof addAgencyClientBodySchema> }>(
    '/api/v1/agency/clients',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const input = addAgencyClientBodySchema.parse(request.body);
      const agency = await findAgencyById(db, input.agency_id);
      if (!agency) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Agency not found' };
      }
      const client = await addAgencyClient(db, input);
      reply.code(201);
      return { agency_client: toAgencyClientDto(client) };
    }
  );

  app.get<{ Querystring: { agency_id?: string } }>(
    '/api/v1/agency/clients',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const agencyId = request.query.agency_id;
      if (!agencyId) {
        throw new ValidationError('agency_id is required');
      }
      const agency = await findAgencyById(db, agencyId);
      if (!agency) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Agency not found' };
      }
      const clients = await listAgencyClients(db, agencyId);
      return { agency_clients: clients.map(toAgencyClientDto) };
    }
  );

  app.delete<{ Params: z.infer<typeof agencyParamSchema> }>(
    '/api/v1/agency/clients/:id',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const parsed = agencyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const removed = await removeAgencyClient(db, parsed.data.id);
      if (!removed) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Agency client not found' };
      }
      reply.code(204);
      return null;
    }
  );

  // --- Reseller packages ---

  app.post<{ Body: z.infer<typeof createResellerPackageBodySchema> }>(
    '/api/v1/agency/packages',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const input = createResellerPackageBodySchema.parse(request.body);
      const existing = await findResellerPackageBySlug(db, input.slug);
      if (existing) {
        throw new ValidationError('A reseller package with that slug already exists');
      }
      const pkg = await createResellerPackage(db, input);
      reply.code(201);
      return { reseller_package: toResellerPackageDto(pkg) };
    }
  );

  app.get<{ Querystring: { status?: string; limit?: string; offset?: string } }>(
    '/api/v1/agency/packages',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const filter = {
        status: request.query.status as ResellerPackageStatus | undefined,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        offset: request.query.offset ? Number(request.query.offset) : undefined,
      };
      const packages = await listResellerPackages(db, filter);
      return {
        reseller_packages: packages.map(toResellerPackageDto),
        limit: filter.limit ?? 50,
        offset: filter.offset ?? 0,
      };
    }
  );

  app.get<{ Params: z.infer<typeof agencyParamSchema> }>(
    '/api/v1/agency/packages/:id',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const parsed = agencyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const pkg = await findResellerPackageById(db, parsed.data.id);
      if (!pkg) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Reseller package not found' };
      }
      return { reseller_package: toResellerPackageDto(pkg) };
    }
  );

  app.patch<{ Params: z.infer<typeof agencyParamSchema>; Body: z.infer<typeof updateResellerPackageBodySchema> }>(
    '/api/v1/agency/packages/:id',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const paramsParsed = agencyParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const existing = await findResellerPackageById(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Reseller package not found' };
      }
      const input = updateResellerPackageBodySchema.parse(request.body);
      const updated = await updateResellerPackage(db, paramsParsed.data.id, input);
      return { reseller_package: toResellerPackageDto(updated!) };
    }
  );

  app.delete<{ Params: z.infer<typeof agencyParamSchema> }>(
    '/api/v1/agency/packages/:id',
    async (request, reply) => {
      await requireRole(request, env, db, STAFF_ROLES);
      const parsed = agencyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const deleted = await deleteResellerPackage(db, parsed.data.id);
      if (!deleted) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Reseller package not found' };
      }
      reply.code(204);
      return null;
    }
  );
}