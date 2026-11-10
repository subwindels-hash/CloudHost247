# Phase 29 — PgBouncer transaction-pooling concurrency verification

**Objective**: establish whether the revision-based concurrency guarantee survives **PgBouncer in
transaction mode** — the topology a production deployment actually uses — rather than merely working
against a direct PostgreSQL connection.

**Date**: 2026-11-10.
**Authorisation**: local testing only. No deployment, no provider operations, no certification change.

## Verdict

| Claim | Status |
| --- | --- |
| The guarantee survives transaction pooling | **Verified locally** — 10/10 tests pass |
| Exactly one conflicting write succeeds | **Verified** — `[200, 409]` through the pooler |
| Stale revisions rejected | **Verified** — 409 naming the current revision |
| Failed writes leave the template unchanged | **Verified** — 4 rejection kinds, row byte-identical |
| Repeated across many pooled connections | **Verified** — 20 rounds × 4 clients, plus a 10-way race |
| Session state does not leak between clients | **Verified** — deterministic, single-server pool |
| Replica / production verification | **NOT CLAIMED.** See limitations. |

**Nothing here changes a certification conclusion, and the forced-overwrite escape hatch was not
touched** (its closure was a previous, separate change; this phase only re-confirms it through the
pooler).

## 1. Environment (all disposable, outside the repository)

| Component | Version / configuration |
| --- | --- |
| PgBouncer | **1.26.1** — built from source (`pgbouncer_1_26_1`, meson), libevent 2.1.12-stable, openssl disabled |
| PostgreSQL | **16.2**, `max_connections=200`, TCP 127.0.0.1:5432 |
| Pooler listener | 127.0.0.1:**6432** |
| `pool_mode` | **transaction** (asserted by test, not assumed) |
| `default_pool_size` | 25 |
| `reserve_pool_size` | 5, `reserve_pool_timeout` 2 s |
| `query_wait_timeout` | 15 s |
| `server_reset_query` | `DISCARD ALL`, `server_reset_query_always = 1` |
| `max_client_conn` | 200 |
| `auth_type` | trust (disposable local server, no credentials involved) |
| Second pool | `ch247_small`, `pool_size=1`, used only for the deterministic state-leak test |

PgBouncer was compiled rather than simulated. The PyPI package named `pgbouncer` is a Python *test
fixture* that shells out to a system binary; using it would have produced a clean-looking "verified"
result with no real proxy in the path. The build order was: libevent (CMake, vendored headers) →
pkgconf (meson) → PgBouncer (meson).

## 2. Topology actually verified — and why the tests prove it

A test that "passes through something on port 6432" proves nothing if that something is in session
mode. Three independent checks establish the mode:

1. **Config, from the pooler's own admin console**: `SHOW CONFIG` reports `pool_mode=transaction`.
   The suite **fails** if it does not.
2. **Behaviour**: 12 clients holding 12 *simultaneous open transactions* were served by **12 distinct
   backends** (they must be, while overlapping), while idle clients are multiplexed — the defining
   transaction-pooling behaviour. Under `default_pool_size=5` this instead produced
   `query_wait_timeout`, i.e. queueing at the pool, which is itself a transaction-pooling symptom.
3. **Cross-client sharing**: two separate client connections were observed on the *same* PostgreSQL
   backend (`pg_backend_pid()` 6491 for both), which session pooling cannot produce.

## 3. Results — `tests/integration/design-studio-templates-pgbouncer.test.ts`

**10 tests, all pass** (8 with `CONTENTION=1` off, 10 with it on).

| # | Test | Result |
| --- | --- | --- |
| 1 | is connected through a pooler in TRANSACTION mode, not session or statement mode | **pass** |
| 2 | multiplexes: two distinct clients share one server backend | **pass** |
| 3 | does not leak session state between clients sharing one server connection | **pass** |
| 4 | lets exactly one of two clients holding the same revision win | **pass** — `[200, 409]`, revision 1→2 |
| 5 | rejects a stale revision through the pooler | **pass** — 409 naming `revision 4` |
| 6 | leaves the template unchanged when a write fails through the pooler | **pass** — 400/400/400/409, row unchanged |
| 7 | keeps the closed forced-overwrite path closed through the pooler | **pass** — 410 `FORCED_OVERWRITE_SUNSET` |
| 8 | keeps ownership scoped through the pooler | **pass** — 404 for a non-owner |
| 9 | twenty sequential conflicts from twenty pooled clients, one winner each | **pass** (opt-in `CONTENTION=1`) |
| 10 | exactly one winner under a ten-way simultaneous conflict | **pass** (opt-in `CONTENTION=1`) |

