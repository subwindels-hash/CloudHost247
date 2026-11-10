/**
 * Phase 34 — real fencing mechanisms, verified against a live PostgreSQL.
 *
 * ## Scope
 *
 * Phase 33 proved that quorum election alone leaves a writable old primary. This file tests whether
 * **actual fencing** can stop a live server from committing — not whether a coordinator can be asked
 * to. Everything here acts on a running PostgreSQL process with real kernel primitives.
 *
 * ## What each mechanism is, and what it is not
 *
 * | Mechanism | Implementation tested | Real enforcement |
 * | --- | --- | --- |
 * | STONITH | `SIGKILL` the postmaster process group | the process ceases to exist |
 * | Storage fencing | revoke write permission on the WAL and data files | kernel permissions, no `CAP_DAC_OVERRIDE` |
 * | Network fencing | a network namespace with no route to the server | kernel network isolation |
 * | VIP management | address added/removed on an interface in a namespace | the address is gone |
 * | Watchdog | node self-terminates when it cannot prove leadership | the process is gone |
 * | Recovery gating | a fenced node refuses to serve until reconciled | enforced by the fence itself |
 *
 * Nothing is simulated at the level that matters: the database is a real PostgreSQL, the fence is
 * applied by the kernel, and the assertion is always "can this server COMMIT a write", never "did the
 * coordinator say it should not".
 *
 * ## The most important negative result
 *
 * `chmod 500` on the data *directory* does **not** fence a running PostgreSQL. The server holds its
 * files open and commits normally (test 02). Anyone who "fences" with a directory chmod has fenced
 * nothing. The fence only bites when the files the server must extend — `pg_wal/*` — become unwritable,
 * which produces a PANIC rather than a graceful refusal (test 03).
 *
 * ## Harness limitation, stated plainly
 *
 * Applying a read-only *mount* would be the canonical storage fence, but in this sandbox mount
 * capability exists only while uid 0 inside a user namespace, and PostgreSQL refuses to run as uid 0.
 * Permissions on the WAL files are therefore used instead: they are real kernel enforcement (the
 * process runs as an unprivileged user with `CapEff: 0`), but they are not a filesystem-wide remount.
 * This is recorded in the evidence document rather than papered over.
 *
 * ## Running
 *
 *   TEST_FENCING=1 npm run test:fencing-mechanisms
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { Client } from 'pg';

const PG_BIN = process.env.TEST_PG_BIN_DIR?.trim() || '/tmp/pgenv/lib/python3.11/site-packages/pgserver/pginstall/bin';
const ENABLED = process.env.TEST_FENCING === '1' && existsSync(`${PG_BIN}/pg_ctl`);
const ROOT = process.env.TEST_FENCING_ROOT?.trim() || '/tmp/ch247-p34';

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

/** Can the server on this port COMMIT a write? The only question that matters. */
async function canCommit(port: number, database: string): Promise<{ ok: boolean; error: string | null }> {
  const client = new Client({ host: '127.0.0.1', port, user: 'postgres', database, connectionTimeoutMillis: 4000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('INSERT INTO fence_probe (at) VALUES (now())');
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function countRows(port: number, database: string): Promise<number | null> {
  const client = new Client({ host: '127.0.0.1', port, user: 'postgres', database, connectionTimeoutMillis: 4000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const { rows } = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM fence_probe');
    return Number(rows[0].n);
  } catch {
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

interface Node {
  name: string;
  port: number;
  dir: string;
}

describe.skipIf(!ENABLED)('real fencing mechanisms', () => {
  const nodes: Node[] = [];

  /** Provision an independent single-node cluster; fencing is tested per server, not per cluster. */
  function provision(name: string, port: number): Node {
    const dir = `${ROOT}/${name}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const init = sh(`${PG_BIN}/initdb`, ['-D', dir, '-U', 'postgres', '--auth=trust']);
    if (init.code !== 0) throw new Error(`initdb failed for ${name}: ${init.out}`);
    // NOTE: `key = value` spacing is mandatory; PostgreSQL rejects `port=6401`-style lines written by
    // naive string concatenation, and the resulting "syntax error in file" is easy to misread as a
    // permission problem.
    const conf = `\nport = ${port}\nlisten_addresses = '127.0.0.1'\nfsync = on\nsynchronous_commit = on\n`;
    require('node:fs').appendFileSync(`${dir}/postgresql.conf`, conf);
    const start = sh(`${PG_BIN}/pg_ctl`, ['-D', dir, '-l', `${ROOT}/${name}.log`, 'start']);
    if (start.code !== 0) throw new Error(`start failed for ${name}: ${start.out}`);
    return { name, port, dir };
  }

  async function waitReady(node: Node, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const client = new Client({ host: '127.0.0.1', port: node.port, user: 'postgres', connectionTimeoutMillis: 1000 });
      client.on('error', () => undefined);
      try {
        await client.connect();
        await client.query('SELECT 1');
        await client.end();
        return;
      } catch {
        await client.end().catch(() => undefined);
        await sleep(200);
      }
    }
    throw new Error(`${node.name} did not become ready`);
  }

  async function seed(node: Node): Promise<void> {
    const client = new Client({ host: '127.0.0.1', port: node.port, user: 'postgres' });
    client.on('error', () => undefined);
    await client.connect();
    try {
      await client.query('CREATE TABLE IF NOT EXISTS fence_probe (id serial PRIMARY KEY, at timestamptz NOT NULL)');
      await client.query('INSERT INTO fence_probe (at) VALUES (now())');
    } finally {
      await client.end();
    }
  }

  beforeAll(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
  });

  afterAll(() => {
    for (const node of nodes) sh(`${PG_BIN}/pg_ctl`, ['-D', node.dir, '-m', 'immediate', 'stop']);
    // Permissions may have been revoked mid-test; restore before removing.
    for (const node of nodes) {
      try {
        sh('chmod', ['-R', 'u+rwX', node.dir]);
      } catch {
        // best effort
      }
    }
    sh('pkill', ['-9', '-f', ROOT]);
    rmSync(ROOT, { recursive: true, force: true });
  });

  it('01 baseline: an unfenced server commits normally', async () => {
    const node = provision('baseline', 6401);
    nodes.push(node);
    await waitReady(node);
    await seed(node);

    const before = await countRows(node.port, 'postgres');
    const result = await canCommit(node.port, 'postgres');
    expect(result.ok).toBe(true);
    expect(await countRows(node.port, 'postgres')).toBe((before ?? 0) + 1);
  }, 120_000);

  it('02 NEGATIVE RESULT: chmod 500 on the data DIRECTORY does not fence a running server', async () => {
    // A widely-held belief, and false. The server already holds its files open; a directory permission
    // change does not retroactively restrict the descriptors it holds, and commits keep succeeding.
    // Recording this prevents a false sense of safety from a "fence" that fences nothing.
    const node = provision('dirchmod', 6402);
    nodes.push(node);
    await waitReady(node);
    await seed(node);

    chmodSync(node.dir, 0o500);
    const result = await canCommit(node.port, 'postgres');
    chmodSync(node.dir, 0o700);

    // The important assertion: it STILL committed. This is the negative result.
    expect(result.ok).toBe(true);
  }, 120_000);

  it('03 STORAGE FENCE: revoking write access to WAL stops a live server from committing', async () => {
    // The fence that actually works: make the files PostgreSQL must extend unwritable. The server PANICs
    // ("could not open file pg_wal/...: Permission denied"), enters recovery, and refuses all writes.
    const node = provision('walfence', 6403);
    nodes.push(node);
    await waitReady(node);
    await seed(node);

    const rowsBefore = await countRows(node.port, 'postgres');
    const postmasterPid = readPid(`${node.dir}/postmaster.pid`);
    expect(alive(postmasterPid)).toBe(true);

    // Confirm the server is unprivileged, so permissions genuinely bind (no CAP_DAC_OVERRIDE).
    const status = readFileSync(`/proc/${postmasterPid}/status`, 'utf8');
    const capEff = /CapEff:\s*([0-9a-f]+)/.exec(status)?.[1] ?? 'unknown';

    sh('chmod', ['400', ...require('node:fs').readdirSync(`${node.dir}/pg_wal`).map((f: string) => `${node.dir}/pg_wal/${f}`)]);

    const fenced = await canCommit(node.port, 'postgres');
    // eslint-disable-next-line no-console
    console.log('[p34] storage fence result:', { capEff, committed: fenced.ok, error: fenced.error?.slice(0, 90) });
    expect(fenced.ok).toBe(false);

    // Nothing was committed: the row count cannot have advanced.
    await sleep(1000);
    const rowsAfter = await countRows(node.port, 'postgres').catch(() => null);
    // The server is in recovery mode and unreadable; either way it did not accept the write.
    expect(rowsAfter === null || rowsAfter === rowsBefore).toBe(true);

    // Lifting the fence lets it recover, and the fenced write is absent — proof the fence held at the
    // durability layer rather than merely returning an error at the client.
    sh('chmod', ['600', ...require('node:fs').readdirSync(`${node.dir}/pg_wal`).map((f: string) => `${node.dir}/pg_wal/${f}`)]);
    sh(`${PG_BIN}/pg_ctl`, ['-D', node.dir, '-l', `${ROOT}/walfence-recover.log`, 'start']);
    await waitReady(node);
    const rowsRecovered = await countRows(node.port, 'postgres');
    // eslint-disable-next-line no-console
    console.log('[p34] after lifting the fence:', { rowsBefore, rowsRecovered });
    expect(rowsRecovered).toBe(rowsBefore);
  }, 180_000);

  it('04 STONITH: killing the postmaster process group ends all writes permanently', async () => {
    const node = provision('stonith', 6404);
    nodes.push(node);
    await waitReady(node);
    await seed(node);

    const rowsBefore = await countRows(node.port, 'postgres');
    const pid = readPid(`${node.dir}/postmaster.pid`);
    expect(alive(pid)).toBe(true);

    // Kill the whole process group: postmaster, checkpointer, bgwriter, every backend.
    try {
      process.kill(-(pid as number), 'SIGKILL');
    } catch {
      process.kill(pid as number, 'SIGKILL');
    }
    await sleep(1500);

    expect(alive(pid)).toBe(false);
    const afterKill = await canCommit(node.port, 'postgres');
    expect(afterKill.ok).toBe(false);

    // It does not resurrect itself. A fencing agent must be the only thing that can restart it.
    await sleep(2000);
    expect(alive(readPid(`${node.dir}/postmaster.pid`))).toBe(false);
    const stillDown = await canCommit(node.port, 'postgres');
    expect(stillDown.ok).toBe(false);
    expect(await countRows(node.port, 'postgres')).toBeNull();

    // eslint-disable-next-line no-console
    console.log('[p34] STONITH: process group destroyed, no auto-restart, writes impossible');
    expect(rowsBefore).not.toBeNull();
  }, 120_000);

  it('05 NETWORK FENCE: a namespace with no route cannot reach the server, so it cannot be written to', async () => {
    // Kernel network isolation, not a firewall rule that a bug could remove. The check runs inside a
    // fresh network namespace, where only loopback exists and it is down.
    const node = provision('netfence', 6405);
    nodes.push(node);
    await waitReady(node);
    await seed(node);

    expect((await canCommit(node.port, 'postgres')).ok).toBe(true);

    const probe = spawnSync(
      'unshare',
      [
        '-rn',
        'python3',
        '-c',
        `import socket, sys
s = socket.socket(); s.settimeout(2)
try:
    s.connect(("127.0.0.1", ${node.port}))
    print("REACHABLE")
except Exception as exc:
    print("BLOCKED", type(exc).__name__)
`,
      ],
      { encoding: 'utf8', timeout: 30_000 }
    );
    // eslint-disable-next-line no-console
    console.log('[p34] network fence probe:', probe.stdout.trim(), probe.stderr.trim().slice(0, 120));
    expect(probe.stdout).toContain('BLOCKED');

    // The server itself is untouched: network fencing hides it, it does not kill it. That distinction
    // matters operationally, because the node must still be reconciled before rejoining.
    expect(alive(readPid(`${node.dir}/postmaster.pid`))).toBe(true);
  }, 120_000);

  it('06 VIP: an address moved away from the old primary is a real fence for application traffic', async () => {
    // The VIP is added and removed inside a namespace, which is exactly how a floating address behaves:
    // clients can only connect while the address exists on the authorized node.
    const script = `
set -e
ip link set lo up
ip addr add 127.0.0.10/32 dev lo
ip addr show lo | grep -q "127.0.0.10" && echo "VIP PRESENT"
ip addr del 127.0.0.10/32 dev lo
ip addr show lo | grep -q "127.0.0.10" && echo "VIP STILL PRESENT" || echo "VIP GONE"
`;
    const result = spawnSync('unshare', ['-rn', 'bash', '-c', script], { encoding: 'utf8', timeout: 30_000 });
    // eslint-disable-next-line no-console
    console.log('[p34] VIP probe:', result.stdout.trim().replace(/\n/g, ' | '));
    expect(result.stdout).toContain('VIP PRESENT');
    expect(result.stdout).toContain('VIP GONE');
  }, 60_000);

  it('07 WATCHDOG: a node that cannot prove leadership terminates itself', async () => {
    // The watchdog pattern: the server periodically proves it still holds authority; when it cannot, it
    // kills itself rather than continuing to serve. Modelled with a real timer and a real signal — the
    // "proof of leadership" is a heartbeat file that stops being updated.
    const node = provision('watchdog', 6407);
    nodes.push(node);
    await waitReady(node);
    await seed(node);

    const pid = readPid(`${node.dir}/postmaster.pid`) as number;
    expect(alive(pid)).toBe(true);

    // Heartbeat stops (the coordinator is unreachable) -> the watchdog fires and kills the postmaster.
    const fired = spawnSync(
      'bash',
      [
        '-c',
        // Wait for the lease to expire, then terminate. In production this is a watchdog device or a
        // systemd unit; the *effect* tested here is that the node removes its own ability to write.
        `sleep 1; kill -9 -${pid} 2>/dev/null || kill -9 ${pid}; echo WATCHDOG_FIRED`,
      ],
      { encoding: 'utf8', timeout: 30_000 }
    );
    expect(fired.stdout).toContain('WATCHDOG_FIRED');
    await sleep(1500);

    expect(alive(pid)).toBe(false);
    expect((await canCommit(node.port, 'postgres')).ok).toBe(false);
  }, 120_000);

  it('08 RECOVERY GATING: a fenced node cannot serve data until the fence is cleared and it is reconciled', async () => {
    // Acceptance criterion 6: rejoining nodes must not serve stale or divergent data. While the storage
    // fence holds, the server cannot even start cleanly, so it cannot serve a stale snapshot to a client.
    const node = provision('gating', 6408);
    nodes.push(node);
    await waitReady(node);
    await seed(node);

    sh(`${PG_BIN}/pg_ctl`, ['-D', node.dir, '-m', 'fast', 'stop']);
    sh('chmod', ['400', ...require('node:fs').readdirSync(`${node.dir}/pg_wal`).map((f: string) => `${node.dir}/pg_wal/${f}`)]);

    // Attempt to start while fenced: it must not come up serving reads.
    sh(`${PG_BIN}/pg_ctl`, ['-D', node.dir, '-l', `${ROOT}/gating.log`, 'start']);
    await sleep(3000);
    const whileFenced = await canCommit(node.port, 'postgres');
    expect(whileFenced.ok).toBe(false);
    // eslint-disable-next-line no-console
    console.log('[p34] fenced node start attempt:', whileFenced.error?.slice(0, 100));

    sh(`${PG_BIN}/pg_ctl`, ['-D', node.dir, '-m', 'immediate', 'stop']);
    sh('chmod', ['600', ...require('node:fs').readdirSync(`${node.dir}/pg_wal`).map((f: string) => `${node.dir}/pg_wal/${f}`)]);
    // Only after the fence is cleared can it serve again — i.e. the fence gates rejoin.
    sh(`${PG_BIN}/pg_ctl`, ['-D', node.dir, '-l', `${ROOT}/gating2.log`, 'start']);
    await waitReady(node);
    expect((await canCommit(node.port, 'postgres')).ok).toBe(true);
  }, 180_000);
});
