# Phase 31 — Failover and Primary-Promotion Verification

**Question**: what happens to template saves when the primary becomes unavailable, and can the
application distinguish a failed write from one that committed immediately before the failure?

**Date**: 2026-11-10.
**Authorisation**: local disposable infrastructure only. No deployment, no provider operations, no
automatic failover configuration, no change to any certification conclusion.

## Verdict

| Question | Answer |
| --- | --- |
| Does streaming replication work before failover? | **Yes** — `state=streaming`, replay lag 0 bytes at the moment of measurement |
| Does `pg_ctl promote` work? | **Yes** — `pg_ctl promote` returned in **103–105 ms**; `pg_is_in_recovery()=false` **3–6 ms** later |
| Does the promoted server accept writes? | **Yes** — verified by an `INSERT` and a `SELECT` of the new row |
| Do committed revisions survive promotion? | **Yes, if replayed.** Commits not yet received by the standby are **lost** (test 08) |
| Does stale-revision rejection still hold after promotion? | **Yes** — same predicate, same 0-row result, document unchanged |
| Does the application pool recover? | **Yes** — a `pg` Pool recovers without being recreated |
| **Can a failed write be distinguished from a committed one?** | **No.** See §4 — and this is the finding |
| Production readiness | **NOT CLAIMED.** Local, single-host, asynchronous replication only |

**Nothing here changes a certification conclusion. The forced-overwrite restrictions were not touched,
and no failover automation was configured.**

## 1. Environment

| Component | Detail |
| --- | --- |
| PostgreSQL | **16.2** (both servers), local disposable clusters under `/tmp` |
| Primary / standby ports | 5601 / 5602 (additional pairs used per focused test, 5611–5631) |
| Replication | **asynchronous** streaming, `wal_level=replica`, `wal_keep_size=256MB` |
| Standby creation | `pg_basebackup -R -X stream -c fast` |
| Failure simulation | `pg_ctl -m immediate stop` (**SIGQUIT** — crash shutdown, no clean checkpoint) |
| Promotion | **`pg_ctl promote`** — PostgreSQL's own mechanism |

`-m immediate` matters: a `fast`/`smart` shutdown rolls back cleanly and would make the interrupted-write
result meaningless. SIGQUIT is the closest a local test gets to an abrupt power loss.

## 2. Results — `tests/integration/design-studio-templates-failover.test.ts`

**8 tests, all pass.** Run three times consecutively: 8/8 each time.

| # | Test | Result |
| --- | --- | --- |
| 01 | streams before failover, standby refuses writes | pass — `streaming`, lag 0 bytes |
| 02 | promotion: standby accepts writes afterwards | pass — promote 103–105 ms, out of recovery 3–6 ms |
| 03 | data committed before the outage survives promotion | pass |
| 04 | stale-revision rejection still holds on the promoted server | pass — 0 rows, revision 2 |
| 05 | pool recovers after the primary is replaced | pass — no pool recreation needed |
| 06 | interrupted write (crash before COMMIT) | pass — rolled back, revision stays 1 |
| 07 | **ambiguity proven by contrast** | pass — see §4 |
| 08 | **the data-loss window** | pass — acknowledged commit is lost — see §5 |

## 3. What failover does *not* damage

* **The revision guarantee survives promotion.** Test 04 runs the same conditional `UPDATE` on the
  promoted server: the first save moves 1 → 2, the stale retry matches zero rows, and the document is
  unchanged. A failover that silently disabled version checking would be far worse than an outage; it
  does not happen, because the predicate is part of the statement rather than application state.
* **Committed-and-replicated data survives.** Test 03.
* **The connection pool recovers on its own.** Test 05 terminates every other backend on the server and
  the pool's next query still succeeds — node-postgres discards dead clients rather than staying
  poisoned. This was verified against a live server, not a restarted process, and is the weaker half of
  the claim: see limitation 6.

## 4. The ambiguous write — the question this phase exists to answer

Two scenarios were run, each with a real crash or a real backend termination, and the client's error
string recorded verbatim.

| | Scenario A | Scenario B |
| --- | --- | --- |
| `UPDATE … WHERE revision = 1` issued | yes | yes |
| Reach `COMMIT` durably | **no** — crash before commit | **yes** — committed, then the connection died before the reply was read |
| Client saw | `Client has encountered a connection error and is not queryable` | `Client has encountered a connection error and is not queryable` |
| Row afterwards | revision **1**, document unchanged | revision **2**, document updated |

