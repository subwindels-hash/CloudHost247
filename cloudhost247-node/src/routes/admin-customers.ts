import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { findUserById, listUsers, recordAuthEvent, updateUserRole, updateUserStatus } from '../db/users';
import {
  createCustomerService,
  findServiceById,
  listServicesForUser,
  updateCustomerService,
} from '../db/customer-services';
import { createCustomerDomain, findDomainById, listDomainsForUser, updateCustomerDomain } from '../db/customer-domains';
import {
  appendTicketMessage,
  findTicketById,
  listAllTickets,
  listMessagesForTicket,
  listTicketsForUser,
  updateTicketStatus,
} from '../db/support-tickets';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';
import {
  toAdminCustomerDomainDTO,
  toAdminCustomerServiceDTO,
  toAdminCustomerSummaryDTO,
  toPublicUser,
  toTicketMessageDTO,
  toTicketSummaryDTO,
} from '../dto/account';

// Routine customer-support work (viewing accounts, managing the passive service/domain records,
// replying to tickets) is available to both privileged roles. Account-integrity actions that can
// lock someone out or escalate privilege (suspending/disabling an account, changing a role) are
// restricted to super_admin only — see docs/API_CUSTOMER_APP.md "Authorization model" for the
// full rationale, mirroring the same admin/super_admin split already established for catalog
// pricing in Phase 3 (src/routes/catalog-admin.ts).
const CUSTOMER_MANAGEMENT_ROLES = ['admin', 'super_admin'] as const;
const ACCOUNT_INTEGRITY_ROLES = ['super_admin'] as const;

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });
const nestedIdParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID'), subId: z.string().uuid('id must be a valid UUID') });

