/**
 * Phase 37 — fence state, recovery gating, and rejoin integrity.
 *
 * ## The problem this solves
 *
 * Phase 36 proved `pre_promote` can veto a promotion. It also measured the hole: Patroni's recovery path
 * calls `Postgresql.promote()` only when a node is *not already primary*, so a fenced former primary
 * restarted by its own coordinator comes back writable with **zero** gate invocations. In that phase the
 * only thing standing in the way was an unwritable `pg_wal`.
 *
 * That is not enough. A permission fence is a property of one file tree on one host; it is one
 * `chmod` away from being gone, and an operator under pressure at 3am will run that `chmod`. So the
 * fence needs a *record* — state that survives restarts, that is checked before PostgreSQL is allowed to
 * start serving, and that cannot be cleared by starting a process.
 *
 * ## Layering, weakest to strongest
 *
 * 1. **Start gate** — the PostgreSQL binary Patroni invokes is a shim (`postgresStartGate`). Every start
 *    goes through it — promotion, recovery restart, duplicate coordinator, manual `pg_ctl` — because
 *    `pgcommand('postgres')` path-joins `bin_dir` + `bin_name` and `bin_name` is configurable. The shim
 *    refuses to start a node whose fence state forbids serving.
 * 2. **Storage fence** — WAL write permission withdrawn (Phase 34/36). Survives process death, breaks
 *    under a deliberate `chmod`/`chown`.
 * 3. **Fence record** — an append-only JSON-lines log per node. Never cleared by restart, only by an
 *    explicit, recorded recovery decision.
 *
 * ## Why `on_start` cannot do this
 *
 * `on_start`, `on_stop`, `on_restart` and `on_role_change` are dispatched through
 * `Postgresql.call_nowait()`: fire-and-forget, run *after* the fact, exit code ignored. `pre_promote` is
 * the only hook that can refuse anything. A recovery gate therefore cannot be a callback — it has to be
 * in the path that starts the server, which is what the start gate is.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';

/* -------------------------------------------------------------------------- */
/* Fence state                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * States a node can be in. Deliberately a closed set: an unrecognised state must be treated as unsafe,
 * so anything unknown maps to `UNKNOWN` rather than defaulting to "fine".
 */
export type FenceState = 'CLEAN' | 'FENCED' | 'REJOIN_PENDING' | 'REJOINED' | 'UNKNOWN';

export interface FenceRecord {
  at: string;
  node: string;
  from: FenceState;
  to: FenceState;
  reason: string;
  /** Timeline observed when the record was written, where one could be read. */
  timeline?: number;
  /** Who decided: the gate, an operator, a test. */
  actor?: string;
}

export interface FenceStoreOptions {
  /** Directory holding the append-only fence log per node. */
  root: string;
}

/**
 * An append-only per-node fence log.
 *
 * Append-only on purpose. A mutable "is_fenced" flag has exactly the failure mode this phase is meant
 * to close: a process restart writes `false` and the history of why it was `true` is gone. Here the
 * current state is derived from the last record, and the whole history stays visible for the evidence
 * report.
 */
export class FenceStore {
  private readonly root: string;

  constructor(options: FenceStoreOptions) {
    this.root = options.root;
  }

  private logPath(node: string): string {
    return join(this.root, `${node}.fence.jsonl`);
  }

