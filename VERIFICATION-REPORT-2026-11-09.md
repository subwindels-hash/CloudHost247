# CloudHost247 — Repository-Wide Verification & Completion Report (2026-11-09)

Branch: `arena/fe9b2088-cloudhost247`
Baseline: `012106ded6a033f1ae7488394323b5f9fcb4907a` (Merge PR #109)
Working tree at start: clean. Toolchain: Node 22.22.3 / npm 10.9.8 / Python 3.11.2;
PHP executed via the repository's real PHP-to-WASM shim (`scripts/php-wasm/php`,
PHP 8.2.33 and 7.4 legs) — no native PHP binary exists on this host.

This report records a file-level and module-level verification of the whole
repository, the defects found, the repairs made, and the checks that remain
blocked by missing infrastructure or credentials. Every number below comes from
a command that was actually executed; each is reproducible from the listed
command.

---

## 1. Repository inventory (Phase 1)

| Measure | Count |
|---|---|
| Tracked files (`git ls-files`) | 9,176 |
| PHP source files | 1,746 |
| TypeScript (.ts) | 866 |
| TSX components (.tsx) | 261 |
| JavaScript (.js/.mjs) | 637 + 20 |
| Smarty templates (.tpl) | 765 |
| CSS/SCSS/LESS | 182 |
| SQL migrations (node platform) | 108 files / 92 applied schema migrations |
| Python (tests + tooling) | 67 |
| Docs (.md) | 236 |
| Images/media (png/svg/webp/avif/jpg/gif) | ~4,200 |
| YAML/YML configs | 134 |

Major areas:

| Area | Files | Role |
|---|---|---|
| `cloudhost247-node/` | 4,422 | Independent Node.js/TypeScript platform (Fastify + React SPA) |
| `modules/` | 2,827 | WHMCS addon / gateway / provisioning modules |
| `templates/` | 2,014 | WHMCS themes (cloudhost247, cloudhost247_legacy) + 3 order forms |
| `assets/`, `docs/` | 845 / 507 | Static site assets / documentation |
| `platform/`, `tests/`, `scripts/`, `shared/` | 434 / 109+ / 42 / 39 | Platform docs & fixtures, PHP+Python test suites, release tooling, shared content registry |
| root `*.php` | 84 | WHMCS client-area pages (legacy + policy pages) |
| `crons/`, `lang/`, `tools/`, `server-agent/` | 11 / 27 / 14 / 14 | Automation, 27 language overrides, tools front controller, on-server agent |

## 2. Module inventory (Phase 1/3)

### Node platform (`cloudhost247-node/`)
- 35 src module directories (ai, ai-os, builders, commerce, config, control-panels,
  currency, db, deployments, dns, domain-brokerage, domain-services, dto, email-trace,
  experts, inbox, infrastructure, integrations, lib, logo-maker, marketing,
  marketing-services, marketplace, navigation, payments, plugins, revenue-guardian,
  routes, services, social, store, tiktok, tools, whmcs, worker)
- 62 API route files; 84 frontend page components; 92 database migrations
- Worker (`src/worker`) with one-shot and persistent modes

### WHMCS modules
- **23 addon modules**: cloudhost247_broker, cloudhost247_builder,
  cloudhost247_cart_recovery, cloudhost247_core, cloudhost247_currency,
  cloudhost247_domain_lookup, cloudhost247_integrations, cloudhost247_marketing,
  cloudhost247_modules, cloudhost247_ovh, cloudhost247_passkey,
  cloudhost247_payments, cloudhost247_smm, cloudhost247_theme, cloudhost247_tools,
  customaffiliate, digitalproducts, dnschecker, phoneservices, smmaddon,
  soyoustart, tools_center, xtreme_currency_rates
- **1 gateway family**: Blockonomics (gateway module, library, callback endpoint)
- **14 provisioning modules**: RDP, Smtphosting, cloudhost247_email,
  cloudhost247_email_hosting, cloudhost247_lteproxy, cloudhost247_ovh,
  cloudhost247_smm, phoneservices_esim, phoneservices_numbers, phoneservices_sms,
  phoneservices_voip, smmprovisioning, soyoustart, soyoustart_vps
