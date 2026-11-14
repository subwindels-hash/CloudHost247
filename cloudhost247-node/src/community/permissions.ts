import type { Queryable } from '../db/types';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';

/**
 * Community authorization.
 *
 * Two different things can give a member authority here, and they are deliberately kept apart:
 *
 *   1. Their **platform role** (`users.role`: customer | admin | super_admin). Every admin and
 *      super_admin is a moderator of the forum, because they already run the platform.
 *   2. A **community designation** (`community_staff_roles`: moderator | developer | staff). This is
 *      the only way a non-platform-admin can moderate, and granting one is restricted to a
 *      super_admin. Being a forum moderator grants *nothing* outside the forum — it never touches
 *      catalog, billing, provisioning or any other control-plane route.
 *
 * The resolved access object is always read from the database at request time. Nothing in it is
 * ever taken from a request body, a header, or the client's cached session (which the SPA uses for
 * display only). Every service call that can change content re-checks the object it is given, and
 * a caller that forgot to load one cannot construct a privileged write by hand: the capability
 * helpers are pure functions of this record.
 */

export type CommunityDesignation = 'moderator' | 'developer' | 'staff';

export interface CommunityMemberRow {
  user_id: string;
  bio: string;
  website_url: string | null;
  location: string | null;
  reputation: number;
  accepted_answers: number;
  directory_listed: boolean;
  restricted_until: string | null;
  restriction_reason: string | null;
  muted_from_reports: boolean;
  last_seen_at: string | null;
  joined_at: string;
  updated_at: string;
}

export interface CommunityAccess {
  userId: string;
  /** users.role — 'customer' for ordinary members. */
  platformRole: string;
  /** users.username, or a stable fallback for accounts that predate username assignment. */
  username: string;
  displayName: string;
  designations: CommunityDesignation[];
  isStaff: boolean;
  isModerator: boolean;
  isDeveloper: boolean;
  isRestricted: boolean;
  restrictionReason: string | null;
  member: CommunityMemberRow;
}

interface AccessRow {
  id: string;
  role: string;
  status: string;
  username: string | null;
  full_name: string;
  member: CommunityMemberRow | null;
  designations: string[] | null;
}

export function fallbackUsername(userId: string, username: string | null): string {
  if (username && username.trim().length >= 3) return username.trim();
  return `member-${userId.replace(/-/g, '').slice(0, 8)}`;
}

function toMemberRow(row: CommunityMemberRow | null, userId: string): CommunityMemberRow {
  return row ?? {
    user_id: userId,
    bio: '',
    website_url: null,
    location: null,
    reputation: 0,
    accepted_answers: 0,
    directory_listed: true,
    restricted_until: null,
    restriction_reason: null,
    muted_from_reports: false,
    last_seen_at: null,
    joined_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

function isRestrictedNow(member: CommunityMemberRow): boolean {
  if (!member.restricted_until) return false;
  const until = new Date(member.restricted_until).getTime();
  return Number.isFinite(until) && until > Date.now();
}

/**
 * Reads the caller's *current* community authority. Throws rather than degrading to "member with no
 * restrictions" when the account cannot be loaded: a failure to verify must never be mistaken for
 * permission to write.
 */
export async function loadAccess(db: Queryable, userId: string): Promise<CommunityAccess> {
  const { rows } = await db.query<AccessRow>(
    `SELECT u.id, u.role, u.status, u.username, u.full_name,
            to_jsonb(m.*) AS member,
            coalesce((SELECT array_agg(r.role) FROM community_staff_roles r WHERE r.user_id = u.id), '{}') AS designations
       FROM users u
       LEFT JOIN community_members m ON m.user_id = u.id
      WHERE u.id = $1
      LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) throw new UnauthorizedError('Account no longer exists');
  if (row.status !== 'active') throw new UnauthorizedError('Account is not active');

  const designations = (row.designations ?? []).filter(
    (value): value is CommunityDesignation => value === 'moderator' || value === 'developer' || value === 'staff'
  );
  const member = toMemberRow(row.member, row.id);
  const platformStaff = row.role === 'admin' || row.role === 'super_admin';

  return {
    userId: row.id,
    platformRole: row.role,
    username: fallbackUsername(row.id, row.username),
    displayName: (row.full_name ?? '').trim() || fallbackUsername(row.id, row.username),
    designations,
    isStaff: platformStaff || designations.includes('staff'),
    isModerator: platformStaff || designations.includes('moderator'),
    isDeveloper: designations.includes('developer'),
    isRestricted: isRestrictedNow(member),
    restrictionReason: isRestrictedNow(member) ? member.restriction_reason : null,
    member,
  };
}

/**
 * A platform super_admin — the only role allowed to grant community designations, change categories
 * into a staff-only mode, or publish a solution into the AI corpus.
 */
export function isSuperAdmin(access: CommunityAccess): boolean {
  return access.platformRole === 'super_admin';
}

/** Posting gate: restricted members may read everything and write nothing. */
export function assertCanPost(access: CommunityAccess): void {
  if (access.isRestricted) {
    const until = access.member.restricted_until ? new Date(access.member.restricted_until) : null;
    const when = until && Number.isFinite(until.getTime()) ? ` until ${until.toISOString().slice(0, 10)}` : '';
    throw new ForbiddenError(
      `Your community posting is restricted${when}${access.restrictionReason ? `: ${access.restrictionReason}` : ''}. You can still read and search the community.`
    );
  }
}

/** Only moderators (and platform admins) may act on somebody else's content. */
export function assertModerator(access: CommunityAccess): void {
  if (!access.isModerator) throw new ForbiddenError('Only community moderators can perform this action');
}

export function canModerate(access: CommunityAccess): boolean {
  return access.isModerator;
}

/**
 * Content ownership rule for edits and deletes: an author may change their own post (within the
 * service's edit window), and a moderator may change any post. There is no third path — a reply
 * author cannot edit the discussion they replied to, and an author cannot pin, lock or accept a
 * solution on a discussion they do not own.
 */
export function assertAuthorOrModerator(access: CommunityAccess, authorId: string): void {
  if (access.isModerator) return;
  if (access.userId === authorId) return;
  throw new ForbiddenError('You can only change your own community posts');
}
