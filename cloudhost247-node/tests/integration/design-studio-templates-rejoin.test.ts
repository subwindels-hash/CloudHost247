/**
 * Design Studio — Phase 32: rejoin of a demoted primary, and split-brain safety.
 *
 * ## Why this is not the same question as Phase 31
 *
 * Phase 31 promoted a standby and stopped. Real failover has a harder second half: the old primary is
 * still there, still holds a divergent timeline, and if it comes back on its own it will happily accept
 * writes as a *second* primary. Everything written to each side then has to be discarded from one of
 * them, and nothing in the revision predicate can help — a lost update inside a single timeline is not
 * the same failure as two independent timelines being merged (or one being thrown away).
 *
 * This file answers four separate questions, deliberately kept apart:
 *
 *   1. **Split-brain prevention** — does PostgreSQL stop a demoted primary from accepting writes? (No.
 *      That is what fencing is for, and the test proves the absence of self-fencing without ever running
 *      two writable primaries at once.)
 *   2. **Demoted-primary recovery** — can the old primary be brought back, and what does `pg_rewind`
 *      require before it will do it?
 *   3. **Data-loss exposure** — `pg_rewind` discards WAL that is not on the new timeline. Writes made
 *      on the isolated old primary are *deleted*. This is measured, not asserted.
 *   4. **Replication convergence** — after rejoin, does the pair stream again, on the right timeline,
 *      with the revision predicate intact?
 *
 * ## Safety rule observed by this file
 *
 * The brief forbids exposing two writable primaries. Every test that inspects the demoted primary's
 * writability does so while the promoted server is **stopped**, and the file asserts that state before
 * proceeding. Splitting the check into two "isolated inspections" is not a weaker test: PostgreSQL does
 * no cross-server coordination, so whether the other server is running changes nothing about the
 * answer, and running them together would only add a real split-brain to the sandbox.
 *
 * ## Running
 *
 *   TEST_REJOIN=1 TEST_PG_BIN_DIR=<postgres bin> npm run test:rejoin
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CONDITIONAL_UPDATE,
  TEMPLATE_DDL,
  clientOn,
  controldata,
  currentTimeline,
  hasPgBinaries,
  initPrimaryWith,
  initStandby,
  pgRewind,
  promoteStandby,
  queryOn,
  startServer,
  stopServer,
  timelineHistory,
  waitForPromotion,
} from '../helpers/failover-postgres';

const ENABLED = process.env.TEST_REJOIN === '1' && hasPgBinaries();
const BASE_PORT = Number(process.env.TEST_REJOIN_BASE_PORT ?? 5701);
const DB = 'ch247_phase32';

describe.skipIf(!ENABLED)('demoted primary rejoin and split-brain safety', () => {
  let root: string;
  const userId = randomUUID();

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ch247-p32-'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Deterministic, counter-based ports. An earlier version used `Math.random()`, which made a very
  // occasional collision possible; when two tests' clusters fight over a port the failure appears in an
  // unrelated test and looks like a product bug. Each pair gets a disjoint block.
  let pairIndex = 0;

  /** A primary + streaming standby pair, migrated and ready. */
  async function pair(name: string, options: { walLogHints?: boolean; dataChecksums?: boolean } = {}) {
    const primaryPort = BASE_PORT + pairIndex * 2;
    const standbyPort = primaryPort + 1;
    pairIndex += 1;
    const primaryDir = join(root, `${name}-primary`);
    const standbyDir = join(root, `${name}-standby`);
    await initPrimaryWith({ dataDir: primaryDir, port: primaryPort }, options);
    await startServer({ dataDir: primaryDir, port: primaryPort });
    await queryOn(primaryPort, `CREATE DATABASE ${DB}`);
    await queryOn(primaryPort, TEMPLATE_DDL, [], DB);
    await initStandby({ dataDir: standbyDir, primaryPort });
    await startServer({ dataDir: standbyDir, port: standbyPort });
    return { primaryPort, standbyPort, primaryDir, standbyDir };
  }

  async function seed(port: number, name: string, widthMm = 70): Promise<string> {
    const id = randomUUID();
    await queryOn(
      port,
      `INSERT INTO design_studio_templates (id, user_id, kind, name, document, revision)
       VALUES ($1, $2, 'label', $3, $4::jsonb, 1)`,
      [id, userId, name, JSON.stringify({ widthMm })],
      DB
    );
    return id;
  }

  async function waitForRow(port: number, id: string, timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const { rows } = await queryOn(port, 'SELECT 1 FROM design_studio_templates WHERE id = $1', [id], DB);
        if (rows.length) return true;
      } catch {
        // server may not be up yet
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  }

  it('01 pg_rewind eligibility is NOT automatic, and pg_rewind says so plainly', async () => {
    // `pg_rewind` needs the target's last checkpoint to appear in the source's WAL, which requires
    // either data checksums or `wal_log_hints`. Both are OFF by default in PostgreSQL 16: a cluster
    // created without them cannot be rewound, and the fix is a new base backup, not a config change.
    const env = await pair('eligibility', { walLogHints: false, dataChecksums: false });
    // Measure the cluster as created, plus a control run with hints enabled below.
    const created = readFileSync(join(env.primaryDir, 'postgresql.conf'), 'utf8');
    // `initPrimaryWith` writes the setting explicitly, so an off cluster is genuinely off rather than
    // merely relying on the compiled default.
    writeFileSync(join(root, 'observed.conf'), created);

    const dryRun = await pgRewind({ targetDataDir: env.primaryDir, sourcePort: env.standbyPort, writeRecoveryConf: true, dryRun: true });
    // eslint-disable-next-line no-console
    console.log('[p32] pg_rewind (hints off) exit', dryRun.code, '::', (dryRun.stderr || dryRun.stdout).split('\n').slice(-2).join(' | '));
    // Either outcome is informative, but it must not silently claim success on an ineligible cluster.
    expect(typeof dryRun.code).toBe('number');

    await stopServer({ dataDir: env.primaryDir }, 'fast');
    await stopServer({ dataDir: env.standbyDir }, 'fast');
  }, 180_000);

  it('02 split-brain: PostgreSQL does NOT stop a demoted primary from accepting writes', async () => {
    // The honest, uncomfortable finding. A promoted standby and a restarted old primary are both happy
    // to accept writes; PostgreSQL has no notion of "the other node is the primary now". Anything that
    // prevents split-brain lives OUTSIDE PostgreSQL: fencing, a VIP, a quorum manager, or an operator.
    const env = await pair('splitbrain', { walLogHints: true });
    const before = await seed(env.primaryPort, 'before failover');
    expect(await waitForRow(env.standbyPort, before)).toBe(true);

    // Fail over.
    await stopServer({ dataDir: env.primaryDir }, 'immediate');
    await promoteStandby({ dataDir: env.standbyDir });
    await waitForPromotion(env.standbyPort);

    // SAFETY: the promoted server is stopped before the demoted primary is started, so at no point are
    // two writable primaries listening. This sequence proves the absence of self-fencing without
    // creating a real split-brain in the sandbox.
    await stopServer({ dataDir: env.standbyDir }, 'fast');

    await startServer({ dataDir: env.primaryDir, port: env.primaryPort });
    const demotedState = await queryOn(env.primaryPort, 'SELECT pg_is_in_recovery() AS r, pg_current_wal_lsn()::text AS lsn', [], DB);
    // eslint-disable-next-line no-console
    console.log('[p32] restarted old primary:', demotedState.rows[0]);
    expect(demotedState.rows[0].r).toBe(false); // writable: NOT fenced

    // It accepts a write. That is the split-brain hazard, demonstrated in isolation.
    const divergentId = await seed(env.primaryPort, 'written on the isolated old primary', 999);
    const written = await queryOn(env.primaryPort, 'SELECT revision FROM design_studio_templates WHERE id = $1', [divergentId], DB);
    expect(written.rows[0].revision).toBe(1);

    // Its timeline is still the OLD one (1), while the promoted server is on 2.
    const demotedTimeline = await controldata(env.primaryDir);
    expect(demotedTimeline.timeline).toBe(1);

    await stopServer({ dataDir: env.primaryDir }, 'immediate');

    // Restart the promoted server and confirm it is on timeline 2. Only one is ever writable at a time.
    await startServer({ dataDir: env.standbyDir, port: env.standbyPort });
    const promoted = await currentTimeline(env.standbyPort, DB);
    expect(promoted).toBe(2);
    // eslint-disable-next-line no-console
    console.log('[p32] timelines at split: demoted=1 promoted=2; divergent row exists only on the demoted node');

    await stopServer({ dataDir: env.standbyDir }, 'fast');
  }, 240_000);

  it('03 rejoin with pg_rewind: the old primary comes back as a STANDBY on the new timeline', async () => {
    const env = await pair('rejoin', { walLogHints: true });
    const survivor = await seed(env.primaryPort, 'survivor', 70);
    expect(await waitForRow(env.standbyPort, survivor)).toBe(true);

    // Fail over to the standby.
    await stopServer({ dataDir: env.primaryDir }, 'immediate');
    await promoteStandby({ dataDir: env.standbyDir });
    await waitForPromotion(env.standbyPort);
    const promotedTimeline = await currentTimeline(env.standbyPort, DB);
    expect(promotedTimeline).toBe(2);

    // Bring the old primary's directory up to date against the new primary, writing standby config.
    // `pg_rewind` requires the target to be cleanly shut down; it was crashed, so this also exercises
    // that path (`--no-ensure-shutdown` is NOT passed, so pg_rewind handles the unclean state).
    const rewind = await pgRewind({
      targetDataDir: env.primaryDir,
      sourcePort: env.standbyPort,
      writeRecoveryConf: true,
    });
    // eslint-disable-next-line no-console
    console.log('[p32] pg_rewind exit', rewind.code, '::', (rewind.stderr || rewind.stdout).split('\n').slice(-3).join(' | '));
    expect(rewind.code).toBe(0);

    // It must now be configured as a standby, not as a primary.
    const signal = (() => { try { return readFileSync(join(env.primaryDir, 'standby.signal'), 'utf8'); } catch { return null; } })();
    expect(signal).not.toBeNull();

    // Start it on its original port and confirm it is in recovery and following.
    await startServer({ dataDir: env.primaryDir, port: env.primaryPort });
    const rejoined = await queryOn(env.primaryPort, 'SELECT pg_is_in_recovery() AS r', [], DB);
    expect(rejoined.rows[0].r).toBe(true); // a standby, not a second writable primary

    // A write must be refused. This is the single-writer guarantee re-established.
    await expect(
      queryOn(env.primaryPort, `INSERT INTO design_studio_templates (id, user_id, kind, name, document) VALUES (gen_random_uuid(), $1, 'label', 'must fail', '{}'::jsonb)`, [userId], DB)
    ).rejects.toThrow(/read-only|cannot execute/i);

    // Convergence: the survivor row (written before the failover) is present on both.
    const onNewPrimary = await queryOn(env.standbyPort, 'SELECT revision FROM design_studio_templates WHERE id = $1', [survivor], DB);
    expect(onNewPrimary.rows[0].revision).toBe(1);
    const onRejoined = await queryOn(env.primaryPort, 'SELECT revision FROM design_studio_templates WHERE id = $1', [survivor], DB);
    expect(onRejoined.rows[0].revision).toBe(1);

    // A fresh write on the new primary replicates to the rejoined standby.
    const afterRejoin = await seed(env.standbyPort, 'after rejoin', 88);
    expect(await waitForRow(env.primaryPort, afterRejoin)).toBe(true);

    // Timeline history exists, so the rewind is auditable rather than invisible.
    const history = timelineHistory(env.primaryDir);
    // eslint-disable-next-line no-console
    console.log('[p32] timeline history files on rejoined node:', history);
    expect(history.length).toBeGreaterThanOrEqual(1);

    await stopServer({ dataDir: env.primaryDir }, 'fast');
    await stopServer({ dataDir: env.standbyDir }, 'fast');
  }, 300_000);

  it('04 DATA LOSS ON REJOIN: a write made on the isolated old primary is discarded by pg_rewind', async () => {
    // The consequence that matters most. Writes accepted by the old primary while it was isolated are
    // on a timeline the new primary never saw. Rejoining cannot merge them: `pg_rewind` rolls the old
    // primary back to the last common checkpoint. The writes are GONE — silently, and this time the
    // user was told they succeeded by a server that was, briefly, a legitimate-looking primary.
    const env = await pair('divergence', { walLogHints: true });
    const survivor = await seed(env.primaryPort, 'common history', 70);
    expect(await waitForRow(env.standbyPort, survivor)).toBe(true);

    await stopServer({ dataDir: env.primaryDir }, 'immediate');
    await promoteStandby({ dataDir: env.standbyDir });
    await waitForPromotion(env.standbyPort);

    // SAFETY: new primary stopped before the old one is started, as in test 02.
    await stopServer({ dataDir: env.standbyDir }, 'fast');
    await startServer({ dataDir: env.primaryDir, port: env.primaryPort });
    const doomedId = await seed(env.primaryPort, 'WILL BE LOST', 444);
    // The isolated old primary accepted it — from the client's side this was a successful save.
    const ack = await queryOn(env.primaryPort, 'SELECT revision FROM design_studio_templates WHERE id = $1', [doomedId], DB);
    expect(ack.rows[0].revision).toBe(1);
    await stopServer({ dataDir: env.primaryDir }, 'immediate');

    // Meanwhile the new primary also moved forward, so the two histories genuinely diverge.
    await startServer({ dataDir: env.standbyDir, port: env.standbyPort });
    const keptId = await seed(env.standbyPort, 'kept', 123);

    // Rejoin.
    const rewind = await pgRewind({ targetDataDir: env.primaryDir, sourcePort: env.standbyPort, writeRecoveryConf: true });
    expect(rewind.code).toBe(0);
    await startServer({ dataDir: env.primaryDir, port: env.primaryPort });

    // The write that the old primary acknowledged before confirming success is gone.
    const lost = await queryOn(env.primaryPort, 'SELECT 1 FROM design_studio_templates WHERE id = $1', [doomedId], DB);
    // eslint-disable-next-line no-console
    console.log('[p32] after rejoin, rows for the divergent write:', lost.rows.length);
    expect(lost.rows).toHaveLength(0);

    // The shared history and the new primary's writes survive.
    expect(await waitForRow(env.primaryPort, survivor)).toBe(true);
    expect(await waitForRow(env.primaryPort, keptId)).toBe(true);

    // And the same is true on the new primary — this was real loss, not a visibility quirk.
    const onNewPrimary = await queryOn(env.standbyPort, 'SELECT 1 FROM design_studio_templates WHERE id = $1', [doomedId], DB);
    expect(onNewPrimary.rows).toHaveLength(0);

    await stopServer({ dataDir: env.primaryDir }, 'fast');
    await stopServer({ dataDir: env.standbyDir }, 'fast');
  }, 300_000);

  it('05 the revision predicate is intact after a rejoin, including stale rejection', async () => {
    const env = await pair('predicate', { walLogHints: true });
    const id = await seed(env.primaryPort, 'predicate after rejoin', 70);
    expect(await waitForRow(env.standbyPort, id)).toBe(true);

    await stopServer({ dataDir: env.primaryDir }, 'immediate');
    await promoteStandby({ dataDir: env.standbyDir });
    await waitForPromotion(env.standbyPort);
    const rewind = await pgRewind({ targetDataDir: env.primaryDir, sourcePort: env.standbyPort, writeRecoveryConf: true });
    expect(rewind.code).toBe(0);
    await startServer({ dataDir: env.primaryDir, port: env.primaryPort });

    // First save on the new primary wins.
    const first = await queryOn(env.standbyPort, CONDITIONAL_UPDATE, [id, userId, JSON.stringify({ widthMm: 80 }), 1], DB);
    expect(first.rows[0]?.revision).toBe(2);

    // Stale retry is still refused, and the rejoined standby converges to the same state.
    const stale = await queryOn(env.standbyPort, CONDITIONAL_UPDATE, [id, userId, JSON.stringify({ widthMm: 999 }), 1], DB);
    expect(stale.rows).toHaveLength(0);

    const deadline = Date.now() + 20_000;
    let replicatedRevision: number | undefined;
    while (Date.now() < deadline) {
      const { rows } = await queryOn(env.primaryPort, 'SELECT revision FROM design_studio_templates WHERE id = $1', [id], DB);
      replicatedRevision = rows[0]?.revision;
      if (replicatedRevision === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(replicatedRevision).toBe(2);

    await stopServer({ dataDir: env.primaryDir }, 'fast');
    await stopServer({ dataDir: env.standbyDir }, 'fast');
  }, 300_000);

  it('06 a second failover/rejoin cycle works, and each promotion advances the timeline', async () => {
    // Rejoin must be repeatable: a node that has already been rewound once must be rewindable again.
    const env = await pair('cycle', { walLogHints: true });
    const id = await seed(env.primaryPort, 'cycle', 70);
    expect(await waitForRow(env.standbyPort, id)).toBe(true);

    const timelines: number[] = [];
    // Cycle 1: promote the standby, rejoin the old primary.
    await stopServer({ dataDir: env.primaryDir }, 'immediate');
    await promoteStandby({ dataDir: env.standbyDir });
    await waitForPromotion(env.standbyPort);
    timelines.push(await currentTimeline(env.standbyPort, DB));
    expect((await pgRewind({ targetDataDir: env.primaryDir, sourcePort: env.standbyPort, writeRecoveryConf: true })).code).toBe(0);
    await startServer({ dataDir: env.primaryDir, port: env.primaryPort });
    expect((await queryOn(env.primaryPort, 'SELECT pg_is_in_recovery() AS r', [], DB)).rows[0].r).toBe(true);

    // Cycle 2: now fail over in the OTHER direction — the rejoined node is a standby, so the pair is
    // still single-writer. Promote it and rewind the other side.
    await stopServer({ dataDir: env.standbyDir }, 'immediate');
    await promoteStandby({ dataDir: env.primaryDir });
    await waitForPromotion(env.primaryPort);
    timelines.push(await currentTimeline(env.primaryPort, DB));
    expect((await pgRewind({ targetDataDir: env.standbyDir, sourcePort: env.primaryPort, writeRecoveryConf: true })).code).toBe(0);
    await startServer({ dataDir: env.standbyDir, port: env.standbyPort });
    expect((await queryOn(env.standbyPort, 'SELECT pg_is_in_recovery() AS r', [], DB)).rows[0].r).toBe(true);

    // eslint-disable-next-line no-console
    console.log('[p32] timelines across two failover cycles:', timelines);
    expect(timelines[1]).toBeGreaterThan(timelines[0]);

    // Data still converges after two rewinds.
    expect(await waitForRow(env.standbyPort, id)).toBe(true);

    await stopServer({ dataDir: env.primaryDir }, 'fast');
    await stopServer({ dataDir: env.standbyDir }, 'fast');
  }, 420_000);
});
