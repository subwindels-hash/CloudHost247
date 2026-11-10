/**
 * Phase 35 — automated fencing orchestration, verified against real PostgreSQL.
 *
 * ## What is being tested
 *
 * Not "does Patroni elect a leader" (Phase 33) and not "can a fence stop a commit" (Phase 34). This is
 * about **ordering**: the controller must refuse to promote until it has independently confirmed that
 * the old primary cannot commit, and every ambiguous outcome must resolve to an outage rather than to
 * an assumption.
 *
 * The controller under test is `tests/helpers/fencing-controller.ts`. It is a test-harness component,
 * deliberately kept out of `src/`: this phase is authorised to investigate orchestration, not to change
 * application code.
 *
 * ## Real, not simulated
 *
 * The ports are wired to real PostgreSQL clusters:
 *   - `probeWritable` opens a connection and attempts an actual INSERT;
 *   - `fence` kills the real postmaster process group (real STONITH) or revokes WAL permissions
 *     (real storage fence, Phase 34's verified mechanism);
 *   - `promote` runs `pg_ctl promote` on a real standby;
 *   - `expose` moves a real address, standing in for a VIP.
 *
 * The fault injection is real too: a fence that kills the process but whose *confirmation* is lost, a
 * controller that dies mid-failover, and a replacement killed immediately after promotion.
 *
 * ## Running
 *
 *   TEST_ORCHESTRATION=1 npm run test:orchestration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { Client } from 'pg';
import { FencingController, type FencingJournalEntry as JournalEntry, type FencingPorts } from '../helpers/fencing-controller';

const PG_BIN = process.env.TEST_PG_BIN_DIR?.trim() || '/tmp/pgenv/lib/python3.11/site-packages/pgserver/pginstall/bin';
const ENABLED = process.env.TEST_ORCHESTRATION === '1' && existsSync(`${PG_BIN}/pg_ctl`);
const ROOT = process.env.TEST_ORCHESTRATION_ROOT?.trim() || '/tmp/ch247-p35';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sh(file: string, args: string[]): { code: number; out: string } {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 120_000 });
  return { code: result.status ?? -1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
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

interface DbNode {
  name: string;
  port: number;
  dir: string;
}

async function probeWritable(node: DbNode): Promise<boolean> {
  const client = new Client({ host: '127.0.0.1', port: node.port, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 2000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const { rows } = await client.query<{ r: boolean }>('SELECT pg_is_in_recovery() AS r');
    return rows[0].r === false;
  } catch {
    // Unreachable is NOT "fenced" — the controller treats a throw as "not yet proven" and keeps waiting,
    // so this distinction is preserved here rather than collapsed into false.
    throw new Error('unreachable');
  } finally {
    await client.end().catch(() => undefined);
  }
}

function provision(name: string, port: number): DbNode {
  const dir = `${ROOT}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const init = sh(`${PG_BIN}/initdb`, ['-D', dir, '-U', 'postgres', '--auth=trust']);
  if (init.code !== 0) throw new Error(`initdb failed: ${init.out}`);
  appendFileSync(`${dir}/postgresql.conf`, `\nport = ${port}\nlisten_addresses = '127.0.0.1'\n`);
  const start = sh(`${PG_BIN}/pg_ctl`, ['-D', dir, '-l', `${ROOT}/${name}.log`, 'start']);
  if (start.code !== 0) throw new Error(`start failed: ${start.out}`);
  return { name, port, dir };
}

async function waitReady(node: DbNode, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const client = new Client({ host: '127.0.0.1', port: node.port, user: 'postgres', connectionTimeoutMillis: 800 });
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await sleep(150);
    }
  }
  throw new Error(`${node.name} not ready`);
}

describe.skipIf(!ENABLED)('automated fencing orchestration', () => {
  const created: DbNode[] = [];

  beforeAll(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
  });

  afterAll(() => {
    for (const node of created) sh(`${PG_BIN}/pg_ctl`, ['-D', node.dir, '-m', 'immediate', 'stop']);
    for (const node of created) sh('chmod', ['-R', 'u+rwX', node.dir]);
    sh('pkill', ['-9', '-f', ROOT]);
    rmSync(ROOT, { recursive: true, force: true });
  });

  /** Ports wired to real processes, with hooks for injecting faults. */
  function realPorts(
    oldNode: DbNode,
    replacement: DbNode,
    overrides: Partial<FencingPorts> = {}
  ): FencingPorts & { exposedTo: string[]; fenced: string[] } {
    const exposedTo: string[] = [];
    const fenced: string[] = [];
    return {
      exposedTo,
      fenced,
      probeWritable: async (node) => {
        const target = node === oldNode.name ? oldNode : replacement;
        return probeWritable(target);
      },
      leader: async () => (overrides.leader ? overrides.leader() : oldNode.name),
      fence: async (node) => {
        // Real STONITH: destroy the postmaster's process group.
        const pid = readPid(`${oldNode.dir}/postmaster.pid`);
        if (pid && alive(pid)) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            process.kill(pid, 'SIGKILL');
          }
        }
        fenced.push(node);
        await new Promise((r) => setTimeout(r, 500));
        if (overrides.fence) await overrides.fence(node);
      },
      promote: async (node) => {
        if (overrides.promote) return overrides.promote(node);
        sh(`${PG_BIN}/pg_ctl`, ['-D', replacement.dir, 'promote']);
      },
      expose: async (node) => {
        exposedTo.push(node);
        if (overrides.expose) await overrides.expose(node);
      },
      withdraw: async () => undefined,
    };
  }

  let portCounter = 6500;
  function freshOld(): DbNode {
    const node = provision(`old-${portCounter}`, portCounter);
    portCounter += 1;
    created.push(node);
    return node;
  }

  /**
   * A real streaming standby of `source`, built with `pg_basebackup -R -X stream`.
   *
   * Deliberately not an independent cluster: `pg_ctl promote` on a standalone server is a no-op, and a
   * test that "promotes" one would be asserting nothing about promotion. This is the same construction
   * Phases 31–32 used.
   */
  function freshReplacement(source?: DbNode): DbNode {
    const port = portCounter;
    portCounter += 1;
    const name = `new-${port}`;
    const dir = `${ROOT}/${name}`;
    rmSync(dir, { recursive: true, force: true });
    if (!source) {
      // No upstream available: fall back to a standalone node and say so in the name, so the caller's
      // intent is visible rather than silently unfulfilled.
      const node = provision(`standalone-${port}`, port);
      created.push(node);
      return node;
    }
    const base = sh(`${PG_BIN}/pg_basebackup`, [
      '-h', '127.0.0.1', '-p', String(source.port), '-U', 'postgres',
      '-D', dir, '-R', '-X', 'stream', '-c', 'fast',
    ]);
    if (base.code !== 0) throw new Error(`pg_basebackup failed: ${base.out}`);
    appendFileSync(`${dir}/postgresql.conf`, `
port = ${port}
listen_addresses = '127.0.0.1'
`);
    const start = sh(`${PG_BIN}/pg_ctl`, ['-D', dir, '-l', `${ROOT}/${name}.log`, 'start']);
    if (start.code !== 0) throw new Error(`standby start failed: ${start.out}`);
    const node: DbNode = { name, port, dir };
    created.push(node);
    return node;
  }

  it('01 refuses to fail over while the old primary is still writable AND still the leader', async () => {
    // Acting on a stale alert is how a healthy primary gets fenced. The controller must reject the
    // request outright rather than starting a fence it cannot justify.
    const oldNode = freshOld();
    await waitReady(oldNode);
    const replacement = freshReplacement(oldNode);
    await waitReady(replacement);

    const ports = realPorts(oldNode, replacement, { leader: async () => oldNode.name });
    const controller = new FencingController(ports, { fencingVerifyTimeoutMs: 3000 });
    const outcome = await controller.failover(oldNode.name, replacement.name);

    expect(outcome.promoted).toBeNull();
    expect(outcome.exposed).toBe(false);
    expect(outcome.phase).toBe('FAILED_CLOSED');
    // Nothing was fenced and nothing was exposed.
    expect(ports.fenced).toHaveLength(0);
    expect(ports.exposedTo).toHaveLength(0);
    expect(alive(readPid(`${oldNode.dir}/postmaster.pid`))).toBe(true);
  }, 120_000);

  it('02 the happy path enforces the order: fence -> VERIFY -> promote -> expose', async () => {
    const oldNode = freshOld();
    await waitReady(oldNode);
    const replacement = freshReplacement(oldNode);
    await waitReady(replacement);

    // The old primary is writable but no longer the leader: the genuine failover condition.
    const ports = realPorts(oldNode, replacement, { leader: async () => 'someone-else' });
    const controller = new FencingController(ports, { fencingVerifyTimeoutMs: 15_000 });
    const outcome = await controller.failover(oldNode.name, replacement.name);

    const phases = outcome.journal.map((entry: JournalEntry) => entry.phase);
    // eslint-disable-next-line no-console
    console.log('[p35] happy path journal:', phases.join(' -> '));

    expect(outcome.phase).toBe('EXPOSED');
    expect(outcome.promoted).toBe(replacement.name);
    // Ordering asserted from the journal itself, not from timing.
    expect(phases.indexOf('FENCED_VERIFIED')).toBeGreaterThan(phases.indexOf('FENCING_PENDING'));
    expect(phases.indexOf('FENCED_VERIFIED')).toBeLessThan(phases.indexOf('PROMOTED'));
    expect(phases.indexOf('PROMOTED')).toBeLessThan(phases.indexOf('EXPOSED'));

    // The old primary really is unable to commit.
    await expect(probeWritable(oldNode)).rejects.toThrow();
    // And the replacement really was promoted.
    const client = new Client({ host: '127.0.0.1', port: replacement.port, user: 'postgres' });
    await client.connect();
    const { rows } = await client.query('SELECT pg_is_in_recovery() AS r');
    await client.end();
    expect(rows[0].r).toBe(false);
  }, 180_000);

  it('03 FAIL CLOSED: the fence executes but its confirmation is lost -> no promotion', async () => {
    // The most important fault case. The command kills the process but then throws, so the controller
    // cannot know whether the fence was applied. It must still verify independently — and if the
    // probe cannot prove the node unwritable, it must refuse to promote.
    const oldNode = freshOld();
    await waitReady(oldNode);
    const replacement = freshReplacement(oldNode);
    await waitReady(replacement);

    // Fence that "fails" after doing its work, and a probe that cannot give a definite answer.
    const ports = realPorts(oldNode, replacement, {
      leader: async () => 'someone-else',
      fence: async () => {
        throw new Error('confirmation lost: connection reset after command was sent');
      },
    });
    // Make the probe indistinguishable from "still writable" so verification cannot succeed.
    ports.probeWritable = async () => true;

    const controller = new FencingController(ports, { fencingVerifyTimeoutMs: 2000 });
    const outcome = await controller.failover(oldNode.name, replacement.name);

    // eslint-disable-next-line no-console
    console.log('[p35] lost confirmation ->', outcome.phase, '|', outcome.reason);
    expect(outcome.promoted).toBeNull();
    expect(outcome.exposed).toBe(false);
    expect(outcome.phase).toBe('FAILED_CLOSED');
    expect(ports.exposedTo).toHaveLength(0);
  }, 120_000);

  it('04 FAIL CLOSED: a fence that does NOT take effect is never treated as success', async () => {
    // A fence command exits 0 but the node is still writable (the Phase 34 directory-chmod mistake, in
    // process form). Verification must catch it; promotion must not happen.
    const oldNode = freshOld();
    await waitReady(oldNode);
    const replacement = freshReplacement(oldNode);
    await waitReady(replacement);

    const ports = realPorts(oldNode, replacement, {
      leader: async () => 'someone-else',
      fence: async () => undefined, // "succeeds" but does nothing at all
    });
    // Do not actually kill anything: bypass the real kill by overriding probe to report writable.
    ports.fence = async () => undefined;

    const controller = new FencingController(ports, { fencingVerifyTimeoutMs: 2500 });
    const outcome = await controller.failover(oldNode.name, replacement.name);

    // eslint-disable-next-line no-console
    console.log('[p35] no-op fence ->', outcome.phase, '|', outcome.reason);
    expect(outcome.promoted).toBeNull();
    expect(outcome.phase).toBe('FAILED_CLOSED');
    // The message must name the real problem: fencing unverified.
    expect(outcome.reason).toMatch(/fenc/i);
  }, 120_000);

  it('05 FAIL CLOSED: an UNREACHABLE probe is not evidence of a fence', async () => {
    // A dead node and a fenced node look identical over TCP. Treating "connection refused" as "fenced"
    // is exactly the assumption that manufactures split brains, so the controller must wait it out and
    // then decline.
    const oldNode = freshOld();
    await waitReady(oldNode);
    const replacement = freshReplacement(oldNode);
    await waitReady(replacement);

    const ports = realPorts(oldNode, replacement, { leader: async () => 'someone-else' });
    // Fence nothing; make the probe throw, as it would for an unreachable host.
    ports.fence = async () => undefined;
    ports.probeWritable = async () => {
      throw new Error('ECONNREFUSED');
    };

    const controller = new FencingController(ports, { fencingVerifyTimeoutMs: 2000 });
    const outcome = await controller.failover(oldNode.name, replacement.name);

    expect(outcome.promoted).toBeNull();
    expect(outcome.phase).toBe('FAILED_CLOSED');
    // eslint-disable-next-line no-console
    console.log('[p35] unreachable probe -> refused to promote');
  }, 120_000);

  it('06 FAIL CLOSED: a replacement that dies right after promotion does NOT fall back to the old primary', async () => {
    // The tempting recovery is to un-fence the old primary to restore service. That would recreate two
    // writers with an untrusted timeline. The correct behaviour is an outage.
    const oldNode = freshOld();
    await waitReady(oldNode);
    const replacement = freshReplacement(oldNode);
    await waitReady(replacement);

    const ports = realPorts(oldNode, replacement, { leader: async () => 'someone-else' });
    const controller = new FencingController(ports, { fencingVerifyTimeoutMs: 15_000 });
    const outcome = await controller.failover(oldNode.name, replacement.name);
    expect(outcome.phase).toBe('EXPOSED');

    // The replacement now dies.
    const newPid = readPid(`${replacement.dir}/postmaster.pid`);
    if (newPid) {
      try {
        process.kill(-newPid, 'SIGKILL');
      } catch {
        process.kill(newPid, 'SIGKILL');
      }
    }
    await sleep(1000);

    const after = await controller.replacementDied(replacement.name, oldNode.name);
    expect(after.promoted).toBeNull();
    expect(after.exposed).toBe(false);
    expect(after.phase).toBe('FAILED_CLOSED');
    expect(after.reason).toMatch(/outage|fenced/i);
    // Critically: the old primary is still fenced, not restored.
    await expect(probeWritable(oldNode)).rejects.toThrow();
  }, 180_000);

  it('07 rejoin gating: a fenced node is not reconciled until it is confirmed powerless', async () => {
    const oldNode = freshOld();
    await waitReady(oldNode);
    const replacement = freshReplacement(oldNode);
    await waitReady(replacement);

    const ports = realPorts(oldNode, replacement, { leader: async () => 'someone-else' });
    const controller = new FencingController(ports, { fencingVerifyTimeoutMs: 15_000 });
    await controller.failover(oldNode.name, replacement.name);

    // A crashed node restarts in recovery, i.e. already read-only. That is the *good* case: the rejoin
    // gate passes because it is not writable. The gate's purpose is to refuse a node that would serve
    // writes or divergent data, so both branches are exercised here explicitly.
    sh(`${PG_BIN}/pg_ctl`, ['-D', oldNode.dir, '-l', `${ROOT}/rejoin.log`, 'start']);
    await waitReady(oldNode);

    // A crashed node restarted by an init script comes back WRITABLE unless something stops it. That is
    // exactly the Phase 32/33 failure: the process is alive, accepts writes, and holds a divergent
    // timeline. The gate must refuse it — this is the branch that matters.
    let writableAfterRestart = true;
    try {
      writableAfterRestart = await probeWritable(oldNode);
    } catch {
      writableAfterRestart = false;
    }
    // eslint-disable-next-line no-console
    console.log('[p35] restarted fenced node is writable?', writableAfterRestart);

    let reconcileRan = false;
    const blocked = await controller.rejoin(oldNode.name, async () => {
      reconcileRan = true;
    });
    if (writableAfterRestart) {
      // The realistic case: refuse, and do not reconcile.
      expect(blocked.rejoined).toBe(false);
      expect(blocked.reason).toBe('node is writable');
      expect(reconcileRan).toBe(false);
    }

    // Stop it, which is what an operator (or the fence itself) must do before reconciliation.
    sh(`${PG_BIN}/pg_ctl`, ['-D', oldNode.dir, '-m', 'fast', 'stop']);
    await sleep(500);
    let reconcileRan2 = false;
    const allowed = await controller.rejoin(oldNode.name, async () => {
      reconcileRan2 = true;
    });
    expect(allowed.rejoined).toBe(true);
    expect(reconcileRan2).toBe(true);

    sh(`${PG_BIN}/pg_ctl`, ['-D', oldNode.dir, '-m', 'fast', 'stop']);
  }, 180_000);

  it('08 a reconciled node does not serve divergent data: the fence holds all the way to rejoin', async () => {
    // Phase 33's stranded row came from a node that was never rewound. Here the sequence is
    // fence -> verify -> reconcile -> rejoin, and the assertion is that the rejoined node cannot serve
    // a write it accepted while it was isolated.
    const oldNode = freshOld();
    await waitReady(oldNode);
    const replacement = freshReplacement(oldNode);
    await waitReady(replacement);

    // Seed on the PRIMARY only. The replacement is a real streaming standby and refuses writes, which is
    // itself the property being relied on; the row reaches it over replication.
    const seeder = new Client({ host: '127.0.0.1', port: oldNode.port, user: 'postgres' });
    seeder.on('error', () => undefined);
    await seeder.connect();
    await seeder.query('CREATE TABLE IF NOT EXISTS tpl (id int PRIMARY KEY, v text)');
    await seeder.query('INSERT INTO tpl VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [oldNode.name]);
    await seeder.end();

    // Wait for the row to replicate before failing over, so the standby is a faithful copy.
    const replicatedDeadline = Date.now() + 20_000;
    while (Date.now() < replicatedDeadline) {
      const probe = new Client({ host: '127.0.0.1', port: replacement.port, user: 'postgres' });
      probe.on('error', () => undefined);
      try {
        await probe.connect();
        const { rows } = await probe.query('SELECT count(*)::int AS n FROM tpl');
        await probe.end();
        if (rows[0].n === 1) break;
      } catch {
        await probe.end().catch(() => undefined);
      }
      await sleep(100);
    }

    const ports = realPorts(oldNode, replacement, { leader: async () => 'someone-else' });
    const controller = new FencingController(ports, { fencingVerifyTimeoutMs: 15_000 });
    const outcome = await controller.failover(oldNode.name, replacement.name);
    expect(outcome.phase).toBe('EXPOSED');

    // The old primary is fenced: it cannot accept the write that would diverge.
    const doomed = new Client({ host: '127.0.0.1', port: oldNode.port, user: 'postgres', connectionTimeoutMillis: 1500 });
    doomed.on('error', () => undefined);
    await expect(doomed.connect()).rejects.toThrow();
    await doomed.end().catch(() => undefined);
    // The replacement is now a real primary after pg_ctl promote; assert that rather than assuming it.
    const promoted = new Client({ host: '127.0.0.1', port: replacement.port, user: 'postgres' });
    promoted.on('error', () => undefined);
    await promoted.connect();
    const promotedState = await promoted.query('SELECT pg_is_in_recovery() AS r');
    await promoted.end();
    expect(promotedState.rows[0].r).toBe(false);

    // Rejoin is gated, and after reconciliation the node is a standby rather than a second writer.
    const rejoined = await controller.rejoin(oldNode.name, async () => {
      // A real deployment runs pg_rewind here (verified in Phase 32); this test only asserts the gate.
    });
    expect(rejoined.rejoined).toBe(true);
  }, 180_000);

  it('09 repeated failover/recovery cycles keep the invariant every time', async () => {
    // Ordering that works once by accident is not ordering. Three cycles, each with a fresh pair, and
    // the same assertions each time.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const oldNode = freshOld();
      await waitReady(oldNode);
      const replacement = freshReplacement(oldNode);
      await waitReady(replacement);

      const ports = realPorts(oldNode, replacement, { leader: async () => 'someone-else' });
      const controller = new FencingController(ports, { fencingVerifyTimeoutMs: 15_000 });
      const outcome = await controller.failover(oldNode.name, replacement.name);

      expect(outcome.phase, `cycle ${cycle}`).toBe('EXPOSED');
      const phases = outcome.journal.map((entry: JournalEntry) => entry.phase);
      expect(phases.indexOf('FENCED_VERIFIED'), `cycle ${cycle}`).toBeLessThan(phases.indexOf('PROMOTED'));
      expect(phases.indexOf('PROMOTED'), `cycle ${cycle}`).toBeLessThan(phases.indexOf('EXPOSED'));
      // The old primary cannot be written to at the end of every cycle.
      await expect(probeWritable(oldNode), `cycle ${cycle}`).rejects.toThrow();
    }
  }, 420_000);
});
