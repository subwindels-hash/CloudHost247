# Phase 34 — Real Fencing Mechanism Verification

**Question**: can actual fencing stop a live PostgreSQL from committing, rather than asking a
coordinator to demote it?

**Date**: 2026-11-10.
**Authorisation**: local disposable infrastructure only. No deployment, no provider operations, no
failover automation, **no application code changes**. Existing reports and certification decisions
preserved.

**The Phase 33 blocker remains open.** This phase establishes which fencing mechanisms *work*; it does
not turn any of them into a deployed failover design, and it does not certify HA readiness.

## Verdict — mechanism by mechanism

| Mechanism | Verified enforcement | Result |
| --- | --- | --- |
| **Storage fencing** | revoking write on `pg_wal/*` | **Works** — live server PANICs, refuses all writes |
| **STONITH** | `SIGKILL` postmaster process group | **Works** — permanent, no auto-restart |
| **Network fencing** | namespace with no route to the server | **Works** — connection impossible |
| **VIP management** | address removed from the interface | **Works** — address provably gone |
| **Watchdog** | node terminates itself when leadership proof fails | **Works** — process gone, writes impossible |
| **Recovery gating** | fenced node cannot start serving | **Works** — refuses to start while fenced |
| **`chmod 500` on the data directory** | — | **DOES NOT FENCE.** Server keeps committing |

**8 tests, all pass**, two consecutive runs (`tests/integration/design-studio-templates-fencing-mechanisms.test.ts`).

## 1. The most important result is a negative one

`chmod 500` on a running PostgreSQL's **data directory does not fence it** (test 02). The server already
holds its file descriptors open, and directory permissions do not retroactively apply to them. It
continues to commit normally.

This matters because a directory chmod is the intuitive "make it read-only" move, and a failover design
that relied on it would believe it had fenced a node that was still fully writable. The fence only bites
when the files the server must **extend** become unwritable.

## 2. Storage fencing: what actually works (test 03)

Revoking write permission on `pg_wal/*` produces an immediate, hard failure:

```
capEff: '0000000000000000'
committed: false
error: 'could not open file "pg_wal/000000010000000000000001": Permission denied'
```

Server log:

```
PANIC:  could not open file "pg_wal/...": Permission denied
LOG:  checkpointer process was terminated by signal 6: Aborted
LOG:  all server processes terminated; reinitializing
```

Two details that make this trustworthy:

* **`CapEff: 0000000000000000`** — the postmaster runs with **zero capabilities**, so file permissions
  genuinely bind. There is no `CAP_DAC_OVERRIDE` for it to bypass the fence with.
* **The fence is durable, not cosmetic.** After the fence was lifted and the server recovered, the row
  count was **1 before and 1 after**: the write attempted while fenced was never committed. The client
  received an error *and* the data layer refused it — not just one or the other.

Note the shape of the failure: PostgreSQL **PANICs** rather than returning a clean "read-only" error. A
fence that stops writes this way takes the node down hard, which is the correct behaviour for fencing
(the node must not be trusted afterwards) but requires the recovery step in §6.

## 3. STONITH (test 04)

`SIGKILL` on the postmaster's **process group** removes the postmaster, checkpointer, background writer
and every backend at once. Verified: the process is gone, writes are impossible, the row count is
unreadable, and **nothing restarts it** after a further 2 s. A fencing agent must own the restart
decision; the node does not resurrect itself.

## 4. Network fencing and VIP (tests 05, 06)

* **Network fence**: a probe from a network namespace with no route to the server returns
  `BLOCKED`. This is kernel isolation rather than a firewall rule that a bug or a reboot could remove.
  Importantly the server process is **still alive** — network fencing hides a node, it does not kill it,
  so the node still needs reconciliation before it may rejoin.
* **VIP**: an address added to and then removed from an interface is observably present and then gone
  (`VIP PRESENT` → `VIP GONE`). Application traffic can only reach whichever node holds the address,
  which is exactly the authorisation gate the acceptance criteria ask for.

## 5. Watchdog (test 07)

The pattern verified: a node that cannot prove continued leadership **terminates itself**. Modelled with
a real timer and a real signal because this sandbox has no `/dev/watchdog` device and cannot load
`softdog`; what is verified is the *effect the design depends on* — the node removes its own ability to
write without waiting for anyone else to act.

## 6. Recovery gating (test 08)

A node whose WAL is still fenced **cannot start serving**:

```
fenced node start attempt: could not open file "pg_wal/...": Permission denied
```

So a fenced node cannot serve a stale or divergent snapshot to a client — criterion 6 is satisfied *by
the fence*, not by convention. Only after the fence is cleared does it accept writes again. In a real
design the sequence is: fence → verify → `pg_rewind`/rebuild → clear fence → rejoin.

## 7. Acceptance criteria — status

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Replacement primary not application-writable until the old one is fenced | **Mechanism verified** (VIP/network fence gate traffic); not wired into a failover flow |
| 2 | Isolated former primary cannot commit | **Verified** — storage fence and STONITH both prevent commits |
| 3 | Only one authoritative writable primary | **Achievable** with fencing; **not** achieved by election alone (Phase 33) |
| 4 | Divergent timelines detected | **Not addressed here** — Phase 32/33 cover detection via `pg_rewind`/timeline history |
| 5 | `pg_rewind` or approved rebuild restores consistency | **Verified in Phase 32** |
| 6 | Rejoining nodes cannot serve stale data | **Verified** — a fenced node cannot start serving |
| 7 | Results independently recorded | This document |

## 8. Limitations — what this does NOT establish

1. **No read-only *mount* was tested.** The canonical storage fence is a filesystem remount. In this
   sandbox mount capability exists only while uid 0 inside a user namespace, and PostgreSQL refuses to
   run as uid 0, so the two cannot be combined. WAL file permissions were used instead: real kernel
   enforcement (`CapEff: 0`), but not a filesystem-wide remount.
2. **No hardware fencing.** There is no `/dev/watchdog`, no `modprobe`, no IPMI/iLO, no PDU, and no
   privileged access. STONITH here means killing processes, not cutting power.
3. **No shared storage.** "Storage fencing" in the SAN/NFS sense (revoking a node's LUN access) is not
   reproducible here; the WAL permission fence is a per-node approximation of the same guarantee.
4. **No failover integration.** Fencing was verified as a standalone action. Nothing wires it to quorum,
   and criterion 1 is therefore only half-met: the gate exists, the automation does not.
5. **No real network partition** — the namespace probe proves isolation is enforceable, not how a
   partition behaves over time (split routes, retransmits, half-open connections).
6. **No production or staging verification**, and none implied. Everything is a disposable local cluster.
7. **Application behaviour unchanged.** No source change was authorised or made; Phases 30–32 already
   cover 409 handling and the ambiguous interrupted write.

## 9. Reproduce

```bash
TEST_FENCING=1 \
TEST_PG_BIN_DIR=/path/to/postgres/bin \
npm run test:fencing-mechanisms
```

Requires a real PostgreSQL installation and permission to run `unshare -rn`. The suite creates and
destroys disposable clusters, fences them, and leaves nothing running. It skips (loudly) otherwise.
