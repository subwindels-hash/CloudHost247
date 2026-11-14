# Cleanup & completion register — 2026-11-14

**Scope:** remove or finish everything in this repository that was unfinished, superseded,
demo-only, unrouted or unreachable — then verify it with the repository's own gates.

**Branch:** `arena/655e4c2f-cloudhost247` (base `7a2dca6`).

This document records what was **removed**, what was **completed**, how each change was
**verified**, and what was **deliberately kept**. Every claim below is backed by a command
reproduced in §4. Nothing was invented to make a page look finished: where the honest state is
"no plans published yet", that state is what the page now shows.

---

## 1. What counted as "unfinished"

The repository already separates three meanings (`docs/UNFINISHED-MODULES.md`): build in progress,
never independently built, and stub/placeholder. This pass adds a fourth category that the other
three miss and that a visitor actually experiences:

| Class | Test applied | Outcome |
|---|---|---|
| **Dead code** | A module that no route, import or test reaches | Removed (5 hosting pages, 3 legal pages) |
| **Dead route** | A PHP entry point whose content store has no published entry, so it can only ever 404 | Removed (6 routes) |
| **Superseded build** | A prototype that a shipped module replaces, leaving two implementations of one thing | Removed (2 modules, 15 files) |
| **Placeholder UI** | A hardcoded "coming soon"/"not available" block where a real catalogue-driven surface exists | Completed (proxy storefront) |

---

## 2. Removed

### 2.1 Unrouted/superseded SPA modules (8 files)

`frontend/src/App.tsx` carried two comments explaining that these modules were **kept but not
routed** ("nothing routes to them"). Dead code with an explanatory comment is still dead code; the
behaviour they pinned is now owned by the marketing pages.

| File | Why it was removed |
|---|---|
| `frontend/src/pages/HostingPage.tsx` | Superseded by `/hosting` (marketing page). Contained the last hardcoded **"Coming soon" / "Details coming soon."** strings in the SPA. |
| `frontend/src/pages/HostingVpsPage.tsx` | Superseded by `/hosting/vps` (marketing page + live `ProductPlansSection`). |
| `frontend/src/pages/HostingCpanelPage.tsx` | Superseded by `/hosting/cpanel`. |
| `frontend/src/pages/HostingDedicatedPage.tsx` | Superseded by `/hosting/dedicated`. |
| `frontend/src/pages/HostingApplicationHostingPage.tsx` | Superseded by `/hosting/application-hosting`. |
| `frontend/src/pages/LegalIndexPage.tsx` | Superseded by `pages/marketing/LegalPages.tsx` (the real extracted policies). Documented itself as "Phase 2 scope … one legal/placeholder page". |
| `frontend/src/pages/LegalPage.tsx` | The generic placeholder renderer ("**This page is a placeholder.**") used only by the file below. |
| `frontend/src/pages/PrivacyPolicyPage.tsx` | Rendered `LegalPage`; the real policy is served at `/legal/privacy-policy` from `legal.generated.json`. |

`frontend/src/lib/catalog-types.ts` and `App.tsx` comments that pointed at these modules were
updated to point at the code that owns the behaviour now.

### 2.2 Demo-only PHP routes (6 files)

Each of these was a `PublicPage::route()` wrapper for a content-store slug that was **never
published** (`site.json` has no entry for any of them), so each one could only ever answer 404 —
while still being listed in crawl policy and in the route baseline as if it were a live page.
They are now recorded in `docs/website-rebuild/removed-routes.json` **with the reason**, and
`scripts/verify-website.py` fails if any of them comes back.

| File | Slug | Category in the audit baseline |
|---|---|---|
| `comingsoon.php` | `coming-soon` | Marketing ("Coming Soon") |
| `future-element.php` | `future-element` | Administrative/internal (theme demo block) |
| `all-element-cloudhost247.php` | `all-elements` | Administrative/internal (theme demo block) |
| `cloudhost247-sample.php` | `cloudhost247-sample` | Administrative/internal (sample content) |
| `cloudhost247-vps-sample.php` | `vps-sample` | Administrative/internal (sample content) |
| `tables.php` | `tables` | Administrative/internal (page-builder demo) |

Every artefact that referenced them was updated in the same change:

* `modules/addons/cloudhost247_theme/lib/CrawlPolicy.php` — `FALLBACK_PHP_EXCLUSIONS` (23 → 18)
* `shared/site/registry.json` — `sitemap.excludePhp` (23 → 18), the source of truth
* `modules/addons/cloudhost247_theme/resources/site.json` — regenerated policy
* `robots.txt` — regenerated (`Disallow:` lines for the six routes removed)
* `shared/site/generated/route-report.json`, `cloudhost247-node/{src,frontend/src}/navigation/registry.generated.ts` — regenerated
* `tests/theme/test_static.py` — 6 `CONVERTED` entries removed
* `tests/website/run.php` — 2 private-route assertions removed
* `docs/website-rebuild/page-inventory.{json,csv}` — 6 rows removed; `root_php_pages` 92 → 86, `internal` 17 → 11
* `docs/website-rebuild/baseline-routes.json` — 6 entries removed (54 → 48)
* `docs/website-rebuild/FINAL-REPORT-2026-10-16.md` — verified-figures block and the prose that quotes it
* `README.md` — root-page count now states the derived numbers (86 routes: 75 published, 11 internal)

