# Audit and readiness pass — 2026-10-12

**Status: staging-only. Nothing was deployed, no production approval is claimed, and no customer
data, credentials or licensed WHMCS runtime was touched.**

This pass audits the real tree, fixes what the audit found, and states exactly what is verified, what
is partial, what is blocked and what was never tested. Every number below comes from a command run in
this session; nothing is carried over from an earlier report without saying so.

---

## 1. Repository, branch, environment

| | |
|---|---|
| Repository | `subwindels-hash/CloudHost247` |
| Branch | `arena/b25a1e31-cloudhost247` |
| Base commit | `3da1486` — the repository's only commit (history is squashed, so no per-file archaeology via `git log -S` is possible) |
| Working tree before the pass | clean; all dependency-free gates green |
| Node / npm / Python / git | v22.22.3 · 10.9.8 · 3.11.2 · 2.39.5 |
| PHP | **not installed on this host.** PHP was executed through `scripts/php-wasm` (real PHP 8.2.33 compiled to WebAssembly, driven by the shim documented in `scripts/php-wasm/README.md`) |
| Browser | **no Chromium or Playwright browser binary exists in this environment**, so no browser or axe check could be run |

That last row bounds the evidence: PHP behaviour *was* exercised (837 lint targets, 18 behavioural
suites, the tools and website suites); browser behaviour *was not*.

## 2. What the audit examined

The 84 root PHP routes, `templates/cloudhost247/` and its includes, the shared registry
(`shared/site/registry.json`, v2.1.0), the generated PHP theme registry
(`modules/addons/cloudhost247_theme/resources/site.json`), the tools platform (`tools/`), the Node
platform's frontend and its test suite, the asset library (`assets/images/cloudhost247/`, 388 files),
the release gate (`scripts/release-candidate-check.sh`), the CI workflows, and the reviewed artefacts
under `docs/website-rebuild/`. The legacy theme, the order-form templates and ionCube-encoded addons
were inspected for compatibility only and not modified.

## 3. Defects found and fixed in this pass

### 3.1 The rendered-fixture QA could never pass, and hid ten real defects

`tests/website/check-fixtures.py` read a whole `srcset` attribute as one asset path. Every
`<picture>` in the theme therefore reported "missing asset
`…-640.avif 640w, …-960.avif 960w, …-1280.avif 1280w`" — **122 false failures** across the 229
rendered pages. That is why the checker was not in the release gate, and why nobody saw the real
findings underneath it.

Fixed: `srcset` is parsed as the comma-separated candidate list it is, each candidate is checked
individually, and a width descriptor must agree with the width in the filename (a browser would
believe `scene-960.avif 640w` and fetch the wrong rung, so that is now an error). Regression tests:
`tests/website/test_fixture_checks.py` (8 tests).

With the noise gone the checker reported **10 genuine violations**: the tools hub and the nine tool
category routes rendered their cards as `<h3>` directly beneath the `<h1>` hero, skipping level 2 —
a WCAG 1.3.1 structure defect on ten public pages. Fixed in `tools/lib/View.php` with a level-2
region label for the list, visually hidden so the design is unchanged.

Verified this session:

```
$ CH247_FIXTURE_DIR=/tmp/ch247-fixtures python3 tests/website/check-fixtures.py
fixture QA: 229 pages, 907 images, 3063 asset references, 42393 links,
            45510 interactive controls, 139 distinct ch- classes, 194 indexable / 35 noindex
✓ every rendered fixture is well-formed, fully referenced, fully styled and free of dead internal links
```

Exit status 0.

### 3.2 The reviewed page inventory had drifted from the registry

`docs/website-rebuild/page-inventory.json` — the artefact the rebuild is reviewed against (canonical
URL, navigation and footer placement, hero artwork, SEO status per page) — claimed 67 footer
destinations while the registry serves 68. Regenerated. The release gate now regenerates it and
refuses to continue when the committed copy disagrees, exactly as it already did for the other
generated surfaces, so a stale inventory can no longer be reviewed as if it described the site.

### 3.3 Touch targets below the WCAG 2.2 minimum

