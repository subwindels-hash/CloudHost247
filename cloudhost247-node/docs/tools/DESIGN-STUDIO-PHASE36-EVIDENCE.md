# Design Studio — Phase 36 evidence: Patroni callback integration and enforced fencing

**Status: local investigation only. Nothing is deployed. Production certification is unchanged. The
split-brain blocker from Phase 33 is NOT closed by this phase — it is reproduced through Patroni's own
lifecycle and documented below.**

Date: 2026-11-10. Environment: Patroni 4.1.5 (raft DCS, 3 nodes), PostgreSQL 16.2, disposable local
clusters under `/tmp/ch247-p36`.

## What was asked

Move the ordering verified in Phase 35 into the real Patroni lifecycle and prove the coordinator cannot
expose a replacement primary before fencing is independently confirmed. Specifically: integrate with
real `on_role_change`/`on_stop` callbacks, require independent fencing confirmation, block promotion
when confirmation is missing or ambiguous, prevent a fenced former primary from restarting, require
`pg_rewind` or a rebuild before rejoin, verify VIP handling, and exercise coordinator crashes,
duplicate and missing callbacks, lost acknowledgements, quorum loss, and repeated cycles.

## The central finding: `pre_promote` is the only hook with veto power

Patroni's lifecycle callbacks are not equivalent, and treating them as if they were is how an unsafe
design gets shipped.

| Hook | Runs | Can it stop a promotion? |
| --- | --- | --- |
| `on_start`, `on_stop`, `on_restart`, `on_reload`, `on_role_change` | After the event | **No.** They report what already happened. |
| `before_stop` | Before PostgreSQL stops | No. Cannot refuse. |
| **`pre_promote`** | After the leader lock is acquired, **before** the replica is promoted | **Yes.** A non-zero exit prevents promotion **and** releases the leader key. |

From `patroni/postgresql/__init__.py`:

> Runs a fencing script after the leader lock is acquired but before the replica is promoted. If the
> script exits with a non-zero code, promotion does not happen and the leader key is removed from DCS.

So the safe ordering is not built from callbacks that *observe* the change. It is built from the one
hook that runs before the change and can refuse it. Everything below uses `pre_promote`.

## What the gate does

`tests/helpers/fencing/pre-promote.ts`, invoked by Patroni as `pre_promote`.

1. Read the last acknowledged leader from a journal file.
2. If there is no recorded leader, or the candidate was already the leader: **exit 0** without fencing.
   Guessing which node to kill is how a healthy primary dies.
3. Probe the previous leader's PostgreSQL directly (never ask the coordinator — it is the thing being
   checked up on).
4. If the probe reports **read-only**, there is nothing to fence. Fencing a healthy replica would break
   the cluster this is trying to keep.
5. Otherwise — **writable *or* unreachable** — fence it: kill the postmaster, then revoke write access to
   `pg_wal`.
6. Verify, with two independent signals:
   - the probe reports **read-only**, or
   - the node is **unreachable** *and* the fence command confirmed.
7. Anything else — including "unreachable but the fence did not confirm" — **exits 1**.

Step 5 is where an earlier version was wrong, and the error was not academic: see "The split brain this
phase actually reproduced" below. Step 7 is the other half: an unconfirmed fence produces an outage,
never a second primary. Exiting 0 on an ambiguous result would be the whole bug.

## Verified

Each row is a real 3-node Patroni cluster with real streaming replication; the gate is a real
subprocess that Patroni executes. Full run: `npm run test:patroni-integration`.

