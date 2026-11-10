# Phase 35 — Automated Fencing Orchestration

**Question**: can the fencing mechanisms verified in Phase 34 be connected into one failover lifecycle
with **enforced ordering**, such that promotion never happens without confirmed fencing and every
ambiguous outcome fails closed?

**Date**: 2026-11-10.
**Authorisation**: local-only orchestration investigation. **No application source change** (verified:
nothing under `src/` was modified), no replication-policy change, no production/staging work, no
certification change.

**The Phase 33 production blocker remains open.** This phase makes the ordering testable; it does not
deploy it.

## Verdict

| Requirement | Status |
| --- | --- |
| Fencing authorised *before* replacement exposure | **Enforced and tested** |
| Promotion only after **confirmed** fencing | **Enforced and tested** |
| Ambiguous fencing → outage, not assumption | **Enforced and tested** (3 fault cases) |
| Exactly one replacement promoted | **Verified** |
| Traffic routed only after fencing confirmation | **Enforced** (`EXPOSED` is last) |
| Recovery gating before rejoin | **Verified** |
| Fencing controller failing mid-operation | **Verified fail-closed** |
| Repeated cycles keep the invariant | **Verified** (3 cycles) |
| Production HA readiness | **NOT CERTIFIED** |

**9 tests, all pass**, two consecutive runs (`tests/integration/design-studio-templates-orchestration.test.ts`).

## 1. The enforced order

The controller is `tests/helpers/fencing-controller.ts` — deliberately a **test-harness component, not
application code**. Every transition is journalled, so the ordering is asserted from evidence rather than
inferred from timing:

```
IDLE -> DETECTED -> FENCING_PENDING -> FENCED_VERIFIED -> PROMOTED -> EXPOSED
```

The invariant is expressed as a guard, not a comment: `PROMOTED` is reachable only from
`FENCED_VERIFIED`, and `EXPOSED` only after `PROMOTED`. A test that skipped to promotion would throw
`refusing PROMOTED: controller is in …, expected FENCED_VERIFIED`.

`FENCED_VERIFIED` is not raised by the fence command. It requires a **positive, independent** signal.

## 2. What counts as "confirmed fencing" — and why one signal is not enough

This was the substantive design problem, and the first two attempts were wrong in instructive ways:

| Rule | Consequence | Verdict |
| --- | --- | --- |
| Probe must report "not writable" | A **killed** node is unreachable, never "not writable" → **every real fence became unverifiable** | fail-closed to the point of useless |
| Probe unreachable ⇒ fenced | Treats a slow/partitioned node as fenced → manufactures split brains | unsafe |
| **Unreachable + fence command confirmed success** | Two independent signals agree | **adopted** |
| **Probe completes and reports read-only** | Direct evidence | **adopted** |
| Unreachable + fence outcome unknown | Indistinguishable from a failed fence | **outage** |

The adopted rule requires corroboration across two failure domains: the command's report (process/power
layer) *and* the database's observed reachability. Neither is trusted alone.

The same flaw existed in the rejoin gate and was fixed identically: defaulting "unreachable" to
"writable" made rejoin impossible for every correctly fenced node. It now distinguishes *reachable and
writable* (refuse), *reachable and read-only* (eligible), and *unreachable* (eligible — it cannot serve
anything while it is down).

## 3. Results

| # | Test | Result |
| --- | --- | --- |
| 01 | refuses to fail over while the old primary is writable AND still leader | pass — nothing fenced, nothing exposed |
| 02 | happy path: fence → VERIFY → promote → expose | pass — journal order asserted |
| 03 | **fence executes but its confirmation is lost** | pass — `FAILED_CLOSED`, no promotion |
| 04 | **fence that does not take effect** | pass — verification catches it |
| 05 | **unreachable probe is not evidence of a fence** | pass — refuses to promote |
| 06 | **replacement dies right after promotion** | pass — no fallback to the old primary |
| 07 | rejoin gating | pass — a restarted node is **writable** and is refused |
| 08 | reconciled node does not serve divergent data | pass — standby is genuinely read-only |
| 09 | three repeated failover/recovery cycles | pass — invariant holds every cycle |

### 3.1 The fault cases, verbatim

