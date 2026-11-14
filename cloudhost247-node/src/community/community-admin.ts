import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors';
import { isSuperAdmin, type CommunityAccess, type CommunityDesignation } from './permissions';
import { listMemberBadges } from './reputation';
import { notifyCommunity } from './community-notifications';

/**
 * Community administration.
 *
 * Everything here is called only after `requireRole(['admin', 'super_admin'])` (see
 * src/routes/admin-community.ts), and every function re-checks the *resolved* access record for the
 * narrower rules that are not covered by the platform role:
 *
 *   * designations (moderator / developer / staff) and manual badges — super_admin only. A forum
 *     moderator can moderate content, but cannot mint another moderator, and no member can grant
 *     themselves or a friend a "Verified Developer" badge: the role is chosen from a fixed tuple on
 *     the server, never from the request body.
 *   * publishing an answer into the AI knowledge base — super_admin only, because that content is
 *     answered to customers by the assistant.
 *
 * Privileged actions are written to the platform's existing `audit_logs` by the route handlers
 * (src/lib/audit.ts); this module does not create a second audit trail.
 */

async function ensureSuperAdmin(access: CommunityAccess): Promise<void> {
  if (!isSuperAdmin(access)) {
    throw new ForbiddenError('Only a super administrator can change community roles and badges');
  }
}

export interface AdminOverview {
  totals: {
    discussions: number;
    replies: number;
    members: number;
    solved: number;
    openReports: number;
    restricted: number;
    publishedSolutions: number;
  };
  categories: Array<{ id: string; slug: string; name: string; isEnabled: boolean; discussionCount: number }>;
  recentReports: Array<{
    id: string; targetType: string; targetId: string; reason: string; detail: string; createdAt: string;
    reporter: string; status: string;
  }>;
  recentActions: Array<{ id: string; action: string; resourceType: string; resourceId: string | null; actorId: string | null; createdAt: string; metadata: Record<string, unknown> }>;
  staff: Array<{ userId: string; username: string; displayName: string; designations: string[] }>;
}

