import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import {
  assertAuthorOrModerator,
  assertCanPost,
  assertModerator,
  fallbackUsername,
  type CommunityAccess,
} from './permissions';
import {
  awardAutomaticBadge,
  awardReputation,
  ensureMemberRow,
  listMemberBadges,
} from './reputation';
import { notifyCommunity } from './community-notifications';
import { normaliseBody, normaliseTags, safeFileName, slugify, stripMarkdown, truncate } from './text';

/**
 * The Community Forum service.
 *
 * Every write takes an already-resolved `CommunityAccess` (src/community/permissions.ts) — it is
 * never rebuilt from request input, and no function here reads a role, author id or moderation flag
 * from the payload. Reads take an optional viewer id used only for "did *I* react / bookmark this",
 * never for authorization.
 *
 * Content is Markdown and is stored verbatim; the client renders it to React elements, so no user
 * string is ever interpreted as HTML (see the note in src/community/text.ts).
 */

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;
const REPLY_EDIT_WINDOW_MS = 30 * 60 * 1000;
const DISCUSSION_EDIT_WINDOW_MS = 60 * 60 * 1000;
export const MAX_ATTACHMENTS_PER_POST = 3;
export const MAX_ATTACHMENT_BYTES = 1_572_864; // 1.5 MiB — matches the CHECK in 0103.

export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  purpose: string;
  acceptsSolutions: boolean;
  staffOnlyPosting: boolean;
  isEnabled: boolean;
  position: number;
  discussionCount: number;
  replyCount: number;
  solvedCount: number;
  lastActivityAt: string | null;
}

export interface CommunityAuthor {
  id: string;
  username: string;
  displayName: string;
  /** staff | moderator | developer | member — shown as a badge next to the name. */
  standing: 'staff' | 'moderator' | 'developer' | 'member';
  reputation: number;
  joinedAt: string;
}

export interface DiscussionSummary {
  id: string;
  slug: string;
  title: string;
  preview: string;
  tags: string[];
  category: { id: string; slug: string; name: string };
  author: CommunityAuthor;
  isPinned: boolean;
  isLocked: boolean;
  isSolved: boolean;
  replyCount: number;
  reactionCount: number;
  viewCount: number;
  lastActivityAt: string;
  createdAt: string;
}

export interface AttachmentSummary {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  url: string;
}

interface AuthorColumnsRow {
  author_id: string;
  author_username: string | null;
  author_full_name: string;
  author_platform_role: string;
  author_reputation: number | string | null;
  author_joined_at: string;
  author_designations: string[] | null;
}

const AUTHOR_SELECT = `
  u.id AS author_id,
  u.username AS author_username,
  u.full_name AS author_full_name,
  u.role AS author_platform_role,
  coalesce(m.reputation, 0) AS author_reputation,
  coalesce(m.joined_at, u.created_at) AS author_joined_at,
  coalesce((SELECT array_agg(r.role) FROM community_staff_roles r WHERE r.user_id = u.id), '{}') AS author_designations
`;

const AUTHOR_JOIN = `
  JOIN users u ON u.id = %AUTHOR%
  LEFT JOIN community_members m ON m.user_id = u.id
`;

function authorJoin(column: string): string {
  return AUTHOR_JOIN.replace('%AUTHOR%', column);
}

export function mapAuthor(row: AuthorColumnsRow): CommunityAuthor {
  const designations = row.author_designations ?? [];
  const standing: CommunityAuthor['standing'] =
    row.author_platform_role === 'admin' || row.author_platform_role === 'super_admin' || designations.includes('staff')
      ? 'staff'
      : designations.includes('moderator')
        ? 'moderator'
        : designations.includes('developer')
          ? 'developer'
          : 'member';
  return {
    id: row.author_id,
    username: fallbackUsername(row.author_id, row.author_username),
    displayName: (row.author_full_name ?? '').trim() || fallbackUsername(row.author_id, row.author_username),
    standing,
    reputation: Number(row.author_reputation ?? 0),
    joinedAt: row.author_joined_at,
  };
}

function clampPage(value: number | undefined, pageSize = PAGE_SIZE_DEFAULT): { page: number; pageSize: number; offset: number } {
  const page = Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : 1;
  const size = Math.min(Math.max(pageSize, 1), PAGE_SIZE_MAX);
  return { page, pageSize: size, offset: (page - 1) * size };
}

// -------------------------------------------------------------------------------------------
// Categories
// -------------------------------------------------------------------------------------------

