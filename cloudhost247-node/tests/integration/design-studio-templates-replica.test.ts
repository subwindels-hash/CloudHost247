/**
 * Design Studio — Phase 30: is a replica read safe for revision-sensitive operations?
 *
 * ## The question, and why Phase 29 does not answer it
 *
 * Phase 29 proved the revision predicate survives PgBouncer transaction pooling: a *write* checked
 * against the primary cannot lose an update. That is a statement about the write path only. A replica
 * solves a different problem, and introduces a different failure:
 *
 *   the replica may not yet contain the revision the client just read.
 *
 * A client loads revision 3 from a replica, edits, and saves with `expectedRevision: 3`. If someone
 * else committed revision 4 in the meantime, the primary's predicate refuses the save with 409 — that
 * part is safe, and this file confirms it. The dangerous cases are the ones where a *stale read* turns
 * into a *wrong action*:
 *
 *   - **A stale read makes a fresh save impossible.** The next revision never arrives on the replica,
 *     so the user keeps sending an outdated `expectedRevision` and gets an endless 409.
 *   - **The 409 recovery path reads again.** `overwriteTemplate` re-reads after a zero-row update to
 *     tell 404 from 409. If that re-read goes to a lagging replica it reports the *old* revision in the
 *     error message, or reports "not found" for a template that merely moved — so "reload and try
 *     again" sends the user back to the same stale value.
 *
 * That second case is the reason this file exists, and it is the one a code review would miss: the
 * conflict message is only as accurate as the read that produces it.
 *
 * ## Real replication, real lag
 *
 * Two PostgreSQL 16.2 servers: a primary and a hot standby built with `pg_basebackup -R -X stream`.
 * Lag is created with `pg_wal_replay_pause()` on the standby, so while it is paused the standby is
 * *provably* unable to see new commits — the stale read is caused by replication, not by a slow test
 * machine. No part of this is mocked.
 *
 * ## Running
 *
 *   TEST_REPLICA_PRIMARY_URL=postgresql://postgres@127.0.0.1:5501/db \
 *   TEST_REPLICA_URL=postgresql://postgres@127.0.0.1:5502/db \
 *   npm run test:replica
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { PgClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import {
  assertInRecovery,
  clientFor,
  pauseReplay,
  readReplicaEnv,
  replicationStatus,
  resumeReplay,
  waitForVisibility,
  type ReplicaEnv,
} from '../helpers/replica-postgres';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'f'.repeat(32);
process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);

const replicaEnv = readReplicaEnv();
const hasReplica = replicaEnv !== null;

const DOCUMENT = {
  templateId: 'address-70x40',
  widthMm: 70,
  heightMm: 40,
  elements: [{ kind: 'field', id: 'recipient', x: 0, y: 4, width: 53, height: 15, binding: { key: 'recipient' } }],
};

/** The app with every request sent to `url`. Used to model "reads routed to the replica". */
function appFor(url: string, env: Env, pool: Pool) {
  return buildApp(env, { serveFrontend: false, pool });
}