export async function adminOverview(db: Queryable): Promise<AdminOverview> {
  const totals = await db.query<{
    discussions: string; replies: string; members: string; solved: string; open_reports: string;
    restricted: string; published: string;
  }>(
    `SELECT
       (SELECT count(*) FROM community_discussions WHERE deleted_at IS NULL) AS discussions,
       (SELECT count(*) FROM community_replies WHERE deleted_at IS NULL) AS replies,
       (SELECT count(*) FROM community_members) AS members,
       (SELECT count(*) FROM community_discussions WHERE deleted_at IS NULL AND accepted_reply_id IS NOT NULL) AS solved,
       (SELECT count(*) FROM community_reports WHERE status = 'open') AS open_reports,
       (SELECT count(*) FROM community_members WHERE restricted_until IS NOT NULL AND restricted_until > now()) AS restricted,
       (SELECT count(*) FROM ai_knowledge_sources WHERE source_kind = 'community_solution' AND excluded = false) AS published`
  );

  const categories = await db.query<{ id: string; slug: string; name: string; is_enabled: boolean; discussion_count: string }>(
    `SELECT c.id, c.slug, c.name, c.is_enabled,
            (SELECT count(*) FROM community_discussions d WHERE d.category_id = c.id AND d.deleted_at IS NULL)::text AS discussion_count
       FROM community_categories c ORDER BY c.position ASC, c.name ASC`
  );

  const reports = await db.query<{
    id: string; target_type: string; target_id: string; reason: string; detail: string; created_at: string;
    status: string; reporter: string | null;
  }>(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.detail, r.created_at, r.status,
            coalesce(u.username, 'member') AS reporter
       FROM community_reports r LEFT JOIN users u ON u.id = r.reporter_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at ASC
      LIMIT 25`
  );

  const actions = await db.query<{
    id: string; action: string; resource_type: string; resource_id: string | null; actor_id: string | null;
    created_at: string; metadata: Record<string, unknown>;
  }>(
    `SELECT id, action, resource_type, resource_id, actor_id, created_at, metadata
       FROM audit_logs
      WHERE resource_type LIKE 'community%'
      ORDER BY created_at DESC LIMIT 25`
  );

  const staff = await db.query<{ user_id: string; username: string | null; full_name: string; designations: string[] }>(
    `SELECT r.user_id, u.username, u.full_name, array_agg(r.role) AS designations
       FROM community_staff_roles r JOIN users u ON u.id = r.user_id
      GROUP BY r.user_id, u.username, u.full_name
      ORDER BY u.full_name ASC
      LIMIT 100`
  );

  const row = totals.rows[0];
  return {
    totals: {
      discussions: Number(row?.discussions ?? 0),
      replies: Number(row?.replies ?? 0),
      members: Number(row?.members ?? 0),
      solved: Number(row?.solved ?? 0),
      openReports: Number(row?.open_reports ?? 0),
      restricted: Number(row?.restricted ?? 0),
      publishedSolutions: Number(row?.published ?? 0),
    },
    categories: categories.rows.map((entry) => ({
      id: entry.id,
      slug: entry.slug,
      name: entry.name,
      isEnabled: entry.is_enabled,
      discussionCount: Number(entry.discussion_count),
    })),
    recentReports: reports.rows.map((entry) => ({
      id: entry.id,
      targetType: entry.target_type,
      targetId: entry.target_id,
      reason: entry.reason,
      detail: entry.detail,
      createdAt: entry.created_at,
      reporter: entry.reporter ?? 'member',
      status: entry.status,
    })),
    recentActions: actions.rows.map((entry) => ({
      id: entry.id,
      action: entry.action,
      resourceType: entry.resource_type,
      resourceId: entry.resource_id,
      actorId: entry.actor_id,
      createdAt: entry.created_at,
      metadata: entry.metadata ?? {},
    })),
    staff: staff.rows.map((entry) => ({
      userId: entry.user_id,
      username: entry.username ?? '',
      displayName: entry.full_name,
      designations: entry.designations,
    })),
  };
}

// -------------------------------------------------------------------------------------------
// Categories
// -------------------------------------------------------------------------------------------

export interface CategoryInput {
  slug: string;
  name: string;
  description: string;
  purpose?: 'discussion' | 'question' | 'announcement' | 'showcase';
  acceptsSolutions?: boolean;
  staffOnlyPosting?: boolean;
  isEnabled?: boolean;
  position?: number;
}

export async function createCategory(db: Queryable, input: CategoryInput): Promise<{ id: string }> {
  const slug = String(input.slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
    throw new ValidationError('The category slug must be lower-case words separated by hyphens');
  }
  const name = String(input.name ?? '').trim();
  if (name.length < 3 || name.length > 120) throw new ValidationError('Give the category a name of 3 to 120 characters');
  const description = String(input.description ?? '').trim();
  if (description.length < 10 || description.length > 400) {
    throw new ValidationError('Describe the category in 10 to 400 characters');
  }
  const purpose = input.purpose ?? 'discussion';
  if (!['discussion', 'question', 'announcement', 'showcase'].includes(purpose)) {
    throw new ValidationError('Unknown category purpose');
  }
  const id = randomUUID();
  try {
    await db.query(
      `INSERT INTO community_categories (id, slug, name, description, purpose, accepts_solutions, staff_only_posting, is_enabled, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        slug,
        name,
        description,
        purpose,
        input.acceptsSolutions ?? purpose === 'question',
        input.staffOnlyPosting ?? purpose === 'announcement',
        input.isEnabled ?? true,
        input.position ?? 99,
      ]
    );
  } catch {
    throw new ConflictError('A category with that slug already exists');
  }
  return { id };
}