```
[p35] lost confirmation -> FAILED_CLOSED | fencing unverified — outage instead of split brain
[p35] no-op fence        -> FAILED_CLOSED | fencing unverified — outage instead of split brain
[p35] unreachable probe  -> refused to promote
[p35] restarted fenced node is writable? true
```

Test 01 is the mirror-image safeguard: a **stale alert** must not cause a healthy primary to be fenced.
If the old primary is still writable *and* still the leader, the controller refuses outright rather than
starting a fence it cannot justify.

Test 06 is the one that would be tempting to get wrong. When the replacement dies after promotion, the
"helpful" recovery is to un-fence the old primary. The controller refuses: the old primary was fenced
because its state could not be trusted, and restoring it would recreate two writers. **Outage, not
fallback.**

### 3.2 A finding about restarts

Test 07 shows that a crashed node restarted by an init script comes back **writable** (`true`), holding a
divergent timeline. This is the Phase 32/33 hazard in its most likely operational form: nothing in
PostgreSQL prevents it, and only an external supervisor that refuses to start a fenced node fixes it.

### 3.3 The replacement is a real standby

An earlier version of this suite provisioned the replacement as an independent cluster. `pg_ctl promote`
on a standalone node is a no-op, so the test was asserting nothing about promotion. The replacement is
now built with `pg_basebackup -R -X stream` from the old primary, exactly as Phases 31–32 did, and the
promotion is verified by reading `pg_is_in_recovery()` from the promoted server.

## 4. What "real" means in this suite

| Port | Real action |
| --- | --- |
| `probeWritable` | opens a connection, asks `pg_is_in_recovery()` |
| `fence` | `SIGKILL` on the postmaster's **process group** (the STONITH mechanism verified in Phase 34) |
| `promote` | `pg_ctl promote` on a real streaming standby |
| `expose` | records the routing decision; stands in for a VIP move |
| `reconcile` | no-op here — `pg_rewind` was verified in Phase 32 |

Fault injection is real too: the process is genuinely killed, the replacement is genuinely killed, and
the "lost confirmation" case is produced by a fence that performs its work and then throws.

## 5. Acceptance criteria — status

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Replacement not application-writable until the old one is fenced | **Verified** (ordering enforced) |
| 2 | Isolated former primary cannot commit | **Verified** (Phase 34 mechanisms + probes here) |
| 3 | Only one authoritative writable primary | **Verified per failover**; not achieved by election alone (Phase 33) |
| 4 | Divergent timelines detected | Phase 32 (`pg_rewind`/timeline history); not re-tested here |
| 5 | `pg_rewind`/rebuild restores consistency | Phase 32 |
| 6 | Rejoining nodes cannot serve stale data | **Verified** — gate + read-only standby |
| 7 | Results independently recorded | This document |

## 6. Limitations — what this does NOT establish

1. **The controller is not wired into Patroni.** Ordering is enforced by this harness, not by the
   coordinator. A real deployment must make the coordinator (or an operator) obey it; Patroni's
   `on_role_change`/`on_stop` callbacks are the obvious hook and were **not** implemented.
2. **No real quorum/raft integration.** Phase 33 showed raft elects a leader; this phase fences on a
   trigger from outside. Nothing here coordinates fencing with quorum membership changes.
3. **`expose` is a recorded decision, not a VIP move over a network.** Phase 34 verified address
   removal is real; here it is a port call.
4. **Fencing is process-group SIGKILL**, not power fencing. Phase 34's WAL-permission fence is the
   alternative tested mechanism, and hardware watchdogs remain unavailable.
5. **No production or staging verification**, none implied. Single host, no real network.
6. **No load or long soak.** Three cycles is repetition, not endurance.
7. **No application behaviour change.** Retry semantics, 409 handling and the ambiguous-commit question
   are Phase 30–32 territory and were not touched.

## 7. Reproduce

```bash
TEST_ORCHESTRATION=1 \
TEST_PG_BIN_DIR=/path/to/postgres/bin \
npm run test:orchestration
```

Opt-in and destructive: creates primaries, streams real standbys, kills process groups and promotes
standbys. Skips (loudly) otherwise, and leaves nothing running.
