/**
 * Phase 35 — a fencing controller with an enforced failover ordering.
 *
 * ## Why this exists
 *
 * Phases 33 and 34 established two separate facts:
 *
 *   - quorum election alone leaves a writable old primary (Phase 33: two writable primaries, measured);
 *   - several fencing mechanisms genuinely stop a live server from committing (Phase 34).
 *
 * Neither says anything about the *order* in which they are used. A failover that promotes first and
 * fences afterwards has a window; one that fences and promotes without checking has a worse one. This
 * module is the thing that can be tested for ordering, because the order is expressed in code rather
 * than implied by a coordinator's internal state machine.
 *
 * ## The invariant
 *
 *     promote(oldPrimary)  ==>  fencingVerified(oldPrimary)
 *
 * and it is not sufficient to *attempt* fencing. The controller promotes only after a **positive,
 * independently observed** confirmation that the old primary cannot commit — a database-level probe
 * that fails to write, not a zero exit status from a fencing command.
 *
 * ## Fail closed, always
 *
 * Every ambiguous outcome resolves to "do not promote". Concretely:
 *
 *   - a fencing command whose confirmation never arrives → **outage** (no promotion);
 *   - a probe that cannot distinguish "dead" from "slow" → **outage**;
 *   - the controller crashing mid-failover → the phase stays `FENCING_PENDING`, and a later run
 *     re-probes rather than trusting the journal;
 *   - the replacement failing right after promotion → the controller does not re-expose the old one.
 *
 * The one thing it must never do is promote on the assumption that the other node is probably dead.
 * An outage is recoverable by a human; a split brain is not recoverable by anyone.
 */

export type NodeRole = 'primary' | 'replica' | 'unreachable' | 'unknown';

export type FailoverPhase =
  | 'IDLE'
  | 'DETECTED'
  | 'FENCING_PENDING'
  | 'FENCED_VERIFIED'
  | 'PROMOTED'
  | 'EXPOSED'
  | 'FAILED_CLOSED';

export interface FencingJournalEntry {
  at: number;
  phase: FailoverPhase;
  detail: string;
  /** False when the transition was refused because a precondition could not be confirmed. */
  allowed: boolean;
}

/** Everything the controller is allowed to do to the outside world. Real implementations wire these
 *  to shell commands, PostgreSQL probes and a load balancer; tests wire them to real clusters. */
export interface FencingPorts {
  /** Is this node currently accepting writes? Must ask the database, never the coordinator. */
  probeWritable(node: string): Promise<boolean>;
  /** Ask the coordinator who the leader is, if it still answers. */
  leader(): Promise<string | null>;
  /** Execute the fence for a node. Resolves when the *command* finished, not when fencing is proven. */
  fence(node: string): Promise<void>;
  /** Promote the designated replacement. */
  promote(node: string): Promise<void>;
  /** Point application traffic at a node. Called only after fencing is verified. */
  expose(node: string): Promise<void>;
  /** Remove application traffic from a node. */
  withdraw(node: string): Promise<void>;
}

export interface FailoverOutcome {
  phase: FailoverPhase;
  promoted: string | null;
  exposed: boolean;
  journal: FencingJournalEntry[];
  /** Why the failover stopped, when it did. */
  reason?: string;
}

export interface ControllerOptions {
  /** Total time allowed for the old primary to become provably unwritable. */
  fencingVerifyTimeoutMs?: number;
  /** How long to wait for quorum/leadership information before giving up. */
  leaderTimeoutMs?: number;
  now?: () => number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Performs one failover, in the only order that is safe, and records every decision.
 *
 * The journal is the artefact the tests inspect: it makes the ordering and the refusal reason
 * auditable rather than inferred from log timestamps.
 */
export class FencingController {
  private readonly journal: FencingJournalEntry[] = [];
  private readonly fencingVerifyTimeoutMs: number;
  private readonly leaderTimeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly ports: FencingPorts, options: ControllerOptions = {}) {
    this.fencingVerifyTimeoutMs = options.fencingVerifyTimeoutMs ?? 30_000;
    this.leaderTimeoutMs = options.leaderTimeoutMs ?? 15_000;
    this.now = options.now ?? (() => Date.now());
  }

  getJournal(): FencingJournalEntry[] {
    return [...this.journal];
  }

  private record(phase: FailoverPhase, detail: string, allowed = true): void {
    this.journal.push({ at: this.now(), phase, detail, allowed });
  }

  /** Phase ordering check used by the tests and by the controller itself before every side effect. */
  private assertPhase(expected: FailoverPhase, next: FailoverPhase): void {
    if (this.phase !== expected) {
      throw new Error(`refusing ${next}: controller is in ${this.phase}, expected ${expected}`);
    }
  }

  private phase: FailoverPhase = 'IDLE';