export async function updateCategory(db: Queryable, categoryId: string, input: Partial<CategoryInput>): Promise<void> {
  const existing = await db.query<{ id: string }>('SELECT id FROM community_categories WHERE id = $1', [categoryId]);
  if (!existing.rows[0]) throw new NotFoundError('That category does not exist');
  const updates: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (name.length < 3 || name.length > 120) throw new ValidationError('Give the category a name of 3 to 120 characters');
    params.push(name);
    updates.push(`name = $${params.length}`);
  }
  if (input.description !== undefined) {
    const description = String(input.description).trim();
    if (description.length < 10 || description.length > 400) {
      throw new ValidationError('Describe the category in 10 to 400 characters');
    }
    params.push(description);
    updates.push(`description = $${params.length}`);
  }
  if (input.description === undefined && input.name !== undefined) {
    // Name-only edits are allowed; nothing else to do.
  }
  for (const [key, column] of [
    ['acceptsSolutions', 'accepts_solutions'],
    ['staffOnlyPosting', 'staff_only_posting'],
    ['isEnabled', 'is_enabled'],
  ] as const) {
    if (input[key] !== undefined) {
      params.push(Boolean(input[key]));
      updates.push(`${column} = $${params.length}`);
    }
  }
  if (input.position !== undefined) {
    params.push(Math.max(0, Math.floor(Number(input.position))));
    updates.push(`position = $${params.length}`);
  }
  if (input.purpose !== undefined) {
    if (!['discussion', 'question', 'announcement', 'showcase'].includes(input.purpose)) {
      throw new ValidationError('Unknown category purpose');
    }
    params.push(input.purpose);
    updates.push(`purpose = $${params.length}`);
  }
  if (updates.length === 0) return;
  params.push(categoryId);
  await db.query(`UPDATE community_categories SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
}

/**
 * Categories are never hard-deleted while they hold discussions: a delete would cascade into the
 * threads (ON DELETE RESTRICT protects the rows) and, worse, silently change the URL of a page
 * other people linked to. Disabling hides it from the composer and the public index while keeping
 * history readable.
 */
export async function disableCategory(db: Queryable, categoryId: string): Promise<void> {
  const existing = await db.query<{ id: string }>('SELECT id FROM community_categories WHERE id = $1', [categoryId]);
  if (!existing.rows[0]) throw new NotFoundError('That category does not exist');
  await db.query('UPDATE community_categories SET is_enabled = false, updated_at = now() WHERE id = $1', [categoryId]);
}

// -------------------------------------------------------------------------------------------
// Moderation
// -------------------------------------------------------------------------------------------

export async function setDiscussionFlags(
  db: Queryable,
  discussionId: string,
  flags: { pinned?: boolean; locked?: boolean }
): Promise<void> {
  const existing = await db.query<{ id: string }>('SELECT id FROM community_discussions WHERE id = $1 AND deleted_at IS NULL', [discussionId]);
  if (!existing.rows[0]) throw new NotFoundError('That discussion does not exist');
  const updates: string[] = [];
  const params: unknown[] = [];
  if (flags.pinned !== undefined) {
    params.push(Boolean(flags.pinned));
    updates.push(`is_pinned = $${params.length}`);
  }
  if (flags.locked !== undefined) {
    params.push(Boolean(flags.locked));
    updates.push(`is_locked = $${params.length}`);
  }
  if (updates.length === 0) return;
  params.push(discussionId);
  await db.query(`UPDATE community_discussions SET ${updates.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
}

export async function moderateDeleteDiscussion(db: Queryable, access: CommunityAccess, discussionId: string, reason: string): Promise<{ authorId: string; title: string }> {
  const existing = await db.query<{ author_id: string; title: string; deleted_at: string | null }>(
    'SELECT author_id, title, deleted_at FROM community_discussions WHERE id = $1',
    [discussionId]
  );
  const row = existing.rows[0];
  if (!row) throw new NotFoundError('That discussion does not exist');
  await db.query(
    'UPDATE community_discussions SET deleted_at = now(), deleted_by = $2, updated_at = now() WHERE id = $1',
    [discussionId, access.userId]
  );
  await notifyCommunity(db, {
    userId: row.author_id,
    type: 'COMMUNITY_MODERATION',
    title: 'A moderator removed your discussion',
    message: `"${row.title.slice(0, 140)}" was removed. Reason: ${reason || 'see the community guidelines'}.`,
    resourceType: 'community_discussion',
    resourceId: discussionId,
    actorId: access.userId,
  });
  return { authorId: row.author_id, title: row.title };
}

export async function moderateDeleteReply(db: Queryable, access: CommunityAccess, replyId: string, reason: string): Promise<{ authorId: string; discussionId: string }> {
  const existing = await db.query<{ author_id: string; discussion_id: string; deleted_at: string | null }>(
    'SELECT author_id, discussion_id, deleted_at FROM community_replies WHERE id = $1',
    [replyId]
  );
  const row = existing.rows[0];
  if (!row) throw new NotFoundError('That reply does not exist');
  await db.query('UPDATE community_replies SET deleted_at = now(), deleted_by = $2, updated_at = now() WHERE id = $1', [replyId, access.userId]);
  await db.query(
    'UPDATE community_discussions SET reply_count = greatest(reply_count - 1, 0), updated_at = now() WHERE id = $1',
    [row.discussion_id]
  );
  await notifyCommunity(db, {
    userId: row.author_id,
    type: 'COMMUNITY_MODERATION',
    title: 'A moderator removed your reply',
    message: `Reason: ${reason || 'see the community guidelines'}.`,
    resourceType: 'community_reply',
    resourceId: replyId,
    actorId: access.userId,
  });
  return { authorId: row.author_id, discussionId: row.discussion_id };
}

export async function resolveReport(
  db: Queryable,
  access: CommunityAccess,
  reportId: string,
  action: 'actioned' | 'dismissed',
  note: string
): Promise<{ id: string; targetType: string; targetId: string }> {
  const existing = await db.query<{ id: string; target_type: string; target_id: string; status: string }>(
    'SELECT id, target_type, target_id, status FROM community_reports WHERE id = $1',
    [reportId]
  );
  const row = existing.rows[0];
  if (!row) throw new NotFoundError('That report does not exist');
  if (row.status !== 'open') throw new ConflictError('That report has already been reviewed');
  await db.query(
    `UPDATE community_reports SET status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4 WHERE id = $1`,
    [reportId, action, access.userId, (note ?? '').slice(0, 500)]
  );
  return { id: row.id, targetType: row.target_type, targetId: row.target_id };
}

export async function restrictMember(
  db: Queryable,
  access: CommunityAccess,
  userId: string,
  input: { restrictedUntil: string | null; reason: string }
): Promise<void> {
  const target = await db.query<{ id: string }>("SELECT id FROM users WHERE id = $1 AND status = 'active'", [userId]);
  if (!target.rows[0]) throw new NotFoundError('That member does not exist');
  if (userId === access.userId) throw new ValidationError('You cannot restrict your own community posting');
  let until: string | null = null;
  if (input.restrictedUntil) {
    const parsed = new Date(input.restrictedUntil);
    if (!Number.isFinite(parsed.getTime())) throw new ValidationError('Provide a valid restriction end date');
    if (parsed.getTime() <= Date.now()) throw new ValidationError('The restriction end date must be in the future');
    if (parsed.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
      throw new ValidationError('Restrictions are limited to one year at a time');
    }
    until = parsed.toISOString();
  }
  await db.query(
    `INSERT INTO community_members (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await db.query(
    `UPDATE community_members
        SET restricted_until = $2, restriction_reason = $3, updated_at = now()
      WHERE user_id = $1`,
    [userId, until, until ? (input.reason ?? '').slice(0, 300) : null]
  );
  if (until) {
    await notifyCommunity(db, {
      userId,
      type: 'COMMUNITY_MODERATION',
      title: 'Your community posting is restricted',
      message: `Reason: ${input.reason || 'community guidelines'}. Reading and search remain available.`,
      resourceType: 'community_member',
      resourceId: userId,
      actorId: access.userId,
    });
  }
}

// -------------------------------------------------------------------------------------------
// Designations and badges — super_admin only
// -------------------------------------------------------------------------------------------

const DESIGNATIONS: readonly CommunityDesignation[] = ['moderator', 'developer', 'staff'];

export async function setDesignation(
  db: Queryable,
  access: CommunityAccess,
  userId: string,
  role: string,
  grant: boolean
): Promise<void> {
  await ensureSuperAdmin(access);
  const designation = DESIGNATIONS.find((entry) => entry === role);
  if (!designation) throw new ValidationError('Unknown community role');
  const target = await db.query<{ id: string }>("SELECT id FROM users WHERE id = $1 AND status = 'active'", [userId]);
  if (!target.rows[0]) throw new NotFoundError('That account does not exist');
  if (userId === access.userId && !grant) {
    throw new ValidationError('You cannot remove your own community role');
  }
  if (grant) {
    await db.query(
      `INSERT INTO community_staff_roles (user_id, role, granted_by) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId, designation, access.userId]
    );
  } else {
    await db.query('DELETE FROM community_staff_roles WHERE user_id = $1 AND role = $2', [userId, designation]);
  }
  await notifyCommunity(db, {
    userId,
    type: 'COMMUNITY_MODERATION',
    title: grant ? `You are now a CloudHost247 community ${designation}` : `Your community ${designation} role was removed`,
    message: grant
      ? 'The CloudHost247 team granted you this community designation. Thank you for helping.'
      : 'A CloudHost247 administrator changed your community role.',
    resourceType: 'community_member',
    resourceId: userId,
    actorId: access.userId,
  });
}

