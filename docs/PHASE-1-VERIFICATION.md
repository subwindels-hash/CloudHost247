# Phase 1 — Independent Verification Log

**Date:** 2026-11-07 · **Branch:** `arena/1b329121-cloudhost247` · **Working tree:** no feature code changed during Phase 1
**Purpose:** record exactly what was run, what passed, what failed, and what could not be verified. This is the evidence file referenced by column `evidence` in `docs/feature-parity-register.csv`.

---

## 1. Environment

| Item | Value |
| --- | --- |
| Node / npm | `v22.22.3` / `10.9.8` |
| Python | `3.11.2` |
| Packages | `npm ci --no-audit --no-fund` → 386 packages in `cloudhost247-node/` |
| Native PHP | **Absent** |
| PHP WASM shim | `scripts/php-wasm/php -v` → **PHP 8.2.33** (`@php-wasm/node` 3.1.56) |
| Native WHMCS core | **Absent** (licensed dependency) |
| zod | **4.6.7** |
| `.env` | **Absent**; `.env.example` only. Normal `npm start` requires `DATABASE_URL` + `JWT_SECRET` (≥32 chars) and a reachable Postgres, and `dist/src/server.js` (from `npm run build:server`) |
| Active preview | PGlite-backed `scripts/tools-preview-server.ts` on port 3000 (`website-72f1a755`), seeded with 9 explicitly demo-labelled plans in memory |

## 2. Commands run and results

### 2.1 Generators and static audits — all passed

| Command | Result |
| --- | --- |
| `node scripts/site/generate.mjs --check` | `✓ registry valid — 221 links (210 app, 217 PHP)` |
| `node scripts/site/generate.mjs` (full) | 7 mega menus, 8 footer columns, 221 links; 55 marketing pages, 129 sections, 174 FAQs, 13 published documents (216 KB); 43 PHP product pages; 23 PHP exclusions / 89 public PHP paths; `robots.txt` + `modules/addons/cloudhost247_theme/resources/site.json` refreshed. **`git status --short` identical before and after** → generator is idempotent |
| `node scripts/site/check-links.mjs` | 2,219 surfaces (986 internal, 1,011 PHP, 5 external, 17 anchors, 722 excluded vendor/dev hrefs); **0 broken, placeholder or dangling links**; 5 external-URL notes |
| `python3 scripts/branding-audit.py` | 0 retired-brand matches |
| `python3 scripts/audit-navigation-inventory.py` | Route owners `cloudhost247-theme 67`, `internal 17`, `tools-front-controller 265`, `whmcs-core 7`; orphaned pages / menu links without pages / pages without nav / unregistered public pages / dangling redirects / duplicate canonicals all **0**; wrote `docs/website-rebuild/page-inventory.{json,csv}` |
| `python3 scripts/validate-migrations.py` | 11 PASS |
| `python3 scripts/audit/build-feature-register.py` | 211 features, 12 columns, no duplicate ids |

### 2.2 PHP syntax — passed (syntax only)

- `bash scripts/php-lint-targets.sh | wc -l` → **838** current targets.
- Two parallel sweeps: `bash scripts/php-lint-targets.sh | xargs -r -P 8 -n1 scripts/php-wasm/php -l` → **0 `Parse error`, 0 `Fatal error`** over all 838 targets.
- **Not run:** PHP 7.4 WASM leg (`PHP_WASM_VERSION=7.4`), the `tests/*/run.php` behavioural suites, and a native PHP 7.4/8.2 matrix. `scripts/php-wasm/README.md` notes `ext-intl` is absent and DNS/SSRF-dependent suites can fail environmentally. **PHP syntax clean ≠ WHMCS runtime verified.**

