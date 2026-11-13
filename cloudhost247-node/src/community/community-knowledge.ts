import type { Queryable } from '../db/types';
import { NotFoundError, ValidationError } from '../lib/errors';
import { chunkDocument } from '../ai-website/chunking';
import { contentFingerprint } from '../ai-website/types';
import {
  findSourceByKey,
  markSourceExcluded,
  markSourceIndexed,
  replaceChunks,
  upsertSource,
} from '../ai-website/website-knowledge-repo';
import { notifyCommunity } from './community-notifications';
import { awardAutomaticBadge, awardReputation } from './reputation';
import { stripMarkdown } from './text';

/**
 * Community → AI knowledge bridge.
 *
 * A discussion is a conversation; an accepted solution that a moderator has *verified* is a claim
 * CloudHost247 is willing to stand behind. Only that second thing is ever published, and only by a
 * super_admin:
 *
 *   moderator marks an answer as accepted  →  it is a solved thread for readers (no AI effect)
 *   super_admin verifies it                →  a `community_solution` source exists in the corpus
 *   verification revoked / thread removed  →  the source is excluded and its chunks deleted
 *
 * Why this shape rather than a second knowledge base: the retrieval, ranking, citation and
 * freshness machinery in src/ai-website already exists and is tested, and the trust model in 0102
 * already distinguishes "approved for this exact revision" (approval_status + approved_fingerprint)
 * from everything else. A published solution is stored with:
 *
 *   authority_tier = 4  — below legal/policy (1) and product/service pages (2), below documentation
 *                         (3), above an unreviewed source (6). An official page always wins a
 *                         conflict; a verified community answer may fill the gap where no official
 *                         page covers the question.
 *   approval_status = 'approved' with approved_fingerprint = fingerprint, so an edit to the thread
 *                         makes `freshness()` report `revision_unapproved` until it is re-verified.
 *   valid_until = NULL, refreshed by the worker sweep (refreshCommunitySolutions) so a published
 *                         answer never silently goes stale on the 7-day clock.
 *
 * The assistant is therefore never able to quote an unverified community opinion as policy, and a
 * later edit to the answer removes its authority instead of leaving a stale claim in place.
 */

export const COMMUNITY_AUTHORITY_TIER = 4;
export const COMMUNITY_SOURCE_KIND = 'community_solution';
export const COMMUNITY_REFRESH_INTERVAL_MS = 6 * 60 * 60_000;

export function sourceKeyForDiscussion(discussionId: string): string {
  return `community:discussion:${discussionId}`;
}

interface PublishableDiscussion {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[] | null;
  category_name: string;
  category_slug: string;
  accepted_reply_id: string | null;
  author_username: string | null;
  author_full_name: string;
  accepted_body: string | null;
  accepted_reply_id_check: string | null;
  accepted_author_username: string | null;
  accepted_author_full_name: string | null;
  deleted_at: string | null;
}

