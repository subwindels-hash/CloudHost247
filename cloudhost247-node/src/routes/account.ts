import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { findUserById, recordAuthEvent, updateFullName, updatePasswordHash } from '../db/users';
import { listServicesForUser } from '../db/customer-services';
import { listDomainsForUser } from '../db/customer-domains';
import {
  appendTicketMessage,
  createTicket,
  findTicketById,
  listMessagesForTicket,
  listTicketsForUser,
} from '../db/support-tickets';
import { hashPassword, verifyPassword } from '../lib/password';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, UnauthorizedError, ValidationError } from '../lib/errors';
import {
  toCustomerDomainDTO,
  toCustomerServiceDTO,
  toPublicUser,
  toTicketMessageDTO,
  toTicketSummaryDTO,
} from '../dto/account';

const updateProfileSchema = z.object({
  fullName: z.string().min(1, 'fullName is required').max(255),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'currentPassword is required'),
  newPassword: z.string().min(10, 'Password must be at least 10 characters'),
});

const createTicketSchema = z.object({
  subject: z.string().min(1, 'subject is required').max(255),
  message: z.string().min(1, 'message is required').max(10000),
  priority: z.enum(['low', 'normal', 'high']).optional(),
});

const replyTicketSchema = z.object({
  message: z.string().min(1, 'message is required').max(10000),
});

const idParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') });

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * Phase 4 self-service "Customer App" API — see docs/API_CUSTOMER_APP.md for the full contract.
 *
 * Every route here is scoped to the *calling* account only: `authenticate()` establishes who the
 * caller is (re-verified against the database on every request, including the password-change
 * session-invalidation check — see src/lib/require-auth.ts), and every query below filters
 * explicitly by that caller's own user id. A record that exists but belongs to someone else is
 * never distinguishable from a record that doesn't exist at all — both return 404, never 403, so
 * this API never confirms or denies another customer's data exists (see the ticket-detail/reply
 * handlers below for the concrete case).
 *
 * customer_services and customer_domains are read-only here by design: customers can view their
 * own staff-entered records but cannot create or edit them (see database/migrations/0008 and
 * 0009 — these are informational only, not a self-service ordering/provisioning flow).
 */
export async function registerAccountRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.patch('/api/v1/account/profile', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { fullName } = parseOrThrow(updateProfileSchema, request.body);

    const user = await updateFullName(pool, auth.userId, fullName);
    if (!user) throw new NotFoundError('Account no longer exists');

    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: auth.userId,
      eventType: 'profile_update',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    return { user: toPublicUser(user) };
  });

  app.post(
    '/api/v1/account/password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const { currentPassword, newPassword } = parseOrThrow(changePasswordSchema, request.body);

      const user = await findUserById(pool, auth.userId);
      if (!user) throw new NotFoundError('Account no longer exists');

      const currentOk = await verifyPassword(currentPassword, user.password_hash);
      if (!currentOk) {
        throw new UnauthorizedError('Current password is incorrect');
      }

      const newHash = await hashPassword(newPassword);
      // Stamps password_changed_at = now(), which is what makes every token issued before this
      // exact moment stop working on its next request (enforced in src/lib/require-auth.ts) — a
      // real, immediate, server-side session invalidation, not just a client-side "log out".
      await updatePasswordHash(pool, auth.userId, newHash);

      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: auth.userId,
        eventType: 'password_change',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      reply.code(204).send();
    }
  );

  app.get('/api/v1/account/services', async (request) => {
    const auth = await authenticate(request, env, pool);
    const services = await listServicesForUser(pool, auth.userId);
    return { services: services.map(toCustomerServiceDTO) };
  });

  app.get('/api/v1/account/domains', async (request) => {
    const auth = await authenticate(request, env, pool);
    const domains = await listDomainsForUser(pool, auth.userId);
    return { domains: domains.map(toCustomerDomainDTO) };
  });

  app.get('/api/v1/account/tickets', async (request) => {
    const auth = await authenticate(request, env, pool);
    const tickets = await listTicketsForUser(pool, auth.userId);
    return { tickets: tickets.map(toTicketSummaryDTO) };
  });

  app.post('/api/v1/account/tickets', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const input = parseOrThrow(createTicketSchema, request.body);

    const ticket = await createTicket(pool, {
      id: randomUUID(),
      userId: auth.userId,
      subject: input.subject,
      priority: input.priority,
      firstMessage: { id: randomUUID(), authorId: auth.userId, authorRole: 'customer', body: input.message },
    });

    reply.code(201);
    return { ticket: toTicketSummaryDTO(ticket) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/account/tickets/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParamSchema, request.params);

    const ticket = await findTicketById(pool, id);
    // Never distinguish "doesn't exist" from "exists but isn't yours" — both are 404.
    if (!ticket || ticket.user_id !== auth.userId) {
      throw new NotFoundError('No ticket was found with that id');
    }

    const messages = await listMessagesForTicket(pool, ticket.id);
    return {
      ticket: {
        ...toTicketSummaryDTO(ticket),
        closedAt: ticket.closed_at,
        messages: messages.map((m) => toTicketMessageDTO(m, auth.userId)),
      },
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/account/tickets/:id/messages', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const { id } = parseOrThrow(idParamSchema, request.params);
    const { message } = parseOrThrow(replyTicketSchema, request.body);

    const ticket = await findTicketById(pool, id);
    if (!ticket || ticket.user_id !== auth.userId) {
      throw new NotFoundError('No ticket was found with that id');
    }

    await appendTicketMessage(pool, { id: randomUUID(), ticketId: ticket.id, authorId: auth.userId, authorRole: 'customer', body: message });

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
}
