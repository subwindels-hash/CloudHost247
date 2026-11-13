import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { authenticate } from '../lib/require-auth';
import { ValidationError, NotFoundError } from '../lib/errors';
import { loadAccess, type CommunityAccess } from '../community/permissions';
import {
  acceptSolution,
  addAttachment,
  communityHome,
  createDiscussion,
  createReply,
  createReport,
  deleteDiscussion,
  deleteReply,
  getAttachment,
  getCategoryBySlug,
  getDiscussionBySlug,
  getMemberProfile,
  listBookmarks,
  listCategories,
  listCommunityNotifications,
  listDiscussions,
  listMemberBadgeList,
  listMembers,
  markNotificationsRead,
  recordView,
  removeSolution,
  searchCommunity,
  toggleBookmark,
  toggleReaction,
  toggleSubscription,
  touchMember,
  updateDiscussion,
  updateMemberProfile,
  updateReply,
  MAX_ATTACHMENT_BYTES,
} from '../community/community-service';
import { listPreferences, setPreference, isCommunityNotificationType } from '../community/community-notifications';
import { ensureMemberRow } from '../community/reputation';

/**
 * Community Forum API — public reads and member writes.
 *
 * Authorization is established here and nowhere else: `member()` authenticates the bearer token,
 * re-reads the caller's role/status from the database (src/lib/require-auth.ts) and resolves their
 * community designations (src/community/permissions.ts). A write handler passes that object to the
 * service; no handler forwards a role, author id or moderation flag taken from the request body.
 *
 * Public reads (`/home`, categories, discussions, search, members) are anonymous, exactly like the
 * rest of the public site. A viewer who happens to be signed in additionally learns whether *they*
 * reacted/bookmarked a thread — never anything about anyone else.
 */

const idParam = z.object({ id: z.string().uuid('That identifier is not valid') });
const slugParam = z.object({ slug: z.string().min(1).max(200) });

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  return parsed.data;
}

const createDiscussionSchema = z.object({
  categoryId: z.string().uuid('Choose a category'),
  title: z.string().min(8, 'Give your discussion a descriptive title').max(200),
  body: z.string().min(10, 'Write a little more detail').max(20_000),
  tags: z.array(z.string()).max(20).optional(),
});

const updateDiscussionSchema = z.object({
  title: z.string().min(8).max(200).optional(),
  body: z.string().min(10).max(20_000).optional(),
  tags: z.array(z.string()).max(20).optional(),
});

const createReplySchema = z.object({
  body: z.string().min(2, 'Write a reply before posting').max(20_000),
  parentId: z.string().uuid().nullish(),
});

const reactionSchema = z.object({
  targetType: z.enum(['discussion', 'reply']),
  targetId: z.string().uuid(),
  kind: z.enum(['like', 'helpful', 'insightful']).optional(),
});

const reportSchema = z.object({
  targetType: z.enum(['discussion', 'reply', 'member']),
  targetId: z.string().uuid(),
  reason: z.enum(['spam', 'abuse', 'off_topic', 'inaccurate', 'security', 'other']),
  detail: z.string().max(1000).optional(),
});

const settingsSchema = z.object({
  bio: z.string().max(600).optional(),
  location: z.string().max(120).nullable().optional(),
  websiteUrl: z.string().max(200).nullable().optional(),
  directoryListed: z.boolean().optional(),
  notificationPreferences: z
    .array(z.object({ type: z.string(), inApp: z.boolean(), email: z.boolean() }))
    .max(20)
    .optional(),
});

const attachmentSchema = z.object({
  discussionId: z.string().uuid(),
  replyId: z.string().uuid().nullish(),
  fileName: z.string().min(1).max(120),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  dataBase64: z.string().min(16).max(Math.ceil(MAX_ATTACHMENT_BYTES * 1.4)),
});

