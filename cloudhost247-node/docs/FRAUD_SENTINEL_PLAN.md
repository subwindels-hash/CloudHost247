# WINDELS FRAUD SENTINEL AI — Phase 1 Repository Inspection & Implementation Plan

Status: **Phase 1 complete** (inspection + plan). Implementation follows in Phases 2–6.

| Item | Value |
| --- | --- |
| Repository | `subwindels-hash/CloudHost247` |
| Default branch | `main` |
| Base commit (latest verified `main`) | `71dd71971f6cbdfc195ec293ef78076e42271d87` |
| Working branch | `arena/178c36bc-cloudhost247` (branched from `main` at the base commit above — `git rev-parse HEAD` == `git rev-parse origin/main` at start of work) |
| Requested branch name | `feature/fraud-sentinel-ai` — **not creatable in this session**, see "Branch constraint" below |
| GitHub token permissions | `admin: true, maintain: true, push: true, pull: true, triage: true` — no 403 encountered |

## Branch constraint (reported, not worked around)

The authorization asks for `feature/fraud-sentinel-ai`. This agent session is pinned to a single
tracked branch (`arena/178c36bc-cloudhost247`) and is explicitly forbidden from creating,
switching to, renaming, or pushing any other branch. That is a session-level restriction, **not**
a GitHub permission failure: `gh api repos/subwindels-hash/CloudHost247` returns
`permissions: {admin: true, push: true}`, and the earlier HTTP 403
(`Resource not accessible by integration`) does not reproduce with the current token.

Consequences, all inside the authorization boundaries:

* all work lands on `arena/178c36bc-cloudhost247`, which starts at exactly the latest verified
  `main` commit — so it *is* an isolated feature branch off verified `main`;
* `main` is never committed to, never merged into, and never deployed;
* the reviewable draft pull request is opened **from** `arena/178c36bc-cloudhost247`
  **into** `main` and left in draft;