export async function listCategories(db: Queryable, options: { includeDisabled?: boolean } = {}): Promise<CategorySummary[]> {
  const { rows } = await db.query<{
    id: string; slug: string; name: string; description: string; purpose: string;
    accepts_solutions: boolean; staff_only_posting: boolean; is_enabled: boolean; position: number;
    discussion_count: string; reply_count: string; solved_count: string; last_activity_at: string | null;
  }>(
    `SELECT c.id, c.slug, c.name, c.description, c.purpose, c.accepts_solutions, c.staff_only_posting,
            c.is_enabled, c.position,
            coalesce(d.discussion_count, 0) AS discussion_count,
            coalesce(d.reply_count, 0) AS reply_count,
            coalesce(d.solved_count, 0) AS solved_count,
            d.last_activity_at
       FROM community_categories c
       LEFT JOIN LATERAL (
         SELECT count(*) AS discussion_count,
                coalesce(sum(x.reply_count), 0) AS reply_count,
                count(*) FILTER (WHERE x.accepted_reply_id IS NOT NULL) AS solved_count,
                max(x.last_activity_at) AS last_activity_at
           FROM community_discussions x
          WHERE x.category_id = c.id AND x.deleted_at IS NULL
       ) d ON true
      ${options.includeDisabled ? '' : 'WHERE c.is_enabled = true'}
      ORDER BY c.position ASC, c.name ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    purpose: row.purpose,
    acceptsSolutions: row.accepts_solutions,
    staffOnlyPosting: row.staff_only_posting,
    isEnabled: row.is_enabled,
    position: Number(row.position),
    discussionCount: Number(row.discussion_count),
    replyCount: Number(row.reply_count),
    solvedCount: Number(row.solved_count),
    lastActivityAt: row.last_activity_at,
  }));
}

export async function getCategoryBySlug(db: Queryable, slug: string): Promise<CategorySummary | null> {
  const categories = await listCategories(db, { includeDisabled: true });
  return categories.find((category) => category.slug.toLowerCase() === String(slug).toLowerCase()) ?? null;
}

// -------------------------------------------------------------------------------------------
// Discussions
// -------------------------------------------------------------------------------------------

interface DiscussionRow extends AuthorColumnsRow {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[] | null;
  category_id: string;
  category_slug: string;
  category_name: string;
  category_purpose: string;
  category_accepts_solutions: boolean;
  category_staff_only: boolean;
  category_enabled: boolean;
  is_pinned: boolean;
  is_locked: boolean;
  accepted_reply_id: string | null;
  view_count: number;
  reply_count: number;
  reaction_count: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  ai_source_id: string | null;
  ai_published_at: string | null;
  viewer_reacted?: boolean;
  viewer_bookmarked?: boolean;
  viewer_subscribed?: boolean;
}

const DISCUSSION_SELECT = `
  d.id, d.slug, d.title, d.body, d.tags, d.is_pinned, d.is_locked, d.accepted_reply_id,
  d.view_count, d.reply_count, d.reaction_count, d.last_activity_at, d.created_at, d.updated_at,
  d.edited_at, d.deleted_at, d.ai_source_id, d.ai_published_at,
  c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.purpose AS category_purpose,
  c.accepts_solutions AS category_accepts_solutions, c.staff_only_posting AS category_staff_only,
  c.is_enabled AS category_enabled,
  ${AUTHOR_SELECT}
`;

function mapDiscussionSummary(row: DiscussionRow): DiscussionSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    preview: truncate(stripMarkdown(row.body), 180),
    tags: row.tags ?? [],
    category: { id: row.category_id, slug: row.category_slug, name: row.category_name },
    author: mapAuthor(row),
    isPinned: row.is_pinned,
    isLocked: row.is_locked,
    isSolved: Boolean(row.accepted_reply_id),
    replyCount: Number(row.reply_count),
    reactionCount: Number(row.reaction_count),
    viewCount: Number(row.view_count),
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
  };
}

async function uniqueSlug(db: Queryable, title: string): Promise<string> {
  const base = slugify(title);
  const { rows } = await db.query<{ slug: string }>(
    `SELECT slug FROM community_discussions WHERE slug = $1 OR slug LIKE $2 LIMIT 50`,
    [base, `${base}-%`]
  );
  if (!rows.some((row) => row.slug.toLowerCase() === base)) return base;
  const taken = new Set(rows.map((row) => row.slug.toLowerCase()));
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `${base}-${attempt + 2}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export interface CreateDiscussionInput {
  categoryId: string;
  title: string;
  body: string;
  tags?: unknown;
}

export async function createDiscussion(
  db: Queryable,
  access: CommunityAccess,
  input: CreateDiscussionInput
): Promise<{ id: string; slug: string }> {
  assertCanPost(access);
  await ensureMemberRow(db, access.userId);

  const category = await db.query<{
    id: string; slug: string; purpose: string; is_enabled: boolean; staff_only_posting: boolean; accepts_solutions: boolean;
  }>('SELECT id, slug, purpose, is_enabled, staff_only_posting, accepts_solutions FROM community_categories WHERE id = $1', [
    input.categoryId,
  ]);
  const target = category.rows[0];
  if (!target) throw new NotFoundError('That discussion category does not exist');
  if (!target.is_enabled) throw new ValidationError('That category is not accepting new discussions');
  if (target.staff_only_posting && !access.isStaff) {
    throw new ForbiddenError('Only CloudHost247 staff can post in this category');
  }

  const title = String(input.title ?? '').replace(/\s+/g, ' ').trim();
  if (title.length < 8) throw new ValidationError('Give your discussion a descriptive title (at least 8 characters)');
  if (title.length > 200) throw new ValidationError('Titles are limited to 200 characters');
  const { body, preview, wordCount } = normaliseBody(input.body);
  if (wordCount < 3) throw new ValidationError('Write at least a sentence or two so people can answer you');

  const id = randomUUID();
  const slug = await uniqueSlug(db, title);
  await db.query(
    `INSERT INTO community_discussions (id, category_id, author_id, slug, title, body, tags, last_activity_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::text[], now())`,
    [id, target.id, access.userId, slug, title, body, normaliseTags(input.tags)]
  );

  if (target.purpose === 'showcase') {
    await awardReputation(db, { userId: access.userId, kind: 'tutorial-published', sourceType: 'discussion', sourceId: id });
    await awardAutomaticBadge(db, access.userId, 'tutorial-author');
  }
  if (target.purpose === 'announcement') {
    await notifyAnnouncement(db, access, id, title, preview);
  }
  return { id, slug };
}

async function notifyAnnouncement(
  db: Queryable,
  access: CommunityAccess,
  discussionId: string,
  title: string,
  preview: string
): Promise<void> {
  // Announcements go to every member who has ever joined the community (a profile row exists), not
  // to the whole customer base: the forum bell is opt-in by virtue of participating.
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT cm.user_id FROM community_members cm
       JOIN users u ON u.id = cm.user_id
      WHERE u.status = 'active' AND cm.user_id <> $1
      LIMIT 5000`,
    [access.userId]
  );
  for (const row of rows) {
    await notifyCommunity(db, {
      userId: row.user_id,
      type: 'COMMUNITY_ANNOUNCEMENT',
      title: `New CloudHost247 announcement: ${truncate(title, 120)}`,
      message: preview,
      resourceType: 'community_discussion',
      resourceId: discussionId,
      actorId: access.userId,
    });
  }
}

export interface ListDiscussionsFilter {
  categorySlug?: string;
  categoryId?: string;
  sort?: 'latest' | 'popular' | 'unanswered' | 'solved' | 'trending';
  tag?: string;
  page?: number;
  pageSize?: number;
  authorUsername?: string;
}

export async function listDiscussions(
  db: Queryable,
  filter: ListDiscussionsFilter
): Promise<{ items: DiscussionSummary[]; total: number; page: number; pageSize: number }> {
  const { page, pageSize, offset } = clampPage(filter.page, filter.pageSize);
  const conditions: string[] = ['d.deleted_at IS NULL', 'c.is_enabled = true'];
  const params: unknown[] = [];

  if (filter.categoryId) {
    params.push(filter.categoryId);
    conditions.push(`d.category_id = $${params.length}`);
  }
  if (filter.categorySlug) {
    params.push(filter.categorySlug.toLowerCase());
    conditions.push(`lower(c.slug) = $${params.length}`);
  }
  if (filter.tag) {
    params.push(filter.tag.toLowerCase());
    conditions.push(`$${params.length}::text = ANY(d.tags)`);
  }
  if (filter.authorUsername) {
    params.push(filter.authorUsername.toLowerCase());
    conditions.push(`lower(coalesce(u.username, '')) = $${params.length}`);
  }
  if (filter.sort === 'unanswered') conditions.push('d.reply_count = 0 AND d.is_locked = false');
  if (filter.sort === 'solved') conditions.push('d.accepted_reply_id IS NOT NULL');

  const where = `WHERE ${conditions.join(' AND ')}`;
  const order =
    filter.sort === 'popular'
      ? 'd.reaction_count DESC, d.reply_count DESC, d.last_activity_at DESC'
      : filter.sort === 'unanswered'
        ? 'd.created_at DESC'
        : filter.sort === 'trending'
          ? `(d.reply_count * 2 + d.reaction_count * 3 + CASE WHEN d.last_activity_at > now() - interval '7 days' THEN 10 ELSE 0 END) DESC, d.last_activity_at DESC`
          : 'd.is_pinned DESC, d.last_activity_at DESC';

  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM community_discussions d
       JOIN community_categories c ON c.id = d.category_id
       ${authorJoin('d.author_id')}
       ${where}`,
    params
  );
  const listParams = [...params, pageSize, offset];
  const { rows } = await db.query<DiscussionRow>(
    `SELECT ${DISCUSSION_SELECT}
       FROM community_discussions d
       JOIN community_categories c ON c.id = d.category_id
       ${authorJoin('d.author_id')}
       ${where}
      ORDER BY ${order}
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  return {
    items: rows.map(mapDiscussionSummary),
    total: Number(countResult.rows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

export interface ReplyView {
  id: string;
  body: string;
  isAccepted: boolean;
  reactionCount: number;
  viewerReacted: boolean;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  author: CommunityAuthor;
  attachments: AttachmentSummary[];
  quotedReply: { id: string; author: CommunityAuthor; preview: string } | null;
  children: ReplyView[];
}

export interface DiscussionDetail {
  discussion: DiscussionSummary & {
    body: string;
    updatedAt: string;
    editedAt: string | null;
    canBeSolved: boolean;
    aiPublishedAt: string | null;
  };
  category: CategorySummary;
  attachments: AttachmentSummary[];
  replies: ReplyView[];
  acceptedReplyId: string | null;
  viewer: {
    canEdit: boolean;
    canModerate: boolean;
    canAcceptSolution: boolean;
    isBookmarked: boolean;
    isSubscribed: boolean;
    isAuthor: boolean;
  } | null;
  related: Array<{ id: string; slug: string; title: string; replyCount: number }>;
}

interface ReplyRow extends AuthorColumnsRow {
  id: string;
  discussion_id: string;
  parent_id: string | null;
  body: string;
  is_accepted: boolean;
  reaction_count: number;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  viewer_reacted: boolean;
}

function mapAttachment(row: { id: string; file_name: string; mime_type: string; byte_size: number }): AttachmentSummary {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    url: `/api/v1/community/attachments/${row.id}`,
  };
}

export async function getDiscussionBySlug(
  db: Queryable,
  slug: string,
  viewer: CommunityAccess | null
): Promise<DiscussionDetail> {
  const viewerId = viewer?.userId ?? null;
  const { rows } = await db.query<DiscussionRow>(
    `SELECT ${DISCUSSION_SELECT},
            EXISTS (SELECT 1 FROM community_reactions r WHERE r.target_type='discussion' AND r.target_id=d.id AND r.user_id=$2) AS viewer_reacted,
            EXISTS (SELECT 1 FROM community_bookmarks b WHERE b.discussion_id=d.id AND b.user_id=$2) AS viewer_bookmarked,
            EXISTS (SELECT 1 FROM community_subscriptions s WHERE s.scope_type='discussion' AND s.scope_id=d.id AND s.user_id=$2) AS viewer_subscribed
       FROM community_discussions d
       JOIN community_categories c ON c.id = d.category_id
       ${authorJoin('d.author_id')}
      WHERE lower(d.slug) = lower($1) AND d.deleted_at IS NULL
      LIMIT 1`,
    [slug, viewerId]
  );
  const discussion = rows[0];
  if (!discussion) throw new NotFoundError('That discussion does not exist or has been removed');
  if (!discussion.category_enabled && !viewer?.isModerator) {
    throw new NotFoundError('That discussion category is currently disabled');
  }

  const [replyRows, attachmentRows, category] = await Promise.all([
    db.query<ReplyRow>(
      `SELECT r.id, r.discussion_id, r.parent_id, r.body, r.is_accepted, r.reaction_count,
              r.created_at, r.updated_at, r.edited_at,
              EXISTS (SELECT 1 FROM community_reactions x WHERE x.target_type='reply' AND x.target_id=r.id AND x.user_id=$2) AS viewer_reacted,
              ${AUTHOR_SELECT}
         FROM community_replies r
         ${authorJoin('r.author_id')}
        WHERE r.discussion_id = $1 AND r.deleted_at IS NULL
        ORDER BY r.created_at ASC
        LIMIT 500`,
      [discussion.id, viewerId]
    ),
    db.query<{ id: string; file_name: string; mime_type: string; byte_size: number; reply_id: string | null }>(
      `SELECT id, file_name, mime_type, byte_size, reply_id FROM community_attachments
        WHERE discussion_id = $1 ORDER BY created_at ASC LIMIT 60`,
      [discussion.id]
    ),
    getCategoryBySlug(db, discussion.category_slug),
  ]);

  const replyAttachments = new Map<string, AttachmentSummary[]>();
  for (const row of attachmentRows.rows) {
    if (!row.reply_id) continue;
    const list = replyAttachments.get(row.reply_id) ?? [];
    list.push(mapAttachment(row));
    replyAttachments.set(row.reply_id, list);
  }

  const byId = new Map<string, ReplyView>();
  const roots: ReplyView[] = [];
  for (const row of replyRows.rows) {
    const view: ReplyView = {
      id: row.id,
      body: row.body,
      isAccepted: row.is_accepted,
      reactionCount: Number(row.reaction_count),
      viewerReacted: Boolean(row.viewer_reacted),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      editedAt: row.edited_at,
      author: mapAuthor(row),
      attachments: replyAttachments.get(row.id) ?? [],
      quotedReply: null,
      children: [],
    };
    byId.set(row.id, view);
  }
  for (const row of replyRows.rows) {
    const view = byId.get(row.id)!;
    const parent = row.parent_id ? byId.get(row.parent_id) : null;
    if (parent) {
      view.quotedReply = {
        id: parent.id,
        author: parent.author,
        preview: truncate(stripMarkdown(parent.body), 160),
      };
      parent.children.push(view);
    } else {
      roots.push(view);
    }
  }

  const related = await db.query<{ id: string; slug: string; title: string; reply_count: number }>(
    `SELECT id, slug, title, reply_count FROM community_discussions
      WHERE category_id = $1 AND id <> $2 AND deleted_at IS NULL
      ORDER BY last_activity_at DESC LIMIT 3`,
    [discussion.category_id, discussion.id]
  );

  const isAuthor = viewerId !== null && viewerId === discussion.author_id;
  const canEditByWindow =
    isAuthor && Date.now() - new Date(discussion.created_at).getTime() <= DISCUSSION_EDIT_WINDOW_MS;

  return {
    discussion: {
      ...mapDiscussionSummary(discussion),
      body: discussion.body,
      updatedAt: discussion.updated_at,
      editedAt: discussion.edited_at,
      canBeSolved: discussion.category_accepts_solutions,
      aiPublishedAt: discussion.ai_published_at,
    },
    category: category ?? {
      id: discussion.category_id,
      slug: discussion.category_slug,
      name: discussion.category_name,
      description: '',
      purpose: discussion.category_purpose,
      acceptsSolutions: discussion.category_accepts_solutions,
      staffOnlyPosting: discussion.category_staff_only,
      isEnabled: discussion.category_enabled,
      position: 0,
      discussionCount: 0,
      replyCount: 0,
      solvedCount: 0,
      lastActivityAt: null,
    },
    attachments: attachmentRows.rows.filter((row) => !row.reply_id).map(mapAttachment),
    replies: roots,
    acceptedReplyId: discussion.accepted_reply_id,
    viewer: viewerId
      ? {
          canEdit: canEditByWindow || Boolean(viewer?.isModerator),
          canModerate: Boolean(viewer?.isModerator),
          canAcceptSolution:
            Boolean(discussion.category_accepts_solutions) &&
            (isAuthor || Boolean(viewer?.isModerator)) &&
            Boolean(discussion.accepted_reply_id) === false,
          isBookmarked: Boolean(discussion.viewer_bookmarked),
          isSubscribed: Boolean(discussion.viewer_subscribed),
          isAuthor,
        }
      : null,
    related: related.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      replyCount: Number(row.reply_count),
    })),
  };
}

export async function recordView(db: Queryable, discussionId: string): Promise<void> {
  await db.query('UPDATE community_discussions SET view_count = view_count + 1 WHERE id = $1', [discussionId]);
}

export async function updateDiscussion(
  db: Queryable,
  access: CommunityAccess,
  discussionId: string,
  input: { title?: string; body?: string; tags?: unknown }
): Promise<void> {
  await ensureMemberRow(db, access.userId);
  const { rows } = await db.query<{ author_id: string; created_at: string; deleted_at: string | null; slug: string; title: string }>(
    'SELECT author_id, created_at, deleted_at, slug, title FROM community_discussions WHERE id = $1',
    [discussionId]
  );
  const discussion = rows[0];
  if (!discussion || discussion.deleted_at) throw new NotFoundError('That discussion does not exist');
  assertAuthorOrModerator(access, discussion.author_id);
  const withinWindow = Date.now() - new Date(discussion.created_at).getTime() <= DISCUSSION_EDIT_WINDOW_MS;
  if (!access.isModerator && !withinWindow) {
    throw new ForbiddenError('This discussion can no longer be edited. Ask a moderator if something needs correcting.');
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  if (typeof input.title === 'string') {
    const title = input.title.replace(/\s+/g, ' ').trim();
    if (title.length < 8 || title.length > 200) throw new ValidationError('Titles must be between 8 and 200 characters');
    params.push(title);
    updates.push(`title = $${params.length}`);
  }
  if (typeof input.body === 'string') {
    const { body, wordCount } = normaliseBody(input.body);
    if (wordCount < 3) throw new ValidationError('Write at least a sentence or two');
    params.push(body);
    updates.push(`body = $${params.length}`);
  }
  if (input.tags !== undefined) {
    params.push(normaliseTags(input.tags));
    updates.push(`tags = $${params.length}::text[]`);
  }
  if (updates.length === 0) return;
  params.push(discussionId);
  await db.query(
    `UPDATE community_discussions SET ${updates.join(', ')}, edited_at = now(), updated_at = now()
      WHERE id = $${params.length}`,
    params
  );
}

export async function deleteDiscussion(db: Queryable, access: CommunityAccess, discussionId: string): Promise<void> {
  const { rows } = await db.query<{ author_id: string; created_at: string; deleted_at: string | null }>(
    'SELECT author_id, created_at, deleted_at FROM community_discussions WHERE id = $1',
    [discussionId]
  );
  const discussion = rows[0];
  if (!discussion || discussion.deleted_at) throw new NotFoundError('That discussion does not exist');
  assertAuthorOrModerator(access, discussion.author_id);
  if (!access.isModerator) {
    // An author may remove their own thread only while nobody has replied: deleting a conversation
    // other people invested time in is a moderation decision, not an edit.
    const replies = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM community_replies WHERE discussion_id = $1 AND deleted_at IS NULL',
      [discussionId]
    );
    if (Number(replies.rows[0]?.count ?? 0) > 0) {
      throw new ForbiddenError('This discussion has replies. Ask a moderator to remove it.');
    }
  }
  await db.query(
    'UPDATE community_discussions SET deleted_at = now(), deleted_by = $2, updated_at = now() WHERE id = $1',
    [discussionId, access.userId]
  );
}

// -------------------------------------------------------------------------------------------
// Replies
// -------------------------------------------------------------------------------------------

export interface CreateReplyInput {
  body: string;
  parentId?: string | null;
}

export async function createReply(
  db: Queryable,
  access: CommunityAccess,
  discussionId: string,
  input: CreateReplyInput
): Promise<{ id: string }> {
  assertCanPost(access);
  await ensureMemberRow(db, access.userId);
  const { rows } = await db.query<{
    id: string; slug: string; title: string; author_id: string; is_locked: boolean; deleted_at: string | null;
    category_id: string; category_purpose: string; category_enabled: boolean;
  }>(
    `SELECT d.id, d.slug, d.title, d.author_id, d.is_locked, d.deleted_at, d.category_id,
            c.purpose AS category_purpose, c.is_enabled AS category_enabled
       FROM community_discussions d JOIN community_categories c ON c.id = d.category_id
      WHERE d.id = $1`,
    [discussionId]
  );
  const discussion = rows[0];
  if (!discussion || discussion.deleted_at) throw new NotFoundError('That discussion does not exist');
  if (discussion.is_locked) throw new ForbiddenError('This discussion is locked; it is no longer accepting replies');
  if (!discussion.category_enabled) throw new ValidationError('That category is not accepting new replies');

  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await db.query<{ id: string; discussion_id: string; parent_id: string | null; deleted_at: string | null }>(
      'SELECT id, discussion_id, parent_id, deleted_at FROM community_replies WHERE id = $1',
      [input.parentId]
    );
    const row = parent.rows[0];
    if (!row || row.deleted_at || row.discussion_id !== discussionId) {
      throw new ValidationError('The reply you are quoting is no longer available');
    }
    // One level of nesting: a reply to a reply attaches to the same root, so a thread can never
    // become an arbitrarily deep indentation that is unreadable on a phone.
    parentId = row.parent_id ?? row.id;
  }

  const { body, preview, wordCount } = normaliseBody(input.body);
  if (wordCount < 2) throw new ValidationError('Write a reply before posting');
  if (body.length > 20_000) throw new ValidationError('Replies are limited to 20,000 characters');

  const id = randomUUID();
  await db.query(
    `INSERT INTO community_replies (id, discussion_id, parent_id, author_id, body)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, discussionId, parentId, access.userId, body]
  );
  await db.query(
    `UPDATE community_discussions
        SET reply_count = reply_count + 1, last_activity_at = now(), updated_at = now()
      WHERE id = $1`,
    [discussionId]
  );
  await awardReputation(db, { userId: access.userId, kind: 'reply-posted', sourceType: 'reply', sourceId: id });
  await awardAutomaticBadge(db, access.userId, 'first-answer');

  await notifyCommunity(db, {
    userId: discussion.author_id,
    type: 'COMMUNITY_REPLY',
    title: `New reply in "${truncate(discussion.title, 120)}"`,
    message: preview || 'A member replied to your discussion.',
    resourceType: 'community_discussion',
    resourceId: discussionId,
    actorId: access.userId,
  });
  await notifyMentions(db, access, 'reply', id, body, discussionId, discussion.title);
  await notifySubscribers(db, access, discussionId, discussion.author_id, discussion.title, preview);
  return { id };
}

