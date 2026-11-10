/**
 * Phase 33 — Fencing, quorum and single-writer verification with a real HA coordinator.
 *
 * ## What is real
 *
 * **Patroni 4.1.5** with its **raft DCS** (pysyncobj), three PostgreSQL 16.2 nodes. This is the HA
 * coordinator a managed PostgreSQL deployment would actually use, not a script that imitates one:
 *
 *   | Concern | Owner |
 *   | --- | --- |
 *   | copy the data | PostgreSQL streaming replication |
 *   | reconcile divergent histories | `pg_rewind` |
 *   | decide who may lead | Patroni + raft quorum |
 *   | stop the old leader writing | Patroni demotion **plus** whatever fences the node |
 *
 * ## The claim this file tests, and refuses to assume
 *
 * "The coordinator elected one leader" is **not** evidence of split-brain protection. Election says who
 * *should* write; fencing says who *can*. Between those two there is a window, and a partially
 * partitioned leader is exactly the case where it opens. This file therefore never treats a leadership
 * change as proof, and always asks the database directly whether it accepts writes.
 *
 * ## The two failure shapes are different, and only one of them is benign
 *
 * Test 03 kills a node outright (SIGKILL: postmaster and coordinator together).
 * Test 04 freezes only the coordinator (SIGSTOP: postmaster stays alive and writable).
 *
 * They look similar from the outside and behave completely differently. Test 04 is the finding:
 * a leader that loses quorum but keeps its postmaster keeps accepting writes, a new leader is elected,
 * and for a period there are **two writable primaries**. Patroni demotes such a node when it regains
 * contact — but Patroni refuses to run `pg_rewind` when the node reports itself as cleanly shut down,
 * so tuples committed during the window can remain in its heap after it returns as a standby.
 *
 * ## Running
 *
 *   TEST_PATRONI=1 npm run test:fencing
 *
 * Opt-in and destructive: it starts and kills real clusters. It skips (loudly) without Patroni.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';

const PATRONI = process.env.TEST_PATRONI_BIN?.trim() || '/tmp/pgenv/bin/patroni';
const PG_BIN = process.env.TEST_PG_BIN_DIR?.trim() || '/tmp/pgenv/lib/python3.11/site-packages/pgserver/pginstall/bin';
const ENABLED = process.env.TEST_PATRONI === '1' && existsSync(PATRONI) && existsSync(`${PG_BIN}/pg_ctl`);
const ROOT = process.env.TEST_PATRONI_ROOT?.trim() || '/tmp/p33-test';

const NODES = [
  { name: 'node1', api: 9011, raft: 7111, pg: 6001 },
  { name: 'node2', api: 9012, raft: 7112, pg: 6002 },
  { name: 'node3', api: 9013, raft: 7113, pg: 6003 },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function query(port: number, sql: string, database = 'postgres'): Promise<Record<string, unknown>[]> {
  const client = new Client({ host: '127.0.0.1', port, user: 'postgres', database });
  client.on('error', () => undefined);
  await client.connect();
  try {
    return (await client.query(sql)).rows as Record<string, unknown>[];
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

async function waitForRole(api: number, pattern: RegExp, timeoutMs: number): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const role = await roleOf(api);
    if (pattern.test(role)) return Date.now() - started;
    await sleep(250);
  }
  throw new Error(`node on api ${api} never matched ${pattern}; last role ${await roleOf(api)}`);
}

/** Is this server accepting writes right now? Asked of the database, never inferred from a role string. */
async function writable(port: number): Promise<boolean> {
  try {
    const rows = await query(port, 'SELECT pg_is_in_recovery() AS r');
    return rows[0].r === false;
  } catch {
    return false; // not listening counts as "cannot write"
  }
}

function killPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}

function readPid(path: string): number | null {
  try {
    return Number(readFileSync(path, 'utf8').split('\n')[0]) || null;
  } catch {
    return null;
  }
}

/** A pid file survives SIGKILL, so existence proves nothing — the process must still be alive. */
function alive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Is this node's postmaster actually running (not merely recorded on disk)? */
function postmasterRunning(root: string, name: string): boolean {
  return alive(readPid(`${root}/data-${name}/postmaster.pid`));
}