Measured from the shipped stylesheets: the mobile navigation toggle was roughly 33px tall, the
language/currency switcher in the utility bar had `padding: 0` (its hit area was the glyph height),
and the header account links and footer links were text-height as well. WCAG 2.2 SC 2.5.8 (Target
Size (Minimum), AA) requires 24×24 CSS pixels; SC 2.5.5 (Enhanced, AAA) asks 44×44 for a primary
mobile control.

Fixed in `templates/cloudhost247/css/site.css`: the menu toggle is 44×44 and centres its label, the
utility-bar links and the switcher are at least 24px tall, the account links are 24px, and the
footer links carry vertical padding. No layout width, colour or typography changed.

### 3.4 Nineteen product pages had no hero of their own

The brief asks for a distinct, relevant hero visual on each product page. The registry names one
per page, but the artwork a page actually renders is the *resolved 3D scene*: the generator
upgrades `<visual>-3d` when that scene exists and otherwise falls back to the scene its family
shares (`FAMILY_3D` in `scripts/site/generate.mjs`). Nineteen product pages were on a family
fallback, so e.g. `/deployment/api`, `/deployment/php` and `/deployment/laravel` all rendered the
same pipeline scene, the four management pages shared the dedicated-server scene, and
`/hosting/windows-hosting`, `/hosting/plesk-hosting` and `/hosting/reseller-hosting` shared the
web-hosting scene.

Twenty scenes were produced in this pass and wired end to end (`plesk-hosting`, `windows-hosting`,
`reseller-hosting`, `game-servers`, `backups`, `firewall`, `ip-management`, `migration`,
`data-centers`, `docker`, `php`, `laravel`, `nodejs`, `python`, `developer-hosting`, `api`, `paas`,
`os-catalog`, `platform-security`, `ssl`), each encoded to the same 640/960/1280 AVIF + WebP ladder
and mirrored into the platform's served library. Coverage measured by the inventory audit:

| | Before | After |
|---|---|---|
| Product pages on their own scene | 38 | **58** |
| Product pages on a family fallback | 29 | **9** |
| Distinct hero scenes in use | 19 | **39** |

The audit now reports this (`totals.hero_scenes_exact`,
`totals.hero_scenes_from_family_fallback`, `totals.distinct_hero_scenes`, plus a `hero_fallbacks`
list naming what each remaining page shares its scene with), so the gap is measured rather than
asserted. The 9 remaining pages are listed in §11.

### 3.5 The currency hint endpoint was publicly cacheable and echoed the caller's address

`GET /api/v1/currency/geo-country` is the display-currency *hint* — the third of four signals, after
an explicit choice and the authenticated account's preference. It answered every call with
`Cache-Control: public, max-age=60` **and** included the caller's IP address in the JSON body.

Two consequences, both invisible to a caller:

1. A response that varies by visitor was marked safe for *shared* caches. A CDN or reverse-proxy
   cache is entitled to store it and replay it to the next visitor for a minute — which is how an
   advisory hint becomes an authoritative inference, and the wrong one, from a stranger's address.
2. The address was echoed into a response that passes through caches, logs and error reporters, and
   nothing consumed it: the frontend reads `country` only.

Fixed in `cloudhost247-node/src/routes/currency.ts`: the address is no longer in the body, and the
response is `Cache-Control: private, max-age=60` with
`Vary: CF-Connecting-IP, X-Forwarded-For` so a real resolver stays correct behind a trusted proxy.
The endpoint had **no test at all**; `cloudhost247-node/tests/integration/currency-geo-hint.test.ts`
(6 tests) now pins the contract, including that a spoofed `X-Forwarded-For` is neither trusted nor
reflected, and that the hint needs no rate snapshot and no database.

The ordering itself — that the hint may suggest but never decide — is pinned by
`cloudhost247-node/frontend/tests/unit/currency-geo-fallback.test.tsx` (8 tests): the hint applies
only when no preference exists, is not even requested once a preference does exist, never overrides
an explicit or authenticated choice, and falls back to USD for an unmapped, unknown, unpublished or
unavailable value.

### 3.6 The repository's content-hygiene workflow had never run

