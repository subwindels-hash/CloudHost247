/**
 * Phase 38 — a fence ledger that cannot be silently reset, truncated or replaced.
 *
 * ## The defect this replaces
 *
 * Phase 37's `FenceStore` derived a node's state from "the last record in the log", and treated a missing
 * or empty log as `CLEAN`. That is the same mistake as a mutable boolean, wearing different clothes: the
 * state is durable only until someone deletes a file. Measured behaviour of the Phase 37 store:
 *
 *   after fencing        -> FENCED
 *   after DELETING log   -> CLEAN     (wrong)
 *   after TRUNCATING log -> CLEAN     (wrong)
 *   after FORGING a file -> CLEAN     (wrong)
 *
 * A coordinator restart is not even required. `rm` is enough to un-fence a node.
 *
 * ## What this does instead
 *
 * 1. **Hash chain.** Every record carries `seq` and `hash = H(seq, prevHash, payload)`. Editing any record
 *    breaks every subsequent hash, so a forged single record is detectable without trusting the writer.
 * 2. **Sealed high-water mark.** After every append, a separate file records `{seq, hash}`. That seal lives
 *    in its own directory so a single `rm` cannot remove both.
 * 3. **Absence is not cleanliness.** A seal with no log means the log was deleted -> `UNKNOWN`, which the
 *    start gate refuses. A log shorter than the seal means truncation -> `UNKNOWN`. A chain that does not
 *    verify -> `UNKNOWN`. Only a node with *no seal and no log* is `CLEAN`, because it has never been
 *    fenced and there is nothing to be split-brained with.
 *
 * ## What this still does not do
 *
 * It is same-host, same-filesystem. An attacker or a bad script with write access to both directories can
 * forge a consistent chain. This raises the bar from "delete one file" to "forge a whole history", and it
 * makes accidental loss (`rm`, truncation by a log rotation, a restore from a stale backup) fail closed
 * rather than open. It is **not** an independent failure domain, and it is not offered as one.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export type LedgerState = 'CLEAN' | 'FENCED' | 'REJOIN_PENDING' | 'REJOINED' | 'UNKNOWN';

export interface LedgerRecord {
  seq: number;
  at: string;
  node: string;
  from: LedgerState;
  to: LedgerState;
  reason: string;
  actor?: string;
  timeline?: number;
  prevHash: string;
  hash: string;
}

export interface LedgerVerification {
  state: LedgerState;
  /** Why the state is what it is — this string is what an operator reads at 3am. */
  detail: string;
  /** False whenever the ledger could not be trusted; the caller must then refuse. */
  intact: boolean;
  records: number;
  sealSeq: number | null;
}

const GENESIS = '0'.repeat(64);

function hashRecord(record: Omit<LedgerRecord, 'hash'>): string {
  const payload = JSON.stringify([
    record.seq,
    record.at,
    record.node,
    record.from,
    record.to,
    record.reason,
    record.actor ?? null,
    record.timeline ?? null,
    record.prevHash,
  ]);
  return createHash('sha256').update(payload).digest('hex');
}

export interface FenceLedgerOptions {
  /** Holds `<node>.fence.jsonl` — the same filename Phase 37's shim reads. Append-only. */
  logRoot: string;
  /**
   * Holds `<node>.seal`. Deliberately a *different* directory from `logRoot`, so that one careless
   * `rm -rf` of the log directory does not also remove the evidence that the log existed.
   */
  sealRoot: string;
}

export class FenceLedger {
  constructor(private readonly options: FenceLedgerOptions) {}

  /** Public so tests tamper with the real file rather than a hardcoded guess at its name. */
  logPath(node: string): string {
    return join(this.options.logRoot, `${node}.fence.jsonl`);
  }

  sealPath(node: string): string {
    return join(this.options.sealRoot, `${node}.seal`);
  }

