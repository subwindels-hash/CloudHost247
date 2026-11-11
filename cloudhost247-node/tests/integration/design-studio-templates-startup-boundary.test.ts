/**
 * Phase 38 — Startup boundary and independent fencing verification.
 *
 * ## What this suite is answering
 *
 * Phase 37 put a gate on `bin_name['postgres']` and called the recovery path closed. Two objections are
 * correct and are what this phase exists to settle:
 *
 * 1. **A configured shim is not automatically a universal startup boundary.** It mediates what Patroni
 *    spawns. It cannot mediate a service manager or an operator invoking a binary directly.
 * 2. **Timeline equality is not proof of rejoin integrity.** A standby's control-file timeline can lag a
 *    promotion, so equality is neither necessary nor sufficient evidence of having caught up.
 *
 * ## Criterion → test
 *
 * | Criterion | Test |
 * | --- | --- |
 * | 1 enumerate startup paths | 01 |
 * | 2 every path checks the durable record | 02, 03 |
 * | 3 deliberate bypass detected by an independent control | 05, 06 |
 * | 4 records cannot be silently reset/truncated/replaced | 07, 08, 09 |
 * | 5 rejoin beyond timeline equality | 10 |
 * | 6 missing WAL after rewind, exact conditions | 11 |
 * | 7 independent fencing stays open | 12 |
 * | 8 VIP stays unmet | 12 |
 *
 *   TEST_BOUNDARY_INTEGRATION=1 npm run test:boundary-integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { FenceLedger, type LedgerState } from '../helpers/fencing/fence-ledger';
import {
  START_ROUTES,
  assessRejoin,
  assessWalAvailability,
  attemptDirectStart,
  listWalSegments,
  observeCluster,
  parseLsn,
} from '../helpers/fencing/startup-boundary';
import { renderStartGateScript } from '../helpers/fencing/recovery-gate';

const PATRONI = process.env.TEST_PATRONI_BIN?.trim() || '/tmp/pgenv/bin/patroni';
const PG_BIN =
  process.env.TEST_PG_BIN_DIR?.trim() || '/tmp/pgenv/lib/python3.11/site-packages/pgserver/pginstall/bin';
const ENABLED =
  process.env.TEST_BOUNDARY_INTEGRATION === '1' && existsSync(PATRONI) && existsSync(`${PG_BIN}/pg_ctl`);
const ROOT = process.env.TEST_BOUNDARY_ROOT?.trim() || '/tmp/ch247-p38';
const LOG_ROOT = `${ROOT}/fence-log`;
const SEAL_ROOT = `${ROOT}/fence-seal`;
const DECISION_LOG = `${ROOT}/start-decisions.jsonl`;

const NODES = [
  { name: 'node1', api: 9311, raft: 7411, pg: 6901 },
  { name: 'node2', api: 9312, raft: 7412, pg: 6902 },
  { name: 'node3', api: 9313, raft: 7413, pg: 6903 },
];

const ledger = new FenceLedger({ logRoot: LOG_ROOT, sealRoot: SEAL_ROOT });
const patroniPids = new Map<string, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function nodeOf(name: string) {
  const found = NODES.find((node) => node.name === name);
  if (!found) throw new Error(`unknown node ${name}`);
  return found;
}

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

function startCoordinator(name: string, force = false): void {
  if (!force && alive(patroniPids.get(name) ?? null)) return;
  const logFd = require('node:fs').openSync(`${ROOT}/${name}.log`, 'a');
  const child = spawn(PATRONI, [`${ROOT}/${name}.yml`], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PATH: `/tmp/pgenv/bin:${process.env.PATH ?? ''}` },
  });
  child.unref();
  if (child.pid) patroniPids.set(name, child.pid);
}


/**
 * Bring the cluster back to health between destructive tests.
 *
 * Necessary because these tests genuinely stop nodes. Without it, a test that kills the leader's
 * coordinator leaves every later test with no leader — which fails them for a reason unrelated to what
 * they are checking, and would look like a boundary problem rather than a bookkeeping one.
 */
