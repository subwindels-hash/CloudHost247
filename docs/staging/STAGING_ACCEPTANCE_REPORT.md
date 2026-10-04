# CloudHost247 — Staging verification & acceptance report

**Date:** 2026-10-04
**Exact tested commit:** `d721f313d64680ff1f8551ee88a5f6a1a28ca47c` (merge of PR #46, `main` HEAD at the time of testing)
**Authoritative remaining-work list:** `docs/UNFINISHED-MODULES.md` (per instruction; `docs/NODE_PLATFORM_STATUS.md` stale statements are **not** relied on — two of them are recorded as finding **D3** below)
**Production freeze:** **IN FORCE — nothing in this report deploys, authorizes, or unfreezes anything.**

## Status vocabulary (strict, as instructed)

| Status | Meaning |
|---|---|
| **PASS** | Actually verified by execution in this run. |
| **FAIL** | Tested and found defective. |
| **BLOCKED** | Could not be tested because of an external dependency (no staging host, no credentials, blocked network). |
| **NOT APPLICABLE** | Intentionally unsupported / documented limitation, not unfinished code. |

**No item in this report is marked PASS on the basis of source inspection alone, and no staging-dependent item is marked PASS or FAIL — they are BLOCKED, with the exact reason and the run-sheet needed to close them.**

---

## 0. What environment this was executed in

| Capability | State | Evidence |
|---|---|---|
| PHP runtime | **Available, real interpreter** — repo shim `scripts/php-wasm/php` → PHP **8.2.33** and **7.4.33** (WebAssembly builds of the real CLI) | `php -v` → `PHP 8.2.33 (cli)`, `PHP 7.4.33 (cli)` |
| PostgreSQL | **Real PostgreSQL 18.4**, throwaway cluster on `127.0.0.1:55432` (native x86_64 binaries via npm `@embedded-postgres/linux-x64`) | `postgres (PostgreSQL) 18.4`; cluster created with `initdb` |
| Browser | **Real Chromium 153.0.8010.0** driven by `playwright-core` (bundled via npm `@sparticuz/chromium`, libs extracted from `al2023.tar.br`) | `Chromium 153.0.8010.0`; page load + screenshots produced |
| Node / npm / Python | Node v22.22.3 · npm 10.9.8 · Python 3.11.2 | `node -v`, `python3 -V` |
| Network | **Allowlist-only.** npm registry and github.com reachable; **Maven Central, `api.stripe.com`, `api-m.sandbox.paypal.com`, `api.paystack.co`, Playwright CDN and the Debian mirrors are blocked** (`SSL_ERROR_SYSCALL` / `Connection failed`) | curl matrix in the run log |
| WHMCS / cPanel staging host | **Not available.** No staging host, database, credentials or provider test secrets exist in this environment | `find` for `.env*` → only `.env.example`; PR #47 records "no staging database exists and no provider test secrets are configured" |
| Docker daemon | **Not available** (`docker` absent) | toolchain probe |

> **Consequence.** Everything that requires the *real WHMCS/cPanel staging environment* is **BLOCKED** in this report, not passed. Everything that can be executed against a real PHP interpreter, a real PostgreSQL, and a real browser **was executed**, and those results are PASS/FAIL below.

---

## 1. Executive summary

| # | Area | Status |
|---|---|---|
| 1 | 15 staging-blocked modules — behavioural suites under real PHP 8.2.33 | **PASS** (all 18 suites, exit 0) |
| 1 | 15 staging-blocked modules — real WHMCS/cPanel staging verification | **BLOCKED** |
| 2 | Migrations 0023 / 0024 / 0025 — executed + objects verified on throwaway PostgreSQL 18.4 | **PASS** |
| 2 | Migrations 0023 / 0024 / 0025 — executed on **staging** | **BLOCKED** (no staging database provisioned) |
| 2 | Migration 0041 | **NOT EXECUTED** (verified absent) — as instructed |
| 3 | Webhook/payment pipeline — sandbox gateway, live end-to-end | **PASS** |
| 3 | Webhook/payment pipeline — Stripe/PayPal/Paystack **test-mode** APIs | **BLOCKED** (blocked network + no test credentials) |
| 4 | Marketing cron — source contract & CLI guards | **PASS** (verified by reading + lint + suite) |
| 4 | Marketing cron — scheduled and verified on staging | **BLOCKED** |
| 5 | Browser/UI acceptance — Node platform (113 desktop + 12 mobile routes, real Chromium) | **PASS** |
| 5 | Browser/UI acceptance — WHMCS admin/client area & the 15 module UIs | **BLOCKED** |
| 6 | Provider adapters (AWS, Contabo, DigitalOcean, Proxmox, Virtualizor, SolusVM, cPanel, Kubernetes, Docker) | **NOT APPLICABLE** — deliberate refusals, unchanged, still pinned |
| 7 | Release-candidate gate, PHP 8.2 leg | **PASS** (exit 0) |
| 7 | Release-candidate gate, PHP 7.4 leg | **PASS** (exit 0) |
| 7 | GitHub Actions CI | **BLOCKED** (account/billing; job never started) |
| 8 | This report | delivered |
| 9 | Production freeze | **RESPECTED** — see §9 |

**Defects found: 3 (no FAIL).** Two blocking verification/deployment findings (**D1**, **D2**) and one documentation defect (**D3**). Details in §10.

**Readiness for formal acceptance: NOT YET.** The source-level and sandbox-executable evidence is now complete and green — this is the first run in which the PHP half of the release gate (785 lint targets + 18 behavioural suites) has actually been executed. But formal acceptance requires the staging evidence that this environment cannot produce. §11 lists exactly what closes it.

---

## 2. Item 1 — the 15 source-complete but staging-blocked modules

Each module was exercised through its own committed behavioural suite, executed with **real PHP 8.2.33** (and the payments/static suites from Python). All 18 suites exit 0.

| Module | Test performed | Environment | Expected | Actual | Status | Evidence | Defect | Remediation | Final result |
|---|---|---|---|---|---|---|---|---|---|
| `RDP` | `tests/rdp/run.php` | PHP 8.2.33 | suite green | exit 0, no failures | **PASS (suite)** / **BLOCKED (staging)** | rc=0; "ok - malformed response rejected" | none | staging run-sheet §11 | behaviour verified; live provider verification pending |
| `cloudhost247_broker` | `tests/broker/run.php` | PHP 8.2.33 | suite green | exit 0 — "All broker tests passed." | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_integrations` | `tests/integrations/run.php` | PHP 8.2.33 | suite green | exit 0; "no rendered screen contains a credential" | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_modules` | `tests/modules/run.php` | PHP 8.2.33 | suite green | exit 0; **237 assertions, 0 failed** | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_builder` | `tests/builder/run.php` | PHP 8.2.33 | suite green | exit 0 | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_passkey` | `tests/passkey/run.php` | PHP 8.2.33 | suite green | exit 0; "A COSE key round-trips to a PEM OpenSSL accepts" | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_cart_recovery` | `tests/cart_recovery/run.php` | PHP 8.2.33 | suite green | exit 0; hook failures swallowed | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_smm` | `tests/smm/run.php` | PHP 8.2.33 | suite green | exit 0; **104 tests, 0 failures** | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_tools` | `tests/tools/run.php` | PHP 8.2.33 | suite green | exit 0; **85 tests, 0 failures** | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `phoneservices` | `tests/phoneservices/run.php` | PHP 8.2.33 | suite green | exit 0; **23/23 checks passed** | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `digitalproducts` | `tests/digitalproducts/test_static.py` | Python 3.11.2 | suite green | included in 428-test run, OK | **PASS / BLOCKED** | full Python suite: `Ran 428 tests … OK (skipped=2)` | none | §11 | as above |
| `customaffiliate` | `tests/customaffiliate/run.php` | PHP 8.2.33 | suite green | exit 0; **36/36 checks passed** | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_theme` | `tests/theme/run.php` | PHP 8.2.33 | suite green | exit 0; **60 assertions, 0 failed** | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_currency` | `tests/currency/run.php` | PHP 8.2.33 | suite green | exit 0; "ok - ecb cross rate" | **PASS / BLOCKED** | rc=0 | none | §11 | as above |
| `cloudhost247_ovh` | `tests/ovh/run.php` | PHP 8.2.33 | suite green | exit 0; "ok - no php diagnostics raised" | **PASS / BLOCKED** | rc=0 | none | §11 | as above |

Additionally green: `tests/marketing/run.php`, `tests/payments/run.php` (20 passed, 0 failed), `tests/cloudhost247_email/run.php` (59/59, mock transport), `tests/foundation/run.php`.

**What this does prove:** real module code paths execute correctly under a real PHP 8.2 interpreter (and 7.4 in the gate). **What this does not prove:** that the modules work inside a live WHMCS installation — admin/client workflow, permissions, MySQL behaviour, module activation, live provider API calls, and rendered UI all require the staging host and remain **BLOCKED**. No module is marked "complete" on the strength of its suite.

---

## 3. Item 2 — database migrations (0023, 0024, 0025)

Scope executed exactly as instructed: **0023, 0024, 0025 — staging only; 0041 NOT executed; nothing against production.**

| # | Module/feature | Test performed | Environment | Expected | Actual | Status | Evidence | Defect | Remediation | Final result |
|---|---|---|---|---|---|---|---|---|---|---|
| 2a | 0023/0024/0025 execution | `migrate up` with the authorized subset | **Throwaway PostgreSQL 18.4**, DB `ch247_mig` | 40 migrations applied, checksums clean | **40 applied, including 0023/0024/0025**; `migrate verify` → "OK: no checksum drift detected" | **PASS** | `Applied 40 migration(s): … 0023_…, 0024_…, 0025_…, … 0040_create_platform_settings.sql` | none | — | artifacts execute and verify |
| 2b | 0023 objects | live catalogue query | same | validation triggers present | `invoices_validate_invariants`, `payments_validate_invariants`, `billing_ledger_no_update`, `billing_ledger_no_delete`, `billing_ledger_validate_invariants` | **PASS** | `information_schema.triggers` query output | none | — | enforcement live |
| 2c | 0024 object | live catalogue query | same | `webhook_events` exists | present | **PASS** | `information_schema.tables` | none | — | table live |
| 2d | 0025 objects | live catalogue query | same | event types + widened column | 2 constraints; `orders.payment_status` = `character varying(20)` | **PASS** | `information_schema.columns` | none | — | migration live |
| 2e | 0041 | explicit absence check | same | **not executed** | `operating_systems`, `infrastructure_providers` **do not exist** | **PASS (respects restriction)** | counts = 0 | none | — | 0041 NOT executed |
| 2f | Execution **on staging** | — | staging host | run 0023/0024/0025 on staging, record DB + IDs | could not run: **no staging database exists** | **BLOCKED** | PR #47: "no staging database exists"; only `.env.example` present | none (external) | provision staging, then §11 | pending |

### Blocking consequence discovered (finding **D1**/**D2**)

Executing the authorized subset exposed a real, previously unrecorded dependency:

- `src/db/users.ts:createUser()` writes `users.customer_id`, which is added by **migration 0053** — empirically confirmed: the probe crashed with `column "customer_id" of relation "users" does not exist` on a database at 0040.
- The login route additionally requires **migration 0060** (`user_mfa_totp`): the platform returned HTTP 500 `relation "user_mfa_totp" does not exist` until 0060 was applied.
- Neither 0053 nor 0060 is in 0041's *declared* dependents, but both sit **above the 0040 boundary that the standing restriction caps a production database to**.

**Therefore: the platform as merged on `main` cannot operate against a database held at the authorized 0040 boundary — it cannot create a user or log one in.** This is the single most important finding of the run, and it is an owner decision: authorize 0041 (+ dependents) or accept that production deployment is impossible at the current boundary.

The same dependency is why the repository's own real-PostgreSQL financial probes (`npm run verify:financial` → 49/49 and `npm run verify:authorization` → 39/39) **cannot be run under the authorized scope** (finding **D2**). Their PGlite equivalents do run on every `npm test`.

---

## 4. Item 3 — webhook / payment pipeline (sandbox credentials only)

Phase 5D remains **frozen**; nothing here unfreezes it. Verified live, end-to-end, against the running platform and a real database, with a sandbox secret only.

| # | Test performed | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|
| 3a | Signed sandbox webhook, first delivery | accepted, processed | `200 {"received":true,"status":"processed"}` | **PASS** | curl against `POST /api/v1/webhooks/sandbox` |
| 3b | **Replay** of the identical signed delivery | idempotent, no double credit | `200 {"received":true,"status":"already_processed"}`; **1** `webhook_events` row | **PASS** | idempotency proven at delivery *and* at row level |
| 3c | Bad signature | rejected | `401 {"error":"UNAUTHORIZED","message":"Invalid or unverified webhook signature"}` | **PASS** | signature verified before processing |
| 3d | Missing signature | rejected | `401` same message | **PASS** | fail-closed |
| 3e | Database effects | payment successful, invoice paid, exactly one charge + one payment | `payments.status=successful`; `invoices.status=paid`; ledger = `charge 49.99` **+** `payment 49.99` (**one each**) | **PASS** | SQL read-back after the webhook |
| 3f | Audit logging | audit row recorded | `webhook_payment_succeeded` × 1 | **PASS** | `auth_audit_log` |
| 3g | Stripe / PayPal / Paystack **test-mode** APIs | live signature verification against each provider's sandbox | could not run: **provider APIs unreachable from this environment** and **no test credentials exist** | **BLOCKED** | `SSL_ERROR_SYSCALL` to `api.stripe.com`, `api-m.sandbox.paypal.com`, `api.paystack.co`; only `.env.example` in the tree |

**Interpretation.** The pipeline's own cryptography, idempotency, state transitions, ledger discipline and audit logging are verified by execution. What remains unverified — and cannot be verified here — is the *provider-specific* signature and retry behaviour of the three live gateways, which needs staging plus test-mode credentials.

---

## 5. Item 4 — marketing cron

| # | Test performed | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|
| 4a | CLI guard + option contract, by execution and static read | CLI-only; `--dry-run`, `--campaign=N`; documented exit codes | `if (PHP_SAPI !== 'cli') { http_response_code(403); exit('CLI only'); }`; options parsed; exit codes 0/1 documented | **PASS** | `crons/cloudhost247_marketing.php`; linted + included in the gate; `tests/marketing/run.php` green |
| 4b | Scheduled on staging with real execution evidence | crontab entry + run log | could not run: **no staging host** | **BLOCKED** | — |

**Exact schedule to apply on staging** (from the module's own header): every minute, or the shortest interval the host offers —

```
* * * * * /usr/bin/php -q /path/to/whmcs/crons/cloudhost247_marketing.php >> /var/log/cloudhost247-marketing.log 2>&1
```

First-run verification should use `--dry-run` (resolves, freezes and queues, but never talks to the relay).

---

## 6. Item 5 — browser / UI acceptance

Executed with **real Chromium 153** against the platform (built SPA served by the compiled Fastify server, backed by real PostgreSQL 18.4).

| # | Test performed | Expected | Actual | Status |
|---|---|---|---|---|
| 5a | **UI login through the form** (customer account) | redirect out of `/login`, token stored | redirected to **`/dashboard`**; `ch247_token` present in storage; screenshot captured | **PASS** |
| 5b | 113 static routes, desktop 1440×900 | no navigation errors, no overflow | **0 navigation errors, 0 horizontal overflow** | **PASS** |
| 5c | 12 routes, mobile 390×844 | no overflow, no nav errors | **0 navigation errors, 0 horizontal overflow** | **PASS** |
| 5d | Dead buttons / missing alt / placeholder text | none | `deadButtons: 0`, `imgWithoutAlt: 0`, `loremIpsum: false` | **PASS** |
| 5e | Branding / content quality on the rendered homepage | CloudHost247 branding, no legacy brand, no placeholder content | `hasCloudHost247: true`, `whmcs: 0`, `title: "CloudHost247"`, `navLinks: 18`, `lorem: false`, `placeholder: 0`, `imgsNoAlt: 0`, `overflow: false` (measured after React mount; an earlier pre-mount read is superseded by this one) | **PASS** |
| 5f | 33 routes returned API 500s | — | **every one traced to `relation "…" does not exist`** for tables created by migrations outside the authorized subset (`cloudflare_services`, `cloudflare_plan_mappings`, `ai_support_conversations`, `support_agent_presence`, `revenue_guardian_assignments`, …) — an artifact of the scoped schema, **not** a UI defect | **NOT A DEFECT (classified)** |
| 5g | 3 "failed to fetch dynamically imported module" console errors | chunks load | **did not reproduce in isolation**; all three chunks exist on disk (132 assets emitted) and return **HTTP 200** — sweep-load artifact (rate limiter also returned 121× 429 under the rapid sweep, which is the limiter working as designed) | **NOT A DEFECT (classified)** |
| 5h | WHMCS admin dashboard, client area, module installer, page builder, and the 15 module UIs | real staging browser acceptance | could not run: **no WHMCS/PHP/MySQL staging environment** | **BLOCKED** |

Screenshots retained: `login-form-1440.png`, `after-login-1440.png`, `hosting-cpanel-1440.png`, plus per-route captures and `sweep.json`.

---

## 7. Item 7 — release-candidate gate and platform limitations

| # | Test performed | Result | Status |
|---|---|---|---|
| 7a | `bash scripts/release-candidate-check.sh` with the repo's `php-wasm` shim, **PHP 8.2 leg** | **exit 0** — 785 computed lint targets clean, 18 PHP behavioural suites green, Node agent suite green, Python suites green, hash-locked baseline intact ("Release-candidate source verification passed") | **PASS** |
| 7b | same, **PHP 7.4 leg** | **exit 0** — 785 lint targets clean (PHP **7.4.33**), all 18 PHP behavioural suites green (`60 assertions, 0 failed`; `104 tests, 0 failures`; `85 tests, 0 failures`; `237 assertions, 0 failed`; `All broker tests passed.`; `23/23` phoneservices; `36/36` customaffiliate; `59/59` email), agent + Python suites green, "Release-candidate source verification passed" | **PASS** |
| 7c | GitHub Actions | **BLOCKED — infrastructure.** Run `37176974172` ("Independent foundation", job *Release candidate (PHP 7.4)*) started 04:25:55Z and failed 04:25:57Z with **0 steps executed**; further runs on 2026-10-04 failed in 3–4 s. No CI signal exists on any commit. | **BLOCKED** |
| 7d | Sandbox-only limitations, recorded honestly | `php -l` **was** executed here on **both** matrix versions (real PHP 8.2.33 and 7.4.33 interpreters via the repo's `scripts/php-wasm` shim) — this materially corrects the earlier standing note that "`php -l` was never executed (no PHP in the sandbox)". Still **not** performed: **real Docker daemon testing**, **live provider staging**, **WHMCS/cPanel staging**, and browser/visual testing was done **only** against the Node platform, **not** the WHMCS UI | recorded |

---

## 8. Item 6 — provider adapters (explicitly NOT unfinished code)

Per instruction, deliberately unsupported provider operations were **not** reclassified and no safety gate was weakened. All refusals remain fail-closed and pinned:

| Adapter | Refusal | Status |
|---|---|---|
| `aws` | `rescue` (no native API); reinstall/root-volume restore gated behind `AWS_ALLOW_ROOT_VOLUME_REPLACEMENT=true` | **NOT APPLICABLE** |
| `contabo` | `resize`, `console`, `metrics` (verified against Contabo's documented API) | **NOT APPLICABLE** |
| `digitalocean` | `console` (Control-Panel-only feature; no API v2 operation) | **NOT APPLICABLE** |
| `proxmox` / `virtualizor` | `rescue` (no API endpoint / enduser-API-only) | **NOT APPLICABLE** |
| `solusvm` | `snapshot` | **NOT APPLICABLE** |
| `cpanel` adapter | `restartApplication`, `applicationLogs` | **NOT APPLICABLE** |
| `kubernetes` adapter | backup/restore (`K8S_BACKUP_REQUIRES_VELERO`), hosting provisioning | **NOT APPLICABLE** |
| `docker` adapter | hosting operations (`HOSTING_REQUIRES_CPANEL_ADAPTER`) | **NOT APPLICABLE** |

Pinned by `tests/unit/adapter-capability-matrix.test.ts`, `provider-capability-truth.test.ts`, `provider-console-metrics-truth.test.ts`.

---

## 9. Item 9 — production freeze compliance

| Rule | Compliance |
|---|---|
| No deployment to production | **Respected** — nothing deployed |
| No merge into the production release path without acceptance | **Respected** — this report ships on the session branch only |
| No staging migrations against production | **Respected** — migrations ran only against throwaway local databases |
| No production payment credentials | **Respected** — only a local sandbox webhook secret was used |
| No production database alteration | **Respected** — no production database was contacted |
| No removal of safety gates | **Respected** — quarantine logic, capability refusal tests and fail-closed paths untouched |
| No deletion of the hash-locked vendor baseline | **Respected** — the gate's 2,269-path `sha256sum --check --strict` baseline passed in leg 8.2 |
| No "production-ready" claim from source inspection | **Respected** — this report claims no such thing |

---

## 10. Defects and findings

| ID | Severity | Finding | Evidence | Remediation |
|---|---|---|---|---|
| **D1** | **Blocking (deployment)** | The platform on `main` requires migrations **≥0053** (`users.customer_id`) and **≥0060** (`user_mfa_totp`) to create a user and log one in, but the standing restriction caps databases at **0040** (0041 quarantined with ten dependents). The merged code therefore **cannot operate against a database at the authorized boundary**. | `users.customer_id` error at 0040; `relation "user_mfa_totp" does not exist` → HTTP 500 on login; both resolved by applying 0053/0060 to the throwaway database | Owner decision: authorize 0041 (+ its declared dependents) for staging; production cannot run current `main` until then |
| **D2** | **Blocking (verification)** | The real-PostgreSQL financial probes (`verify:financial` 49/49, `verify:authorization` 39/39) **cannot run under the authorized migration scope** — their fixture calls `createUser()`, which needs 0053. | Probe crash: `PROBE CRASHED: column "customer_id" of relation "users" does not exist` | Same decision as D1; or re-scope the probe fixture — a code change, explicitly out of scope for this phase |
| **D3** | Low (documentation) | `docs/NODE_PLATFORM_STATUS.md` carries stale statements that the authoritative inventory already corrected: it says PR #12 "Remains **OPEN and UNMERGED**" in four places (line 41, 687, 821, 861) though GitHub reports `state: CLOSED`, `mergedAt: null`; and line 1025 says "the incomplete native AWS and Contabo adapters cannot be activated", which `docs/UNFINISHED-MODULES.md` §A4/§A5 records as stale. | `gh pr view 12` → `{"state":"CLOSED","mergedAt":null}`; corrections already drafted in the closed PR #47 | Apply the two-line correction (intentionally **not** made here, to avoid touching a file the release-gate tests parse while the gate was executing) |
| **D4** | Informational (data) | The dev catalogue fixture (`database/seed/dev-catalog-seed.sql`, dev/test-only by its own header) does not contain the product slugs the hosting pages request, so `/hosting/cpanel`, `/hosting/vps`, `/hosting/dedicated` render their content with **no plan list** and no user-facing "no plans" message. Not a code defect — a real catalogue supplies the slugs. | `404 /api/v1/catalog/products/cpanel-hosting/plans`; page renders 1,246 chars of content, 0 overflow, no error surfaced | Optional UX improvement: surface an explicit empty-state message; no action required for acceptance |

**No FAIL statuses were recorded in this run: nothing that could be tested was found defective.**

---

## 11. What remains BLOCKED and exactly how to close it

All of the following require the real staging environment; none can be produced from this sandbox.

1. **Provision staging** (WHMCS 8.2.x, PHP 8.2.x with the extensions the preflight requires, MySQL, the 15 modules installed).
2. **Preflight evidence** — run on the staging host:
   - `php scripts/staging-preflight.php <whmcs-root> <out.json>` with `CH247_BUILD_COMMIT=d721f31…`
   - `php scripts/staging-baseline-evidence.php`, `php scripts/staging-financial-snapshot.php`, `php scripts/staging-backup-verify.php`
3. **Migrations on staging** — execute **0023, 0024, 0025** and record host, database, migration IDs, result and verification. **0041 stays unexecuted unless separately authorized** (see D1).
4. **Modules** — run each `tests/<module>/run.php` on the staging host and exercise the real admin/client workflows, permissions and provider APIs.
5. **Payment pipeline** — configure **test-mode** Stripe/PayPal/Paystack credentials on staging and verify signatures, processing, idempotency, retries and audit logging (live credentials are never permitted).
6. **Marketing cron** — install the crontab line from §5 and capture a successful run.
7. **Browser acceptance** — repeat the sweep against the WHMCS admin/client UI (the Node-platform sweep is already green; the harness used here can be pointed at staging).
8. **Generate the acceptance artifact** — `python3 scripts/generate-staging-report.py --preflight … --backup … --baseline … --financial … --migration … --automated … --runtime … --commit <sha> …`. The repo's own generator refuses to declare acceptance without real runtime evidence — by design.
9. **CI** — clear the GitHub account/billing block so commits carry a CI signal.

---

## 12. Verdict

- **Sandbox-executable verification: complete and green.** Release gate **both** matrix legs exit 0 — PHP 8.2.33 and **PHP 7.4.33**, 785 lint targets and all 18 behavioural suites each, agent and Python suites green, hash-locked baseline intact; this is the first execution of the PHP half of the gate in this repository's recorded history; all 15 modules' behavioural suites pass under real PHP; migrations 0023/0024/0025 execute and verify on real PostgreSQL with their objects confirmed live; the sandbox webhook pipeline is verified end-to-end including idempotency and ledger discipline; and the Node platform passes browser acceptance on 113 desktop + 12 mobile routes with zero overflow and a working UI login.
- **Staging verification: BLOCKED, not skipped.** No staging host, database, credentials or provider test secrets exist in this environment; each blocked item is listed in §11 with its closing action.
- **Two blocking findings (D1, D2) must be resolved by an owner decision** before staging work can complete, because the authorized migration boundary (0040) is incompatible with the merged application code and with the repository's own financial probes.
- **CloudHost247 is not yet ready for formal acceptance** — it is ready for the **staging execution phase**, with all sandbox-verifiable evidence green and the staging run-sheet defined.
