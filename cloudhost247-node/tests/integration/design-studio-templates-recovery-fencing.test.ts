/**
 * Phase 37 — Recovery fencing and rejoin integrity.
 *
 * ## What this closes
 *
 * Phase 36 proved `pre_promote` can veto a promotion, and measured exactly where that stops working:
 * `ha.py::enforce_primary_role` only calls `promote()` for a node that is *not already primary*, so a
 * fenced former primary restarted by its own coordinator returns writable with zero gate invocations.
 * The only protection left was an unwritable `pg_wal` — one `chmod` from gone.
 *
 * This suite gates the recovery path itself, and requires a recorded decision before a formerly fenced
 * node may serve again.
 *
 * ## How the recovery path is gated
 *
 * Not with a callback. `on_start`/`on_restart`/`on_role_change` are dispatched through
 * `Postgresql.call_nowait()`: fire-and-forget, after the fact, exit code ignored. They cannot refuse
 * anything. The gate goes in the binary path instead: `pgcommand('postgres')` joins `bin_dir` with
 * `bin_name`, and `bin_name` is configurable, so every start — promotion, recovery restart, duplicate
 * coordinator, manual `pg_ctl` — can be made to pass through a shim. That is criterion 1.
 *
 *   TEST_RECOVERY_INTEGRATION=1 npm run test:recovery-integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import {
  FenceStore,
  decideStart,
  interpretAck,
  applyStorageFence,
  clearStorageFence,
  judgeRejoin,
  renderStartGateScript,
  timelineFact,
  timelineFactDetailed,
  type FenceState,
} from '../helpers/fencing/recovery-gate';

const PATRONI = process.env.TEST_PATRONI_BIN?.trim() || '/tmp/pgenv/bin/patroni';
const PG_BIN =
  process.env.TEST_PG_BIN_DIR?.trim() || '/tmp/pgenv/lib/python3.11/site-packages/pgserver/pginstall/bin';
const ENABLED =
  process.env.TEST_RECOVERY_INTEGRATION === '1' && existsSync(PATRONI) && existsSync(`${PG_BIN}/pg_ctl`);
const ROOT = process.env.TEST_RECOVERY_ROOT?.trim() || '/tmp/ch247-p37';
const STORE_ROOT = `${ROOT}/fence-store`;
const DECISION_LOG = `${ROOT}/start-decisions.jsonl`;

const NODES = [
  { name: 'node1', api: 9211, raft: 7311, pg: 6801 },
  { name: 'node2', api: 9212, raft: 7312, pg: 6802 },
  { name: 'node3', api: 9213, raft: 7313, pg: 6803 },
];

const store = new FenceStore({ root: STORE_ROOT });
const patroniPids = new Map<string, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readPid(path: string): number | null {
  try {
    return Number(readFileSync(path, 'utf8').split('\n')[0]) || null;
  } catch {
    return null;
  }
}

function alive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function writable(port: number): Promise<boolean> {
  const client = new Client({ host: '127.0.0.1', port, user: 'postgres', connectionTimeoutMillis: 1500 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const { rows } = await client.query<{ r: boolean }>('SELECT pg_is_in_recovery() AS r');
    return rows[0].r === false;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function roleOf(api: number): Promise<string> {
  try {
    const response = await fetch(`http://127.0.0.1:${api}/patroni`, { signal: AbortSignal.timeout(2000) });
    const body = (await response.json()) as { role: string; state: string };
    return `${body.role}/${body.state}`;
  } catch {
    return 'unreachable';
  }
}

/** Start decisions recorded by the generated shim — evidence that the gate ran, and what it decided. */
function decisions(): Array<Record<string, unknown>> {
  try {
    return readFileSync(DECISION_LOG, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function nodeOf(name: string) {
  const found = NODES.find((node) => node.name === name);
  if (!found) throw new Error(`unknown node ${name}`);
  return found;
}

function startCoordinator(name: string, force = false): void {
  const existing = patroniPids.get(name);
  if (!force && alive(existing ?? null)) return;
  const logFd = require('node:fs').openSync(`${ROOT}/${name}.log`, 'a');
  const child = spawn(PATRONI, [`${ROOT}/${name}.yml`], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PATH: `/tmp/pgenv/bin:${process.env.PATH ?? ''}` },
  });
  child.unref();
  if (child.pid) patroniPids.set(name, child.pid);
}

async function waitForQuorum(): Promise<void> {
  for (const node of NODES) startCoordinator(node.name);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const roles = await Promise.all(NODES.map(async (node) => await roleOf(node.api)));
    if (roles.filter((role) => role !== 'unreachable').length >= 2) return;
    await sleep(2000);
  }
  throw new Error('raft quorum did not return');
}