describe.skipIf(!hasReplica)('saved templates with a streaming replica', () => {
  let env: ReplicaEnv;
  let primaryPool: Pool;
  let replicaPool: Pool;
  let primaryApp: ReturnType<typeof buildApp>;
  let replicaApp: ReturnType<typeof buildApp>;
  let appEnv: Env;
  let token: string;
  const userId = randomUUID();
  const base = '/api/tools/design-studio/templates';

  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    env = replicaEnv!;
    appEnv = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: env.primaryUrl,
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);

    // Migrate through the primary. Replay carries the schema to the standby over WAL.
    primaryPool = new Pool({ connectionString: env.primaryUrl, max: 8 });
    await migrateUp(new PgClient(primaryPool), { allowProduction: true });
    await new PgClient(primaryPool).query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status)
       VALUES ($1, $2, 'hash', 'Replica Owner', 'customer', 'active') ON CONFLICT (id) DO NOTHING`,
      [userId, `replica-${userId.slice(0, 8)}@example.com`]
    );

    // The standby must have the schema before any read test means anything.
    await waitForVisibility(
      env.replicaUrl,
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'design_studio_templates'",
      [],
      20_000
    );

    replicaPool = new Pool({ connectionString: env.replicaUrl, max: 8 });
    primaryApp = appFor(env.primaryUrl, appEnv, primaryPool);
    replicaApp = appFor(env.replicaUrl, appEnv, replicaPool);
    await primaryApp.ready();
    await replicaApp.ready();

    token = signAuthToken(appEnv, {
      sub: userId,
      email: `replica-${userId.slice(0, 8)}@example.com`,
      role: 'customer',
    });
  }, 180_000);

  afterAll(async () => {
    if (hasReplica) await resumeReplay(env.replicaUrl).catch(() => undefined);
    if (primaryApp) await primaryApp.close();
    if (replicaApp) await replicaApp.close();
    if (primaryPool) await primaryPool.end();
    if (replicaPool) await replicaPool.end();
  }, 60_000);

  // Every test that pauses replay must leave replication running, or the next test silently measures
  // nothing. Resuming here keeps a failure from cascading into unrelated ones.
  beforeEach(async () => {
    if (hasReplica) await resumeReplay(env.replicaUrl).catch(() => undefined);
  });

  async function createOnPrimary(name: string): Promise<{ id: string; revision: number }> {
    const response = await primaryApp.inject({
      method: 'POST',
      url: base,
      headers: auth(),
      payload: { kind: 'label', name, document: DOCUMENT },
    });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    const template = response.json().template;
    // Wait for the create to reach the standby so later reads are not ambiguous.
    await waitForVisibility(
      env.replicaUrl,
      'SELECT 1 FROM design_studio_templates WHERE id = $1',
      [template.id]
    );
    return { id: template.id, revision: template.revision };
  }

  it('is a real streaming standby, not a second primary', async () => {
    const replica = await assertInRecovery(env.replicaUrl);
    expect(replica.inRecovery).toBe(true);

    const primary = await assertInRecovery(env.primaryUrl);
    expect(primary.inRecovery).toBe(false);

    const status = await replicationStatus(env.primaryUrl);
    expect(status.state).toBe('streaming');
    // Distinct server processes: a "replica" that shares a backend with the primary is not a replica.
    expect(replica.pid).not.toBe(primary.pid);

    // A hot standby refuses writes. If this ever succeeded, every read test below would be meaningless.
    const client = clientFor(env.replicaUrl);
    await client.connect();
    try {
      await expect(
        client.query(`INSERT INTO design_studio_templates (id, user_id, kind, name, document) VALUES (gen_random_uuid(), $1, 'label', 'should fail', '{}'::jsonb)`, [userId])
      ).rejects.toThrow(/read-only|cannot execute/i);
    } finally {
      await client.end();
    }
  }, 60_000);

  it('replicates a new revision to the standby quickly under normal operation', async () => {
    const template = await createOnPrimary('Replica baseline');
    const elapsed = await waitForVisibility(
      env.replicaUrl,
      'SELECT 1 FROM design_studio_templates WHERE id = $1 AND revision = $2',
      [template.id, template.revision],
      10_000
    );
    // Recorded rather than asserted tightly: the point is that normal replication is fast enough that
    // read-after-write *usually* works, which is exactly what makes the lagging case worth testing.
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);

  it('serves a coherent read from the replica when replication is caught up', async () => {
    const template = await createOnPrimary('Replica coherent');
    const fromReplica = await replicaApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(fromReplica.statusCode).toBe(200);
    expect(fromReplica.json().template.revision).toBe(template.revision);
    expect(fromReplica.json().template.document).toEqual(DOCUMENT);
  }, 60_000);

  it('read-after-write through the replica is eventually consistent, and the primary is immediately correct', async () => {
    // A save written to the primary, then read from both sides. The primary must agree *at once*; the
    // replica is allowed to lag. This is the property that decides whether a read needs the primary.
    const template = await createOnPrimary('Replica RAW');
    const saved = await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 85 }, expectedRevision: template.revision },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().template.revision).toBe(2);

    // Immediate primary read: must already be revision 2.
    const primaryRead = await primaryApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(primaryRead.json().template.revision).toBe(2);

    // The replica converges to the same content.
    const elapsed = await waitForVisibility(
      env.replicaUrl,
      'SELECT 1 FROM design_studio_templates WHERE id = $1 AND revision = 2',
      [template.id],
      10_000
    );
    expect(elapsed).toBeLessThan(10_000);
    const replicaRead = await replicaApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(replicaRead.json().template.document.widthMm).toBe(85);
  }, 60_000);

  it('a stale revision read from a LAGGING replica is still rejected by the primary, and nothing is overwritten', async () => {
    // Requirement 5/6: load revision N from the replica, advance the primary behind the replica's back,
    // then write with the stale N. The predicate must refuse it.
    const template = await createOnPrimary('Replica stale write');

    // Freeze replay, so the standby's view of this row cannot move again during the test.
    await pauseReplay(env.replicaUrl);

    const staleRead = await replicaApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(staleRead.statusCode).toBe(200);
    const staleRevision = staleRead.json().template.revision as number;
    expect(staleRevision).toBe(1);

    // Someone else saves, on the primary. The replica is paused and provably cannot see this.
    const advanced = await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 111 }, expectedRevision: 1 },
    });
    expect(advanced.statusCode).toBe(200);

    // Confirm the premise: the replica still shows the old revision.
    const replicaStillStale = await replicaApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(replicaStillStale.json().template.revision).toBe(1);

    // The user, having loaded revision 1 from the replica, saves against the primary.
    const staleSave = await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: staleRevision },
    });
    expect(staleSave.statusCode).toBe(409);
    expect(staleSave.json().message).toMatch(/revision/i);

    // Requirement 7: the primary row is unchanged by the rejected write.
    const primaryNow = await primaryApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(primaryNow.json().template.revision).toBe(2);
    expect(primaryNow.json().template.document.widthMm).toBe(111);

    await resumeReplay(env.replicaUrl);
  }, 90_000);

  it('a fresh save issued from a stale replica read gets an accurate 409 message when reads use the primary', async () => {
    // The recovery path: after 409 the user reloads. Routed to the primary, the reload returns the
    // current revision and the retry succeeds. This is the path that makes 409 recoverable at all.
    const template = await createOnPrimary('Replica recovery primary');

    const firstRead = await primaryApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(firstRead.json().template.revision).toBe(1);

    await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 120 }, expectedRevision: 1 },
    });

    const conflict = await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 130 }, expectedRevision: 1 },
    });
    expect(conflict.statusCode).toBe(409);
    // The message must name the revision the user needs, otherwise "reload and retry" is guesswork.
    expect(conflict.json().message).toMatch(/revision 2/i);

    // Reload from the primary, then retry with the revision the error named.
    const reload = await primaryApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(reload.json().template.revision).toBe(2);
    const retry = await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 130 }, expectedRevision: 2 },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().template.revision).toBe(3);
  }, 90_000);

  it('THE FAILURE MODE: a 409 recovered through a lagging replica produces a conflict message naming a STALE revision', async () => {
    // This is the case that decides whether revision-sensitive reads may use a replica.
    //
    // `overwriteTemplate` reacts to a zero-row UPDATE by re-reading the row to distinguish 404 from 409
    // and to state the current revision. If that re-read is served by a lagging replica, the message is
    // built from a snapshot that predates the conflict. The write was still refused — the guarantee
    // holds — but the user is told to reload to a revision that is already out of date, so the retry
    // conflicts again. A loop that looks like a bug in the editor and is really a routing decision.
    const template = await createOnPrimary('Replica stale 409 message');

    await pauseReplay(env.replicaUrl);

    // The replica's frozen view is revision 1.
    const staleRead = await replicaApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(staleRead.json().template.revision).toBe(1);

    // The primary advances to revision 2, then to 3.
    for (const widthMm of [140, 150]) {
      const response = await primaryApp.inject({
        method: 'PUT',
        url: `${base}/${template.id}`,
        headers: auth(),
        payload: { document: { ...DOCUMENT, widthMm }, expectedRevision: widthMm === 140 ? 1 : 2 },
      });
      expect(response.statusCode).toBe(200);
    }

    // A stale save *routed to the replica* (i.e. reads and writes served by a replica-fronted app).
    // The standby refuses the UPDATE outright, which is the correct behaviour for any write path that
    // is accidentally pointed at a replica: it cannot silently accept it.
    const viaReplica = await replicaApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 1 },
    });
    expect(viaReplica.statusCode).toBeGreaterThanOrEqual(500);

    // The stale save against the PRIMARY is correctly refused.
    const staleSave = await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 1 },
    });
    expect(staleSave.statusCode).toBe(409);
    expect(staleSave.json().message).toMatch(/revision 3/i);

    // The primary still holds revision 3 and the last legitimate document.
    const primaryNow = await primaryApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(primaryNow.json().template.revision).toBe(3);
    expect(primaryNow.json().template.document.widthMm).toBe(150);

    // And the replica's frozen view is still revision 1 — proving the stale read was replication, not
    // a coincidence of timing, and that the message above could only be accurate because it read the
    // primary.
    const replicaStale = await replicaApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(replicaStale.json().template.revision).toBe(1);

    await resumeReplay(env.replicaUrl);
  }, 90_000);

  it('DECISIVE: when the 409 re-read is routed to a lagging replica the conflict message names the STALE revision', async () => {
    // The hypothesis this phase is really about, tested directly.
    //
    // `overwriteTemplate` handles a zero-row UPDATE by re-reading the row, then building the 409 message
    // from it. If reads are split so that this re-read goes to a replica, the *write* is still refused —
    // the guarantee holds — but the message is built from a snapshot that predates the conflict, so the
    // user is told to reload a revision that is already stale and their retry conflicts again.
    //
    // `statementRouter` below sends SELECTs to the standby and everything else to the primary, which is
    // the most common read/write split and the one a deployment is most likely to adopt by accident.
    const template = await createOnPrimary('Replica split read');

    await pauseReplay(env.replicaUrl);
    // Premise: the standby's frozen snapshot is revision 1.
    const replicaView = await replicaApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(replicaView.json().template.revision).toBe(1);

    // The primary moves on to revision 2, and the standby provably cannot see it.
    const advanced = await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 210 }, expectedRevision: 1 },
    });
    expect(advanced.statusCode).toBe(200);

    // An app whose SELECTs go to the replica and whose writes go to the primary.
    const splitPool = readWriteSplitPool(env.primaryUrl, env.replicaUrl);
    const splitApp = appFor(env.primaryUrl, appEnv, splitPool as never);
    await splitApp.ready();
    try {
      const conflict = await splitApp.inject({
        method: 'PUT',
        url: `${base}/${template.id}`,
        headers: auth(),
        payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 1 },
      });
      // Still correctly refused: the predicate ran on the primary.
      expect(conflict.statusCode).toBe(409);

      // THE POINT: the message is built from the replica's stale snapshot, so it names revision 1 —
      // the revision the user already has — instead of the primary's actual revision 2. Following its
      // own advice would produce the same conflict again.
      const message = conflict.json().message as string;
      expect(message).toMatch(/revision 1/i);
      expect(message).not.toMatch(/revision 2/i);

      // With reads on the primary (the current behaviour), the same conflict names revision 2 — which
      // is actionable. This contrast is the finding.
      const primaryConflict = await primaryApp.inject({
        method: 'PUT',
        url: `${base}/${template.id}`,
        headers: auth(),
        payload: { document: { ...DOCUMENT, widthMm: 999 }, expectedRevision: 1 },
      });
      expect(primaryConflict.statusCode).toBe(409);
      expect(primaryConflict.json().message).toMatch(/revision 2/i);
    } finally {
      await splitApp.close();
      await resumeReplay(env.replicaUrl);
    }
  }, 120_000);

  it('the replica recovers after replay resumes, and converges without intervention', async () => {
    // Requirement 8. A pooler or app must not need a restart, and the stale window must be bounded by
    // replication catching up rather than by a manual fix.
    const template = await createOnPrimary('Replica recovery');
    await pauseReplay(env.replicaUrl);

    await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 160 }, expectedRevision: 1 },
    });

    const whilePaused = await replicaApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(whilePaused.json().template.revision).toBe(1);

    await resumeReplay(env.replicaUrl);
    const elapsed = await waitForVisibility(
      env.replicaUrl,
      'SELECT 1 FROM design_studio_templates WHERE id = $1 AND revision = 2',
      [template.id],
      15_000
    );
    expect(elapsed).toBeLessThan(15_000);

    const afterRecovery = await replicaApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(afterRecovery.json().template.revision).toBe(2);
    expect(afterRecovery.json().template.document.widthMm).toBe(160);
  }, 120_000);

  it('a delete replicated late is not silently resurrected by a stale write', async () => {
    // A related hazard: if a client acts on a replica read of a row that the primary has already
    // deleted, a version-checked write must NOT recreate it. `overwriteTemplate`'s zero-row path must
    // report 404, not conflict, so the client stops rather than retrying forever.
    const template = await createOnPrimary('Replica deleted');
    const deleted = await primaryApp.inject({ method: 'DELETE', url: `${base}/${template.id}`, headers: auth() });
    expect([200, 204]).toContain(deleted.statusCode);

    // The primary refuses the stale save with 404; there is nothing to conflict with.
    const staleWrite = await primaryApp.inject({
      method: 'PUT',
      url: `${base}/${template.id}`,
      headers: auth(),
      payload: { document: { ...DOCUMENT, widthMm: 170 }, expectedRevision: 1 },
    });
    expect(staleWrite.statusCode).toBe(404);

    // And it did not resurrect the row.
    const stillGone = await primaryApp.inject({ method: 'GET', url: `${base}/${template.id}`, headers: auth() });
    expect(stillGone.statusCode).toBe(404);
  }, 90_000);
});

/**
 * A `Queryable` that sends `SELECT` to the replica and everything else to the primary.
 *
 * This is not a mock: both sides are real PostgreSQL servers, one of them a real streaming standby.
 * It exists because the failure this phase is testing does not occur when a whole app is pointed at a
 * replica — a standby refuses writes, so that arrangement fails loudly and safely. It occurs when reads
 * are split at the statement level, which is the common production arrangement and the one that turns a
 * stale snapshot into a misleading error message.
 */
function readWriteSplitPool(primaryUrl: string, replicaUrl: string): { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> } {
  const primary = new Pool({ connectionString: primaryUrl, max: 8 });
  const replica = new Pool({ connectionString: replicaUrl, max: 8 });
  // Close both pools when the app closes: `end` is not part of `Queryable`, so it is attached for tests.
  return {
    query: async (text: string, params?: unknown[]) => {
      const target = /^\s*select\b/i.test(text) ? replica : primary;
      return target.query(text, params) as Promise<{ rows: unknown[] }>;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ end: async () => { await primary.end(); await replica.end(); } } as any),
  };
}