  /** Read and verify the whole ledger. Never throws: an unreadable ledger is `intact: false`. */
  verify(node: string): LedgerVerification {
    const logExists = existsSync(this.logPath(node));
    const sealExists = existsSync(this.sealPath(node));

    let seal: { seq: number; hash: string } | null = null;
    if (sealExists) {
      try {
        seal = JSON.parse(readFileSync(this.sealPath(node), 'utf8')) as { seq: number; hash: string };
      } catch {
        return {
          state: 'UNKNOWN',
          detail: 'seal file is unreadable — cannot tell whether the ledger was tampered with',
          intact: false,
          records: 0,
          sealSeq: null,
        };
      }
    }

    // No log at all.
    if (!logExists) {
      if (seal) {
        return {
          state: 'UNKNOWN',
          detail: `fence log is MISSING but a seal records ${seal.seq} records — the log was deleted`,
          intact: false,
          records: 0,
          sealSeq: seal.seq,
        };
      }
      return {
        state: 'CLEAN',
        detail: 'no fence history and no seal: this node has never been fenced',
        intact: true,
        records: 0,
        sealSeq: null,
      };
    }

    const raw = readFileSync(this.logPath(node), 'utf8');
    const lines = raw.split('\n').filter(Boolean);

    if (lines.length === 0) {
      if (seal) {
        return {
          state: 'UNKNOWN',
          detail: `fence log is EMPTY but a seal records ${seal.seq} records — the log was truncated`,
          intact: false,
          records: 0,
          sealSeq: seal.seq,
        };
      }
      return { state: 'CLEAN', detail: 'fence log exists but is empty, and no seal', intact: true, records: 0, sealSeq: null };
    }

    const records: LedgerRecord[] = [];
    let prevHash = GENESIS;
    for (let i = 0; i < lines.length; i += 1) {
      let record: LedgerRecord;
      try {
        record = JSON.parse(lines[i]) as LedgerRecord;
      } catch {
        return {
          state: 'UNKNOWN',
          detail: `record ${i + 1} is not valid JSON — the log is corrupt`,
          intact: false,
          records: i,
          sealSeq: seal?.seq ?? null,
        };
      }
      if (record.seq !== i + 1) {
        return {
          state: 'UNKNOWN',
          detail: `record ${i + 1} claims seq ${record.seq} — records were removed or reordered`,
          intact: false,
          records: i,
          sealSeq: seal?.seq ?? null,
        };
      }
      if (record.prevHash !== prevHash) {
        return {
          state: 'UNKNOWN',
          detail: `record ${i + 1} does not chain to its predecessor — the log was edited`,
          intact: false,
          records: i,
          sealSeq: seal?.seq ?? null,
        };
      }
      const expected = hashRecord(record);
      if (record.hash !== expected) {
        return {
          state: 'UNKNOWN',
          detail: `record ${i + 1} fails its own hash — the record was edited`,
          intact: false,
          records: i,
          sealSeq: seal?.seq ?? null,
        };
      }
      prevHash = record.hash;
      records.push(record);
    }

    const last = records[records.length - 1];

    // The seal is the high-water mark. A log that is shorter than the seal has been rolled back.
    if (seal) {
      if (records.length < seal.seq) {
        return {
          state: 'UNKNOWN',
          detail: `log has ${records.length} records but the seal records ${seal.seq} — the log was rolled back or truncated`,
          intact: false,
          records: records.length,
          sealSeq: seal.seq,
        };
      }
      const sealed = records[seal.seq - 1];
      if (!sealed || sealed.hash !== seal.hash) {
        return {
          state: 'UNKNOWN',
          detail: `record ${seal.seq} does not match the sealed hash — the history was rewritten`,
          intact: false,
          records: records.length,
          sealSeq: seal.seq,
        };
      }
    } else if (records.length > 0) {
      // A log with no seal means the seal was deleted, which is just as suspicious as a missing log.
      return {
        state: 'UNKNOWN',
        detail: `log has ${records.length} records but no seal — the seal was deleted`,
        intact: false,
        records: records.length,
        sealSeq: null,
      };
    }

    return {
      state: last.to,
      detail: `verified ${records.length} records; chain intact; last transition ${last.from} -> ${last.to}`,
      intact: true,
      records: records.length,
      sealSeq: seal?.seq ?? null,
    };
  }

  state(node: string): LedgerState {
    return this.verify(node).state;
  }

  /**
   * Append a transition.
   *
   * Refuses to append onto an untrustworthy ledger: writing a new record on top of a tampered history
   * would bless it. Recovery has to be an explicit act, not a side effect of the next write.
   */
  transition(
    node: string,
    to: LedgerState,
    reason: string,
    extra: Partial<Pick<LedgerRecord, 'actor' | 'timeline'>> = {}
  ): LedgerRecord {
    const before = this.verify(node);
    if (!before.intact) {
      throw new Error(`refusing to append to a fence ledger that does not verify: ${before.detail}`);
    }

    const prevHash = before.records === 0 ? GENESIS : this.readLastHash(node);
    const partial: Omit<LedgerRecord, 'hash'> = {
      seq: before.records + 1,
      at: new Date().toISOString(),
      node,
      from: before.state,
      to,
      reason,
      ...extra,
      prevHash,
    };
    const record: LedgerRecord = { ...partial, hash: hashRecord(partial) };

    mkdirSync(dirname(this.logPath(node)), { recursive: true });
    appendFileSync(this.logPath(node), `${JSON.stringify(record)}\n`);

    // Seal after the append. If the process dies between the two, the log is ahead of the seal, which
    // verifies fine; the reverse (seal ahead of log) is what indicates tampering.
    mkdirSync(dirname(this.sealPath(node)), { recursive: true });
    const sealTmp = `${this.sealPath(node)}.tmp`;
    writeFileSync(sealTmp, JSON.stringify({ seq: record.seq, hash: record.hash }));
    renameSync(sealTmp, this.sealPath(node));

    return record;
  }

  private readLastHash(node: string): string {
    const lines = readFileSync(this.logPath(node), 'utf8').split('\n').filter(Boolean);
    return (JSON.parse(lines[lines.length - 1]) as LedgerRecord).hash;
  }

  /** Records, verified. Empty when the ledger does not verify — use `verify()` to see why. */
  history(node: string): LedgerRecord[] {
    if (!this.verify(node).intact) return [];
    try {
      return readFileSync(this.logPath(node), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LedgerRecord);
    } catch {
      return [];
    }
  }

  /** Remove all trace. Only for test setup — never a recovery decision. */
  reset(node: string): void {
    rmSync(this.logPath(node), { force: true });
    rmSync(this.sealPath(node), { force: true });
  }
}