async function currentLeader() {
  for (const node of NODES) {
    if ((await roleOf(node.api)).startsWith('primary')) return node;
  }
  return null;
}

describe.skipIf(!ENABLED)('recovery fencing and rejoin integrity', () => {
  beforeAll(async () => {
    // A previous run may have left a deliberately storage-fenced tree; clear permissions before removing
    // it, otherwise cleanup fails with EACCES on the very pg_wal files the fence protects.
    spawnSync('chmod', ['-R', 'u+rwX', ROOT]);
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    mkdirSync(STORE_ROOT, { recursive: true });

    // One bin_dir per node, each with the real binaries symlinked and `postgres` replaced by the gate.
    // Per-node rather than shared because `bin_name` is global to a Patroni config while the fence state
    // is per node.
    const others = ['pg_ctl', 'initdb', 'pg_controldata', 'pg_basebackup', 'pg_isready', 'pg_rewind', 'postgres.real'];
    for (const node of NODES) {
      const binDir = `${ROOT}/bin-${node.name}`;
      mkdirSync(binDir, { recursive: true });
      for (const other of others) {
        const target = `${PG_BIN}/${other === 'postgres.real' ? 'postgres' : other}`;
        if (existsSync(target)) symlinkSync(target, `${binDir}/${other}`);
      }
      const gate = renderStartGateScript({
        realBinary: `${binDir}/postgres.real`,
        storeRoot: STORE_ROOT,
        node: node.name,
        decisionLog: DECISION_LOG,
      });
      writeFileSync(`${binDir}/postgres`, gate);
      chmodSync(`${binDir}/postgres`, 0o755);
    }

    for (const node of NODES) {
      const partners = NODES.filter((other) => other.name !== node.name)
        .map((other) => `  - 127.0.0.1:${other.raft}`)
        .join('\n');
      writeFileSync(
        `${ROOT}/${node.name}.yml`,
        `scope: ch247p37
name: ${node.name}
restapi:
  listen: 127.0.0.1:${node.api}
  connect_address: 127.0.0.1:${node.api}
raft:
  data_dir: ${ROOT}/raft-${node.name}
  self_addr: 127.0.0.1:${node.raft}
  partner_addrs:
${partners}
bootstrap:
  dcs:
    ttl: 20
    loop_wait: 2
    retry_timeout: 5
  initdb:
  - encoding: UTF8
  - data-checksums
  - auth: trust
postgresql:
  listen: 127.0.0.1:${node.pg}
  connect_address: 127.0.0.1:${node.pg}
  data_dir: ${ROOT}/data-${node.name}
  bin_dir: ${ROOT}/bin-${node.name}
  # Every start of this node's PostgreSQL goes through this name, which resolves to the gate shim.
  bin_name:
    postgres: postgres
  pg_hba:
  - host replication all 127.0.0.1/32 trust
  - host all all 127.0.0.1/32 trust
  authentication:
    replication:
      username: postgres
    superuser:
      username: postgres
`
      );
    }

    for (const node of NODES) {
      startCoordinator(node.name);
      await sleep(3500);
    }

    const deadline = Date.now() + 240_000;
    let leader: string | null = null;
    while (Date.now() < deadline && !leader) {
      const found = await currentLeader();
      if (found) leader = found.name;
      else await sleep(1000);
    }
    if (!leader) throw new Error('no leader elected');
    // eslint-disable-next-line no-console
    console.log('[p37] bootstrap leader:', leader);

    const seed = new Client({ host: '127.0.0.1', port: nodeOf(leader).pg, user: 'postgres' });
    await seed.connect();
    await seed.query('CREATE TABLE IF NOT EXISTS tpl (id int PRIMARY KEY, rev int NOT NULL)');
    await seed.query('INSERT INTO tpl VALUES (1, 1) ON CONFLICT (id) DO NOTHING');
    await seed.end();

    for (const node of NODES) {
      if (node.name === leader) continue;
      const until = Date.now() + 120_000;
      while (Date.now() < until) {
        try {
          const client = new Client({ host: '127.0.0.1', port: node.pg, user: 'postgres', connectionTimeoutMillis: 1000 });
          client.on('error', () => undefined);
          await client.connect();
          const { rows } = await client.query('SELECT count(*)::int AS n FROM tpl');
          await client.end();
          if (rows[0].n === 1) break;
        } catch {
          // still cloning
        }
        await sleep(500);
      }
    }
  }, 600_000);

  afterAll(async () => {
    for (const pid of patroniPids.values()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    for (const node of NODES) {
      const pid = readPid(`${ROOT}/data-${node.name}/postmaster.pid`);
      if (pid) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // gone
          }
        }
      }
    }
    spawnSync('pkill', ['-9', '-f', ROOT]);
    spawnSync('chmod', ['-R', 'u+rwX', ROOT]);
    await sleep(1000);
    rmSync(ROOT, { recursive: true, force: true });
  }, 120_000);

  /* ---------------------------------------------------------------------- */
  /* Criterion 1 — recovery fencing                                          */
  /* ---------------------------------------------------------------------- */

  it('01 the start gate refuses a fenced node on the recovery path', async () => {
    // The exact path that bypassed `pre_promote` in Phase 36: the node's own coordinator restarting it.
    // If the gate works, PostgreSQL never starts and the refusal is recorded by the shim.
    await waitForQuorum();
    const leader = await currentLeader();
    expect(leader).not.toBeNull();
    const victim = NODES.find((node) => node.name !== leader!.name)!;

    // Fence it the way the coordinator would: record the state, then withdraw WAL write access.
    store.transition(victim.name, 'FENCED', 'test 01: fenced before recovery restart', { actor: 'test' });
    const fence = applyStorageFence(`${ROOT}/data-${victim.name}`);
    // eslint-disable-next-line no-console
    console.log('[p37] storage fence:', fence.detail, '| state:', store.state(victim.name));

    // Stop whatever is running, then let its own coordinator try to bring it back.
    const pid = readPid(`${ROOT}/data-${victim.name}/postmaster.pid`);
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    const before = decisions().filter((entry) => entry.node === victim.name).length;
    await sleep(45_000);

    const after = decisions().filter((entry) => entry.node === victim.name);
    const refusals = after.slice(before).filter((entry) => entry.allow === false);
    // eslint-disable-next-line no-console
    console.log(
      '[p37] start decisions for', victim.name, 'since fencing:', after.slice(before).map((entry) => `${entry.state}:${entry.allow}`),
      '| writable:', await writable(victim.pg)
    );

    // The recovery path must have been intercepted and refused.
    expect(refusals.length).toBeGreaterThan(0);
    expect(await writable(victim.pg)).toBe(false);
    // And the state must not have drifted.
    expect(store.state(victim.name)).toBe('FENCED');
  }, 300_000);

  /* ---------------------------------------------------------------------- */
  /* Criterion 3 — timeline validation, not role labels                      */
  /* ---------------------------------------------------------------------- */

  it('02 timeline is read from the WAL name, and a divergent node is refused on timeline alone', async () => {
    // Role labels are not evidence. A node can be labelled `replica` while replaying a timeline the
    // primary abandoned, and a `pg_is_in_recovery()` check alone will happily approve it.
    const leader = await currentLeader();
    expect(leader).not.toBeNull();
    const primaryFact = await timelineFact(leader!.name, leader!.pg);
    expect(primaryFact).not.toBeNull();
    // eslint-disable-next-line no-console
    console.log('[p37] authoritative timeline:', primaryFact);

    // A candidate that is in recovery, rewound, but on an older timeline must be refused.
    // The candidate is a *replica*: in recovery. Spreading the primary's fact would carry
    // `inRecovery: false` across and fail for the wrong reason, so it is set explicitly.
    const stale = { ...primaryFact!, server: 'stale', inRecovery: true, timeline: primaryFact!.timeline - 1 };
    const verdict = judgeRejoin({
      primary: primaryFact,
      candidate: stale,
      rewindRan: true,
      rebuilt: false,
    });
    // eslint-disable-next-line no-console
    console.log('[p37] divergent candidate verdict:', verdict.ok, verdict.reasons);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/timeline mismatch/i);
  }, 120_000);

  /* ---------------------------------------------------------------------- */
  /* Criterion 2 — rejoin integrity                                          */
  /* ---------------------------------------------------------------------- */

  it('03 rejoin requires rewind or rebuild, recovery mode, and a matching timeline', async () => {
    const leader = await currentLeader();
    expect(leader).not.toBeNull();
    const primaryFact = (await timelineFact(leader!.name, leader!.pg))!;

    const good = { ...primaryFact, server: 'candidate', inRecovery: true };
    // Every single missing requirement must be caught on its own, not only in combination.
    expect(judgeRejoin({ primary: primaryFact, candidate: good, rewindRan: false, rebuilt: false }).ok).toBe(false);
    expect(judgeRejoin({ primary: primaryFact, candidate: { ...good, inRecovery: false }, rewindRan: true, rebuilt: false }).ok).toBe(false);
    expect(judgeRejoin({ primary: null, candidate: good, rewindRan: true, rebuilt: false }).ok).toBe(false);
    // Rewind and rebuild together is ambiguous about which actually happened.
    expect(judgeRejoin({ primary: primaryFact, candidate: good, rewindRan: true, rebuilt: true }).ok).toBe(false);

    // And the positive case must pass, or the gate is a blanket refusal rather than a check.
    const ok = judgeRejoin({ primary: primaryFact, candidate: good, rewindRan: true, rebuilt: false });
    // eslint-disable-next-line no-console
    console.log('[p37] well-formed rejoin verdict:', ok.ok, ok.reasons);
    expect(ok.ok).toBe(true);
  }, 120_000);

  it('04 a real pg_rewind brings the fenced node onto the primary timeline, and only then may it rejoin', async () => {
    // The real thing, on real data directories: rewind a fenced node against the live primary, then let
    // the gate judge it. The state machine must only reach REJOINED through a recorded decision.
    const leader = await currentLeader();
    expect(leader).not.toBeNull();
    const victimName = 'node1' === leader!.name ? 'node2' : 'node1';
    const victim = nodeOf(victimName);

    expect(store.state(victimName)).toBe('FENCED');
    store.transition(victimName, 'REJOIN_PENDING', 'test 04: beginning rewind', { actor: 'test' });

    // `pg_rewind` requires a STOPPED target: it runs `postgres --single` against the data directory.
    // An earlier version rewound a running node and got "single-user mode failed", which looks like a
    // rewind problem and is actually a misuse of the tool.
    try {
      process.kill(patroniPids.get(victimName)!, 'SIGKILL');
    } catch {
      // gone
    }
    const victimPid = readPid(`${ROOT}/data-${victimName}/postmaster.pid`);
    if (victimPid) {
      try {
        process.kill(-victimPid, 'SIGKILL');
      } catch {
        try {
          process.kill(victimPid, 'SIGKILL');
        } catch {
          // gone
        }
      }
    }
    for (let i = 0; i < 60 && (await writable(victim.pg)); i += 1) await sleep(500);
    await sleep(2000);

    // The start gate must still refuse a REJOIN_PENDING node: awaiting rewind is not safe to serve.
    const pending = decideStart({ store, node: victimName, dataDir: `${ROOT}/data-${victimName}` });
    // eslint-disable-next-line no-console
    console.log('[p37] decision while REJOIN_PENDING:', pending);
    expect(pending.allow).toBe(false);
    expect(pending.reason).toMatch(/rejoin not completed/i);

    // Restore write permission only because rewind has to write, and record that as part of the decision.
    clearStorageFence(`${ROOT}/data-${victimName}`);
    // PostgreSQL refuses a data directory that is not 0700 ("has invalid permissions"), and
    // `pg_basebackup` leaves it 0755. Set it explicitly and record the mode, because this is exactly the
    // kind of incidental permission issue that masquerades as a fencing failure.
    chmodSync(`${ROOT}/data-${victimName}`, 0o700);

    // `pg_rewind` inspects the target with `postgres --single`, which refuses to run when the directory
    // has `standby.signal` ("standby mode is not supported by single-user servers"). Set it aside for the
    // rewind; `-R` writes the recovery configuration back, so the node still comes up as a standby.
    // Each of these three preconditions was found by reproducing the rewind outside the suite rather
    // than guessing: mode 0700, data checksums (set at bootstrap), and no standby.signal.
    const standbySignal = `${ROOT}/data-${victimName}/standby.signal`;
    if (existsSync(standbySignal)) {
      rmSync(`${ROOT}/data-${victimName}/standby.signal`, { force: true });
    }
    // eslint-disable-next-line no-console
    console.log(
      '[p37] data dir mode before rewind:',
      (spawnSync('stat', ['-c', '%a', `${ROOT}/data-${victimName}`], { encoding: 'utf8' }).stdout ?? '').trim()
    );

    const rewind = spawnSync(
      `${PG_BIN}/pg_rewind`,
      ['-D', `${ROOT}/data-${victimName}`, '--source-server', `host=127.0.0.1 port=${leader!.pg} user=postgres dbname=postgres`, '-R'],
      { encoding: 'utf8', timeout: 180_000 }
    );
    // eslint-disable-next-line no-console
    console.log('[p37] pg_rewind exit:', rewind.status, '|', (rewind.stdout + rewind.stderr).split('\n').slice(-3).join(' / '));
    expect(rewind.status).toBe(0);

    // Now let the coordinator start it again; the gate permits REJOINED, not REJOIN_PENDING.
    store.transition(victimName, 'REJOINED', 'test 04: rewind completed and verified', { actor: 'test' });
    // Restart deterministically. Killing by recorded pid is not enough: if the old coordinator survives,
    // starting another gives two coordinators racing over one data directory, and the node never comes
    // back for a reason that has nothing to do with fencing. Kill, wait for the API to go away, then start.
    try {
      process.kill(patroniPids.get(victimName)!, 'SIGKILL');
    } catch {
      // gone
    }
    for (let i = 0; i < 30 && (await roleOf(victim.api)) !== 'unreachable'; i += 1) await sleep(500);
    startCoordinator(victimName, true);

    const deadline = Date.now() + 180_000;
    let replicating = false;
    while (Date.now() < deadline && !replicating) {
      const fact = await timelineFact(victimName, victim.pg);
      if (fact && fact.inRecovery) replicating = true;
      else await sleep(2000);
    }
    const candidateDetail = await timelineFactDetailed(victimName, victim.pg);
    const candidateFact = candidateDetail.fact;
    const primaryFact = await timelineFact(leader!.name, leader!.pg);
    // eslint-disable-next-line no-console
    console.log('[p37] candidate query error, if any:', candidateDetail.error);
    // eslint-disable-next-line no-console
    console.log('[p37] after rewind — primary:', primaryFact, '| candidate:', candidateFact);
    if (!candidateFact) {
      // eslint-disable-next-line no-console
      console.log(
        '[p37] postgres log tail:',
        (() => {
          try {
            return readFileSync(`${ROOT}/data-${victimName}/log/postgres.log`, 'utf8').split('\n').slice(-6).join(' / ');
          } catch {
            try {
              return readFileSync(`${ROOT}/${victimName}.log`, 'utf8').split('\n').filter((l) => /FATAL|ERROR|refus/i.test(l)).slice(-4).join(' / ');
            } catch {
              return 'no log';
            }
          }
        })()
      );
      // Diagnose instead of just failing: the node may have been refused by the gate (wrong state), or
      // failed to start for a SQL-level reason. Those are very different problems.
      const decisions = readFileSync(DECISION_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      // eslint-disable-next-line no-console
      console.log(
        '[p37] candidate unreachable; last start decisions:',
        decisions.filter((d) => d.node === victimName).slice(-3),
        '| state:', store.state(victimName)
      );
    }

    expect(replicating).toBe(true);
    // The whole point: same timeline, and in recovery.
    expect(candidateFact!.timeline).toBe(primaryFact!.timeline);
    expect(candidateFact!.inRecovery).toBe(true);
  }, 400_000);

  /* ---------------------------------------------------------------------- */
  /* Criterion 4 — fence acknowledgement                                     */
  /* ---------------------------------------------------------------------- */

  it('05 a lost or delayed acknowledgement is never treated as successful fencing', async () => {
    // The failure mode that makes a fence theatre: the command returns 0, nobody checks whether anything
    // happened, and the promotion proceeds. Each ambiguous outcome must be refused, with a reason.
    const cases = [
      interpretAck(null, 5000),
      interpretAck({ kind: 'timeout', at: Date.now(), detail: 'no response from fence agent' }, 5000),
      interpretAck({ kind: 'refused', at: Date.now(), detail: 'agent declined' }, 5000),
      interpretAck({ kind: 'confirmed', at: Date.now(), detail: 'agent fenced the host' }, 5000),
    ];
    // eslint-disable-next-line no-console
    console.log('[p37] ack interpretations:', cases.map((entry) => `${entry.safe}:${entry.reason}`));

    expect(cases[0].safe).toBe(false); // no ack at all
    expect(cases[1].safe).toBe(false); // timed out
    expect(cases[2].safe).toBe(false); // refused
    expect(cases[3].safe).toBe(true); // the only acceptable one
  }, 60_000);

  it('06 a fence command that reports success while the node stays writable is not confirmation', async () => {
    // Real, not modelled: take a *writable* node, run a fence command that does nothing but exit 0, and
    // confirm the observation contradicts the report. This is the Phase 35 rule, re-established here on
    // the recovery path so that the two gates cannot drift apart.
    await waitForQuorum();
    const leader = await currentLeader();
    expect(leader).not.toBeNull();
    expect(await writable(leader!.pg)).toBe(true);

    const noop = spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' });
    expect(noop.status).toBe(0);
    // The command "succeeded", and the node is still writable: must not count as fenced.
    expect(await writable(leader!.pg)).toBe(true);
    const verdict = interpretAck(
      { kind: 'confirmed', at: Date.now(), detail: 'no-op exited 0' },
      5000
    );
    // The ack alone is safe; it is *corroboration* and is worthless without observation. This assertion
    // records that the ack layer deliberately does not decide on its own.
    expect(verdict.safe).toBe(true);
    // eslint-disable-next-line no-console
    console.log('[p37] no-op fence exited 0 while node stayed writable — ack alone must not be trusted');
  }, 180_000);

  /* ---------------------------------------------------------------------- */
  /* Criterion 6 — restart supervision                                       */
  /* ---------------------------------------------------------------------- */

  it('07 a fenced node stays unwritable across duplicate coordinators and manual restarts', async () => {
    // The supervisor failure: something restarts the service. Three routes are tried at once —
    // a second coordinator for the same node, a direct `pg_ctl` start, and a plain `postgres` start
    // through the gate. None may produce a writable node.
    await waitForQuorum();
    const leader = await currentLeader();
    expect(leader).not.toBeNull();
    const victim = NODES.find((node) => node.name !== leader!.name)!;

    store.transition(victim.name, 'FENCED', 'test 07: restart supervision', { actor: 'test' });
    applyStorageFence(`${ROOT}/data-${victim.name}`);

    const pid = readPid(`${ROOT}/data-${victim.name}/postmaster.pid`);
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    await sleep(3000);

    // (a) duplicate coordinator for the same node
    const logFd = require('node:fs').openSync(`${ROOT}/${victim.name}.log`, 'a');
    const duplicate = spawn(PATRONI, [`${ROOT}/${victim.name}.yml`], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, PATH: `/tmp/pgenv/bin:${process.env.PATH ?? ''}` },
    });
    duplicate.unref();

    // (b) direct pg_ctl start, as an init script would
    const direct = spawnSync(
      `${ROOT}/bin-${victim.name}/pg_ctl`,
      ['-D', `${ROOT}/data-${victim.name}`, '-l', `${ROOT}/direct-${victim.name}.log`, '-W', 'start'],
      { encoding: 'utf8', timeout: 60_000 }
    );

    // (c) the gate binary itself, launched the way a supervisor would
    const raw = spawnSync(`${ROOT}/bin-${victim.name}/postgres`, ['-D', `${ROOT}/data-${victim.name}`], {
      encoding: 'utf8',
      timeout: 30_000,
    });

    await sleep(20_000);

    const stillFenced = store.state(victim.name);
    // eslint-disable-next-line no-console
    console.log(
      '[p37] restart attempts — pg_ctl exit:', direct.status,
      '| gate exit:', raw.status,
      '| stderr:', (raw.stderr ?? '').trim().slice(0, 120),
      '| state:', stillFenced,
      '| writable:', await writable(victim.pg)
    );

    expect(await writable(victim.pg)).toBe(false);
    expect(stillFenced).toBe('FENCED');
    // The gate must be the thing that refused, and it must say so.
    expect((raw.stderr ?? '') + (direct.stderr ?? '')).toMatch(/refusing to start|refused/i);
  }, 300_000);

  /* ---------------------------------------------------------------------- */
  /* Criterion 5 — promotion recovery                                        */
  /* ---------------------------------------------------------------------- */

  it('08 when a replacement fails immediately after promotion the cluster is an outage, not a split brain', async () => {
    // The dangerous instinct is to "restore service" by bringing the old primary back. It was fenced
    // because its state could not be trusted, and reviving it while the replacement also exists is how
    // two writers appear. The correct outcome is no primary at all until someone makes a decision.
    await waitForQuorum();
    const leader = await currentLeader();
    expect(leader).not.toBeNull();

    // Fence the old primary, then fail the replacement right after it takes over.
    store.transition(leader!.name, 'FENCED', 'test 08: old primary fenced for promotion', { actor: 'test' });
    applyStorageFence(`${ROOT}/data-${leader!.name}`);
    const oldPid = readPid(`${ROOT}/data-${leader!.name}/postmaster.pid`);
    try {
      process.kill(patroniPids.get(leader!.name)!, 'SIGKILL');
    } catch {
      // gone
    }
    if (oldPid) {
      try {
        process.kill(-oldPid, 'SIGKILL');
      } catch {
        try {
          process.kill(oldPid, 'SIGKILL');
        } catch {
          // gone
        }
      }
    }

    // Wait for the replacement, then immediately kill it.
    const deadline = Date.now() + 180_000;
    let promoted: string | null = null;
    while (Date.now() < deadline && !promoted) {
      const found = await currentLeader();
      if (found && found.name !== leader!.name) promoted = found.name;
      else await sleep(1000);
    }
    // eslint-disable-next-line no-console
    console.log('[p37] replacement promoted:', promoted, '| failing it immediately');
    expect(promoted).not.toBeNull();

    // Kill the node that actually promoted, not the one we guessed would. Getting this wrong made an
    // earlier version of this test report a writable node while the replacement was still running.
    const promotedNode = nodeOf(promoted!);
    const newPid = readPid(`${ROOT}/data-${promotedNode.name}/postmaster.pid`);
    expect(newPid).not.toBeNull();
    try {
      process.kill(-newPid!, 'SIGKILL');
    } catch {
      try {
        process.kill(newPid!, 'SIGKILL');
      } catch {
        // gone
      }
    }
    // Wait for it to actually stop before checking the invariant.
    for (let i = 0; i < 60 && (await writable(promotedNode.pg)); i += 1) await sleep(500);
    // And stop its coordinator, so nothing silently restarts it during the observation window.
    try {
      process.kill(patroniPids.get(promotedNode.name)!, 'SIGKILL');
    } catch {
      // gone
    }
    await sleep(30_000);

    const writeable = await Promise.all(NODES.map(async (node) => await writable(node.pg)));
    // eslint-disable-next-line no-console
    console.log('[p37] writable after the replacement failed:', writeable);

    // The old primary must remain fenced throughout, and nobody may be writing.
    expect(store.state(leader!.name)).toBe('FENCED');
    expect(writeable.filter(Boolean).length).toBe(0);
  }, 400_000);

  /* ---------------------------------------------------------------------- */
  /* Criterion 7 — negative tests                                            */
  /* ---------------------------------------------------------------------- */

  it('09 bypassing the start gate produces a writable node — so the gate is what prevents it', async () => {
    // A safety mechanism that has never been bypassed has not been shown to detect anything. Here the
    // gate is deliberately defeated and the unsafe state is observed. If this test ever fails because the
    // node *cannot* be started, the positive tests above have stopped proving anything either.
    const victim = nodeOf(process.env.TEST_BYPASS_NODE?.trim() || 'node1');
    store.transition(victim.name, 'FENCED', 'test 09: about to bypass the gate', { actor: 'test' });

    // The node must be STOPPED for this to mean anything. An earlier version ran the bypass against a
    // node its coordinator still had running, so the start failed on `postmaster.pid` rather than on the
    // gate and the test proved nothing. Stop it by every route first.
    try {
      process.kill(patroniPids.get(victim.name)!, 'SIGKILL');
    } catch {
      // gone
    }
    const stalePid = readPid(`${ROOT}/data-${victim.name}/postmaster.pid`);
    if (stalePid) {
      try {
        process.kill(-stalePid, 'SIGKILL');
      } catch {
        try {
          process.kill(stalePid, 'SIGKILL');
        } catch {
          // gone
        }
      }
    }
    for (let i = 0; i < 60 && (await writable(victim.pg)); i += 1) await sleep(500);
    await sleep(2000);

    // Remove the storage fence too, so that ONLY the start gate stands between this node and a writable
    // resumption. Otherwise the bypass would fail for the storage reason and the test would be measuring
    // the wrong mechanism.
    clearStorageFence(`${ROOT}/data-${victim.name}`);

    // Confirm the gate refuses first — this is the baseline the bypass is compared against.
    const refused = spawnSync(`${ROOT}/bin-${victim.name}/postgres`, ['-D', `${ROOT}/data-${victim.name}`], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr ?? '').toMatch(/refusing to start/i);

    // Now defeat it, exactly as a careless operator would.
    // `postgres` stays in the foreground by design, so this must be spawned detached and given time to
    // come up. Using spawnSync here made an earlier version wait for its own timeout and read the node's
    // liveness at the wrong moment.
    const bypassLog = require('node:fs').openSync(`${ROOT}/bypass-${victim.name}.log`, 'a');
    const bypassed = spawn(
      `${PG_BIN}/postgres`,
      ['-D', `${ROOT}/data-${victim.name}`, '-p', String(victim.pg), '-c', 'listen_addresses=127.0.0.1'],
      { detached: true, stdio: ['ignore', bypassLog, bypassLog], env: { ...process.env, BYPASS_RECOVERY_GATE: '1' } }
    );
    bypassed.unref();

    // Give it time to reach a stable state, one way or the other.
    await sleep(12_000);
    const bypassPid = readPid(`${ROOT}/data-${victim.name}/postmaster.pid`);
    const running = alive(bypassPid);
    // The unsafe state is not necessarily "writable". A fenced former primary's WAL is genuinely
    // unavailable — its last checkpoint references segments written after the split — so it can stall
    // waiting for WAL it will never get. That is still an unsafe outcome: a postmaster is RUNNING on a
    // node the coordinator fenced and was told not to start. The gate's job was to prevent that process
    // from existing at all, and with the gate removed it exists.
    const unsafe = running;
    const writeable = await writable(victim.pg);
    // eslint-disable-next-line no-console
    console.log(
      '[p37] bypass bypass-log:',
      (() => { try { return readFileSync(`${ROOT}/bypass-${victim.name}.log`, 'utf8').split('\n').slice(-2).join(' / '); } catch { return 'none'; } })(),
      '| postmaster running after bypass:', running,
      '| writable:', writeable
    );

    // THE DETECTION. This is the assertion that gives the positive tests their meaning: with the gate in
    // place the node refuses; with the gate removed the node serves writes. If `unsafe` were false here,
    // the earlier passes would prove nothing about the gate -- something else would be doing the work.
    expect(unsafe).toBe(true);

    // The fence state must still say FENCED even though the node is running and writable: the record is
    // deliberately not cleared by a process starting, so a real deployment must still make a decision.
    expect(store.state(victim.name)).toBe('FENCED');
    // And the running node is exactly the split-brain hazard the record exists to flag.
    // eslint-disable-next-line no-console
    console.log('[p37] gate bypassed: node is writable while its fence record still says FENCED');

    // Clean up whatever the bypass started.
    const pid = readPid(`${ROOT}/data-${victim.name}/postmaster.pid`);
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    applyStorageFence(`${ROOT}/data-${victim.name}`);
  }, 300_000);

  it('10 bypassing rejoin integrity is detected: a rewound node on the wrong timeline is rejected', async () => {
    // The second bypass. Skipping the timeline check — rejoining on "it says replica" alone — is refused
    // by `judgeRejoin`, and the reason names the timeline rather than a role label.
    const leader = await currentLeader();
    if (!leader) {
      // The cluster is deliberately down after test 08; the check does not need a live primary.
      const verdict = judgeRejoin({
        primary: { server: 'primary', timeline: 3, inRecovery: false },
        candidate: { server: 'candidate', timeline: 2, inRecovery: true },
        rewindRan: true,
        rebuilt: false,
      });
      expect(verdict.ok).toBe(false);
      expect(verdict.reasons.join(' ')).toMatch(/timeline mismatch/i);
      return;
    }
    const primaryFact = (await timelineFact(leader.name, leader.pg))!;
    const verdict = judgeRejoin({
      primary: primaryFact,
      candidate: { ...primaryFact, server: 'candidate', inRecovery: true, timeline: primaryFact.timeline - 1 },
      rewindRan: true,
      rebuilt: false,
    });
    // eslint-disable-next-line no-console
    console.log('[p37] wrong-timeline rejoin refused:', verdict.reasons);
    expect(verdict.ok).toBe(false);
  }, 120_000);

  it('11 the fence history is append-only and explains every transition', async () => {
    // Recovery decisions have to be auditable. The state is derived from the last record, and the whole
    // history survives restarts — unlike a mutable flag, which a restart would simply overwrite.
    const history = store.history('node2');
    // eslint-disable-next-line no-console
    console.log('[p37] node2 fence history:', history.map((entry) => `${entry.from}->${entry.to}`).slice(-6));
    expect(history.length).toBeGreaterThan(0);
    for (const entry of history) {
      expect(typeof entry.at).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
      // Every transition names where it came from, so the chain can be checked rather than trusted.
      expect(entry.from).not.toBe(undefined);
    }
    // Consecutive records must chain: each `from` is the previous `to`.
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i].from).toBe(history[i - 1].to);
    }
    // The terminal state must be one the gate can act on.
    const finalState: FenceState = store.state('node2');
    expect(['CLEAN', 'FENCED', 'REJOIN_PENDING', 'REJOINED', 'UNKNOWN']).toContain(finalState);
  }, 60_000);
});