/** Signed-in caller, with their live community authority. Throws 401 when the token is unusable. */
async function member(request: FastifyRequest, env: Env, pool: Queryable): Promise<CommunityAccess> {
  const auth = await authenticate(request, env, pool);
  return loadAccess(pool, auth.userId);
}

/** Same, but an anonymous visitor is simply `null` — used by read routes only. */
async function optionalMember(request: FastifyRequest, env: Env, pool: Queryable): Promise<CommunityAccess | null> {
  if (!request.headers.authorization) return null;
  try {
    return await member(request, env, pool);
  } catch {
    // An expired token on a public page must not turn a readable thread into an error page.
    return null;
  }
}

export async function registerCommunityRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable): Promise<void> {
  const pool = overridePool ?? getPool(env);

  // ---------------------------------------------------------------------------------------
  // Community home, categories, member directory
  // ---------------------------------------------------------------------------------------

  app.get('/api/v1/community/home', async (request) => {
    const viewer = await optionalMember(request, env, pool);
    if (viewer) await touchMember(pool, viewer.userId).catch(() => undefined);
    return communityHome(pool, viewer);
  });

  app.get('/api/v1/community/categories', async () => ({ categories: await listCategories(pool) }));

  app.get('/api/v1/community/categories/:slug', async (request) => {
    const { slug } = parseOrThrow(slugParam, request.params);
    const category = await getCategoryBySlug(pool, slug);
    if (!category || !category.isEnabled) throw new NotFoundError('That community category does not exist');
    const discussions = await listDiscussions(pool, { categorySlug: slug, page: 1, pageSize: 20 });
    return { category, discussions };
  });

  app.get('/api/v1/community/members', async (request) => {
    const query = parseOrThrow(
      z.object({ sort: z.enum(['reputation', 'active', 'new']).optional(), page: z.coerce.number().int().positive().optional(), q: z.string().max(80).optional() }),
      request.query
    );
    return listMembers(pool, query);
  });

  app.get('/api/v1/community/members/:username', async (request) => {
    const { username } = parseOrThrow(z.object({ username: z.string().min(3).max(32) }), request.params);
    const viewer = await optionalMember(request, env, pool);
    return getMemberProfile(pool, username, viewer);
  });

  app.get('/api/v1/community/developers', async () => {
    const [categories, discussions] = await Promise.all([
      listCategories(pool),
      listDiscussions(pool, { categorySlug: 'developer-corner', pageSize: 10 }),
    ]);
    const developerCategories = categories.filter((category) =>
      ['developer-corner', 'tutorials-and-guides', 'web-development', 'vps-and-dedicated', 'domains-and-dns'].includes(category.slug)
    );
    const contributors = await listMembers(pool, { sort: 'reputation', page: 1 });
    return {
      categories: developerCategories,
      discussions: discussions.items,
      // A "developer" here is a member with the verified developer designation or CloudHost247
      // staff who answer developer questions — never an inferred one. The list can legitimately be
      // empty on a young community, and the page says so rather than inventing a roster.
      developers: contributors.items.filter((entry) => entry.standing === 'developer' || entry.standing === 'staff'),
      members: contributors.items.slice(0, 12),
    };
  });

  // ---------------------------------------------------------------------------------------
  // Discussions
  // ---------------------------------------------------------------------------------------

  app.get('/api/v1/community/discussions', async (request) => {
    const query = parseOrThrow(
      z.object({
        category: z.string().max(64).optional(),
        sort: z.enum(['latest', 'popular', 'unanswered', 'solved', 'trending']).optional(),
        tag: z.string().max(32).optional(),
        page: z.coerce.number().int().positive().optional(),
        pageSize: z.coerce.number().int().positive().max(50).optional(),
      }),
      request.query
    );
    return listDiscussions(pool, { categorySlug: query.category, sort: query.sort, tag: query.tag, page: query.page, pageSize: query.pageSize });
  });

  app.get('/api/v1/community/discussions/:slug', async (request) => {
    const { slug } = parseOrThrow(slugParam, request.params);
    const viewer = await optionalMember(request, env, pool);
    return getDiscussionBySlug(pool, slug, viewer);
  });

  app.post(
    '/api/v1/community/discussions/:slug/view',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const { slug } = parseOrThrow(slugParam, request.params);
      const discussion = await getDiscussionBySlug(pool, slug, null).catch(() => null);
      if (discussion) await recordView(pool, discussion.discussion.id);
      return { recorded: Boolean(discussion) };
    }
  );

  app.get('/api/v1/community/search', async (request) => {
    const query = parseOrThrow(z.object({ q: z.string().max(120).optional(), page: z.coerce.number().int().positive().optional() }), request.query);
    return searchCommunity(pool, query.q ?? '', query.page);
  });

  app.post(
    '/api/v1/community/discussions',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const access = await member(request, env, pool);
      const payload = parseOrThrow(createDiscussionSchema, request.body);
      const created = await createDiscussion(pool, access, payload);
      reply.code(201);
      return created;
    }
  );

  app.patch('/api/v1/community/discussions/:id', async (request) => {
    const access = await member(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(updateDiscussionSchema, request.body);
    await updateDiscussion(pool, access, id, payload);
    return { updated: true };
  });

  app.delete('/api/v1/community/discussions/:id', async (request) => {
    const access = await member(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await deleteDiscussion(pool, access, id);
    return { deleted: true };
  });

  app.post(
    '/api/v1/community/discussions/:id/replies',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const access = await member(request, env, pool);
      const { id } = parseOrThrow(idParam, request.params);
      const payload = parseOrThrow(createReplySchema, request.body);
      const created = await createReply(pool, access, id, payload);
      reply.code(201);
      return created;
    }
  );

  app.post('/api/v1/community/discussions/:id/accept', async (request) => {
    const access = await member(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(z.object({ replyId: z.string().uuid() }), request.body);
    await acceptSolution(pool, access, id, payload.replyId);
    return { accepted: true };
  });

  app.delete('/api/v1/community/discussions/:id/accept', async (request) => {
    const access = await member(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await removeSolution(pool, access, id);
    return { accepted: false };
  });

  app.post('/api/v1/community/discussions/:id/bookmark', async (request) => {
    const access = await member(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    return toggleBookmark(pool, access, id);
  });

  app.post('/api/v1/community/discussions/:id/subscribe', async (request) => {
    const access = await member(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    return toggleSubscription(pool, access, 'discussion', id);
  });

  // ---------------------------------------------------------------------------------------
  // Replies, reactions, reports
  // ---------------------------------------------------------------------------------------

  app.patch('/api/v1/community/replies/:id', async (request) => {
    const access = await member(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    const payload = parseOrThrow(z.object({ body: z.string().min(2).max(20_000) }), request.body);
    await updateReply(pool, access, id, payload.body);
    return { updated: true };
  });

  app.delete('/api/v1/community/replies/:id', async (request) => {
    const access = await member(request, env, pool);
    const { id } = parseOrThrow(idParam, request.params);
    await deleteReply(pool, access, id);
    return { deleted: true };
  });

  app.post(
    '/api/v1/community/reactions',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const access = await member(request, env, pool);
      const payload = parseOrThrow(reactionSchema, request.body);
      return toggleReaction(pool, access, payload.targetType, payload.targetId, payload.kind ?? 'like');
    }
  );

  app.post(
    '/api/v1/community/reports',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const access = await member(request, env, pool);
      const payload = parseOrThrow(reportSchema, request.body);
      const created = await createReport(pool, access, payload);
      reply.code(201);
      return created;
    }
  );

  // ---------------------------------------------------------------------------------------
  // Attachments — authenticated upload, public read of an attachment on a live discussion.
  // ---------------------------------------------------------------------------------------

  app.post(
    '/api/v1/community/attachments',
    { bodyLimit: 4 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const access = await member(request, env, pool);
      const payload = parseOrThrow(attachmentSchema, request.body);
      const attachment = await addAttachment(pool, access, payload);
      reply.code(201);
      return attachment;
    }
  );

  app.get('/api/v1/community/attachments/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParam, request.params);
    const attachment = await getAttachment(pool, id);
    if (!attachment) throw new NotFoundError('That attachment does not exist');
    // Never a download-by-default and never a sniffable type: an image is served inline, with the
    // type detected from its bytes at upload time, and the browser is told not to re-interpret it.
    return reply
      .header('Content-Type', attachment.mimeType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `inline; filename="${attachment.fileName.replace(/"/g, '')}"`)
      .header('Cache-Control', 'private, max-age=3600')
      .send(attachment.content);
  });

  // ---------------------------------------------------------------------------------------
  // Member area: profile, settings, bookmarks, notifications
  // ---------------------------------------------------------------------------------------

  app.get('/api/v1/community/me', async (request) => {
    const access = await member(request, env, pool);
    await touchMember(pool, access.userId).catch(() => undefined);
    const [badges, preferences] = await Promise.all([
      listMemberBadgeList(pool, access.userId),
      listPreferences(pool, access.userId),
    ]);
    return {
      userId: access.userId,
      username: access.username,
      displayName: access.displayName,
      standing: access.isStaff ? 'staff' : access.isModerator ? 'moderator' : access.isDeveloper ? 'developer' : 'member',
      designations: access.designations,
      reputation: access.member.reputation,
      acceptedAnswers: access.member.accepted_answers,
      joinedAt: access.member.joined_at,
      bio: access.member.bio,
      location: access.member.location,
      websiteUrl: access.member.website_url,
      directoryListed: access.member.directory_listed,
      restrictedUntil: access.member.restricted_until,
      restrictionReason: access.restrictionReason,
      canModerate: access.isModerator,
      isSuperAdmin: access.platformRole === 'super_admin',
      badges,
      notificationPreferences: preferences,
    };
  });

  app.get('/api/v1/community/settings', async (request) => {
    const access = await member(request, env, pool);
    return {
      bio: access.member.bio,
      location: access.member.location,
      websiteUrl: access.member.website_url,
      directoryListed: access.member.directory_listed,
      notificationPreferences: await listPreferences(pool, access.userId),
    };
  });

  app.put('/api/v1/community/settings', async (request) => {
    const access = await member(request, env, pool);
    const payload = parseOrThrow(settingsSchema, request.body);
    await ensureMemberRow(pool, access.userId);
    await updateMemberProfile(pool, access, {
      bio: payload.bio,
      location: payload.location,
      websiteUrl: payload.websiteUrl,
      directoryListed: payload.directoryListed,
    });
    if (payload.notificationPreferences) {
      for (const preference of payload.notificationPreferences) {
        if (!isCommunityNotificationType(preference.type)) {
          throw new ValidationError(`Unknown notification type: ${preference.type}`);
        }
        await setPreference(pool, access.userId, preference.type, {
          inApp: preference.inApp,
          email: preference.email,
        });
      }
    }
    return { saved: true, notificationPreferences: await listPreferences(pool, access.userId) };
  });

  app.get('/api/v1/community/bookmarks', async (request) => {
    const access = await member(request, env, pool);
    const query = parseOrThrow(z.object({ page: z.coerce.number().int().positive().optional() }), request.query);
    return listBookmarks(pool, access, query.page);
  });

  app.get('/api/v1/community/notifications', async (request) => {
    const access = await member(request, env, pool);
    return { notifications: await listCommunityNotifications(pool, access.userId) };
  });

  app.post('/api/v1/community/notifications/read', async (request) => {
    const access = await member(request, env, pool);
    const payload = parseOrThrow(z.object({ ids: z.array(z.string().uuid()).max(200).optional() }), request.body ?? {});
    const updated = await markNotificationsRead(pool, access.userId, payload.ids);
    return { marked: updated };
  });
}
