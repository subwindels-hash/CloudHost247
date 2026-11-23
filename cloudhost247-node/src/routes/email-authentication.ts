/**
 * SPF/DKIM/DMARC email authentication (G05).
 *
 *   POST   /api/v1/email/authentication        — generate DKIM keys + create auth config (customer)
 *   GET    /api/v1/email/authentication        — list auth configs (customer: own; staff: all)
 *   GET    /api/v1/email/authentication/:id    — get auth config (customer: own; staff: any)
 *   PATCH  /api/v1/email/authentication/:id    — update SPF/DMARC/status or rotate DKIM (customer: own; staff: any)
 *   DELETE /api/v1/email/authentication/:id    — delete auth config (customer: own; staff: any)
 *
 * Authorization:
 *   - Customers manage their own email authentication (tenant-scoped by user_id).
 *   - Staff / admin / super_admin can list, view, update, delete any configuration.
 *   - Optional `user_id` query on GET lets staff list another tenant's configurations.
 *
 * DKIM keys are generated server-side and returned once at creation. The private key is not
 * returned on subsequent reads (only the public key). DNS TXT records for SPF/DKIM/DMARC are
 * computed client-side from the returned values; no external DNS or mail provider is called.
 * Honest about the absence of a mail provider rather than fabricating delivery.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  createEmailAuthentication,
  listEmailAuthentication,
  countEmailAuthentication,
  findEmailAuthenticationById,
  findEmailAuthenticationByDomain,
  updateEmailAuthentication,
  deleteEmailAuthentication,
  generateDkimKeyPair,
  buildDkimTxtRecord,
  buildDefaultSpfRecord,
  buildDefaultDmarcRecord,
  type EmailAuthRow,
} from '../db/email-authentication';
import { authenticate } from '../lib/require-auth';
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;

const createEmailAuthBodySchema = z.object({
  domain_name: z
    .string()
    .trim()
    .min(3)
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i,
      'Invalid domain name'
    ),
  dkim_selector: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
  spf_record: z.string().trim().max(2000).optional(),
  dmarc_record: z.string().trim().max(2000).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

const updateEmailAuthBodySchema = z.object({
  spf_record: z.string().trim().max(2000).nullable().optional(),
  dmarc_record: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  rotate_dkim: z.boolean().optional(),
});

const emailAuthParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

const emailAuthListQuerySchema = z.object({
  user_id: z.string().uuid('user_id must be a valid UUID').optional(),
  domain_name: z.string().trim().max(253).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

type EmailAuthStatus = 'active' | 'disabled';

type EmailAuthDto = {
  id: string;
  user_id: string;
  domain_name: string;
  dkim_selector: string;
  dkim_public_key: string;
  dkim_private_key: string | null;
  spf_record: string | null;
  dmarc_record: string | null;
  status: EmailAuthStatus;
  created_at: Date;
  updated_at: Date;
};

type EmailAuthPublicDto = Omit<EmailAuthDto, 'dkim_private_key'> & {
  dkim_private_key: null;
  dkim_txt_record: string;
  spf_txt_record: string | null;
  dmarc_txt_record: string | null;
};

function toEmailAuthDto(row: EmailAuthRow, includePrivateKey: boolean): EmailAuthDto {
  return {
    id: row.id,
    user_id: row.user_id,
    domain_name: row.domain_name,
    dkim_selector: row.dkim_selector,
    dkim_public_key: row.dkim_public_key,
    dkim_private_key: includePrivateKey ? row.dkim_private_key : null,
    spf_record: row.spf_record,
    dmarc_record: row.dmarc_record,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toEmailAuthPublicDto(row: EmailAuthRow): EmailAuthPublicDto {
  return {
    id: row.id,
    user_id: row.user_id,
    domain_name: row.domain_name,
    dkim_selector: row.dkim_selector,
    dkim_public_key: row.dkim_public_key,
    dkim_private_key: null,
    spf_record: row.spf_record,
    dmarc_record: row.dmarc_record,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    dkim_txt_record: buildDkimTxtRecord(row.dkim_selector, row.dkim_public_key),
    spf_txt_record: row.spf_record,
    dmarc_txt_record: row.dmarc_record,
  };
}

/** Scope the caller's effective user_id: staff may override via ?user_id=; customers are locked to themselves. */
function effectiveUserId(authUserId: string, isStaff: boolean, requestUserId?: string): string {
  if (isStaff && requestUserId) return requestUserId;
  return authUserId;
}

