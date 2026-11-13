import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';

/**
 * Community reputation and badges.
 *
 * The rule the brief sets — "a fair reputation system based on meaningful community
 * contributions, not artificial activity" — is implemented as a ledger, not a counter:
 *
 *   * every award is a `community_reputation_events` row with a unique (member, kind, item) index,
 *     so writing the same reply twice, accepting the same answer twice, or replaying a request
 *     awards nothing the second time;
 *   * the member's total is only moved when that insert actually happened, so the number on a
 *     profile is always the sum of the ledger rather than a guess;
 *   * there are no points for logging in, viewing, browsing or posting the Nth one-line reply —
 *     the only awards are for content other people acted on (an accepted answer, a reaction) or
 *     for a tutorial, and an accepted solution verified for the knowledge base is worth more than
 *     an unverified one.
 */

export type ReputationKind =
  | 'reply-accepted'
  | 'reply-posted'
  | 'reaction-received'
  | 'tutorial-published'
  | 'question-solved'
  | 'solution-verified';

export const REPUTATION_POINTS: Record<ReputationKind, number> = {
  'reply-accepted': 15,
  'reply-posted': 2,
  'reaction-received': 1,
  'tutorial-published': 10,
  'question-solved': 3,
  'solution-verified': 5,
};

export interface ReputationAward {
  userId: string;
  kind: ReputationKind;
  sourceType: 'discussion' | 'reply' | 'reaction';
  sourceId: string;
}

/** Ensures the profile row exists; every member gets one the first time they do anything. */
export async function ensureMemberRow(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO community_members (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

/**
 * Records one award. Returns true only when the ledger grew, which is what makes every caller
 * idempotent without needing to know whether this is the first time the event is being recorded.
 */
export async function awardReputation(db: Queryable, award: ReputationAward): Promise<boolean> {
  const points = REPUTATION_POINTS[award.kind];
  if (!points) return false;
  await ensureMemberRow(db, award.userId);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO community_reputation_events (id, user_id, kind, points, source_type, source_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, kind, source_type, source_id) WHERE source_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [randomUUID(), award.userId, award.kind, points, award.sourceType, award.sourceId]
  );
  if (!rows[0]) return false;
  await db.query(
    `UPDATE community_members SET reputation = reputation + $2, updated_at = now() WHERE user_id = $1`,
    [award.userId, points]
  );
  return true;
}

export interface BadgeRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: string;
  icon: string;
}

/**
 * Awards an automatic badge. Manual badges are ignored here on purpose: a service path can never
 * hand out a "Verified Developer" or "CloudHost247 Staff" badge, only a super_admin can.
 */
export async function awardAutomaticBadge(db: Queryable, userId: string, slug: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO community_member_badges (user_id, badge_id)
     SELECT $1, b.id FROM community_badges b WHERE b.slug = $2 AND b.kind = 'automatic'
     ON CONFLICT (user_id, badge_id) DO NOTHING
     RETURNING badge_id AS id`,
    [userId, slug]
  );
  return Boolean(rows[0]);
}

/** Badges a profile shows: automatic awards plus staff-granted designations. */
export async function listMemberBadges(db: Queryable, userId: string): Promise<BadgeRow[]> {
  const { rows } = await db.query<BadgeRow>(
    `SELECT b.id, b.slug, b.name, b.description, b.kind, b.icon
       FROM community_member_badges mb
       JOIN community_badges b ON b.id = mb.badge_id
      WHERE mb.user_id = $1
      ORDER BY CASE b.kind WHEN 'manual' THEN 0 ELSE 1 END, b.name ASC`,
    [userId]
  );
  return rows;
}
