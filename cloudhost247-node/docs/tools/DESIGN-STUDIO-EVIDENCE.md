# Design Studio saved templates — verification evidence

**Scope**: Steps 2–5 of the saved-template lifecycle block (concurrency hardening verification,
lifecycle integrity, forced-overwrite sunset, frontend integrity, regression).
**Date**: 2026-11-10.
**Authorisation**: local implementation and verification only.

## Status statement — read this before the tables

| Claim | Status |
| --- | --- |
| Lost-update protection under real PostgreSQL concurrency | **Verified locally, this session** |
| Forced-overwrite sunset enforced | **Verified locally**, path closed 410 |
| Migrations correct on fresh install and existing database | **Verified locally** on PostgreSQL 16.2 |
| Frontend cannot invoke unconditional overwrites | **Verified locally** (code + test) |
| Production / staging certification | **NOT CLAIMED.** Nothing was deployed. |
| Full-repository regression suite | **PASS — 3,494 passed, 0 failed, 26 skipped** (278 files) |

Nothing in this document changes an existing certification conclusion, and nothing here lifts a
staging or production hold.

## 1. Environment

| Item | Value |
| --- | --- |
| Database for concurrency tests | PostgreSQL **16.2** (x86_64-pc-linux-gnu), TCP on 127.0.0.1:5432 |
| Provisioning | A throwaway server in `/tmp`, created for this run; not a project dependency |
| Embedded engine (all other integration tests) | PGlite (WASM PostgreSQL), single connection |
| Node | v22.22.3 |

Each real-PostgreSQL test file creates its own database (`ch247_conc_*`, `ch247_mig_*`), migrates it
from empty, and drops it afterwards.

## 2. Step 2 — revision history and real concurrency

`tests/integration/design-studio-templates-postgres.test.ts` — **6 tests, all pass**.

| Evidence required | Test | Result |
| --- | --- | --- |
| Two independent connections, competing writes, exactly one success and one 409 | `lets exactly one of two writes succeed when both read the same revision` | **pass** — `[200, 409]`, `revision` 1→2, document is the winner's |
| Transaction isolation / conditional-update behaviour | `blocks the second writer on the row lock and refuses it after the first commits` | **pass** — B blocks ≥250 ms while A holds the row, then updates **0 rows** after A commits (READ COMMITTED re-evaluates the predicate) |
| Wider race | `survives ten simultaneous conditional saves with exactly one winner` | **pass** — 1×200, 9×409 |
| Stale save after several successful ones | `refuses a stale save even when it arrives after many successful ones` | **pass** — 409 naming `revision 4` |
| Ownership on the (closed) forced path + storage-layer predicate | `never lets a write skip ownership` | **pass** — 410 forced, 404 conditional, direct `UPDATE … AND user_id` matches 0 rows |
| The harness really is a server | `is talking to a real server, not an embedded engine` | **pass** — PostgreSQL 16.2, real client backends |

### The tests were mutation-checked

Removing `AND revision = $5` from the `UPDATE` and re-running produced **`[200, 200]`** — a genuine
lost update — plus failures in the ten-writer and stale-save tests. The assertions are load-bearing
rather than decorative.

> **Honest caveat.** An earlier attempt at this mutation left the parameter array untouched, so the
> statement errored (`$5` unused) and the API returned **500, 500**. That is a broken mutation, not
> evidence; the result above comes from removing both the predicate and the parameter.

### Revision history — what does and does not exist

`revision` is a **counter, not a log**. A version-safe overwrite prevents losing an edit; it does not
allow recovering one. After an overwrite the previous document is gone. This is unchanged from the
previous report and is still a limitation, not a feature.

## 3. Step 3 — forced-overwrite sunset

**Correction applied.** The published sunset was **2026-05-09**, which had already passed on
2026-11-09 when it was written. The intent was six months from 2026-11-09 (**2027-05-09**); the sum
was wrong. The date was **honoured, not extended**.