async function notifyMentions(
  db: Queryable,
  access: CommunityAccess,
  sourceType: 'discussion' | 'reply',
  sourceId: string,
  body: string,
  discussionId: string,
  title: string
): Promise<void> {
  const { extractMentions } = await import('./text');
  const names = extractMentions(body);
  if (names.length === 0) return;
  const { rows } = await db.query<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE lower(username) = ANY($1::text[]) AND status = 'active' LIMIT 20`,
    [names]
  );
  for (const row of rows) {
    if (row.id === access.userId) continue;
    await db.query(
      `INSERT INTO community_mentions (id, source_type, source_id, mentioned_user_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (source_type, source_id, mentioned_user_id) DO NOTHING`,
      [randomUUID(), sourceType, sourceId, row.id]
    );
    await notifyCommunity(db, {
      userId: row.id,
      type: 'COMMUNITY_MENTION',
      title: `${access.username} mentioned you in "${truncate(title, 120)}"`,
      message: 'Open the discussion to read the post and reply.',
      resourceType: 'community_discussion',
      resourceId: discussionId,
      actorId: access.userId,
    });
  }
}

async function notifySubscribers(
  db: Queryable,
  access: CommunityAccess,
  discussionId: string,
  authorId: string,
  title: string,
  preview: string
): Promise<void> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM community_subscriptions
      WHERE scope_type='discussion' AND scope_id=$1 AND user_id <> $2 LIMIT 2000`,
    [discussionId, access.userId]
  );
  for (const row of rows) {
    if (row.user_id === authorId) continue; // already notified as the discussion author
    await notifyCommunity(db, {
      userId: row.user_id,
      type: 'COMMUNITY_REPLY',
      title: `New activity in "${truncate(title, 120)}"`,
      message: preview,
      resourceType: 'community_discussion',
      resourceId: discussionId,
      actorId: access.userId,
    });
  }
}

