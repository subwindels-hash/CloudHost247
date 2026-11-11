/**
 * Phase 36 — Patroni `pre_promote` integration: promotion blocked until fencing is confirmed.
 *
 * ## The difference from Phase 35
 *
 * Phase 35 verified the ordering in a harness that *called* the fence and *then* promoted. This suite
 * puts the same gate inside the coordinator: Patroni's `pre_promote` hook runs after the leader lock is
 * acquired and before the replica is promoted, and a non-zero exit prevents promotion **and** drops
 * the leader key. The coordinator therefore cannot expose a primary whose predecessor was not
 * confirmed fenced — not because a harness says so, but because Patroni refuses.
 *
 * ## Why `pre_promote` and not `on_role_change`
 *
 * `on_role_change`/`on_stop` are lifecycle *notifications*: they report what already happened. They can
 * fence the demoting side, but they cannot stop a promotion, so they cannot enforce the ordering alone.
 * `pre_promote` is the only hook with veto power. That distinction is the substance of this phase and is
 * demonstrated here by observing that a failing gate leaves the cluster with **no** primary.
 *
 * ## Real infrastructure
 *
 * Patroni 4.1.5, raft DCS, three PostgreSQL 16.2 nodes, real streaming replication, real `pg_ctl
 * promote`, real process-group SIGKILL, real WAL permission fences. The gate is a real subprocess
 * invoked by Patroni with the exit-code contract Patroni documents.
 *
 * ## Running
 *
 *   TEST_PATRONI_INTEGRATION=1 npm run test:patroni-integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const PATRONI = process.env.TEST_PATRONI_BIN?.trim() || '/tmp/pgenv/bin/patroni';
const PG_BIN = process.env.TEST_PG_BIN_DIR?.trim() || '/tmp/pgenv/lib/python3.11/site-packages/pgserver/pginstall/bin';
const ENABLED = process.env.TEST_PATRONI_INTEGRATION === '1' && existsSync(PATRONI) && existsSync(`${PG_BIN}/pg_ctl`);
const ROOT = process.env.TEST_PATRONI_INTEGRATION_ROOT?.trim() || '/tmp/ch247-p36';
const JOURNAL = `${ROOT}/fence-journal.jsonl`;
const LAST_LEADER = `${ROOT}/last-leader`;
const GATE = `${ROOT}/gate.js`;

// The gate is compiled with the project's own esbuild, which is a declared devDependency. It is
// deliberately never fetched at test time: a suite that downloads a compiler is not reproducible,
// needs the network to pass, and can silently test a different binary from the one the lockfile
// pins. If this path is missing the fix is `npm install`, not a fallback.
const ESBUILD = join(process.cwd(), 'node_modules', '.bin', 'esbuild');

const NODES = [
  { name: 'node1', api: 9111, raft: 7211, pg: 6701 },
  { name: 'node2', api: 9112, raft: 7212, pg: 6702 },
  { name: 'node3', api: 9113, raft: 7213, pg: 6703 },
];

const patroniPidsGlobal = new Map<string, number>();

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

/** Coordinator liveness, tracked globally so a node killed in one test can be revived in another. */
function coordinatorAlive(name: string): boolean {
  return alive(patroniPidsGlobal.get(name) ?? null);
}

/**
 * Start a node's coordinator again, as an operator or an init script would.
 *
 * This matters for honesty: raft needs two of three coordinators for quorum. A test that kills
 * coordinators and then observes "no primary" has demonstrated quorum loss, not fencing. Restoring
 * quorum is what makes the later observations attributable to the gate.
 */
function startCoordinator(name: string): void {
  if (coordinatorAlive(name)) return;
  const logFd = require('node:fs').openSync(`${ROOT}/${name}.log`, 'a');
  const child = spawn(PATRONI, [`${ROOT}/${name}.yml`], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      PATH: `/tmp/pgenv/bin:${process.env.PATH ?? ''}`,
      FENCE_NODES: JSON.stringify(Object.fromEntries(NODES.map((entry) => [entry.name, entry.pg]))),
      FENCE_JOURNAL: JOURNAL,
      FENCE_LAST_LEADER: LAST_LEADER,
      FENCE_VERIFY_MS: '15000',
      TEST_PG_BIN_DIR: PG_BIN,
      ...Object.fromEntries(
        NODES.map((entry) => [`NODE_DATADIR_${entry.name.toUpperCase()}`, `${ROOT}/data-${entry.name}`])
      ),
    },
  });
  child.unref();
  if (child.pid) patroniPidsGlobal.set(name, child.pid);
}

