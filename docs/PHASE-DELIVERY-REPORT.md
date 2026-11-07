# Phase Delivery Report — 2026-11-07

**Branch:** `arena/1b329121-cloudhost247` · **Canonical Node backend:** `cloudhost247-node/` (ADR-001)
**Financial freeze:** **IN FORCE.** No live gateway, no live webhook, no quarantined migration released, no production payment setting changed, no real transaction.
**Production deployment:** **None.** No production compatibility claimed.

This report covers the work authorised on 2026-11-07: P0 defect fix, canonical-backend comparison/decision, provider comparison, multi-currency core, staging requirements, and the start of Phase 3. Each phase lists the exact fields the project owner requires.

---

## Phase P0 — VPS OS-image UUID validation defect

**Status:** ✅ **Complete and verified** (code, DB-neutral, tests, real ordering workflow).

**Root cause (identifier contract investigation):**

| Layer | Finding |
| --- | --- |
| DB migrations `0027`, `0041`, `0043`, `0066` | Seed deterministic "well-known" ids such as `20000000-0000-0000-0000-000000000006` (Ubuntu 24.04) and `30000000-...` (cPanel). Version nibble `0`, variant nibble `0`. |
| PostgreSQL `uuid` domain | Accepts any 32 hex digits in 8-4-4-4-12 form — these are valid DB values and are referenced by foreign keys. |
| zod 4.6.7 | `z.string().uuid()` / `z.uuid()` now require an RFC 4122/9562 **version + variant**. Every real seeded catalogue id is rejected; the all-zero nil UUID is the one special case zod accepts. |
| `src/routes/servers.ts:83-97` | `orderServerSchema` and `reinstallServerSchema` used `z.string().uuid()` on `operatingSystemVersionId`, so `POST /api/v1/servers` and `POST /api/v1/servers/:id/reinstall` returned `400 VALIDATION_ERROR / Invalid UUID` for **every** seeded OS image. |
| `src/routes/{infrastructure,control-panels}.ts` | Same latent defect on OS/version/control-panel path params and `controlPanelId`. |
| 11 integration test files | Referenced the seeded ids; 2 assertions failed in `server-infrastructure.test.ts` (line 71 `expected 400 to be 201`, line 172 `expected 400 to be 404`). |

**Chosen fix (no weakened validation, no fixture-only workaround):** a single shared `src/lib/identifier-contract.ts` validates the **PostgreSQL `uuid` domain** — strict canonical 8-4-4-4-12 hex (`z.guid()`), version-agnostic, lowercased. It rejects arbitrary strings, braces, URNs, SQL payloads, wrong lengths and non-hex characters, and still accepts runtime `randomUUID()` v4 ids. Seed data, the quarantined `0041` migration and all foreign keys are untouched. Re-keying was rejected because it would require rewriting an applied, checksummed migration and mutating live rows — a data change prohibited by the freeze.

**Files changed:**

| File | Change |
| --- | --- |
| `cloudhost247-node/src/lib/identifier-contract.ts` | **NEW** — canonical DB UUID contract, aliases, `isCanonicalDbUuid`, `requireDbUuid` |
| `cloudhost247-node/src/routes/servers.ts` | import + `catalogIdSchema` on order/reinstall/resize id fields |
| `cloudhost247-node/src/routes/infrastructure.ts` | import + `catalogIdSchema` for OS/version/provider path params |
| `cloudhost247-node/src/routes/control-panels.ts` | import + `catalogIdSchema` for `idSchema` and `controlPanelId` |
| `cloudhost247-node/tests/unit/identifier-contract.test.ts` | **NEW** — 6 tests incl. a guard over **every UUID literal in all 83 migrations** |
| `cloudhost247-node/tests/integration/os-catalog-identifier-contract.test.ts` | **NEW** — 3 tests: all seeded ids satisfy the contract; real DB-sourced OS id drives a full unpaid VPS order; cross-customer reinstall returns 404 not 400 |
| `docs/FEATURE-PARITY-REGISTER.md`, `docs/feature-parity-register.csv`, `scripts/audit/build-feature-register.py` | Status refresh for `A04`, `E01`, `E02`, `E13`, `AR04` |
| `docs/PHASE-1-VERIFICATION.md`, `docs/IMPLEMENTATION-PLAN.md` | original diagnostic retained, resolution recorded |

