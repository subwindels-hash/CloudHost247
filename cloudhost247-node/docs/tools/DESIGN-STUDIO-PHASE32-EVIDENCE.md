# Phase 32 — Demoted Primary Rejoin and Split-Brain Safety

**Question**: after a failover, can the old primary be brought back safely — and what stops it from
becoming a second writable primary in the meantime?

**Date**: 2026-11-10.
**Authorisation**: local disposable infrastructure only. No deployment, no provider operations, no
failover automation, **no application code changes**, replication policy unchanged.

## Verdict — the five areas, kept apart

| Area | Finding |
| --- | --- |
| **Split-brain prevention** | **Not provided by PostgreSQL.** A demoted primary restarts writable and accepts writes without objection. External fencing is required. |
| **Demoted-primary recovery** | **Works** — `pg_rewind` rolls the old primary back to the last common checkpoint and returns it as a **standby** (`standby.signal` present, writes refused). |
| **Data-loss exposure** | **Real and silent.** Writes accepted by the isolating old primary are **deleted** by rejoin (verified: 1 row → 0). |
| **Replication convergence** | **Verified** — both nodes converge, timelines advance 1 → 2 → 3 across two cycles, `.history` file written. |
| **Application recovery** | **Unchanged and intact** — the revision predicate and stale rejection work after a rejoin. |

| Prerequisite | Finding |
| --- | --- |
| Is `pg_rewind` eligibility automatic? | **No.** Without `--data-checksums` or `wal_log_hints=on` (both OFF by default in PG 16), `pg_rewind` refuses: *"target server needs to use either data checksums or wal_log_hints = on"*. This must be decided at `initdb`, before the cluster ever holds data. |

**Replication policy was not changed.** Async streaming throughout; see §7 on why synchronous
replication is a separate decision.

## 1. Environment

| Component | Detail |
| --- | --- |
| PostgreSQL | **16.2**, disposable clusters under `/tmp` |
| Standby creation | `pg_basebackup -R -X stream -c fast` |
| Failure simulation | `pg_ctl -m immediate stop` (SIGQUIT crash shutdown) |
| Promotion | `pg_ctl promote` |
| Rejoin | **`pg_rewind -R`** (`-R` writes `standby.signal` + `primary_conninfo`) |
| Replication | asynchronous, `wal_log_hints=on` for rewindable pairs |

## 2. Results — `tests/integration/design-studio-templates-rejoin.test.ts`

**6 tests, all pass**, three consecutive runs.

| # | Test | Result |
| --- | --- | --- |
| 01 | pg_rewind eligibility is NOT automatic | pass — exits 1 with the checksum/hints error |
| 02 | split-brain: PostgreSQL does NOT stop a demoted primary accepting writes | pass — restarts `in recovery = false`, accepts an insert |
| 03 | rejoin with `pg_rewind` returns a standby on the new timeline | pass — `standby.signal` written, writes refused, history file `00000002.history` |
| 04 | **data loss on rejoin** | pass — divergent write gone on both nodes |
| 05 | revision predicate intact after rejoin | pass — 1 → 2, stale retry matches 0 rows, replicates |
| 06 | second failover/rejoin cycle in the opposite direction | pass — timelines **[2, 3]** |

## 3. Split-brain: the uncomfortable finding

Test 02 restarts the crashed old primary after the standby has been promoted. It comes up
`pg_is_in_recovery() = false`, **accepts a write**, and keeps its old timeline (1) while the promoted
node is on timeline 2.

**PostgreSQL does no cross-node coordination.** Nothing in the protocol tells a restarted primary that
another node was promoted. Split-brain prevention therefore lives entirely outside the database:

| Mechanism | Not tested here |
| --- | --- |
| Fencing (STONITH / power off the old primary) | yes |
| VIP / DNS failover that moves the write address | yes |
| Quorum manager (Patroni, repmgr, Pacemaker) | yes |
| An operator who does not restart the old node | yes |

**A safety rule this file had to observe.** The brief forbids exposing two writable primaries. Test 02
therefore stops the promoted server *before* starting the demoted one, and confirms the promoted state
afterwards. This does not weaken the finding: because there is no cross-node coordination, the presence
of the other server cannot change whether the old primary accepts writes. Running both would have added
a genuine split-brain to the sandbox without testing anything more.

## 4. Data loss on rejoin

Test 04 is the consequence that matters operationally:

