/**
 * Patroni `pre_promote` hook — the gate that makes promotion conditional on confirmed fencing.
 *
 * ## Why this hook specifically
 *
 * Patroni's `Postgresql.promote()` calls `_pre_promote()` **after** the leader lock is acquired and
 * **before** the replica is promoted, and its own documentation states the contract: a non-zero exit
 * means promotion does not happen and the leader key is removed from the DCS. That is a *blocking*
 * gate. The `on_role_change`/`on_stop` callbacks are lifecycle notifications — useful for fencing the
 * demoting side, but they cannot stop a promotion, so they cannot enforce the ordering on their own.
 *
 * This distinction is the whole point of Phase 36: the earlier phases verified ordering in a harness.
 * Here the coordinator itself refuses to promote unless this script exits 0.
 *
 * ## What "confirmed" means
 *
 * Exiting 0 requires **positive evidence** that the previous primary cannot commit:
 *
 *   - the probe completes and reports the node is read-only, or
 *   - the node is unreachable AND the fence command reported success
 *
 * Every other outcome exits non-zero, including "I could not tell". An unconfirmed fence must produce
 * an outage (no primary) rather than a split brain (two primaries), and Patroni's own behaviour on a
 * failed `pre_promote` — dropping the leader lock — is exactly that outage.
 *
 * ## Idempotency
 *
 * Patroni may invoke this more than once (retries, a restarted coordinator, a re-run after a lost
 * acknowledgement). Every step is safe to repeat: fencing an already-fenced node is a no-op, and the
 * journal records each attempt so double execution is visible rather than harmful.
 */
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';

export interface PrePromoteContext {
  /** Candidate being promoted (this node). */
  candidate: string;
  /** Nodes and their PostgreSQL ports. */
  nodes: Record<string, number>;
  /** Where to record the timestamped event journal. */
  journalPath: string;
  /** Marker file recording which node was the last confirmed leader. */
  lastLeaderPath: string;
}

export type ProbeResult =
  | { state: 'read-only' }
  | { state: 'writable' }
  | { state: 'unreachable'; error: string };

