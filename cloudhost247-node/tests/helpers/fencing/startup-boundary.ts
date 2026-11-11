/**
 * Phase 38 — startup boundary enumeration and independent route verification.
 *
 * ## Why this exists
 *
 * Phase 37 put a gate on `bin_name['postgres']` and called the recovery path closed. That established
 * control over *one configured launch path*. It did not establish that every launch path is mediated, and
 * the difference matters: if any route can start PostgreSQL without consulting the durable fence state,
 * the gate is advisory.
 *
 * This module enumerates the routes from Patroni's own source rather than from intuition, and models a
 * second, independent control so that bypassing the shim is still detected.
 *
 * ## The startup paths, as they actually are
 *
 * Derived by reading Patroni 4.1.5 and confirmed by observing the test cluster:
 *
 * | Route | Mechanism | Where the binary comes from |
 * | --- | --- | --- |
 * | normal start / restart | `PostmasterProcess.start(pgcommand('postgres'), ...)` | `bin_dir` + `bin_name` |
 * | promotion | same call, reached via `promote()` | `bin_dir` + `bin_name` |
 * | crash recovery by own coordinator | same call | `bin_dir` + `bin_name` |
 * | `pg_ctl promote` | `pgcommand('pg_ctl')` | `bin_dir` + `bin_name` |
 * | `pg_ctl reload` | `pgcommand('pg_ctl')` | `bin_dir` + `bin_name` |
 * | `pg_ctl kill` | `pgcommand('pg_ctl')` | `bin_dir` + `bin_name` |
 * | `pg_rewind` maintenance | `pgcommand('postgres'), '--single'` | `bin_dir` + `bin_name` |
 * | `pg_controldata`, `pg_isready`, `pg_basebackup` | not start paths | — |
 * | **systemd / supervisor** | executes a *configured path*, typically `PGDATA`-aware unit | **outside Patroni** |
 * | **operator runs `postgres` by absolute path** | shell | **outside Patroni** |
 * | **`pg_ctl` from the real `bin_dir`** | shell | **outside Patroni** |
 *
 * The last three are the honest answer to "is the shim a universal boundary?": **no.** A shim on a
 * configured binary name mediates everything Patroni spawns and nothing a human or a service manager
 * spawns directly. Phase 37's own test 09 proved that by starting the real binary and getting a writable
 * node.
 *
 * ## What can be done about it locally
 *
 * Two controls, deliberately not the same mechanism:
 *
 * 1. **The shim** (enforcement) — refuses to exec for a fenced node.
 * 2. **A readiness sentinel** (detection) — a supervisor that independently checks the ledger and reports
 *    any writable node whose ledger forbids serving. It does not prevent the start; it makes the start
 *    visible. That is the honest division: prevention where we own the path, detection everywhere else.
 *
 * A third control — the WAL permission fence — is a property of the filesystem, and it is what makes the
 * difference between "detected" and "harmless".
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { Client } from 'pg';
import type { FenceLedger, LedgerState } from './fence-ledger';

/** Every route by which a PostgreSQL server can be brought up in or around this cluster. */
export type StartRoute =
  | 'patroni-start'
  | 'patroni-promote'
  | 'patroni-recovery'
  | 'pgrewind-single-user'
  | 'pgctl-start'
  | 'direct-configured'
  | 'direct-real-binary'
  | 'supervisor';

export interface RouteDescriptor {
  route: StartRoute;
  /** Does the launch resolve through Patroni's configured bin_dir/bin_name? */
  mediatedByShim: boolean;
  /** Is this route used to serve application traffic, as opposed to maintenance? */
  servesTraffic: boolean;
  note: string;
}

/**
 * The enumeration, as data. Kept explicit so a review can check it against Patroni's source, and so a
 * test can assert the table has not quietly lost a row.
 */
export const START_ROUTES: RouteDescriptor[] = [
  {
    route: 'patroni-start',
    mediatedByShim: true,
    servesTraffic: true,
    note: "PostmasterProcess.start(pgcommand('postgres')) — bin_dir + bin_name",
  },
  {
    route: 'patroni-promote',
    mediatedByShim: true,
    servesTraffic: true,
    note: 'same call, reached through Postgresql.promote() and pre_promote',
  },
  {
    route: 'patroni-recovery',
    mediatedByShim: true,
    servesTraffic: true,
    note: 'same call on the recovery path that bypasses pre_promote',
  },
  {
    route: 'pgrewind-single-user',
    mediatedByShim: true,
    servesTraffic: false,
    note: "pgcommand('postgres'), '--single' — maintenance; must be allowed or rewind is impossible",
  },
  {
    route: 'pgctl-start',
    mediatedByShim: false,
    servesTraffic: true,
    note: "system 'pg_ctl' from PATH, or an absolute path — not resolved through bin_name",
  },
  {
    route: 'direct-configured',
    mediatedByShim: true,
    servesTraffic: true,
    note: 'the shim itself, invoked directly',
  },
  {
    route: 'direct-real-binary',
    mediatedByShim: false,
    servesTraffic: true,
    note: 'the real postgres by absolute path — how Phase 37 test 09 got a writable node',
  },
  {
    route: 'supervisor',
    mediatedByShim: false,
    servesTraffic: true,
    note: 'systemd/init script with its own ExecStart — outside Patroni entirely',
  },
];

