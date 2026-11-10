# Phase 33 — Fencing, Quorum and Single-Writer Verification

**Question**: does a real HA coordinator provide split-brain protection, and is the former primary
actually *prevented* from accepting writes before the new primary is exposed to traffic?

**Date**: 2026-11-10.
**Authorisation**: local disposable infrastructure only. No deployment, no provider operations, no
failover automation in any environment, **no application code changes**. Replication policy unchanged.

## Verdict

| Claim | Status |
| --- | --- |
| Quorum-based election works | **Yes** — Patroni 4.1.5, raft DCS, 3 nodes; exactly one primary at rest |
| A replica is read-only | **Yes** — writes refused |
| Killing the leader fails over safely | **Yes** — new leader in **18–20 s**; the dead node cannot write because it is not running |
| **A partitioned leader is prevented from writing** | **NO.** A leader that loses quorum but keeps its postmaster **keeps accepting writes** |
| **Two writable primaries occur** | **YES — reproduced twice.** Measured directly: `WRITABLE PRIMARIES SIMULTANEOUSLY: 2` |
| Demotion on quorum restoration | **Yes** — 3.1–3.2 s after the coordinator resumed |
| Divergent commits discarded on rejoin | **NO.** A row written during the window **survived** on the demoted node |

**Certification conclusions are unchanged. Production readiness is not claimed.**

## 1. What was actually run

| Component | Detail |
| --- | --- |
| Coordinator | **Patroni 4.1.5** (pip), **raft DCS** via `pysyncobj` |
| PostgreSQL | **16.2** × 3 nodes, `data-checksums`, async streaming replication |
| Cluster | `ttl: 20`, `loop_wait: 2`, `retry_timeout: 5` |
| Election | raft quorum across 3 coordinators |
| Tests | **6, all pass**, two consecutive runs |

Patroni is the coordinator a managed PostgreSQL deployment would actually use, not an imitation of one.
Its raft DCS is a real consensus implementation; no election logic was simulated in the test.

## 2. Results — `tests/integration/design-studio-templates-fencing.test.ts`

| # | Test | Result |
| --- | --- | --- |
| 01 | a leader is elected by quorum and exactly one node is writable | pass |
| 02 | a replica is read-only (single writer at rest) | pass |
| 03 | killing the leader promotes another node; the dead leader is genuinely gone | pass — **18.1 s / 20.1 s** |
| 04 | **a leader that loses quorum but keeps its postmaster keeps writing** | **pass — two writable primaries** |
| 05 | the rejoined node is a read-only standby on the current timeline | pass |
| 06 | revision integrity holds on the surviving primary | pass |

### 2.1 The benign failure (test 03)

SIGKILL the leader's coordinator **and** its postmaster. A new leader is elected in **18–20 s**, the
surviving data is intact, the new primary accepts writes, and exactly one server in the cluster is
writable.

Here the old primary cannot write for the simplest possible reason: **it is not running**. This is why
"failover worked" is not evidence of fencing — it is evidence that a process was dead.

### 2.2 The finding (test 04)

Freeze **only the coordinator** (`SIGSTOP`), leaving the postmaster alive and reachable. This models a
partition that isolates the control plane while the database keeps serving clients — the case where a
naive "the coordinator elected one leader, so we are safe" conclusion breaks.

Measured, twice:

| | Run A | Run B |
| --- | --- | --- |
| Isolated leader remains writable | **yes** | **yes** |
| Replacement leader elected | node2 | node2 |
| **Writable primaries simultaneously** | **2** | **2** |
| Divergent row written on isolated node | 777 | 777 |
| Visible on majority side | no | no |
| Demoted after coordinator resumed | node3, **3057 ms** | node2, **3210 ms** |
| Divergent row after rejoin | **still present on node3** | **still present on node2** |

```
[p33] isolated leader still writable after losing quorum: true
[p33] replacement leader: node2 while the isolated node remained writable: true
[p33] WRITABLE PRIMARIES SIMULTANEOUSLY: 2
[p33] node3 demoted after 3057 ms once the coordinator resumed
[p33] node1 rows: [ 1 ]   node2 rows: [ 1 ]   node3 rows: [ 1, 777 ]
```

**Patroni demotes the isolated leader only when the coordinator regains contact**, i.e. after the
partition heals. While partitioned, its postmaster keeps its `primary` role and keeps accepting writes.
Patroni's own log confirms demotion is reactive, not preventive:

> `ERROR: failed to update leader lock` → `INFO: Demoting self (immediate-nolock)` →
> `LOG: received immediate shutdown request`

