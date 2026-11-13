import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { requireRole } from '../lib/require-role';
import { auditRequest } from '../lib/audit';
import { ForbiddenError, ValidationError } from '../lib/errors';
import { loadAccess, type CommunityAccess } from '../community/permissions';
import {
  adminOverview,
  createCategory,
  disableCategory,
  listMemberBadgesForAdmin,
  listReportQueue,
  moderateDeleteDiscussion,
  moderateDeleteReply,
  resolveReport,
  restrictMember,
  setBadge,
  setDesignation,
  setDiscussionFlags,
  updateCategory,
} from '../community/community-admin';
import {
  getCategoryBySlug,
  listCategories,
  listDiscussions,
} from '../community/community-service';
import {
  publishAcceptedSolution,
  revokePublishedSolution,
} from '../community/community-knowledge';

/**
 * Community administration API.
 *
 * Every route is gated by `requireRole(['admin', 'super_admin'])`, which re-reads the caller's role
 * from the database on every request (src/lib/require-role.ts) rather than trusting a JWT claim or
 * anything the client sent. Two narrower rules are enforced inside the service and restated here:
 *
 *   * roles, badges and AI publication are super_admin only (a forum moderator cannot mint another
 *     moderator, and cannot teach the support assistant);
 *   * no route accepts an actor id, author id or "requested role" from the body. The actor is always
 *     the authenticated caller, and the role is always chosen from a fixed server-side tuple.
 *
 * Each privileged action writes one row to the platform's existing `audit_logs`.
 */

const idParam = z.object({ id: z.string().uuid('That identifier is not valid') });

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  return parsed.data;
}

async function adminAccess(request: FastifyRequest, env: Env, pool: Queryable): Promise<CommunityAccess> {
  const auth = await requireRole(request, env, pool, ['admin', 'super_admin']);
  return loadAccess(pool, auth.userId);
}

const categorySchema = z.object({
  slug: z.string().min(3).max(64).optional(),
  name: z.string().min(3).max(120).optional(),
  description: z.string().min(10).max(400).optional(),
  purpose: z.enum(['discussion', 'question', 'announcement', 'showcase']).optional(),
  acceptsSolutions: z.boolean().optional(),
  staffOnlyPosting: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
});