| Requirement | Evidence | Result |
| --- | --- | --- |
| Sunset enforced | `tests/unit/design-studio-sunset.test.ts` (4 tests) — boundary at `2026-05-08T23:59:59Z` allowed, `2026-05-09T00:00:00Z` refused, and refused at 2030 | **pass** |
| Route answers 410 with a fix | `closes the compatibility path at its published sunset with a 410 and a fix` | **pass** — `FORCED_OVERWRITE_SUNSET`, message names `2026-05-09` and `expectedRevision` |
| Header form also closed | `closes the header form of the compatibility path too` | **pass** — 410 |
| Nothing was written by a refused forced save | same test | **pass** — `revision` still 1, document unchanged |
| Audit records | existing `DESIGN_STUDIO_TEMPLATE_FORCED` action retained for the re-open case; normal writes audited as `_UPDATED` / `_RENAMED` | unchanged |
| Timestamps | `last_forced_at` retained on the row (migration 0104), partial index intact | **pass** |
| Ownership cannot be skipped | real-PostgreSQL test above | **pass** |
| Re-open is deliberate | `DESIGN_STUDIO_ALLOW_FORCED_OVERWRITE` only accepts `true`/`1`; anything else **fails closed**; a warning is logged at route registration | **pass** |

Nothing in the code extends the date. `FORCED_OVERWRITE_SUNSET` is a constant asserted by test to be
`2026-05-09`; changing it is a visible edit that fails that test until the test is changed too.

## 4. Step 4 — frontend revision integrity

`frontend/tests/unit/design-studio-templates-panel.test.tsx` — **23 tests, all pass**.

| Requirement | Evidence | Result |
| --- | --- | --- |
| Every overwrite carries the server's revision | `sends the loaded revision so a stale tab cannot silently win` — asserts `expectedRevision: 7` (the value the list served), and no `name` in the body | **pass** |
| The client always sends the revision it was given | `sends expectedRevision on every overwrite it makes` — asserts `expectedRevision: 7` and `now version 8` afterwards | **pass** |
| No unconditional overwrite is reachable | `never sends \`force\` and always sends both payload keys the API requires` — inspects every `PUT`/`PATCH`/`POST` body **and** every request header | **pass** |
| A missing revision is refused, not invented | `refuses to load a template that came back without a version number` — nothing applied, no "save over" offered | **pass** |
| Conflict recovery | `says a conflicting overwrite changed nothing, and reloads the list` — 409 clears the loaded template so a retry cannot repeat the mistake | **pass** |

## 5. Step 5 — regression and migration verification

| Suite | Result |
| --- | --- |
| `tsc --noEmit` (server) | **clean** |
| `tsc -p frontend/tsconfig.json --noEmit` | **clean** |
| design-studio units + API + templates + migration + `migrate.test.ts` + tools-api | **14 files, 274 passed, 2 skipped** |
| Real-PostgreSQL suites (`npm run test:postgres`) | **2 files, 12 passed** |
| Frontend | **84 files, 1055 passed** |
| **Full backend suite** (`vitest run tests`) | **278 files, 3,494 passed, 0 failed, 26 skipped** |
| `npm run build:frontend`, `npm run build:tools` | **clean** |

### Migrations — fresh install and existing database

`tests/integration/design-studio-templates-migration.test.ts` — **6 tests, all pass** on real
PostgreSQL (+ PGlite for the fresh-install half).

* **Fresh install**: table, all eleven columns, `revision NOT NULL DEFAULT 1`, `last_forced_at`
  nullable, all four indexes present, all three migrations recorded.
* **Existing database**: a row inserted, the two columns dropped and the two migrations removed from
  `schema_migrations`, then `migrateUp` re-run — the row survives unchanged, `revision` becomes 1,
  `last_forced_at` is `NULL` (not "now"), and a second run applies nothing.

### A defect found and fixed during this block