That sequence occurred **after** the coordinator was resumed, not when quorum was lost.

### 2.3 Why the divergent row survived rejoin

The demoted node came back as a read-only standby (`standby.signal` present, writes refused) on the
current timeline — so the *cluster* looks healthy and every election-level check passes. Yet:

```
node1 rows: [ 1 ]   node2 rows: [ 1 ]   node3 rows: [ 1, 777 ]
```

Row 777 was committed by node3 while it was the isolated, still-writable primary. It appears nowhere on
the majority side. Patroni did **not** run `pg_rewind` on this node (no rewind appears in its log), so
the tuples written during the window remain in its heap even though it is now a standby.

Consequence: a reader attached to that node can observe writes that **never existed on the primary and
never will**. In this test the exposure was a read-only replica; at the time of writing it was a
genuinely writable primary. Neither is acceptable for a system whose central promise is that a stale
revision is refused — the revision sequence on that node is now off the cluster's sequence.

**This is the precise gap in the "coordinator elects one leader" model**, and it is why Patroni's
documentation insists on a real fencing mechanism rather than relying on demotion.

## 3. Prerequisites and operational conclusions

1. **Fencing must be external.** Patroni coordinates; it does not guarantee the old primary stops
   writing. Preventing a partitioned primary from writing requires something that can *unplug* it:
   STONITH/power fencing, an I/O fence, a network fence, or a watchdog. None of these existed in this
   sandbox — there is no `/dev/watchdog`, no `modprobe`, and no privileged access.
2. **Without fencing, a partition is not failover — it is split-brain.** The cluster will elect a
   replacement (correctly) and the old primary will keep writing (incorrectly) until the partition heals.
3. **Demotion is not enough.** It happens ~3 s after contact is restored, and it does not remove writes
   already committed during the window.
4. **Quorum requires a majority.** A 2-node cluster could not elect anyone after one failure (observed
   during setup: the survivor stayed a replica indefinitely). Three nodes are the minimum, and losing
   two means an outage rather than a split-brain — the safer of the two failures.

## 4. Limitations — what this does NOT establish

1. **No real network partition.** `SIGSTOP` on the coordinator is an *asymmetric* freeze; a true
   partition also cuts PostgreSQL's replication connections. Real partitions can produce more states
   (e.g. postgres losing its upstream while keeping its clients), and only one shape was reproduced.
2. **No fencing mechanism was implemented or evaluated.** This phrase is deliberate: the phase
   *demonstrated the need* for fencing and the consequence of its absence; it did not test STONITH,
   watchdogs, I/O fencing, or VIP removal.
3. **No production or staging verification**, and none implied. All nodes are on one host.
4. **No synchronous replication.** Policy unchanged from Phase 31/32. (`synchronous_commit` would not
   prevent §2.2 — a partitioned primary still commits locally.)
5. **Raft DCS, not etcd/Consul/Kubernetes.** Election timing and failure semantics differ per backend;
   only Patroni's raft implementation was exercised.
6. **No load, no repeated/soak cycling** beyond two runs, and no measurement of how many transactions a
   real split-brain window would admit.
7. **Application-level recovery was not re-tested here.** Phase 30–32 cover 409 handling and the
   ambiguous write; this phase changed no application code.

## 5. What this means for the template feature

The revision predicate is a **per-database** guarantee. It cannot defend against a second database that
independently believes it is the writer, and it cannot tell that a replica is serving tuples from a
timeline the cluster abandoned. Requirements that follow:

| Requirement | Reason |
| --- | --- |
| Any production deployment with automatic failover **must** have real fencing | §2.2: election alone leaves a writable old primary |
| Never point application traffic at a node without confirming it is the cluster's primary | a demoted node can hold writes that never reached the cluster |
| After a split-brain event, rejoin requires `pg_rewind` verification, not just "it is a replica now" | §2.3: the node was a healthy-looking standby with divergent rows |
| Fencing and replication policy are separate decisions | fencing stops the old writer; `synchronous_commit` narrows the loss window; neither substitutes for the other |

## 6. Reproduce

```bash
TEST_PATRONI=1 \
TEST_PATRONI_BIN=/tmp/pgenv/bin/patroni \
TEST_PG_BIN_DIR=/path/to/postgres/bin \
npm run test:fencing
```

Requires Patroni with the raft DCS (`pip install patroni pysyncobj "psycopg[binary]"`). The suite is
opt-in and destructive: it starts a 3-node cluster, kills a node, freezes a coordinator, and tears
everything down. It skips (loudly) when Patroni is absent.