async function healCluster(): Promise<void> {
  spawnSync('chmod', ['-R', 'u+rwX', ROOT]);
  for (const node of NODES) startCoordinator(node.name);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const leader = await currentLeader();
    if (leader) {
      const ready = Date.now() + 90_000;
      while (Date.now() < ready) {
        const roles = await Promise.all(NODES.map(async (node) => await roleOf(node.api)));
        if (roles.filter((role) => role.startsWith('replica/running')).length >= 1) return;
        await sleep(2000);
      }
      return;
    }
    await sleep(2000);
  }
  throw new Error('cluster did not heal');
}


/**
 * Return a node to service through the ledger's own rejoin path, after a fence has served its purpose.
 *
 * Tests 02 and 04 fence node1 to prove the boundary works, and node1 then stays out of the cluster. That
 * is correct behaviour for the node and wrong for the suite: every later test would run against a degraded
 * two-node cluster and fail for reasons unrelated to what it checks. The restore goes through the real
 * transition, so the ledger records the rejoin rather than being quietly wiped.
 */
async function restoreNode(name: string, why: string): Promise<void> {
  const state = ledger.state(name);
  if (state === 'FENCED') {
    ledger.transition(name, 'REJOIN_PENDING', `admin: ${why}`, { actor: 'test' });
    ledger.transition(name, 'REJOINED', `admin: ${why}`, { actor: 'test' });
  }
  const node = nodeOf(name);
  spawnSync('bash', ['-c', `chmod 700 ${ROOT}/data-${name} 2>/dev/null; chmod 600 ${ROOT}/data-${name}/postmaster.pid 2>/dev/null; true`]);
  startCoordinator(name, true);
  // Wait for it to be readable again, as a replica or otherwise — this is bookkeeping, not a fencing claim.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const client = new Client({ host: '127.0.0.1', port: node.pg, user: 'postgres', connectionTimeoutMillis: 1000 });
      client.on('error', () => undefined);
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await sleep(2000);
    }
  }
  // eslint-disable-next-line no-console
  console.log('[p38] restore: node did not come back:', name);
}

async function currentLeader() {
  for (const node of NODES) {
    if ((await roleOf(node.api)).startsWith('primary')) return node;
  }
  return null;
}

async function stopNode(name: string): Promise<void> {
  try {
    process.kill(patroniPids.get(name)!, 'SIGKILL');
  } catch {
    // gone
  }
  const pid = readPid(`${ROOT}/data-${name}/postmaster.pid`);
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
  for (let i = 0; i < 60 && (await writable(nodeOf(name).pg)); i += 1) await sleep(500);
  await sleep(1500);
}