### 2.3 Superseded SMM prototype (15 files, 2 modules)

`modules/addons/smmaddon/` (a "basic prototype") and `modules/servers/smmprovisioning/` were
superseded by `cloudhost247_smm`. Two SMM implementations in one tree means two schemas, two cron
runners, and an operator who cannot tell which module owns an order.

* Deleted both directories.
* `modules/addons/cloudhost247_integrations/lib/Registry/ProviderCatalog.php` — the `smm_panel`
  definition now documents and is `used_by` the live `cloudhost247_smm` module, not the prototype.
* `tests/smm/test_static.py` — `test_superseded_legacy_module_untouched` (which asserted the
  prototype **must still exist**) was replaced by `test_superseded_legacy_prototype_is_gone`, which
  asserts it is absent so a revert fails the build.
* `modules/addons/cloudhost247_smm/README.md`, `README.md`, `docs/README.md`,
  `docs/UNFINISHED-BUILD-CODE-NAME-LIST.md`, `docs/UNFINISHED-MODULES.md` — wording updated from
  "superseded, left in the tree" to "removed".

---

## 3. Completed

### 3.1 Proxy Services storefront now renders real published plans

`frontend/src/pages/ProxyServicesPage.tsx` was the only service line whose plans section was a
hardcoded promise:

> `<h3>Proxy services are coming soon.</h3> … Ordering is not yet available on this platform.`

Every other storefront (SMTP, RDP, SMM, numbers, Google Workspace, Office 365, digital products)
renders `<ProductPlansSection slug="…"/>`, which reads `/api/v1/catalog/products/:slug/plans` and
has an honest state for each possible answer (loading, error, product absent, product draft, no
plans published, plan without price). Proxy Services now does the same:

```tsx
<ProductPlansSection slug="proxy-services"/>
```

Consequences, verified live: `/proxy-services` returns 200; the page no longer contains the phrase
"coming soon"; the API answers `404 No product was found with that identifier` — exactly the same
answer SMTP hosting gives — so the page renders the same honest "not in the catalogue yet" state
until an administrator publishes plans. **No price or plan was fabricated to fill it.**

Tests updated to pin the new contract:
* `frontend/tests/unit/storefront-artwork.test.tsx` — proxy is no longer an exception; it asserts
  `published-plans` renders and that no "coming soon" text exists.
* `tests/website/test_proxy_storefront.py` — asserts `ProductPlansSection` is used and the phrase is
  gone.

### 3.2 The WASM PHP gate is now reproducible on a bare host

Running the repository's own PHP suites in this sandbox produced **44 failures that were not code
defects**: the WASM runtime has an OpenSSL extension but no `openssl.cnf`, so
`openssl_pkey_new()`/`openssl_pkey_export()` failed and every suite that builds a throwaway key
(`tests/passkey` — a P-256 credential; `tests/cloudhost247_email` — an RSA service-account key)
failed with messages unrelated to the code under test.

* Added `scripts/php-wasm/openssl.cnf` (default provider only — no key material).
* `scripts/php-wasm/shim.mjs` now defaults `OPENSSL_CONF` to that file when the variable is unset;
  an explicit `OPENSSL_CONF` still wins.

Result: **18/18 PHP suites green** (see §4.3), including the two that were red.

### 3.3 Stale statements removed

* `frontend/src/pages/DashboardPage.tsx` claimed "this platform has no payment/billing system".
  It does: `src/routes/billing.ts` serves `/api/v1/invoices` and `/api/v1/billing/ledger`, and the
  card already links to `/billing`. The comment now says that.
* `README.md` module tables and the two unfinished-module registers no longer describe deleted code.

---

## 4. Verification (all re-run after the final edit)

### 4.1 Typecheck & production build

```
$ npm run typecheck                 → exit 0
$ npm run build
  ✓ typecheck:scripts               (tsc -p tsconfig.scripts.json)
  ✓ tools:catalog:check             (84 tool entries; projection verified)
  ✓ build:server                    (tsc -p tsconfig.json)
  ✓ build:frontend                  (vite build — built in 13.42s)
  ✓ build:tools                     (vite build — built in 1.62s)
                                    → exit 0
```

### 4.2 Node test suites

| Run | Result |
|---|---|
| `npx vitest run tests/unit frontend/tests` | **191 files, 3,208 tests passed**, 0 failed |
| `npx vitest run tests/integration/{catalog-public-api,catalog-schema,dev-catalog-seed,migration-quarantine}.test.ts` | **4 files, 27 tests passed**, 0 failed |