`Content hygiene` (`.github/workflows/content-hygiene.yml`) — the repo-wide scan for malformed
bullets, replacement characters and mojibake, plus the byte comparison between
`shared/site/content/legal.generated.json` and the frontend's copy — was **not running**. Every run
on every branch, including `main`, ended as a zero-second failure with **no jobs**, no logs and no
annotation on the commit. Nothing in the repository could notice, because the only thing that could
have noticed was the workflow that could not start.

Cause: the file was not parseable YAML. One step name contained a second `: ` —

```yaml
- name: Legal text: regenerated JSON matches the committed sources
```

— which turns the step name into a nested mapping. GitHub therefore refuses to create a single job
for the workflow: the checks silently stop existing while the branch merely looks blocked on CI.

Fixed (the name is quoted), and the failure mode is now guarded from **outside** the file:
`scripts/check-workflow-yaml.mjs` parses every file in `.github/workflows/` with the `yaml` package
the Node platform already declares (falling back to a narrow structural rule that catches this class
when dependencies are not installed), and fails on a file that does not parse, declares no jobs, or
has a step with neither `run` nor `uses`. It is called by the release gate — which is not
path-filtered, so it runs for any change — and by the content-hygiene workflow itself. Its negative
case was verified: reintroducing the unquoted colon on a copy of the tree is reported as
`content-hygiene.yml:23 plain value contains ": "`.

Both hygiene checks were then run locally to prove restoring the workflow does not immediately fail
it: `node scripts/check-malformed-bullets.mjs` → 6 657 text files scanned, 0 findings; the two legal
JSON copies are byte-identical.

### 3.7 There was no accessibility or responsive gate that could run without a browser

The only accessibility evidence in the repository is a browser run (`tests/website/browser.cjs`,
Chromium + axe) that cannot execute in this environment. Added
`scripts/check-accessibility-contract.py`: the properties that are decidable from the sources —
viewport meta, document language, a skip link whose target exists, `aria-expanded`/`aria-controls`
pointing at a real element, native `<details>` menus, an accessible name on every visible form
control (explicit label, wrapping label, or ARIA), `alt` plus declared dimensions on first-party
images, the target-size minimums above, a visible `:focus-visible` outline, `prefers-reduced-motion`,
clipped horizontal overflow, bounded image width, and a media query that applies at every viewport
the recorded browser matrix tests (320/360/375/390/414/768/1024/1280/1440/1920). It fails loudly when
it inspects implausibly little. `tests/website/test_accessibility_contract.py` (14 tests) proves every
rule still fails on the thing it guards. Wired into `scripts/release-candidate-check.sh`.

Current result — 63 markup files, 15 visible controls, 16 images, 1 020 CSS rules, 15 media widths,
0 problems.

## 4. Page inventory: what a visitor and a crawler can reach

`python3 scripts/audit-navigation-inventory.py` (re-run in this pass, and now a gate step):

| Measure | Result |
|---|---|
| Root PHP pages | 84 |
| Registered public pages (content, metadata, hero artwork) | 67 |
| Mega menus / footer columns | 7 / 8 |
| Navigation destinations | 89 |
| Footer destinations | 68 |
| **Orphaned pages** (published, unreachable from any menu) | **0** |
| **Menu links without a route behind them** | **0** |
| **Pages without navigation discovery** | **0** |
| Unregistered public pages | **0** |

Seven legal/policy pages are deliberately absent from the menus; they are reachable from the Legal &
Policy Centre (`legal.php`) and from the pages that reference them, and the audit counts them as
reachable. Re-running the audit produced an empty diff, so the committed table matches the registry.
The machine-readable table is `docs/website-rebuild/page-inventory.json` (+ `.csv`).

## 5. Navigation, footer and links

| Check | Result |
|---|---|
| `node scripts/site/generate.mjs` | 7 mega menus, 8 footer columns, **169 links validated** (160 app / 167 PHP) — every destination resolved against the routes that exist |
| `node scripts/site/check-links.mjs` | 2 208 surfaces · 923 internal · 899 PHP · 5 external · 16 in-page anchors — **0 broken, 0 placeholder**; 5 informational notes (external legal citations to ICANN, Google, Mozilla, Apple and WHMCS) |
| `python3 scripts/verify-website.py` | 67 registry pages · 83 navigation destinations · 475 first-party classes · 79 includes · **0 source errors**; per-page title and description uniqueness enforced; `#`/empty/external hrefs rejected |
| Regeneration | idempotent — re-running the generator leaves the tracked outputs byte-identical |