**The client symptom is byte-identical in both rows.** The application cannot tell, from the error
alone, whether its save was applied. That is not a defect in this codebase — it is a property of a
TCP client against a server that stopped answering.

### Why this is survivable here, and where it is not

The revision predicate converts an unknowable outcome into a *safe* one:

* **If the write did not commit**, the retry with the original `expectedRevision` succeeds — applied
  exactly once. Verified (test 06).
* **If the write did commit**, the retry with the same `expectedRevision` matches **zero rows** and is
  refused. It cannot double-apply, and it cannot silently overwrite the user's own committed edit.
  Verified (test 07 terminates retry: 0 rows).

So the answer to "can the application safely distinguish?" is:

> **No, it cannot distinguish. It does not need to, *provided* every save is version-checked.** Retry is
> safe because the predicate makes a double-apply impossible. What the application *cannot* do is tell
> the user what happened — the honest message after an interrupted save is "we could not confirm whether
> your last save was saved; reload to check", which is exactly what the 409 flow already advises.

**The one thing that must never happen**: an interrupted save resolved by *forcing*. The forced path
skips the version check, so a retry through it would overwrite a revision it never read. That path is
already closed (410, `FORCED_OVERWRITE_SUNSET`) and this phase did not touch it — but any future
"retry automatically on connection error" logic must be restricted to version-checked saves for this
reason.

## 5. The data-loss window

Test 08 disconnects the standby so it **never receives** the WAL, commits a save on the primary (the
primary acknowledges it — from the user's side the save succeeded), then crashes the primary and promotes
the standby:

| Step | State |
| --- | --- |
| Save acknowledged on primary | revision **2**, document `widthMm: 300` |
| After promotion of the behind standby | revision **1**, document `widthMm: 70` |

The save was acknowledged and then vanished, with no error shown to the user at any point. This is the
documented consequence of asynchronous replication, not an application bug: `synchronous_commit` was left
at its default (`on`), which makes a commit durable **on the primary**, not on the standby.

**A methodological correction worth recording.** My first attempt to create this window used
`pg_wal_replay_pause()` on the standby — and it **failed to produce any loss**. The standby continues to
*receive* WAL while replay is paused, and promotion replays everything already received before finishing.
A paused-replay standby therefore loses nothing; only WAL it never received is lost. The test was changed
to disconnect the standby, which is what a network partition or a primary outrunning replication actually
produces. Anyone reasoning about this window from "pause replay" intuition would reach the wrong
conclusion, in the optimistic direction.

**Options, none implemented** (each is a deployment decision, not a code change here):

| Option | Cost |
| --- | --- |
| Accept the window | Some acknowledged saves may be lost on failover |
| `synchronous_commit = remote_write` | Writes block if the standby is slow/unhealthy; still not zero loss |
| `synchronous_commit = remote_apply` | Smallest window; highest latency, writes stop if standby dies |

## 6. Limitations — what this does NOT establish

1. **No production or staging verification**, and none implied. Both clusters are on one host with no
   real network between them: real failover involves connection timeouts, DNS/VIP propagation and
   firewall state, none of which exist here.
2. **No automatic failover.** Promotion was manual (`pg_ctl promote`). No failover manager, no quorum, no
   fencing, no VIP movement. A design that automates promotion needs split-brain protection this phase
   did not test.
3. **No rejoin.** The old primary is destroyed rather than rebuilt. `pg_rewind` and re-joining a demoted
   primary are untested — that is Phase 32 territory.
4. **No data-loss measurement under load.** Test 08 shows the window exists; it does not quantify how
   many seconds of commits a real failover would discard.
5. **The ambiguity result does not depend on the application's HTTP layer.** It was measured at the SQL
   client. The API would surface it as a 500 with no distinguishing detail, which is the same
   information content.
6. **Pool recovery is only half-verified.** The pool recovered with a live server on the same port. A
   pool recovering when the process is restarted beneath it (connection resets rather than clean
   `pg_terminate_backend`) was not exercised.
7. **Single schema, single row shape.** The templates table only.

## 7. Reproduce

```bash
# two real clusters; see the helper for the exact initdb/pg_basebackup arguments
TEST_FAILOVER=1 \
TEST_PG_BIN_DIR=/path/to/postgres/bin \
npm run test:failover
```

The suite is **opt-in**: it creates, crashes, promotes and destroys real clusters, so it is never part
of a default run. It skips (loudly) unless `TEST_FAILOVER=1` and real server binaries are present.
