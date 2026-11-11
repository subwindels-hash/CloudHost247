# Fraud Sentinel AI — Implementation Report

**Module:** CloudHost247 Fraud Sentinel (advisory fraud detection & risk intelligence)
**Design record:** `cloudhost247-node/docs/FRAUD_SENTINEL_PLAN.md`
**Operator documentation:** `cloudhost247-node/docs/FRAUD_SENTINEL.md`
**Branch:** `arena/178c36bc-cloudhost247`, branched from `main` at `71dd71971f6cbdfc195ec293ef78076e42271d87`
**Pull request:** [#124](https://github.com/subwindels-hash/CloudHost247/pull/124) — **draft**, into `main`, left in draft
**Report date:** 2026-11-11

Every number in this report was produced by a command that was actually executed in this working
copy. Checks that could not be executed here are listed in §7 with the reason — none of them is
reported as passed.

---

## 1. What was built

An advisory fraud-detection layer over the data CloudHost247 already records. It projects 11 source
tables into an idempotent event ledger, scores every active subject against 40 reviewed detection
rules grouped into 12 capped scoring families, raises alerts for human review, keeps an append-only
record of every reviewer conclusion, and exposes the whole thing through a permission-gated admin API
and SPA module.

The design constraint that shaped every decision: **the module observes and reports, and performs no
enforcement action of any kind.** It cannot approve or reject a payment, issue a refund, transfer
money, change a balance, seize funds, suspend an account, change a service entitlement, bypass WHMCS
authorization or override a financial control. Those capabilities are absent from the code, not merely
unused, and §6 records the two independent tests that prove it.

Scores are deterministic: a documented sum of capped rule weights over stored rows, with reasons and
evidence references persisted beside the score. No model produces a number. AI assistance is an
optional, off-by-default summary *beside* a deterministic score, and each assessment records whether
such text is present.

### Scale

| Area | Files | Lines |
| --- | --- | --- |
| Backend module `src/fraud-sentinel/` | 25 | 10,717 |
| Migration `0101_create_fraud_sentinel.sql` | 1 | 902 |
| Frontend module (client, shell, widgets, 9 pages) | 12 | 4,657 |
| Tests (4 backend suites + 1 frontend suite) | 5 | 4,306 |
| Documentation (`FRAUD_SENTINEL.md`, `FRAUD_SENTINEL_PLAN.md`) | 2 | 793 |

---

## 2. Files created

### Database

```
cloudhost247-node/database/migrations/0101_create_fraud_sentinel.sql
```

Additive only: 9 tables, 43 indexes, 1 sequence, 40 seeded rules and 16 seeded settings. **Zero**
`ALTER TABLE`, `UPDATE`, `DELETE` or `DROP` against any pre-existing table. Next free version after
`0100_ai_website_knowledge.sql`; the forward-only checksummed runner required no renumbering.

| Table | Purpose |
| --- | --- |
| `fraud_sentinel_events` | Idempotent, redacted projection of source rows. Unique `dedupe_key = '<table>:<source_id>:<observable state>'`; `id` is md5-derived from it |
| `fraud_sentinel_rules` | Configured rule set (unique `code`) |
| `fraud_sentinel_rule_history` | **Append-only** snapshots; 6-value `change_type` CHECK |
| `fraud_sentinel_assessments` | Scored results; all-or-none `ai_*` CHECK |
| `fraud_sentinel_alerts` | `alert_number = 'FS-' || lpad(nextval, 8, '0')`; **partial** unique index over `dedupe_key WHERE status IN ('new','under_review','escalated')`; paired assignment/resolution CHECKs |
| `fraud_sentinel_investigations` | Reviewer timeline; `actor_type IN ('staff','system')`, 12-value action CHECK |
| `fraud_sentinel_risk_history` | Score trail per subject |
| `fraud_sentinel_false_positives` | UNIQUE per alert; 6-value reason category; explanation 3–4000 chars |
| `fraud_sentinel_runs` | Run history **and** the concurrency lock (unique `run_key`), 8 counters |

Seeded rule ids are deterministic (`11111111-0000-4000-8000-0000000000{01..40}`) so the seed is
re-runnable and the parity test can compare row-by-row.

### Backend

```
cloudhost247-node/src/fraud-sentinel/types/index.ts                 (515)
cloudhost247-node/src/fraud-sentinel/permissions.ts                 (123)
cloudhost247-node/src/fraud-sentinel/rules/catalogue.ts             (810)
cloudhost247-node/src/fraud-sentinel/rules/signals.ts               (773)
cloudhost247-node/src/fraud-sentinel/rules/detectors.ts            (1302)
cloudhost247-node/src/fraud-sentinel/rules/engine.ts                (378)
cloudhost247-node/src/fraud-sentinel/rules/transitions.ts            (69)
cloudhost247-node/src/fraud-sentinel/utils/redaction.ts             (247)
cloudhost247-node/src/fraud-sentinel/utils/settings.ts              (218)
cloudhost247-node/src/fraud-sentinel/repositories/events-repo.ts   (1123)
cloudhost247-node/src/fraud-sentinel/repositories/signals-repo.ts   (279)
cloudhost247-node/src/fraud-sentinel/repositories/rules-repo.ts     (286)
cloudhost247-node/src/fraud-sentinel/repositories/assessments-repo.ts (439)
cloudhost247-node/src/fraud-sentinel/repositories/alerts-repo.ts    (397)
cloudhost247-node/src/fraud-sentinel/repositories/investigations-repo.ts (359)
cloudhost247-node/src/fraud-sentinel/repositories/runs-repo.ts      (240)
cloudhost247-node/src/fraud-sentinel/services/scan-service.ts       (467)
cloudhost247-node/src/fraud-sentinel/services/alert-service.ts      (681)
cloudhost247-node/src/fraud-sentinel/services/rule-service.ts       (470)
cloudhost247-node/src/fraud-sentinel/services/investigation-service.ts (289)
cloudhost247-node/src/fraud-sentinel/notifications/reviewer-alerts.ts (87)
cloudhost247-node/src/fraud-sentinel/jobs/definitions.ts            (149)
cloudhost247-node/src/fraud-sentinel/jobs/runner.ts                 (119)
cloudhost247-node/src/fraud-sentinel/jobs/scheduler.ts               (70)
cloudhost247-node/src/fraud-sentinel/controllers/routes.ts          (827)
```

### Frontend

```
cloudhost247-node/frontend/src/lib/fraud-sentinel-api.ts            (577)
cloudhost247-node/frontend/src/components/fraud-sentinel/FSLayout.tsx (118)
cloudhost247-node/frontend/src/components/fraud-sentinel/fs-widgets.tsx (507)
cloudhost247-node/frontend/src/pages/fraud-sentinel/DashboardPage.tsx (192)
cloudhost247-node/frontend/src/pages/fraud-sentinel/AlertsPage.tsx   (226)
cloudhost247-node/frontend/src/pages/fraud-sentinel/AlertDetailPage.tsx (552)
cloudhost247-node/frontend/src/pages/fraud-sentinel/AssessmentsPage.tsx (262)
cloudhost247-node/frontend/src/pages/fraud-sentinel/CustomerRiskPage.tsx (407)
cloudhost247-node/frontend/src/pages/fraud-sentinel/TransactionsPage.tsx (202)
cloudhost247-node/frontend/src/pages/fraud-sentinel/RulesPage.tsx    (558)
cloudhost247-node/frontend/src/pages/fraud-sentinel/InvestigationsPage.tsx (249)
cloudhost247-node/frontend/src/pages/fraud-sentinel/OperationsPage.tsx (807)
```

### Tests

```
cloudhost247-node/tests/unit/fraud-sentinel-rules.test.ts          (1055)  53 tests
cloudhost247-node/tests/integration/fraud-sentinel-migration.test.ts (395)  10 tests
cloudhost247-node/tests/integration/fraud-sentinel-detection.test.ts (953)  22 tests
cloudhost247-node/tests/integration/fraud-sentinel-api.test.ts     (1275)  24 tests
cloudhost247-node/frontend/tests/unit/fraud-sentinel-api.test.tsx   (628)  28 tests
```

### Maintenance script (deviation — see §8)

```
cloudhost247-node/scripts/fraud-sentinel-seed.ts
```

Regenerates the migration's rule-seed block from `rules/catalogue.ts`. Promoted from a working scratch
file because the migration test asserts catalogue↔seed parity: without this script, an operator who
edits a rule gets a loud, correct test failure and no way to fix it except hand-editing 40 `INSERT`
rows.

---

## 3. Files modified (surgical, additive)

| File | Change |
| --- | --- |
| `cloudhost247-node/src/app.ts` | +1 import, +1 `await registerFraudSentinelRoutes(instance, env, pool);` immediately after the Revenue Guardian registration (+6 lines) |
| `cloudhost247-node/src/worker/main.ts` | +1 interval constant (`FRAUD_SENTINEL_SWEEP_INTERVAL_MS = 5 * 60_000`), +1 schedule field, +1 `runFraudSentinelCycle(ctx.db)` call before the security-number sweep (+19 lines) |
| `cloudhost247-node/frontend/src/App.tsx` | +9 lazy imports, +12 `/admin/fraud-sentinel*` routes inside the **existing** `RequireRole roles={['admin','super_admin']}` guard (+28 lines) |
| `cloudhost247-node/frontend/src/pages/AdminPage.tsx` | +1 navigation `Link` (+1 line) |
| `cloudhost247-node/frontend/src/navigation/registry.generated.ts` | regenerated (+12 route patterns) |
| `cloudhost247-node/src/navigation/registry.generated.ts` | regenerated (+12 route patterns, same generator run) |
| `shared/site/generated/route-report.json` | regenerated (`spaRoutesKnown` 157 → 165) |

No existing route, service, migration, table or payment path was altered. The two generated registry
copies and the route report were refreshed with `node scripts/site/generate.mjs`; that run also
rewrote twelve unrelated `frontend/public/docs/*.md` files with em-dash normalisation that pre-dates
this work, and those were reverted so this change stays surgical (`node scripts/site/generate.mjs
--check` passes: 255 links validated, 244 app / 243 PHP).

---

## 4. Verification actually executed

All commands run from `cloudhost247-node/` unless stated. `node_modules` was installed with
`npm ci --no-audit --no-fund`; tests were run through the repository's own binary
(`./node_modules/.bin/vitest run …`), never through `npx`.

| # | Command | Result |
| --- | --- | --- |
| 1 | `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) | **exit 0**, no output |
| 2 | `npm run typecheck:scripts` (`tsc -p tsconfig.scripts.json --noEmit`) | **exit 0**, no output |
| 3 | `tsc -p frontend/tsconfig.json --noEmit` | 1 error, **pre-existing and unrelated**: `frontend/src/lib/markdown.tsx(32,15)` uses `String.replaceAll` under `lib: ES2020`. That file is untouched by this work (`git status` does not list it). Every Fraud Sentinel file compiles clean |
| 4 | `./node_modules/.bin/vitest run tests/unit/fraud-sentinel-rules.test.ts` | **53 passed** |
| 5 | `./node_modules/.bin/vitest run tests/integration/fraud-sentinel-migration.test.ts` | **10 passed** |
| 6 | `./node_modules/.bin/vitest run tests/integration/fraud-sentinel-detection.test.ts` | **22 passed** |
| 7 | `./node_modules/.bin/vitest run tests/integration/fraud-sentinel-api.test.ts` | **24 passed** (≈83 s) |
| 8 | `./node_modules/.bin/vitest run frontend/tests/unit/fraud-sentinel-api.test.tsx` | **28 passed** |
| 9 | Regression: suites 4–7 + `tests/integration/revenue-guardian-api.test.ts` | **103 passed** (≈108 s) |
| 10 | Regression: `tests/integration/navigation-links.test.ts`, `frontend/tests/unit/{link-integrity,marketing-pages,business-tools-page}.test.tsx` | **406 passed** — the App.tsx route additions and the regenerated registry break no link-integrity guarantee |
| 11 | `git diff --check` (repo root) | **exit 0**, no whitespace errors |
| 12 | `node scripts/site/generate.mjs --check` (repo root) | **✓ registry valid — 255 links (244 app, 243 PHP)** |
| 13 | Payment/customer regression (the suites Phase 5 names): `fraud-sentinel-migration`, `payments-api`, `payments-schema`, `payment-authorization-matrix`, `billing-api`, `billing-lifecycle-e2e`, `billing-schema`, `admin-billing-api`, `admin-customers-api`, `account-api`, `customer-identity-api`, `customer-security`, `auth-flow`, `customer-app-schema`, `commerce-schema`, `unit/money` | **240 passed (16 files), 0 failed**, 559 s, exit 0 |
| 14 | Full suite: `./node_modules/.bin/vitest run` (277 test files) | **Started, not completed — see the note below.** 29 files had reported when it was stopped: **1015 tests passed, 0 failed**, including all four backend Fraud Sentinel suites and the frontend one |
| 15 | `npm run build` (`typecheck:scripts` → `tools:catalog:check` → `build:server` → `build:frontend` → `build:tools`) | **exit 0**, all five steps, no errors and no warnings. The Fraud Sentinel screens are code-split into their own lazy chunks (`AlertDetailPage-*.js` 13.79 kB / 4.33 kB gzip, `OperationsPage-*.js` 22.74 kB / 6.40 kB gzip), so the module adds nothing to the application shell's cold start |

**Why the full suite is recorded as incomplete rather than passed.** This sandbox has 2 vCPUs
(`nproc` = 2) and Vitest spawns 4 workers, so the PGlite-backed integration suites — which dominate
this repository and take 40–130 s each — run far below their usual throughput. After ~30 minutes of
wall clock, 29 of 277 files had reported, all green. Projecting that rate puts a full run at several
hours, which is beyond this session. Rather than report a number that was never observed, the run was
stopped and the regression the plan actually names ("regression of existing payment/customer suites")
was executed to completion as row 13: 16 files, 240 tests, zero failures. Rows 4–10 cover every Fraud
Sentinel suite plus the navigation/link-integrity suites that this change could plausibly break. No
failure of any kind was observed in any run recorded in this table.

Integration tests run against **real embedded Postgres** (PGlite) with the full 101-migration chain
applied through the production runner (`migrateUp`), then build the real Fastify app
(`buildApp(env, {serveFrontend: false, pool})`) and drive it with `app.inject` using real signed JWTs.
Nothing is mocked at the database or HTTP layer.

### What the suites cover

**Unit (53)** — detector purity and the scoring maths: family-cap allocation (heaviest-rule-first,
`capped` reported as the sum of credited weights), score clamping, threshold ladder, confidence
derivation and its one-step downgrade on a `material` data-quality flag, `rule_set_version`
fingerprint stability and sensitivity, alert title/explanation text, recommendation building, evidence
de-duplication, PAN masking (Luhn-gated), each secret pattern in the redaction deny-list, the
transition map, and settings sanitisation including the monotonic-ladder repair.

**Migration (10)** — every object exists with the constraints the code depends on (verified through
`pg_indexes` and `pg_constraint`, since unique indexes are not constraints); the 40 seeded rows are
byte-equivalent to the code catalogue field-by-field (with canonicalised jsonb comparison, because
jsonb does not preserve key order); the 16 seeded settings match `FS_DEFAULT_SETTINGS`; the migration
is additive (no pre-existing table's rows or definition changed); and the rollback script in the
migration header is **extracted from the file and executed**, then asserted to leave every
pre-existing table in place.

**Detection (22)** — end-to-end passes over real fixtures: a card-testing pattern (3 declines then an
approval on one invoice) yields exactly one alert at score 30/medium with a 6-row ledger; ingestion
idempotency across repeated passes; a state change producing a new observable event; IP-subject
derivation and its 5-event floor; actor-subject enumeration from `auth_audit_log`; superseding
re-assessment writing a `re_detected` timeline row; retention pruning on the injected evaluation
instant; the run-lock claim/reclaim discipline; webhook replay detection; the module-source import ban
and financial-write ban; and the snapshot-diff financial invariant.

**API (24)** — authentication and RBAC (staff/customer 403 before any handler; a disabled account 401;
role re-read from the database per request); `/meta` publishing the whole vocabulary and state machine;
alert list filters including the three-state `unassigned`; detail with `evidenceIntegrity`;
out-of-scope id returning **404 not 403**; poisoned evidence being withheld rather than leaked; the
full lifecycle with auto-assignment; an illegal transition returning **409 `ILLEGAL_ALERT_TRANSITION`**;
assignment validation; false-positive minimums, the duplicate-report conflict and the rule-feedback
report; notes; CSV export shape and its audit row; assessments and the customer risk profile and event
ledger; on-demand re-assessment; rule list, drift, detail, reasoned weight change with versioning and
catalogue sync; settings clamp with both requested and stored values audited; scan; a named job run and
an unknown-job 404; the runs ledger; and the dashboard overview.

**Frontend (28)** — the permission mirror may only ever narrow; the query encoder preserves
`?unassigned=false` and drops empty values; the transport paths, methods, bearer header and bodyless
POST; the CSV export's filters, filename parsing and error propagation; the reviewer picker reading the
platform's staff directory and excluding disabled accounts; the `/meta` cache fetching once for many
consumers; and rendered pages proving the vocabulary is **not** hardcoded — a status that exists
nowhere in this repository is placed in the stubbed `/meta` payload and then asserted to appear in the
alert-queue filter and in the alert-detail transition menu, while an illegal one does not.

---

## 5. Security and integrity properties, and the test that proves each

| Property | Enforced by | Proved by |
| --- | --- | --- |
| No financial writes | Module source imports no payment/billing/WHMCS/order/subscription service; no `INSERT`/`UPDATE`/`DELETE` against a financial table | Static source scan (detection suite) |
| Financial tables byte-identical after a full scan + alert lifecycle + retention | The module never writes them | Snapshot diff across 7 tables (detection suite) |
| `billing_ledger` immutable | Platform `no_update`/`no_delete` triggers pre-date this module | Read-only usage; migration suite confirms the triggers survive 0101 |
| Staff and customers cannot read fraud evidence | `FS_PERMISSIONS` map; `requireFsPermission` re-reads `users.role` from the DB per request | API suite (403 before handler) |
| Settings are super-admin only | `fraud_sentinel.settings` held by `super_admin` alone | API suite (`canEdit:false` for admin; 403 on PATCH) |
| Existence is not disclosed across scope | 404 rather than 403 for an out-of-scope id | API suite |
| No secrets leave the process | Redaction on ingestion **and** re-check on egress (`safeEvidence`, `withEvidenceIntegrity`) | Unit suite (patterns) + API suite (withheld payload) |
| An alert cannot be closed silently | Note ≥ 10 chars for `resolved`/`false_positive`; FP explanation ≥ 15 | API suite + frontend suite (button disabled until the minimum is met) |
| Rule tuning is accountable | Append-only `rule_history` + `audit_logs`; reason required for a weight change; weight bounded 1–30 | API suite + migration suite |
| A redeploy cannot reset a tuned rule | `POST /rules/sync` inserts missing codes only | API suite |
| Scoring changes are deliberate | `SCORING_SETTING_KEYS` require a reason; values clamped; both requested and stored values audited | API suite |
| Two workers cannot double-process a bucket | Unique `run_key`; `INSERT … ON CONFLICT DO NOTHING RETURNING` | Detection + API suites |
| The UI cannot invent a verdict | Every vocabulary, transition and minimum read from `/meta`; advisory statement rendered in the server's words | Frontend suite |

---

## 6. Honest limitations

These are recorded in `docs/FRAUD_SENTINEL.md` and repeated here because a report that omits them would
overstate the module:

1. **It is a detection aid, not an adjudicator.** A high score means recorded activity matched patterns
   that warrant a human look. False positives are expected; the module's answer to them is the
   false-positive report and the rule-feedback table, which is the only tuning signal it can honestly
   produce from its own records.
2. **No external intelligence and no network calls.** No IP reputation feed, no BIN table, no device
   fingerprinting, no email-reputation service, no third-party fraud API. The two geography rules
   resolve IPs through the platform's own **local** geoip-lite database
   (`src/visitor-intelligence/geo.ts`) and do haversine arithmetic on city-centre coordinates. That
   accuracy is approximate, both rules say so in their reason text, an unresolvable IP raises a
   `GEO_UNAVAILABLE` data-quality flag (which also downgrades confidence), and a VPN or proxy exit
   produces the same impossible-travel pattern.
3. **No model produces a score.** `ai_assist_enabled` ships **false**. When enabled, model text appears
   beside the deterministic score and the assessment is flagged `ai_assisted` with its `ai_engine`; the
   score, level, confidence and rule derivation are never model output.
4. **Weights are judgement, not statistics.** They are reviewed defaults chosen to make single strong
   signals visible and noisy families bounded. They are not fitted to a labelled fraud dataset — this
   platform does not have one.
5. **Coverage follows the sources.** A deployment missing one of the 11 source tables loses the rules
   that read it; the pass reports the skipped source rather than silently scoring without it.
6. **The ledger has its own retention.** Evidence older than `retention_event_days` (180) is pruned
   even though the source rows are not, so an old assessment can outlive the events that produced it.
   Alerts, investigations, false-positive reports and rule history are never pruned.
7. **One open alert per (subject, primary rule).** A continuing pattern increments `recurrence_count`
   instead of filling the queue — at the cost of one row representing many occurrences.
8. **Relationship to the existing `fraud-guardian` AI agent.** That agent (`src/ai-os/`) emits
   `ai_findings` and was left completely untouched. Fraud Sentinel is the durable system of record its
   findings can point at; it does not duplicate or replace the agent, and no agent behaviour changed.

---

## 7. Checks that could not be run here

Listed as skipped with the reason, never as passed:

| Check | Why it could not run |
| --- | --- |
| Deployment to a staging host, `npm run migrate` against a live PostgreSQL server | No staging host and no external PostgreSQL reachable from this workspace. Migrations were instead applied through the production runner against embedded PGlite with the full 101-migration chain, which exercises the same code path including checksums and the runner transaction |
| Live payment-provider webhook traffic | No provider credentials. Webhook rules were tested against real `webhook_events` rows written by the fixture, including a replay and a reject burst |
| Real SMTP delivery of reviewer notifications | Notifications ride the existing `user_notifications` + `notification_outbox` pipeline; delivery is that pipeline's concern and is covered by its own suites. This module's tests assert the notification rows it creates |
| Browser/E2E (Playwright) pass over the new screens | No browser infrastructure in this workspace. The SPA screens are instead covered by jsdom + Testing Library render tests (28), and the whole frontend compiles under `tsc` |
| Whole-repository `npm test` to completion | 2 vCPUs; 29 of 277 files reported (1015 tests, 0 failures) before the projected multi-hour runtime made it impractical here. Stopped deliberately and recorded as incomplete — the payment/customer regression the plan names was run to completion instead (§4 rows 13–14) |
| `php -l` | No PHP file was modified. `scripts/site/generate.mjs` rewrites the PHP theme's `site.json` resource; that output was byte-identical to what is committed (it does not appear in `git status`), and the generator's own validation passed |

---

## 8. Deviations from the plan, and why

The plan in `docs/FRAUD_SENTINEL_PLAN.md` was followed as written, with four recorded deviations:

1. **One page added: `AssessmentsPage.tsx`.** The plan named eight pages. `GET /assessments` exposes
   every stored assessment for every subject type, including the low and medium results that never
   became an alert and the subjects that are not customers (an IP address, a webhook gateway, a staff
   account). No planned screen could reach those rows, so a ninth page was added. Rule history and the
   settings screen were *not* given pages of their own: they are sections of `RulesPage` and
   `OperationsPage`, and the module navigation points only at routes the router actually serves.
2. **One maintenance script added: `scripts/fraud-sentinel-seed.ts`** (see §2). The migration test
   asserts catalogue↔seed parity; the script is what makes a catalogue edit fixable.
3. **`GET /meta` publishes one more key: `investigationActions`.** The investigation ledger is
   filterable by action, and the 12-value vocabulary is a backend constant. Publishing it keeps the
   frontend's "hardcode no vocabulary" rule true for that filter too. Additive; the existing `/meta`
   assertions were extended rather than weakened.
4. **Two generated files outside `cloudhost247-node/` were refreshed** (`src/navigation/registry.generated.ts`
   and `shared/site/generated/route-report.json`) because the plan's "Modified — integration points"
   list anticipated exactly this case ("`frontend/src/navigation/*` — only if the admin nav is defined
   there (verified during Phase 4)"). The nav *is* generated, so it was regenerated rather than
   hand-edited.

### Defects found by running the suites, and fixed in the module

The tests were written against the design and then run; where a test failed because the **code** was
wrong, the code was fixed. These are the real defects that surfaced:

| Defect | Fix |
| --- | --- |
| Unqualified columns in a scoped query that joins `users` (which has its own `customer_id` and `status`) | Every scope and filter clause now carries the query's table alias (`scopeClause(scope, params, alias)`) |
| Actor subjects were enumerated only from rows typed `actor`, leaving 4 of the 8 `ADM_*` rules unreachable — the platform records those events with `subject_type='customer'` and an `actor_id` | `listActiveSubjects` gained a UNION ALL actor arm following where the platform actually records the actor |
| A plain `Error` from a service reached the error handler with no `statusCode` and became a 500 | Domain refusals are `HttpError` subclasses: an illegal transition is now **409 `ILLEGAL_ALERT_TRANSITION`** via `assertAlertTransition` |
| `parameters` drift was reported for every multi-parameter rule on a freshly migrated database — jsonb reorders object keys, so `JSON.stringify` comparison can never match the code default | `canonicalJson()` (recursive sorted-key serialisation) in `rule-service.ts` |
| `?unassigned=false` returned exactly the rows the caller asked to exclude — a `boolean` filter built as `if (filters.x)` cannot express `false` | Three-state filter in `alerts-repo.ts`: `true` → `IS NULL`, `false` → `IS NOT NULL`, absent → no filter |
| The CSV export applied a default 30-day window the list screen had not applied, so the download disagreed with the table it claimed to export | The window is applied only when the caller passed `since`/`until`/`days`, and the audit row records `window: null` when none was |
| The export's audit row did not say what was exported | Audit metadata now carries `{rows, total, filters, window}` |

---

## 9. Phase gates

| Phase | Exit evidence required | Status |
| --- | --- | --- |
| 1 Inspection | Plan document + base SHA recorded | ✅ `docs/FRAUD_SENTINEL_PLAN.md`; base `71dd7197` |
| 2 Data & detection | `0101` applies on a clean PGlite DB; rules + engine unit-tested; typecheck clean | ✅ 10 + 53 tests; `npm run typecheck` exit 0 |
| 3 Backend services | Ingestion/assessment/alert/investigation APIs + RBAC + audit + jobs integration-tested against real migrations | ✅ 22 + 24 tests |
| 4 Frontend | SPA routes/pages build, nav link added, frontend unit test passes | ✅ 12 routes + 1 nav link; 28 tests; frontend `tsc` clean for every new file |
| 5 Verification | typecheck, typecheck:scripts, test, build, `git diff --check`, PHP lint, payment/customer regression | ✅ typecheck + typecheck:scripts exit 0; 240-test payment/customer regression green; all 5 Fraud Sentinel suites green (137 tests); `git diff --check` clean; no PHP touched; `npm run build` exit 0 across all five steps (§4 row 15). ⚠️ the whole-repository `npm test` was started but not completed — 1015 tests green across 29 files, 0 failures, stopped on a 2-vCPU sandbox where a full run projects to hours. Recorded as incomplete, never as passed (§4) |
| 6 Reporting | This report + draft PR into `main`, left in draft | ✅ this file; **draft PR [#124](https://github.com/subwindels-hash/CloudHost247/pull/124)** — `arena/178c36bc-cloudhost247` → `main`, state OPEN, `isDraft: true`, left in draft |

---

## 10. How to run it

```bash
cd cloudhost247-node
npm ci --no-audit --no-fund
npm run migrate          # applies 0101 (forward-only, additive)
npm run dev              # API + SPA
npm run worker           # background sweep; each job gated by its own schedule bucket
npm test                 # full suite

# Fraud Sentinel only
./node_modules/.bin/vitest run tests/unit/fraud-sentinel-rules.test.ts \
  tests/integration/fraud-sentinel-migration.test.ts \
  tests/integration/fraud-sentinel-detection.test.ts \
  tests/integration/fraud-sentinel-api.test.ts \
  frontend/tests/unit/fraud-sentinel-api.test.tsx
```

Admin UI entry point: **/admin/fraud-sentinel**, linked from `/admin`.

To disable the module without removing it, set `fraud_sentinel.enabled = false`: ingestion, assessment
and alerting stop, the API keeps serving what was already recorded, and nothing is deleted. The
reviewed rollback script (drop the 9 objects it created, delete its settings keys, delete the
`schema_migrations` row) is recorded in `docs/FRAUD_SENTINEL.md` and in the migration header, where the
migration test reads and executes it. It is never run by the application.