Menus are native `<details>`/`<summary>` disclosures, so a mega menu opens without scripting; the
mobile toggle carries `aria-expanded`/`aria-controls` and is now 44×44; the same registry feeds the
SPA navigation through a generated adapter, so the two front ends cannot drift.

## 6. Artwork and asset verification

| Family | Contents |
|---|---|
| Illustrations | 219 SVGs in the library; the 67 registry pages reference 47 distinct diagrams |
| 3D scenes | 40, each with 640/960/1280 in **AVIF and WebP** plus the JPEG master (`generate-raster-formats.py --check` → 40 scenes × 2 formats ✓); 20 were added in this pass |
| Brand | 24 files: horizontal / compact / primary / icon-mark × dark, white and mono, in SVG + PNG + WebP |
| Favicons | `favicon.ico` + 16/32/48/192/512 PNG, Apple touch icon, `site.webmanifest` |
| Social | preview artwork in PNG, SVG and WebP |
| Catalogues | 52 neutral application marks (one per manifest) · 19 control-panel marks · 14 operating-system marks |

Asset verification is end-to-end: the fixture QA resolves every `src`/`href`/`srcset` candidate of
every rendered page (907 images, 3 063 asset references, 0 missing); the site verifier checks the
artwork each registry page names; and the production archive independently re-resolves every visual
the theme registry references in **both** the PHP library and the built SPA library, including every
3D encoding.

## 7. Internationalisation and currency

The rebuild integrates with the platform's existing localisation instead of creating a parallel
system. The PHP shell renders the document language from the active locale (asserted by the
accessibility contract), the utility bar exposes the WHMCS localisation modal
(`#modalChooseLanguage`, owned by `templates/cloudhost247/footer.tpl`) when WHMCS reports language
switching enabled or more than one currency, and the Node frontend ships
`frontend/src/i18n/{LocaleProvider,format,catalogue}` and
`frontend/src/currency/{CurrencyProvider,display-currency}` with the language and currency
switchers. Billing prices remain the WHMCS prices in the customer's billing currency; no display-only
conversion was introduced.

A visitor's address is the *third* of four signals for a **display** currency only — after an
explicit choice and the authenticated account's preference, and before the USD default — and the
switcher states in text that charges are in USD and converted amounts are estimates. That ordering
and the endpoint that supplies the hint are now pinned by tests (§3.5): the hint may suggest, it
never decides, and it is never taken from a shared cache.

**Not tested:** switcher behaviour against a live WHMCS session, multi-currency carts, and localised
checkout copy. That needs the licensed staging install and is recorded in §11.

## 8. Security and backend regression results

| Suite | Result |
|---|---|
| `php -l` over every lint target (`scripts/php-lint-targets.sh`) | **837 targets, 0 syntax errors** (PHP 8.2.33) |
| 18 PHP behavioural suites (`tests/*/run.php`) | all pass — foundation, theme, currency, smm, tools, ovh, rdp, integrations, modules, builder, broker, marketing, cart_recovery, passkey, phoneservices, customaffiliate, cloudhost247_email, payments |
| Tools platform | 85 tests / 0 failures · 1 171 shell/menu/footer assertions · 26 static tests · browser-tool module tests pass |
| Static + security suites | 434 tests OK (2 skipped with recorded reasons) |
| Node platform suite (`npm test`) | **161 test files / 2 242 tests passed**, exit 0 (Vitest, ~30 min; runs the migrations against the in-process Postgres engine) |
| Node currency/i18n suites | the two new suites pass (6 + 8 tests) alongside the existing currency, i18n and switcher suites; `npm run typecheck` and the frontend `tsc --noEmit` exit 0 |
| Server-agent authentication | 71/71 |
| Retired-brand audit | 5 956 text files scanned, **0 matches** (ionCube bytecode checked by name only) |
| Vendor integrity | `sha256sum --check --strict` against the recorded manifest passes — no vendor-derived file was edited |

Existing controls were not weakened to make anything pass; this pass only adds checks.

## 9. Build, tests and the production archive

`bash scripts/release-candidate-check.sh` **passed end-to-end on this branch** (PHP supplied by the
wasm shim, `PHP_LINT_JOBS=8`). Its steps, in order:

