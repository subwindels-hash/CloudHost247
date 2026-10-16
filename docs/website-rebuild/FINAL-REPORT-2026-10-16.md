# CloudHost247 — final report (§26)

**Date:** 2026-10-16
**Branch:** `arena/eb372481-cloudhost247` (based on `main` @ `48350fe`)
**Pull request:** [#86](https://github.com/subwindels-hash/CloudHost247/pull/86) — base `main`, **draft/staging only**
**Deployment state:** **not deployed.** Nothing in this branch has been pushed to a server, and no
production or staging install was touched. §24's "staging-only" requirement is met by the branch and
the PR; a deployable archive exists and verifies (§9) but has not been uploaded anywhere.
**Evidence:** `bash scripts/release-candidate-check.sh` → **exit 0**, 591 passing checks, log kept out
of the repository. Every number below comes from that run or from the command named beside it.

This report covers the work on this branch. The repository-wide audit, the design system, the
homepage, the mega menu, the footer, the page standardisation, the asset library, the catalogues, the
tools, the i18n work and the SEO pass were carried out in earlier passes on earlier branches and are
recorded in `docs/website-rebuild/AUDIT-AND-READINESS-2026-10-12.md`, `docs/website-rebuild/FINAL-REPORT.md`
and `docs/ACCEPTANCE-CRITERIA.md`. What follows is what this branch changed and what it verifies.

---

## 1. What this branch set out to do, and why

The brief's §22 sets the acceptance bar for the rebuild: **0** broken internal links, empty hrefs, `#`
placeholders, missing assets, broken canonicals, missing navigation destinations, fake claims and
retired branding — and §26 requires the claim to be backed by checks that actually ran.

Three of those checks did not exist or could not fail, and one of them was actively harmful. Each of
the four findings below was found by reading the artefact rather than the source, and each is fixed
with the check that keeps it fixed.

## 2. Finding 1 — nothing rendered the site, so nothing audited the site

`tests/website/check-fixtures.py` audits the HTML a visitor and a crawler actually receive: heading
outline, duplicate ids, image ladders, dead internal links, the canonical address of every indexable
page. It reads rendered fixtures, and **no gate rendered them**. `scripts/check-hero-render.py` was
invoked with a bare note and passed when nobody had rendered anything. A check that is skipped is not
a check.

**Fixed.** `scripts/verify-rendered-site.sh` renders all 229 published pages through the shipped
Smarty components using either a native `php` or the repository's own WebAssembly interpreter, then
runs both audits. It is in the gate. Smarty is obtained only with `--fetch`, from a pinned URL, and
its tarball's SHA-256 is verified before extraction; a mismatch exits 2. Exit 2 ("Smarty absent") is a
**named skip** in the gate with the one command that resolves it — never a pass, and never a failure
of a check that did not run.

```
fixture QA: 229 pages, 907 images, 3063 asset references, 42393 links, 45510 interactive controls,
            139 distinct ch- classes, 194 indexable / 35 noindex, 194 canonical addresses
```

## 3. Finding 2 — canonical addresses were checked for presence, never for value

A canonical that names a page the site does not serve, a second origin, a robots-disallowed URL, or
that two pages share, is worse than a missing one: the crawler consolidates onto a 404 and the ranking
signal is discarded, with nothing in the log.

**Fixed.** `tests/website/check-fixtures.py` now applies eight named rules — exactly one canonical per
indexable page, absolute, single origin, no fragment, no trailing slash, the target is a rendered page,
the target is not disallowed by the crawl policy, and it agrees with `og:url` and the structured-data
URL — plus no two indexable pages claiming the same address. `tests/website/test_fixture_checks.py`
gained a negative case per rule: 16 → **23 tests**, all passing.

Measured on the rendered tree: **194 canonical addresses, all unique, all resolving, none blocked.**

## 4. Finding 3 — the page inventory did not cover most of the pages

`docs/website-rebuild/page-inventory.{json,csv}` had 84 rows: the repository's root `*.php` files. The
tools surface and the routes the licensed platform serves were in the navigation and in the sitemaps
and in no row at all.

**Fixed.** 255 rows carrying the fields the brief asks for, with `route_owner` and `test_status`
recording which runtime serves each route and which check covers it:

| field | meaning |
|---|---|
| `path`, `canonical_url`, `page_title`, `category`, `template` | the page |
| `route_owner` | `cloudhost247-theme` 67 · `tools-front-controller` 265 · `internal` 17 · `whmcs-core` 7 |
| `implementation_status` | published · published tool route · platform signpost route · redirect alias · platform entry point · internal · unregistered |
| `test_status` | the checks covering the route, by id, with the two that need a browser or a licensed install named as **blocked** rather than omitted |

Six defect classes, all **0**, from a run with `--strict`:

```
ORPHANED PAGES 0 · MENU LINKS WITHOUT PAGES 0 · PAGES WITHOUT NAV DISCOV. 0
UNREGISTERED PUBLIC PAGES 0 · DANGLING REDIRECTS 0 · DUPLICATE CANONICALS 0
```

The last two are new on this branch, and they close the failure mode the old rows could not see: a 301
alias whose target is not a page, and two pages naming one canonical address.

## 5. Finding 4 — the tool-surface guard was wrong, and it made the site worse

This is the one worth reading.

**What was built.** The Tools mega menu and the footer's Tools column are enriched at runtime from the
platform's live catalogue (`GET /api/tools/navigation`), and `templates/cloudhost247/js/site.js`
resolves every anchor it appends against *this* origin. A tool the platform advertises and this shell
cannot answer would therefore be a 404 on a customer-facing page — and no static link audit can see
it, because the anchor does not exist until the browser makes it. So the first commit on this branch
projected the paths the shell serves into the theme registry, published them to the page, and filtered
the live catalogue against them, failing closed.

**Why it was wrong.** The projection was derived from `Catalog::resolve()` alone — the native
catalogue. It concluded that `/tools/business-tools`, `/tools/ip-lookup`, `/tools/spf-checker`,
`/tools/subnet-calculator` and `/tools/json-tools` were unserved, recorded about two dozen routes as
`reachable: false`, and pinned each exclusion as correct in a new test suite.

**Measured against the front controller instead of one call, every one of them answers.** `tools/index.php`
resolves through **two** catalogues and treats a redirect as an answer:

1. `Catalog::resolve()` over `tools-public.json` renders the working tool;
2. when that returns nothing, `Theme\ToolsSite::resolve()` over `tools.json` renders an honest
   **signpost** — the tool's summary, the sentence that it runs in the platform application, and a link
   into it — and answers a `legacyPaths` alias with a **301** to the tool's canonical path.

So the filter did not expose broken links. It **removed 24 working menu links and 4 working footer
links from every PHP page**, and the suite that shipped with it asserted the removals were correct.

**Fixed, and the guard removed.** 265 paths, all resolving: 135 native, 130 contributed by the theme
projection (29 signposts, 101 redirect aliases), with **nothing in the projection 404ing** and
**nothing answerable left out**. The browser-side filter is gone on purpose: publishing the list cost
**9,149 bytes of attribute on every page — 9,818 bytes gzipped against 6,819 without, 44% of the
homepage's compressed transfer size** — to prevent a redirect on a site whose own footer links already
resolve. What it was standing in for is now *measured*, in the gate, by

```
tests/website/check-tools-resolution.php
→ tools resolution: 257 derivable, 265 published
→ ✓ every path the shell answers is published, and every path published is answered
```

which resolves the whole surface through the real resolvers and reports **both** directions: a path
published but unanswered (a 404 added to every page) and an answered path withheld (a working link
dropped from every page). The homepage is back to 36,392 bytes / 6,809 gzipped.

## 6. Tests added or changed

| suite | tests | what it pins |
|---|---|---|
| `tests/website/test_tools_surface.py` | 17 | the projection matches an independent Python derivation; every path the theme projection can answer is inside it; the resolution check exists and is wired into the gate; the served set is not shipped to the browser; the footer strip is a deliberate mix of working pages and signposts |
| `tests/website/test_page_inventory.py` | 18 | the brief's fields, the closed vocabularies, the three route families, redirect aliases canonicalising to their target, signposts saying they are signposts, both new defect classes |
| `tests/security/test_release_gate_static.py` | 23 | the gate runs the rendered-site audit; a missing Smarty is a named skip and never a pass; the Smarty download is pinned and digest-verified; the render script runs both audits **and** the tool-surface resolution |
| `tests/website/test_fixture_checks.py` | 23 | one negative case per canonical rule |

Every rule has a negative case, and the suites were run in isolation as well as inside the gate.

## 7. Full verification

`bash scripts/release-candidate-check.sh` → **exit 0**, and the same script runs in CI on both PHP legs
(`.github/workflows/independent-foundation.yml`, 7.4 and 8.2) after `--fetch` supplies the pinned Smarty.

| check | result |
|---|---|
| registry | v2.1.0, 7 mega menus, 8 footer columns, 169 links (160 app / 167 PHP) |
| link integrity | 2,457 surfaces · 926 internal · 910 PHP · 5 external · 31 anchors — 0 broken, 0 placeholder, 0 dangling |
| rendered site | 229 pages, 907 images, 3,063 asset references, 42,393 links, 45,510 controls, 194 indexable / 35 noindex, 194 canonical addresses, 0 problems |
| hero artwork as rendered | 47 pages on a 3D scene, 1 flat, 19 legal documents text-only, 48 distinct artworks |
| tool surface | 257 derivable / 265 published — both directions empty |
| page inventory | 255 rows, 6 defect classes all 0 |
| Python unit suites | 81 OK (website + security), plus `tests/website/run.php` 310 assertions / 0 failed |
| PHP tools shell | 1,171 assertions passed (PHP CLI, no licensed WHMCS runtime) |
| accessibility contract | viewport, lang, skip link, menu state, control names, image text, target sizes, focus, reduced motion, responsive ladder — all hold |
| assets | raster ladder complete (50 scenes × 2 formats), served mirror in sync |
| server agent | 71/71 |
| Node platform | `npm test` **705 passed** on the frontend project; 2,248 passed of 2,256 in the combined run (see §8) |

## 8. One honest caveat about a test run

The combined Node run (`npm run typecheck && tsc --noEmit && npm test && npm run build`) reported
**2 failed / 2,248 passed**. Both failures are `waitFor` assertions in `frontend/tests/unit/`. The same
suite re-run on its own passes **705/705**, and the single failing file passes in isolation. The cause
is the host, not the code: it has 2 CPUs, the run spawns one worker per test file (163), and the load
average crossed 10 — a 1-second testing-library timeout expires under that. This is stated as an
environment artefact with the isolation evidence behind it, not as a green run.

CI runs the same suite on a normal runner (`.github/workflows/node-platform.yml`: typecheck, frontend
typecheck, `npm test`, `npm run build`).

## 9. Production archive

`PATH=/tmp/ch247-bin:$PATH python3 scripts/build-production-zip.py --verify` → **exit 0**:

```
wrote CloudHost247-production-1.0.0.zip files=9967 bytes=138435932 secret_skipped=0
media assets present: 618 · theme illustrations resolved: 49 · 3D scenes: 49
published documentation files: 13 · archive size: 132.0 MB
✓ production archive verified: deployable, complete, no secret material
```

`.git`, `node_modules`, caches and the `platform/` tree are absent from the archive; `.env.example`
and `.htaccess` are the only dotfiles allowed; **0** secret-pattern hits. Both the active theme (89
files) and the preserved legacy theme (1,715 files) and legacy order forms (189 files) are included,
matching the working tree exactly — §20's preservation requirement, verified rather than asserted.
The archive is built and verified; **it has not been deployed anywhere.**

## 10. Audited non-defects — recorded so they are not "fixed" later

Two open questions from the earlier pass were measured and both turned out to be deliberate. Each is
now documented next to the code it belongs to.

**`'template_name_custom' => 'cloudhost247_legacy'`** (`modules/addons/cloudhost247_theme/lib/ThemeRepository.php`).
It reads as though the active theme were left pointing at the retired one. It is a WHMCS convention
variable holding the theme directory a template builds its own asset paths from, and its only readers
are the preserved legacy theme and legacy order form — for which that value is **correct**. No template
in the active theme reads it, so it cannot misdirect a page the site ships; changing it would break the
legacy surfaces it exists for.

**Eight registry destinations carry only one of their two runtime hrefs** (`spa` absent for Plesk
Hosting, Domain DNS, All Tools, Compliance & Document Tools, MRZ Generator, Knowledge Base and
Announcements; `php` absent for Business Tools). This is the registry working as designed: the SPA and
the PHP shell each publish only the destinations they serve, and both filter fail-closed
(`scripts/site/generate.mjs`, app at lines 343/378 and PHP at 880/889), which is also why neither can
emit an empty href. Inventing the missing routes would be inventing capability, so this is recorded.

## 11. Not done, blocked, or unverified — stated plainly

- **C4 PARTIAL — real-browser behaviour.** No browser binary exists on this host, and
  `npx playwright install chromium` fails at the download: `ECONNRESET` to `cdn.playwright.dev`, which
  this environment cannot reach. The 520-case sweep in `docs/website-rebuild/browser-verification.json`
  predates this pass and **has not been re-run**. The static half of C4 — the accessibility contract —
  does run in the gate.
- **D3, E2, E3, E4 BLOCKED — licensed WHMCS staging.** No licensed runtime, no production database.
  Payment paths, checkout behaviour, provisioning and email delivery are consequently verified only by
  their fakes and static suites.
- **E5 NOT TESTED.**
- **Four platform-footer slugs** (`ip-lookup`, `spf-checker`, `subnet-calculator`, `json-tools`) resolve
  to signpost pages rather than working tools, because the native catalogue names those capabilities
  differently (`ip-location-lookup`, `spf-record-checker`, `ip-subnet-calculator`, `json-formatter`).
  The pages are honest about it and served `X-Robots-Tag: noindex`. Whether the shell should alias them
  is a product decision that a slug map could get wrong — it would send a visitor to a tool answering a
  different question — so it is recorded in the test rather than taken here.
- **Not verified by me:** anything requiring the two environments above; and the CI run on this branch
  was still in progress when this report was written. The local evidence in §7 is complete.

## 12. Files changed on this branch

```
.github/workflows/independent-foundation.yml        Smarty tarball cache + rendered-site audit step
docs/ACCEPTANCE-CRITERIA.md                         B2, B3 and C4 corrected against measurement
docs/website-rebuild/page-inventory.{json,csv}      84 → 255 rows, corrected taxonomy
modules/addons/cloudhost247_theme/lib/Site.php      publishes the tool measurement, not the 9 KB list
modules/addons/cloudhost247_theme/lib/ThemeRepository.php   documents the legacy template default
modules/addons/cloudhost247_theme/resources/site.json       regenerated (toolsServed = 265)
scripts/audit-navigation-inventory.py               tool taxonomy, 2 new defect classes
scripts/release-candidate-check.sh                  renders and resolves the site inside the gate
scripts/site/generate.mjs                           projects both tool catalogues
scripts/verify-rendered-site.sh                     new — renders and audits 229 pages
templates/cloudhost247/includes/site-{nav,footer}.tpl       served-set attribute removed
templates/cloudhost247/js/site.js                   served-set filter removed (see §5)
tests/security/test_release_gate_static.py          +the resolution step is pinned
tests/website/check-fixtures.py                     canonical value auditing
tests/website/check-tools-resolution.php            new — resolves 265 paths through PHP
tests/website/test_fixture_checks.py                +canonical negative cases
tests/website/test_page_inventory.py                rewritten for the corrected taxonomy
tests/website/test_tools_surface.py                 rewritten for the corrected taxonomy
```

**No WHMCS core file, payment path, provisioning module, database migration or vendor tree was
modified.** No credential, secret or private key was added, moved or exposed; the archive reports
`secret_skipped=0` because nothing matched the secret patterns in the first place.