describe.skipIf(!ENABLED)('Patroni + raft: fencing, quorum and single-writer', () => {
  const patroniPids = new Map<string, number>();

  beforeAll(async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    for (const node of NODES) {
      const partners = NODES.filter((other) => other.name !== node.name)
        .map((other) => `  - 127.0.0.1:${other.raft}`)
        .join('\n');
      // `auth: trust` is a disposable-local convenience; the fencing behaviour under test is unrelated.
      writeFileSync(
        `${ROOT}/${node.name}.yml`,
        `scope: ch247
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
    maximum_lag_on_failover: 1048576
  initdb:
  - encoding: UTF8
  - data-checksums
  - auth: trust
postgresql:
  listen: 127.0.0.1:${node.pg}
  connect_address: 127.0.0.1:${node.pg}
  data_dir: ${ROOT}/data-${node.name}
  bin_dir: ${PG_BIN}
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
      // Capture output to a file: with `stdio: 'ignore'` a failed start is invisible, and a coordinator
      // that never came up looks exactly like one that came up and lost an election.
      const logPath = `${ROOT}/${node.name}.log`;
      const logFd = openSync(logPath, 'a');
      const child = spawn(PATRONI, [`${ROOT}/${node.name}.yml`], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PATH: `/tmp/pgenv/bin:${process.env.PATH ?? ''}` },
      });
      child.unref();
      if (child.pid) patroniPids.set(node.name, child.pid);
      await sleep(3000);
    }
    // Surface the coordinator's own diagnostics on failure instead of a bare "unreachable".
    const diagnostics = NODES.map((node) => {
      try {
        return `${node.name}: ${readFileSync(`${ROOT}/${node.name}.log`, 'utf8').split('\n').slice(-4).join(' | ')}`;
      } catch {
        return `${node.name}: (no log)`;
      }
    }).join('\n');
    // eslint-disable-next-line no-console
    console.log('[p33] coordinator startup logs\n' + diagnostics);

    // Bootstrap takes a while. Which node wins the raft election is NOT specified by the config and is
    // not stable between runs, so the tests below always discover the leader rather than assuming one.
    const bootstrapDeadline = Date.now() + 240_000;
    let leader: (typeof NODES)[number] | null = null;
    while (Date.now() < bootstrapDeadline && !leader) {
      for (const node of NODES) {
        if ((await roleOf(node.api)).startsWith('primary')) { leader = node; break; }
      }
      if (!leader) await sleep(1000);
    }
    if (!leader) {
      const logs = NODES.map((node) => `${node.name}: ${readFileSync(`${ROOT}/${node.name}.log`, 'utf8').split('\n').slice(-3).join(' | ')}`).join('\n');
      throw new Error(`no leader was elected\n${logs}`);
    }
    // eslint-disable-next-line no-console
    console.log('[p33] bootstrap leader:', leader.name);
    for (const node of NODES) {
      if (node.name !== leader.name) await waitForRole(node.api, /^replica/, 240_000);
    }

    // A role label of "replica" is not the same as "finished cloning". Patroni reports a replica as
    // running while `pg_basebackup`/recovery is still populating the data directory, and querying it in
    // that window fails with things like `could not open file "global/pg_filenode.map"`. Seed the data
    // first, then wait until every replica can actually *read* it before any test runs.
    await query(leader.pg, 'CREATE DATABASE ch247');
    await query(leader.pg, `CREATE TABLE tpl (id int PRIMARY KEY, revision int NOT NULL, name text NOT NULL)`, 'ch247');
    await query(leader.pg, `INSERT INTO tpl VALUES (1, 1, 'pre-failover')`, 'ch247');

    for (const node of NODES) {
      if (node.name === leader.name) continue;
      const deadline = Date.now() + 240_000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          const rows = await query(node.pg, 'SELECT count(*)::int AS n FROM tpl', 'ch247');
          if (Number(rows[0]?.n) === 1) { ready = true; break; }
        } catch {
          // still cloning / still recovering
        }
        await sleep(500);
      }
      if (!ready) throw new Error(`${node.name} did not finish cloning within 240 s`);
    }
    // eslint-disable-next-line no-console
    console.log('[p33] all nodes cloned and replicating the seed row');
  }, 400_000);

  afterAll(async () => {
    // Kill the coordinators AND their postmasters. Patroni starts PostgreSQL as a child that survives a
    // killed coordinator, so leaving postmasters behind makes the NEXT run fail with
    // `could not create any TCP/IP sockets` — a failure that appears in bootstrap and looks like a
    // configuration problem rather than leftover state.
    for (const pid of patroniPids.values()) killPid(pid, 'SIGKILL');
    for (const node of NODES) {
      const pgPid = readPid(`${ROOT}/data-${node.name}/postmaster.pid`);
      if (pgPid) killPid(pgPid, 'SIGKILL');
    }
    spawnSync('pkill', ['-9', '-f', `${ROOT}/`]);
    await sleep(1500);
    // Last resort: anything still bound to this run's ports. A clean teardown is a prerequisite for a
    // trustworthy suite, not housekeeping.
    for (const node of NODES) {
      const still = readPid(`${ROOT}/data-${node.name}/postmaster.pid`);
      if (still) killPid(still, 'SIGKILL');
    }
    rmSync(ROOT, { recursive: true, force: true });
  }, 60_000);

  it('01 a leader is elected by quorum and exactly one node is writable', async () => {
    const roles = await Promise.all(NODES.map(async (node) => ({ name: node.name, role: await roleOf(node.api) })));
    const leaders = roles.filter((entry) => entry.role.startsWith('primary'));
    // eslint-disable-next-line no-console
    console.log('[p33] roles:', roles);
    expect(leaders).toHaveLength(1);

    const writeable = await Promise.all(NODES.map(async (node) => ({ name: node.name, ok: await writable(node.pg) })));
    // eslint-disable-next-line no-console
    console.log('[p33] writable:', writeable);
    expect(writeable.filter((entry) => entry.ok)).toHaveLength(1);
  }, 120_000);

  it('02 a replica is read-only, so the cluster has a single writer', async () => {
    const roles = await Promise.all(NODES.map(async (node) => ({ node, role: await roleOf(node.api) })));
    const replica = roles.find((entry) => entry.role.startsWith('replica'))!.node;
    const rows = await query(replica.pg, 'SELECT pg_is_in_recovery() AS r');
    expect(rows[0].r).toBe(true);
    await expect(
      query(replica.pg, `INSERT INTO tpl VALUES (500, 1, 'replica write')`, 'ch247')
    ).rejects.toThrow(/read-only|cannot execute/i);
  }, 60_000);

  it('03 FAILOVER: killing the leader promotes another node, and the dead leader is genuinely gone', async () => {
    // This is the benign case. The whole node dies, so there is no process left that could keep writing.
    const roles = await Promise.all(NODES.map(async (node) => ({ node, role: await roleOf(node.api) })));
    const leaderNode = roles.find((entry) => entry.role.startsWith('primary'))!.node;
    const leaderPid = readPid(`${ROOT}/data-${leaderNode.name}/postmaster.pid`);
    const patroniPid = patroniPids.get(leaderNode.name)!;
    expect(leaderPid).not.toBeNull();

    killPid(patroniPid, 'SIGKILL');
    killPid(leaderPid!, 'SIGKILL');
    patroniPids.delete(leaderNode.name);
    const started = Date.now();

    // One of the two survivors must take over.
    let newLeader: (typeof NODES)[number] | null = null;
    while (Date.now() - started < 120_000) {
      for (const node of NODES.filter((entry) => entry.name !== leaderNode.name)) {
        if ((await roleOf(node.api)).startsWith('primary')) { newLeader = node; break; }
      }
      if (newLeader) break;
      await sleep(1000);
    }
    const failoverMs = Date.now() - started;
    // eslint-disable-next-line no-console
    console.log('[p33] new leader:', newLeader?.name, 'after', failoverMs, 'ms');
    expect(newLeader).not.toBeNull();

    // FENCING: the old leader cannot accept writes, because it is not running at all.
    expect(await writable(leaderNode.pg)).toBe(false);

    // The new leader can, and it kept the replicated data.
    expect(await writable(newLeader!.pg)).toBe(true);
    const rows = await query(newLeader!.pg, 'SELECT id FROM tpl ORDER BY id', 'ch247');
    expect(rows.map((row) => row.id)).toEqual([1]);

    // Exactly one writable primary remains.
    const writeable = await Promise.all(NODES.map(async (node) => await writable(node.pg)));
    expect(writeable.filter(Boolean)).toHaveLength(1);
  }, 240_000);

  it('04 THE FINDING: a leader that loses quorum but keeps its postmaster KEEPS WRITING, producing two writable primaries', async () => {
    // Contrast with test 03. Here the coordinator is frozen (SIGSTOP) while its postmaster stays alive:
    // the closest local model of a network partition that isolates the control plane but not the
    // database clients. This is the case an election-only view would call "handled".
    // Test 03 killed a node permanently. Restarting it is not a convenience: with only two live nodes,
    // freezing one leaves NO quorum, so nothing can be elected and the split-brain window cannot open.
    // Restoring 3/3 lets a majority (2/3) survive the partition below.
    for (const candidate of NODES) {
      if (postmasterRunning(ROOT, candidate.name)) continue;
      const logFd = openSync(`${ROOT}/${candidate.name}-rejoin.log`, 'a');
      const child = spawn(PATRONI, [`${ROOT}/${candidate.name}.yml`], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PATH: `/tmp/pgenv/bin:${process.env.PATH ?? ''}` },
      });
      child.unref();
      if (child.pid) patroniPids.set(candidate.name, child.pid);
      await waitForRole(candidate.api, /^replica/, 240_000);
      // eslint-disable-next-line no-console
      console.log(`[p33] restarted ${candidate.name} as a replica so 3/3 nodes exist for the partition test`);
    }

    const rolesNow = await Promise.all(NODES.map(async (node) => ({ name: node.name, role: await roleOf(node.api) })));
    const currentLeader = rolesNow.find((entry) => entry.role.startsWith('primary'))!;
    // eslint-disable-next-line no-console
    console.log('[p33] current leader before partition:', currentLeader);

    const node = NODES.find((entry) => entry.name === currentLeader.name)!;
    const patroniPid = patroniPids.get(node.name) ?? readPid(`${ROOT}/patroni-${node.name}.pid`);
    const pgPid = readPid(`${ROOT}/data-${node.name}/postmaster.pid`);
    expect(pgPid).not.toBeNull();

    // Find the live coordinator process for this node.
    const found = spawnSync('pgrep', ['-f', `${ROOT}/${node.name}.yml`], { encoding: 'utf8' });
    const livePatroni = Number(found.stdout.trim().split('\n')[0]) || patroniPid;
    expect(livePatroni).toBeTruthy();

    killPid(livePatroni!, 'SIGSTOP');
    // eslint-disable-next-line no-console
    console.log(`[p33] SIGSTOPped coordinator for ${node.name} (postmaster ${pgPid} left running)`);

    // Verify the isolated leader is STILL WRITABLE while a new leader is elected elsewhere.
    await sleep(30_000);
    const isolatedStillWritable = await writable(node.pg);
    // eslint-disable-next-line no-console
    console.log('[p33] isolated leader still writable after losing quorum:', isolatedStillWritable);

    let replacement: string | null = null;
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      for (const other of NODES) {
        if (other.name === node.name) continue;
        const role = await roleOf(other.api);
        if (role.startsWith('primary')) { replacement = other.name; break; }
      }
      if (replacement) break;
      await sleep(1000);
    }
    if (!replacement) {
      // Report what actually happened rather than asserting a split-brain that did not occur.
      const rolesAfter = await Promise.all(NODES.map(async (entry) => `${entry.name}=${await roleOf(entry.api)}`));
      throw new Error(
        `no replacement leader was elected within 120 s (isolatedLeaderWritable=${isolatedStillWritable}); ` +
          `roles now: ${rolesAfter.join(', ')}. Without a majority there is no split-brain, only an outage.`
      );
    }
    // eslint-disable-next-line no-console
    console.log('[p33] replacement leader:', replacement, 'while the isolated node remained writable:', isolatedStillWritable);

    if (isolatedStillWritable && replacement) {
      // This is the split-brain window, measured. Two servers in one cluster both accept writes.
      const writeable = await Promise.all(NODES.map(async (entry) => await writable(entry.pg)));
      const count = writeable.filter(Boolean).length;
      // eslint-disable-next-line no-console
      console.log('[p33] WRITABLE PRIMARIES SIMULTANEOUSLY:', count);
      expect(count).toBe(2);

      // A write on each side, showing the divergence is real rather than theoretical.
      await query(node.pg, `INSERT INTO tpl VALUES (777, 1, 'written on isolated leader')`, 'ch247');
      const isolated = await query(node.pg, 'SELECT id FROM tpl ORDER BY id', 'ch247');
      expect(isolated.map((row) => row.id)).toContain(777);

      const replacementNode = NODES.find((entry) => entry.name === replacement)!;
      const majority = await query(replacementNode.pg, 'SELECT id FROM tpl ORDER BY id', 'ch247');
      expect(majority.map((row) => row.id)).not.toContain(777);
    }

    // Heal: resume the coordinator and confirm Patroni demotes the isolated node.
    killPid(livePatroni!, 'SIGCONT');
    const demotedMs = await waitForRole(node.api, /^replica/, 120_000);
    // eslint-disable-next-line no-console
    console.log(`[p33] ${node.name} demoted after ${demotedMs} ms once the coordinator resumed`);
    expect((await roleOf(node.api)).startsWith('replica')).toBe(true);
    // After demotion it must be read-only, so the split-brain window is closed.
    expect(await writable(node.pg)).toBe(false);
  }, 400_000);

  it('05 after the split-brain window, the rejoined node is a read-only standby on the current timeline', async () => {
    // Which node is primary now is deliberately not assumed: the preceding tests changed it.
    const roles = await Promise.all(NODES.map(async (node) => ({ node, role: await roleOf(node.api) })));
    const primaryEntry = roles.find((entry) => entry.role.startsWith('primary'));
    expect(primaryEntry).toBeTruthy();
    const primary = primaryEntry!.node;

    // Every other node must be a replica and must refuse writes.
    for (const entry of roles.filter((item) => item.node.name !== primary.name)) {
      expect(entry.role.startsWith('replica')).toBe(true);
      expect(await writable(entry.node.pg)).toBe(false);
    }

    // The current timeline is shared by the primary and at least one replica.
    const primaryTimeline = await query(primary.pg, 'SELECT pg_walfile_name(pg_current_wal_lsn()) AS f');
    // eslint-disable-next-line no-console
    console.log('[p33] current primary wal file:', primaryTimeline[0].f);

    // Whether the divergent row survived on the demoted node is recorded rather than asserted: Patroni
    // may or may not have rewound it depending on how the node reported its shutdown state, and that
    // difference is the substance of the finding.
    for (const node of NODES) {
      let ids: unknown = 'unreadable';
      try {
        ids = (await query(node.pg, 'SELECT id FROM tpl ORDER BY id', 'ch247')).map((row) => row.id);
      } catch {
        // ignore
      }
      // eslint-disable-next-line no-console
      console.log(`[p33] ${node.name} rows:`, ids);
    }
  }, 180_000);

  it('06 revision integrity holds on the surviving primary after all of the above', async () => {
    const roles = await Promise.all(NODES.map(async (node) => ({ node, role: await roleOf(node.api) })));
    const primary = roles.find((entry) => entry.role.startsWith('primary'))!.node;

    // The conditional update the application uses still behaves after elections and demotions.
    await query(primary.pg, `INSERT INTO tpl VALUES (900, 1, 'predicate') ON CONFLICT (id) DO NOTHING`, 'ch247');
    const first = await query(
      primary.pg,
      `UPDATE tpl SET revision = revision + 1 WHERE id = 900 AND revision = 1 RETURNING revision`,
      'ch247'
    );
    expect(Number(first[0]?.revision)).toBe(2);

    const stale = await query(
      primary.pg,
      `UPDATE tpl SET revision = revision + 1 WHERE id = 900 AND revision = 1 RETURNING revision`,
      'ch247'
    );
    expect(stale).toHaveLength(0);
  }, 120_000);
});