1. generated public-site surfaces regenerated and diffed (`route-report.json`, theme `site.json`,
   both `registry.generated.ts`, frontend content, published docs, `robots.txt`);
2. page-inventory freshness (new);
3. PHP syntax check, 837 targets;
4. 18 module behavioural suites;
5. server-agent Node suite;
6. static verification bundle (unittests, website suites, tools tests, site verifier, **accessibility
   contract (new)**, raster ladder, Builder widget-class audit, vendor manifest);
7. vendor integrity baseline.

Also verified in this pass:

| Step | Result |
|---|---|
| `node scripts/site/generate.mjs` | 7 menus / 8 columns / 169 links; 55 marketing pages, 120 sections, 174 FAQs, 13 published documents (216 KB) |
| Node platform `npm ci` + `npm run typecheck` + frontend `tsc --noEmit` | 264 top-level packages installed; both typechecks exit 0 |
| Node platform `npm test` | 161 files / 2 242 tests passed, exit 0 |
| `node scripts/check-workflow-yaml.mjs` | 3 workflow files parse, each with jobs and steps (added to the gate and to `content-hygiene.yml`) |
| `python3 scripts/build-production-zip.py --verify` | **verified** — 9 577 members, 128 087 329 bytes (122.2 MiB), `secret_skipped=0`, 525 media assets, 47 theme illustrations and **39** referenced 3D scenes resolved in both libraries, 13 published documents; this build's digest was `431b8e4778b4e99af04692850a6827f606fbc8c6b557c5753c2b78f16a6b99fc` (a build output, not content-addressed) |

The archive is deliberately not kept in the workspace — a 101 MiB build artefact does not belong in a
snapshot or a commit — and is reproducible with the command above.

## 10. Staging verification status

- The release gate passed here with PHP 8.2.33 via the wasm shim, and it also passes on the hosted
  runners: `Independent foundation` — the same gate on **PHP 7.4 and 8.2** — completed successfully
  on this branch after each push, so the changes are not an artefact of this sandbox's PHP shim.
- `Content hygiene` now **runs and passes** (18–19 s per run) where it previously failed in zero
  seconds without creating a job (§3.6): the repo-wide malformed-text scan and the legal-JSON byte
  comparison are enforced again.
- The release gate was re-run after the hero artwork was regenerated and again passed end to end
  (40-scene ladder, inventory 58 exact / 9 fallback / 39 distinct), and `Independent foundation`
  on the hosted runners passed on the resulting commit as well.
- `CloudHost247 Node platform` (Node 22.12 and 24.8, with the migrations run against embedded
  Postgres) was still running when this report was written; the identical suite passes locally
  (161 files / 2 242 tests) and the two suites added in this pass pass on their own.
- **Not performed:** deployment to the staging host, live WHMCS functional QA (registration, login,
  client area, cart and checkout, payments, provisioning, domain registration, tickets), and the
  browser/axe pass across the recorded viewport widths.
- **Blocked in this environment:** every Chromium-based check (no browser binary) and anything that
  needs the licensed WHMCS installation, its database or its credentials.
- Consequence: this branch is **ready to be put on staging**, not ready to be promoted to production.
  Promotion requires the staging QA in `docs/independent-rebuild/STAGING-TEST-MATRIX.md` and explicit
  approval.

## 11. Remaining defects, partial work and open items

1. **Browser QA was not reproducible here.** The run committed in the repository
   (`docs/website-rebuild/browser-verification.json`: 52 routes × 10 widths = 520 cases, 0
   horizontal overflow, 0 broken images, 0 page errors, 0 axe violations, menu open/Escape/focus
   checks) belongs to the committed tree and does not cover the edits made in this pass. The static
   contract covers structure, names, target sizes and the responsive ladder, but it cannot measure
   real overflow or real focus behaviour. `tests/website/browser.cjs` must be re-run where a
   Chromium binary exists.