async function loadPublishable(db: Queryable, discussionId: string): Promise<PublishableDiscussion> {
  const { rows } = await db.query<PublishableDiscussion>(
    `SELECT d.id, d.slug, d.title, d.body, d.tags, d.accepted_reply_id, d.deleted_at,
            c.name AS category_name, c.slug AS category_slug,
            u.username AS author_username, u.full_name AS author_full_name,
            r.body AS accepted_body, r.id AS accepted_reply_id_check,
            ru.username AS accepted_author_username, ru.full_name AS accepted_author_full_name
       FROM community_discussions d
       JOIN community_categories c ON c.id = d.category_id
       JOIN users u ON u.id = d.author_id
       LEFT JOIN community_replies r ON r.id = d.accepted_reply_id AND r.deleted_at IS NULL
       LEFT JOIN users ru ON ru.id = r.author_id
      WHERE d.id = $1
      LIMIT 1`,
    [discussionId]
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('That discussion does not exist');
  return row;
}

export interface PublishResult {
  sourceId: string;
  chunkCount: number;
  url: string;
}

/**
 * Publishes (or re-publishes) the accepted solution of a discussion into the knowledge corpus.
 * The caller must already have established that the actor is a super_admin.
 */
export async function publishAcceptedSolution(
  db: Queryable,
  discussionId: string,
  actorId: string
): Promise<PublishResult> {
  const discussion = await loadPublishable(db, discussionId);
  if (discussion.deleted_at) throw new ValidationError('A removed discussion cannot be published');
  if (!discussion.accepted_reply_id || !discussion.accepted_body) {
    throw new ValidationError('Mark a reply as the accepted solution before publishing it to the knowledge base');
  }

  const url = `/community/discussion/${discussion.slug}`;
  const question = stripMarkdown(discussion.body).slice(0, 4000);
  const answer = stripMarkdown(discussion.accepted_body).slice(0, 6000);
  const body = [
    `Question published in the CloudHost247 community (${discussion.category_name}).`,
    '',
    `**Question:** ${discussion.title}`,
    '',
    question,
    '',
    `**Verified answer** — contributed by ${discussion.accepted_author_username ?? 'a community member'} and verified by CloudHost247:`,
    '',
    answer,
    '',
    `Read the full thread: ${url}`,
  ].join('\n');

  const fingerprint = contentFingerprint({
    title: discussion.title,
    description: `Verified community solution · ${discussion.category_name}`,
    body,
    faqs: [],
  });

  const upserted = await upsertSource(db, {
    sourceKey: sourceKeyForDiscussion(discussionId),
    title: `Community solution: ${discussion.title}`.slice(0, 255),
    // The repo's typing enumerates the website taxonomy; the database CHECK was widened in 0105 and
    // this cast is the single place the two vocabularies meet. Keeping it explicit beats widening
    // WebsiteSourceKind, which website discovery iterates and would then try to discover itself.
    kind: COMMUNITY_SOURCE_KIND as never,
    surface: 'community',
    url,
    aliases: [],
    section: discussion.category_name,
    category: discussion.category_slug,
    fingerprint,
    wordCount: body.split(/\s+/).filter(Boolean).length,
    sourceModifiedAt: new Date().toISOString(),
  });

  const chunks = chunkDocument({
    title: `Community solution: ${discussion.title}`,
    description: `Verified community solution in ${discussion.category_name}`,
    headings: [discussion.category_name],
    body,
    faqs: [],
    relatedLinks: [],
    prices: [],
  });

  await replaceChunks(db, upserted.id, chunks, {
    url,
    pageTitle: `Community solution: ${discussion.title}`.slice(0, 255),
    kind: COMMUNITY_SOURCE_KIND,
    category: discussion.category_slug,
    fingerprint,
  });

  // Reviewer approval is recorded on the same row: "approved" alone is not enough for the trust
  // model — the *revision* that was approved has to match the one that is indexed.
  await db.query(
    `UPDATE ai_knowledge_sources
        SET approval_status = 'approved', authority_tier = $2, approved_fingerprint = $3,
            approved_by = $4, approved_at = now(), historical = false, valid_until = NULL,
            excluded = false, excluded_reason = NULL, status = 'active',
            source_modified_at = now(), content_observed_at = now(), updated_at = now()
      WHERE id = $1`,
    [upserted.id, COMMUNITY_AUTHORITY_TIER, fingerprint, actorId]
  );
  await markSourceIndexed(db, upserted.id);

  await db.query(
    `UPDATE community_discussions SET ai_source_id = $2, ai_published_at = now(), updated_at = now() WHERE id = $1`,
    [discussionId, upserted.id]
  );

  const replyAuthor = await db.query<{ author_id: string }>(
    'SELECT author_id FROM community_replies WHERE id = $1',
    [discussion.accepted_reply_id]
  );
  if (replyAuthor.rows[0]) {
    await awardReputation(db, {
      userId: replyAuthor.rows[0].author_id,
      kind: 'solution-verified',
      sourceType: 'reply',
      sourceId: discussion.accepted_reply_id,
    });
    await awardAutomaticBadge(db, replyAuthor.rows[0].author_id, 'accepted-solution');
    await notifyCommunity(db, {
      userId: replyAuthor.rows[0].author_id,
      type: 'COMMUNITY_SOLUTION_VERIFIED',
      title: 'Your answer was verified for the CloudHost247 knowledge base',
      message: `"${discussion.title.slice(0, 140)}" may now be quoted by the CloudHost247 assistant when a customer asks the same question.`,
      resourceType: 'community_discussion',
      resourceId: discussionId,
      actorId,
    });
  }

  return { sourceId: upserted.id, chunkCount: chunks.length, url };
}

/** Removes a previously published solution from retrieval, keeping the row for the audit trail. */
export async function revokePublishedSolution(
  db: Queryable,
  discussionId: string,
  actorId: string,
  reason: string
): Promise<boolean> {
  const existing = await findSourceByKey(db, sourceKeyForDiscussion(discussionId));
  if (!existing) return false;
  await markSourceExcluded(db, existing.id, reason || 'Revoked by a CloudHost247 administrator');
  await db.query(
    `UPDATE ai_knowledge_sources SET approval_status = 'rejected', updated_at = now() WHERE id = $1`,
    [existing.id]
  );
  await db.query(
    'UPDATE community_discussions SET ai_source_id = NULL, ai_published_at = NULL, updated_at = now() WHERE id = $1',
    [discussionId]
  );
  const discussion = await loadPublishable(db, discussionId).catch(() => null);
  const replyId = discussion?.accepted_reply_id;
  if (replyId) {
    const replyAuthor = await db.query<{ author_id: string }>('SELECT author_id FROM community_replies WHERE id = $1', [replyId]);
    if (replyAuthor.rows[0]) {
      await notifyCommunity(db, {
        userId: replyAuthor.rows[0].author_id,
        type: 'COMMUNITY_SOLUTION_VERIFIED',
        title: 'A verified community answer is no longer used by the assistant',
        message: `"${(discussion?.title ?? 'The thread').slice(0, 140)}" was withdrawn from the knowledge base. Reason: ${reason || 'content changed'}.`,
        resourceType: 'community_discussion',
        resourceId: discussionId,
        actorId,
      });
    }
  }
  return true;
}

// The trust model lets a published answer ride for 7 days; an hourly pass revalidation keeps the
// stamp far inside that window and withdraws a withdrawn answer long before it expires.
export const COMMUNITY_SOLUTION_REFRESH_INTERVAL_MS = 60 * 60_000;

/**
 * Keeps every published solution inside the trust model's 7-day freshness window, and withdraws one
 * whose accepted answer disappeared or whose thread was edited after verification.
 *
 * Called by the worker sweep (src/worker/main.ts). Safe to run concurrently: it only stamps
 * `last_synced_at` for unchanged revisions, and revokes by the same rules a moderator would.
 */
export async function refreshCommunitySolutions(
  db: Queryable
): Promise<{ refreshed: number; revoked: number }> {
  const { rows } = await db.query<{
    id: string; discussion_id: string; fingerprint: string | null; approved_fingerprint: string | null;
    accepted_reply_id: string | null; deleted_at: string | null; body: string; title: string; slug: string;
    accepted_body: string | null; category_name: string;
  }>(
    `SELECT s.id, s.fingerprint, s.approved_fingerprint,
            d.id AS discussion_id, d.accepted_reply_id, d.deleted_at, d.body, d.title, d.slug,
            r.body AS accepted_body, c.name AS category_name
       FROM ai_knowledge_sources s
       JOIN community_discussions d ON s.source_key = 'community:discussion:' || d.id
       JOIN community_categories c ON c.id = d.category_id
       LEFT JOIN community_replies r ON r.id = d.accepted_reply_id AND r.deleted_at IS NULL
      WHERE s.source_kind = 'community_solution' AND s.excluded = false
      LIMIT 500`
  );

  let refreshed = 0;
  let revoked = 0;
  for (const row of rows) {
    if (row.deleted_at || !row.accepted_reply_id || !row.accepted_body) {
      await markSourceExcluded(db, row.id, 'The community solution is no longer available');
      await db.query('UPDATE ai_knowledge_sources SET approval_status = $2 WHERE id = $1', [row.id, 'rejected']);
      await db.query('UPDATE community_discussions SET ai_source_id = NULL, ai_published_at = NULL WHERE id = $1', [row.discussion_id]);
      revoked += 1;
      continue;
    }
    const current = contentFingerprint({
      title: row.title,
      description: `Verified community solution · ${row.category_name}`,
      body: [
        `Question published in the CloudHost247 community (${row.category_name}).`,
        '',
        `**Question:** ${row.title}`,
        '',
        stripMarkdown(row.body).slice(0, 4000),
        '',
        '**Verified answer** — verified by CloudHost247:',
        '',
        stripMarkdown(row.accepted_body).slice(0, 6000),
        '',
        `Read the full thread: /community/discussion/${row.slug}`,
      ].join('\n'),
      faqs: [],
    });
    if (row.approved_fingerprint && current !== row.approved_fingerprint) {
      // The thread changed after verification. Authority is withdrawn rather than carried over to
      // content nobody reviewed — a moderator can publish the new revision in one click.
      await db.query(
        `UPDATE ai_knowledge_sources SET approval_status = 'unreviewed', approved_fingerprint = NULL, updated_at = now() WHERE id = $1`,
        [row.id]
      );
      revoked += 1;
      continue;
    }
    await db.query('UPDATE ai_knowledge_sources SET last_synced_at = now(), updated_at = now() WHERE id = $1', [row.id]);
    refreshed += 1;
  }
  return { refreshed, revoked };
}
