# Visitor Intelligence — Local Corrective Implementation Record

- **Date:** 2026-11-09 (UTC)
- **Branch:** `arena/a25c5ad2-cloudhost247` (**active**)
- **Record type:** Local implementation and validation record; **not** a staging certification or independent PostgreSQL verification.
- **Decision:** Staging remains **HOLD**. Production remains **NO-GO**.

## 1. Scope and boundary

This record documents the authorized local corrective phase following the P1 review. It supplements, and does not replace or amend, `VISITOR-INTELLIGENCE-STAGING-CERTIFICATION-2026-11-09.md`; that certification report was left unchanged.

No migration was applied. No staging, production, WHMCS, or provider operation was performed. No commit or push was made. Existing unrelated working-tree changes were preserved.

## 2. Corrective changes inspected

| Finding | Local change | Evidence boundary |
|---|---|---|
| Encoded administrative/internal route aliases | `cloudhost247-node/src/routes/visitor-intelligence.ts` now canonicalizes ASCII percent-encoded separators and backslashes before checking excluded roots; it bounds repeated decoding and rejects ambiguous residual encodings. `shared/site/visitor-intelligence.js` applies equivalent route-root exclusions before creating visitor identity. Both generated WHMCS runtime copies were synchronized from the shared source. | Sanitizer and jsdom regressions were executed locally. The API integration regression was added but not run. No live WHMCS rendering was performed. |
| Exact 30-minute session boundary | The server session upsert now requires `last_seen_at > now() - 30 minutes`; equality is expired. The conflict fallback classifies elapsed time `>= 30 minutes` as expired. The browser already treats only ages strictly below 30 minutes as reusable. | Exact-boundary server-service and browser-runtime unit regressions were executed. The API-level boundary test was added but not run. |
| Lost partial settings updates | The settings PATCH transaction locks the singleton settings row with `SELECT ... FOR UPDATE` before reading omitted fields and writing the merged values. | A simultaneous partial-PATCH API regression was added. It was not run because the API test fixture applies migrations. No PostgreSQL lock behavior was observed. |
| Retention retry and concurrent row refresh | Retention deletion statements recheck the expiry/heartbeat predicate in the `DELETE`. The pruner checks whether eligible work remains and reports a bounded backlog accurately. Worker scheduling is factored into a helper that schedules a 15-minute retry for backlog or failure. | Worker retry and mocked concurrent-presence-refresh unit tests were executed. These tests do not establish database-level concurrent behavior. |
| Successful disable cleanup | Disabling collection continues to delete live presence while retaining historical sessions/pageviews. A service-level cleanup regression and an API-level success regression were added. | The service-level mocked unit regression was executed. The API-level regression was not run. |

## 3. Local validation performed

Commands were run from `cloudhost247-node` unless noted:

- `npm run typecheck` — **PASS**. This checks the configured application TypeScript sources; it does not typecheck the excluded test tree.
- `npm test -- tests/unit/visitor-intelligence.test.ts tests/unit/visitor-intelligence-service.test.ts tests/unit/visitor-intelligence-retention-worker.test.ts frontend/tests/unit/visitor-intelligence-runtime.test.ts` — **PASS**, 4 files and **23 tests**.
- TypeScript `transpileModule` syntax checks — **PASS** for `tests/integration/visitor-intelligence-api.test.ts` and the two new service/worker unit test files. This is syntax transpilation, not execution or full typechecking of the integration suite.
- `git diff --check` — **PASS**.
- Generated-copy parity check — **PASS**; both WHMCS visitor-intelligence scripts matched the shared runtime plus the expected generated-file header.

Dependencies were restored locally with `npm ci --no-audit --no-fund` to run these checks. No package manifest or lockfile change was made.

## 4. Verification gaps and limits

- `tests/integration/visitor-intelligence-api.test.ts` was **not executed**. Its `beforeEach` calls `migrateUp()` on a PGlite database. Running it would apply migrations, which was outside this phase’s authorization.
- Consequently, the added API regressions for encoded routes, exact server expiry, concurrent settings PATCHes, and successful disable were not behaviorally executed.
- The executed retention concurrency regression uses a mocked `Queryable` to model a refreshed presence row and verify the delete predicate/retry loop. It is not a PostgreSQL concurrency test.
- No real PostgreSQL verification was performed for session expiry, settings row locking, retention deletion/retry, or disable cleanup. No PGlite result from the migration-based API suite is claimed here.
- No full test suite, migration application, staging certification, deployment, production check, or live WHMCS test was performed.

## 5. Readiness decision

The local code and safe focused checks support recording the corrective implementation, but they do not establish full API integration, database concurrency, real-PostgreSQL, or staging behavior. This record is **not sign-off** and does not change the prior certification decision:

- **Staging: HOLD** pending separately authorized integration/database verification and operator review.
- **Production: NO-GO**.
- Migration application, staging/production/provider actions, commit, and push remain outside the authorization recorded for this phase.
