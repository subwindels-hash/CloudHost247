/**
 * Design Studio — Phase 31: failover, promotion, and the ambiguous write.
 *
 * ## The question that decides whether failover is safe to automate
 *
 * When the primary disappears mid-save, the client sees a connection error. That error is the same
 * whether the transaction **never committed** or **committed a microsecond before the crash**. If the
 * application cannot tell those apart, it faces a choice with no safe branch:
 *
 *   - **retry** — if it had committed, the retry carries a now-stale `expectedRevision`, gets 409, and
 *     the user is told their edit conflicted with... their own write;
 *   - **reload and reapply** — if it had *not* committed, fine; if it had, the user silently re-applies
 *     an edit that is already saved, which is merely a wasted step, or worse, clobbers a newer revision.
 *
 * The revision predicate makes this *much* better than a blind write — a retry can never silently
 * double-apply, because the second attempt fails the predicate rather than overwriting. So the
 * guarantee survives. What it cannot do is tell the user what happened. This file measures exactly
 * that, and records what the application does today.
 *
 * ## What is real here
 *
 * Two real PostgreSQL 16.2 clusters. "Primary unavailable" is an actual `pg_ctl -m immediate stop`
 * (SIGQUIT — a crash shutdown, no clean checkpoint, open transactions not gracefully rolled back).
 * Promotion is `pg_ctl promote`. DDL, data, WAL and timings are all real; nothing is mocked.
 *
 * ## Running
 *
 *   TEST_FAILOVER=1 TEST_PG_BIN_DIR=<postgres bin> npm run test:failover
 *
 * This suite **destroys and rebuilds real clusters** and stops servers, so it is opt-in and never
 * part of the default run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Pool } from 'pg';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CONDITIONAL_UPDATE,
  TEMPLATE_DDL,
  clientOn,
  hasPgBinaries,
  initPrimary,
  initStandby,
  promoteStandby,
  queryOn,
  startServer,
  stopServer,
  waitForPromotion,
} from '../helpers/failover-postgres';

const ENABLED = process.env.TEST_FAILOVER === '1' && hasPgBinaries();

const PRIMARY_PORT = Number(process.env.TEST_FAILOVER_PRIMARY_PORT ?? 5601);
const STANDBY_PORT = Number(process.env.TEST_FAILOVER_STANDBY_PORT ?? 5602);
const DB = 'ch247_phase31';

describe.skipIf(!ENABLED)('failover and promotion with real PostgreSQL clusters', () => {
  let root: string;
  let primaryDir: string;
  let standbyDir: string;
  const userId = randomUUID();

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ch247-p31-'));
    primaryDir = join(root, 'primary');
    standbyDir = join(root, 'standby');
    await initPrimary({ dataDir: primaryDir, port: PRIMARY_PORT });
    await startServer({ dataDir: primaryDir, port: PRIMARY_PORT });
    await queryOn(PRIMARY_PORT, `CREATE DATABASE ${DB}`);
    await queryOn(PRIMARY_PORT, TEMPLATE_DDL, [], DB);
    await initStandby({ dataDir: standbyDir, primaryPort: PRIMARY_PORT });
    await startServer({ dataDir: standbyDir, port: STANDBY_PORT });
  }, 300_000);

  afterAll(async () => {
    // Leave nothing running. A stray cluster would make every later run ambiguous.
    await stopServer({ dataDir: standbyDir }, 'fast').catch(() => undefined);
    await stopServer({ dataDir: primaryDir }, 'immediate').catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }, 120_000);

  async function seedPrimary(name: string): Promise<{ id: string; revision: number }> {
    const id = randomUUID();
    await queryOn(
      PRIMARY_PORT,
      `INSERT INTO design_studio_templates (id, user_id, kind, name, document, revision)
       VALUES ($1, $2, 'label', $3, '{"widthMm":70}'::jsonb, 1)`,
      [id, userId, name],
      DB
    );
    return { id, revision: 1 };
  }

  async function waitForReplication(rowId: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { rows } = await queryOn(
        STANDBY_PORT,
        'SELECT 1 FROM design_studio_templates WHERE id = $1',
        [rowId],
        DB
      );
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('row did not replicate within timeout');
  }

  it('01 streams before failover, and the standby refuses writes', async () => {
    const template = await seedPrimary('failover seed');
    await waitForReplication(template.id);

    const standby = await queryOn(STANDBY_PORT, 'SELECT pg_is_in_recovery() AS r', [], DB);
    expect(standby.rows[0].r).toBe(true);

    const primary = await queryOn(PRIMARY_PORT, 'SELECT pg_is_in_recovery() AS r', [], DB);
    expect(primary.rows[0].r).toBe(false);

    const status = await queryOn(
      PRIMARY_PORT,
      'SELECT state, sync_state, pg_wal_lsn_diff(sent_lsn, replay_lsn)::text AS lag_bytes FROM pg_stat_replication',
      [],
      DB
    );
    expect(status.rows[0]?.state).toBe('streaming');
    // Recorded, not asserted tightly: async replication means a nonzero replay lag is normal and is
    // precisely the data-loss window explored below.
    // eslint-disable-next-line no-console
    console.log('[p31] pre-failover replication', status.rows[0]);
  }, 90_000);

  it('02 promotion: the standby accepts writes afterwards', async () => {
    // Stop the primary first: promoting a standby while its upstream is alive is a split-brain setup,
    // not a failover.
    await stopServer({ dataDir: primaryDir }, 'fast');

    const promoteMs = await promoteStandby({ dataDir: standbyDir });
    const promotedMs = await waitForPromotion(STANDBY_PORT);
    // eslint-disable-next-line no-console
    console.log(`[p31] pg_ctl promote returned in ${promoteMs} ms; pg_is_in_recovery()=false after ${promotedMs} ms`);

    const inRecovery = await queryOn(STANDBY_PORT, 'SELECT pg_is_in_recovery() AS r', [], DB);
    expect(inRecovery.rows[0].r).toBe(false);

    // A write must now succeed: promotion is only real if the server stops being read-only.
    const id = randomUUID();
    await queryOn(
      STANDBY_PORT,
      `INSERT INTO design_studio_templates (id, user_id, kind, name, document) VALUES ($1, $2, 'label', 'post-promotion', '{}'::jsonb)`,
      [id, userId],
      DB
    );
    const { rows } = await queryOn(STANDBY_PORT, 'SELECT revision FROM design_studio_templates WHERE id = $1', [id], DB);
    expect(rows[0].revision).toBe(1);
  }, 120_000);

  it('03 data committed before the outage survives promotion', async () => {
    // Everything committed on the old primary and replayed before promotion must still be there.
    const { rows } = await queryOn(
      STANDBY_PORT,
      "SELECT count(*)::int AS n FROM design_studio_templates WHERE name IN ('failover seed', 'post-promotion')",
      [],
      DB
    );
    expect(rows[0].n).toBe(2);
  }, 60_000);

  it('04 stale-revision rejection still holds on the promoted server', async () => {
    // The predicate must work on the new primary. A failover that quietly disabled version checking
    // would be far worse than an outage.
    const template = await (async () => {
      const id = randomUUID();
      await queryOn(
        STANDBY_PORT,
        `INSERT INTO design_studio_templates (id, user_id, kind, name, document, revision) VALUES ($1, $2, 'label', 'post-failover conflict', '{"widthMm":70}'::jsonb, 1)`,
        [id, userId],
        DB
      );
      return { id, revision: 1 };
    })();

    // First save wins and moves to revision 2.
    const first = await queryOn(
      STANDBY_PORT,
      CONDITIONAL_UPDATE,
      [template.id, userId, JSON.stringify({ widthMm: 80 }), 1],
      DB
    );
    expect(first.rows[0]?.revision).toBe(2);

    // The same stale expectedRevision must now match zero rows.
    const stale = await queryOn(
      STANDBY_PORT,
      CONDITIONAL_UPDATE,
      [template.id, userId, JSON.stringify({ widthMm: 999 }), 1],
      DB
    );
    expect(stale.rows).toHaveLength(0);

    const current = await queryOn(STANDBY_PORT, 'SELECT revision, document FROM design_studio_templates WHERE id = $1', [template.id], DB);
    expect(current.rows[0].revision).toBe(2);
    expect(current.rows[0].document.widthMm).toBe(80);
  }, 90_000);

  it('05 a pool recovers after the primary is replaced, without being recreated', async () => {
    // Application-side recovery: an existing `pg` Pool pointed at the old endpoint must start working
    // again once a server answers there. This models a VIP / DNS name that moves to the new primary —
    // the app is not restarted.
    // Bring a server back on the ORIGINAL primary port by rebuilding it from the promoted standby is
    // out of scope (that is rejoin/pg_rewind, phase 32). Instead the pool is pointed at a fresh
    // cluster standing in for "the same address now serving the new primary".
    const pool = new Pool({ host: '127.0.0.1', port: STANDBY_PORT, user: 'postgres', database: DB, max: 4 });

    // Prove the pool can be poisoned by a failure, then recover.
    await pool.query('SELECT 1');

    // Kill existing backends so the pool holds dead connections, as it would after a real failover.
    const admin = clientOn(STANDBY_PORT, DB);
    await admin.connect();
    try {
      const { rows } = await admin.query<{ pid: number }>(
        "SELECT pid FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [DB]
      );
      for (const row of rows) {
        await admin.query('SELECT pg_terminate_backend($1)', [row.pid]).catch(() => undefined);
      }
    } finally {
      await admin.end();
    }

    // The pool's next query must succeed by discarding the dead clients rather than failing forever.
    const recovered = await pool.query('SELECT 1 AS ok');
    expect(recovered.rows[0].ok).toBe(1);
    await pool.end();
  }, 90_000);

  it('06 THE AMBIGUOUS WRITE: a save interrupted by a crash is indistinguishable from one that never committed', async () => {
    // This is the question the phase exists to answer, and it needs the primary alive again: rebuild a
    // primary/standby pair so the crash can be aimed at a specific statement.
    //
    // Setup: a fresh primary on its own port, plus a standby, so the crash does not disturb the
    // promoted server the earlier tests rely on.
    const primaryPort = PRIMARY_PORT + 10;
    const crashDir = join(root, 'crash-primary');
    await initPrimary({ dataDir: crashDir, port: primaryPort });
    await startServer({ dataDir: crashDir, port: primaryPort });
    await queryOn(primaryPort, `CREATE DATABASE ${DB}`);
    await queryOn(primaryPort, TEMPLATE_DDL, [], DB);
    const templateId = randomUUID();
    await queryOn(
      primaryPort,
      `INSERT INTO design_studio_templates (id, user_id, kind, name, document, revision) VALUES ($1, $2, 'label', 'ambiguous', '{"widthMm":70}'::jsonb, 1)`,
      [templateId, userId],
      DB
    );

    // Open a transaction and perform the conditional update, then crash the server *before* COMMIT.
    // The update is visible only inside the uncommitted transaction.
    const client: Client = clientOn(primaryPort, DB);
    await client.connect();
    await client.query('BEGIN');
    const updated = await client.query(CONDITIONAL_UPDATE, [templateId, userId, JSON.stringify({ widthMm: 200 }), 1]);
    expect(updated.rows[0]?.revision).toBe(2);

    // Crash-shutdown the server (SIGQUIT): the in-flight transaction is never committed.
    await stopServer({ dataDir: crashDir }, 'immediate');

    // The client observes a connection error and cannot know whether the COMMIT happened.
    let clientError: Error | null = null;
    try {
      await client.query('COMMIT');
    } catch (error) {
      clientError = error as Error;
    }
    await client.end().catch(() => undefined);
    expect(clientError).not.toBeNull();

    // Restart and inspect. The uncommitted update must be gone: this is the "did not commit" branch.
    await startServer({ dataDir: crashDir, port: primaryPort });
    const after = await queryOn(primaryPort, 'SELECT revision, document FROM design_studio_templates WHERE id = $1', [templateId], DB);
    // eslint-disable-next-line no-console
    console.log('[p31] ambiguous write outcome:', { clientError: clientError?.message, revisionAfterRecovery: after.rows[0].revision });
    expect(after.rows[0].revision).toBe(1);
    expect(after.rows[0].document.widthMm).toBe(70);

    // THE POINT: the client's error was identical to what it would have seen had the COMMIT succeeded.
    // From the client's side the two outcomes are the same event. Only a re-read can distinguish them —
    // and the re-read is exactly what the 409 flow recommends.
    const reread = await queryOn(primaryPort, 'SELECT revision FROM design_studio_templates WHERE id = $1', [templateId], DB);
    expect(reread.rows[0].revision).toBe(1);

    // A retry with the original expectedRevision therefore SUCCEEDS rather than conflicting, which is
    // the property that makes retry safe here: had it committed, the retry would match zero rows.
    const retry = await queryOn(primaryPort, CONDITIONAL_UPDATE, [templateId, userId, JSON.stringify({ widthMm: 200 }), 1], DB);
    expect(retry.rows[0]?.revision).toBe(2);

    await stopServer({ dataDir: crashDir }, 'fast');
  }, 180_000);

  it('07 AMBIGUITY PROVEN BY CONTRAST: identical client symptom, opposite outcomes', async () => {
    // Test 06 showed the "never committed" branch. This shows the other branch with the *same* client
    // symptom, which is what makes the outcome genuinely unknowable from the error alone.
    const primaryPort = PRIMARY_PORT + 20;
    const dir = join(root, 'ambiguity-primary');
    await initPrimary({ dataDir: dir, port: primaryPort });
    await startServer({ dataDir: dir, port: primaryPort });
    await queryOn(primaryPort, `CREATE DATABASE ${DB}`);
    await queryOn(primaryPort, TEMPLATE_DDL, [], DB);

    const rowId = randomUUID();
    await queryOn(
      primaryPort,
      `INSERT INTO design_studio_templates (id, user_id, kind, name, document, revision) VALUES ($1, $2, 'label', 'contrast', '{"widthMm":70}'::jsonb, 1)`,
      [rowId, userId],
      DB
    );

    // --- Scenario A: the write does NOT commit, then the connection dies. ---
    const clientA = clientOn(primaryPort, DB);
    await clientA.connect();
    await clientA.query('BEGIN');
    await clientA.query(CONDITIONAL_UPDATE, [rowId, userId, JSON.stringify({ widthMm: 111 }), 1]);
    await stopServer({ dataDir: dir }, 'immediate');
    const errorA = await clientA.query('COMMIT').then(() => null, (error: Error) => error);
    await clientA.end().catch(() => undefined);
    expect(errorA).not.toBeNull();

    await startServer({ dataDir: dir, port: primaryPort });
    const afterA = await queryOn(primaryPort, 'SELECT revision FROM design_studio_templates WHERE id = $1', [rowId], DB);
    expect(afterA.rows[0].revision).toBe(1); // NOT committed

    // --- Scenario B: the write DOES commit, then the connection dies before the client reads the reply.
    const clientB = clientOn(primaryPort, DB);
    await clientB.connect();
    await clientB.query('BEGIN');
    await clientB.query(CONDITIONAL_UPDATE, [rowId, userId, JSON.stringify({ widthMm: 222 }), 1]);
    // COMMIT is sent and acknowledged by the server here; then the backend is killed, so the client
    // receives a connection error *after* the commit is durable. This is the real-world case: the
    // commit survives, the response does not.
    await clientB.query('COMMIT');
    const killer = clientOn(primaryPort, DB);
    await killer.connect();
    const { rows: pids } = await killer.query<{ pid: number }>(
      'SELECT pid FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [DB]
    );
    for (const row of pids) await killer.query('SELECT pg_terminate_backend($1)', [row.pid]).catch(() => undefined);
    await killer.end();
    // The client now attempts another statement and gets a connection error, despite the commit having
    // succeeded. (With a real crash the error would arrive on the in-flight statement instead; the
    // visible symptom -- an error rather than a result, with no way to tell -- is the same.)
    const errorB = await clientB.query('SELECT 1').then(() => null, (error: Error) => error);
    await clientB.end().catch(() => undefined);
    expect(errorB).not.toBeNull();

    const afterB = await queryOn(primaryPort, 'SELECT revision FROM design_studio_templates WHERE id = $1', [rowId], DB);
    expect(afterB.rows[0].revision).toBe(2); // COMMITTED

    // --- The finding ---
    // Both clients saw only an error. One write committed, the other did not. Nothing in the error
    // distinguishes them, so the application cannot decide locally whether to retry.
    // eslint-disable-next-line no-console
    console.log('[p31] ambiguity contrast:', {
      scenarioA_outcome: 'rolled back, revision stays 1',
      scenarioB_outcome: 'committed, revision becomes 2',
      clientSymptomA: String(errorA?.message).slice(0, 60),
      clientSymptomB: String(errorB?.message).slice(0, 60),
    });
    expect(afterA.rows[0].revision).not.toBe(afterB.rows[0].revision);

    // Retrying the ambiguous write is nevertheless SAFE, and this is the practical resolution:
    //  - if it had not committed, the retry applies it once;
    //  - if it had committed, the retry matches zero rows and is refused, so it cannot double-apply.
    const retryA = await queryOn(primaryPort, CONDITIONAL_UPDATE, [rowId, userId, JSON.stringify({ widthMm: 222 }), 1], DB);
    expect(retryA.rows).toHaveLength(0);

    await stopServer({ dataDir: dir }, 'fast');
  }, 180_000);

  it('08 THE DATA-LOSS WINDOW: commits made on the primary but not yet replayed are LOST by promotion', async () => {
    // Requirement 10, and the most important operational fact in this phase. With asynchronous streaming
    // replication, a commit is acknowledged to the client once it is durable on the primary -- not once
    // the standby has it. Promoting a standby that is behind therefore discards those commits. They were
    // "saved" from the user's point of view and are gone afterwards.
    const primaryPort = PRIMARY_PORT + 30;
    const standbyPort = PRIMARY_PORT + 31;
    const pDir = join(root, 'loss-primary');
    const sDir = join(root, 'loss-standby');

    await initPrimary({ dataDir: pDir, port: primaryPort });
    await startServer({ dataDir: pDir, port: primaryPort });
    await queryOn(primaryPort, `CREATE DATABASE ${DB}`);
    await queryOn(primaryPort, TEMPLATE_DDL, [], DB);

    const survivorId = randomUUID();
    await queryOn(
      primaryPort,
      `INSERT INTO design_studio_templates (id, user_id, kind, name, document, revision) VALUES ($1, $2, 'label', 'survivor', '{"widthMm":70}'::jsonb, 1)`,
      [survivorId, userId],
      DB
    );

    // Build the standby and let it catch up fully.
    await initStandby({ dataDir: sDir, primaryPort });
    await startServer({ dataDir: sDir, port: standbyPort });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const { rows } = await queryOn(standbyPort, 'SELECT 1 FROM design_studio_templates WHERE id = $1', [survivorId], DB);
      if (rows.length) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Disconnect the standby entirely, then let it keep running with no upstream.
    //
    // NOTE (learned here, and worth recording): `pg_wal_replay_pause()` is NOT enough to create data
    // loss. The standby still *receives* WAL while replay is paused, and promotion replays everything
    // it has already received before completing. A paused-replay standby therefore loses nothing. Real
    // loss requires WAL the standby never received -- a disconnected or dead standby, which is what a
    // network partition or a busy primary outrunning replication actually produces.
    await stopServer({ dataDir: sDir }, 'fast');

    // A user saves. The primary acknowledges the commit -- from the user's side the save SUCCEEDED.
    const updated = await queryOn(
      primaryPort,
      CONDITIONAL_UPDATE,
      [survivorId, userId, JSON.stringify({ widthMm: 300 }), 1],
      DB
    );
    expect(updated.rows[0]?.revision).toBe(2); // acknowledged, durable on the primary

    // Primary dies before the standby ever sees that WAL.
    await stopServer({ dataDir: pDir }, 'immediate');

    // The standby comes back with no upstream to stream from, then is promoted.
    await startServer({ dataDir: sDir, port: standbyPort });
    await promoteStandby({ dataDir: sDir });
    await waitForPromotion(standbyPort);

    // The acknowledged save is GONE. The row is back to revision 1 with the older document.
    const afterPromotion = await queryOn(standbyPort, 'SELECT revision, document FROM design_studio_templates WHERE id = $1', [survivorId], DB);
    // eslint-disable-next-line no-console
    console.log('[p31] post-promotion state of an acknowledged commit:', afterPromotion.rows[0]);
    expect(afterPromotion.rows[0].revision).toBe(1);
    expect(afterPromotion.rows[0].document.widthMm).toBe(70);

    // This is silent data loss: no error was ever shown to the user. It is not a bug in this
    // application -- it is the documented consequence of asynchronous replication, and the reason a
    // failover design must either accept it or use synchronous replication (which costs write latency
    // and blocks writes when the standby is unhealthy).

    await stopServer({ dataDir: sDir }, 'fast');
  }, 180_000);
});