`main` had independently taken migration version **0099** (`0099_create_visitor_intelligence.sql`)
while this branch was using it for `0099_create_design_studio_templates.sql`. `schema_migrations` has
a primary key on `version`, so on a **fresh install** the second file failed and rolled back — a
production-only failure for anyone creating a new database. The block was renumbered to
**0102 / 0103 / 0104**, and `has no two migration files sharing a version number` now guards it.

## 6. What was not run, and what the skips mean

**The full backend suite has now been run**: `vitest run tests` → **278 files, 3,494 passed, 0 failed,
26 skipped**. It was run twice: the first run exposed one failure, which was a real one (see below).

### The 26 skips, itemised

None of them is a silent pass; each names its gate.

| Suite | Tests | Gate | Verified this block? |
| --- | --- | --- | --- |
| `design-studio-templates-postgres.test.ts` | 7 | `TEST_POSTGRES_URL` unset in the full run | **Yes**, separately, against PostgreSQL 16.2 — 6 tests pass (+1 conditional skip) |
| `ga4-purchase-postgres.test.ts` | 11 | `GA4_PG_TEST_CONFIRM=disposable` + `GA4_PG_TEST_SOCKET` | **Yes** — 5 pass on a disposable socket server; the other 6 are `it.skip` historical cases that no environment enables |
| `tool-page-status.test.ts` | 6 | needs a built SPA shell in `public/` | **Yes** — built the frontend, 6 pass |
| `design-studio-templates-migration.test.ts` (2 real-PostgreSQL cases) | 2 | `TEST_POSTGRES_URL` | **Yes**, 6 pass with the server |

The GA4 suite was worth the effort: it is the suite most likely to have been disturbed by renumbering
migrations 0099→0102–0104, and it passes.

### Still not run

* **Anything outside this sandbox.** No staging deployment, no production deployment, no provider
  operations, no financial transactions.
* **Load or soak testing.** "Ten writers" is a race, not a capacity test.
* **The two-database-replica case.** Every test here uses one primary.

### A second defect found by the full run

`tests/integration/ga4-reconciliation-migration.test.ts` asserted the *exact* list of migrations
applied after 0092. Adding 0102–0104 made a GA4 test fail for a reason that had nothing to do with
GA4. The fix pins the GA4 migrations exactly and asserts the *ordering and completeness* of the rest,
so the next unrelated migration does not break a test that is not about it. Loosening the assertion
until it passed would have removed the check that nothing is skipped.

## 7. Outstanding limitations

1. **No revision history.** `revision` counts; it does not retain. An accepted overwrite is
   unrecoverable.
2. **The re-open lever exists.** `DESIGN_STUDIO_ALLOW_FORCED_OVERWRITE=true` restores the unsafe path
   for a deployment. It logs a warning at registration and audits each use, but while it is set, a
   client can lose another writer's edit.
3. **`last_forced_at` is now historical.** With the path closed, new non-NULL values are only written
   under the re-open lever; existing values record the period before closure.
4. **The concurrency guarantees are tested at the statement level.** They hold because the check is in
   the `WHERE` clause; they have not been tested through a load balancer, a connection pooler in
   transaction mode, or a replica.
5. **Local only.** Passing here is evidence of correctness in this environment and nothing more.

## 8. How to reproduce

```bash
# real-PostgreSQL suites (skipped, loudly, when TEST_POSTGRES_URL is unset)
TEST_POSTGRES_URL=postgresql://user@host:5432/postgres npm run test:postgres

# the GA4 outbox suite, which needs its own disposable socket server
GA4_PG_TEST_CONFIRM=disposable GA4_PG_TEST_SOCKET=/path/to/socket/dir \
  npx vitest run tests/integration/ga4-purchase-postgres.test.ts

# everything
npx tsc --noEmit && (cd frontend && npx tsc -p tsconfig.json --noEmit)
npx vitest run tests          # 278 files, 3494 pass, 26 skipped without the gates above
npx vitest run frontend/tests
```

The disposable server used for this report was PostgreSQL 16.2 started from a throwaway install under
`/tmp`, with the OS user granted a role so the GA4 harness could connect over its unix socket. It is
not a project dependency, and it was stopped afterwards.