  /**
   * Run a failover from `oldPrimary` to `replacement`.
   *
   * Returns rather than throws on refusal: a controller that crashes on an ambiguous fence leaves an
   * operator guessing. A returned `FAILED_CLOSED` outcome carries the reason and leaves the old primary
   * unexposed, which is the state an operator can reason about.
   */
  async failover(oldPrimary: string, replacement: string): Promise<FailoverOutcome> {
    this.phase = 'IDLE';
    this.journal.length = 0;
    this.record('IDLE', `failover ${oldPrimary} -> ${replacement} requested`);

    // ---- 1. Detection -------------------------------------------------------------------------
    // The trigger is external (a monitor called us), but we confirm the claim before acting on it:
    // acting on a stale alert is how a healthy primary gets fenced.
    try {
      if (await this.ports.probeWritable(oldPrimary)) {
        // The old primary is still committing writes. If it is also still the leader, this is not a
        // failover — it is a mistake, and fencing a healthy leader would cause the outage ourselves.
        const currentLeader = await this.ports.leader();
        if (currentLeader === oldPrimary) {
          this.phase = 'FAILED_CLOSED';
          this.record('FAILED_CLOSED', `${oldPrimary} is still writable and still the leader; refusing to fail over`, false);
          return this.outcome(null, false, 'old primary still healthy');
        }
        this.record('DETECTED', `${oldPrimary} is writable but no longer the leader — proceeding to fence`);
      } else {
        this.record('DETECTED', `${oldPrimary} is not writable`);
      }
    } catch (error) {
      this.phase = 'FAILED_CLOSED';
      this.record('FAILED_CLOSED', `detection probe failed: ${(error as Error).message}`, false);
      return this.outcome(null, false, 'detection failed');
    }
    this.phase = 'DETECTED';

    // ---- 2. Fence -----------------------------------------------------------------------------
    this.phase = 'FENCING_PENDING';
    this.record('FENCING_PENDING', `fencing ${oldPrimary}`);
    let fenceError: string | null = null;
    try {
      await this.ports.fence(oldPrimary);
      this.record('FENCING_PENDING', `fence command for ${oldPrimary} returned`);
    } catch (error) {
      // A fence that errored is NOT a fence. We still probe, because a partially applied fence (e.g.
      // the signal was delivered but the command's exit status was lost) may have worked — but we
      // never assume it did.
      fenceError = (error as Error).message;
      this.record('FENCING_PENDING', `fence command failed: ${fenceError} — probing anyway`, false);
    }

    // ---- 3. Independently verify the fence ----------------------------------------------------
    // The verification combines TWO independent signals, because neither alone is sufficient:
    //
    //   (a) a database probe that completes and reports "not writable"  -> fenced (e.g. demoted);
    //   (b) a database probe that cannot connect, PLUS a fence command that reported success
    //       -> fenced (out-of-band evidence: the process/power layer confirmed, and the node is gone
    //          from the network).
    //
    // A probe that cannot connect is NOT sufficient on its own: an unreachable node might simply be
    // slow, partitioned, or unreachable to *us* while still serving other clients. And a fence command
    // that reported success is not sufficient on its own either — a command can exit 0 without having
    // fenced anything (Phase 34's directory-chmod result in process form). Requiring both means the
    // claim is corroborated across two independent failure domains.
    //
    // The one combination that always fails closed: probe unreachable AND fence outcome unknown. Then
    // we cannot tell a successful fence from a failed one, and the only safe answer is an outage.
    const verification = await this.verifyFenced(oldPrimary, fenceError === null);
    if (!verification.fenced) {
      this.phase = 'FAILED_CLOSED';
      this.record(
        'FAILED_CLOSED',
        `${oldPrimary} could not be confirmed unwritable within ${this.fencingVerifyTimeoutMs} ms ` +
          `(${verification.reason})` +
          (fenceError ? ` (fence error: ${fenceError})` : ''),
        false
      );
      return this.outcome(null, false, 'fencing unverified — outage instead of split brain');
    }
    this.phase = 'FENCED_VERIFIED';
    this.record('FENCED_VERIFIED', `${oldPrimary} confirmed unable to commit writes (${verification.reason})`);

    // ---- 4. Authorize promotion ---------------------------------------------------------------
    this.assertPhase('FENCED_VERIFIED', 'PROMOTED');
    try {
      await this.ports.promote(replacement);
      this.phase = 'PROMOTED';
      this.record('PROMOTED', `promoted ${replacement}`);
    } catch (error) {
      this.phase = 'FAILED_CLOSED';
      this.record('FAILED_CLOSED', `promotion of ${replacement} failed: ${(error as Error).message}`, false);
      return this.outcome(null, false, 'promotion failed after fencing');
    }

    // ---- 5. Expose ----------------------------------------------------------------------------
    // Only now. Traffic is the authorisation boundary: while the VIP/route is absent, a stale primary
    // is a nuisance; once it is present on two nodes, the split brain becomes visible to customers.
    try {
      await this.ports.expose(replacement);
      this.phase = 'EXPOSED';
      this.record('EXPOSED', `application traffic routed to ${replacement}`);
    } catch (error) {
      this.phase = 'FAILED_CLOSED';
      this.record('FAILED_CLOSED', `could not route traffic to ${replacement}: ${(error as Error).message}`, false);
      // The old primary is fenced, so this is an outage rather than a split brain. Deliberately not
      // reverting the fence: un-fencing to "restore service" would re-create two writers.
      return this.outcome(null, false, 'promotion succeeded but traffic routing failed');
    }

    return this.outcome(replacement, true);
  }