const listCustomersQuerySchema = z.object({
  search: z.string().max(255).optional(),
  role: z.enum(['customer', 'admin', 'super_admin']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createServiceSchema = z.object({
  label: z.string().min(1).max(255),
  productId: z.string().uuid().nullable().optional(),
  planId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'suspended', 'cancelled', 'pending_migration']).optional(),
  externalReference: z.string().max(255).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const updateServiceSchema = z
  .object({
    label: z.string().min(1).max(255).optional(),
    productId: z.string().uuid().nullable().optional(),
    planId: z.string().uuid().nullable().optional(),
    status: z.enum(['active', 'suspended', 'cancelled', 'pending_migration']).optional(),
    externalReference: z.string().max(255).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

const createDomainSchema = z.object({
  domainName: z.string().min(1).max(255),
  registrar: z.string().max(255).nullable().optional(),
  status: z.enum(['active', 'expired', 'pending_transfer', 'pending_migration']).optional(),
  expiresAt: z.string().date().nullable().optional(),
  externalReference: z.string().max(255).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const updateDomainSchema = z
  .object({
    domainName: z.string().min(1).max(255).optional(),
    registrar: z.string().max(255).nullable().optional(),
    status: z.enum(['active', 'expired', 'pending_transfer', 'pending_migration']).optional(),
    expiresAt: z.string().date().nullable().optional(),
    externalReference: z.string().max(255).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

const statusSchema = z.object({ status: z.enum(['active', 'suspended', 'disabled']) });
const roleSchema = z.object({ role: z.enum(['customer', 'admin', 'super_admin']) });
const ticketStatusSchema = z.object({ status: z.enum(['open', 'pending_customer', 'pending_staff', 'closed']) });
const replyMessageSchema = z.object({ message: z.string().min(1).max(10000) });
const listTicketsQuerySchema = z.object({
  status: z.enum(['open', 'pending_customer', 'pending_staff', 'closed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * Staff-side customer management API — see docs/API_CUSTOMER_APP.md for the full contract.
 *
 * Every route calls `requireRole()` (src/lib/require-role.ts) before touching the database, which
 * re-checks the caller's role directly against the `users` table on every request — never the JWT
 * claim — so a revoked admin/super_admin role takes effect immediately. As documented at the top
 * of this file, most routes accept `admin` or `super_admin`; the account-status and role-change
 * routes accept `super_admin` only.
 */
export async function registerAdminCustomerRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  async function assertStaff(request: FastifyRequest) {
    return requireRole(request, env, pool, CUSTOMER_MANAGEMENT_ROLES);
  }
  async function assertSuperAdmin(request: FastifyRequest) {
    return requireRole(request, env, pool, ACCOUNT_INTEGRITY_ROLES);
  }

  async function loadCustomerOrThrow(id: string) {
    const user = await findUserById(pool, id);
    if (!user) throw new NotFoundError('No customer account was found with that id');
    return user;
  }

  // --- Customer directory --------------------------------------------------------------------

  app.get('/api/v1/admin/customers', async (request) => {
    await assertStaff(request);
    const query = parseOrThrow(listCustomersQuerySchema, request.query);
    const { users, total } = await listUsers(pool, {
      search: query.search,
      role: query.role,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });
    return { customers: users.map(toAdminCustomerSummaryDTO), total };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/customers/:id', async (request) => {
    await assertStaff(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const user = await loadCustomerOrThrow(id);

    const [services, domains, tickets] = await Promise.all([
      listServicesForUser(pool, id),
      listDomainsForUser(pool, id),
      listTicketsForUser(pool, id),
    ]);

    return {
      customer: toPublicUser(user),
      services: services.map(toAdminCustomerServiceDTO),
      domains: domains.map(toAdminCustomerDomainDTO),
      tickets: tickets.map(toTicketSummaryDTO),
    };
  });

  // --- Account integrity (super_admin only) --------------------------------------------------

  app.patch<{ Params: { id: string } }>('/api/v1/admin/customers/:id/status', async (request) => {
    const auth = await assertSuperAdmin(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { status } = parseOrThrow(statusSchema, request.body);

    await loadCustomerOrThrow(id);
    const updated = await updateUserStatus(pool, id, status);
    if (!updated) throw new NotFoundError('No customer account was found with that id');

    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: auth.userId,
      eventType: 'admin_status_change',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { targetUserId: id, newStatus: status },
    });

    return { customer: toPublicUser(updated) };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/customers/:id/role', async (request) => {
    const auth = await assertSuperAdmin(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { role } = parseOrThrow(roleSchema, request.body);

    if (id === auth.userId) {
      // A super_admin changing their own role (especially demoting themselves) could lock every
      // admin out of catalog/customer management with no way to undo it from this app — refuse it
      // outright rather than relying on staff discipline.
      throw new ValidationError('You cannot change your own role');
    }

    await loadCustomerOrThrow(id);
    const updated = await updateUserRole(pool, id, role);
    if (!updated) throw new NotFoundError('No customer account was found with that id');

    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: auth.userId,
      eventType: 'admin_role_change',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { targetUserId: id, newRole: role },
    });

    return { customer: toPublicUser(updated) };
  });

  // --- Customer services (admin + super_admin) -----------------------------------------------

  app.post<{ Params: { id: string } }>('/api/v1/admin/customers/:id/services', async (request, reply) => {
    const auth = await assertStaff(request);
    const { id: userId } = parseOrThrow(idParamSchema, request.params);
    await loadCustomerOrThrow(userId);

    const input = parseOrThrow(createServiceSchema, request.body);
    const service = await createCustomerService(pool, { id: randomUUID(), userId, createdBy: auth.userId, ...input });
    reply.code(201);
    return { service: toAdminCustomerServiceDTO(service) };
  });

  app.patch<{ Params: { id: string; subId: string } }>('/api/v1/admin/customers/:id/services/:subId', async (request) => {
    await assertStaff(request);
    const { id: userId, subId: serviceId } = parseOrThrow(nestedIdParamSchema, request.params);

    const existing = await findServiceById(pool, serviceId);
    if (!existing || existing.user_id !== userId) {
      throw new NotFoundError('No service record was found with that id for this customer');
    }

    const patch = parseOrThrow(updateServiceSchema, request.body);
    const service = await updateCustomerService(pool, serviceId, patch);
    if (!service) throw new NotFoundError('No service record was found with that id for this customer');
    return { service: toAdminCustomerServiceDTO(service) };
  });

  // --- Customer domains (admin + super_admin) ------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/v1/admin/customers/:id/domains', async (request, reply) => {
    const auth = await assertStaff(request);
    const { id: userId } = parseOrThrow(idParamSchema, request.params);
    await loadCustomerOrThrow(userId);

    const input = parseOrThrow(createDomainSchema, request.body);
    const domain = await createCustomerDomain(pool, { id: randomUUID(), userId, createdBy: auth.userId, ...input });
    reply.code(201);
    return { domain: toAdminCustomerDomainDTO(domain) };
  });

  app.patch<{ Params: { id: string; subId: string } }>('/api/v1/admin/customers/:id/domains/:subId', async (request) => {
    await assertStaff(request);
    const { id: userId, subId: domainId } = parseOrThrow(nestedIdParamSchema, request.params);

    const existing = await findDomainById(pool, domainId);
    if (!existing || existing.user_id !== userId) {
      throw new NotFoundError('No domain record was found with that id for this customer');
    }

    const patch = parseOrThrow(updateDomainSchema, request.body);
    const domain = await updateCustomerDomain(pool, domainId, patch);
    if (!domain) throw new NotFoundError('No domain record was found with that id for this customer');
    return { domain: toAdminCustomerDomainDTO(domain) };
  });

  // --- Support tickets (admin + super_admin) -------------------------------------------------

  app.get('/api/v1/admin/tickets', async (request) => {
    await assertStaff(request);
    const query = parseOrThrow(listTicketsQuerySchema, request.query);
    const { tickets, total } = await listAllTickets(pool, {
      status: query.status,
      limit: query.limit ?? 25,
      offset: query.offset ?? 0,
    });
    return { tickets: tickets.map(toTicketSummaryDTO), total };
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/tickets/:id', async (request) => {
    const auth = await assertStaff(request);
    const { id } = parseOrThrow(idParamSchema, request.params);

    const ticket = await findTicketById(pool, id);
    if (!ticket) throw new NotFoundError('No ticket was found with that id');

    const [messages, customer] = await Promise.all([listMessagesForTicket(pool, ticket.id), findUserById(pool, ticket.user_id)]);

    return {
      ticket: {
        ...toTicketSummaryDTO(ticket),
        closedAt: ticket.closed_at,
        messages: messages.map((m) => toTicketMessageDTO(m, auth.userId)),
      },
      customer: customer ? toAdminCustomerSummaryDTO(customer) : null,
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/tickets/:id/messages', async (request, reply) => {
    const auth = await assertStaff(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { message } = parseOrThrow(replyMessageSchema, request.body);

    const ticket = await findTicketById(pool, id);
    if (!ticket) throw new NotFoundError('No ticket was found with that id');

    await appendTicketMessage(pool, { id: randomUUID(), ticketId: ticket.id, authorId: auth.userId, authorRole: auth.role, body: message });

    const updatedTicket = await findTicketById(pool, ticket.id);
    const messages = await listMessagesForTicket(pool, ticket.id);
    reply.code(201);
    return {
      ticket: {
        ...toTicketSummaryDTO(updatedTicket ?? ticket),
        closedAt: (updatedTicket ?? ticket).closed_at,
        messages: messages.map((m) => toTicketMessageDTO(m, auth.userId)),
      },
    };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/tickets/:id', async (request) => {
    await assertStaff(request);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { status } = parseOrThrow(ticketStatusSchema, request.body);

    const ticket = await updateTicketStatus(pool, id, status);
    if (!ticket) throw new NotFoundError('No ticket was found with that id');
    return { ticket: { ...toTicketSummaryDTO(ticket), closedAt: ticket.closed_at } };
  });
}