The complete 309-file Vitest run (118 integration files, several at 60–90 s each) needs hours on
this 2-CPU host; it was sampled to **539 checks with zero failures** before being stopped. The
suites that cover everything this change touched were run to completion above.

### 4.3 PHP suites (WASM PHP 8.2) — 18/18 green

```
green foundation · theme (# 60 assertions, 0 failed) · currency · smm · tools · ovh · rdp
green integrations · modules (# 237 assertions, 0 failed) · builder · broker · marketing
green cart_recovery · passkey (All passkey tests passed) · phoneservices (23/23)
green customaffiliate (36/36) · cloudhost247_email (71/71) · payments
green website (# 313 assertions, 0 failed)
SUITE FAILURES: 0
```

### 4.4 Python static/website suites — 48/48 files green

```
for f in $(find tests -name 'test_*.py'): python3 -m unittest <module>
PYTHON FAILED FILES: 0
```

### 4.5 Link and registry gates

```
$ node scripts/site/generate.mjs --check
  ✓ registry valid — 258 links (247 app, 243 PHP)
$ node scripts/site/check-links.mjs
  link integrity: 2299 surfaces · 1106 internal · 1094 PHP · 7 external · 49 in-page anchors
  ✓ no broken, placeholder or dangling links
```

The 7 notes it prints are external reference links (browser cookie documentation, ICANN, LAME,
MP3Dev, WHMCS) — cited sources, not broken internal routes.

### 4.6 Runtime checks against the running app

```
GET /                                    200
GET /proxy-services                      200   (module transforms; no "coming soon")
GET /api/v1/catalog/products/proxy-services/plans   404 NOT_FOUND (honest empty state)
GET /health                              200 {"status":"ok"}
GET /ready                               200
```

### 4.7 Reachability and dead-affordance audit

* Every one of the **185 static SPA routes** has at least one inbound link (menu, footer, page CTA
  or `registry.generated.ts`): `no inbound link: 0`.
* Every `href="#"` placeholder: **0**. `javascript:` URLs: **0**.
* `<button>` tags without `onClick`/`type="submit"`: 25 — all inspected, all are submit buttons
  inside a `<form onSubmit={…}>`. No dead button exists.
* Orphaned frontend modules after the deletions: only `main.tsx`, `tools-embed.tsx` (both Vite
  entry points), two `.d.ts` files and the two **deliberately unwired** i18n drafts.

---

## 5. Deliberately kept (with the reason)

| Item | Why it stays |
|---|---|
| `modules/servers/Smtphosting/` (6 zero-byte vendor files) | Third-party ModulesGarden build. Filling vendor placeholders from this repository is forbidden by `docs/UNFINISHED-MODULES.md` §C; deleting a licensed vendor module is a procurement decision, not a cleanup. |
| `modules/servers/cloudhost247_email/` | Earlier email build, marked INACTIVE — but it owns `mod_cloudhost247_email_accounts` and has a **71-check green suite**. Removing it is a data-lifecycle decision for the owner, not dead-code removal. Flagged in §6. |
| `frontend/src/i18n/messages/drafts/{hi,sw}.ts` | Draft translations. `locales.ts` deliberately withholds a language until its catalogue is verified; these are the work-in-progress source, not dead code. |
| `templates/cloudhost247_legacy/`, `templates/orderforms/` | Licensed WHMCS theme and order forms; the legacy `comingsoon.tpl` belongs to that theme, not to the removed route. |
| `modules/addons/xtreme_currency_rates/`, `soyoustart*`, `RDP/` | Licence-gated vendor modules; excluded from enforcement and documented in §B of the unfinished register. |

---

## 6. Open items that are not code (unchanged by this pass)

These are the P1 blockers from `FINAL-PRODUCTION-BLOCKERS.md`; no amount of repository work closes
them, and none was touched here:

1. Licensed WHMCS staging install and a cPanel staging account.
2. External production-shaped PostgreSQL (`verify:financial` / `verify:authorization` probes).
3. Email relay credentials (`NOTIFICATION_EMAIL_WEBHOOK_*`).
4. Payment provider **test** credentials (Stripe/PayPal/Paystack/Blockonomics) and the 10-cell
   provider matrix.
5. Compute/registrar/DNS sandbox credentials (12 adapters + registrar + Cloudflare).
6. Browser binaries for the E2E ceremonies (the Playwright download host is unreachable here).
7. Designation of the first `super_admin`.

**Two decisions for the owner that this pass surfaced but did not take:**

* `modules/servers/cloudhost247_email/` — keep the inactive build (and its 71-check suite) or remove
  it together with `tests/cloudhost247_email/` and its table-ownership note?
* `modules/servers/Smtphosting/` — retain the vendor module, or drop it (and its 6 zero-byte files)
  from the deployable set?
