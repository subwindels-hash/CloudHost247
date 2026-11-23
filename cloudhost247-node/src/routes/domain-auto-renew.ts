/**
 * Automatic renewal controls (I12).
 *
 *   GET    /api/v1/domains/:id/auto-renew   — get auto-renew status for a domain (customer: own; staff: any)
 *   PATCH  /api/v1/domains/:id/auto-renew   — toggle auto-renew for a domain (customer: own; staff: any)
 *
 * Authorization:
 *   - Customers manage auto-renew for their own domains (tenant-scoped by user_id).
 *   - Staff / admin / super_admin can view and toggle any domain.
 *
 * No registrar provider is configured — this is a stored preference only. Actual renewal
 * depends on a registrar integration that is not yet activated. Honest about the absence of
 * a registrar provider rather than fabricating renewal behavior.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  getDomainAutoRenew,
  setDomainAutoRenew,
  type DomainAutoRenewRow,
} from '../db/domain-auto-renew';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;

const autoRenewBodySchema = z.object({
  auto_renew: z.boolean(),
});

const domainIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

type DomainAutoRenewDto = {
  id: string;
  user_id: string;
  domain_name: string;
  auto_renew: boolean;
  updated_at: Date;
};

function toDomainAutoRenewDto(row: DomainAutoRenewRow): DomainAutoRenewDto {
  return {
    id: row.id,
    user_id: row.user_id,
    domain_name: row.domain_name,
    auto_renew: row.auto_renew,
    updated_at: row.updated_at,
  };
}

export async function registerDomainAutoRenewRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- Get auto-renew status -------------------------------------------------

  app.get<{ Params: z.infer<typeof domainIdParamSchema> }>(
    '/api/v1/domains/:id/auto-renew',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = domainIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const row = await getDomainAutoRenew(db, parsed.data.id, isStaff ? undefined : auth.userId);
      if (!row) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Domain not found' };
      }
      return { domain_auto_renew: toDomainAutoRenewDto(row) };
    }
  );

  // --- Toggle auto-renew -----------------------------------------------------

  app.patch<{ Params: z.infer<typeof domainIdParamSchema>; Body: z.infer<typeof autoRenewBodySchema> }>(
    '/api/v1/domains/:id/auto-renew',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = domainIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const existing = await getDomainAutoRenew(db, paramsParsed.data.id, isStaff ? undefined : auth.userId);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Domain not found' };
      }
      const bodyParsed = autoRenewBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }
      const updated = await setDomainAutoRenew(
        db,
        paramsParsed.data.id,
        existing.user_id,
        bodyParsed.data.auto_renew,
      );
      return { domain_auto_renew: toDomainAutoRenewDto(updated!) };
    }
  );
}