export async function updateReply(
  db: Queryable,
  access: CommunityAccess,
  replyId: string,
  body: string
): Promise<void> {
  const { rows } = await db.query<{ author_id: string; discussion_id: string; created_at: string; deleted_at: string | null }>(
    'SELECT author_id, discussion_id, created_at, deleted_at FROM community_replies WHERE id = $1',
    [replyId]
  );
  const reply = rows[0];
  if (!reply || reply.deleted_at) throw new NotFoundError('That reply does not exist');
  assertAuthorOrModerator(access, reply.author_id);
  if (!access.isModerator && Date.now() - new Date(reply.created_at).getTime() > REPLY_EDIT_WINDOW_MS) {
    throw new ForbiddenError('This reply can no longer be edited');
  }
  const { body: clean, wordCount } = normaliseBody(body);
  if (wordCount < 2) throw new ValidationError('Write a reply before saving');
  await db.query('UPDATE community_replies SET body = $2, edited_at = now(), updated_at = now() WHERE id = $1', [replyId, clean]);
}

export async function deleteReply(db: Queryable, access: CommunityAccess, replyId: string): Promise<void> {
  const { rows } = await db.query<{ author_id: string; discussion_id: string; deleted_at: string | null; is_accepted: boolean }>(
    'SELECT author_id, discussion_id, deleted_at, is_accepted FROM community_replies WHERE id = $1',
    [replyId]
  );
  const reply = rows[0];
  if (!reply || reply.deleted_at) throw new NotFoundError('That reply does not exist');
  assertAuthorOrModerator(access, reply.author_id);
  await db.query('UPDATE community_replies SET deleted_at = now(), deleted_by = $2, updated_at = now() WHERE id = $1', [
    replyId,
    access.userId,
  ]);
  if (reply.is_accepted) {
    await db.query(
      `UPDATE community_discussions SET accepted_reply_id = NULL, accepted_by = NULL, accepted_at = NULL WHERE id = $1`,
      [reply.discussion_id]
    );
  }
  await db.query(
    'UPDATE community_discussions SET reply_count = greatest(reply_count - 1, 0), updated_at = now() WHERE id = $1',
    [reply.discussion_id]
  );
}