1. Standby promoted → new primary on timeline 2.
2. Old primary restarted in isolation, user saves a template. **The save is acknowledged** and the row
   is readable on that server.
3. The new primary is also written to, so the two histories genuinely diverge.
4. `pg_rewind` on the old primary → it rejoins as a standby.
5. The acknowledged save from step 2 is **gone from both nodes**.

This is not the revision predicate failing. Version checks operate *within* a timeline; `pg_rewind`
discards a whole divergent branch. There is no "merge" — PostgreSQL has no mechanism to reconcile two
timelines, and none was attempted.

So a failover has **two independent loss windows**, and they compound:

| Window | Cause | Measured in |
| --- | --- | --- |
| Commits on the primary never received by the standby | async replication | Phase 31 §5 |
| Commits accepted by an isolated old primary, discarded on rejoin | divergent timeline | Phase 32 §4 |

Any failover design must assume both, and the only things that shrink them are fencing (so the old
primary never accepts writes) and synchronous replication (so fewer commits sit in the first window).

## 5. Recovery and convergence

* **Rejoin returns a standby, not a primary.** `pg_rewind -R` writes `standby.signal`; the server starts
  `in recovery = true` and refuses writes (verified). This is what makes rejoin safe by construction
  rather than by convention.
* **Timelines advance monotonically**: 1 → 2 on the first promotion, 2 → 3 on the second; the
  `00000002.history` file is written, so the rewind is auditable rather than invisible.
* **Rejoin is repeatable**, including in the *opposite direction* on the second cycle (the rejoined node
  was promoted, and the other was rewound).
* **The revision predicate survives.** After a rewind the conditional update still moves 1 → 2 and a
  stale retry still matches zero rows, and the state replicates to the rejoined standby.

**A measurement correction worth recording.** `pg_control_checkpoint().timeline_id` reports the
*last completed checkpoint's* timeline, which after a promotion can still be the old one until a
checkpoint completes. My first version read the timeline that way and failed with `expected 1 to be 2` —
looks exactly like a failed promotion, and was a bad measurement. The timeline is now read from the WAL
file name (`pg_walfile_name`), whose first 8 hex digits are unambiguous. Anyone verifying promotion from
`pg_control_checkpoint()` will hit the same false negative.

## 6. Limitations — what this does NOT establish

1. **No production or staging verification**, and none implied. Both clusters are on one host with no
   real network between them.
2. **No failover automation, no quorum, no fencing implementation.** Test 02 *demonstrates* the absence
   of self-fencing; it does not evaluate any fencing product.
3. **`pg_rewind` was run against a locally reachable source** (`--source-server`). Rewind across a
   network, with `restore_command` or from a WAL archive (`-c`), is untested.
4. **No replication slots.** No `max_slot_wal_keep_size` behaviour, no slot invalidation — a real
   failover design usually uses slots and must handle their failure modes.
5. **No cascading replication, no multi-standby quorum**, and no `synchronous_standby_names` testing.
6. **One schema shape** (the templates table) and no load.
7. **No timing data for a real failover.** Promotion was measured in Phase 31 (103–105 ms on loopback);
   a WAN failover is dominated by detection and DNS/VIP propagation, neither of which exists here.

## 7. Replication policy — deliberately unchanged

Phase 31 showed async replication loses acknowledged commits; Phase 32 shows a rejoined node also
discards a divergent branch. The tempting response is to switch to synchronous replication. **That
decision was not taken and no configuration was changed.** It is a separate design decision with its own
trade-offs:

| Setting | Effect | Cost |
| --- | --- | --- |
| `synchronous_commit = on` (current) | commit durable on the primary | the Phase 31/32 loss windows |
| `remote_write` | standby has received the WAL | writes block if the standby is slow |
| `remote_apply` | standby has replayed it | smallest window, highest latency, writes stop if the standby dies |

Synchronous replication fixes the *first* window only. It does **not** protect against an isolated old
primary accepting writes — that is fencing's job, as §3 shows.

## 8. Reproduce

```bash
TEST_REJOIN=1 \
TEST_PG_BIN_DIR=/path/to/postgres/bin \
npm run test:rejoin
```

Opt-in: the suite creates, crashes, promotes, rewinds and destroys real clusters, and is never part of a
default run. It skips (loudly) unless `TEST_REJOIN=1` and real server binaries are present.