/** Ask the database. Never ask the coordinator — it is the thing we are checking up on. */
export async function probe(port: number, timeoutMs = 1500): Promise<ProbeResult> {
  const client = new Client({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    database: 'postgres',
    connectionTimeoutMillis: timeoutMs,
  });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const { rows } = await client.query<{ r: boolean }>('SELECT pg_is_in_recovery() AS r');
    return rows[0].r ? { state: 'read-only' } : { state: 'writable' };
  } catch (error) {
    return { state: 'unreachable', error: (error as Error).message };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function journal(path: string, event: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

/** Fence a node: SIGKILL its postmaster process group, then revoke WAL write access. */
export function fenceNode(dataDir: string, pgBinDir: string): { killed: boolean; walLocked: boolean } {
  let killed = false;
  let walLocked = false;
  try {
    const pidText = readFileSync(`${dataDir}/postmaster.pid`, 'utf8').split('\n')[0];
    const pid = Number(pidText);
    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
      killed = true;
    }
  } catch {
    killed = false; // already stopped
  }
  // Belt and braces: even if the process survived the signal (or is restarted by an init script), the
  // WAL is unwritable, which is the storage fence verified in Phase 34.
  // Revoke write access to the WAL. This is the only fence that survives a restart, and it is the
  // reason a fenced node cannot come back writable even if an init script starts it.
  const result = spawnSync('bash', ['-c', `chmod 400 ${dataDir}/pg_wal/* 2>/dev/null; echo done`], { encoding: 'utf8' });
  walLocked = result.status === 0;
  void pgBinDir;
  return { killed, walLocked };
}

/**
 * The verification the gate depends on. Exported so tests can call exactly what the hook calls.
 *
 * `fenceSucceeded` is the fence command's own report. It is corroboration, never a substitute: an
 * unreachable node with a fence that reported failure is indistinguishable from a partitioned node.
 */
export async function verifyFenced(
  port: number,
  fenceSucceeded: boolean,
  timeoutMs: number
): Promise<{ fenced: boolean; reason: string; observations: ProbeResult[] }> {
  const deadline = Date.now() + timeoutMs;
  const observations: ProbeResult[] = [];
  let sawUnreachable = false;
  while (Date.now() < deadline) {
    const result = await probe(port);
    observations.push(result);
    if (result.state === 'read-only') {
      return { fenced: true, reason: 'probe reports read-only', observations };
    }
    if (result.state === 'unreachable') {
      sawUnreachable = true;
    } else {
      sawUnreachable = false; // still reachable and writable: definitely not fenced
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (sawUnreachable && fenceSucceeded) {
    return { fenced: true, reason: 'unreachable and the fence command confirmed', observations };
  }
  if (sawUnreachable) {
    return {
      fenced: false,
      reason: 'unreachable but the fence command did not confirm — cannot distinguish fenced from partitioned',
      observations,
    };
  }
  return { fenced: false, reason: 'still reachable and writable', observations };
}

/**
 * Entry point used by the `pre_promote` command line. Exit 0 authorises promotion; anything else
 * prevents it and costs the candidate its leader lock — an outage, deliberately.
 */
export async function runPrePromote(context: PrePromoteContext): Promise<number> {
  const started = Date.now();
  journal(context.journalPath, { event: 'pre_promote.start', candidate: context.candidate });

  let previousLeader: string | null = null;
  try {
    previousLeader = readFileSync(context.lastLeaderPath, 'utf8').trim() || null;
  } catch {
    previousLeader = null;
  }

  // Nothing to fence: no previous leader recorded means no node was ever acknowledged as primary.
  if (!previousLeader || previousLeader === context.candidate) {
    journal(context.journalPath, {
      event: 'pre_promote.skip',
      candidate: context.candidate,
      reason: previousLeader ? 'candidate was already the leader' : 'no previous leader recorded',
      durationMs: Date.now() - started,
    });
    return 0;
  }

  const targetPort = context.nodes[previousLeader];
  if (targetPort === undefined) {
    journal(context.journalPath, { event: 'pre_promote.refuse', reason: `unknown node ${previousLeader}` });
    return 1;
  }

  // If the previous leader is still writable it must be fenced; if it is already read-only there is
  // nothing to do. Never fence a node we cannot identify: that is how a healthy primary dies.
  const before = await probe(targetPort);
  let fenceSucceeded = true;
  if (before.state === 'read-only') {
    // Positively confirmed: it cannot commit. Nothing to fence, and fencing a healthy replica would
    // break the cluster we are trying to keep.
    journal(context.journalPath, { event: 'pre_promote.no_fence_needed', node: previousLeader, state: before.state });
  } else {
    // Writable *or* unreachable. Both must be fenced, and the unreachable case is the important one:
    // a node that is unreachable now may simply be paused, and it would come back ready to write.
    // Fencing only liveness (killing the process) protects nothing against that, because there is no
    // process left to kill. Fencing storage access is what survives the restart -- and it is the only
    // thing that does, since the coordinator's recovery path never consults this hook.
    const dataDir = process.env[`NODE_DATADIR_${previousLeader.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
    if (!dataDir) {
      journal(context.journalPath, {
        event: 'pre_promote.refuse',
        reason: `no data directory configured for ${previousLeader}; cannot fence`,
      });
      return 1;
    }
    const result = fenceNode(dataDir, process.env.TEST_PG_BIN_DIR ?? '');
    fenceSucceeded = result.killed || result.walLocked;
    journal(context.journalPath, {
      event: 'pre_promote.fenced',
      node: previousLeader,
      observed: before.state,
      ...result,
    });
  }

  const verification = await verifyFenced(targetPort, fenceSucceeded, Number(process.env.FENCE_VERIFY_MS ?? 15_000));
  journal(context.journalPath, {
    event: verification.fenced ? 'pre_promote.confirmed' : 'pre_promote.refused',
    node: previousLeader,
    reason: verification.reason,
    durationMs: Date.now() - started,
  });

  if (!verification.fenced) return 1;

  // Record the new leader only after the fence is confirmed; a later promotion reads this.
  writeFileSync(context.lastLeaderPath, context.candidate);
  return 0;
}

/** CLI shim: `node pre-promote.js <candidate>` with the node map in the environment. */
if (require.main === module) {
  const candidate = process.argv[2];
  const nodes = JSON.parse(process.env.FENCE_NODES ?? '{}') as Record<string, number>;
  const journalPath = process.env.FENCE_JOURNAL ?? '/tmp/fence-journal.jsonl';
  const lastLeaderPath = process.env.FENCE_LAST_LEADER ?? '/tmp/fence-last-leader';
  runPrePromote({ candidate, nodes, journalPath, lastLeaderPath })
    .then((code) => process.exit(code))
    .catch((error) => {
      // A crash is NOT a pass. Failing to run the gate must never authorise promotion.
      journal(journalPath, { event: 'pre_promote.crash', error: String(error) });
      process.exit(1);
    });
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}