export async function acceptSolution(
  db: Queryable,
  access: CommunityAccess,
  discussionId: string,
  replyId: string
): Promise<void> {
  const { rows } = await db.query<{
    id: string; slug: string; title: string; author_id: string; category_accepts_solutions: boolean; deleted_at: string | null;
  }>(
    `SELECT d.id, d.slug, d.title, d.author_id, d.deleted_at, c.accepts_solutions AS category_accepts_solutions
       FROM community_discussions d JOIN community_categories c ON c.id = d.category_id
      WHERE d.id = $1`,
    [discussionId]
  );
  const discussion = rows[0];
  if (!discussion || discussion.deleted_at) throw new NotFoundError('That discussion does not exist');
  if (!discussion.category_accepts_solutions) throw new ValidationError('This category does not use accepted solutions');
  if (!access.isModerator && access.userId !== discussion.author_id) {
    throw new ForbiddenError('Only the discussion author or a moderator can accept a solution');
  }
  const reply = await db.query<{ id: string; author_id: string; discussion_id: string; deleted_at: string | null }>(
    'SELECT id, author_id, discussion_id, deleted_at FROM community_replies WHERE id = $1',
    [replyId]
  );
  const target = reply.rows[0];
  if (!target || target.deleted_at || target.discussion_id !== discussionId) {
    throw new NotFoundError('That reply is not part of this discussion');
  }

  await db.query('UPDATE community_replies SET is_accepted = false WHERE discussion_id = $1 AND is_accepted = true', [discussionId]);
  await db.query('UPDATE community_replies SET is_accepted = true, updated_at = now() WHERE id = $1', [replyId]);
  await db.query(
    `UPDATE community_discussions SET accepted_reply_id = $2, accepted_by = $3, accepted_at = now(), updated_at = now() WHERE id = $1`,
    [discussionId, replyId, access.userId]
  );

  const awarded = await awardReputation(db, {
    userId: target.author_id,
    kind: 'reply-accepted',
    sourceType: 'reply',
    sourceId: replyId,
  });
  if (awarded) {
    await db.query('UPDATE community_members SET accepted_answers = accepted_answers + 1, updated_at = now() WHERE user_id = $1', [
      target.author_id,
    ]);
    await awardAutomaticBadge(db, target.author_id, 'accepted-solution');
  }
  if (target.author_id !== discussion.author_id) {
    await awardReputation(db, {
      userId: discussion.author_id,
      kind: 'question-solved',
      sourceType: 'discussion',
      sourceId: discussionId,
    });
  }
  await notifyCommunity(db, {
    userId: target.author_id,
    type: 'COMMUNITY_SOLUTION_ACCEPTED',
    title: 'Your answer was marked as the solution',
    message: `In "${truncate(discussion.title, 140)}"`,
    resourceType: 'community_discussion',
    resourceId: discussionId,
    actorId: access.userId,
  });
}

export async function removeSolution(db: Queryable, access: CommunityAccess, discussionId: string): Promise<void> {
  const { rows } = await db.query<{ author_id: string }>('SELECT author_id FROM community_discussions WHERE id = $1 AND deleted_at IS NULL', [
    discussionId,
  ]);
  const discussion = rows[0];
  if (!discussion) throw new NotFoundError('That discussion does not exist');
  if (!access.isModerator && access.userId !== discussion.author_id) {
    throw new ForbiddenError('Only the discussion author or a moderator can change the accepted solution');
  }
  await db.query('UPDATE community_replies SET is_accepted = false WHERE discussion_id = $1 AND is_accepted = true', [discussionId]);
  await db.query(
    'UPDATE community_discussions SET accepted_reply_id = NULL, accepted_by = NULL, accepted_at = NULL, updated_at = now() WHERE id = $1',
    [discussionId]
  );
}

// -------------------------------------------------------------------------------------------
// Reactions, bookmarks, subscriptions
// -------------------------------------------------------------------------------------------

async function targetAuthorId(db: Queryable, targetType: 'discussion' | 'reply', targetId: string): Promise<{ authorId: string; discussionId: string } | null> {
  if (targetType === 'discussion') {
    const { rows } = await db.query<{ author_id: string }>('SELECT author_id FROM community_discussions WHERE id = $1 AND deleted_at IS NULL', [
      targetId,
    ]);
    return rows[0] ? { authorId: rows[0].author_id, discussionId: targetId } : null;
  }
  const { rows } = await db.query<{ author_id: string; discussion_id: string }>(
    'SELECT author_id, discussion_id FROM community_replies WHERE id = $1 AND deleted_at IS NULL',
    [targetId]
  );
  return rows[0] ? { authorId: rows[0].author_id, discussionId: rows[0].discussion_id } : null;
}

export async function toggleReaction(
  db: Queryable,
  access: CommunityAccess,
  targetType: 'discussion' | 'reply',
  targetId: string,
  kind: 'like' | 'helpful' | 'insightful' = 'like'
): Promise<{ reacted: boolean; count: number }> {
  assertCanPost(access);
  const target = await targetAuthorId(db, targetType, targetId);
  if (!target) throw new NotFoundError('That post does not exist');
  await ensureMemberRow(db, access.userId);

  const existing = await db.query<{ user_id: string }>(
    'SELECT user_id FROM community_reactions WHERE user_id = $1 AND target_type = $2 AND target_id = $3',
    [access.userId, targetType, targetId]
  );
  const table = targetType === 'discussion' ? 'community_discussions' : 'community_replies';
  if (existing.rows[0]) {
    await db.query('DELETE FROM community_reactions WHERE user_id = $1 AND target_type = $2 AND target_id = $3', [
      access.userId,
      targetType,
      targetId,
    ]);
    const { rows } = await db.query<{ reaction_count: number }>(
      `UPDATE ${table} SET reaction_count = greatest(reaction_count - 1, 0), updated_at = now() WHERE id = $1 RETURNING reaction_count`,
      [targetId]
    );
    return { reacted: false, count: Number(rows[0]?.reaction_count ?? 0) };
  }

  await db.query(
    `INSERT INTO community_reactions (user_id, target_type, target_id, kind) VALUES ($1,$2,$3,$4)`,
    [access.userId, targetType, targetId, kind]
  );
  const { rows } = await db.query<{ reaction_count: number }>(
    `UPDATE ${table} SET reaction_count = reaction_count + 1, updated_at = now() WHERE id = $1 RETURNING reaction_count`,
    [targetId]
  );
  await awardReputation(db, {
    userId: target.authorId,
    kind: 'reaction-received',
    sourceType: 'reaction',
    sourceId: targetId,
  });
  await notifyCommunity(db, {
    userId: target.authorId,
    type: 'COMMUNITY_REACTION',
    title: targetType === 'discussion' ? 'Someone reacted to your discussion' : 'Someone reacted to your reply',
    message: `${access.username} found your ${targetType} helpful.`,
    resourceType: 'community_discussion',
    resourceId: target.discussionId,
    actorId: access.userId,
  });
  return { reacted: true, count: Number(rows[0]?.reaction_count ?? 0) };
}