**Database changes:** **None.** No migration added, edited or applied; no data changed. The fix is entirely at the API boundary.

**API changes:** `POST /api/v1/servers`, `POST /api/servers`, `POST /api/v1/servers/:id/reinstall`, `/rebuild`, `/resize`, OS/version/control-panel admin endpoints, `POST /api/v1/control-panel-plans` now accept deterministic seeded catalogue ids. Response shapes, permissions, error codes and idempotency behaviour are unchanged. Malformed ids still return `400 VALIDATION_ERROR` (explicitly tested).

**Tests executed and results:**

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/identifier-contract.test.ts tests/unit/control-panel-adapters.test.ts tests/integration/os-catalog-identifier-contract.test.ts tests/integration/server-infrastructure.test.ts tests/integration/infrastructure-admin-operations.test.ts --reporter=dot` | **5 files / 36 tests passed** |
| 12 route-touching integration files (control-panels-api, domains-servers-admin, infrastructure-admin-operations, os-catalog-identifier-contract, os-lifecycle, public-os-availability, server-console, server-infrastructure, server-reinstall-acceptance, server-rescue, server-termination, ssl-firewall-api) | **12 files / 71 tests passed** (96.56 s) |
| `npm run typecheck`, `npm run lint` | clean |
| Real workflow assertion | `POST /api/v1/servers` with an OS-version id read from `operating_system_versions` → **201**, `provisioningStatus: AWAITING_PAYMENT`, `orders.payment_status = unpaid`, **0 provisioning jobs**, `provider_server_id = NULL` — no simulated provisioning |

**Build results:** `npm run typecheck` / `npm run lint` clean (frontend rebuild covered in Phase 3 below).

**Screenshots:** n/a for a backend defect. The Phase 3 browser evidence below covers the running application.

**Outstanding blockers:** none for the defect itself. Live provider provisioning remains unverified (no credentials, freeze).

**Features implemented but not verified:** `E01`/`E03` — provider-confirmed VPS creation/reinstall; `A05` — OVH/SoYouStart live mutations.

---

## Phase A — Canonical backend comparison & decision

**Status:** ✅ **Complete and verified** (independent route dumps + both test suites).

**Entry instruction:** "Before selecting the canonical backend, perform a route-by-route and feature-by-feature comparison… verify that it actually covers all required functionality, integrations, security controls, customer workflows, and deployment requirements."

**How:** booted **both** applications in this workspace and dumped their real registered route tables (`platform/dump-routes.cjs` → `app.router.list()`; `buildApp(...)` + `await app.ready()` + `printRoutes`), canonicalised `/api/v1` ≡ `/api` aliases and param names, and diffed 838 method+path rows.

| Metric | `cloudhost247-node/` | `platform/` |
| --- | ---: | ---: |
| Method+path routes | **722** | 616 |
| Shared / only-in-this-stack | 500 shared | **222 node-only** / 116 platform-only |
| Versioned SQL migrations | **83** + checksummed runner + quarantine | 0 (one generated schema, 127 tables) |
| Frontend | 131 pages / 190 routes | 1 `App.jsx` (194 lines) + ~40 static HTML |
| AI/LLM integration | ✅ | ❌ zero matches |
| WHMCS/PHP generator projection | ✅ | ❌ generator has no reference |
| Tests | 168 Vitest files | 74 `node:test` / 876 tests |

`platform/MIGRATION.md`'s own "Deliberately deferred" section admits: real payment checkout initiation, domain availability lookup, order-driven provisioning, real provider egress, real browser/hardware WebAuthn.

**Decision (ADR-001):** **`cloudhost247-node/` is canonical.** `platform/` is **frozen read-only for feature work**; nothing deleted, renamed, migrated or rewritten. The P0 fix was applied once, in the canonical stack (`platform/src/core/validate.js:218` already used a version-agnostic regex and never had the defect). Convergence is a separate authorised project with an explicit parity gate.

**Files changed:** `docs/CANONICAL-BACKEND-COMPARISON.md` (NEW), `docs/ARCHITECTURE-DECISION-RECORD.md` (NEW), `docs/audit/canonical-backend-route-comparison.csv` (NEW, 838 rows), `platform/README.md` (supersession claim qualified with a pointer — **documentation only, no functional code**), `docs/FEATURE-PARITY-REGISTER.md` / CSV status refresh.

**Database / API changes:** none. **Tests:** `cd platform && node --test tests/*.test.js` → 876 tests; first run 874 pass / 2 fail, two immediate re-runs **876/876**. The 2 transient failures were not reproduced and remain an open flakiness item; they were not used as evidence of a deterministic regression. **Build:** no build needed. **Screenshots:** n/a.

**Outstanding blockers:** none for the decision. **Implemented but not verified:** 116 `platform/`-only routes are preserved but not exercised in the canonical stack; convergence requires authorisation.

---

## Phase B — Provider comparison

**Status:** ✅ **Complete** (research/adapter-preparation document; **no provider activated**).

**Files changed:** `docs/PROVIDER-COMPARISON.md` (NEW). Covers all seven requested categories — domain registrar, VPS/dedicated infrastructure, DNS/CDN, SSL CA, business email/SMTP, AI/LLM, payment gateways — each with API availability, indicative pricing (marked `verify`, no quote), sandbox access, technical limitations and integration requirements, plus cross-cutting credential/fail-closed/cost-control rules and a recommended zero-cost first sandbox set.

**Database / API / build changes:** none. **Tests:** none (documentation). **Screenshots:** n/a.

**Outstanding blockers:** no approved sandbox account, test credential or spend cap in any category. **16 register rows remain `Blocked by external provider`.** No purchase, no live credential, no live service, no live webhook.

---

## Phase C — Genuine multi-currency architecture

**Status:** 🟡 **Core complete and verified; surface wiring gated by the financial freeze.** See `docs/MULTI-CURRENCY-ARCHITECTURE.md` §6 for the honest status table.

**Files changed (NEW, canonical stack, pure — no DB writes/network/gateway):**

| File | Contents |
| --- | --- |
| `cloudhost247-node/src/currency/registry.ts` | 12 supported currencies incl. GBP/USD/NGN/EUR/JPY; ISO minor units; `COUNTRY_CURRENCY` defaults (`GB→GBP`, `US→USD`, `NG→NGN`, …), USD fallback |
| `cloudhost247-node/src/currency/money.ts` | Exact BigInt decimal arithmetic; `convertCanonicalPrice` rounds **once** with documented `HALF_UP`; no float; zero-decimal currencies |
| `cloudhost247-node/src/currency/rates.ts` | Immutable timestamped FX snapshots, finite/positive validation, `assertFresh` fail-closed, `StaticFxRateSource` for isolated tests, documented ECB/Frankfurter endpoints (not activated) |
| `cloudhost247-node/src/currency/snapshot.ts` | Frozen `TransactionMoney` (currency, amount, `pricingId`, FX provenance, `frozenAt`, `schemaVersion`); `assertTransactionMoneyUnchanged`; `refundMoney` in the original currency |
| `cloudhost247-node/src/currency/index.ts` | single entry point |
| `cloudhost247-node/tests/unit/multi-currency.test.ts` | 14 tests |
| `docs/MULTI-CURRENCY-ARCHITECTURE.md` | full data-model, per-surface plan (exact paths), rounding rules, freeze gates, acceptance criteria |

**Guarantee implemented and tested:** "Do not silently change the currency or amount of an existing order or invoice" — a later country detection or a later FX feed cannot rewrite a frozen GBP transaction; refunds never re-convert.

**Database changes:** **None applied.** A forward migration `0084_create_canonical_currency_pricing.sql` is **designed** in the doc (canonical per-currency prices, `fx_rate_snapshots`, append-only frozen money columns + no-update trigger) but is deliberately **not created or applied**: it would change billing tables and requires D2 authorisation.

**API changes:** none. **Tests:** `npx vitest run tests/unit/multi-currency.test.ts` → **14/14 passed**; `npm run typecheck` clean. **Build:** typecheck clean. **Screenshots:** n/a.

**Outstanding blockers:** D2 (financial freeze) for cart/checkout/payment/invoice/renewal/refund wiring; provider approval for a live FX feed; D5 for PHP/WHMCS parity. **Implemented but not verified:** all nine requested surfaces — the primitives are proven, end-to-end wiring is not. The old display-only `0083`/`docs/CURRENCY_DISPLAY.md` path remains untouched and must stay labelled "estimate / USD charge" until cutover.

---

## Phase D — cPanel/WHMCS staging requirements

**Status:** ✅ **Complete** (requirements + full list of unverifiable features; **no staging environment provisioned**).

**Files changed:** `docs/STAGING-ENVIRONMENT-REQUIREMENTS.md` (NEW): 12 WHMCS/PHP requirements (W1–W12), 11 cPanel/Node requirements (C1–C11), 4 shared requirements (S1–S4), a table of **every feature that cannot be verified** without those environments (with register IDs and what *was* verified statically), a post-provisioning verification plan, and an explicit approval request for staging only.

**Database / API / build / tests / screenshots:** none (documentation). **Outstanding blockers:** the entire staging environment; no production compatibility is claimed.

---

## Phase 3 — Public website redesign (shared design system, both runtimes)

**Entry criteria:** ✅ P0 fix verified (71 tests), ✅ architecture decision documented (ADR-001). **Status:** 🟡 **Implemented but not fully verified** — a scoped, verifiable increment; the *complete* multi-page redesign from prior sessions is retained and refreshed, but PHP-rendered pages were not rendered here (no licensed WHMCS/cPanel).

**What was found only by rendering real pages:** at 1440 px the seven desktop nav triggers overflowed their flex track and collided with the language/currency cluster. Static CSS/tests did not detect it. Fixed and re-measured.

**Files changed:**

| File | Change |
| --- | --- |
| `cloudhost247-node/frontend/src/hostinger-chrome.css` | wider bar (`min(1440px, 100% - 32px)`), tightened trigger padding/gaps, desktop breakpoint raised `1280 → 1439 px`, 640 px override updated |
| `cloudhost247-node/frontend/src/components/navigation/PlatformMegaMenu.tsx` | `matchMedia('(min-width: 1281px)')` → `1440px` (2 sites) to keep JS and CSS breakpoints in sync |
| `shared/site/design-system.css` | **canonical** shared `.ch-assurance` primitive (responsive-safe, focus-visible, `prefers-reduced-motion`, `prefers-contrast`, `forced-colors`, overflow-safe) |
| `cloudhost247-node/frontend/src/pages/HomePage.tsx` | React proof strip opts into the shared primitive (`hg-proof ch-assurance`) |
| `templates/cloudhost247/homepage.tpl` | **PHP/WHMCS** equivalent strip opts into the same shared primitive (`ch-principles ch-assurance`) |
| `templates/cloudhost247/css/design-system.css` | **generated copy** of the canonical stylesheet (regenerated, not hand-edited) |
| `shared/site/generated/*`, `frontend/public/docs/*`, `frontend/src/navigation/registry.generated.ts`, `src/navigation/registry.generated.ts`, `modules/addons/cloudhost247_theme/resources/site.json`, `robots.txt`, media copies | regenerated by `node scripts/site/generate.mjs` |
| `cloudhost247-node/scripts/capture-rendered-pages.mjs` | **NEW** reproducible real-browser screenshot capture (`npm run evidence:screenshots`) |
| `cloudhost247-node/scripts/check-header-layout.mjs` | **NEW** rendered-layout regression check at 7 widths (`npm run evidence:layout`) |
| `cloudhost247-node/package.json` | devDependency `@sparticuz/chromium` + `evidence:screenshots` / `evidence:layout` scripts |
| `docs/evidence/screenshots/*.png`, `docs/evidence/render-report.json` | **NEW** 18 viewport screenshots + 1 full-page capture + render metadata |

**Database changes:** none. **API changes:** none. Customer accounts, cart, checkout, catalogue, APIs and provisioning code were **not modified**.

**Tests executed and results:**

| Check | Result |
| --- | --- |
| `node scripts/site/generate.mjs` | 7 mega menus, 8 footer columns, 221 links, 55 marketing pages, 129 sections, 174 FAQs, 13 docs; PHP theme enriched; both `registry.generated.ts` and WHMCS `site.json` refreshed |
| `node scripts/site/generate.mjs --check` | ✓ registry valid — 221 links (210 app, 217 PHP) |
| `node scripts/site/check-links.mjs` | ✓ no broken, placeholder or dangling links (2,219 surfaces; 5 external notes) |
| `python3 scripts/branding-audit.py` | ✓ 0 retired-brand matches |
| `python3 scripts/audit-navigation-inventory.py` | ✓ 0 orphan/dangling/duplicate/unregistered |
| `python3 scripts/validate-migrations.py` | ✓ 11 PASS |
| `npx vitest run frontend/tests/unit/{hostinger-chrome,hostinger-homepage,Header}.test.tsx frontend/tests/unit/navigation-links.test.ts` | **3 files / 14 tests passed** (`navigation-links.test.ts` is in `tests/integration`, not matched — noted below) |
| `npm run typecheck`, `npm run lint` | clean |
| `npm run build:frontend` | ✓ built; `/assets/index-BvpEgZzE.js` + `/assets/index-BqJ8IDGd.css` |
| Preview restarted, served assets | JS `200 application/javascript` 320,852 B; CSS `200 text/css` 177,374 B; `/ready {"status":"ok"}` |
| `npm run evidence:layout` | ✓ **no header overlap at 1920 / 1600 / 1440 / 1280 / 1024 / 834 / 390 px** (desktop chrome ≥1440, compact/drawer below) |
| `npm run evidence:screenshots` | ✓ **18/18 renders, all HTTP 200, 0 console errors, 0 failed requests** |

**Screenshots (actual rendered pages):** `docs/evidence/screenshots/{home,pricing,hosting,domains,tools,about}-{desktop,tablet,mobile}.png` plus `home-desktop-full.png`. Desktop/tablet/mobile = 1440×900 / 834×1112 / 390×844. The screenshot before/after the header fix is visible in the file history of `home-desktop.png` (overlap → clean header).

**Outstanding blockers / known limitations:**
- No licensed WHMCS/cPanel staging → **PHP/WHMCS pages were not rendered**; only the generated theme CSS, `site.json`, nav/footer and content were verified. See `docs/STAGING-ENVIRONMENT-REQUIREMENTS.md` §3.
- `templates/cloudhost247/homepage.tpl` still contains a newsletter form with `onsubmit="return false;"` — a **UI-only** element with no consent/unsubscribe/anti-abuse backend. It is **not** claimed as an implemented marketing feature; tracked as `G15`/`G16` gap.
- `navigation-links.test.ts` lives under `tests/integration/` and was not included in the `frontend/tests/...` glob above; it was green in the Phase 1 49-file run and is unchanged here.
- No full 166-file Vitest run (timed out at 900 s in an earlier session); this phase used targeted suites.
- `platform/` tests: 2 transient failures in one run, not reproduced twice — flakiness item open.
- `@sparticuz/chromium` is a dev-only dependency used solely for evidence; no runtime/deployment dependency added.

**Features implemented but not verified:** PHP-rendered public pages, WHMCS invoice/currency parity, live product prices (preview catalogue is 9 labelled demo rows), and every provider-dependent surface.

---

## Global verification matrix (this turn)

| Area | Result |
| --- | --- |
| Site generators / link / branding / nav / migration validation | all pass |
| PHP syntax | 838/838 clean on PHP 8.2 WASM (Phase 1 run; no PHP source changed this turn) |
| TypeScript / lint / frontend tsc / tools catalogue | `typecheck`, `lint` clean; `tools:catalog:check` from Phase 1 unchanged |
| Frontend build | ✓ `index-BvpEgZzE.js` / `index-BqJ8IDGd.css` |
| P0 suites | 12 files / 71 tests + 5 files / 36 tests |
| Currency core | 14/14 |
| Chrome/frontend | 3 files / 14 tests |
| `platform/` suite | 876 tests (876/876 on two clean re-runs) |
| Real-browser layout | 7 widths, 0 overlaps |
| Real-browser screenshots | 18/18 renders, 0 console errors, 0 failed requests |
| Browser matrix prior blocker | **RESOLVED** via npm-shipped Chromium; no Playwright CDN needed |

## Standing restrictions (unchanged)

- Financial freeze in force: no live gateway, no live webhook, no quarantined migration released, no production payment setting, no real transaction.
- No production deployment and no claim of production compatibility.
- No live provider activated, no purchase, no live credential.
- One canonical backend; no duplicate feature implementation; `platform/` read-only.
- Nothing deleted; all migrations, data, integrations and existing functionality retained.

## Next entry gate

Phase 4 requires: D1 (done), D4 currency decision, D3 provider sandbox approval, and D2 financial authorisation before any billing/cart/checkout/invoice migration. Phase 3's remaining PHP-rendered verification requires the staging environment in `docs/STAGING-ENVIRONMENT-REQUIREMENTS.md`.