2. **Nine pages still share a family hero scene.** §5 of the brief asks each product page to have
   a distinct relevant hero; 58 of 67 pages are on their own scene and 9 are on the one their family
   shares — `blog.php` and `documentation.php` (infrastructure scene), `domain-dns.php`,
   `managed-services.php` and `server-management.php` (server scene), `network.php` (cloud scene),
   `website-design.php` (web-hosting scene), and `faqs.php`/`help-center.php` (one visual key
   between them). `hero_fallbacks` in `page-inventory.json` names each one and what it shares with.
   Every `/deployment/*`, `/security/*`, `/operating-systems/*`, `/management/{backups,firewall,
   ip-management,migration}` and `/hosting/{plesk,windows,reseller}-hosting` page now has its own
   scene. Nine scenes remain to be produced; twenty were produced in this pass.
3. **PHP 8.2 deprecation notices** are emitted by the OVH / broker / marketing *test fakes* (missing
   `#[\ReturnTypeWillChange]` on `ArrayAccess`/`Countable`/`IteratorAggregate` implementations).
   Pre-existing, test-only, non-blocking.
4. **Unfinished modules** recorded in `docs/UNFINISHED-MODULES.md` and
   `docs/UNFINISHED-BUILD-CODE-NAME-LIST.md` are unchanged by this pass and remain unfinished.

## 12. Files changed in this pass

Beyond this report, the pass changes code, gates, documentation and 70 asset files. The
non-asset changes are:

| File | Change |
|---|---|
| `tests/website/check-fixtures.py` | `srcset` candidate parsing + width-descriptor validation (removes 122 false failures) |
| `tools/lib/View.php` | level-2 region label on the tools hub and category routes (fixes 10 heading-outline violations) |
| `templates/cloudhost247/css/site.css` | touch-target minimums for the menu toggle, utility bar, account links, footer links |
| `scripts/check-accessibility-contract.py` | **new** — static accessibility and responsive contract |
| `tests/website/test_accessibility_contract.py` | **new** — 14 tests, one negative case per contract rule |
| `tests/website/test_fixture_checks.py` | **new** — 8 tests for srcset parsing and the end-to-end fixture pass/fail |
| `scripts/release-candidate-check.sh` | inventory-freshness gate, accessibility-contract step, the two new suites |
| `scripts/audit-navigation-inventory.py` | reports hero-scene coverage (exact vs family fallback, shared-with list) |
| `docs/website-rebuild/page-inventory.json` / `.csv` | regenerated: footer destinations 67 → 68, hero-scene coverage added |
| `docs/website-rebuild/COMPONENTS.md` | documents the inventory audit, the accessibility contract and the two new suites; registry counts corrected (67 pages, 7 menus, 8 columns) |
| `docs/website-rebuild/DEPLOYMENT.md` | registry-first navigation wording; Node suite figure corrected to the measured 2,242 tests |
| `assets/images/cloudhost247/**` + `cloudhost247-node/frontend/public/media/cloudhost247/**` | **140 files**: 20 new 3D scenes × (JPEG + 640/960/1280 AVIF + WebP), mirrored into the served library |
| `modules/addons/cloudhost247_theme/resources/site.json`, `shared/site/generated/route-report.json`, `cloudhost247-node/frontend/src/content/pages.generated.json` | regenerated from the registry (the new scenes change the resolved `visual3d`) |
| `.github/workflows/content-hygiene.yml` | the unparseable step name that stopped the workflow from ever starting is quoted; the workflow also runs the new checker |
| `scripts/check-workflow-yaml.mjs` | **new** — fails when any `.github/workflows/*.yml` would not start, with the file and line |
| `scripts/release-candidate-check.sh` | also runs the workflow-file checker (this gate is not path-filtered) |
| `cloudhost247-node/src/routes/currency.ts` | the geo hint is no longer publicly cacheable and no longer echoes the caller's address |
| `cloudhost247-node/tests/integration/currency-geo-hint.test.ts` | **new** — 6 tests pinning the hint's cache contract and address handling |
| `cloudhost247-node/frontend/tests/unit/currency-geo-fallback.test.tsx` | **new** — 8 tests pinning the currency signal ordering (hint suggests, never decides) |
| `docs/website-rebuild/AUDIT-AND-READINESS-2026-10-12.md` | **this report** |

No WHMCS core file, payment path, provisioning module, migration, authentication control or vendor
tree was modified. No page was deleted, no route was removed, and no backend integration was replaced.