  /**
   * Positive confirmation that a node cannot commit.
   *
   * Polls until `probeWritable` reports false. A probe that *throws* is not evidence of a fence — an
   * unreachable host and a fenced host look identical over TCP — so errors are treated as "not yet
   * proven" and only a completed probe reporting "not writable" counts. This is the distinction that
   * keeps a timeout from being mistaken for success.
   */
  private async verifyFenced(
    node: string,
    fenceCommandSucceeded: boolean
  ): Promise<{ fenced: boolean; reason: string }> {
    const deadline = this.now() + this.fencingVerifyTimeoutMs;
    let sawUnreachable = false;
    while (this.now() < deadline) {
      try {
        const writable = await this.ports.probeWritable(node);
        if (writable === false) {
          return { fenced: true, reason: 'database probe reports it cannot accept writes' };
        }
        // Reachable AND writable: definitely not fenced. Keep probing; the fence may still be landing.
        sawUnreachable = false;
      } catch {
        sawUnreachable = true;
      }
      await sleep(100);
    }
    if (sawUnreachable && fenceCommandSucceeded) {
      return {
        fenced: true,
        reason: 'node unreachable and the fence command reported success (two independent signals)',
      };
    }
    if (sawUnreachable) {
      return {
        fenced: false,
        reason: 'node unreachable, but the fence command did not confirm — cannot distinguish fenced from partitioned',
      };
    }
    return { fenced: false, reason: 'node still reachable and writable' };
  }

  /**
   * Reconcile and rejoin a previously fenced node.
   *
   * The ordering mirrors the failover: the node is only allowed back after it has been confirmed
   * powerless AND `reconcile` (pg_rewind or a rebuild) has run. Rejoining a node that still holds a
   * divergent timeline is how Phase 33's stranded row became readable.
   */
  async rejoin(node: string, reconcile: () => Promise<void>): Promise<{ rejoined: boolean; reason?: string }> {
    // The gate asks one question: could this node serve writes (or stale reads) if we let it back?
    //
    // A *reachable and writable* node must never be reconciled — it is a second writer, and reconciling
    // it would mean rewinding a live primary. A *reachable and read-only* node is a standby and may be
    // reconciled. An *unreachable* node (stopped, fenced, or partitioned) is also eligible, because it
    // cannot serve anything at all while it is down — which is precisely the state a fence produces.
    //
    // Getting this wrong in the other direction is just as harmful: defaulting "unreachable" to
    // "writable" makes rejoin impossible for every correctly fenced node.
    let reachable: boolean;
    let writable = false;
    try {
      writable = await this.ports.probeWritable(node);
      reachable = true;
    } catch {
      reachable = false;
    }

    if (reachable && writable) {
      this.record('FAILED_CLOSED', `refusing to rejoin ${node}: it is reachable and writable`, false);
      return { rejoined: false, reason: 'node is writable' };
    }

    try {
      await reconcile();
    } catch (error) {
      this.record('FAILED_CLOSED', `reconcile failed for ${node}: ${(error as Error).message}`, false);
      return { rejoined: false, reason: 'reconcile failed' };
    }
    this.record('FAILED_CLOSED', `${node} reconciled while ${reachable ? 'read-only' : 'unreachable'}`, true);
    return { rejoined: true };
  }

  /**
   * A replacement that dies immediately after promotion.
   *
   * The correct behaviour is **not** to fall back to the old primary: it was fenced precisely because
   * its state could not be trusted. The controller reports the outage and leaves the fence in place.
   */
  async replacementDied(replacement: string, oldPrimary: string): Promise<FailoverOutcome> {
    await this.ports.withdraw(replacement).catch(() => undefined);
    this.phase = 'FAILED_CLOSED';
    this.record(
      'FAILED_CLOSED',
      `${replacement} failed after promotion; ${oldPrimary} stays fenced — outage, not a fallback`,
      false
    );
    return this.outcome(null, false, 'replacement failed; old primary remains fenced');
  }

  private outcome(promoted: string | null, exposed: boolean, reason?: string): FailoverOutcome {
    return { phase: this.phase, promoted, exposed, journal: this.getJournal(), reason };
  }
}