| # | Claim | Evidence |
| --- | --- | --- |
| 01 | A failover fences the still-writable former primary **before** promoting a successor | Leader's coordinator killed while its PostgreSQL kept running and was asserted writable. Journal: `pre_promote.start → pre_promote.fenced → pre_promote.confirmed`. Exactly **one** writable node afterwards. |
| 02 | A refused gate stops a real promotion | Survivor stayed `replica/running`; **zero** writable nodes; gate invocations recorded in the same window, so the outage is the gate's decision rather than a failure to hold an election. |
| 03 | The journal carries fenced/confirmed/refused/skipped events with timestamps and reasons | Journal summary asserted; every refusal carries a machine-readable reason. |
| 04 | The **storage** fence survives a restart, which the liveness fence cannot | The gate's own `fenceNode()` applied to a chosen node; `pg_ctl start` then failed with `FATAL: could not open file "pg_wal/000000030000000000000004": Permission denied`. The node cannot serve writes even though the start was attempted. |
| 05 | Repeated gate execution is journaled, idempotent and never crashes | Two consecutive runs, both exit 0, two journal entries; a crash would be indistinguishable from a refusal. |
| 06 | Stale leadership: no recorded leader ⇒ the gate fences nothing | `pre_promote.skip` recorded, exit 0. |
| 07 | **LIMIT:** a restarted primary never passes through `pre_promote` | Measured: postmaster killed, its own coordinator restarted it, it came back **writable** with **zero** gate invocations. |
| 08 | An independently restarted former primary does not produce two writers | Old node killed outright and never told it lost leadership; successor elected; old node started by hand with `pg_ctl`. Before the fix below: **2 writable primaries**. After: **1**, and it is the successor. |

## The split brain this phase actually reproduced

Test 08 failed on its first honest run with **two writable primaries**. Both were writing, the old node
had never been told it lost leadership, and the gate had reported success. This is the Phase 33 blocker,
reproduced through Patroni's own lifecycle rather than through a harness.

The cause was in the gate, not in Patroni. It fenced only when the probe found the old primary
*writable*:

```ts
if (before.state === 'writable') {  fence(...) }
else { /* "no fence needed" */ }
```

When the old primary had already stopped, the probe returned *unreachable* and the gate skipped fencing
entirely. Verification then passed on the "unreachable **and** the fence command confirmed" branch —
except there had been no fence command, only a default of `true`. The successor promoted, the old node
was started again, and its WAL was still writable.

The fix is that the gate fences on **writable or unreachable**. An unreachable node is not a fenced
node: it may be paused, partitioned, or about to be restarted by an init script. Killing the process
protects nothing in that case because there is no process to kill. Revoking write access to `pg_wal` is
the only fence that survives a restart — which matters doubly here, because the coordinator's recovery
path never consults the hook at all.

The lesson generalises: a fence whose success default is `true` will report success when it did nothing.
Every branch that skips fencing must prove independently that fencing was unnecessary, and "I could not
reach it" is not proof.

## The limitation that keeps the Phase 33 blocker open

Objective 5 — *prevent automatic restart of a fenced former primary* — is **not met by the gate alone**,
and this was measured rather than assumed (test 07).

`ha.py::enforce_primary_role` calls `Postgresql.promote()`, and therefore `pre_promote`, **only when the
node is not already a primary**:

```python
if self.state_handler.is_primary():
    ...
    return message          # <-- no promote(), no pre_promote
```

A primary whose PostgreSQL dies is restarted by its *own* coordinator and returns through the recovery
path. Two consequences, both observed:

- **A restarted primary comes back writable without consulting the gate.** Killing a postmaster and
  watching its coordinator recover it produces a writable primary with no gate invocation at all.
- **A duplicated coordinator can do the same.** Patroni does not fence a coordinator that is
  duplicated or resurrected while its PostgreSQL is already primary.

So the honest statement is: **`pre_promote` enforces the ordering for promotions. It does not enforce it
for recoveries.** Promotion is gated; recovery is not. A fenced node is only kept out because the fence
made its WAL unwritable, and because `pg_rewind` refuses to run against a stopped server — not because
the coordinator asked.

The Phase 33 finding therefore remains a production blocker. This phase narrows it: the promotion path
is now enforced by the coordinator rather than by a harness. The recovery path is not enforced at all.

## Requirement-by-requirement verdict