export async function toggleBookmark(
  db: Queryable,
  access: CommunityAccess,
  discussionId: string
): Promise<{ bookmarked: boolean }> {
  const discussion = await db.query<{ id: string }>('SELECT id FROM community_discussions WHERE id = $1 AND deleted_at IS NULL', [discussionId]);
  if (!discussion.rows[0]) throw new NotFoundError('That discussion does not exist');
  await ensureMemberRow(db, access.userId);
  const removed = await db.query<{ discussion_id: string }>(
    'DELETE FROM community_bookmarks WHERE user_id = $1 AND discussion_id = $2 RETURNING discussion_id',
    [access.userId, discussionId]
  );
  if (removed.rows[0]) return { bookmarked: false };
  await db.query('INSERT INTO community_bookmarks (user_id, discussion_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
    access.userId,
    discussionId,
  ]);
  return { bookmarked: true };
}

export async function toggleSubscription(
  db: Queryable,
  access: CommunityAccess,
  scopeType: 'discussion' | 'category',
  scopeId: string
): Promise<{ subscribed: boolean }> {
  await ensureMemberRow(db, access.userId);
  if (scopeType === 'discussion') {
    const exists = await db.query<{ id: string }>('SELECT id FROM community_discussions WHERE id = $1 AND deleted_at IS NULL', [scopeId]);
    if (!exists.rows[0]) throw new NotFoundError('That discussion does not exist');
  } else {
    const exists = await db.query<{ id: string }>('SELECT id FROM community_categories WHERE id = $1', [scopeId]);
    if (!exists.rows[0]) throw new NotFoundError('That category does not exist');
  }
  const removed = await db.query<{ scope_id: string }>(
    'DELETE FROM community_subscriptions WHERE user_id = $1 AND scope_type = $2 AND scope_id = $3 RETURNING scope_id',
    [access.userId, scopeType, scopeId]
  );
  if (removed.rows[0]) return { subscribed: false };
  await db.query('INSERT INTO community_subscriptions (user_id, scope_type, scope_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [
    access.userId,
    scopeType,
    scopeId,
  ]);
  return { subscribed: true };
}

export async function listBookmarks(db: Queryable, access: CommunityAccess, page?: number) {
  const { page: current, pageSize, offset } = clampPage(page);
  const { rows } = await db.query<DiscussionRow>(
    `SELECT ${DISCUSSION_SELECT}
       FROM community_bookmarks bk
       JOIN community_discussions d ON d.id = bk.discussion_id AND d.deleted_at IS NULL
       JOIN community_categories c ON c.id = d.category_id
       ${authorJoin('d.author_id')}
      WHERE bk.user_id = $1
      ORDER BY bk.created_at DESC
      LIMIT $2 OFFSET $3`,
    [access.userId, pageSize, offset]
  );
  const total = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM community_bookmarks bk
       JOIN community_discussions d ON d.id = bk.discussion_id AND d.deleted_at IS NULL
      WHERE bk.user_id = $1`,
    [access.userId]
  );
  return { items: rows.map(mapDiscussionSummary), total: Number(total.rows[0]?.count ?? 0), page: current, pageSize };
}

// -------------------------------------------------------------------------------------------
// Home, search, members
// -------------------------------------------------------------------------------------------

export interface CommunityHome {
  stats: { members: number; discussions: number; replies: number; solved: number; activeToday: number };
  categories: CategorySummary[];
  latest: DiscussionSummary[];
  popular: DiscussionSummary[];
  trending: DiscussionSummary[];
  unanswered: DiscussionSummary[];
  solved: DiscussionSummary[];
  contributors: Array<CommunityAuthor & { acceptedAnswers: number }>;
  canParticipate: boolean;
}

export async function communityHome(db: Queryable, viewer: CommunityAccess | null): Promise<CommunityHome> {
  const [stats, categories, latest, popular, trending, unanswered, solved, contributors] = await Promise.all([
    db.query<{ members: string; discussions: string; replies: string; solved: string; active_today: string }>(
      `SELECT
         (SELECT count(*) FROM community_members) AS members,
         (SELECT count(*) FROM community_discussions WHERE deleted_at IS NULL) AS discussions,
         (SELECT count(*) FROM community_replies WHERE deleted_at IS NULL) AS replies,
         (SELECT count(*) FROM community_discussions WHERE deleted_at IS NULL AND accepted_reply_id IS NOT NULL) AS solved,
         (SELECT count(*) FROM community_members WHERE last_seen_at > now() - interval '1 day') AS active_today`
    ),
    listCategories(db),
    listDiscussions(db, { sort: 'latest', pageSize: 6 }),
    listDiscussions(db, { sort: 'popular', pageSize: 5 }),
    listDiscussions(db, { sort: 'trending', pageSize: 5 }),
    listDiscussions(db, { sort: 'unanswered', pageSize: 5 }),
    listDiscussions(db, { sort: 'solved', pageSize: 5 }),
    db.query<AuthorColumnsRow & { accepted_answers: number }>(
      `SELECT u.id AS author_id, u.username AS author_username, u.full_name AS author_full_name,
              u.role AS author_platform_role, m.reputation AS author_reputation, m.joined_at AS author_joined_at,
              coalesce((SELECT array_agg(r.role) FROM community_staff_roles r WHERE r.user_id = u.id), '{}') AS author_designations,
              m.accepted_answers
         FROM community_members m JOIN users u ON u.id = m.user_id
        WHERE u.status = 'active' AND m.directory_listed = true
        ORDER BY m.reputation DESC, m.accepted_answers DESC, m.joined_at ASC
        LIMIT 6`
    ),
  ]);

  const row = stats.rows[0];
  return {
    stats: {
      members: Number(row?.members ?? 0),
      discussions: Number(row?.discussions ?? 0),
      replies: Number(row?.replies ?? 0),
      solved: Number(row?.solved ?? 0),
      activeToday: Number(row?.active_today ?? 0),
    },
    categories,
    latest: latest.items,
    popular: popular.items,
    trending: trending.items,
    unanswered: unanswered.items,
    solved: solved.items,
    contributors: contributors.rows.map((entry) => ({
      ...mapAuthor(entry),
      acceptedAnswers: Number(entry.accepted_answers),
    })),
    canParticipate: Boolean(viewer),
  };
}

export interface SearchResult {
  discussions: DiscussionSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export async function searchCommunity(db: Queryable, query: string, page?: number): Promise<SearchResult> {
  const term = String(query ?? '').trim();
  const { page: current, pageSize, offset } = clampPage(page);
  if (term.length < 2) return { discussions: [], total: 0, page: current, pageSize };
  const like = `%${term.replace(/[%_\\]/g, (character) => `\\${character}`)}%`;
  const params: unknown[] = [term, like];
  const count = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM community_discussions d
       JOIN community_categories c ON c.id = d.category_id
      WHERE d.deleted_at IS NULL AND c.is_enabled = true
        AND (d.search_vector @@ websearch_to_tsquery('english', $1)
             OR d.title ILIKE $2 ESCAPE '\\'
             OR EXISTS (SELECT 1 FROM unnest(d.tags) AS tag WHERE tag ILIKE $2 ESCAPE '\\'))`,
    params
  );
  const { rows } = await db.query<DiscussionRow>(
    `SELECT ${DISCUSSION_SELECT},
            ts_rank(d.search_vector, websearch_to_tsquery('english', $1)) AS rank
       FROM community_discussions d
       JOIN community_categories c ON c.id = d.category_id
       ${authorJoin('d.author_id')}
      WHERE d.deleted_at IS NULL AND c.is_enabled = true
        AND (d.search_vector @@ websearch_to_tsquery('english', $1)
             OR d.title ILIKE $2 ESCAPE '\\'
             OR EXISTS (SELECT 1 FROM unnest(d.tags) AS tag WHERE tag ILIKE $2 ESCAPE '\\'))
      ORDER BY rank DESC, d.last_activity_at DESC
      LIMIT $3 OFFSET $4`,
    [...params, pageSize, offset]
  );
  return { discussions: rows.map(mapDiscussionSummary), total: Number(count.rows[0]?.total ?? 0), page: current, pageSize };
}