export async function setBadge(
  db: Queryable,
  access: CommunityAccess,
  userId: string,
  badgeSlug: string,
  grant: boolean
): Promise<{ badgeId: string }> {
  await ensureSuperAdmin(access);
  const badge = await db.query<{ id: string; kind: string }>('SELECT id, kind FROM community_badges WHERE lower(slug) = lower($1)', [badgeSlug]);
  const row = badge.rows[0];
  if (!row) throw new NotFoundError('That badge does not exist');
  if (row.kind !== 'manual') {
    throw new ValidationError('Automatic badges are awarded by the community service when the qualifying action happens');
  }
  if (grant) {
    const inserted = await db.query(
      `INSERT INTO community_member_badges (user_id, badge_id, granted_by) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, badge_id) DO NOTHING`,
      [userId, row.id, access.userId]
    );
    void inserted;
  } else {
    await db.query('DELETE FROM community_member_badges WHERE user_id = $1 AND badge_id = $2', [userId, row.id]);
  }
  return { badgeId: row.id };
}

export async function listMemberBadgesForAdmin(db: Queryable, userId: string) {
  return listMemberBadges(db, userId);
}

export async function listReportQueue(db: Queryable, status: 'open' | 'actioned' | 'dismissed' | 'all' = 'open') {
  const params: unknown[] = [];
  const where = status === 'all' ? '' : 'WHERE r.status = $1';
  if (status !== 'all') params.push(status);
  const { rows } = await db.query<{
    id: string; target_type: string; target_id: string; reason: string; detail: string; status: string;
    created_at: string; resolved_at: string | null; resolution_note: string | null; reporter: string | null;
  }>(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.detail, r.status, r.created_at, r.resolved_at,
            r.resolution_note, coalesce(u.username, 'member') AS reporter
       FROM community_reports r LEFT JOIN users u ON u.id = r.reporter_id
       ${where}
      ORDER BY r.created_at ASC LIMIT 200`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    reporter: row.reporter ?? 'member',
  }));
}