| Req | Requirement | Verdict |
| --- | --- | --- |
| 1 | Integrate fencing with real `on_role_change`/`on_stop` | **Partially met.** Integrated with the real hook that has veto power, `pre_promote`. `on_role_change`/`on_stop` were rejected for this purpose: they cannot stop a promotion. |
| 2 | Former primary fenced before another becomes available | **Met for promotions** (tests 01, 02). Not met for recoveries (test 07). |
| 3 | Independent fencing confirmation | **Met.** Two signals; corroboration is never a substitute for observation. |
| 4 | No promotion without confirmation | **Met** (test 02): refused gate ⇒ no primary. |
| 5 | No automatic restart of a fenced former primary | **Met by the fence, not by the coordinator.** The recovery path bypasses `pre_promote` (test 07), so a fenced node *is* restarted — but it cannot write, because its WAL is unwritable (test 04), and a restarted former primary does not become a second writer (test 08). |
| 6 | `pg_rewind` or rebuild before rejoin | **NOT MET.** The gate does not require `pg_rewind` before allowing a promotion. Divergent histories are still reconciled manually, and nothing verifies that reconciliation happened before a node is allowed back. |
| 7 | VIP removal/restoration on real interfaces | **NOT MET as specified.** `ip addr add 127.0.0.10/32 dev lo` → `RTNETLINK answers: Operation not permitted`. No interface or address manipulation is possible in this environment. |
| 8 | Coordinator crashes and callback failures | **Partially met.** Coordinator crash mid-transition covered (tests 01, 02, 08). Callback failure covered via a refusing gate. Duplicate invocation and stale leadership covered (tests 05, 06). A lost acknowledgement was not staged against the live coordinator. |
| 9 | Stale leadership notifications | **Partially met** (test 06). The gate refuses to act on leadership it cannot identify. Full stale-`on_role_change` delivery is untested. |
| 10 | Ordering across repeated real failover cycles | **Partially met.** The gate is idempotent across repeats (test 05), but a long repeated-cycle soak was not run. |

## Why requirement 7 cannot be met here

The sandbox denies network configuration:

```
$ ip addr add 127.0.0.10/32 dev lo
RTNETLINK answers: Operation not permitted
```

Adding a VIP requires `CAP_NET_ADMIN`. It is not available, and no alternative (network namespaces,
veth pairs, `iptables`) worked in Phase 34 either. A TCP listener can stand in for an *exposure
boundary*, but a listener is not a VIP: it proves routing logic, not that the address left the
interface. Claiming otherwise would make this report dishonest, so requirement 7 is recorded as unmet.

## Mandatory fault scenarios — status

| Scenario | Status |
| --- | --- |
| Patroni restarts mid-fencing | **Covered** (tests 01, 02, 08): the coordinator is killed at the worst moment. |
| Callback executes twice | **Covered** (test 05). |
| Callback never executes | **Covered** (test 07 — the recovery path never invokes it, and this is the defect). |
| Fencing succeeds but the acknowledgement is lost | **Partially covered.** The gate is idempotent and safe to re-run (test 05), but a lost-ack replay against a live coordinator was not staged. |
| Former primary restarts independently | **Covered** (test 08). This is the scenario that first failed with two writable primaries and then passed after the gate was fixed. |
| New primary fails immediately after promotion | **Not covered.** |
| VIP restoration fails | **Not testable** — see requirement 7. |
| Raft quorum disappears during transition | **Partly observed**: killing two of three coordinators removes quorum and there is no primary, which is correct but is not fencing. Distinguishing the two was the source of a false pass earlier in this phase. |

### A false pass worth recording

An earlier version of test 02 killed the leader's coordinator and asserted "no primary". It passed
while proving nothing: two of three coordinators were dead, so raft had no quorum and nobody could be
elected. The gate had not been consulted even once. The test now restores quorum first, records the
gate's invocation count before and after, and only then asserts. Any test that observes "no primary"
must show the gate ran in the same window, or it is measuring an outage it caused itself.

## Reproduce

```bash
cd cloudhost247-node
TEST_PATRONI_INTEGRATION=1 npm run test:patroni-integration
```

Requires Patroni 4.1.5 with `pysyncobj`, `psycopg[binary]`, and PostgreSQL 16.2 binaries. Uses ports
6701–6703 (PostgreSQL), 7211–7213 (raft), 9111–9113 (REST API). Removes `/tmp/ch247-p36` on exit.

## Files

- `tests/helpers/fencing/pre-promote.ts` — the gate. `verifyFenced()` is exported so tests call exactly
  what Patroni runs.
- `tests/integration/design-studio-templates-patroni-gate.test.ts` — the eight tests above.
- `npm run test:patroni-integration` — runs them; skips cleanly without `TEST_PATRONI_INTEGRATION=1`.
- `docs/tools/DESIGN-STUDIO.md` — the operational summary, updated to match.

No application code changed. `src/tools/design-studio/templates/repository.ts` is untouched.