Migrations also run through the pooler: all **102** migrations applied through PgBouncer in a single
`migrateUp`, and the resulting `design_studio_templates` table carries `revision` and
`last_forced_at`. A transaction that a pooler split across backends would fail here, so this is a real
check that pooling does not fragment a multi-statement migration.

### The tests were mutation-checked

Removing `AND revision = $5` from the `UPDATE` (and its parameter) and re-running through the pooler
produced **five failures**, including `expected [200, 200] to deeply equal [200, 409]` — a genuine
lost update through the pooler. The assertions detect the absence of the guarantee rather than
passing regardless.

## 4. Two findings, one of them mine

### 4.1 A test of mine was wrong, and would have produced a false "leak" report

The first version of the state-leak test opened two clients through node-postgres' `Pool` and asserted
the second could not see the first's `application_name`. It failed — apparently showing that
`DISCARD ALL` was not clearing session state.

It was the test. `pool.connect()` returned the *same* underlying connection for both halves, so "client
A" and "client B" were one client, and of course the marker was still visible. Confirmed directly:
`pool clients same backend? true`.

The corrected test uses a pool configured with **`pool_size=1`**, so both clients are guaranteed to be
served by the same backend, and the premise is asserted (`secondPid === firstPid`) before the
conclusion. Result: `application_name` is `""` and `statement_timeout` is `0` — no leak.

This matters beyond the test: a reported "session state leaks between tenants" would have been a
serious, wrong finding about the deployment topology.

### 4.2 An observation that is *not* a defect, recorded so it is not re-investigated

A client that runs `SET` inside a transaction and then issues `COMMIT` keeps seeing its own setting on
its next statement. That is expected: node-postgres sends `COMMIT` and the following `SHOW` as
separate transactions, and with a 25-server pool the client is very likely handed back the same
backend. It is not a leak — the setting is invisible to other clients (test 3, deterministic). Only a
pooled deployment with a *single* server (or extreme luck) makes it observable.

## 5. Limitations — what this does NOT establish

1. **No replica verification.** Every test uses one primary. Read-replica lag, or a write routed to a
   replica, is untested. Nothing here should be read as replica verification.
2. **Not production.** This is a disposable local PgBouncer built from source with `auth_type=trust`
   and no TLS. Production authentication, TLS termination, connection limits and network conditions
   are untested.
3. **`server_reset_query_always=1` is part of the configuration tested.** It forces `DISCARD ALL` after
   every transaction, including in transaction mode. A deployment that leaves it off would behave
   differently for the state-leak property. The revision guarantee itself does not depend on it.
4. **Contention cases are opt-in** (`CONTENTION=1`) and reported separately: with a small
   `default_pool_size`, queueing at the pool (`query_wait_timeout`) is indistinguishable from a
   conflict in a single pass/fail number. Distinguishing them required raising the pool and asserting
   the status codes, which is what the opt-in block does.
5. **No load or soak testing.** Twenty rounds is repetition, not capacity.
6. **The escape hatch still exists** behind `DESIGN_STUDIO_ALLOW_FORCED_OVERWRITE`; this phase did not
   remove or change it, per the authorisation boundary.

## 6. Reproduce

```bash
# 1. PgBouncer (built from source in this run; any 1.2x build works)
#    pgbouncer.ini: pool_mode=transaction, server_reset_query=DISCARD ALL,
#    server_reset_query_always=1, default_pool_size=25, query_wait_timeout=15
#    plus one database with pool_size=1 for the deterministic leak test.

# 2. run
TEST_PGBOUNCER_URL=postgresql://postgres@127.0.0.1:6432/ch247 \
TEST_PGBOUNCER_SMALL_DB=ch247_small \
CONTENTION=1 npm run test:pgbouncer
```

The suite skips (loudly, naming the variables) when the pooler is not configured, and refuses to run
if the pooler is not in transaction mode.
