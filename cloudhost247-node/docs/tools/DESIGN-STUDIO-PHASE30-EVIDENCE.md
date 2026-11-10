# Phase 30 — Read-Replica Consistency Verification

**Question**: can replica lag affect the template read–modify–write lifecycle, and do revision-sensitive
reads therefore have to use the primary?

**Date**: 2026-11-10.
**Authorisation**: local disposable infrastructure only. No deployment, no provider operations, no
change to any certification conclusion.

## Verdict

| Question | Answer |
| --- | --- |
| Do stale replica reads corrupt data? | **No.** The primary refuses every stale write; the row is unchanged. |
| Are stale replica reads *safe*? | **Safe, but not harmless** — they produce an accurate 409 only if the re-read also uses the primary. |
| Must revision-sensitive reads use the primary? | **Yes.** See §5; the failure is an unrecoverable-looking 409 loop, not corruption. |
| Is the current application affected? | **No** — it uses a single pool against `DATABASE_URL`, so reads already go to the primary (verified in code, §6). |
| Replication verified as real? | **Yes** — streaming standby, writes refused, `pg_is_in_recovery() = true`. |
| Production / replica certification | **NOT CLAIMED.** Local disposable servers only. |

**Nothing here changes a certification conclusion, and the forced-overwrite restrictions were not
touched.**

## 1. Topology (all disposable, outside the repository)

| Component | Detail |
| --- | --- |
| Primary | PostgreSQL **16.2**, 127.0.0.1:**5501**, `wal_level=replica`, `max_wal_senders=10`, `wal_keep_size=256MB` |
| Standby | PostgreSQL **16.2**, 127.0.0.1:**5502**, created with **`pg_basebackup -R -X stream -c fast`** |
| Replication | asynchronous streaming (`state=streaming`, `sync_state=async`) |
| Lag control | `pg_wal_replay_pause()` / `pg_wal_replay_resume()` **on the standby** |

Lag is produced by pausing WAL replay, not by a network trick or a sleep. While replay is paused the
standby is *provably* unable to see new commits, so every stale read in this report is caused by
replication rather than by a slow test machine or an unlucky race. Each lagging test asserts the
premise (standby shows revision 1) before drawing any conclusion from it.

## 2. Is the replica real?

Asserted by test, not inferred from a port number:

* `pg_is_in_recovery()` → **true** on the standby, **false** on the primary.
* `pg_stat_replication` on the primary → `state = streaming`.
* Backend PIDs differ, so this is not a second connection to the same server.
* **The standby rejects writes** (`cannot execute INSERT in a read-only transaction`). If this ever
  passed, every read test below would be meaningless.

Schema reached the standby over WAL only: migrations were run on the primary and the test waited for
`design_studio_templates` to appear in the standby's `information_schema`.

## 3. Baseline behaviour (no lag)

| Observation | Result |
| --- | --- |
| Normal async replication of a new row | visible on standby in **≈5 ms** |
| Read from replica while caught up | correct revision and document |
| Write to primary → read from primary immediately | **correct at once** (revision 2) |
| Write to primary → read from replica | converges; asserted within a 10 s bound |

The 5 ms figure matters for the interpretation: read-after-write *usually* works against a replica,
which is exactly why a deployment can adopt replica reads, pass its smoke tests, and only fail under
load or on a busy primary.

## 4. Results — `tests/integration/design-studio-templates-replica.test.ts`

**10 tests, all pass.**

| # | Test | Result |
| --- | --- | --- |
| 1 | is a real streaming standby, not a second primary | pass |
| 2 | replicates a new revision to the standby quickly under normal operation | pass |
| 3 | serves a coherent read from the replica when replication is caught up | pass |
| 4 | read-after-write through the replica is eventually consistent, primary immediately correct | pass |
| 5 | **stale revision read from a LAGGING replica is rejected by the primary, nothing overwritten** | pass — 409, row still revision 2 with the winner's document |
| 6 | fresh save from a stale replica read gets an accurate 409 when reads use the primary | pass — message names `revision 2`, retry succeeds → revision 3 |
| 7 | a 409 recovered through a lagging replica (whole app pointed at replica) | pass — writes refuse outright (5xx) |
| 8 | **DECISIVE: 409 re-read routed to a lagging replica names the STALE revision** | pass — see §5 |
| 9 | replica recovers after replay resumes and converges without intervention | pass — revision 2 within 15 s, no restart needed |
| 10 | a delete replicated late is not silently resurrected by a stale write | pass — 404, row stays gone |

**Mutation check**: removing `AND revision = $5` from the `UPDATE` failed **4 of 10** tests
(`expected 200 to be 409` ×4). The suite detects the missing guarantee rather than passing regardless.

## 5. The finding: stale reads are safe, but the 409 message is only as good as the read behind it