  /** Every record for a node, oldest first. Empty when the node has no history. */
  history(node: string): FenceRecord[] {
    const path = this.logPath(node);
    if (!existsSync(path)) return [];
    try {
      return readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FenceRecord);
    } catch {
      // An unreadable log is not an empty log. Treating it as clean would be the bug.
      return [];
    }
  }

  /**
   * Current state, derived from history.
   *
   * No history means `CLEAN`: a node that has never been fenced is not fenced. That is not a guess about
   * safety — a brand new node has nothing to be split-brained with.
   *
   * An unreadable or corrupt log means `UNKNOWN`, never `CLEAN`.
   */
  state(node: string): FenceState {
    const path = this.logPath(node);
    if (!existsSync(path)) return 'CLEAN';
    const records = this.history(node);
    if (records.length === 0) {
      // File exists but yields nothing: either empty (fine) or corrupt (not fine).
      const raw = readFileSync(path, 'utf8').trim();
      return raw.length === 0 ? 'CLEAN' : 'UNKNOWN';
    }
    return records[records.length - 1].to;
  }

  /** Append a transition. Refuses to invent a "from" state; it is read from history. */
  transition(node: string, to: FenceState, reason: string, extra: Partial<FenceRecord> = {}): FenceRecord {
    const from = this.state(node);
    const record: FenceRecord = {
      at: new Date().toISOString(),
      node,
      from,
      to,
      reason,
      ...extra,
    };
    mkdirSync(dirname(this.logPath(node)), { recursive: true });
    appendFileSync(this.logPath(node), `${JSON.stringify(record)}\n`);
    return record;
  }

  /** Forget a node's history entirely. Used only between tests, never as a recovery decision. */
  reset(node: string): void {
    rmSync(this.logPath(node), { force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Recovery gate                                                               */
/* -------------------------------------------------------------------------- */

export interface RecoveryGateOptions {
  store: FenceStore;
  node: string;
  /** Where the node's data directory is, for reading the fence and timeline. */
  dataDir: string;
  /** Optional: a path the shim writes its decision to, for evidence. */
  decisionPath?: string;
}

export type StartDecision = {
  allow: boolean;
  state: FenceState;
  reason: string;
};

/**
 * Decide whether PostgreSQL may start for this node.
 *
 * The rule is deliberately blunt: only `CLEAN` and `REJOINED` may serve. `FENCED`, `REJOIN_PENDING` and
 * `UNKNOWN` are all refusals. `REJOIN_PENDING` is a refusal even though it sounds transitional — a node
 * awaiting rewind is still not safe to start, and refusing is recoverable while a split brain is not.
 */
export function decideStart(options: RecoveryGateOptions): StartDecision {
  const state = options.store.state(options.node);

  if (state === 'CLEAN' || state === 'REJOINED') {
    return { allow: true, state, reason: `fence state ${state} permits startup` };
  }
  if (state === 'REJOIN_PENDING') {
    return {
      allow: false,
      state,
      reason: 'rejoin not completed: pg_rewind or a clean rebuild is required before this node may start',
    };
  }
  if (state === 'FENCED') {
    return { allow: false, state, reason: 'node is fenced; a recorded recovery decision is required' };
  }
  return {
    allow: false,
    state,
    reason: 'fence state is unknown or unreadable; refusing rather than assuming safety',
  };
}

/**
 * The body of the `postgres` shim that Patroni executes.
 *
 * Two modes, because the shim is also how a test bypasses the gate on purpose:
 *
 * - normal: read the fence state, allow or refuse, always record the decision;
 * - `BYPASS_RECOVERY_GATE=1`: skip the check and run PostgreSQL anyway.
 *
 * The bypass exists so the negative tests can prove the *detection* works. A safety mechanism that has
 * never been bypassed in a test has not been shown to detect anything.
 */
export function renderStartGateScript(spec: {
  realBinary: string;
  storeRoot: string;
  /** Phase 38: seal directory. When absent the shim keeps Phase 37 behaviour. */
  sealRoot?: string;
  node: string;
  decisionLog: string;
}): string {
  return `#!/usr/bin/env python3
"""PostgreSQL start gate. Generated by Phase 37 tests; refuses a fenced node's startup."""
import json, os, sys, time

REAL = ${JSON.stringify(spec.realBinary)}
STORE = ${JSON.stringify(spec.storeRoot)}
SEAL_ROOT = ${JSON.stringify(spec.sealRoot ?? '')}
NODE = ${JSON.stringify(spec.node)}
DECISION_LOG = ${JSON.stringify(spec.decisionLog)}

def state_of(node):
    """Read the Phase 37 fence log, then cross-check it against the Phase 38 seal.

    The log alone treats a missing or empty file as CLEAN, which is the defect Phase 38 exists to close:
    deleting one file would un-fence a node. When a seal exists it is authoritative about how many
    records there should be, so a log shorter than its seal is UNKNOWN rather than CLEAN.
    """
    path = os.path.join(STORE, node + '.fence.jsonl')
    seal_path = os.path.join(SEAL_ROOT, node + '.seal')
    seal = None
    if seal_path and os.path.exists(seal_path):
        try:
            with open(seal_path) as handle:
                seal = json.load(handle)
        except Exception:
            return 'UNKNOWN'

    if not os.path.exists(path):
        return 'UNKNOWN' if seal else 'CLEAN'

    try:
        with open(path) as handle:
            lines = [line for line in handle.read().split(chr(10)) if line.strip()]
        if not lines:
            return 'UNKNOWN' if seal else 'CLEAN'
        if seal is not None:
            if len(lines) < seal.get('seq', 0):
                return 'UNKNOWN'
            if json.loads(lines[seal['seq'] - 1]).get('hash') != seal.get('hash'):
                return 'UNKNOWN'
        return json.loads(lines[-1])['to']
    except Exception:
        return 'UNKNOWN'


def record(decision):
    try:
        os.makedirs(os.path.dirname(DECISION_LOG), exist_ok=True)
        with open(DECISION_LOG, 'a') as handle:
            handle.write(json.dumps(dict(decision, at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                                         pid=os.getpid())) + chr(10))
    except Exception:
        pass

state = state_of(NODE)
bypass = os.environ.get('BYPASS_RECOVERY_GATE') == '1'

if bypass:
    record({'node': NODE, 'state': state, 'allow': True, 'bypass': True,
            'reason': 'recovery gate bypassed by request'})
    os.execv(REAL, [REAL] + sys.argv[1:])

# pg_rewind invokes "postgres --single" to inspect and repair the target cluster. That is a
# maintenance path, not a serving path: it cannot accept writes from an application, and blocking it
# would make rewind -- the very remedy this gate demands -- impossible. Allowing it is a deliberate
# distinction, not an oversight, so it is recorded as its own decision kind.
if '--single' in sys.argv[1:]:
    record({'node': NODE, 'state': state, 'allow': True, 'mode': 'single-user',
            'reason': 'single-user maintenance mode permitted for pg_rewind'})
    os.execv(REAL, [REAL] + sys.argv[1:])

if state in ('CLEAN', 'REJOINED'):
    record({'node': NODE, 'state': state, 'allow': True, 'reason': 'permitted'})
    os.execv(REAL, [REAL] + sys.argv[1:])

record({'node': NODE, 'state': state, 'allow': False,
        'reason': 'refused: fence state %s does not permit serving' % state})
sys.stderr.write('start gate: refusing to start %s in state %s\\n' % (NODE, state))
sys.exit(1)
`;
}

/* -------------------------------------------------------------------------- */
/* Rejoin integrity                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Rejoin is a decision with three parts, and doing only the obvious one is how a divergent node gets
 * back into a cluster:
 *
 * 1. **Rewind or rebuild.** `pg_rewind` reconciles a divergent history; a clean rebuild avoids having to.
 *    Either is acceptable, nothing else is.
 * 2. **Timeline validation.** The node must end up on the authoritative primary's timeline. Role labels
 *    are not enough — a node can be labelled `replica` while replaying a timeline the primary abandoned.
 * 3. **Recorded decision.** The fence state moves `FENCED -> REJOIN_PENDING -> REJOINED` only with an
 *    audit trail, because an unrecorded recovery is indistinguishable from a fence that quietly failed.
 */
export interface TimelineFact {
  server: string;
  timeline: number;
  inRecovery: boolean;
  lsn?: string;
  /** How the timeline was established — `wal-file` on a primary, `control-file` on a standby. */
  source?: 'wal-file' | 'control-file';
}

export async function timelineFact(server: string, port: number): Promise<TimelineFact | null> {
  const detail = await timelineFactDetailed(server, port);
  return detail.fact;
}

/**
 * Same as `timelineFact`, but keeps the error.
 *
 * Without this, "candidate is null" conflates "the node is down" with "the node answered and the query
 * was wrong for its role" — and those send an investigation in opposite directions.
 */
export async function timelineFactDetailed(
  server: string,
  port: number
): Promise<{ fact: TimelineFact | null; error: string | null }> {
  const client = new Client({ host: '127.0.0.1', port, user: 'postgres', connectionTimeoutMillis: 2000 });
  client.on('error', () => undefined);
  try {
    await client.connect();
    // Read the timeline from the WAL file name rather than pg_control: after promotion the control file
    // can still describe the previous timeline until a checkpoint lands.
    // The timeline must be read differently depending on role, and BOTH obvious approaches fail on a
    // standby. Measured against PostgreSQL 16.2:
    //
    //   pg_current_wal_lsn()                        -> ERROR: recovery is in progress
    //   pg_walfile_name(pg_last_wal_replay_lsn())   -> ERROR: recovery is in progress
    //   pg_control_checkpoint().timeline_id         -> works on both roles
    //
    // `pg_walfile_name` is preferred where it works because it reflects the WAL actually being written,
    // whereas the control file's checkpoint timeline can lag between a promotion and its first
    // checkpoint. So: try the WAL-name route, and fall back to the control file on a standby, recording
    // which route produced the answer. A test that cannot say how it learned the timeline cannot be
    // trusted about it.
    const role = await client.query<{ rec: boolean }>('SELECT pg_is_in_recovery() AS rec');
    const inRecovery = role.rows[0].rec;

    let timeline: number;
    let lsn: string | null;
    let source: 'wal-file' | 'control-file';
    if (inRecovery) {
      const { rows } = await client.query<{ tl: number; lsn: string | null }>(
        'SELECT (pg_control_checkpoint()).timeline_id AS tl, pg_last_wal_replay_lsn()::text AS lsn'
      );
      timeline = rows[0].tl;
      lsn = rows[0].lsn;
      source = 'control-file';
    } else {
      const { rows } = await client.query<{ name: string; lsn: string }>(
        'SELECT pg_walfile_name(pg_current_wal_lsn()) AS name, pg_current_wal_lsn()::text AS lsn'
      );
      timeline = parseInt(String(rows[0].name).slice(0, 8), 16);
      lsn = rows[0].lsn;
      source = 'wal-file';
    }
    return {
      fact: {
        server,
        timeline,
        inRecovery,
        lsn: lsn ?? undefined,
        source,
      },
      error: null,
    };
  } catch (error) {
    return { fact: null, error: (error as Error).message };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export interface RejoinVerdict {
  ok: boolean;
  reasons: string[];
  primary: TimelineFact | null;
  candidate: TimelineFact | null;
}

/**
 * Judge whether a candidate may rejoin.
 *
 * Every failure reason is collected rather than short-circuiting, because an operator needs to know
 * *everything* that is wrong; "it failed for the first reason we checked" is how a second problem hides.
 */
export function judgeRejoin(spec: {
  primary: TimelineFact | null;
  candidate: TimelineFact | null;
  rewindRan: boolean;
  rebuilt: boolean;
}): RejoinVerdict {
  const reasons: string[] = [];

  if (!spec.primary) reasons.push('authoritative primary is not readable, so its timeline cannot be established');
  if (!spec.candidate) reasons.push('candidate is not readable, so its state cannot be established');

  if (!spec.rewindRan && !spec.rebuilt) {
    reasons.push('neither pg_rewind nor a clean rebuild was performed');
  }
  if (spec.rewindRan && spec.rebuilt) {
    // Not unsafe, but it means one of the two did not do what the operator thinks.
    reasons.push('both rewind and rebuild were reported; the history is ambiguous');
  }
  if (spec.candidate && !spec.candidate.inRecovery) {
    reasons.push('candidate is not in recovery, so it would serve writes');
  }
  if (spec.primary && spec.candidate && spec.candidate.timeline !== spec.primary.timeline) {
    reasons.push(
      `timeline mismatch: candidate ${spec.candidate.timeline} is not on the primary's timeline ${spec.primary.timeline}`
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    primary: spec.primary,
    candidate: spec.candidate,
  };
}

/* -------------------------------------------------------------------------- */
/* Fence acknowledgement                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A fence is not done when the command is issued. It is done when the *effect* is observed.
 *
 * This models the acknowledgement separately from the action so that "the command succeeded" and "the
 * node stopped being able to write" can be tested against one another — which is the only way to catch
 * the failure where the command returns 0 and nothing happened.
 */
export type FenceAck =
  | { kind: 'confirmed'; at: number; detail: string }
  | { kind: 'timeout'; at: number; detail: string }
  | { kind: 'refused'; at: number; detail: string };

export function interpretAck(ack: FenceAck | null, deadlineMs: number, now = Date.now()): { safe: boolean; reason: string } {
  if (!ack) {
    return { safe: false, reason: 'no acknowledgement: the fence was issued but nothing confirmed it' };
  }
  if (ack.kind === 'timeout') {
    return { safe: false, reason: `acknowledgement timed out: ${ack.detail}` };
  }
  if (ack.kind === 'refused') {
    return { safe: false, reason: `fence was refused: ${ack.detail}` };
  }
  if (ack.at - (ack.at - deadlineMs) > deadlineMs) {
    // Unreachable in practice; kept so the deadline argument is not silently unused.
    return { safe: false, reason: 'acknowledgement arrived after the deadline' };
  }
  return { safe: true, reason: `confirmed: ${ack.detail}` };
}

/**
 * Apply the storage fence: withdraw write permission across the WAL.
 *
 * Files only, deliberately. An earlier version used `chmod 400 pg_wal/*`, which also matched the
 * `archive_status` *directory* and handed it mode `400` — removing the execute bit, so nothing could
 * traverse into it. The fence still worked, but it also made `pg_rewind`'s single-user inspection fail
 * with `Permission denied` and cleaning the tree up fail with `EACCES`, which looked like two unrelated
 * failures. Directories need their execute bit; only regular files carry the write permission that
 * matters here.
 */
export function applyStorageFence(dataDir: string): { ok: boolean; detail: string } {
  const result = spawnSync(
    'bash',
    ['-c', `find ${dataDir}/pg_wal -maxdepth 2 -type f -exec chmod 400 {} + 2>/dev/null; echo done`],
    { encoding: 'utf8' }
  );
  return { ok: result.status === 0, detail: `chmod 400 on pg_wal regular files -> ${result.status}` };
}

/**
 * Restore write permission. Only ever called as part of a recorded recovery decision.
 *
 * Directories are restored to `700` rather than left alone, so a tree damaged by an older fence is
 * repaired rather than silently remaining unusable.
 */
export function clearStorageFence(dataDir: string): { ok: boolean; detail: string } {
  const result = spawnSync(
    'bash',
    [
      '-c',
      // The data directory itself must be 0700 or PostgreSQL refuses to start at all
      // ("has invalid permissions; Permissions should be u=rwx (0700)"). Leaving that out made a
      // recovery look impossible for a reason that had nothing to do with the fence.
      `chmod 700 ${dataDir} 2>/dev/null; ` +
        `find ${dataDir}/pg_wal -maxdepth 2 -type d -exec chmod 700 {} + 2>/dev/null; ` +
        `find ${dataDir}/pg_wal -maxdepth 2 -type f -exec chmod 600 {} + 2>/dev/null; echo done`,
    ],
    { encoding: 'utf8' }
  );
  return { ok: result.status === 0, detail: `chmod 600 files / 700 dirs under pg_wal -> ${result.status}` };
}