/**
 * Attempt to start a node through a route, and report what happened.
 *
 * The spawn is bounded by `timeoutMs`, so an accepted start is killed rather than left running and a
 * route that blocks cannot hang the suite. `-W` is deliberately *not* passed to `postgres`: the flag
 * belongs to `pg_ctl` waiting for a server to accept connections, not to the postmaster itself, and
 * adding it here would change what this probe measures.
 *
 * "Started" is decided closed: only a clean exit (0) or a process still running at the timeout counts.
 * A non-zero exit is a failed start, whatever the exit code — an unrelated crash (exit 3) is not
 * evidence that a fenced node served traffic.
 */
export interface RouteAttempt {
  route: StartRoute;
  command: string;
  exitCode: number | null;
  stderr: string;
  started: boolean;
}

export function attemptDirectStart(spec: {
  route: StartRoute;
  binary: string;
  dataDir: string;
  port: number;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): RouteAttempt {
  const result = spawnSync(
    spec.binary,
    ['-D', spec.dataDir, '-p', String(spec.port), '-c', 'listen_addresses=127.0.0.1'],
    { encoding: 'utf8', timeout: spec.timeoutMs ?? 20_000, env: { ...process.env, ...(spec.env ?? {}) } }
  );
  const stderr = `${result.stderr ?? ''}${result.stdout ?? ''}`;
  // Fail closed. A process that ran until the timeout was serving; a process that exited 0 behaved as
  // the route intends. Anything else -- including an unexpected exit code such as 3 -- is not a start,
  // and a refusal wins over both signals unconditionally.
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const refused = /refusing to start/i.test(String(result.stderr ?? ''));
  const started = !refused && (timedOut || result.status === 0);
  return {
    route: spec.route,
    command: spec.binary,
    exitCode: result.status,
    stderr,
    started,
  };
}

/* -------------------------------------------------------------------------- */
/* Independent detection sentinel                                             */
/* -------------------------------------------------------------------------- */

export interface SentinelFinding {
  node: string;
  /** What the durable ledger says. */
  ledgerState: LedgerState | 'LEDGER_BROKEN';
  ledgerDetail: string;
  /** What the node is actually doing. */
  writable: boolean;
  /** Did the node answer at all? */
  reachable: boolean;
  /** True when the node serves writes while the ledger forbids it. */
  violation: boolean;
}

async function probeWritable(port: number): Promise<{ reachable: boolean; writable: boolean }> {
  const client = new Client({ host: '127.0.0.1', port, user: 'postgres', connectionTimeoutMillis: 1200 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const { rows } = await client.query<{ r: boolean }>('SELECT pg_is_in_recovery() AS r');
    return { reachable: true, writable: rows[0].r === false };
  } catch {
    return { reachable: false, writable: false };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Check every node against the ledger.
 *
 * This is the second, independent control. It shares nothing with the shim except the ledger file — it
 * does not ask the coordinator, does not rely on the shim having run, and reports on nodes the shim never
 * touched. It cannot prevent a start, which is why it is described as detection.
 */
export async function observeCluster(spec: {
  ledger: FenceLedger;
  nodes: Array<{ name: string; port: number }>;
}): Promise<SentinelFinding[]> {
  const findings: SentinelFinding[] = [];
  for (const node of spec.nodes) {
    const verification = spec.ledger.verify(node.name);
    const live = await probeWritable(node.port);
    const permitsServing = verification.intact && (verification.state === 'CLEAN' || verification.state === 'REJOINED');
    findings.push({
      node: node.name,
      ledgerState: verification.intact ? verification.state : 'LEDGER_BROKEN',
      ledgerDetail: verification.detail,
      reachable: live.reachable,
      writable: live.writable,
      violation: live.writable && !permitsServing,
    });
  }
  return findings;
}

/* -------------------------------------------------------------------------- */
/* Rejoin integrity beyond timeline equality                                   */
/* -------------------------------------------------------------------------- */

/**
 * Phase 37 accepted a rejoin when the candidate's timeline equalled the primary's. The user's objection is
 * correct: a standby's control-file timeline can lag a promotion, so equality is neither necessary nor
 * sufficient evidence that the node has caught up.
 *
 * This judges a rejoin on four independent facts:
 *
 * 1. **Timeline history** — the candidate's `pg_wal/*.history` must account for the primary's timeline.
 * 2. **Recovery state** — must be in recovery, and not paused (`pg_is_wal_replay_paused()`).
 * 3. **Replay progress** — `pg_last_wal_replay_lsn()` must reach the primary's `pg_current_wal_lsn()`
 *    within a tolerance window, so "in recovery" is not mistaken for "caught up".
 * 4. **Divergence** — the candidate must not hold WAL beyond the primary's current LSN.
 */
export interface RejoinFacts {
  candidate: {
    timeline: number;
    timelineSource: 'wal-file' | 'control-file';
    inRecovery: boolean;
    replayPaused: boolean | null;
    replayLsn: string | null;
    historyFiles: string[];
  } | null;
  primary: { timeline: number; currentLsn: string | null } | null;
  /** Bytes of LSN the candidate may trail the primary by before it is considered not caught up. */
  toleranceBytes?: number;
}

export interface RejoinAssessment {
  safe: boolean;
  reasons: string[];
  lagBytes: number | null;
}

/** Parse a PostgreSQL LSN like `0/4024BE0` into a bigint. */
export function parseLsn(lsn: string): bigint {
  const [hi, lo] = lsn.split('/');
  return (BigInt(`0x${hi}`) << 32n) + BigInt(`0x${lo}`);
}

export function assessRejoin(facts: RejoinFacts): RejoinAssessment {
  const reasons: string[] = [];
  const tolerance = BigInt(facts.toleranceBytes ?? 16 * 1024 * 1024);

  if (!facts.primary) {
    return { safe: false, reasons: ['authoritative primary is not readable'], lagBytes: null };
  }
  if (!facts.candidate) {
    return { safe: false, reasons: ['candidate is not readable'], lagBytes: null };
  }
  const { candidate, primary } = facts;

  if (!candidate.inRecovery) {
    reasons.push('candidate is not in recovery — it would serve writes');
  }
  if (candidate.replayPaused === true) {
    reasons.push('WAL replay is paused — the node is in recovery but deliberately not progressing');
  }

  // Timeline history: the candidate must know about every timeline up to the primary's.
  const missingHistory: number[] = [];
  for (let tl = 2; tl <= primary.timeline; tl += 1) {
    const expected = `${String(tl).padStart(8, '0')}.history`;
    if (!candidate.historyFiles.includes(expected)) missingHistory.push(tl);
  }
  if (missingHistory.length > 0) {
    reasons.push(
      `candidate has no timeline history for ${missingHistory.join(', ')} — it cannot have followed the primary's promotions`
    );
  }

  let lagBytes: number | null = null;
  if (candidate.replayLsn && primary.currentLsn) {
    const replay = parseLsn(candidate.replayLsn);
    const current = parseLsn(primary.currentLsn);
    if (replay > current) {
      reasons.push(
        `candidate has replayed to ${candidate.replayLsn}, beyond the primary's ${primary.currentLsn} — divergent history`
      );
      lagBytes = 0;
    } else {
      const lag = current - replay;
      lagBytes = Number(lag);
      if (lag > tolerance) {
        reasons.push(
          `candidate is ${lag} bytes behind the primary's ${primary.currentLsn} — in recovery but not caught up`
        );
      }
    }
  } else {
    reasons.push('replay position or primary position is unavailable — cannot establish catch-up');
  }

  // Timeline equality is required, but explicitly not sufficient and not the only check.
  if (candidate.timeline !== primary.timeline) {
    reasons.push(`timeline mismatch: candidate ${candidate.timeline} vs primary ${primary.timeline}`);
  }

  return { safe: reasons.length === 0, reasons, lagBytes };
}

/* -------------------------------------------------------------------------- */
/* WAL availability                                                            */
/* -------------------------------------------------------------------------- */

export interface WalAvailability {
  retrievable: boolean;
  detail: string;
  segmentsNeeded: string[];
}

/**
 * Determine whether a rewound node can actually complete recovery.
 *
 * A rewind moves the target back to the source's fork point. Everything the target must replay between
 * that point and the present has to come from somewhere: the primary's `pg_wal` (if not yet recycled), a
 * replication slot holding it, or an archive. Without any of those the node starts, requests WAL, and
 * waits — which from the outside is indistinguishable from a node that is merely slow, and is the exact
 * condition that looked like a fencing failure during Phase 37.
 */
export function assessWalAvailability(spec: {
  primaryWalDir: string;
  requiredSegments: string[];
}): WalAvailability {
  const missing = spec.requiredSegments.filter((segment) => !existsSync(`${spec.primaryWalDir}/${segment}`));
  if (missing.length === 0) {
    return {
      retrievable: true,
      detail: 'every required segment is present on the primary',
      segmentsNeeded: spec.requiredSegments,
    };
  }
  return {
    retrievable: false,
    detail:
      `missing ${missing.length} segment(s) on the primary: ${missing.join(', ')} — ` +
      'without a replication slot or WAL archive this node can never finish recovery',
    segmentsNeeded: spec.requiredSegments,
  };
}

/** Read the WAL segment files actually present on a primary. */
export function listWalSegments(walDir: string): string[] {
  try {
    return readdirSync(walDir).filter((name) => /^[0-9A-F]{24}$/.test(name));
  } catch {
    return [];
  }
}