- **Themes**: cloudhost247 (twenty-one child), cloudhost247_legacy (~130 tpl pages);
  **order forms**: cloudhost247, cloudhost247_legacy, ovh_cart
- **Server agent** (`server-agent/`): dependency-free on-server auth/protocol agent

## 3. Findings and repairs (Phases 2–4)

### F-1 — DISCONNECTED: dead documentation link on the Google Ads admin page
- **Found by:** `frontend/tests/unit/link-integrity.test.ts` (the only failure in
  the 2,901-test vitest baseline run).
- **Root cause:** `AdminGoogleAdsPage.tsx` linked `/docs/integrations/GOOGLE-ADS.md`,
  a path the SPA neither routes nor serves; the document existed only in repo `docs/`.
- **Fix (no shortcut):** published the existing document through the project's real
  documentation pipeline — registered `integrations/GOOGLE-ADS.md` in
  `scripts/site/generate.mjs` `PUBLISHED_DOCS`, regenerated
  `docs.generated.json` + `frontend/public/docs/integrations-google-ads.md`, and
  pointed the page at the declared `/docs/integrations-google-ads` SPA route.
- **Verified:** link-integrity 4/4 pass; marketing-pages 341/341 pass; full suite
  re-run passes (see §5).

### F-2 — STALE: canonical page inventory out of sync with the content registry
- **Found by:** `scripts/release-candidate-check.sh` (regenerate-and-diff gate;
  commit `cca9e45`).
- **Root cause:** a previous registry edit changed the what-is-my-ip SEO description
  without re-projecting `docs/website-rebuild/page-inventory.{json,csv}`.
- **Fix:** regenerated the inventory artefacts; diff confirmed the change is exactly
  the SEO description row (both surfaces), nothing else.

### F-3 — STALE/BROKEN GATE: vendor integrity baseline drift
- **Found by:** gate step `sha256sum --check --strict` +
  `tests.security.test_release_gate_static.IntegrityBaselineTests`
  (`templates/cloudhost247_legacy/footer.tpl`,
  `templates/cloudhost247_legacy/cloudhost247_legacy_includes/seo-trackers.tpl` edited
  after the 2026-11-08 manifest re-cut; commit `bae36080`).
- **Root cause:** the consent-aware Google Ads (`dae3d560`) and TikTok Pixel
  (`c5830280`) integration commits modified two vendor-derived templates after the
  manifest was re-cut for the Meta Pixel work, without re-cutting the baseline.
- **Verification before re-cut:** deepened the clone to full history and diffed both
  files at `283cf079` (manifest re-cut commit) vs HEAD — the deltas are exactly the
  documented privacy work (identifiers move to inert `data-*` attributes on the shared
  consent-gated runtime template; the pre-consent direct GA4/Baidu/GTM initializers
  are retired from `seo-trackers.tpl`). No unrelated or unsafe changes were present.