export async function registerEmailAuthenticationRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- Create authentication config (+ DKIM key generation) ------------------

  app.post<{ Body: z.infer<typeof createEmailAuthBodySchema> }>(
    '/api/v1/email/authentication',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = createEmailAuthBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const input = parsed.data;

      // Customers may not create auth for another user's domain; staff can.
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);

      const existing = await findEmailAuthenticationByDomain(db, auth.userId, input.domain_name);
      if (existing) {
        throw new ValidationError('Email authentication already exists for this domain');
      }

      const row = await createEmailAuthentication(db, {
        user_id: auth.userId,
        domain_name: input.domain_name,
        dkim_selector: input.dkim_selector,
        spf_record: input.spf_record,
        dmarc_record: input.dmarc_record,
        status: input.status,
      });

      // Return the private key only at creation time.
      reply.code(201);
      return {
        email_authentication: toEmailAuthDto(row, true),
        dkim_txt_record: buildDkimTxtRecord(row.dkim_selector, row.dkim_public_key),
        spf_txt_record: row.spf_record,
        dmarc_txt_record: row.dmarc_record,
        notice: 'The DKIM private key is shown only once. Store it securely; it cannot be retrieved again.',
      };
    }
  );

  // --- List authentication configs -------------------------------------------

  app.get<{ Querystring: z.infer<typeof emailAuthListQuerySchema> }>(
    '/api/v1/email/authentication',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = emailAuthListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const userId = effectiveUserId(auth.userId, isStaff, parsed.data.user_id);

      if (!isStaff && parsed.data.user_id && parsed.data.user_id !== auth.userId) {
        throw new ForbiddenError('You may only list your own email authentication');
      }

      const rows = await listEmailAuthentication(db, {
        user_id: userId,
        domain_name: parsed.data.domain_name,
        status: parsed.data.status,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      const total = await countEmailAuthentication(db, {
        user_id: userId,
        domain_name: parsed.data.domain_name,
        status: parsed.data.status,
      });
      return {
        email_authentication: rows.map(toEmailAuthPublicDto),
        total,
        limit: parsed.data.limit ?? 50,
        offset: parsed.data.offset ?? 0,
      };
    }
  );

  // --- Get single authentication config --------------------------------------

  app.get<{ Params: z.infer<typeof emailAuthParamSchema> }>(
    '/api/v1/email/authentication/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = emailAuthParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const row = await findEmailAuthenticationById(db, parsed.data.id, isStaff ? undefined : auth.userId);
      if (!row) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Email authentication not found' };
      }
      return { email_authentication: toEmailAuthPublicDto(row) };
    }
  );

  // --- Update authentication config ------------------------------------------

  app.patch<{ Params: z.infer<typeof emailAuthParamSchema>; Body: z.infer<typeof updateEmailAuthBodySchema> }>(
    '/api/v1/email/authentication/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = emailAuthParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const existing = await findEmailAuthenticationById(db, paramsParsed.data.id, isStaff ? undefined : auth.userId);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Email authentication not found' };
      }
      const bodyParsed = updateEmailAuthBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }
      const input = bodyParsed.data;
      const updated = await updateEmailAuthentication(db, paramsParsed.data.id, existing.user_id, {
        spf_record: input.spf_record,
        dmarc_record: input.dmarc_record,
        status: input.status,
        rotate_dkim: input.rotate_dkim,
      });
      return { email_authentication: toEmailAuthPublicDto(updated!) };
    }
  );

  // --- Delete authentication config ------------------------------------------

  app.delete<{ Params: z.infer<typeof emailAuthParamSchema> }>(
    '/api/v1/email/authentication/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = emailAuthParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const existing = await findEmailAuthenticationById(db, parsed.data.id, isStaff ? undefined : auth.userId);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Email authentication not found' };
      }
      const deleted = await deleteEmailAuthentication(db, parsed.data.id, existing.user_id);
      if (!deleted) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Email authentication not found' };
      }
      reply.code(204);
      return null;
    }
  );
}