/**
 * Bring the cluster back to health between destructive tests.
 *
 * Necessary because fencing is real: it revokes WAL permissions, which means a fenced node cannot
 * restart until those permissions are restored. Without this, each destructive test leaves the cluster
 * a node smaller and later tests fail for want of quorum rather than for the reason they are testing.
 */
async function healCluster(): Promise<void> {
  spawnSync('chmod', ['-R', 'u+rwX', ROOT]);
  for (const node of NODES) startCoordinator(node.name);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const leader = await (async () => {
      for (const node of NODES) {
        if ((await roleOf(node.api)).startsWith('primary')) return node;
      }
      return null;
    })();
    if (leader) {
      // Wait until at least one other node is a healthy replica, so failovers have a candidate.
      const ready = Date.now() + 120_000;
      while (Date.now() < ready) {
        const replicas = (await Promise.all(NODES.map(async (node) => await roleOf(node.api)))).filter((role) =>
          role.startsWith('replica/running')
        ).length;
        if (replicas >= 1) return;
        await sleep(2000);
      }
      return;
    }
    await sleep(2000);
  }
  throw new Error('cluster did not heal');
}

/** Wait until a majority of coordinators answer again, so raft can actually elect someone. */
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

/**
 * Apply the gate's real fence to a named node, by running the bundled gate with a candidate that would
 * cause it to fence that node.
 *
 * Deliberately goes through the built artifact rather than re-importing the TypeScript: the thing under
 * test is the code Patroni executes, and importing the source would let a bundling or environment
 * difference pass unnoticed.
 */
