import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signAuthToken } from '../../src/lib/jwt';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { deleteSourcesNotIn } from '../../src/ai-website/website-knowledge-repo';
import { refreshCommunitySolutions } from '../../src/community/community-knowledge';

/**
 * Community Forum API — end-to-end through the real Fastify app against a real (embedded) Postgres.
 *
 * These tests deliberately exercise authorization from the outside: every request carries a real
 * signed token and the assertions are about what the *server* decided, not about what a helper
 * function would return in isolation. The negative cases matter as much as the positive ones —
 * anonymous writes, a member granting themselves a role, a customer publishing to the knowledge
 * base, a locked thread, a restricted member, an attachment that lies about its type.
 */

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'a'.repeat(32),
} as NodeJS.ProcessEnv);

interface Fixture {
  app: ReturnType<typeof buildApp>;
  db: PGlite;
  users: {
    superAdmin: { id: string; headers: { authorization: string } };
    admin: { id: string; headers: { authorization: string } };
    alice: { id: string; headers: { authorization: string }; username: string };
    bob: { id: string; headers: { authorization: string }; username: string };
    carol: { id: string; headers: { authorization: string }; username: string };
  };
  categoryId: (slug: string) => Promise<string>;
}

async function setup(): Promise<Fixture> {
  const db = new PGlite();
  await migrateUp(new PgliteClient(db), { isProduction: false });
  const app = buildApp(env, { serveFrontend: false, pool: db as never });

  const make = async (email: string, role: string, username: string, fullName: string) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, username) VALUES ($1,$2,'unused',$3,$4,$5)`,
      [id, email, fullName, role, username]
    );
    return { id, headers: { authorization: `Bearer ${signAuthToken(env, { sub: id, email, role })}` }, username };
  };

  const superAdmin = await make('root@example.com', 'super_admin', 'rootadmin', 'Root Admin');
  const admin = await make('admin@example.com', 'admin', 'forumadmin', 'Forum Admin');
  const alice = await make('alice@example.com', 'customer', 'alice', 'Alice Member');
  const bob = await make('bob@example.com', 'customer', 'bob', 'Bob Member');
  const carol = await make('carol@example.com', 'customer', 'carol', 'Carol Member');

  const categoryId = async (slug: string) => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM community_categories WHERE slug = $1', [slug]);
    const row = rows[0];
    if (!row) throw new Error(`Missing category ${slug}`);
    return row.id;
  };

  return { app, db, users: { superAdmin, admin, alice, bob, carol }, categoryId };
}

describe('Community Forum API', () => {
  it('ships the twelve categories, an honest empty state, and refuses anonymous writes', async () => {
    const { app, db, users, categoryId } = await setup();
    try {
      const home = await app.inject({ method: 'GET', url: '/api/v1/community/home' });
      expect(home.statusCode).toBe(200);
      const body = home.json();
      expect(body.categories).toHaveLength(12);
      expect(body.categories.map((category: { slug: string }) => category.slug)).toContain('developer-corner');
      expect(body.stats).toMatchObject({ discussions: 0, replies: 0, solved: 0 });
      expect(body.latest).toEqual([]);
      expect(body.canParticipate).toBe(false);

      const anonymous = await app.inject({
        method: 'POST',
        url: '/api/v1/community/discussions',
        payload: { categoryId: await categoryId('general-discussion'), title: 'Anonymous post attempt', body: 'This must be refused.' },
      });
      expect(anonymous.statusCode).toBe(401);

      const discussionCount = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM community_discussions');
      expect(discussionCount.rows[0]?.count).toBe('0');
    } finally {
      await app.close();
    }
  });

  it('creates discussions, replies, accepted solutions, reactions, bookmarks and reputation', async () => {
    const { app, db, users, categoryId } = await setup();
    try {
      const qa = await categoryId('questions-and-answers');
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/community/discussions',
        headers: users.alice.headers,
        payload: {
          categoryId: qa,
          title: 'How do I point a subdomain at a cPanel account?',
          body: 'I want `blog.example.com` to serve the cPanel account. Which DNS record should I add?\n\n```\nblog 300 IN A 203.0.113.10\n```',
          tags: ['DNS', 'cpanel'],
        },
      });
      expect(created.statusCode).toBe(201);
      const { id: discussionId, slug } = created.json();
      expect(slug).toBe('how-do-i-point-a-subdomain-at-a-cpanel-account');

      const detail = await app.inject({ method: 'GET', url: `/api/v1/community/discussions/${slug}`, headers: users.bob.headers });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().discussion.tags).toEqual(['dns', 'cpanel']);
      expect(detail.json().discussion.author.username).toBe('alice');
      expect(detail.json().viewer.isBookmarked).toBe(false);

      // Announcements are staff-only: a customer is refused, a platform admin is not.
      const announcementCategory = await categoryId('announcements');
      const refused = await app.inject({
        method: 'POST',
        url: '/api/v1/community/discussions',
        headers: users.alice.headers,
        payload: { categoryId: announcementCategory, title: 'Customer tries to announce', body: 'Not allowed at all.' },
      });
      expect(refused.statusCode).toBe(403);

      const reply = await app.inject({
        method: 'POST',
        url: `/api/v1/community/discussions/${discussionId}/replies`,
        headers: users.bob.headers,
        payload: { body: 'Add an A record for `blog` pointing at the shared IP, then add the subdomain in cPanel.' },
      });
      expect(reply.statusCode).toBe(201);
      const replyId = reply.json().id;

      // Mentioning a real username notifies that member; a mention of an unknown name does nothing.
      await app.inject({
        method: 'POST',
        url: `/api/v1/community/discussions/${discussionId}/replies`,
        headers: users.carol.headers,
        payload: { body: 'Thanks @bob and @nobodyatall — that fixed it.' },
      });
      // The discussion author is notified of every reply; a mentioned member gets a mention.
      const aliceNotifications = await app.inject({ method: 'GET', url: '/api/v1/community/notifications', headers: users.alice.headers });
      expect(aliceNotifications.json().notifications.map((entry: { type: string }) => entry.type)).toContain('COMMUNITY_REPLY');
      const bobNotifications = await app.inject({ method: 'GET', url: '/api/v1/community/notifications', headers: users.bob.headers });
      expect(bobNotifications.json().notifications.map((entry: { type: string }) => entry.type)).toContain('COMMUNITY_MENTION');

      // Only the discussion author (or a moderator) may accept a solution; a stranger is refused.
      const strangerAccept = await app.inject({
        method: 'POST',
        url: `/api/v1/community/discussions/${discussionId}/accept`,
        headers: users.carol.headers,
        payload: { replyId },
      });
      expect(strangerAccept.statusCode).toBe(403);
      const accepted = await app.inject({
        method: 'POST',
        url: `/api/v1/community/discussions/${discussionId}/accept`,
        headers: users.alice.headers,
        payload: { replyId },
      });
      expect(accepted.statusCode).toBe(200);

      const afterAccept = await app.inject({ method: 'GET', url: `/api/v1/community/discussions/${slug}` });
      expect(afterAccept.json().discussion.isSolved).toBe(true);
      expect(afterAccept.json().acceptedReplyId).toBe(replyId);
      expect(afterAccept.json().replies[0].isAccepted).toBe(true);

      const bobProfile = await app.inject({ method: 'GET', url: '/api/v1/community/members/bob' });
      expect(bobProfile.json().member.acceptedAnswers).toBe(1);
      expect(bobProfile.json().member.reputation).toBeGreaterThan(0);
      expect(bobProfile.json().member.badges.map((badge: { slug: string }) => badge.slug)).toContain('accepted-solution');

      // Reactions are idempotent toggles and award the author exactly once.
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/community/reactions',
        headers: users.alice.headers,
        payload: { targetType: 'reply', targetId: replyId },
      });
      expect(first.json()).toMatchObject({ reacted: true, count: 1 });
      const second = await app.inject({
        method: 'POST',
        url: '/api/v1/community/reactions',
        headers: users.alice.headers,
        payload: { targetType: 'reply', targetId: replyId },
      });
      expect(second.json()).toMatchObject({ reacted: false, count: 0 });

      const bookmark = await app.inject({ method: 'POST', url: `/api/v1/community/discussions/${discussionId}/bookmark`, headers: users.bob.headers });
      expect(bookmark.json()).toEqual({ bookmarked: true });
      const bookmarks = await app.inject({ method: 'GET', url: '/api/v1/community/bookmarks', headers: users.bob.headers });
      expect(bookmarks.json().items).toHaveLength(1);
      expect(bookmarks.json().items[0].slug).toBe(slug);

      const search = await app.inject({ method: 'GET', url: '/api/v1/community/search?q=subdomain' });
      expect(search.statusCode).toBe(200);
      expect(search.json().discussions.map((entry: { slug: string }) => entry.slug)).toContain(slug);

      const homeAfter = await app.inject({ method: 'GET', url: '/api/v1/community/home' });
      expect(homeAfter.json().stats).toMatchObject({ discussions: 1, replies: 2, solved: 1 });
      const rep = await db.query<{ reputation: number }>('SELECT reputation FROM community_members WHERE user_id = $1', [users.bob.id]);
      const reputationBefore = rep.rows[0]?.reputation ?? 0;
      // Toggling the reaction off and on again must not double-award: the ledger is unique per item.
      await app.inject({
        method: 'POST',
        url: '/api/v1/community/reactions',
        headers: users.carol.headers,
        payload: { targetType: 'reply', targetId: replyId },
      });
      const rep2 = await db.query<{ reputation: number }>('SELECT reputation FROM community_members WHERE user_id = $1', [users.bob.id]);
      expect(rep2.rows[0]?.reputation).toBe(reputationBefore);
    } finally {
      await app.close();
    }
  });

  it('enforces moderation rights, locking, restrictions and the super-admin-only roles', async () => {
    const { app, db, users, categoryId } = await setup();
    try {
      const category = await categoryId('general-discussion');
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/community/discussions',
        headers: users.alice.headers,
        payload: { categoryId: category, title: 'A thread that will be moderated', body: 'Body text long enough to pass the check.' },
      });
      const { id: discussionId, slug } = created.json();

      // A customer cannot use the admin surface at all.
      const customerAdmin = await app.inject({ method: 'GET', url: '/api/v1/admin/community/overview', headers: users.alice.headers });
      expect(customerAdmin.statusCode).toBe(403);

      // An admin can pin and lock.
      const flags = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/community/discussions/${discussionId}`,
        headers: users.admin.headers,
        payload: { pinned: true, locked: true },
      });
      expect(flags.statusCode).toBe(200);
      const lockedReply = await app.inject({
        method: 'POST',
        url: `/api/v1/community/discussions/${discussionId}/replies`,
        headers: users.bob.headers,
        payload: { body: 'This reply should be refused.' },
      });
      expect(lockedReply.statusCode).toBe(403);

      // A plain admin cannot mint roles or badges; a super_admin can.
      const adminGrant = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/community/members/${users.bob.id}/roles`,
        headers: users.admin.headers,
        payload: { role: 'moderator', grant: true },
      });
      expect(adminGrant.statusCode).toBe(403);
      const superGrant = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/community/members/${users.bob.id}/roles`,
        headers: users.superAdmin.headers,
        payload: { role: 'moderator', grant: true },
      });
      expect(superGrant.statusCode).toBe(200);
      const staffRoles = await db.query<{ role: string }>('SELECT role FROM community_staff_roles WHERE user_id = $1', [users.bob.id]);
      expect(staffRoles.rows.map((row) => row.role)).toEqual(['moderator']);

      // The role a client *asks for* is irrelevant: the body is validated against a fixed tuple.
      const invalidRole = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/community/members/${users.carol.id}/roles`,
        headers: users.superAdmin.headers,
        payload: { role: 'super_admin', grant: true },
      });
      expect(invalidRole.statusCode).toBe(400);

      // Restrictions stop writing but never reading.
      const restrict = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/community/members/${users.carol.id}/restriction`,
        headers: users.admin.headers,
        payload: { restrictedUntil: new Date(Date.now() + 86_400_000).toISOString(), reason: 'Repeated spam' },
      });
      expect(restrict.statusCode).toBe(200);
      const restrictedWrite = await app.inject({
        method: 'POST',
        url: '/api/v1/community/discussions',
        headers: users.carol.headers,
        payload: { categoryId: category, title: 'Restricted member posting', body: 'This must be refused by the server.' },
      });
      expect(restrictedWrite.statusCode).toBe(403);
      expect(restrictedWrite.json().message).toMatch(/restricted/i);
      const restrictedRead = await app.inject({ method: 'GET', url: `/api/v1/community/discussions/${slug}`, headers: users.carol.headers });
      expect(restrictedRead.statusCode).toBe(200);

      // Reports: a member files one, a moderator resolves it, and the audit trail records it.
      const report = await app.inject({
        method: 'POST',
        url: '/api/v1/community/reports',
        headers: users.bob.headers,
        payload: { targetType: 'discussion', targetId: discussionId, reason: 'off_topic', detail: 'Duplicate thread' },
      });
      expect(report.statusCode).toBe(201);
      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/v1/community/reports',
        headers: users.bob.headers,
        payload: { targetType: 'discussion', targetId: discussionId, reason: 'spam' },
      });
      expect(duplicate.statusCode).toBe(409);
      const queue = await app.inject({ method: 'GET', url: '/api/v1/admin/community/reports', headers: users.admin.headers });
      expect(queue.json().reports).toHaveLength(1);
      const resolved = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/community/reports/${report.json().id}/resolve`,
        headers: users.admin.headers,
        payload: { action: 'dismissed', note: 'No action needed' },
      });
      expect(resolved.statusCode).toBe(200);
      const audit = await db.query<{ action: string }>(`SELECT action FROM audit_logs WHERE resource_type LIKE 'community%' ORDER BY created_at`);
      expect(audit.rows.map((row) => row.action)).toContain('community.report.dismissed');
    } finally {
      await app.close();
    }
  });

  it('publishes a verified solution into the AI corpus and withdraws it again', async () => {
    const { app, db, users, categoryId } = await setup();
    try {
      const qa = await categoryId('questions-and-answers');
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/community/discussions',
        headers: users.alice.headers,
        payload: {
          categoryId: qa,
          title: 'What TTL should a DNS record use during a migration?',
          body: 'We are moving to CloudHost247 and want to avoid a long outage.',
        },
      });
      const { id: discussionId, slug } = created.json();
      const reply = await app.inject({
        method: 'POST',
        url: `/api/v1/community/discussions/${discussionId}/replies`,
        headers: users.bob.headers,
        payload: { body: 'Lower the TTL to 300 seconds at least 24 hours before the change, then raise it again afterwards.' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/community/discussions/${discussionId}/accept`,
        headers: users.alice.headers,
        payload: { replyId: reply.json().id },
      });

      // Publishing is super_admin only — an accepted solution alone changes no knowledge.
      const adminPublish = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/community/discussions/${discussionId}/publish-solution`,
        headers: users.admin.headers,
      });
      expect(adminPublish.statusCode).toBe(403);

      const published = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/community/discussions/${discussionId}/publish-solution`,
        headers: users.superAdmin.headers,
      });
      expect(published.statusCode).toBe(200);
      expect(published.json().chunkCount).toBeGreaterThan(0);
      expect(published.json().url).toBe(`/community/discussion/${slug}`);

      const source = await db.query<{
        id: string; source_kind: string; surface: string; approval_status: string; authority_tier: number;
        approved_fingerprint: string; fingerprint: string; sync_status: string; excluded: boolean; url: string;
      }>('SELECT id, source_kind, surface, approval_status, authority_tier, approved_fingerprint, fingerprint, sync_status, excluded, url FROM ai_knowledge_sources WHERE source_kind = $1', ['community_solution']);
      const row = source.rows[0]!;
      expect(row).toMatchObject({
        source_kind: 'community_solution',
        surface: 'community',
        approval_status: 'approved',
        authority_tier: 4,
        sync_status: 'indexed',
        excluded: false,
        url: `/community/discussion/${slug}`,
      });
      // Approval is tied to the exact revision that was reviewed.
      expect(row.approved_fingerprint).toBe(row.fingerprint);

      const chunks = await db.query<{ content: string }>('SELECT content FROM ai_knowledge_chunks WHERE source_id = $1', [row.id]);
      expect(chunks.rows.length).toBeGreaterThan(0);
      expect(chunks.rows.map((entry) => entry.content).join(' ')).toMatch(/TTL|300 seconds/i);

      // The website reconciliation must not delete a source it never discovered.
      await deleteSourcesNotIn(db as never, ['spa:/hosting', 'spa:/tools']);
      const survives = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ai_knowledge_sources WHERE source_kind = 'community_solution'`
      );
      expect(survives.rows[0]?.count).toBe('1');

      // The worker's revalidation must be a genuine no-op for an untouched thread. Publish and
      // refresh hash the same assembled text, so an hourly sweep restamps the answer instead of
      // withdrawing authority nobody revoked — the failure mode this assertion exists for.
      const firstSweep = await refreshCommunitySolutions(db as never);
      expect(firstSweep).toMatchObject({ refreshed: 1, revoked: 0 });
      const secondSweep = await refreshCommunitySolutions(db as never);
      expect(secondSweep).toMatchObject({ refreshed: 1, revoked: 0 });
      const untouched = await db.query<{ approval_status: string; excluded: boolean }>(
        'SELECT approval_status, excluded FROM ai_knowledge_sources WHERE id = $1',
        [row.id]
      );
      expect(untouched.rows[0]).toMatchObject({ approval_status: 'approved', excluded: false });

      // An edit after verification withdraws the authority rather than carrying it to text nobody
      // reviewed, and says so in the source row a moderator reads.
      await db.query('UPDATE community_replies SET body = $2 WHERE id = $1', [reply.json().id, 'Just lower the TTL whenever it suits you.']);
      const afterEdit = await refreshCommunitySolutions(db as never);
      expect(afterEdit).toMatchObject({ refreshed: 0, revoked: 1 });
      const unreviewed = await db.query<{ approval_status: string; approved_fingerprint: string | null }>(
        'SELECT approval_status, approved_fingerprint FROM ai_knowledge_sources WHERE id = $1',
        [row.id]
      );
      expect(unreviewed.rows[0]?.approval_status).toBe('unreviewed');
      expect(unreviewed.rows[0]?.approved_fingerprint).toBeNull();

      // Withdrawal removes it from retrieval but keeps the audit row.
      const revoked = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/community/discussions/${discussionId}/publish-solution`,
        headers: users.superAdmin.headers,
        payload: { reason: 'Superseded by an official guide' },
      });
      expect(revoked.statusCode).toBe(200);
      const after = await db.query<{ excluded: boolean; approval_status: string }>('SELECT excluded, approval_status FROM ai_knowledge_sources WHERE id = $1', [row.id]);
      expect(after.rows[0]).toMatchObject({ excluded: true, approval_status: 'rejected' });
      const remainingChunks = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM ai_knowledge_chunks WHERE source_id = $1', [row.id]);
      expect(remainingChunks.rows[0]?.count).toBe('0');
    } finally {
      await app.close();
    }
  });

  it('validates attachments by content, not by the declared type, and serves images safely', async () => {
    const { app, users, categoryId } = await setup();
    try {
      const category = await categoryId('bug-reports');
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/community/discussions',
        headers: users.alice.headers,
        payload: { categoryId: category, title: 'Screenshot of the broken checkout', body: 'The button disappears on mobile Safari.' },
      });
      const { id: discussionId } = created.json();

      // A 1x1 transparent PNG.
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const upload = await app.inject({
        method: 'POST',
        url: '/api/v1/community/attachments',
        headers: users.alice.headers,
        payload: { discussionId, fileName: 'checkout.png', mimeType: 'image/png', dataBase64: png.toString('base64') },
      });
      expect(upload.statusCode).toBe(201);
      const attachmentId = upload.json().id;

      // Declaring PNG while sending JPEG bytes is refused: the magic bytes are the authority.
      const lie = await app.inject({
        method: 'POST',
        url: '/api/v1/community/attachments',
        headers: users.alice.headers,
        payload: {
          discussionId,
          fileName: 'not-really.png',
          mimeType: 'image/png',
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0]).toString('base64'),
        },
      });
      expect(lie.statusCode).toBe(400);

      // ...and so is anything that is not an allowlisted image at all.
      const script = await app.inject({
        method: 'POST',
        url: '/api/v1/community/attachments',
        headers: users.alice.headers,
        payload: { discussionId, fileName: 'x.svg', mimeType: 'image/png', dataBase64: Buffer.from('<svg onload="alert(1)"/>').toString('base64') },
      });
      expect(script.statusCode).toBe(400);

      const download = await app.inject({ method: 'GET', url: `/api/v1/community/attachments/${attachmentId}` });
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-type']).toBe('image/png');
      expect(download.headers['x-content-type-options']).toBe('nosniff');
      expect(download.headers['content-disposition']).toMatch(/^inline/);
      expect(download.rawPayload.length).toBe(png.length);
    } finally {
      await app.close();
    }
  });

  it('stores Markdown as text, never as HTML, and keeps the edit and delete rules honest', async () => {
    const { app, db, users, categoryId } = await setup();
    try {
      const category = await categoryId('general-discussion');
      const payloadBody = 'Here is a tag: <script>alert(1)</script>\n\n```js\nconst safe = true;\n```';
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/community/discussions',
        headers: users.alice.headers,
        payload: { categoryId: category, title: 'Testing how raw HTML is handled', body: payloadBody },
      });
      expect(created.statusCode).toBe(201);

      // The API returns the author's own text unchanged — rendering is React's job, so the <script>
      // is shown as characters rather than executed. Nothing here escapes or strips it, which is
      // exactly why the client renderer must never use innerHTML (pinned by the frontend tests).
      const detail = await app.inject({ method: 'GET', url: `/api/v1/community/discussions/${created.json().slug}` });
      expect(detail.json().discussion.body).toContain('<script>alert(1)</script>');

      // Another member cannot edit it.
      const foreignEdit = await app.inject({
        method: 'PATCH',
        url: `/api/v1/community/discussions/${created.json().id}`,
        headers: users.bob.headers,
        payload: { title: 'Hijacked title' },
      });
      expect(foreignEdit.statusCode).toBe(403);

      // The author can, and the edit is stamped.
      const edit = await app.inject({
        method: 'PATCH',
        url: `/api/v1/community/discussions/${created.json().id}`,
        headers: users.alice.headers,
        payload: { body: 'Edited: the markdown renderer shows this as text.' },
      });
      expect(edit.statusCode).toBe(200);
      const edited = await db.query<{ edited_at: string | null }>('SELECT edited_at FROM community_discussions WHERE id = $1', [created.json().id]);
      expect(edited.rows[0]?.edited_at).toBeTruthy();

      // A thread with replies cannot be removed by its author; a moderator can remove it.
      await app.inject({
        method: 'POST',
        url: `/api/v1/community/discussions/${created.json().id}/replies`,
        headers: users.bob.headers,
        payload: { body: 'A reply that makes this thread a conversation.' },
      });
      const authorDelete = await app.inject({
        method: 'DELETE',
        url: `/api/v1/community/discussions/${created.json().id}`,
        headers: users.alice.headers,
      });
      expect(authorDelete.statusCode).toBe(403);
      const moderatorDelete = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/community/discussions/${created.json().id}`,
        headers: users.admin.headers,
        payload: { reason: 'Test cleanup' },
      });
      expect(moderatorDelete.statusCode).toBe(200);
      const hidden = await app.inject({ method: 'GET', url: `/api/v1/community/discussions/${created.json().slug}` });
      expect(hidden.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