export interface MemberSummary extends CommunityAuthor {
  acceptedAnswers: number;
  discussionCount: number;
  replyCount: number;
  badges: Array<{ slug: string; name: string; icon: string }>;
}

export async function listMembers(
  db: Queryable,
  options: { sort?: 'reputation' | 'active' | 'new'; page?: number; q?: string } = {}
): Promise<{ items: MemberSummary[]; total: number; page: number; pageSize: number }> {
  const { page, pageSize, offset } = clampPage(options.page, 24);
  const params: unknown[] = [];
  const conditions = [`u.status = 'active'`, 'm.directory_listed = true'];
  if (options.q) {
    params.push(`%${options.q.replace(/[%_\\]/g, (character) => `\\${character}`)}%`);
    conditions.push(`(u.username ILIKE $${params.length} ESCAPE '\\' OR u.full_name ILIKE $${params.length} ESCAPE '\\')`);
  }
  const order =
    options.sort === 'new' ? 'm.joined_at DESC' : options.sort === 'active' ? 'm.last_seen_at DESC NULLS LAST' : 'm.reputation DESC, m.accepted_answers DESC';
  const where = `WHERE ${conditions.join(' AND ')}`;
  const count = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM community_members m JOIN users u ON u.id = m.user_id ${where}`,
    params
  );
  const { rows } = await db.query<
    AuthorColumnsRow & { accepted_answers: number; discussion_count: string; reply_count: string; badges: Array<{ slug: string; name: string; icon: string }> | null }
  >(
    `SELECT u.id AS author_id, u.username AS author_username, u.full_name AS author_full_name,
            u.role AS author_platform_role, m.reputation AS author_reputation, m.joined_at AS author_joined_at,
            coalesce((SELECT array_agg(r.role) FROM community_staff_roles r WHERE r.user_id = u.id), '{}') AS author_designations,
            m.accepted_answers,
            (SELECT count(*) FROM community_discussions d WHERE d.author_id = u.id AND d.deleted_at IS NULL)::text AS discussion_count,
            (SELECT count(*) FROM community_replies rp WHERE rp.author_id = u.id AND rp.deleted_at IS NULL)::text AS reply_count,
            (SELECT json_agg(json_build_object('slug', b.slug, 'name', b.name, 'icon', b.icon))
               FROM community_member_badges mb JOIN community_badges b ON b.id = mb.badge_id
              WHERE mb.user_id = u.id) AS badges
       FROM community_members m JOIN users u ON u.id = m.user_id
       ${where}
      ORDER BY ${order}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );
  return {
    items: rows.map((entry) => ({
      ...mapAuthor(entry),
      acceptedAnswers: Number(entry.accepted_answers),
      discussionCount: Number(entry.discussion_count),
      replyCount: Number(entry.reply_count),
      badges: entry.badges ?? [],
    })),
    total: Number(count.rows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

export interface MemberProfile {
  member: MemberSummary & {
    bio: string;
    location: string | null;
    websiteUrl: string | null;
    isDeveloper: boolean;
    isStaff: boolean;
    isModerator: boolean;
    isSelf: boolean;
    solvedCount: number;
  };
  discussions: DiscussionSummary[];
  replies: Array<{
    id: string;
    discussionId: string;
    discussionSlug: string;
    discussionTitle: string;
    preview: string;
    isAccepted: boolean;
    createdAt: string;
  }>;
}

export async function getMemberProfile(
  db: Queryable,
  username: string,
  viewer: CommunityAccess | null
): Promise<MemberProfile> {
  const { rows } = await db.query<
    AuthorColumnsRow & {
      bio: string; location: string | null; website_url: string | null; accepted_answers: number;
      discussion_count: string; reply_count: string; solved_count: string;
      badges: Array<{ slug: string; name: string; icon: string }> | null;
    }
  >(
    `SELECT u.id AS author_id, u.username AS author_username, u.full_name AS author_full_name,
            u.role AS author_platform_role, m.reputation AS author_reputation, m.joined_at AS author_joined_at,
            coalesce((SELECT array_agg(r.role) FROM community_staff_roles r WHERE r.user_id = u.id), '{}') AS author_designations,
            m.bio, m.location, m.website_url, m.accepted_answers,
            (SELECT count(*) FROM community_discussions d WHERE d.author_id = u.id AND d.deleted_at IS NULL)::text AS discussion_count,
            (SELECT count(*) FROM community_replies rp WHERE rp.author_id = u.id AND rp.deleted_at IS NULL)::text AS reply_count,
            (SELECT count(*) FROM community_replies rp WHERE rp.author_id = u.id AND rp.deleted_at IS NULL AND rp.is_accepted)::text AS solved_count,
            (SELECT json_agg(json_build_object('slug', b.slug, 'name', b.name, 'icon', b.icon))
               FROM community_member_badges mb JOIN community_badges b ON b.id = mb.badge_id
              WHERE mb.user_id = u.id) AS badges
       FROM users u
       LEFT JOIN community_members m ON m.user_id = u.id
      WHERE lower(u.username) = lower($1) AND u.status = 'active'
      LIMIT 1`,
    [username]
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('No community member has that username');

  const author = mapAuthor(row);
  const discussions = await listDiscussions(db, { authorUsername: author.username, pageSize: 10 });
  const replies = await db.query<{
    id: string; discussion_id: string; slug: string; title: string; body: string; is_accepted: boolean; created_at: string;
  }>(
    `SELECT r.id, r.discussion_id, d.slug, d.title, r.body, r.is_accepted, r.created_at
       FROM community_replies r
       JOIN community_discussions d ON d.id = r.discussion_id AND d.deleted_at IS NULL
      WHERE r.author_id = $1 AND r.deleted_at IS NULL
      ORDER BY r.created_at DESC
      LIMIT 10`,
    [author.id]
  );
  return {
    member: {
      ...author,
      acceptedAnswers: Number(row.accepted_answers ?? 0),
      discussionCount: Number(row.discussion_count),
      replyCount: Number(row.reply_count),
      solvedCount: Number(row.solved_count),
      badges: row.badges ?? [],
      bio: row.bio ?? '',
      location: row.location,
      websiteUrl: row.website_url,
      isDeveloper: (row.author_designations ?? []).includes('developer'),
      isStaff: author.standing === 'staff',
      isModerator: author.standing === 'moderator' || author.standing === 'staff',
      isSelf: viewer?.userId === author.id,
    },
    discussions: discussions.items,
    replies: replies.rows.map((entry) => ({
      id: entry.id,
      discussionId: entry.discussion_id,
      discussionSlug: entry.slug,
      discussionTitle: entry.title,
      preview: truncate(stripMarkdown(entry.body), 200),
      isAccepted: entry.is_accepted,
      createdAt: entry.created_at,
    })),
  };
}

export async function updateMemberProfile(
  db: Queryable,
  access: CommunityAccess,
  input: { bio?: string; location?: string | null; websiteUrl?: string | null; directoryListed?: boolean }
): Promise<void> {
  await ensureMemberRow(db, access.userId);
  const bio = typeof input.bio === 'string' ? input.bio.replace(/\s+/g, ' ').trim().slice(0, 600) : undefined;
  if (bio !== undefined && bio.length > 0 && bio.length < 10) {
    throw new ValidationError('Write a slightly longer biography, or leave it empty');
  }
  const updates: string[] = [];
  const params: unknown[] = [];
  if (bio !== undefined) {
    params.push(bio);
    updates.push(`bio = $${params.length}`);
  }
  if (input.location !== undefined) {
    params.push(input.location ? String(input.location).trim().slice(0, 120) : null);
    updates.push(`location = $${params.length}`);
  }
  if (input.websiteUrl !== undefined) {
    const raw = input.websiteUrl ? String(input.websiteUrl).trim() : '';
    if (raw && !/^https:\/\/[^\s]+$/i.test(raw)) {
      throw new ValidationError('The website address must start with https://');
    }
    params.push(raw ? raw.slice(0, 200) : null);
    updates.push(`website_url = $${params.length}`);
  }
  if (input.directoryListed !== undefined) {
    params.push(Boolean(input.directoryListed));
    updates.push(`directory_listed = $${params.length}`);
  }
  if (updates.length === 0) return;
  params.push(access.userId);
  await db.query(`UPDATE community_members SET ${updates.join(', ')}, updated_at = now() WHERE user_id = $${params.length}`, params);
}

export async function touchMember(db: Queryable, userId: string): Promise<void> {
  await ensureMemberRow(db, userId);
  await db.query('UPDATE community_members SET last_seen_at = now() WHERE user_id = $1', [userId]);
}

// -------------------------------------------------------------------------------------------
// Reports
// -------------------------------------------------------------------------------------------

export async function createReport(
  db: Queryable,
  access: CommunityAccess,
  input: { targetType: 'discussion' | 'reply' | 'member'; targetId: string; reason: string; detail?: string }
): Promise<{ id: string }> {
  assertCanPost(access);
  if (input.targetType === 'member') {
    const target = await db.query<{ id: string }>('SELECT id FROM users WHERE id = $1', [input.targetId]);
    if (!target.rows[0]) throw new NotFoundError('That member does not exist');
  } else {
    const target = await targetAuthorId(db, input.targetType, input.targetId);
    if (!target) throw new NotFoundError('That post does not exist');
    if (target.authorId === access.userId) throw new ValidationError('You cannot report your own post');
  }
  const id = randomUUID();
  try {
    await db.query(
      `INSERT INTO community_reports (id, target_type, target_id, reporter_id, reason, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, input.targetType, input.targetId, access.userId, input.reason, (input.detail ?? '').slice(0, 1000)]
    );
  } catch {
    throw new ConflictError('You have already reported this. A moderator is reviewing it.');
  }
  return { id };
}

// -------------------------------------------------------------------------------------------
// Attachments
// -------------------------------------------------------------------------------------------

export async function addAttachment(
  db: Queryable,
  access: CommunityAccess,
  input: { discussionId: string; replyId?: string | null; fileName: string; mimeType: string; dataBase64: string }
): Promise<AttachmentSummary> {
  assertCanPost(access);
  const buffer = Buffer.from(String(input.dataBase64 ?? ''), 'base64');
  if (buffer.length === 0) throw new ValidationError('The attachment is empty');
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new ValidationError('Attachments are limited to 1.5 MB');
  const { detectImageType } = await import('./text');
  const detected = detectImageType(buffer);
  if (!detected) throw new ValidationError('Only PNG, JPEG, WebP and GIF screenshots are accepted');
  if (detected !== input.mimeType) {
    throw new ValidationError('The file content does not match its declared image type');
  }
  const discussion = await db.query<{ id: string; author_id: string; deleted_at: string | null }>(
    'SELECT id, author_id, deleted_at FROM community_discussions WHERE id = $1',
    [input.discussionId]
  );
  if (!discussion.rows[0] || discussion.rows[0].deleted_at) throw new NotFoundError('That discussion does not exist');
  if (input.replyId) {
    const reply = await db.query<{ author_id: string; discussion_id: string }>(
      'SELECT author_id, discussion_id FROM community_replies WHERE id = $1 AND deleted_at IS NULL',
      [input.replyId]
    );
    const row = reply.rows[0];
    if (!row || row.discussion_id !== input.discussionId) throw new ValidationError('That reply is not part of this discussion');
    if (row.author_id !== access.userId && !access.isModerator) {
      throw new ForbiddenError('You can only attach files to your own reply');
    }
  } else if (discussion.rows[0].author_id !== access.userId && !access.isModerator) {
    throw new ForbiddenError('You can only attach files to your own discussion');
  }

  const count = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM community_attachments WHERE discussion_id = $1',
    [input.discussionId]
  );
  if (Number(count.rows[0]?.count ?? 0) >= MAX_ATTACHMENTS_PER_POST * 8) {
    throw new ValidationError('This discussion already has the maximum number of attachments');
  }

  const id = randomUUID();
  await db.query(
    `INSERT INTO community_attachments (id, discussion_id, reply_id, uploaded_by, file_name, mime_type, byte_size, content)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      input.discussionId,
      input.replyId ?? null,
      access.userId,
      safeFileName(input.fileName, `screenshot.${detected.split('/')[1]}`),
      detected,
      buffer.length,
      buffer,
    ]
  );
  return { id, fileName: safeFileName(input.fileName), mimeType: detected, byteSize: buffer.length, url: `/api/v1/community/attachments/${id}` };
}

export async function getAttachment(
  db: Queryable,
  id: string
): Promise<{ fileName: string; mimeType: string; content: Buffer } | null> {
  const { rows } = await db.query<{ file_name: string; mime_type: string; content: Buffer; deleted_at: string | null }>(
    `SELECT a.file_name, a.mime_type, a.content, d.deleted_at
       FROM community_attachments a
       JOIN community_discussions d ON d.id = a.discussion_id
      WHERE a.id = $1
      LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row || row.deleted_at) return null;
  return { fileName: row.file_name, mimeType: row.mime_type, content: Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content) };
}

// -------------------------------------------------------------------------------------------
// Notifications feed
// -------------------------------------------------------------------------------------------

export async function listCommunityNotifications(db: Queryable, userId: string, limit = 30) {
  const { rows } = await db.query<{
    id: string; type: string; title: string; message: string; resource_type: string | null; resource_id: string | null;
    read_at: string | null; created_at: string;
  }>(
    `SELECT id, type, title, message, resource_type, resource_id, read_at, created_at
       FROM user_notifications
      WHERE user_id = $1 AND type LIKE 'COMMUNITY\\_%'
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)]
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export async function markNotificationsRead(db: Queryable, userId: string, ids?: string[]): Promise<number> {
  if (ids && ids.length > 0) {
    const { rows } = await db.query<{ id: string }>(
      `UPDATE user_notifications SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL AND type LIKE 'COMMUNITY\\_%' AND id = ANY($2::uuid[])
        RETURNING id`,
      [userId, ids.slice(0, 200)]
    );
    return rows.length;
  }
  const { rows } = await db.query<{ id: string }>(
    `UPDATE user_notifications SET read_at = now()
      WHERE user_id = $1 AND read_at IS NULL AND type LIKE 'COMMUNITY\\_%' RETURNING id`,
    [userId]
  );
  return rows.length;
}

export async function listMemberBadgeList(db: Queryable, userId: string) {
  return listMemberBadges(db, userId);
}