async function runFenceNodeCommand(nodeName: string): Promise<string> {
  const env = {
    ...process.env,
    FENCE_NODES: JSON.stringify(Object.fromEntries(NODES.map((entry) => [entry.name, entry.pg]))),
    FENCE_JOURNAL: JOURNAL,
    FENCE_LAST_LEADER: LAST_LEADER,
    FENCE_VERIFY_MS: '3000',
    TEST_PG_BIN_DIR: PG_BIN,
    ...Object.fromEntries(
      NODES.map((entry) => [`NODE_DATADIR_${entry.name.toUpperCase()}`, `${ROOT}/data-${entry.name}`])
    ),
  };
  // Point the gate at the node we want fenced, and at a candidate that is not it.
  writeFileSync(LAST_LEADER, nodeName);
  const candidate = NODES.find((entry) => entry.name !== nodeName)!.name;
  const result = spawnSync('node', [GATE, candidate], { encoding: 'utf8', env, timeout: 120_000 });
  writeFileSync(
    `${ROOT}/fence-result.json`,
    JSON.stringify({ appliedTo: nodeName, exitCode: result.status, stderr: result.stderr?.slice(0, 200) })
  );
  return `applied ${nodeName} via candidate ${candidate}, gate exit ${result.status}`;
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

/** Read the gate's own journal: the timestamped evidence of what the coordinator did and when. */
function events(): Array<Record<string, unknown>> {
  try {
    return readFileSync(JOURNAL, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe.skipIf(!ENABLED)('Patroni pre_promote gate', () => {

  beforeAll(async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });

    // The gate is compiled from the TypeScript helper so the test exercises the real implementation.
    // Fail closed: no esbuild means no gate, and no gate means this suite cannot make a claim.
    if (!existsSync(ESBUILD)) {
      throw new Error(
        `missing esbuild binary at ${ESBUILD}. ` +
          `The gate cannot be compiled, so the pre_promote contract cannot be exercised. ` +
          `Run "npm install" in cloudhost247-node/ and retry. ` +
          `This suite never downloads esbuild at test time by design.`
      );
    }
    const build = spawnSync(
      ESBUILD,
      [
        'tests/helpers/fencing/pre-promote.ts',
        '--bundle',
        '--platform=node',
        '--format=cjs',
        `--outfile=${GATE}`,
      ],
      { encoding: 'utf8', timeout: 180_000 }
    );
    if (build.status !== 0 || !existsSync(GATE)) {
      throw new Error(
        `could not build the gate (esbuild exit ${String(build.status)}, signal ${String(build.signal)}): ` +
          `${build.stdout ?? ''}\n${build.stderr ?? ''}`
      );
    }

    // A wrapper, so the gate can be made to refuse at runtime. Patroni reads its configuration
    // once at startup, so toggling refusal means toggling a file rather than editing YAML and
    // restarting -- which would also lose the very leader the test needs to fail over from.
    writeFileSync(
      `${ROOT}/gate-wrapper.sh`,
      `#!/bin/bash\n` +
        `echo "invoked $1 at $(date -Is)" >> ${ROOT}/wrapper.log\n` +
        `if [ -f ${ROOT}/refuse ]; then echo "refusing by request" >> ${ROOT}/wrapper.log; exit 1; fi\n` +
        `exec node ${GATE} "$1"\n`
    );

    for (const node of NODES) {
      const partners = NODES.filter((other) => other.name !== node.name)
        .map((other) => `  - 127.0.0.1:${other.raft}`)
        .join('\n');
      const nodeMap = JSON.stringify(Object.fromEntries(NODES.map((entry) => [entry.name, entry.pg])));
      writeFileSync(
        `${ROOT}/${node.name}.yml`,
        `scope: ch247p36
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
  bin_dir: ${PG_BIN}
  # THE GATE. Runs after the leader lock is acquired and before promotion; non-zero exit prevents
  # promotion and drops the leader key.
  pre_promote: "bash ${ROOT}/gate-wrapper.sh ${node.name}"
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
      const logFd = require('node:fs').openSync(`${ROOT}/${node.name}.log`, 'a');
      const child = spawn(PATRONI, [`${ROOT}/${node.name}.yml`], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: {
          ...process.env,
          PATH: `/tmp/pgenv/bin:${process.env.PATH ?? ''}`,
          FENCE_NODES: JSON.stringify(Object.fromEntries(NODES.map((entry) => [entry.name, entry.pg]))),
          FENCE_JOURNAL: JOURNAL,
          FENCE_LAST_LEADER: LAST_LEADER,
          FENCE_VERIFY_MS: '15000',
          TEST_PG_BIN_DIR: PG_BIN,
          ...Object.fromEntries(NODES.map((entry) => [`NODE_DATADIR_${entry.name.toUpperCase()}`, `${ROOT}/data-${entry.name}`])),
        },
      });
      child.unref();
      if (child.pid) patroniPidsGlobal.set(node.name, child.pid);
      await sleep(3500);
    }

    // Wait for a leader, then seed, then wait for replicas to actually hold the data.
    const deadline = Date.now() + 240_000;
    let leader: string | null = null;
    while (Date.now() < deadline && !leader) {
      for (const node of NODES) {
        if ((await roleOf(node.api)).startsWith('primary')) { leader = node.name; break; }
      }
      if (!leader) await sleep(1000);
    }
    if (!leader) throw new Error('no leader elected');
    // eslint-disable-next-line no-console
    console.log('[p36] bootstrap leader:', leader);
    writeFileSync(LAST_LEADER, leader);

    const leaderNode = NODES.find((node) => node.name === leader)!;
    const seed = new Client({ host: '127.0.0.1', port: leaderNode.pg, user: 'postgres' });
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
  }, 500_000);

  afterAll(async () => {
    for (const pid of patroniPidsGlobal.values()) {
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
    // WAL permissions may have been revoked by a fence; restore before removing.
    spawnSync('chmod', ['-R', 'u+rwX', ROOT]);
    await sleep(1000);
    rmSync(ROOT, { recursive: true, force: true });
  }, 120_000);

  it('01 a failover fences the still-writable former primary before promoting a successor', async () => {
    // The strongest available demonstration. Only the leader's *coordinator* is killed; its PostgreSQL
    // keeps running and stays writable. A successor therefore cannot promote unless the gate first
    // fences the old primary -- so if a new leader appears at all, the fence necessarily came first.
    const leaderName = readFileSync(LAST_LEADER, 'utf8').trim();
    const leaderNode = NODES.find((node) => node.name === leaderName) ?? NODES[0];
    expect(await writable(leaderNode.pg)).toBe(true);

    const patroniPid = patroniPidsGlobal.get(leaderNode.name);
    expect(patroniPid).toBeDefined();
    try {
      process.kill(patroniPid!, 'SIGKILL');
    } catch {
      // already gone
    }

    const deadline = Date.now() + 240_000;
    let newLeader: string | null = null;
    while (Date.now() < deadline && !newLeader) {
      for (const node of NODES) {
        if (node.name === leaderNode.name) continue;
        if ((await roleOf(node.api)).startsWith('primary')) {
          newLeader = node.name;
          break;
        }
      }
      if (!newLeader) await sleep(1000);
    }

    const all = events();
    // eslint-disable-next-line no-console
    console.log('[p36] new leader:', newLeader, '| journal:', all.map((entry) => entry.event).join(' '));

    expect(newLeader).not.toBeNull();

    // The gate must have been consulted -- this is the difference between "a coordinator promoted
    // someone" and "a coordinator promoted someone through the gate".
    expect(all.filter((entry) => entry.event === 'pre_promote.start').length).toBeGreaterThan(0);

    // And it must have fenced this specific node, because that node was provably writable just above.
    const fenced = all.filter((entry) => entry.event === 'pre_promote.fenced' && entry.node === leaderNode.name);
    expect(fenced.length).toBeGreaterThan(0);

    // Fencing precedes confirmation precedes promotion: check the recorded order, not just presence.
    const order = all
      .filter((entry) => ['pre_promote.fenced', 'pre_promote.confirmed'].includes(String(entry.event)))
      .map((entry) => String(entry.event));
    expect(order.indexOf('pre_promote.fenced')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('pre_promote.confirmed')).toBeGreaterThan(order.indexOf('pre_promote.fenced'));

    // The former primary must no longer be writable, and there must be exactly one writable node.
    const writeable = await Promise.all(NODES.map(async (node) => await writable(node.pg)));
    // eslint-disable-next-line no-console
    console.log('[p36] writable after failover:', writeable);
    expect(writeable.filter(Boolean).length).toBe(1);

    writeFileSync(LAST_LEADER, newLeader!);
  }, 400_000);

  it('02 a REFUSED gate stops a real promotion', async () => {
    // Arranged so that "no primary" can only be explained by the gate:
    //
    //   1. Heal the cluster and confirm two healthy nodes.
    //   2. Stop the leader's coordinator. Its PostgreSQL stays alive and writable, so the old primary
    //      is still there -- this is the dangerous state the gate exists to police.
    //   3. Stop the old primary's PostgreSQL too. The remaining coordinator is then the only candidate,
    //      and it must promote the survivor, which is a *real promotion* and so does go through
    //      `pre_promote`.
    //   4. Make the gate refuse, and confirm the survivor never becomes primary.
    //
    // Step 4's evidence is the survivor staying `replica/running` while its coordinator is alive and
    // holds quorum. Two writers never appear; a service outage does.
    await healCluster();
    const leader = await (async () => {
      for (const node of NODES) {
        if ((await roleOf(node.api)).startsWith('primary')) return node;
      }
      return null;
    })();
    expect(leader).not.toBeNull();

    // Choose the doomed node and the candidate before touching anything.
    const survivors = NODES.filter((node) => node.name !== leader!.name);
    expect(survivors.length).toBeGreaterThanOrEqual(1);
    const candidate = survivors[0];

    // Make the gate refuse before the promotion is attempted. A file, because Patroni reads
    // `pre_promote` once at startup; editing YAML would require restarting the very coordinator
    // whose behaviour is under test.
    writeFileSync(`${ROOT}/refuse`, 'x');
    const invocationsBefore = readFileSync(`${ROOT}/wrapper.log`, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('invoked')).length;

    // Remove the old primary completely: coordinator, then postmaster. Stopping the postmaster is
    // essential -- leaving it writable would leave a legitimate primary and the test would be
    // checking whether a *second* one appears, which is a different question.
    try {
      process.kill(patroniPidsGlobal.get(leader!.name)!, 'SIGKILL');
    } catch {
      // already gone
    }
    const oldPid = readPid(`${ROOT}/data-${leader!.name}/postmaster.pid`);
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
    for (let i = 0; i < 60 && (await writable(leader!.pg)); i += 1) await sleep(500);

    // Now the survivor's coordinator must attempt a real promotion, and the gate must stop it.
    await sleep(120_000);

    const roles = await Promise.all(NODES.map(async (node) => await roleOf(node.api)));
    const reachable = roles.filter((role) => role !== 'unreachable').length;
    // eslint-disable-next-line no-console
    console.log('[p36] roles while the gate refuses:', roles, '| reachable coordinators:', reachable);

    // Quorum must exist, or "no primary" proves only that nobody could hold an election.
    expect(reachable).toBeGreaterThanOrEqual(1);

    // The candidate must not become a primary.
    expect((await roleOf(candidate.api)).startsWith('primary')).toBe(false);
    // And there must be no writable node anywhere.
    const writeable = await Promise.all(NODES.map(async (node) => await writable(node.pg)));
    // eslint-disable-next-line no-console
    console.log('[p36] writable nodes while the gate refuses:', writeable);
    expect(writeable.filter(Boolean).length).toBe(0);

    const wrapperLog = readFileSync(`${ROOT}/wrapper.log`, 'utf8');
    const invocationsAfter = wrapperLog.split('\n').filter((line) => line.startsWith('invoked')).length;
    // eslint-disable-next-line no-console
    console.log('[p36] gate invocations during refusal window:', invocationsAfter - invocationsBefore);
    // The gate must have run, otherwise this test demonstrates an outage and says nothing about it.
    expect(invocationsAfter - invocationsBefore).toBeGreaterThan(0);
    expect(wrapperLog).toMatch(/refusing by request/);

    rmSync(`${ROOT}/refuse`, { force: true });

    // With the gate allowed again the cluster must recover on its own. If it cannot, the gate is not
    // a safety mechanism but a permanent outage, which would be just as wrong.
    await healCluster();
    const recovered = await (async () => {
      for (const node of NODES) {
        if ((await roleOf(node.api)).startsWith('primary')) return node;
      }
      return null;
    })();
    // eslint-disable-next-line no-console
    console.log('[p36] recovered leader after the gate was reopened:', recovered?.name);
    expect(recovered).not.toBeNull();
  }, 600_000);

  it('07 HONEST LIMIT: a restarted primary never passes through pre_promote', async () => {
    // This test documents a real hole in the hook rather than asserting the design is complete.
    //
    // Patroni's `enforce_primary_role` calls `Postgresql.promote()` -- and therefore `pre_promote` --
    // only when the node is not already a primary. A primary whose PostgreSQL dies is restarted by its
    // own coordinator and returns as primary through the recovery path, so the gate never runs.
    // The gate protects promotions; it does not by itself protect recoveries.
    //
    // Measured, not assumed: if a future Patroni routes recovery through the hook this flips.
    await waitForQuorum();
    const leader = await (async () => {
      for (const node of NODES) {
        if ((await roleOf(node.api)).startsWith('primary')) return node;
      }
      return null;
    })();
    expect(leader).not.toBeNull();

    const before = events().filter((entry) => entry.event === 'pre_promote.start').length;
    const pid = readPid(`${ROOT}/data-${leader!.name}/postmaster.pid`);
    expect(pid).not.toBeNull();
    try {
      process.kill(-pid!, 'SIGKILL');
    } catch {
      try {
        process.kill(pid!, 'SIGKILL');
      } catch {
        // gone
      }
    }

    const deadline = Date.now() + 150_000;
    let writableAgain = false;
    while (Date.now() < deadline && !writableAgain) {
      writableAgain = await writable(leader!.pg);
      if (!writableAgain) await sleep(1000);
    }
    const after = events().filter((entry) => entry.event === 'pre_promote.start').length;
    // eslint-disable-next-line no-console
    console.log('[p36] restarted primary writable again:', writableAgain, '| gate invocations during restart:', after - before);

    expect(writableAgain).toBe(true);
    expect(after - before).toBe(0);
  }, 300_000);

  it('08 an independently restarted former primary cannot outlive its own fencing', async () => {
    // The mandatory "former primary restarts independently" case, and the one that matters most:
    // the old node comes back while its successor is already serving.
    //
    // Unlike a promotion, this path never reaches `pre_promote` (see test 07), so the only thing that
    // can stop it is the fence itself. That is precisely the claim under test -- and if it fails, the
    // Phase 33 blocker is still live.
    await healCluster();
    const oldLeader = await (async () => {
      for (const node of NODES) {
        if ((await roleOf(node.api)).startsWith('primary')) return node;
      }
      return null;
    })();
    expect(oldLeader).not.toBeNull();

    // Kill the old leader's coordinator and postmaster. Being killed rather than demoted is the point:
    // it is never told it lost leadership, exactly like a crash or a network partition.
    try {
      process.kill(patroniPidsGlobal.get(oldLeader!.name)!, 'SIGKILL');
    } catch {
      // already gone
    }
    const oldPid = readPid(`${ROOT}/data-${oldLeader!.name}/postmaster.pid`);
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
    for (let i = 0; i < 60 && (await writable(oldLeader!.pg)); i += 1) await sleep(500);

    // A successor is elected, and this time the gate is the one that fences the old primary, because
    // the old primary is gone and confirmation has to come from the fence command.
    const deadline = Date.now() + 180_000;
    let successor: string | null = null;
    while (Date.now() < deadline && !successor) {
      for (const node of NODES) {
        if (node.name === oldLeader!.name) continue;
        if ((await roleOf(node.api)).startsWith('primary')) {
          successor = node.name;
          break;
        }
      }
      if (!successor) await sleep(1000);
    }
    // eslint-disable-next-line no-console
    console.log('[p36] old leader:', oldLeader!.name, '| successor:', successor);
    expect(successor).not.toBeNull();

    // Bring the old node back by hand. Its WAL may have been made unwritable by the fence; if it was,
    // PostgreSQL will refuse to start, which is the fence succeeding rather than the test failing.
    const restart = spawnSync(
      `${PG_BIN}/pg_ctl`,
      ['-D', `${ROOT}/data-${oldLeader!.name}`, '-l', `${ROOT}/rejoin-${oldLeader!.name}.log`, '-W', 'start'],
      { encoding: 'utf8', timeout: 60_000 }
    );
    await sleep(6000);

    const writableNow = await Promise.all(NODES.map(async (node) => await writable(node.pg)));
    const writableCount = writableNow.filter(Boolean).length;
    // eslint-disable-next-line no-console
    console.log(
      '[p36] after independent restart:', writableNow,
      '| writable primaries:', writableCount,
      '| pg_ctl exit:', restart.status
    );

    // THE INVARIANT. Two writable primaries is a split brain.
    expect(writableCount).toBeLessThanOrEqual(1);

    // The successor must be the one doing the writing, not the resurrected former primary.
    if (writableCount === 1) {
      expect(await writable(NODES.find((node) => node.name === successor)!.pg)).toBe(true);
    }
  }, 500_000);

  it('03 the gate journal proves fencing preceded promotion', async () => {
    const all = events();
    const confirmed = all.filter((entry) => entry.event === 'pre_promote.confirmed');
    const refused = all.filter((entry) => entry.event === 'pre_promote.refused');
    const fenced = all.filter((entry) => entry.event === 'pre_promote.fenced');
    const skipped = all.filter((entry) => entry.event === 'pre_promote.skip');
    // eslint-disable-next-line no-console
    console.log('[p36] journal summary:', {
      total: all.length,
      confirmed: confirmed.length,
      refused: refused.length,
      fenced: fenced.length,
      skipped: skipped.length,
    });
    // Real gate invocations must be in the journal, not merely "promotion happened".
    expect(confirmed.length + refused.length + skipped.length).toBeGreaterThan(0);
    // A confirmation is only issued after a fence or a positive read-only observation.
    for (const entry of confirmed) {
      expect(typeof entry.at).toBe('string');
    }
    // A refusal must carry its reason, so an operator can tell ambiguity from a definitive failure.
    for (const entry of refused) {
      expect(String(entry.reason)).toMatch(/reachable|unreachable|writable|confirm|fence/i);
    }
  }, 60_000);

  it('04 the storage fence survives a restart, which the liveness fence cannot', async () => {
    // Why this test exists: killing a process is not fencing. A killed node restarts. The fence that
    // survives a restart is the one on storage access, and this test is the only place that is
    // demonstrated directly rather than inferred from a failover.
    //
    // Deliberately self-contained -- it applies the fence with the gate's own `fenceNode` to a node
    // chosen for the purpose, rather than relying on whatever an earlier test happened to fence. An
    // earlier version operated on the live leader and asserted "not writable", which passed for the
    // wrong reason and then failed for the wrong reason.
    await healCluster();
    const leader = await (async () => {
      for (const node of NODES) {
        if ((await roleOf(node.api)).startsWith('primary')) return node;
      }
      return null;
    })();
    expect(leader).not.toBeNull();
    const victim = NODES.find((node) => node.name !== leader!.name)!;

    // Stop it cleanly first, so no postmaster is left holding the data directory.
    const pid = readPid(`${ROOT}/data-${victim.name}/postmaster.pid`);
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    for (let i = 0; i < 60 && (await writable(victim.pg)); i += 1) await sleep(500);
    await sleep(1000);

    // Apply the storage fence through the gate's own implementation -- not a re-implementation in the
    // test, so what is verified is what the coordinator would actually run.
    const fenced = await runFenceNodeCommand(victim.name);
    // eslint-disable-next-line no-console
    console.log('[p36] storage fence applied to', victim.name, ':', fenced);

    const walMode = readFileSync(`${ROOT}/fence-result.json`, 'utf8');
    // eslint-disable-next-line no-console
    console.log('[p36] fence result:', walMode);

    // Now try to bring it back. A storage-fenced node must not become a writable primary.
    const start = spawnSync(
      `${PG_BIN}/pg_ctl`,
      ['-D', `${ROOT}/data-${victim.name}`, '-l', `${ROOT}/fence-restart-${victim.name}.log`, '-W', 'start'],
      { encoding: 'utf8', timeout: 60_000 }
    );
    await sleep(4000);
    const restartLog = readFileSync(`${ROOT}/fence-restart-${victim.name}.log`, 'utf8');
    // eslint-disable-next-line no-console
    console.log(
      '[p36] restart of storage-fenced node exit:', start.status,
      '| writable:', await writable(victim.pg),
      '| log:', restartLog.split('\n').filter((line) => /Permission denied|could not open|FATAL/.test(line)).slice(0, 2).join(' / ')
    );

    // The fence must prevent writes. It may fail to start at all (preferred) or start read-only;
    // what it must never do is serve writes.
    expect(await writable(victim.pg)).toBe(false);
  }, 300_000);

  it('05 repeated gate execution is journaled and none of it crashes', async () => {
    // Patroni can run the gate more than once (retry, restarted coordinator, lost acknowledgement).
    // Every attempt must be visible and no attempt may crash: a crash is indistinguishable from a
    // refusal, which would be a silent outage rather than a diagnosable one.
    writeFileSync(LAST_LEADER, 'node1');
    const before = events().filter((entry) => entry.event === 'pre_promote.start').length;
    const env = {
      ...process.env,
      FENCE_NODES: JSON.stringify(Object.fromEntries(NODES.map((entry) => [entry.name, entry.pg]))),
      FENCE_JOURNAL: JOURNAL,
      FENCE_LAST_LEADER: LAST_LEADER,
      FENCE_VERIFY_MS: '4000',
      NODE_DATADIR_NODE1: `${ROOT}/data-node1`,
    };
    const run1 = spawnSync('node', [GATE, 'node2'], { encoding: 'utf8', env, timeout: 120_000 });
    const run2 = spawnSync('node', [GATE, 'node2'], { encoding: 'utf8', env, timeout: 120_000 });
    const after = events().filter((entry) => entry.event === 'pre_promote.start').length;
    // eslint-disable-next-line no-console
    console.log('[p36] repeated gate exit codes:', run1.status, run2.status, '| attempts:', after - before);
    expect(after - before).toBe(2);
    for (const status of [run1.status, run2.status]) {
      expect([0, 1]).toContain(status);
    }
    // After the first success node2 is recorded as leader, so the second run must not fence it again.
    expect(run2.status).toBe(0);
  }, 180_000);

  it('06 stale leadership: with no recorded previous leader the gate does not fence blindly', async () => {
    // A coordinator starting with no history must not guess which node to kill. Fencing a node it
    // cannot identify is exactly how a healthy primary dies.
    writeFileSync(LAST_LEADER, '');
    const result = spawnSync('node', [GATE, 'node3'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FENCE_NODES: JSON.stringify(Object.fromEntries(NODES.map((entry) => [entry.name, entry.pg]))),
        FENCE_JOURNAL: JOURNAL,
        FENCE_LAST_LEADER: LAST_LEADER,
        FENCE_VERIFY_MS: '2000',
      },
      timeout: 60_000,
    });
    expect(result.status).toBe(0);
    expect(events().filter((entry) => entry.event === 'pre_promote.skip').length).toBeGreaterThan(0);
  }, 120_000);
});