export async function registerAdminCommunityRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable): Promise<void> {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/admin/community/overview', async (request) => {
    await adminAccess(request, env, pool);
    return adminOverview(pool);
  });

  app.get('/api/v1/admin/community/categories', async (request) => {
    await adminAccess(request, env, pool);
    return { categories: await listCategories(pool, { includeDisabled: true }) };
  });

  app.post('/api/v1/admin/community/categories', async (request, reply) => {
    const access = await adminAccess(request, env, pool);
    const payload = parseOrThrow(
      categorySchema.extend({
        slug: z.string().min(3).max(64),
        name: z.string().min(3).max(120),
        description: z.string().min(10).max(400),
      }),
      request.body
    );
    const created = await createCategory(pool, {
      slug: payload.slug,
      name: payload.name,
      description: payload.description,
      purpose: payload.purpose,
      acceptsSolutions: payload.acceptsSolutions,
      staffOnlyPosting: payload.staffOnlyPosting,
      isEnabled: payload.isEnabled,
      position: payload.position,
    });
    await auditRequest(pool, request, access.userId, {
      action: 'community.category.created',
      resourceType: 'community_category',
      resourceId: created.id,
      metadata: { slug: payload.slug, name: payload.name, purpose: payload.purpose ?? 'discussion' },
    });
    reply.code(201);
    return created;
  });

  app.patch('/api/v1/admin/community/categories/:id', async (request) => {
    const access = await adminAccess(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(categorySchema, request.body);
    await updateCategory(pool, id, payload);
    await auditRequest(pool, request, access.userId, {
      action: 'community.category.updated',
      resourceType: 'community_category',
      resourceId: id,
      metadata: payload as Record<string, unknown>,
    });
    return { updated: true };
  });

  app.delete('/api/v1/admin/community/categories/:id', async (request) => {
    const access = await adminAccess(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await disableCategory(pool, id);
    await auditRequest(pool, request, access.userId, {
      action: 'community.category.disabled',
      resourceType: 'community_category',
      resourceId: id,
    });
    return { disabled: true };
  });

  app.get('/api/v1/admin/community/discussions', async (request) => {
    await adminAccess(request, env, pool);
    const query = parseOrThrow(
      z.object({ category: z.string().max(64).optional(), sort: z.enum(['latest', 'popular', 'unanswered', 'solved', 'trending']).optional(), page: z.coerce.number().int().positive().optional() }),
      request.query
    );
    return listDiscussions(pool, { categorySlug: query.category, sort: query.sort, page: query.page });
  });

  app.patch('/api/v1/admin/community/discussions/:id', async (request) => {
    const access = await adminAccess(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(z.object({ pinned: z.boolean().optional(), locked: z.boolean().optional() }), request.body);
    await setDiscussionFlags(pool, id, payload);
    await auditRequest(pool, request, access.userId, {
      action: 'community.discussion.flags',
      resourceType: 'community_discussion',
      resourceId: id,
      metadata: payload,
    });
    return { updated: true };
  });

  app.delete('/api/v1/admin/community/discussions/:id', async (request) => {
    const access = await adminAccess(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(z.object({ reason: z.string().max(300).optional() }), request.body ?? {});
    const removed = await moderateDeleteDiscussion(pool, access, id, payload.reason ?? '');
    await auditRequest(pool, request, access.userId, {
      action: 'community.discussion.removed',
      resourceType: 'community_discussion',
      resourceId: id,
      metadata: { reason: payload.reason ?? '', authorId: removed.authorId },
    });
    return { removed: true };
  });

  app.delete('/api/v1/admin/community/replies/:id', async (request) => {
    const access = await adminAccess(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(z.object({ reason: z.string().max(300).optional() }), request.body ?? {});
    const removed = await moderateDeleteReply(pool, access, id, payload.reason ?? '');
    await auditRequest(pool, request, access.userId, {
      action: 'community.reply.removed',
      resourceType: 'community_reply',
      resourceId: id,
      metadata: { reason: payload.reason ?? '', authorId: removed.authorId },
    });
    return { removed: true };
  });

  app.get('/api/v1/admin/community/reports', async (request) => {
    await adminAccess(request, env, pool);
    const query = parseOrThrow(z.object({ status: z.enum(['open', 'actioned', 'dismissed', 'all']).optional() }), request.query);
    return { reports: await listReportQueue(pool, query.status ?? 'open') };
  });

  app.post('/api/v1/admin/community/reports/:id/resolve', async (request) => {
    const access = await adminAccess(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(
      z.object({ action: z.enum(['actioned', 'dismissed']), note: z.string().max(500).optional() }),
      request.body
    );
    const report = await resolveReport(pool, access, id, payload.action, payload.note ?? '');
    await auditRequest(pool, request, access.userId, {
      action: `community.report.${payload.action}`,
      resourceType: 'community_report',
      resourceId: id,
      metadata: { targetType: report.targetType, targetId: report.targetId, note: payload.note ?? '' },
    });
    return { resolved: true };
  });

  app.post('/api/v1/admin/community/members/:id/restriction', async (request) => {
    const access = await adminAccess(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(
      z.object({ restrictedUntil: z.string().datetime({ offset: true }).nullable(), reason: z.string().max(300).optional() }),
      request.body
    );
    await restrictMember(pool, access, id, {
      restrictedUntil: payload.restrictedUntil,
      reason: payload.reason ?? '',
    });
    await auditRequest(pool, request, access.userId, {
      action: payload.restrictedUntil ? 'community.member.restricted' : 'community.member.restriction_cleared',
      resourceType: 'community_member',
      resourceId: id,
      metadata: { restrictedUntil: payload.restrictedUntil, reason: payload.reason ?? '' },
    });
    return { saved: true };
  });

  app.post('/api/v1/admin/community/members/:id/roles', async (request) => {
    const access = await adminAccess(request, env, pool);
    if (access.platformRole !== 'super_admin') {
      throw new ForbiddenError('Only a super administrator can grant or revoke community roles');
    }
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(
      z.object({ role: z.enum(['moderator', 'developer', 'staff']), grant: z.boolean() }),
      request.body
    );
    await setDesignation(pool, access, id, payload.role, payload.grant);
    await auditRequest(pool, request, access.userId, {
      action: payload.grant ? 'community.role.granted' : 'community.role.revoked',
      resourceType: 'community_member',
      resourceId: id,
      metadata: { role: payload.role },
    });
    return { saved: true };
  });

  app.get('/api/v1/admin/community/members/:id/badges', async (request) => {
    await adminAccess(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    return { badges: await listMemberBadgesForAdmin(pool, id) };
  });

  app.post('/api/v1/admin/community/members/:id/badges', async (request) => {
    const access = await adminAccess(request, env, pool);
    if (access.platformRole !== 'super_admin') {
      throw new ForbiddenError('Only a super administrator can grant or revoke community badges');
    }
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(z.object({ badge: z.string().min(2).max(48), grant: z.boolean() }), request.body);
    await setBadge(pool, access, id, payload.badge, payload.grant);
    await auditRequest(pool, request, access.userId, {
      action: payload.grant ? 'community.badge.granted' : 'community.badge.revoked',
      resourceType: 'community_member',
      resourceId: id,
      metadata: { badge: payload.badge },
    });
    return { saved: true };
  });

  // ---------------------------------------------------------------------------------------
  // AI knowledge base — publishing a verified solution. Super admin only.
  // ---------------------------------------------------------------------------------------

  app.post('/api/v1/admin/community/discussions/:id/publish-solution', async (request) => {
    const access = await adminAccess(request, env, pool);
    if (access.platformRole !== 'super_admin') {
      throw new ForbiddenError('Only a super administrator can publish a community answer to the knowledge base');
    }
    const { id } = parseOrThrow(idParam, request.params);
    const result = await publishAcceptedSolution(pool, id, access.userId);
    await auditRequest(pool, request, access.userId, {
      action: 'community.solution.published',
      resourceType: 'community_discussion',
      resourceId: id,
      metadata: { sourceId: result.sourceId, chunks: result.chunkCount, url: result.url, authorityTier: 4 },
    });
    return { published: true, ...result };
  });

  app.delete('/api/v1/admin/community/discussions/:id/publish-solution', async (request) => {
    const access = await adminAccess(request, env, pool);
    if (access.platformRole !== 'super_admin') {
      throw new ForbiddenError('Only a super administrator can withdraw a community answer from the knowledge base');
    }
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(z.object({ reason: z.string().max(300).optional() }), request.body ?? {});
    const revoked = await revokePublishedSolution(pool, id, access.userId, payload.reason ?? '');
    await auditRequest(pool, request, access.userId, {
      action: 'community.solution.revoked',
      resourceType: 'community_discussion',
      resourceId: id,
      metadata: { reason: payload.reason ?? '', revoked },
    });
    return { revoked };
  });

  app.get('/api/v1/admin/community/solutions', async (request) => {
    await adminAccess(request, env, pool);
    const { rows } = await pool.query<{
      id: string; title: string; url: string | null; sync_status: string; approval_status: string;
      authority_tier: number; chunk_count: number; last_synced_at: string | null; excluded: boolean;
      source_key: string | null;
    }>(
      `SELECT id, title, url, sync_status, approval_status, authority_tier, chunk_count, last_synced_at, excluded, source_key
         FROM ai_knowledge_sources WHERE source_kind = 'community_solution'
        ORDER BY last_synced_at DESC NULLS LAST LIMIT 200`
    );
    return { solutions: rows };
  });

  // The admin console needs the category list including disabled ones; it also wants a direct way
  // to fetch one category by slug while editing.
  app.get('/api/v1/admin/community/categories/:slug', async (request) => {
    await adminAccess(request, env, pool);
    const { slug } = parseOrThrow(z.object({ slug: z.string().min(1).max(64) }), request.params);
    const category = await getCategoryBySlug(pool, slug);
    return { category };
  });
}
