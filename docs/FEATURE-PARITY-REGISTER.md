# CloudHost247 — Hostinger Feature-Parity Register (Phase 1)

**Date:** 2026-11-07 · **Branch:** `arena/1b329121-cloudhost247` · **Status:** Phase 1 delivered; no feature code changed
**Status refresh:** 2026-11-07 (P0 fix + canonical decision); see `docs/PHASE-DELIVERY-REPORT.md` for per-phase evidence.
**Machine-readable register:** [`docs/feature-parity-register.csv`](feature-parity-register.csv) — 211 features, 12 columns, regenerable with `python3 scripts/audit/build-feature-register.py`
**Verification log:** [`docs/PHASE-1-VERIFICATION.md`](PHASE-1-VERIFICATION.md)
**Implementation plan:** [`docs/IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md)

> Hostinger is used **only as a functional and UX benchmark**. No Hostinger source code, images, copy or trademarks are used. All CloudHost247 deliverables remain original. A page, menu item, button, API route or test filename is **not** evidence that a feature works end to end.

---

## 1. Status vocabulary

Exactly the six statuses specified for this project:

| Status | Meaning |
| --- | --- |
| **Complete and verified** | DB schema + backend + API + permissions + error handling + frontend + automated tests exist, and the relevant checks were actually run in this workspace. |
| **Implemented but not fully verified** | Real code exists (not a placeholder page), but live provider behaviour, a production migration, a browser check, or a full end-to-end run is missing. |
| **In progress** | Work started or a blocking defect identified; not usable end to end. |
| **Blocked by external provider** | Code exists but cannot be exercised because credentials, a sandbox account, a licensed dependency, or a cPanel host is unavailable. **Never** reported as a success. |
| **Not implemented** | No backend implementation found. A marketing page or capability flag does not change this. |
| **Not applicable** | Deliberately excluded for a documented reason (e.g. no genuine customer stories, no 24/7 staffing). |

## 2. How evidence was collected

The register was built from repository inspection, not from the site's own claims about itself.

1. **Official benchmark pages fetched:** `https://www.hostinger.com/pricing` (chunk 0 of 4), `https://www.hostinger.com/web-hosting` (chunk 0 of 4), `https://support.hostinger.com/en` → `https://www.hostinger.com/support/` (chunk 1 of 1), plus earlier `https://www.hostinger.com/` (chunks 0–3) and `/vps-hosting` (chunk 0). **Chunks 1–3 of pricing/web-hosting and individual support articles were not fetched**, so the register does not claim exhaustive coverage of Hostinger's current catalogue. Secondary review sites were used only as leads, never as authoritative facts; where their AI-credit figures conflicted with the official pricing page, the official page won.
2. **Repository inventory:** 8,092 tracked files; 84 root PHP pages; 23 WHMCS addon modules; 14 server modules; 83 SQL migrations (`0001`–`0083`); 50 Fastify route modules; 131 SPA page components; 190 `App.tsx` route declarations; 108 provider catalogue keys; 166 Vitest files; 74 `platform/` tests; 38 root Python tests; 838 PHP lint targets.
3. **Historical reports** (`REPOSITORY-AUDIT-REPORT.md`, `IMPLEMENTATION-SUMMARY.md`, `PRODUCTION-READINESS-REPORT.md`, `docs/ACCEPTANCE-CRITERIA.md`, `docs/NODE_PLATFORM_STATUS.md`, `docs/UNFINISHED-MODULES.md`, `docs/independent-rebuild/*`) were read as **self-reports**, not accepted as verification. Their counts disagree by scope (46 vs 84 PHP pages; 837 vs 838 lint targets; 498 API / 152 frontend routes vs 190 declared SPA paths). Where a claim mattered, the underlying command was re-run.
4. **Actual commands re-run** (full output in `docs/PHASE-1-VERIFICATION.md`): site generator `--check` and full generation, link audit, branding audit, navigation inventory, migration validation, PHP 8.2 WASM lint of all 838 targets, Node/frontend typecheck, lint, tools catalogue check, frontend build, and 49 selected Vitest files (875 tests).

## 3. Executive summary

| Status | Count | Share |
| --- | ---: | ---: |
| Complete and verified | 49 | 23% |
| Implemented but not fully verified | 75 | 36% |
| In progress | 0 | 0% |
| Blocked by external provider | 16 | 8% |
| Not implemented | 69 | 33% |
| Not applicable | 2 | 1% |
| **Total** | **211** | **100%** |

The platform is **not** a greenfield site: real DB schemas, APIs, permissions, migrations, provider adapters, AI governance, builder, store, DNS, billing and WHMCS modules exist. The dominant problem is **verification depth and integration truthfulness**, not missing pages. Roughly a third of the benchmark scope has no backend at all, and another third has code that has never been proven against a live provider, a production migration, or a browser.

### 3.1 Critical findings

1. **~~VPS ordering is broken end to end~~ — FIXED on 2026-11-07 (`A04`, `E01`, `E02`, `E13`).** The root cause was an identifier-contract mismatch, not bad test fixtures: every seeded OS-image id in migrations `0041`/`0048`/`0051` has the shape `10000000-0000-0000-0000-00000000000N` / `20000000-...`. zod 4.6.7's `z.string().uuid()` rejects version-0/variant-0 UUIDs, so `POST /api/v1/servers` returns `400 {"error":"VALIDATION_ERROR","message":"Invalid UUID"}` for **every** seeded image, and `POST /api/v1/servers/:id/reinstall` does the same. This is a product defect, not just a test-fixture issue: a real customer would get the same 400. Eleven test files use these ids. **Resolution:** a shared `src/lib/identifier-contract.ts` now validates the PostgreSQL `uuid` domain (strict canonical shape, version-agnostic) at the API boundary, with no weakening to `z.string()` and no seed-data rewrite (which would require touching the quarantined `0041` migration). 71 tests across 12 route-touching files and 2 new regression suites pass; a real seeded OS id now returns 201 `AWAITING_PAYMENT` with zero provider jobs. Details: `docs/PHASE-DELIVERY-REPORT.md`.
2. **~~Two complete Node platforms coexist (undecided)~~ — DECIDED on 2026-11-07 (`AR04`).** `cloudhost247-node/` is canonical; `platform/` is frozen read-only. An independent route dump found 222 node-only endpoints, no AI/LLM integration, no versioned migrations and no WHMCS generator projection in `platform/`, so its README's supersession claim is false today. Evidence: `docs/CANONICAL-BACKEND-COMPARISON.md`, `docs/audit/canonical-backend-route-comparison.csv`, `docs/ARCHITECTURE-DECISION-RECORD.md`.
3. **Control-panel adapters can fabricate success (`A08`, `D06`–`D10`).** `cloudhost247-node/src/control-panels/adapters/base.ts` returns `success: true` / `queued` / `ACTIVE` / `healthy` from stub methods without any upstream HTTP call. The methods are not currently wired into customer routes, but they are a live honesty hazard: no cPanel/WHM operation may be advertised until a real adapter call is proven. Where cPanel already provides functionality, integrate rather than rebuild.
4. **~~SSL is record-keeping, not issuance (`A11`, `F01`)~~ — ISSUANCE BUILT 2026-11-13, INSTALL STILL NOT CLAIMED.** The finding was correct when written: `/issue` and `/renew` wrote `ISSUED` and a `+90 days` expiry without contacting any authority. Both now run a real RFC 8555 conversation (`src/ssl/acme-client.ts`, `src/ssl/ssl-issuance-service.ts`, `src/routes/acme-challenge.ts`, migration `0104`) and reach `ISSUED` only when a CA returns a certificate whose SANs cover every ordered name, with `expires_at` read from the certificate's own `notAfter`; with no `ACME_DIRECTORY_URL` the route answers `503 SSL_ISSUANCE_NOT_CONFIGURED` and writes nothing. Verified against an independent loopback CA and cross-checked with OpenSSL — which surfaced a real CSR defect (missing `Extensions` SEQUENCE, so the SANs were silently dropped). **What is still not claimed:** public-CA issuance (no CA was reachable here — CT-04), DNS-01 automation, wildcard issuance, and certificate *installation* onto a hosting node (CT-01/CT-06). No "SSL installed" claim is justified.
5. **Currency conversion is display-only (`GX09`, `GX10`).** Migration `0083_create_display_fx_rates.sql` and `docs/CURRENCY_DISPLAY.md` implement estimated converted amounts while **billing stays USD**, with a disclaimer flagged as needing legal review. This conflicts with the brief's canonical-price / "never convert for display only while charging a different undisclosed amount" requirement. Country detection is deliberately absent: `/api/v1/currency/geo-country` returns `country: null`. See plan §P1.
6. **Financial and migration governance is frozen (`AR05`, `L`).** `docs/NODE_PLATFORM_STATUS.md` quarantines migrations `0023`, `0024`, `0025`, `0041` in `database/migrate.ts`; production cannot advance past `0040` without explicit `AUTHORIZED_MIGRATIONS`. `PHASE_5_CHECKPOINT_REPORT.md` records a 5C double-credit concurrency defect and webhooks are frozen. PR #12 is open/unmerged. **No payment gateway has been activated and no financial setting was changed.**
7. **cPanel / WHMCS runtime parity is unproven (`AR03`, `AR06`).** Licensed WHMCS core, native PHP, a cPanel host and credentials are absent in this sandbox. PHP was validated with `scripts/php-wasm/php` (PHP 8.2.33) as **syntax only**. The `docs/CPANEL_DEPLOYMENT.md` 18-point checklist is entirely unchecked.
8. **No browser visual verification.** No Chromium binary is installed and `npx playwright install chromium` failed with TLS `ECONNRESET`. Responsive/accessibility claims rest on static contract checks, not on rendered screenshots.

### 3.2 Workstream roll-up

| Workstream | Features | Verified | Not implemented | Headline |
| --- | ---: | ---: | ---: | --- |
| A Hosting | 16 | 2 | 5 | VPS order defect; WP/PHP/agency/dedicated-IP/migration have no backend |
| B Builder | 18 | 3 | 7 | Node builder publishes real sites; no drag canvas, staging, clone, domain binding in Node |
| C AI | 11 | 1 | 5 | Fail-closed LLM router + real ledger/entitlements; no external model configured |
| D Control panel | 24 | 4 | 9 | Overview, domains, DNS, tickets solid; file/FTP/DB/PHP/cron/email are capability flags only |
| E VPS | 15 | 4 | 1 | 13 adapters + lifecycle implemented; live provisioning unproven; UUID defect blocks ordering |
| F Security | 18 | 5 | 5 | Auth/MFA/passkeys/audit/firewall verified; malware, DDoS, DR, login alerts absent |
| G Email | 18 | 0 | 6 | WHMCS marketing source-complete; no live send, no Node customer API, no AI copywriting |
| H Ecommerce | 11 | 4 | 3 | Store/cart/orders/tools verified; gateways frozen, no analytics/social connectors |
| I Domains | 12 | 1 | 5 | DNS zones/propagation verified; registrar ops need real APIs + credentials |
| J Agency | 11 | 1 | 10 | RBAC exists; agency model is essentially absent |
| K Support | 10 | 1 | 3 | Tickets verified; no live chat, no searchable KB, no incident feed |
| L Billing | 12 | 5 | 4 | Cart/invoices/ledger/refunds verified; renewals, coupons, tax, plan changes absent |
| GX Global | 10 | 3 | 5 | 13 locales + Intl formatting verified; country detection and regional payments absent |
| W Website | 18 | 12 | 1 | Public site, chrome, legal, SEO structures verified statically; no browser matrix |
| AR Architecture | 7 | 3 | 0 | Registry/design-system/vault verified; duplicate-stack decision outstanding |

## 4. Benchmark sources used

Official pages (accessed 2026-11-07):

- `https://www.hostinger.com/pricing` — product tabs: Websites, Ecommerce, Domains, AI Builder, VPS, AI agents & automation, Business email, Email marketing; paid-upfront 48-month terms with higher renewal prices; 30-day refund; 24/7 support; shared tiers Premium/Unlimited/Cloud Startup and Agency Startup; all-plan features (SSH/WP-CLI, SFTP account management, PHP version management, free staging, 1-click cloning, Redirects Manager, cron jobs, malware scanning, unlimited collaborators); AI credits 250/500/1000/2000.
- `https://www.hostinger.com/web-hosting` — build choices (WordPress, PHP/HTML, drag-and-drop, AI vibe coding); visibility tools; Google Ads / Meta Pixel / GA; Hostinger Reach; unlimited free migrations; LiteSpeed + NVMe; CDN + Object Cache; 24-hour plan boost; free SSL, malware scanning, domain privacy, IP/country blocking; Hostinger Connector for Claude Code/Cursor.
- `https://support.hostinger.com/en` → `https://www.hostinger.com/support/` — category/article counts used to size support scope: AI Builder 263, VPS 274, Email 128, Website 126, Ecommerce 100, Domains 89, DNS 78, hPanel 59, Files 54, Billing 40, PHP 20, SSL 17, and 21 further categories.
- `https://www.hostinger.com/` and `https://www.hostinger.com/vps-hosting` — used in earlier sessions for public-site chrome and VPS positioning.

**Coverage limitation:** pricing/web-hosting chunks 1–3, individual support articles and Hostinger API docs were not retrieved. The register is a strong functional baseline, not an assertion of 100% catalogue coverage. Phase 3 begins by closing those gaps with the same evidence rules.

## 5. Evidence ledger for features marked "Complete and verified"

**No feature was newly completed in Phase 1** — this was a read-only audit. The 49 verified rows are inherited from previously accepted work; the checks below were re-run in this workspace. Per-feature delivery reports in Phases 3–9 will carry the full record (files changed, DB changes, API endpoints, frontend routes, integrations, tests/results, screenshots, known limitations) at the point each feature is completed.

| Verified group | Files / DB | API endpoints | Frontend routes | Tests executed and result | Limitations |
| --- | --- | --- | --- | --- | --- |
| Navigation / menu / mega / footer (`W16`, `AR01`, `AR02`) | `cloudhost247-node/frontend/src/layout/{Header,Footer,Layout}.tsx`, `components/navigation/PlatformMegaMenu.tsx`, `hostinger-chrome.css`, `shared/site/registry.json`, `design-system.css`, `scripts/site/generate.mjs` | `/api/tools/navigation`, `/api/tools/catalog` | All 190 SPA routes; 67 PHP pages | `hostinger-chrome.test.tsx` 4/4; 28 layout/App files 149/149; `node scripts/site/generate.mjs --check` 221 links; `check-links.mjs` 2219 surfaces / 0 broken; `audit-navigation-inventory.py` 0 orphan/dangling/duplicate | No browser screenshot; canonical CSS retains inert generic selectors for the WHMCS theme |
| Public site, legal, SEO (`W01`, `W02`, `W04`, `W06`–`W08`, `W13`–`W15`, `W17`, `W18`) | `shared/site/{registry.json,content/}`, `frontend/src/pages/**`, `frontend/public/docs/*.md`, `robots.txt`, `templates/cloudhost247/css/design-system.css` | `/api/v1/public/status`, `/api/v1/catalog/*` | 55 marketing pages, 43 PHP product pages, 19 legal policies | Full `generate.mjs` (7 mega menus, 8 footer columns, 174 FAQs, 13 docs / 216 KB); `branding-audit.py` 0 retired-brand matches; `check-accessibility-contract.py`; `build:frontend` clean → `/assets/index-C2R07zQg.js` + `/assets/index-LRaSr-pl.css` | C4 browser matrix PARTIAL (520 stale cases, no Chromium); no production prices seeded |
| Auth / account security / MFA / passkeys / RBAC (`F08`–`F10`, `J11`, `AR07`) | `src/auth/**`, `src/db/users.ts`, migrations `0001`–`0003`, `0022`, `0027`, `0060`–`0062`; `modules/addons/cloudhost247_integrations/lib/Vault/EncryptedVault.php` | `/api/auth/{register,login,logout,me}`, `/api/auth/mfa/*`, `/api/auth/passkeys/*`, `/api/auth/password-reset/*`, `/api/v1/admin/*` | `/login`, `/register`, `/account`, `/admin/*` | `tests/integration/auth-flow.test.ts`, `totp-mfa.test.ts`, `passkeys.test.ts`, `admin-rbac.test.tsx` — all passed in the 49-file run | WebAuthn needs a real origin/RP ID on staging; no device/session enumeration |
| DNS zones, records, propagation (`A13`, `I07`, `E08`) | migrations `0044`, `0046`; `src/routes/dns.ts`, `src/routes/firewall.ts`, `src/dns/propagation.ts` | `/api/v1/dns/zones*`, `/api/v1/dns/records*`, `/api/v1/servers/:serverId/firewall*` | `/dns`, `/admin/firewall` | `tests/integration/dns-api.test.ts`, `dns-propagation.test.ts`, `ssl-firewall-api.test.ts` — passed | External Cloudflare/Route53 zones need vault credentials; propagation runs upstream-before-local (delete asymmetry documented) |
| Support tickets (`K02`, `D22`) | migrations `0010`–`0011`; `src/db/support-tickets.ts`, `src/routes/{account,admin-customers,ai-support}.ts` | `/api/v1/account/tickets`, `/api/v1/admin/tickets` | `/support`, `/support/:id`, `/admin/tickets` | `frontend/tests/unit/support-pages.test.tsx` passed | No live chat, SLA or escalation rota |
| Billing core (`L01`, `L02`, `L05`–`L07`, `D21`) | migrations `0014`–`0025`; `src/db/billing-ledger.ts`, `src/services/payment-service.ts`, `src/routes/{commerce,billing,payments}.ts` | `/api/v1/cart*`, `/api/v1/orders*`, `/api/v1/invoices*`, `/api/v1/payments*` | `/cart`, `/billing`, `/invoices`, `/invoices/:id`, `/admin/invoices` | `payments-api.test.ts`, `billing-api.test.ts`, `financial-invariant-sweep.test.ts` passed (historical acceptance); 49-file run included related suites | No live gateway; migrations 0023/0024/0025 quarantined; webhooks frozen |
| Builder publish / revisions / public serving / store (`B11`, `B16`, `B18`, `H02`, `H03`, `H05`) | migrations `0072`–`0074`; `src/builders/site-service.ts`, `src/store/store-service.ts`, `src/routes/builder.ts`, `src/routes/store.ts` | `/api/v1/builder/sites*`, `/api/v1/builder/pages/:id/revisions*`, `/api/v1/public/sites/:slug`, `/api/v1/public/stores/:slug`, `/api/v1/store/stores/:id/products` | `/platform/builder`, `/store`, `/storefront/:slug`, `/sites/:slug` | `tests/integration/platform-services-api.test.ts` (builder, AI-builder, store, publication cases) passed | No visual drag editor in Node SPA; store separate from builder; no domain binding |
| AI governance (`C11`) | migration `0073`; `src/builders/entitlements.ts`, `src/builders/ai/generation-service.ts`, `src/ai-os/{permissions.ts,models/router.ts,controllers/routes.ts,repositories/audit-repo.ts}` | `POST /api/v1/ai-builder/projects/:id/generate`, `POST /api/v1/ai-builder/generations/:id/apply`, `src/ai-os/controllers/routes.ts` `/api/v1/{admin,account}/ai` | `/platform/ai-builder`, `/admin/ai` | `platform-services-api.test.ts`, `ai-control-plane.test.ts`, `unit/ai-control-plane.test.ts` passed | No external LLM configured (fail-closed by design); no per-token cost accounting |
| Tools Centre (`H11`), locales/formatting (`GX03`, `GX06`), display FX (`GX02`) | `src/tools/**`, `frontend/src/i18n/{locales.ts,format.ts}`, `frontend/src/currency/display-currency.ts`, migration `0083`, `modules/addons/cloudhost247_currency/**` | `/api/tools/catalog` (75 tools / 9 categories), `/api/v1/currency/rates`, `/api/v1/currency/geo-country` | `/tools`, `/tools/:slug`, currency + language switchers | `tools-integration.test.tsx`, `currency-display.test.ts`, `currency-geo-fallback.test.tsx`, `display-fx.test.ts`, `currency-geo-hint.test.ts` passed | `geo-country` intentionally returns `country: null`; FX is display-only (see §3.1.5) |
| PHP/WHMCS structural integrity (`A16`) | 84 root PHP pages, 23 addons, 14 server modules, 2 themes, 3 order forms, 27 language overrides | WHMCS hooks / module actions | 67 registered PHP pages | `scripts/php-wasm/php -v` → PHP 8.2.33; 838/838 targets lint clean | WHMCS core + native PHP absent; syntax only; PHP 7.4 leg and behavioural suites not run |
| Server monitoring / SSH metadata / audit (`E04`, `E05`, `E07`, `F16`) | migrations `0038`, `0039`, `0050`, `0052`; `src/infrastructure/**`, `src/routes/servers.ts` | `/api/v1/servers/:id`, `/api/v1/servers/:id/actions`, `/api/v1/admin/servers*` | `/servers/:id`, `/admin/servers`, `/admin/audit` | `server-reconciliation.test.ts`, `provider-capability-truth.test.ts`, `undeclared-adapter-fail-closed.test.ts` passed | Live actions need provider confirmation; `server-infrastructure.test.ts` has 2 failures (see §3.1.1) |

## 6. Known gaps that must not be presented as features

The following are **Not implemented** despite having marketing pages, capability flags, or legacy PHP files: WordPress management, PHP version/config, file manager, FTP/SFTP accounts, database management, cron jobs, email accounts/forwarders/webmail, guided SPF/DKIM/DMARC, malware scanning, DDoS rule management, disaster recovery, login notifications, dedicated IP allocation, website migration, staging, cloning, blog/CMS, landing-page presets, site performance insights, domain renewal/locking/privacy/contact management, coupons, automatic renewals, plan upgrades/downgrades, tax and regional billing, regional payment methods, regional content/contact/legal variants, country detection, marketing analytics connectors, live chat, searchable KB, incident notifications, feedback capture, abuse reporting, and the entire agency/reseller/white-label model except RBAC.

## 7. Decisions required before Phase 4

1. **Canonical Node stack** — keep `cloudhost247-node/` and retire/absorb `platform/`, or the reverse. Required by `AR04`; blocks all Phase 4–8 backend work.
2. **Financial freeze** — written authorisation is needed before migrations `0023`/`0024`/`0025`/`0041` run, webhooks are enabled, or any gateway is activated. Until then, billing work is code-only.
3. **Provider sandbox credentials** — decide which of registrar (GoDaddy/Namecheap/Gandi), infrastructure (Hetzner/OVH/…), DNS/CDN (Cloudflare/Route53), certificate authority (ACME), email (M365/Google/SMTP), LLM (OpenAI-compatible/Anthropic-compatible) and payment gateways may be configured for sandbox tests. **Nothing is activated by default.**
4. **Currency model** — choose canonical single-currency billing with honest disclosure, or a real multi-currency price/cart/checkout/invoice model. The current display-only conversion is a documented conflict with the brief.
5. **cPanel/WHMCS** — provide a staging cPanel host and a licensed WHMCS 8.x instance (or explicitly scope Phase 9 to static verification only).

## 8. Re-running this phase

```bash
python3 scripts/audit/build-feature-register.py     # regenerate the CSV
node scripts/site/generate.mjs --check && node scripts/site/check-links.mjs
python3 scripts/branding-audit.py && python3 scripts/audit-navigation-inventory.py
python3 scripts/validate-migrations.py
bash scripts/php-lint-targets.sh | xargs -r -P 8 -n1 scripts/php-wasm/php -l
cd cloudhost247-node && npm run typecheck && npm run lint && npm run build:frontend
npx vitest run tests/integration/server-infrastructure.test.ts --reporter=dot
```

Full results, including the two reproducible failures, are in [`docs/PHASE-1-VERIFICATION.md`](PHASE-1-VERIFICATION.md).