- **Fix (the documented procedure, not a bypass):** re-computed the two SHA-256
  hashes, updated the manifest in place, recorded the dated reason in the manifest
  header and in `docs/BRANDING-COMPATIBILITY.md` ("Vendor integrity baseline re-cut —
  2026-11-09"). `sha256sum --check --strict` now passes for the whole manifest;
  all 23 release-gate static tests pass.

No placeholder/TODO clusters were found in first-party Node/TS source
(`grep TODO|FIXME|HACK` over `cloudhost247-node/src|frontend|scripts|database`:
only the intentional `-- TODO: add statements` scaffold inside the migration
file template). Remaining markers live in vendored third-party libraries
(xterm.js, Smtphosting core) and are the vendor's own comments, per file-scope
verification.

## 4. Verification executed (Phases 3, 5, 6)

| Check | Command | Result |
|---|---|---|
| PHP syntax, PHP 8.2 leg | `php-lint-targets.sh \| xargs php -l` (WASM shim) | **1,100 clean** — 842 first-party/fixture targets + 258 vendored Smarty 4.5.6 files fetched for the rendered audit; zero errors |
| PHP syntax, PHP 7.4 leg | same with `PHP_WASM_VERSION=7.4` | **842/842 clean** (the PHP-8-only-syntax tripwire; run before the Smarty cache existed) |
| PHP behavioural suites | 18 suites `tests/{foundation,theme,currency,smm,tools,ovh,rdp,integrations,modules,builder,broker,marketing,cart_recovery,passkey,phoneservices,customaffiliate,cloudhost247_email,payments,website}/run.php` | all pass under `set -e` gate (1,566 PASS/ok assertion lines; suite-level counts incl. `# 60`, `# 237`, `# 315` assertions, 0 failed) |
| TypeScript typecheck | `npm run typecheck` + `typecheck:scripts` | zero errors (server + scripts projects) |
| Node unit/integration | `npx vitest run` (full suite — executed twice; baseline found F-1, re-run confirms fix) | **232 files / 2,901 tests — all pass post-repair (exit 0; ~29 min per run)** |
| Python static/security | 44 unittest modules across foundation/theme/currency/marketing/ovh/rdp/integrations/modules/builder/smm/tools/broker/cart_recovery/passkey/digitalproducts/payments/security/staging/website | **678 tests, 0 failed (2 skipped: environment-gated)** |
| Server agent protocol | `node --test server-agent/tests/*.test.js` | 20 passed, 0 failed (HMAC, skew window, replay cache) |
| Financial invariants | `runFinancialInvariantChecks` via `financial-invariant-sweep.test.ts` (embedded PG) | pass (append-only ledger, atomic writes) |
| Payment authorization matrix | `runPaymentAuthorizationChecks` via `payment-authorization-matrix.test.ts` | pass (no unauthorized call can mark an order paid; state byte-identical after each rejected attempt) |
| Tools browser modules | `node tests/tools/local.test.mjs` | pass |
| Tools catalogue gate | `npm run tools:catalog:check` (+ `catalog:docs`) | pass (75-tool schema, catalogue fresh) |
| Production build | `npm run build` (tsc server + vite SPA + vite tools bundle) | pass |
| Migrations | `python3 scripts/validate-migrations.py`; dev boot applied **92/92** migrations on embedded Postgres; `/ready` healthy | pass |
| Link integrity (static) | `link-integrity.test.ts` + `scripts/site/check-links.mjs` | pass (all 221 registry links validated: 210 app / 217 PHP) |
| Accessibility contract | `scripts/check-accessibility-contract.py` | pass |
| Media/raster ladders | `generate-raster-formats.py --check` | pass |
| Rendered-site audit (real Smarty 4.5.6, fetched + SHA-256-verified) | `bash scripts/verify-rendered-site.sh --fetch` | pass (67 pages render own hero artwork; 265 published tool paths resolve; heading/canonical/link audit clean) |
| Vendor integrity baseline | `sha256sum --check --strict original-file-manifest.sha256` | pass after F-3 re-cut |
| Branding/legacy-name audit | `scripts/branding-audit.py --quiet` | pass (zero retired-brand references) |
| Workflow YAML parse | `scripts/check-workflow-yaml.mjs` | pass |
| Dependency vulnerabilities | `npm audit --omit=dev` | **0 vulnerabilities** |
| Health/readiness (running app) | `GET /health`, `GET /ready` on the dev stack | `{"status":"ok"}` with database check ok |
| Tools API smoke | `GET /api/tools/catalog` via frontend proxy | real catalog JSON (8 categories incl. 17 DNS tools) |

The complete release-candidate gate
(`PHP_LINT_JOBS=16 bash scripts/release-candidate-check.sh`) was run end-to-end and
finishes with **`Release-candidate source verification passed.`** (exit 0), with the
rendered-site step actually executed rather than skipped.

## 5. Test totals

- Node platform: **2,901/2,901 passed, 0 failed** (232 test files; post-repair full re-run, exit 0).
- PHP behavioural suites: 18/18 suites passed (1,566 PASS/ok assertion lines in the gate log).
- Python static/security: 678 passed / 2 environment-skipped / 0 failed.
- JS runtime + tools module tests: 21 passed, 0 failed.
- PHP lint: 1,942 clean lints in total (842 first-party/fixture targets under PHP 7.4; the same 842 plus 258 vendored Smarty files under PHP 8.2 inside the rendered-audit run).
- Baseline full-suite run found exactly 1 failing test (F-1); after repair and
  re-run the suite is fully green.

## 6. Files created / modified / deleted

Created:
- `cloudhost247-node/frontend/public/docs/integrations-google-ads.md` (published doc)
- `VERIFICATION-REPORT-2026-11-09.md` (this report)
- `cloudhost247-node/.env` (local dev environment; git-ignored, mode 600)

Modified:
- `cloudhost247-node/frontend/src/pages/AdminGoogleAdsPage.tsx` (F-1 link target)
- `scripts/site/generate.mjs` (F-1: publish GOOGLE-ADS.md)
- `cloudhost247-node/frontend/src/content/docs.generated.json` (regenerated)
- `cloudhost247-node/frontend/src/navigation/registry.generated.ts` (regenerated)
- `cloudhost247-node/src/navigation/registry.generated.ts` (regenerated)
- `shared/site/generated/route-report.json` (regenerated)
- `docs/website-rebuild/page-inventory.json` + `.csv` (F-2 regeneration)
- `docs/independent-rebuild/original-file-manifest.sha256` (F-3 deliberate re-cut, 2 hashes + dated header reason)
- `docs/BRANDING-COMPATIBILITY.md` (F-3 re-cut record)

Deleted: none.

Commits (branch `arena/fe9b2088-cloudhost247`):
- `c058218` — fix(admin): repair dead Google Ads setup-guide link on AdminGoogleAdsPage
- `cca9e45` — chore(docs): regenerate stale page inventory for what-is-my-ip SEO copy
- `bae36080` — chore(baseline): re-cut vendor integrity manifest for consent-aware ads work

## 7. Remaining blocked items (not fixable without external infrastructure/authorization)

1. **Playwright e2e suites** (`e2e/*.spec.ts`, incl. link-integrity browser half):
   no browser binary on this host and the Playwright CDN is not reachable from the
   sandbox. Static link-integrity + rendered-site audit cover the same ground
   non-visually. Outstanding: run e2e where Chromium can be installed.
2. **WHMCS staging functional testing**: the PHP pages/modules require a licensed
   WHMCS installation; repo documents this as a staging-gate item
   (`docs/DEPLOYMENT-GUIDE.md`). Runtime activation, provisioning and checkout against
   real WHMCS remain unverifiable here.
3. **Live provider/payment activation** (Stripe/PayPal/Paystack webhooks, Hetzner/
   DigitalOcean/Vultr/Contabo/OVH/Proxmox/…, Cloudflare, WHMCS API): intentionally not
   enabled — requires owner credentials and authorization; platform is designed to
   report "not connected" honestly rather than simulate.
4. **`verify:financial` / `verify:authorization` as standalone production probes**:
   the CLI form targets a real Postgres at 127.0.0.1:55432 (by design, for production
   audits). The identical check functions were executed here inside the integration
   suite against the embedded Postgres; the production-facing CLI run remains a
   deployment-time activity.
5. **Quarantined migrations 0023/0024/0025/0041**: require explicit owner authorization
   in production per docs; not applied anywhere in this audit.

## 8. Production-readiness risks

- The three repaired items were all *gate-evidence* defects (a dead link and two stale
  artefacts), not runtime defects; the codebase passes every executable check it ships.
- WHMCS-dependent flows (billing hand-off, provisioning modules, legacy theme runtime)
  can only be fully proven on a licensed staging install — schedule the cPanel staging
  gate in `docs/CPANEL_DEPLOYMENT.md` §0a before production.
- Dev server currently runs with `DEPLOYMENT_SIMULATION_MODE=true` and mock providers;
  these flags must remain off in any real deployment (env-check enforces this under
  `NODE_ENV=production`).