### 2.3 TypeScript, lint, catalogue, build — all passed

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npx tsc -p frontend/tsconfig.json --noEmit` | clean |
| `npm run tools:catalog:check` | 75 tool entries / projection verified |
| `npm run build:frontend` | clean; `public/index.html` still links `/assets/index-C2R07zQg.js` + `/assets/index-LRaSr-pl.css` (hashes unchanged → no frontend source drift in Phase 1) |

### 2.4 Automated tests

| Run | Result |
| --- | --- |
| 49 selected frontend / integration / unit Vitest files | **875 tests: 873 passed, 2 failed** (613.41s) |
| `npx vitest run tests/integration/server-infrastructure.test.ts --reporter=dot` | **8 passed, 2 failed** (9.02s) — both failures reproduced |
| Full 166-file `npx vitest run --reporter=dot` | **Timed out at 900,476 ms and was killed** — full-suite result **unknown**; do not claim it passed |
| PHP behavioural suites | Not run (see §2.2) |
| Browser / screenshot / visual matrix | **Not run** — no Chromium binary; `timeout 150 npx playwright install chromium` failed with TLS `ECONNRESET` |

### 2.5 Live preview spot checks (previous session, still serving)

`/` GET 200 (HEAD-only 404 is expected), `/pricing`, `/domains`, `/hosting`, `/tools`, `/ready {"status":"ok","checks":{"database":"ok"}}`, `/api/tools/navigation`, `/api/tools/catalog` (75 tools / 9 categories), `/api/v1/public/status` (operational), `/api/v1/catalog/products` (3 **demo** products). CSS/JS served with correct `text/css` / `application/javascript`; CSP permits the preview origin. Demo accounts `demo@cloudhost247.test / demo-tools-247` (customer) and `admin@cloudhost247.test / admin-tools-247` (super_admin). **All catalogue rows in the preview are in-memory PGlite demo seeds and must never be presented as production prices.**

---

## 3. Failures investigated — root cause found

> **RESOLVED 2026-11-07 (P0):** both failures were fixed by the shared identifier contract described in §3.1. `tests/integration/server-infrastructure.test.ts` now passes 10/10; 12 route-touching files / 71 tests pass. This section is retained as the original diagnostic record. See `docs/PHASE-DELIVERY-REPORT.md`.

### 3.1 `tests/integration/server-infrastructure.test.ts`

| Line | Assertion | Observed |
| --- | --- | --- |
| 71 | `expect(response.statusCode).toBe(201)` (unpaid server order) | `400` |
| 172 | `expect(....statusCode).toBe(404)` (server owned by another customer) | `400` |

A temporary diagnostic copy of the test (created, run, then deleted — no file left behind) printed the response bodies:

```
DIAG-ORDER 400 {"error":"VALIDATION_ERROR","message":"Invalid UUID"}
DIAG-GET   404 {"error":"NOT_FOUND","message":"No server was found with that id"}
```

The GET on the other customer's server correctly returns 404; the 400 in the second test comes from the **reinstall POST** that follows it, which also submits a seeded OS id.

**Root cause:** zod 4.6.7 enforces the UUID version/variant nibbles. The seeded OS-catalog ids in `database/migrations/0041_create_os_catalog_and_server_provisioning.sql` (and `0048`/`0051`) all have the form `10000000-0000-0000-0000-00000000000N` / `20000000-...` (version nibble `0`, variant nibble `0`). Confirmed directly:

```
node -e "const {z}=require('zod'); console.log(require('zod/package.json').version,
  z.string().uuid().safeParse('20000000-0000-0000-0000-000000000006').success,
  z.string().uuid().safeParse('20000000-0000-4000-8000-000000000006').success)"
→ 4.6.7 false true
```

`src/routes/servers.ts:88` uses `operatingSystemVersionId: z.string().uuid()` and line 97 uses the same for reinstall, so **every request referencing a seeded OS image is rejected**. This is a genuine customer-facing defect, not merely a test-fixture issue. Eleven integration test files reference `20000000-0000-0000` ids: `infrastructure-admin-operations`, `os-image-revalidation`, `provisioning-health-and-images`, `public-os-availability`, `server-console`, `server-infrastructure`, `server-reconciliation`, `server-reinstall-acceptance`, `server-rescue`, `server-resize-order`, `server-termination`.

**No fix was applied in Phase 1** (read-only audit). Fix options and the required regression tests are in `docs/IMPLEMENTATION-PLAN.md` §P0. Note the governance interaction: migration `0041` is quarantined for production, so the OS catalog cannot yet exist in a production DB either.

### 3.2 Historical failures (not re-opened)

`PHASE_5_CHECKPOINT_REPORT.md` documents a 5C double-credit concurrency defect; `docs/NODE_PLATFORM_STATUS.md` records later 5A–5G acceptance. A shallow grep for `status='pending'` / `FOR UPDATE` was **insufficient** to establish that the fix is present in current code. A deeper code/test review is a Phase 7 (billing) prerequisite, not a Phase 1 conclusion.

---

## 4. Blockers and known limitations

| Blocker | Consequence |
| --- | --- |
| No provider credentials (registrar, infrastructure, DNS/CDN, CA, email, LLM, payment) | Domain registration/transfer, live VPS provisioning, SSL issuance, CDN/DDoS, mailbox creation, external AI generation, and gateway flows are **Blocked by external provider**. All adapters were inspected to be configuration-gated and fail closed rather than simulating success. |
| Native PHP / licensed WHMCS core / cPanel host absent | PHP/WHMCS runtime parity, WHMCS template rendering, and the 18-point `docs/CPANEL_DEPLOYMENT.md` checklist cannot be verified. PHP WASM syntax lint is the only PHP signal here. |
| Quarantined migrations `0023`/`0024`/`0025`/`0041`; PR #12 open; webhooks frozen | Production DB cannot advance past `0040`; no financial setting changed; no gateway activated. |
| No browser binary | No screenshots, no mobile/tablet/desktop visual verification, no rendered-page inspection. `docs/ACCEPTANCE-CRITERIA.md` marks C4 PARTIAL with 520 stale cases. |
| Full Vitest suite timed out at 900 s | Full-suite status unknown. Only the 49-file targeted result (873/875) is asserted here. |
| Benchmark coverage incomplete | Official pricing/web-hosting chunks 1–3, individual support articles and Hostinger API docs were not fetched. The register is a strong baseline, not a claim of exhaustive Hostinger coverage. |
| Two complete Node stacks | `cloudhost247-node/` and `platform/` both exist and `platform/README.md` claims to supersede the former. No feature work may be duplicated until the architecture decision is made. |
| Preview catalogue is demo-only | Production/no-seed catalogue is empty. UI must retain truthful no-plan / loading / error / 404 / no-price states. |

## 5. What was **not** done in Phase 1

- No feature implementation, no DB migration, no API change, no frontend change, no payment/gateway/financial setting change.
- No production deployment (explicit approval required).
- No screenshot or visual evidence.
- No claim that any feature is complete because a page, route, menu item or button exists.
- No activation of any external provider.