* if a branch literally named `feature/fraud-sentinel-ai` is required, it can be created from this
  branch's head commit by a human with one command (`git branch feature/fraud-sentinel-ai
  arena/178c36bc-cloudhost247 && git push origin feature/fraud-sentinel-ai`). Nothing in this
  implementation depends on the branch name.

## 1. What the project actually is

`CloudHost247` is two things in one repository:

1. A legacy PHP marketing/policy surface at the repository root (`*.php`, `templates/`, `modules/`,
   `platform/`) — static-ish pages, no application database layer of its own. **Not touched.**
2. `cloudhost247-node/` — the real application: an independent Node.js 20+/TypeScript platform
   (Fastify 5 + PostgreSQL via `pg` + React 18/Vite SPA), designed for cPanel/Passenger
   deployment and incrementally replacing the WHMCS-dependent stack. **All work happens here.**

### Backend architecture (verified by reading the code)

| Concern | Existing implementation | Fraud Sentinel reuse |
| --- | --- | --- |
| HTTP | `src/app.ts` → `buildApp(env, {serveFrontend, pool})`; encapsulated plugin registration; `trustProxy: true` | Register one plugin: `registerFraudSentinelRoutes(instance, env, pool)` |
| Config | `src/config/env.ts` (zod-validated `Env`) | No new mandatory env var; module settings live in `platform_settings` |
| DB access | `src/db/pool.ts` (`getPool`), `src/db/types.ts` (`Queryable`), `src/db/transaction.ts` (`withTransaction`) | Same `Queryable` seam → routes/jobs are testable against PGlite |
| Migrations | `database/migrations/NNNN_*.sql`, forward-only, checksummed, each file wrapped in its own `BEGIN/COMMIT` by `database/migrate.ts`; production requires `--yes`; standing quarantine list for 0023/0024/0025/0041 | New file `0101_create_fraud_sentinel.sql` (next free version after `0100`) |
| AuthN | `src/lib/require-auth.ts` → `authenticate()`: JWT + revocation list + DB re-read of status + monotonic `auth_session_version` + delegated support-session validation | Reused unchanged |
| AuthZ | `src/lib/require-role.ts` → `requireRole(request, env, pool, roles)` re-reads `users.role` from the DB on every call. Roles: `customer`, `staff`, `admin`, `super_admin` (0001 + 0027 + 0053) | New `src/fraud-sentinel/permissions.ts` maps those canonical roles onto a named permission vocabulary — exactly the `src/revenue-guardian/permissions.ts` pattern; **no second RBAC engine** |
| Audit | `src/lib/audit.ts` → `recordAudit` / `auditRequest` into append-only `audit_logs` (0038) | Every privileged Fraud Sentinel action writes `audit_logs` |
| Validation | `zod` everywhere (`parseOrThrow` idiom in `src/revenue-guardian/controllers/routes.ts`) | Same idiom |
| SQL | 100 % parameterized; no string interpolation of user input anywhere in `src/db/*` | Same |
| Money | `src/lib/money.ts`; `numeric(12,2)` non-negative magnitudes, direction carried by column meaning | Same |
| Notifications | `src/services/notification-service.ts` → `createNotification()` writes `user_notifications` + `notification_outbox` in one idempotent statement (partial unique index on `(user_id,type,resource_type,resource_id)`) | Reviewer alerts ride this pipeline — no new mail engine |
| Background jobs | `src/worker/main.ts` loop + per-module schedulers; `src/revenue-guardian/jobs/{definitions,runner,scheduler}.ts` with a DB-enforced `run_key` unique lock and schedule-bucket keys | `src/fraud-sentinel/jobs/*` mirrors it; one new sweep interval in the existing worker |
| Settings | `platform_settings` (0040) + `src/db/ops-tables.ts` `getSetting/setSetting`; module wrapper pattern in `src/revenue-guardian/utils/settings.ts` | `src/fraud-sentinel/utils/settings.ts`, keys `fraud_sentinel.*` |
| AI layer | `src/ai-os/*` AI Control Plane: `ai_agents`, `ai_runs`, `ai_findings` (with `evidence jsonb`), `ai_incidents`, `ai_model_configs`; `src/ai-os/models/router.ts` fails **closed** (`CONFIGURATION_REQUIRED`) for any external engine that is not explicitly enabled+configured; the native `deterministic` engine is the default | Fraud Sentinel is deterministic-first. Its optional AI-assisted narrative layer reuses `resolveModelForAgent`-style fail-closed resolution and can never change a score or invent evidence |
| Tests | `vitest`; integration tests build a **real embedded PostgreSQL** (`@electric-sql/pglite`), apply the **real migration chain** (`migrateUp(new PgliteClient(db), {isProduction:false})`) and drive the **real app** via `app.inject()` | Same harness |

### Existing fraud-adjacent code (must not be duplicated)

`src/ai-os/agents/handlers.ts` already contains `fraudOrderAnomalyScan` (registered as task type
`fraud.order_anomaly_scan`, agent slug `fraud-guardian` in `src/ai-os/registry/agent-catalog.ts`).
It reads overdue invoices + failed payments through gated AI tools and emits `ai_findings` of type
`fraud.review` for human triage. `security.auth_anomaly_scan` does the same for auth clusters.

That is an *agent* surface: findings only, no scoring model, no alert lifecycle, no investigation
workflow, no rule versioning, no dashboard of its own. Fraud Sentinel is the *system of record* for
fraud risk: events, reproducible assessments, alerts with a lifecycle, investigations, false-positive
feedback, rule versioning and retention. The two are complementary and the integration is explicit
(§7 below) rather than a rewrite of the agent.

## 2. Telemetry that actually exists (detection honesty contract)

Rule §3 of the authorization: "Only implement detections supported by actual project data. Do not
invent telemetry." The full table inventory was enumerated from the 100 committed migrations. The
columns below are the **only** ones any rule may read.

| Real table | Real columns usable as evidence | Detections it supports |
| --- | --- | --- |
| `payments` (0020/0021/0097) | `invoice_id, user_id, provider, provider_reference, method, amount, currency, status ∈ {pending,successful,failed,cancelled,expired,refunded,partially_refunded}, failure_reason, initiated_at, completed_at` | repeated failures, failure bursts, duplicate attempts, unusual frequency/value, method/provider switching, refund indicators, amount-vs-invoice inconsistency |
| `invoices` (0018) | `order_id, user_id, currency, subtotal/discount/tax/total_amount, status ∈ {unpaid,paid,void,refunded,partially_refunded}, due_date, issued_at` | billing-pattern anomalies, refund/void indicators, currency mismatch vs order |
| `orders` (0016) + `order_items` (0017/0080) | `user_id, currency, subtotal/discount/tax/total_amount, status, payment_status, created_at`; items: `product_id, plan_id, product_name_snapshot, plan_name_snapshot, billing_period, quantity, unit_price_amount, line_total_amount` | order velocity, repeated identical purchases, high-value first order, unpaid-order accumulation, cancellation patterns |
| `billing_ledger` (0019, DB-level append-only) | `user_id, invoice_id, entry_type ∈ {charge,payment,refund,credit}, amount, currency, description, created_at` | refund/chargeback indicators, credit-issuance anomalies, ledger-vs-invoice inconsistency |
| `auth_audit_log` (0002 + extensions 0013/0022/0024/0025/0059/0060/0061/0085) | `user_id, event_type (46-value CHECK incl. login_success, login_failure, register, logout, token_refresh, profile_update, password_change, admin_status_change, admin_role_change, payment_initiated, manual_payment_confirmed/rejected, webhook_payment_succeeded/failed, email_verification_*, password_reset_*, mfa_*, passkey_*, username_changed, security_pin_*, account_recovery_*), ip_address, user_agent, metadata, created_at` | login patterns, failure clusters, IP spraying, new device/geo sessions, recovery abuse, MFA/passkey tampering, profile-change-after-new-login, shared-registration clusters, access-frequency anomalies, staff auth failures, permission changes |
| `audit_logs` (0038) | `actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata, created_at` | privileged-action bursts, sensitive-configuration changes, off-hours admin activity |
| `webhook_events` (0024) | `gateway, event_id, transmission_id, event_type, provider_reference, payment_id, status ∈ {processing,completed,failed,rejected,ignored}, payload_hash, lease_expires_at, received_at, processed_at` + `UNIQUE(gateway,event_id)` | rejected/failed webhook bursts, replay attempts (repeated `payload_hash`), provider-reference churn |
| `users` (0001/0012/0053/0085) | `role, status, created_at, customer_id, auth_session_version, password_changed_at` | account age at first high-value order, role/status of the actor, new-account risk |
| `customer_services` (0008) | `user_id, product_id, plan_id, label, status ∈ {active,suspended,cancelled,pending_migration}, created_at` | abnormal cancellation patterns, service-count anomalies |
| `subscriptions` (0037/0079) | `user_id, status, plan/pricing, current_period_*` | past-due/suspended correlation (advisory only) |
| `provisioning_jobs` (0041/0052) | `deployment_id, server_id, order_id, provider_id, operation, status, attempts, idempotency_key, created_at` | abnormal provisioning request volume/retries |
| `admin_support_sessions` (0053) | `admin_id, customer_uuid, reason, started_at, expires_at, ended_at, ended_reason, ip_address, user_agent` | delegated-access volume per admin, cross-customer access fan-out |
| `tool_abuse_events` (0067) | `user_id, ip_address, tool_slug, kind, detail, created_at` | service-usage abuse **where telemetry genuinely exists** |
| `security_number_attempts` / `security_pin_verification_challenges` / `auth_mfa_login_challenges` / `webauthn_*` / `account_recovery_requests` / `revoked_tokens` | ids, counters, timestamps | step-up verification failure bursts, recovery-request abuse |
| `visitor_intelligence` (0099) | `visitor_sessions`, `visitor_pageviews` — **no raw IP, no raw user-agent by design**, consent-gated, `enabled=false` by default | *not used* for customer attribution — it cannot be tied to an account honestly |
| `server_metrics` (0039) | `server_id, cpu_percent, load_*, memory_*, disk_*, network_*` | *not used in v1*: metrics are keyed by `server_id`, and `servers.customer_id` linkage is provider-populated rather than guaranteed — claiming "abnormal customer resource consumption" from it would be an unverified attribution. Recorded as a known limitation instead |

### Explicitly NOT implemented (no reliable telemetry — reported, not faked)

* **SMTP / mail-relay abuse per customer.** `email_trace_events` (0090) is a *postfix log ingest*
  surface keyed by host/domain, not a per-customer sending quota; there is no authenticated SMTP
  relay accounting in this platform. No rule is written against it.
* **Outbound proxy abuse.** `proxy-services.php` is a marketing page; there is no proxy data plane.
* **Generic API request-rate anomalies.** The platform rate-limits in memory (`@fastify/rate-limit`)
  and does **not** persist per-request API logs. Only *authenticated* API-relevant events that are
  actually recorded (`auth_audit_log`, `audit_logs`, `webhook_events`, `tool_abuse_events`,
  `whmcs_sso_rate_limits`) are used. A generic "abnormal API request pattern" rule is therefore
  scoped to those recorded event types and says so in its description.
* **Card testing via BIN/device fingerprint.** No card data is ever stored (by design and by this
  module's own redaction rule), and there is no device-fingerprint table. Payment-card abuse is
  inferred only from recorded `payments` rows (failure bursts, provider/method churn, duplicates).
* **Chargebacks as a distinct provider event.** No gateway in `src/payments/*` records a
  chargeback webhook type; refunds are the only recorded money-reversal. The rule is named
  `PAY_REFUND_REVERSAL` and its description states it covers refunds/credits/voids as *chargeback
  proxies*, never a confirmed chargeback.

## 3. Naming conventions adopted (project's own, not the spec's literal names)

The spec lists "potential entities" and instructs: "Use the project's established naming
conventions rather than blindly introducing these names."

| Spec's suggested name | Name used here | Why |
| --- | --- | --- |
| Fraud events | `fraud_sentinel_events` | Module-prefixed snake_case, matching `revenue_guardian_*`, `email_forensic_*`, `ai_*`, `visitor_*` |
| Fraud assessments | `fraud_sentinel_assessments` | — |
| Fraud alerts | `fraud_sentinel_alerts` | — |
| Fraud detection rules | `fraud_sentinel_rules` + `fraud_sentinel_rule_history` | Rule *versions* need an append-only audit table; `platform_settings` cannot express it |
| Investigation records | `fraud_sentinel_investigations` | — |
| Risk score history | `fraud_sentinel_risk_history` | — |
| False-positive reports | `fraud_sentinel_false_positives` | — |
| (new) run/lock ledger | `fraud_sentinel_runs` | Mirrors `revenue_guardian_automation_runs` — the DB-enforced `run_key` idempotency lock |
| Route base | `/api/admin/fraud-sentinel/*` | Mirrors `/api/admin/revenue-guardian/*` |
| Module dir | `src/fraud-sentinel/` with `controllers/ jobs/ repositories/ rules/ services/ types/ utils/` | Mirrors `src/revenue-guardian/` exactly |
| Permission vocabulary | `fraud_sentinel.view`, `.investigate`, `.assign`, `.rules`, `.run_scan`, `.settings`, `.export`, `.view_all_customers` | Mirrors `RG_PERMISSIONS` |
| Settings keys | `fraud_sentinel.*` in `platform_settings` | Mirrors `revenue_guardian.*` |
| Frontend | `frontend/src/pages/fraud-sentinel/*`, `frontend/src/components/fraud-sentinel/FSLayout.tsx`, `frontend/src/lib/fraud-sentinel-api.ts` | Mirrors the Revenue Guardian SPA module |
| Migration | `database/migrations/0101_create_fraud_sentinel.sql` | Next free version (`0100_ai_website_knowledge.sql` is the current head) |

**Tenant isolation:** this platform is single-tenant — no table in the 100 migrations carries a
`tenant_id`, and the existing modules that speak of "tenants" (`src/db/email-trace.ts`,
`src/db/email-forensics.ts`, `src/email-trace/access-control.ts`) mean *customer scoping*: an
explicit scope parameter, where an empty scope matches nothing. Fraud Sentinel adopts exactly that
contract: every read takes an explicit `FraudScope` and an empty scope is a closed scope. Tested.

## 4. Exact file paths to be created / modified

### Created — database

```
cloudhost247-node/database/migrations/0101_create_fraud_sentinel.sql
```

Additive only: 9 new tables + 43 indexes + 1 sequence + seeded default rules + seeded
`fraud_sentinel.*` settings. **Zero** `ALTER TABLE` against any pre-existing table, so no existing
workflow can regress and rollback is a self-contained drop (documented in `docs/FRAUD_SENTINEL.md`).

### Created — backend module

```
cloudhost247-node/src/fraud-sentinel/types/index.ts
cloudhost247-node/src/fraud-sentinel/permissions.ts
cloudhost247-node/src/fraud-sentinel/utils/settings.ts
cloudhost247-node/src/fraud-sentinel/utils/redaction.ts
cloudhost247-node/src/fraud-sentinel/rules/catalogue.ts      # rule metadata: code, version, family, weight, severity, params
cloudhost247-node/src/fraud-sentinel/rules/engine.ts         # pure, deterministic scoring (no I/O)
cloudhost247-node/src/fraud-sentinel/rules/transitions.ts    # alert lifecycle state machine
cloudhost247-node/src/fraud-sentinel/repositories/events-repo.ts
cloudhost247-node/src/fraud-sentinel/repositories/assessments-repo.ts
cloudhost247-node/src/fraud-sentinel/repositories/alerts-repo.ts
cloudhost247-node/src/fraud-sentinel/repositories/rules-repo.ts
cloudhost247-node/src/fraud-sentinel/repositories/investigations-repo.ts
cloudhost247-node/src/fraud-sentinel/repositories/signals-repo.ts   # the ONLY place real tables are read
cloudhost247-node/src/fraud-sentinel/services/event-ingestion-service.ts
cloudhost247-node/src/fraud-sentinel/services/assessment-service.ts
cloudhost247-node/src/fraud-sentinel/services/alert-service.ts
cloudhost247-node/src/fraud-sentinel/services/investigation-service.ts
cloudhost247-node/src/fraud-sentinel/services/rule-service.ts
cloudhost247-node/src/fraud-sentinel/services/ai-analysis-service.ts
cloudhost247-node/src/fraud-sentinel/services/retention-service.ts
cloudhost247-node/src/fraud-sentinel/jobs/definitions.ts
cloudhost247-node/src/fraud-sentinel/jobs/runner.ts
cloudhost247-node/src/fraud-sentinel/jobs/scheduler.ts
cloudhost247-node/src/fraud-sentinel/controllers/routes.ts
```

### Created — frontend

```
cloudhost247-node/frontend/src/lib/fraud-sentinel-api.ts
cloudhost247-node/frontend/src/components/fraud-sentinel/FSLayout.tsx
cloudhost247-node/frontend/src/components/fraud-sentinel/fs-widgets.tsx
cloudhost247-node/frontend/src/pages/fraud-sentinel/DashboardPage.tsx
cloudhost247-node/frontend/src/pages/fraud-sentinel/AlertsPage.tsx
cloudhost247-node/frontend/src/pages/fraud-sentinel/AlertDetailPage.tsx
cloudhost247-node/frontend/src/pages/fraud-sentinel/CustomerRiskPage.tsx
cloudhost247-node/frontend/src/pages/fraud-sentinel/TransactionsPage.tsx
cloudhost247-node/frontend/src/pages/fraud-sentinel/RulesPage.tsx
cloudhost247-node/frontend/src/pages/fraud-sentinel/InvestigationsPage.tsx
cloudhost247-node/frontend/src/pages/fraud-sentinel/OperationsPage.tsx   # runs, retention, module health
```

### Created — tests

```
cloudhost247-node/tests/unit/fraud-sentinel-rules.test.ts
cloudhost247-node/tests/integration/fraud-sentinel-migration.test.ts
cloudhost247-node/tests/integration/fraud-sentinel-detection.test.ts
cloudhost247-node/tests/integration/fraud-sentinel-api.test.ts
cloudhost247-node/frontend/tests/unit/fraud-sentinel-api.test.ts
```

### Created — documentation

```
cloudhost247-node/docs/FRAUD_SENTINEL.md                        # architecture, rule catalogue, weights, scoring, security, retention, rollback, limitations
cloudhost247-node/docs/FRAUD_SENTINEL_PLAN.md                   # this file
CloudHost247/FRAUD-SENTINEL-AI-IMPLEMENTATION-REPORT.md         # Phase 6 report: files, migrations, commands, actual results
```

### Modified — integration points (surgical, additive)

```
cloudhost247-node/src/app.ts                       # +1 import, +1 registerFraudSentinelRoutes(...) call
cloudhost247-node/src/worker/main.ts               # +1 interval constant, +1 schedule field, +1 sweep call
cloudhost247-node/frontend/src/App.tsx             # +lazy imports, +/admin/fraud-sentinel* routes (inside existing RequireRole guard)
cloudhost247-node/frontend/src/pages/AdminPage.tsx # +1 navigation Link
cloudhost247-node/frontend/src/navigation/*        # only if the admin nav is defined there (verified during Phase 4)
```

Nothing else is modified. No existing route, service, migration, table, or payment path is altered.

## 5. Detection design (deterministic, reproducible, non-double-counting)

* A **rule** is a pure function `(signals, params) → RuleOutcome | null`. No I/O, no clock reads
  inside the rule (the evaluation instant is an argument), so the same inputs always give the same
  output → unit-testable without a database.
* **Signals** are computed once per subject by `signals-repo.ts` from the real tables above, inside
  a bounded lookback window. Signals carry their own provenance (`{table, id, description}`) so
  evidence is always a pointer to a real row, never a narrative claim.
* **Families** group correlated rules (`payment_failures`, `payment_value`, `account_auth`,
  `account_recovery`, `order_velocity`, `admin_activity`, `webhook_integrity`, `service_abuse`).
  Each family's total contribution is **capped**, which is the mechanism that prevents
  double-counting: five rules that all describe the same failed-payment burst cannot stack to 100.
* `score = clamp(0, 100, Σ min(family_total, family_cap))`; `level` from configurable thresholds
  (`fraud_sentinel.risk_thresholds`, default medium 25 / high 50 / critical 75 — the same scale the
  platform already uses in Revenue Guardian, so two risk numbers never disagree about what "high" means).
* Every assessment stores: previous score/level, current score/level, triggered rules with the
  exact weight and rule version used, evidence references, confidence, data-quality indicators,
  recommendations, `rule_set_version` (hash of the enabled rule set + weights), and timestamp.
  → any score is reproducible from stored evidence + rule versions.
* **Confidence** is derived from evidence volume and source reliability (e.g. a rule firing on one
  row = low confidence; on 12 rows = high). **Data quality** flags genuine gaps (no prior login
  history to baseline against, GeoIP unavailable, window truncated by retention) rather than
  hiding them.
* The AI-assisted layer only ever *summarizes stored evidence* and *reorders recommended
  investigation steps*. It is off by default, requires an explicitly enabled engine in the existing
  `ai_model_configs`, fails closed to the deterministic narrative, and its output is stored in a
  separate column marked `ai_assisted` — never merged into `evidence`, never allowed to change
  `risk_score`, `risk_level`, or a rule outcome. No external provider or API key is mandatory.

## 6. Financial-safety contract (enforced in code, not just documented)

The module has **no** write path to `payments`, `invoices`, `billing_ledger`, `orders`,
`subscriptions`, `customer_services`, `users.status`, `users.role`, or any gateway. Verified by:

* `signals-repo.ts` and the repositories issue `SELECT` only against those tables;
* the module never imports `src/payments/*`, `src/services/payment-service.ts`,
  `src/services/billing-service.ts`, or `src/whmcs/*`;
* a test asserts the module's SQL contains no `INSERT/UPDATE/DELETE` targeting a financial table;
* every alert response carries `advisoryOnly: true` and the UI states that no enforcement is
  performed. Suspension, refunds, balance changes and entitlement changes remain exclusively in
  their existing, separately authorized workflows (WHMCS/admin billing) with human approval.

## 7. Integration with the existing AI Control Plane

Rather than duplicating `fraud-guardian`, Fraud Sentinel becomes the durable system of record the
agent's findings can point at, and exposes its own deterministic scan as a job. The agent surface is
left untouched (no behavioural regression to `tests/unit/ai-control-plane.test.ts`); the module
documents the relationship and its dashboard links an alert's underlying evidence, never an AI
conclusion, as the verified finding.

## 8. Phase gates

| Phase | Exit evidence |
| --- | --- |
| 1 Inspection | This document + base SHA recorded |
| 2 Data & detection | `0101` migration applies on a clean PGlite DB; rules + engine unit-tested; `npm run typecheck` clean |
| 3 Backend services | Ingestion/assessment/alert/investigation APIs + RBAC + audit + jobs integration-tested against real migrations |
| 4 Frontend | SPA routes/pages build (`npm run build:frontend`), nav link added, frontend unit test passes |
| 5 Verification | `npm run typecheck`, `npm run typecheck:scripts`, `npm test`, `npm run build`, `git diff --check`, PHP `php -l` on any touched PHP (none), regression of existing payment/customer suites — all actually executed and recorded |
| 6 Reporting | `FRAUD-SENTINEL-AI-IMPLEMENTATION-REPORT.md` + draft PR opened into `main`, left in draft |

Checks that **cannot** be run here are listed as skipped with the reason (no staging host, no live
PostgreSQL server, no payment-provider credentials, no browser/E2E infra) — never reported as passed.