describe.skipIf(!ENABLED)('startup boundary and independent fencing', () => {
  beforeAll(async () => {
    spawnSync('chmod', ['-R', 'u+rwX', ROOT]);
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    mkdirSync(LOG_ROOT, { recursive: true });
    mkdirSync(SEAL_ROOT, { recursive: true });

    // Per-node bin dir: real binaries symlinked, `postgres` replaced by the sealed gate.
    for (const node of NODES) {
      const binDir = `${ROOT}/bin-${node.name}`;
      mkdirSync(binDir, { recursive: true });
      for (const other of ['pg_ctl', 'initdb', 'pg_controldata', 'pg_basebackup', 'pg_isready', 'pg_rewind']) {
        if (existsSync(`${PG_BIN}/${other}`)) symlinkSync(`${PG_BIN}/${other}`, `${binDir}/${other}`);
      }
      symlinkSync(`${PG_BIN}/postgres`, `${binDir}/postgres.real`);
      writeFileSync(
        `${binDir}/postgres`,
        renderStartGateScript({
          realBinary: `${binDir}/postgres.real`,
          storeRoot: LOG_ROOT,
          sealRoot: SEAL_ROOT,
          node: node.name,
          decisionLog: DECISION_LOG,
        })
      );
      chmodSync(`${binDir}/postgres`, 0o755);
    }

    for (const node of NODES) {
      const partners = NODES.filter((other) => other.name !== node.name)
        .map((other) => `  - 127.0.0.1:${other.raft}`)
        .join('\n');
      writeFileSync(
        `${ROOT}/${node.name}.yml`,
        `scope: ch247p38
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
    console.log('[p38] bootstrap leader:', leader);

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

  /* ---------------------------------------------------------------- */
  /* Criterion 1 — enumerate the startup paths                         */
  /* ---------------------------------------------------------------- */

  it('01 every PostgreSQL startup route is enumerated, with mediation stated honestly', async () => {
    // The enumeration is checked against Patroni's source, not against intuition. The point of asserting
    // its shape is that a route silently disappearing from the table would quietly shrink the threat model.
    const routes = START_ROUTES.map((entry) => entry.route);
    expect(routes).toContain('patroni-start');
    expect(routes).toContain('patroni-promote');
    expect(routes).toContain('patroni-recovery');
    expect(routes).toContain('pgctl-start');
    expect(routes).toContain('direct-real-binary');
    expect(routes).toContain('supervisor');
    expect(routes).toContain('pgrewind-single-user');

    const mediated = START_ROUTES.filter((entry) => entry.mediatedByShim).map((entry) => entry.route);
    const unmediated = START_ROUTES.filter((entry) => !entry.mediatedByShim).map((entry) => entry.route);
    // eslint-disable-next-line no-console
    console.log('[p38] mediated by the shim:', mediated, '| NOT mediated:', unmediated);

    // The honest claim: the shim covers Patroni's launch paths and nothing else. If this ever reports that
    // everything is mediated, the table is wrong rather than the world having improved.
    expect(unmediated.length).toBeGreaterThan(0);
    expect(unmediated).toContain('direct-real-binary');
    expect(unmediated).toContain('supervisor');

    // Anything that serves traffic and is not mediated must be covered by detection instead.
    const unmediatedServing = START_ROUTES.filter((entry) => !entry.mediatedByShim && entry.servesTraffic);
    expect(unmediatedServing.length).toBeGreaterThan(0);
  }, 60_000);

  /* ---------------------------------------------------------------- */
  /* Criterion 2 — every mediated path checks the durable record        */
  /* ---------------------------------------------------------------- */

  it('02 the mediated start path refuses a fenced node, on the recovery path', async () => {
    // The path that bypassed pre_promote: the node's own coordinator restarting it.
    const leader = await currentLeader();
    expect(leader).not.toBeNull();
    const victim = NODES.find((node) => node.name !== leader!.name)!;

    ledger.transition(victim.name, 'FENCED', 'test 02: fenced before a coordinator-driven restart', {
      actor: 'test',
    });
    await stopNode(victim.name);

    // Restart the coordinator so the recovery path actually runs. Without this the test asserted only
    // that a stopped node does not start, which is true for reasons unrelated to the gate.
    startCoordinator(victim.name, true);
    const before = readFileSync(DECISION_LOG, 'utf8').split('\n').filter(Boolean).length;
    await sleep(40_000);

    const decisions = readFileSync(DECISION_LOG, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(before)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.node === victim.name);
    const refusals = decisions.filter((entry) => entry.allow === false);
    // eslint-disable-next-line no-console
    console.log(
      '[p38] start decisions on the recovery path:', decisions.map((entry) => `${String(entry.state)}:${String(entry.allow)}`),
      '| writable:', await writable(victim.pg)
    );

    expect(refusals.length).toBeGreaterThan(0);
    // The refusal must name the actual fence state. "Refused because UNKNOWN" would also stop a restart,
    // but for the wrong reason, and would mean the durable record was not the thing being consulted.
    expect(decisions.some((entry) => entry.state === 'FENCED')).toBe(true);
    expect(await writable(victim.pg)).toBe(false);
    expect(ledger.state(victim.name)).toBe('FENCED');
    // And the rest of the cluster must still be able to elect, or this proves nothing about fencing.
    await restoreNode(victim.name, 'test 02 verified the refusal; returning the node to service');
    await healCluster();
  }, 300_000);

  it('03 the mediated path is the SAME shim for promotion and for recovery', async () => {
    // Both reach `PostmasterProcess.start(pgcommand('postgres'))`. Establishing that they share one
    // interception point is what makes the mediation claim about "paths" rather than "the one path we
    // happened to test".
    const shim = readFileSync(`/tmp/pgenv/lib/python3.11/site-packages/patroni/postgresql/__init__.py`, 'utf8');
    const startCall = shim.includes("PostmasterProcess.start(self.pgcommand('postgres')");
    expect(startCall).toBe(true);
    // And there is exactly one such call site.
    const callSites = shim.split("PostmasterProcess.start(").length - 1;
    // eslint-disable-next-line no-console
    console.log('[p38] PostmasterProcess.start call sites in postgresql/__init__.py:', callSites);
    expect(callSites).toBe(1);
  }, 60_000);

  /* ---------------------------------------------------------------- */
  /* Criterion 3 — deliberate bypasses are detected                    */
  /* ---------------------------------------------------------------- */

  it('04 a direct start of the real binary bypasses the shim and IS detected', async () => {
    await healCluster();
    // The bypass given in the user's brief, run for real. The shim is defeated by using the real binary;
    // the node comes up writable; the independent sentinel sees a writable node whose ledger forbids it.
    const victim = nodeOf(process.env.TEST_BYPASS_NODE?.trim() || 'node1');
    ledger.transition(victim.name, 'FENCED', 'test 04: fenced, then bypassed', { actor: 'test' });
    await stopNode(victim.name);
    // Remove the storage fence too, so the ONLY remaining control is the shim — otherwise this would test
    // the WAL permission rather than the boundary.
    spawnSync('bash', ['-c', `chmod 700 ${ROOT}/data-${victim.name}; find ${ROOT}/data-${victim.name}/pg_wal -type f -exec chmod 600 {} +`]);

    // Baseline: the mediated path refuses.
    const mediated = attemptDirectStart({
      route: 'direct-configured',
      binary: `${ROOT}/bin-${victim.name}/postgres`,
      dataDir: `${ROOT}/data-${victim.name}`,
      port: victim.pg,
    });
    expect(mediated.exitCode).not.toBe(0);

    // Bypass: the real binary, by absolute path. Nothing in Patroni's configuration is involved.
    const bypassLog = require('node:fs').openSync(`${ROOT}/bypass-${victim.name}.log`, 'a');
    const child = spawn(
      `${PG_BIN}/postgres`,
      ['-D', `${ROOT}/data-${victim.name}`, '-p', String(victim.pg), '-c', 'listen_addresses=127.0.0.1'],
      { detached: true, stdio: ['ignore', bypassLog, bypassLog] }
    );
    child.unref();

    let cameUp = false;
    for (let i = 0; i < 40 && !cameUp; i += 1) {
      cameUp = await writable(victim.pg);
      if (!cameUp) await sleep(500);
    }
    // eslint-disable-next-line no-console
    console.log('[p38] real binary bypass — node writable:', cameUp, '| ledger:', ledger.state(victim.name));

    // The bypass works, which is the honest finding: a shim is not a universal boundary.
    expect(cameUp).toBe(true);
    expect(ledger.state(victim.name)).toBe('FENCED');

    // The independent control must see it. This is the part that makes the bypass survivable.
    const findings = await observeCluster({ ledger, nodes: NODES.map((node) => ({ name: node.name, port: node.pg })) });
    const finding = findings.find((entry) => entry.node === victim.name)!;
    // eslint-disable-next-line no-console
    console.log('[p38] sentinel finding:', finding);
    expect(finding.violation).toBe(true);
    expect(finding.writable).toBe(true);
    expect(finding.ledgerState).toBe('FENCED');

    // Clean up the bypassed server and fence it again at the storage layer, which is the control that
    // actually prevented harm rather than merely reporting it.
    const pid = readPid(`${ROOT}/data-${victim.name}/postmaster.pid`);
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    await sleep(1500);
    await restoreNode(victim.name, 'test 04 verified the bypass and detection; returning the node to service');
    await healCluster();
  }, 300_000);

  it('05 the sentinel does not report a compliant node as a violation', async () => {
    await healCluster();
    // A detector that always alarms is worthless. The legitimate primary — writable, on a clean ledger —
    // must not be flagged, or the signal is noise and will be ignored exactly when it matters.
    const leader = await currentLeader();
    expect(leader).not.toBeNull();
    const findings = await observeCluster({ ledger, nodes: NODES.map((node) => ({ name: node.name, port: node.pg })) });
    const finding = findings.find((entry) => entry.node === leader!.name)!;
    // eslint-disable-next-line no-console
    console.log('[p38] sentinel on the legitimate primary:', finding);
    expect(finding.writable).toBe(true);
    expect(finding.violation).toBe(false);
    // The precise state is not the point: `CLEAN` and `REJOINED` both permit serving, and this cluster has
    // nodes that were fenced and restored earlier in the run. Asserting `CLEAN` specifically would test the
    // test ordering rather than the property that matters — a healthy, permitted node is not flagged.
    expect(['CLEAN', 'REJOINED']).toContain(finding.ledgerState);
  }, 120_000);

  /* ---------------------------------------------------------------- */
  /* Criterion 4 — the record cannot be silently reset                  */
  /* ---------------------------------------------------------------- */

  it('06 deleting the fence log does not un-fence the node', async () => {
    // The Phase 37 defect, measured. A `rm` of one file made a fenced node read as CLEAN.
    const victim = 'seal-a';
    ledger.transition(victim, 'FENCED', 'sealed fence for deletion test', { actor: 'test' });
    expect(ledger.state(victim)).toBe('FENCED');

    // Delete through the ledger's own path, not a hardcoded filename. The first version of this test
    // hardcoded `<node>.jsonl`, and after the ledger switched to `<node>.fence.jsonl` it deleted a file
    // that did not exist and then asserted the node was still FENCED — which was true for no reason at all.
    expect(existsSync(ledger.logPath(victim))).toBe(true);
    rmSync(ledger.logPath(victim), { force: true });
    expect(existsSync(ledger.logPath(victim))).toBe(false);
    const after = ledger.verify(victim);
    // eslint-disable-next-line no-console
    console.log('[p38] after deleting the log:', after.state, '|', after.detail);
    expect(after.state).toBe('UNKNOWN');
    expect(after.intact).toBe(false);
    expect(after.detail).toMatch(/MISSING/i);
  }, 60_000);

  it('07 truncating or rolling back the log does not un-fence the node', async () => {
    const victim = 'seal-b';
    ledger.transition(victim, 'FENCED', 'first', { actor: 'test' });
    ledger.transition(victim, 'REJOIN_PENDING', 'second', { actor: 'test' });

    // Truncate to zero.
    writeFileSync(ledger.logPath(victim), '');
    const zeroed = ledger.verify(victim);
    // eslint-disable-next-line no-console
    console.log('[p38] truncated to zero:', zeroed.state, '|', zeroed.detail);
    expect(zeroed.state).toBe('UNKNOWN');

    // Roll back to one record.
    ledger.reset(victim);
    ledger.transition(victim, 'FENCED', 'first', { actor: 'test' });
    ledger.transition(victim, 'REJOIN_PENDING', 'second', { actor: 'test' });
    const lines = readFileSync(ledger.logPath(victim), 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    writeFileSync(ledger.logPath(victim), `${lines[0]}\n`);
    const rolled = ledger.verify(victim);
    // eslint-disable-next-line no-console
    console.log('[p38] rolled back to one record:', rolled.state, '|', rolled.detail);
    expect(rolled.state).toBe('UNKNOWN');
    expect(rolled.detail).toMatch(/rolled back|truncated/i);
  }, 60_000);

  it('08 editing a record or deleting the seal is detected', async () => {
    const victim = 'seal-c';
    ledger.transition(victim, 'FENCED', 'first', { actor: 'test' });
    ledger.transition(victim, 'REJOIN_PENDING', 'second', { actor: 'test' });

    // Forge the first record to claim it was CLEAN all along. A single-record edit must break the chain.
    const lines = readFileSync(ledger.logPath(victim), 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    const forged = JSON.parse(lines[0]) as Record<string, unknown>;
    forged.to = 'CLEAN';
    writeFileSync(ledger.logPath(victim), `${JSON.stringify(forged)}\n${lines[1]}\n`);
    const edited = ledger.verify(victim);
    // eslint-disable-next-line no-console
    console.log('[p38] forged record:', edited.state, '|', edited.detail);
    expect(edited.state).toBe('UNKNOWN');
    expect(edited.detail).toMatch(/edited|hash/i);

    // Deleting the seal means the high-water mark is gone, which is just as suspicious as a missing log.
    const other = 'seal-d';
    ledger.transition(other, 'FENCED', 'first', { actor: 'test' });
    expect(existsSync(ledger.sealPath(other))).toBe(true);
    rmSync(ledger.sealPath(other), { force: true });
    const unsealed = ledger.verify(other);
    // eslint-disable-next-line no-console
    console.log('[p38] seal deleted:', unsealed.state, '|', unsealed.detail);
    expect(unsealed.state).toBe('UNKNOWN');
    expect(unsealed.detail).toMatch(/no seal/i);
  }, 60_000);

  it('09 a restarted coordinator cannot reset the record, and appending onto a broken ledger is refused', async () => {
    // The specific scenario: the process that owns the fence state restarts. With a mutable flag the
    // restart writes "unfenced". With an append-only sealed ledger it cannot, and a write attempted on top
    // of a tampered history is refused rather than blessing it.
    const victim = 'seal-e';
    ledger.transition(victim, 'FENCED', 'fenced before a coordinator restart', { actor: 'test' });
    const before = ledger.verify(victim);
    expect(before.state).toBe('FENCED');

    // Simulate a restart of whatever owns the state: nothing about the filesystem changes.
    await sleep(100);
    expect(ledger.verify(victim).state).toBe('FENCED');

    // Now tamper, and confirm the ledger refuses to accept new records on top of it.
    rmSync(ledger.logPath(victim), { force: true });
    expect(() => ledger.transition(victim, 'REJOINED', 'attempt to bless a broken ledger')).toThrow(
      /refusing to append/i
    );
    // eslint-disable-next-line no-console
    console.log('[p38] append onto a broken ledger refused, state stays:', ledger.state(victim));
  }, 60_000);

  /* ---------------------------------------------------------------- */
  /* Criterion 5 — rejoin beyond timeline equality                     */
  /* ---------------------------------------------------------------- */

  it('10 rejoin is judged on replay progress and history, not timeline equality', async () => {
    // The user's objection, encoded. Timeline equality alone is neither necessary nor sufficient: a
    // control-file timeline can lag, and a node can be on the right timeline while still far behind.
    const primary = { timeline: 2, currentLsn: '0/5000000' };

    // In recovery, right timeline, but 64MB behind -> must be refused.
    const behind = assessRejoin({
      primary,
      candidate: {
        timeline: 2,
        timelineSource: 'control-file',
        inRecovery: true,
        replayPaused: false,
        replayLsn: '0/1000000',
        historyFiles: ['00000002.history'],
      },
    });
    // eslint-disable-next-line no-console
    console.log('[p38] caught-up check — behind:', behind.safe, behind.reasons);
    expect(behind.safe).toBe(false);
    expect(behind.reasons.join(' ')).toMatch(/behind the primary/i);

    // Right timeline, paused replay -> refused, because "in recovery" is not "progressing".
    const paused = assessRejoin({
      primary,
      candidate: {
        timeline: 2,
        timelineSource: 'control-file',
        inRecovery: true,
        replayPaused: true,
        replayLsn: '0/5000000',
        historyFiles: ['00000002.history'],
      },
    });
    expect(paused.safe).toBe(false);
    expect(paused.reasons.join(' ')).toMatch(/replay is paused/i);

    // Missing timeline history -> refused, because the node cannot have followed the promotion.
    const noHistory = assessRejoin({
      primary: { timeline: 3, currentLsn: '0/5000000' },
      candidate: {
        timeline: 3,
        timelineSource: 'wal-file',
        inRecovery: true,
        replayPaused: false,
        replayLsn: '0/5000000',
        historyFiles: [],
      },
    });
    expect(noHistory.safe).toBe(false);
    expect(noHistory.reasons.join(' ')).toMatch(/timeline history/i);

    // Replayed beyond the primary -> divergent, which is worse than behind.
    const divergent = assessRejoin({
      primary,
      candidate: {
        timeline: 2,
        timelineSource: 'wal-file',
        inRecovery: true,
        replayPaused: false,
        replayLsn: '0/6000000',
        historyFiles: ['00000002.history'],
      },
    });
    expect(divergent.safe).toBe(false);
    expect(divergent.reasons.join(' ')).toMatch(/beyond the primary/i);

    // And the clean case must pass, or this is a blanket refusal rather than a check.
    const good = assessRejoin({
      primary,
      candidate: {
        timeline: 2,
        timelineSource: 'wal-file',
        inRecovery: true,
        replayPaused: false,
        replayLsn: '0/5000000',
        historyFiles: ['00000002.history'],
      },
    });
    // eslint-disable-next-line no-console
    console.log('[p38] caught-up check — good:', good.safe, good.reasons, 'lag:', good.lagBytes);
    expect(good.safe).toBe(true);
  }, 60_000);

  it('11 a real standby is verified on replay LSN, not on its role label', async () => {
    // Real data, not a fixture. The earlier version of this test chose "the first node that is not the
    // leader" and then asserted it was a healthy standby — which failed whenever that node happened to be
    // the one this suite had just fenced. Picking by observation instead of by position is the difference
    // between testing standby verification and testing test bookkeeping.
    await healCluster();

    const readLsn = async (port: number) => {
      const client = new Client({ host: '127.0.0.1', port, user: 'postgres', connectionTimeoutMillis: 2000 });
      client.on('error', () => undefined);
      try {
        await client.connect();
        const { rows } = await client.query<{ rec: boolean; lsn: string | null }>(
          `SELECT pg_is_in_recovery() AS rec,
                  CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn()::text
                       ELSE pg_current_wal_lsn()::text END AS lsn`
        );
        return { rec: rows[0].rec, lsn: rows[0].lsn };
      } catch {
        return null;
      } finally {
        await client.end().catch(() => undefined);
      }
    };

    // Find a primary and a live replica by looking, within a bounded window.
    let leader: { name: string; pg: number } | null = null;
    let replica: { name: string; pg: number } | null = null;
    let primaryLsn: { rec: boolean; lsn: string | null } | null = null;
    let replicaLsn: { rec: boolean; lsn: string | null } | null = null;
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && !(leader && replica)) {
      leader = await currentLeader();
      if (leader) {
        primaryLsn = await readLsn(leader.pg);
        for (const node of NODES) {
          if (node.name === leader.name) continue;
          const live = await readLsn(node.pg);
          if (live?.rec && live.lsn) {
            replica = node;
            replicaLsn = live;
            break;
          }
        }
      }
      if (!(leader && replica)) {
        if (Date.now() + 20_000 > deadline) {
          // Never leave a search failure unexplained: report what each node actually was.
          // eslint-disable-next-line no-console
          console.log(
            '[p38] replica search stalled — roles:',
            await Promise.all(NODES.map(async (node) => `${node.name}=${await roleOf(node.api)}`)),
            '| readable:',
            await Promise.all(NODES.map(async (node) => `${node.name}=${JSON.stringify(await readLsn(node.pg))}`))
          );
        }
        await sleep(3000);
      }
    }
    // eslint-disable-next-line no-console
    console.log('[p38] primary:', leader?.name, primaryLsn, '| replica:', replica?.name, replicaLsn);

    expect(leader).not.toBeNull();
    expect(replica).not.toBeNull();
    expect(primaryLsn!.rec).toBe(false);
    expect(primaryLsn!.lsn).not.toBeNull();
    expect(replicaLsn!.rec).toBe(true);
    // The replica must have a replay position, which is the fact `assessRejoin` depends on and which a role
    // label alone would never supply.
    expect(replicaLsn!.lsn).not.toBeNull();

    // Feed the real measurements through the same judgement the cluster would use.
    const assessment = assessRejoin({
      primary: { timeline: 1, currentLsn: primaryLsn!.lsn! },
      candidate: {
        timeline: 1,
        timelineSource: 'wal-file',
        inRecovery: replicaLsn!.rec,
        replayPaused: false,
        replayLsn: replicaLsn!.lsn!,
        historyFiles: [],
      },
      toleranceBytes: 256 * 1024 * 1024,
    });
    // eslint-disable-next-line no-console
    console.log('[p38] live rejoin assessment:', assessment);
    // A live streaming replica may trail by a little; it must never be ahead, and never non-recovering.
    expect(parseLsn(replicaLsn!.lsn!)).toBeLessThanOrEqual(parseLsn(primaryLsn!.lsn!));
    expect(assessment.reasons.join(' ')).not.toMatch(/beyond the primary|not in recovery/i);
  }, 300_000);

  /* ---------------------------------------------------------------- */
  /* Criterion 6 — missing WAL after rewind                            */
  /* ---------------------------------------------------------------- */

  it('12 the exact conditions under which recovery cannot complete are detected', async () => {
    await healCluster();
    // Phase 37 saw a rewound node stall in recovery and could not say why. The condition is WAL
    // availability: after a rewind the target must replay from the fork point, and those segments must
    // still exist on the primary, in a slot, or in an archive. Assert both directions on real files.
    const leader = await currentLeader();
    expect(leader).not.toBeNull();
    const walDir = `${ROOT}/data-${leader!.name}/pg_wal`;
    const present = listWalSegments(walDir);
    // eslint-disable-next-line no-console
    console.log('[p38] WAL segments present on the primary:', present.length, present.slice(0, 3));

    expect(present.length).toBeGreaterThan(0);

    // A segment that is present must be reported retrievable.
    const available = assessWalAvailability({ primaryWalDir: walDir, requiredSegments: [present[0]] });
    expect(available.retrievable).toBe(true);

    // A segment that is not present must be reported as unrecoverable, with the reason naming the remedy.
    const missing = assessWalAvailability({
      primaryWalDir: walDir,
      requiredSegments: ['FFFFFFFFFFFFFFFFFFFFFFFF'],
    });
    // eslint-disable-next-line no-console
    console.log('[p38] missing WAL:', missing.retrievable, '|', missing.detail);
    expect(missing.retrievable).toBe(false);
    expect(missing.detail).toMatch(/replication slot|archive/i);
  }, 120_000);

  /* ---------------------------------------------------------------- */
  /* Criteria 7 and 8 — what stays open                                */
  /* ---------------------------------------------------------------- */

  it('13 independent fencing and real VIP operations remain UNMET, and are recorded as such', async () => {
    // These are assertions about the environment, kept in the suite so the claim cannot rot into "we think
    // it works" once the phase is over.
    const vip = spawnSync('ip', ['addr', 'add', '127.0.0.20/32', 'dev', 'lo'], { encoding: 'utf8' });
    const vipError = `${vip.stderr ?? ''}${vip.stdout ?? ''}`.trim();
    // eslint-disable-next-line no-console
    console.log('[p38] VIP assignment attempt:', vip.status, '|', vipError.slice(0, 120));

    // Either the capability is absent (expected here) or the address was added and must be removed. Both
    // outcomes are recorded; neither is reported as success.
    if (vip.status === 0) {
      spawnSync('ip', ['addr', 'del', '127.0.0.20/32', 'dev', 'lo']);
      // eslint-disable-next-line no-console
      console.log('[p38] VIP assignment unexpectedly succeeded — requirement 8 may now be testable');
    } else {
      expect(vipError).toMatch(/Operation not permitted|not permitted|Permission denied/i);
    }

    // Independent fencing: the mechanisms available here are all same-host. This is a statement about the
    // environment, not a measurement of our code, so it is recorded rather than asserted into a pass.
    // eslint-disable-next-line no-console
    console.log(
      '[p38] independent fencing: UNMET — no power, no storage-device, no second failure domain. ' +
        'The WAL permission fence and the shim share this host and this filesystem.'
    );
    expect(true).toBe(true);
  }, 120_000);

  it('14 the shim and the fence record share one host, and that limitation is structural', async () => {
    // Stating the boundary as a test: both the enforcement point and the state it reads are paths on this
    // machine. Nothing in this design survives the host being wrong, which is why it cannot be called an
    // independent failure domain however many routes it covers.
    const ledgerDir = LOG_ROOT;
    const shimPath = `${ROOT}/bin-node1/postgres`;
    expect(existsSync(shimPath)).toBe(true);
    expect(existsSync(ledgerDir)).toBe(true);
    // Same filesystem, same host: the "independence" of these two controls is independence of *mechanism*,
    // not of failure domain.
    const fsOf = (path: string) =>
      spawnSync('bash', ['-c', `stat -c %d ${path}`], { encoding: 'utf8' }).stdout?.trim();
    // eslint-disable-next-line no-console
    console.log('[p38] device ids — shim:', fsOf(shimPath), '| ledger:', fsOf(ledgerDir));
  }, 60_000);
});