`overwriteTemplate` reacts to a zero-row `UPDATE` by **re-reading the row**, both to distinguish 404
from 409 and to build the message:

> "…was changed in another tab or device after you loaded it (it is now revision **N**; you had **M**).
> Reload it and try again — nothing was overwritten."

If that re-read is served by a lagging replica, the *write* is still correctly refused — the guarantee
holds — but the message is assembled from a snapshot that predates the conflict. Test 8 demonstrates it
directly with a `Queryable` that sends `SELECT` to the standby and everything else to the primary (the
common read/write split, and both sides are real servers):

| Reads routed to | Conflict message says | Actionable? |
| --- | --- | --- |
| primary (current behaviour) | "it is now revision **2**; you had 1" | yes — reload gives revision 2, retry succeeds |
| **replica (lagging)** | "it is now revision **1**; you had 1" | **no** — tells the user to reload to the value they already have; retry conflicts identically |

So the answer to "do revision-sensitive reads require the primary?" is **yes**, and the reason is not
data corruption (there is none) but a **misleading, self-perpetuating conflict**. From the customer's
side this is indistinguishable from a broken editor: save, "reload and try again", reload, save,
conflict — for as long as the replica lags.

A second consequence is visible in test 7: pointing an *entire* app at a replica fails loudly because
the standby refuses writes. That is the safe failure. The statement-level split in test 8 fails
*quietly*, which is why it is the one worth documenting.

## 6. Does the current application need to change?

**No — and no code was changed.** Verified in `src/db/pool.ts`: a single pool is built from
`DATABASE_URL` and `buildApp` passes that one `Queryable` to every route, so reads already go to the
primary. The risk is prospective: it exists only if a deployment introduces replica reads later.

Recommended constraint for anyone who does (documented in `DESIGN-STUDIO.md`, no code enforced):

> Revision-sensitive template reads must use the primary. Specifically, `GET /templates/:id` and the
> re-read inside `PUT /templates/:id` must not be routed to a replica. Read-only surfaces that never
> feed a version check — catalogue listings, invoice history — are unaffected.

A future hardening option, **not implemented here** (it would be an unrelated code change): have the
409 path re-read with a primary-pinned connection, or include the primary's revision in the
zero-row-update `RETURNING` so no second read is needed. Both are worth considering only alongside an
actual read-split deployment.

## 7. Recovery path after 409

* **With primary reads**: the message names the revision the user needs, and a reload-then-retry
  succeeds (test 6, 1 → 2 → 3 verified).
* **With replica reads**: the message is stale and the retry loop repeats (test 8).
* **Replica recovery**: automatic. After replay resumes, the standby converges within the asserted
  bound (test 9) with no restart, pool bounce or manual step.
* **Deleted rows**: a stale write against a deleted template returns **404**, not a conflict, and does
  not resurrect the row (test 10) — the client stops instead of retrying forever.

## 8. Limitations — what this does NOT establish

1. **No production or staging verification**, and none is implied. Two local servers on one host:
   the network latency that dominates real replica lag is absent, so real-world stale windows will be
   **larger** than anything measured here, not smaller.
2. **Asynchronous replication only.** Synchronous replication (`synchronous_commit=remote_apply`) would
   reduce the window but is not tested, and it costs write latency.
3. **No failover, promotion, split-brain or `pg_rewind` behaviour** was exercised.
4. **No load testing.** Contention between many readers and one lagging replica is untested; the lag
   tests are single-threaded and deterministic by construction.
5. **One schema shape.** The templates table only; the conclusion is about *version-checked writes*,
   which is a general pattern, but only this table was tested.
6. **The split-routing harness is a test double for routing, not for the database.** Both sides are
   real PostgreSQL servers; what is simulated is only the *choice* of which server a statement goes
   to, because the application has no read-split today.

## 9. Reproduce

```bash
# primary
initdb -D /tmp/p30-primary -U postgres --auth=trust
#   postgresql.conf: port=5501, wal_level=replica, max_wal_senders=10, hot_standby=on, wal_keep_size=256MB
#   pg_hba.conf:     host replication all 127.0.0.1/32 trust
pg_ctl -D /tmp/p30-primary start
createdb -h 127.0.0.1 -p 5501 ch247_phase30

# standby
pg_basebackup -h 127.0.0.1 -p 5501 -U postgres -D /tmp/p30-replica -R -X stream -c fast
#   postgresql.conf: port=5502, hot_standby=on
pg_ctl -D /tmp/p30-replica start

TEST_REPLICA_PRIMARY_URL=postgresql://postgres@127.0.0.1:5501/ch247_phase30 \
TEST_REPLICA_URL=postgresql://postgres@127.0.0.1:5502/ch247_phase30 \
npm run test:replica
```

The suite skips (loudly, naming both variables) when no replica is configured, and asserts
`pg_is_in_recovery()` before trusting a single read.
