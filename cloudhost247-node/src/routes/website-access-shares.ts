/**
 * Website access sharing (J03 — J Agency).
 *
 *   POST   /api/v1/agency/website-access/shares              — share a site with a user
 *   GET    /api/v1/agency/website-access/shares              — list shares (filters: site_id, granted_to_user_id, status)
 *   GET    /api/v1/agency/website-access/shares/:id          — get a share
 *   PATCH  /api/v1/agency/website-access/shares/:id          — update permission_level / status / expires_at
 *   DELETE /api/v1/agency/website-access/shares/:id          — revoke a share
 *
 * Authorization:
 *   - Staff / admin / super_admin can manage any share.
 *   - Customers can create shares for sites they own (granted_by_user_id = auth.userId)
 *     and list shares involving them (as grantor or grantee).
 *   - Customers can revoke shares they granted.
 *
 * No external SSO/OAuth provider is called — this is an internal access-control
 * store only.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  createWebsiteAccessShare,
  getWebsiteAccessShare,
  listWebsiteAccessShares,
  listSitesSharedWithUser,
  listSharesForSite,
  revokeWebsiteAccessShare,
  updateWebsiteAccessShare,
  type WebsiteAccessShareRow,
} from '../db/website-access-shares';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';

const STAFF_ROLES = ['staff', 'admin', 'super_admin'] as const;

const shareIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

const shareListQuerySchema = z.object({
  site_id: z.string().uuid().optional(),
  granted_to_user_id: z.string().uuid().optional(),
  status: z.enum(['active', 'revoked']).optional(),
});

const shareCreateBodySchema = z.object({
  site_id: z.string().uuid('site_id must be a valid UUID'),
  granted_to_user_id: z.string().uuid('granted_to_user_id must be a valid UUID'),
  permission_level: z.enum(['viewer', 'editor']).optional(),
  expires_at: z.string().datetime().optional().nullable(),
});

const shareUpdateBodySchema = z.object({
  permission_level: z.enum(['viewer', 'editor']).optional(),
  status: z.enum(['active', 'revoked']).optional(),
  expires_at: z.string().datetime().optional().nullable(),
});

type WebsiteAccessShareDto = {
  id: string;
  site_id: string;
  granted_to_user_id: string;
  granted_by_user_id: string;
  permission_level: 'viewer' | 'editor';
  status: 'active' | 'revoked';
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toWebsiteAccessShareDto(row: WebsiteAccessShareRow): WebsiteAccessShareDto {
  return {
    id: row.id,
    site_id: row.site_id,
    granted_to_user_id: row.granted_to_user_id,
    granted_by_user_id: row.granted_by_user_id,
    permission_level: row.permission_level,
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function registerWebsiteAccessShareRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  const db = pool ?? getPool(env);

  // --- List website access shares --------------------------------------------

  app.get<{ Querystring: z.infer<typeof shareListQuerySchema> }>(
    '/api/v1/agency/website-access/shares',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = shareListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const filters: { site_id?: string; granted_to_user_id?: string; granted_by_user_id?: string; status?: 'active' | 'revoked' } = {};
      if (parsed.data.site_id) filters.site_id = parsed.data.site_id;
      if (parsed.data.granted_to_user_id) filters.granted_to_user_id = parsed.data.granted_to_user_id;
      if (parsed.data.status) filters.status = parsed.data.status;

      // Non-staff customers only see shares they granted or received.
      if (!isStaff) {
        filters.granted_by_user_id = auth.userId;
      }

      const rows = await listWebsiteAccessShares(db, filters);

      // For non-staff with granted_to_user_id filter, also include shares received.
      if (!isStaff && parsed.data.granted_to_user_id && parsed.data.granted_to_user_id === auth.userId) {
        const received = await listSitesSharedWithUser(db, auth.userId);
        const byId = new Map<string, WebsiteAccessShareRow>();
        for (const r of [...rows, ...received]) byId.set(r.id, r);
        return { website_access_shares: Array.from(byId.values()).map(toWebsiteAccessShareDto) };
      }

      return { website_access_shares: rows.map(toWebsiteAccessShareDto) };
    },
  );

  // --- Create a website access share -----------------------------------------

  app.post<{ Body: z.infer<typeof shareCreateBodySchema> }>(
    '/api/v1/agency/website-access/shares',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const parsed = shareCreateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }

      // Check for existing active share to this user on this site
      const existingShares = await listWebsiteAccessShares(db, {
        site_id: parsed.data.site_id,
        granted_to_user_id: parsed.data.granted_to_user_id,
        status: 'active',
      });
      if (existingShares.length > 0) {
        throw new ValidationError('An active share already exists for this user on this site');
      }

      let expiresAt: Date | null = null;
      if (parsed.data.expires_at) {
        expiresAt = new Date(parsed.data.expires_at);
      }

      const row = await createWebsiteAccessShare(db, {
        site_id: parsed.data.site_id,
        granted_to_user_id: parsed.data.granted_to_user_id,
        granted_by_user_id: auth.userId,
        permission_level: parsed.data.permission_level,
        expires_at: expiresAt,
      });
      reply.code(201);
      return { website_access_share: toWebsiteAccessShareDto(row) };
    },
  );

  // --- Get a website access share --------------------------------------------

  app.get<{ Params: z.infer<typeof shareIdParamSchema> }>(
    '/api/v1/agency/website-access/shares/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = shareIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const row = await getWebsiteAccessShare(db, paramsParsed.data.id);
      if (!row) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Share not found' };
      }
      if (!isStaff && row.granted_by_user_id !== auth.userId && row.granted_to_user_id !== auth.userId) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Share not found' };
      }
      return { website_access_share: toWebsiteAccessShareDto(row) };
    },
  );

  // --- Update a website access share -----------------------------------------

  app.patch<{ Params: z.infer<typeof shareIdParamSchema>; Body: z.infer<typeof shareUpdateBodySchema> }>(
    '/api/v1/agency/website-access/shares/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const paramsParsed = shareIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const existing = await getWebsiteAccessShare(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Share not found' };
      }
      if (!isStaff && existing.granted_by_user_id !== auth.userId) {
        reply.code(403);
        return { error: 'FORBIDDEN', message: 'Can only update shares you granted' };
      }

      const bodyParsed = shareUpdateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        throw new ValidationError(bodyParsed.error.issues.map((i) => i.message).join(', '));
      }

      let expiresAt: Date | null = null;
      if (bodyParsed.data.expires_at !== undefined) {
        expiresAt = bodyParsed.data.expires_at ? new Date(bodyParsed.data.expires_at) : null;
      }

      const row = await updateWebsiteAccessShare(db, paramsParsed.data.id, {
        permission_level: bodyParsed.data.permission_level,
        status: bodyParsed.data.status,
        expires_at: expiresAt,
      });
      return { website_access_share: toWebsiteAccessShareDto(row!) };
    },
  );

  // --- Revoke a website access share -----------------------------------------

  app.delete<{ Params: z.infer<typeof shareIdParamSchema> }>(
    '/api/v1/agency/website-access/shares/:id',
    async (request, reply) => {
      const auth = await authenticate(request, env, db);
      const isStaff = STAFF_ROLES.includes(auth.role as (typeof STAFF_ROLES)[number]);
      const paramsParsed = shareIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        throw new ValidationError(paramsParsed.error.issues.map((i) => i.message).join(', '));
      }

      const existing = await getWebsiteAccessShare(db, paramsParsed.data.id);
      if (!existing) {
        reply.code(404);
        return { error: 'NOT_FOUND', message: 'Share not found' };
      }
      if (!isStaff && existing.granted_by_user_id !== auth.userId) {
        reply.code(403);
        return { error: 'FORBIDDEN', message: 'Can only revoke shares you granted' };
      }

      const row = await revokeWebsiteAccessShare(db, paramsParsed.data.id);
      return { website_access_share: toWebsiteAccessShareDto(row!) };
    },
  );
}
