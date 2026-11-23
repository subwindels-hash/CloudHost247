/**
 * Email forwarding (G06).
 *
 *   POST   /api/v1/email/forwarders            — create a forwarder (customer, own address)
 *   GET    /api/v1/email/forwarders            — list forwarders (customer: own; staff: all)
 *   GET    /api/v1/email/forwarders/:id        — get a forwarder (customer: own; staff: any)
 *   PATCH  /api/v1/email/forwarders/:id        — update a forwarder (customer: own; staff: any)
 *   DELETE /api/v1/email/forwarders/:id        — delete a forwarder (customer: own; staff: any)
 *
 * Authorization:
 *   - Customers manage their own forwarders (tenant-scoped by user_id).
 *   - Staff / admin / super_admin can list, view, update, delete any forwarder.
 *   - Optional `user_id` query on GET lets staff list another tenant's forwarders.
 *
 * No SMTP, IMAP, or mail provider is configured here. Forwarder rules are stored as configured;
 * actual delivery depends on a mail provider that is not yet activated. Honest about the absence
 * of a mail provider rather than fabricating delivery.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  createEmailForwarder,
  listEmailForwarders,
  countEmailForwarders,
  findEmailForwarderById,
  updateEmailForwarder,
  deleteEmailForwarder,
  type EmailForwarderRow,
} from '../db/email-forwarders';
import { authenticate } from '../lib/require-auth';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;

const emailForwarderBodySchema = z.object({
  local_address: z.string().trim().email('local_address must be an email address').max(320),
  destination_address: z.string().trim().email('destination_address must be an email address').max(320),
  status: z.enum(['active', 'disabled']).optional(),
});

const updateEmailForwarderBodySchema = emailForwarderBodySchema.partial();

const emailForwarderParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

const emailForwarderListQuerySchema = z.object({
  user_id: z.string().uuid('user_id must be a valid UUID').optional(),
  status: z.enum(['active', 'disabled']).optional(),
  local_address: z.string().trim().max(320).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

type ForwarderStatus = 'active' | 'disabled';

type EmailForwarderDto = {
  id: string;
  user_id: string;
  local_address: string;
  destination_address: string;
  status: ForwarderStatus;
  created_at: Date;
  updated_at: Date;
};

function toEmailForwarderDto(row: EmailForwarderRow): EmailForwarderDto {
  return {
    id: row.id,
    user_id: row.user_id,
    local_address: row.local_address,
    destination_address: row.destination_address,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Scope the caller's effective user_id: staff may override via ?user_id=; customers are locked to themselves. */
function effectiveUserId(authUserId: string, isStaff: boolean, requestUserId?: string): string {
  if (isStaff && requestUserId) return requestUserId;
  return authUserId;
}

export async function registerEmailForwarderRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- Create forwarder ------------------------------------------------------

  app.post<{ Body: z.infer<typeof emailForwarderBodySchema> }>(
    '/api/v1/email/forwarders',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = emailForwarderBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const input = parsed.data;
      const forwarder = await createEmailForwarder(db, {
        user_id: auth.userId,
        local_address: input.local_address,
        destination_address: input.destination_address,
        status: input.status,
      });
      reply.code(201);
      return { email_forwarder: toEmailForwarderDto(forwarder) };
    }
  );

  // --- List forwarders -------------------------------------------------------

  app.get<{ Querystring: z.infer<typeof emailForwarderListQuerySchema> }>(
    '/api/v1/email/forwarders',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = emailForwarderListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const userId = effectiveUserId(auth.userId, isStaff, parsed.data.user_id);

      // Customers may not list another user's forwarders.
      if (!isStaff && parsed.data.user_id && parsed.data.user_id !== auth.userId) {
        throw new ForbiddenError('You may only list your own forwarders');
      }

      const forwarders = await listEmailForwarders(db, {
        user_id: userId,
        status: parsed.data.status,
        local_address: parsed.data.local_address,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      const total = await countEmailForwarders(db, {
        user_id: userId,
        status: parsed.data.status,
        local_address: parsed.data.local_address,
      });
      return {
        email_forwarders: forwarders.map(toEmailForwarderDto),
        total,
        limit: parsed.data.limit ?? 50,
        offset: parsed.data.offset ?? 0,
      };
    }
  );

  // --- Get single forwarder --------------------------------------------------

  app.get<{ Params: z.infer<typeof emailForwarderParamSchema> }>(
    '/api/v1/email/forwarders/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = emailForwarderParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const forwarder = await findEmailForwarderById(db, parsed.data.id, isStaff ? undefined : auth.userId);
      if (!forwarder) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Email forwarder not found' };
      }
      return { email_forwarder: toEmailForwarderDto(forwarder) };
    }
  );

  // --- Update forwarder ------------------------------------------------------

  app.patch<{ Params: z.infer<typeof emailForwarderParamSchema>; Body: z.infer<typeof updateEmailForwarderBodySchema> }>(
    '/api/v1/email/forwarders/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = emailForwarderParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const existing = await findEmailForwarderById(db, paramsParsed.data.id, isStaff ? undefined : auth.userId);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Email forwarder not found' };
      }
      const bodyParsed = updateEmailForwarderBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }
      const input = bodyParsed.data;
      const updated = await updateEmailForwarder(db, paramsParsed.data.id, existing.user_id, {
        destination_address: input.destination_address,
        status: input.status,
      });
      return { email_forwarder: toEmailForwarderDto(updated!) };
    }
  );

  // --- Delete forwarder ------------------------------------------------------

  app.delete<{ Params: z.infer<typeof emailForwarderParamSchema> }>(
    '/api/v1/email/forwarders/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = emailForwarderParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const existing = await findEmailForwarderById(db, parsed.data.id, isStaff ? undefined : auth.userId);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Email forwarder not found' };
      }
      const deleted = await deleteEmailForwarder(db, parsed.data.id, existing.user_id);
      if (!deleted) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Email forwarder not found' };
      }
      reply.code(204);
      return null;
    }
  );
}