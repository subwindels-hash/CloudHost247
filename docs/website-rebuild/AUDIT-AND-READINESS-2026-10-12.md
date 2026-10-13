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

### 3.4 Twenty-nine product pages had no hero of their own

The brief asks for a distinct, relevant hero visual on each product page. The registry names one
per page, but the artwork a page actually renders is the *resolved 3D scene*: the generator
upgrades `<visual>-3d` when that scene exists and otherwise falls back to the scene its family
shares (`FAMILY_3D` in `scripts/site/generate.mjs`). Twenty-nine pages were on a family
fallback, so e.g. `/deployment/api`, `/deployment/php` and `/deployment/laravel` all rendered the
same pipeline scene, the four management pages shared the dedicated-server scene, and
`/hosting/windows-hosting`, `/hosting/plesk-hosting` and `/hosting/reseller-hosting` shared the
web-hosting scene.

Twenty-eight scenes were produced for these pages and wired end to end (`plesk-hosting`,
`windows-hosting`, `reseller-hosting`, `game-servers`, `backups`, `firewall`, `ip-management`,
`migration`, `data-centers`, `docker`, `php`, `laravel`, `nodejs`, `python`, `developer-hosting`,
`api`, `paas`, `os-catalog`, `platform-security`, `ssl`, `insights`, `documentation`, `domain-dns`,
`support`, `managed-services`, `network`, `server-control`, `website-design`), each encoded to the
same 640/960/1280 AVIF + WebP ladder and mirrored into the platform's served library. Two more —
`offers` and `help-center` — were produced for the separate defect in §3.10, which this metric did
not catch, bringing the pass to 30 scenes and the library to 50. Coverage measured by the inventory
audit:

| | Before | After |
|---|---|---|
| Pages on their own scene | 38 | **67 of 67** |
| Pages on a family fallback | 29 | **0** |
| Distinct hero scenes in use | 19 | **49** |

The audit reports this on every run (`totals.hero_scenes_exact`,
`totals.hero_scenes_from_family_fallback`, `totals.distinct_hero_scenes`, plus a `hero_fallbacks`
list naming what each page shares its scene with), so coverage is measured rather than asserted —
and because the release gate diffs the committed inventory, a future page that quietly falls back to
a family scene shows up as an inventory change under review.

That metric answers "does the scene this page's visual names exist?". It does not answer "is this
page's hero its own?", which two pages declaring the *same* visual both satisfy — see §3.10.

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
it: `node scripts/check-malformed-bullets.mjs` → 5 983 text files scanned, 0 findings; the two legal
JSON copies are byte-identical.

### 3.7 Verified clean, and now measurable: the Wingdings / orphan-PUA artifacts

The brief singles out the `\uf0d8`-style Wingdings orphan that ends up in rendered pages when a list
bullet is authored in a symbol font and the font is not applied. It is checked rather than assumed:

```
$ grep -rlP '(?:\xef\x83\x98|\xef\x82\xb7)' /tmp/ch247-fixtures | wc -l     # U+F0D8, U+F0B7
0
$ grep -rlP '(?:\xef\x83\x98|\xef\x82\xb7)' --include=*.php --include=*.tpl --include=*.json \
      --include=*.css --include=*.js --include=*.mjs --include=*.md --include=*.ts --include=*.tsx .
(nothing)
```

**Zero** occurrences in all 229 rendered pages and zero in any first-party text source. The only
files in the tree containing those byte sequences at all are (a) compressed image data that happens
to contain the three bytes — including one of the 3D scenes produced in this pass, which is a picture
of a server hall and contains no text — and (b) one PNG in the retired legacy theme, which the active
theme never serves and which this pass deliberately leaves alone. The repository's own
`scripts/check-malformed-bullets.mjs` is the standing guard for this class and reports 0 findings
across 5 983 text files.

One note for whoever repeats the check: a character class such as `[\xef\x83\x98]` matches the
individual *bytes*, so it flags every file containing `·` (U+00B7 is `C2 B7`) and every compressed
binary. The sequences have to be alternated as whole three-byte units, as above.

### 3.8 There was no accessibility or responsive gate that could run without a browser

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

### 3.9 The domain platform: every number comes from the connected registrar

The brief's domain requirement is a data-provenance requirement — the domain surface may present real
registrar, TLD and pricing data, and must not present invented data. This was audited rather than
assumed, because a marketing site is exactly where a plausible-looking price table tends to appear.

| Claim | How it was checked | Result |
|---|---|---|
| The public Domains page has no pricing of its own | rendered fixture `/domains` (26 KB, `domain.php` via the Theme content store) reduced to visible text | the page describes search, transfer and portfolio management and links out; it shows no TLD table and no amount |
| The navigation sends domain work to the live platform | the domain menu and footer rows in `shared/site/registry.json` resolve to `cart.php?a=add&domain=register`, `clientarea.php?action=domains`, `domain.php`, `dns-management.php`, `domain-dns.php` and the five `tools/*dns*` checks | every one is a WHMCS runtime route, a published page, or a tool route that exists; the link checker verifies them all (A3) |
| Extension prices come only from the connected registrar | `cloudhost247-node/src/domain-services/extensions-service.ts` header, and the only writer of `domain_provider_extension_offerings` is `syncExtensionsFromProvider()`, which reads the provider's own `getExtensions()` | prices, currency and premium support are provider rows copied on sync; the admin may edit presentation copy and the trending flag only — the file says the trending flag is "never provider-sourced, never hard-coded for any TLD" |
| Nothing seeded a fabricated catalogue | `grep -rn "INSERT INTO domain_extensions" cloudhost247-node/` → one hit, the Super Admin create path in that service; **no `.sql` file inserts an extension or a price** | a fresh install has an empty directory, not a stocked one |
| A price-like literal does not exist anywhere in first-party source | `grep -rnE '\.(com\|net\|org\|io\|ai\|dev)"?[,:]?\s*\$[0-9]'` across the Node platform, the theme, the registry and the content store | 0 hits |
| An unconnected registrar produces an honest page, not a guess | `frontend/src/pages/domains/ExtensionsPage.tsx` empty state; the directory query joins on `o.status = 'enabled' AND p.status = 'connected'` | the page says the catalogue is synchronized from the connected registrar and that "there are no provider-confirmed extensions or prices to show — and none are invented here" |
| Search, WHOIS, appraisal, quote and order fail closed | `search-service.ts`, `whois-service.ts`, `appraisal-service.ts` return the `provider_not_configured` outcome; `provider-service.ts` refuses a configured-but-untested account | no availability, valuation or order is produced without a connection-tested provider |
| Only compiled, real provider adapters can run | `providers/register-builtins.ts` + `providers/registry.ts` | Namecheap and GoDaddy (registration/search), RDAP (availability), GoValue (appraisal); an unknown adapter key fails closed rather than falling back |
| The honest behaviour is enforced, not merely intended | `cloudhost247-node/tests/integration/domain-services-api.test.ts` — 16 cases against embedded Postgres | includes "reports honest readiness: nothing configured until a provider passes a real connection test", "search returns the honest not-configured outcome with zero fabricated results" (`results: []`, `Service Provider Not Configured`) and a taken label that is never fabricated as available |
| The rules above are now checks, not prose | `python3 -m unittest tests.security.test_domain_data_provenance` — 14 cases, wired into the release gate | no TLD/price literal in any first-party source, no migration or seed writing either catalogue table, a single provider-reading writer for offerings, the directory's own explanation of where its catalogue comes from, and the `provider_not_configured` outcome in search/WHOIS/appraisal — each with a negative case that mutates a copy and requires the rule to fire |

**Not tested here:** calls to a real registrar, RDAP or appraisal provider. No provider is connected in
this environment and none is configured with credentials, so the *live* availability, premium-price,
transfer and appraisal paths remain staging work (E2), exactly as the criteria record.

### 3.10 Two pages shared a hero while every coverage number read 67 of 67

`hero_scenes_exact` counts a page as covered when the scene its visual key names exists. Two pages
declaring the *same* key both satisfy that, so the inventory reported 67 of 67 pages on their own
scene while `offers.php` painted the same hero as `cloudhost247-hosting.php` (`cloud/cloud-hosting`)
and `help-center.php` the same one as `faqs.php` (`management/support`). §11 of this report recorded
both pairs as acceptable — "the two hosting pages are the same product described twice" — and that
reading does not survive contact with the pages: Offers renders live catalogue pricing and the Help
Center is the support entry point, and neither is the page it was borrowing artwork from.

Two scenes and two vector diagrams were produced for them (`cloud/offers`, `management/help-center`),
encoded to the same 640/960/1280 AVIF + WebP ladder and mirrored into the platform's served library.
The rule is now enforced in two places, because the catalogue and the HTML can disagree:

| Where | What it checks | Result |
|---|---|---|
| `tests/website/test_static.py::test_published_pages_do_not_share_a_hero` (in the gate, always) | no two published non-legal pages resolve to the same hero artwork; a negative case duplicates a page's artwork and requires the rule to fire | 23 tests OK, and falsified by hand: reverting `offers.php` to the shared key fails the test, restoring its own key passes |
| `scripts/check-hero-render.py` (in the gate when fixtures have been rendered) | the artwork each *rendered* page paints is the scene the inventory resolves for it, that artwork exists, and no other non-legal page paints it | 48 distinct hero artworks, 0 shared — 47 pages on the 3D ladder, `email-hosting.php` on its own flat illustration, 19 legal documents text-only |

Two counts appear in this section and in §6, and they differ for a reason worth stating rather than
leaving to be reconciled: the inventory reports **49 distinct declared scenes**, the rendered check
reports **48 distinct hero artworks**. The 49 counts every scene the catalogue resolves for a
published page; the 48 counts what the fixtures actually paint — 47 scenes plus the one flat
illustration. Two declared scenes are never painted: `hosting/email-hosting-3d`, because
`email-hosting.php` renders its own flat `hosting/email-hosting.svg` through a bespoke template, and
`security/security-3d`, because the 19 legal documents render no hero at all. Neither is a broken
image — both are artwork a template chose not to use — and no page paints artwork another page also
paints, which is the requirement.

The legal and policy family is exempt from the distinctness rule, and the exemption is measured
rather than assumed: those templates render the document as text with no hero at all, which the
rendered check confirms for all 19, so a shared hero cannot hide behind a policy page. The gate runs
the rendered check only where fixtures exist — Smarty is deliberately not part of its toolchain — and
prints a note saying so when they do not, rather than passing silently.

### 3.11 The link audit that decides two acceptance criteria was not run by anything

`docs/ACCEPTANCE-CRITERIA.md` names `node scripts/site/check-links.mjs` as the command that decides
**A3** (public links resolve, with no `#`, empty or dev-only destinations) and part of **B2** (every
footer link route-backed). It passes, and it is the most thorough link check in the repository —
2 208 surfaces, the registry's menus and footer columns, the SPA router and content JSON, the theme
templates and every root page controller.

Nothing ran it. Every reference to `check-links` in the tree was enumerated rather than assumed:
its own usage comment, `build-production-zip.py` listing it as a file the archive must *contain*,
the archive manifest telling a deployer to run it by hand, prose in the dated reports, and one
comment in `tests/website/run.php`. It is not a step in `scripts/release-candidate-check.sh`, not a
job or step in any of the three workflows, and not an npm script. So the audit that two criteria
rest on was a thing somebody had to remember to type, and a footer entry renamed to a page that
does not exist would have shipped with all five CI checks green.

It is now a gate step, immediately after `verify-website.py`. It reads only committed source — no
build output, no network — so it costs under a second and needs nothing the runners do not already
have.

Fixing that surfaced a second problem in the audit itself. Its `EXCLUDED_FROM_ENFORCEMENT` list
carried `tools/` under the reason "`tests/`, `docs/` and `tools/` are development material, not
published pages." Two of those three are development material. `tools/` is not: `tools/index.php`
is the public front controller behind `/tools`, `/tools/category/*` and every individual tool route,
and the footer's Tools column links twelve of those destinations. The tree's two genuinely
non-public files are `tools/admin/index.php`, which answers 503 until `CH247_TOOLS_ADMIN_TOKEN` is
set, and `tools/preview-router.php`, which exists only for PHP's built-in dev server. Excluding the
whole directory suppressed four real hrefs on the strength of a comment true of two files in it.

The exclusion is now those two paths. Four hrefs moved from recorded-only to enforced and all four
resolve, so the audit still reports **0 broken, 0 placeholder, 0 dangling**:

| Measure | Before | After |
|---|---|---|
| Internal links enforced | 923 | **926** |
| In-page anchors enforced | 16 | **17** |
| hrefs recorded but not enforced | 726 | **722** |
| Problems | 0 | **0** |

The four are `tools/api.php`'s two stylesheet links and its `/tools/` link, and `tools/lib/View.php`'s
`#ch-tools-content` skip anchor — small, but they are published markup that no check had ever read.
The comment above the list now states which parts of `tools/` are public and why the other two are
not, so the next reader does not have to re-derive it.

Reading the audit's output against the registry also settles a number that looks like a discrepancy.
The registry declares **68** footer destinations; each surface renders **67**. They are not the same
67. `Domain DNS` declares only `{"php": "domain-dns.php"}`, so the SPA projection drops it — there is
no router path to send it to, and the generator's own rule is that falling back to `href.php` would
fabricate a route out of a script name. `Business Tools` declares only
`{"spa": "/tools/business-tools"}`, so the PHP projection drops it — no `business-tools.php` exists.
Both destinations are real on the surface that carries them (`domain-dns.php` is published, indexable
and in the sitemap; `/tools/business-tools` is a route in `App.tsx`), neither footer contains an empty
or `#` href, and the audit now enforces both sides rather than trusting the count. Each entry declares
the surfaces it exists on, which is what keeps the two front ends from disagreeing.

An orphaned deciding command is a class of defect, not an incident, so all 32 criteria were swept for
it rather than stopping at the one that turned up. The sweep strips comments from the gate before
matching — otherwise a script *named in a comment* reads as invoked, which is exactly how
`tests/website/browser.cjs` first appeared to be automated — and it reads only the `run:` lines of the
three workflows. Test files named by a criterion but never named by a command are matched against the
vitest `include` globs in `cloudhost247-node/vitest.config.ts` (`tests/**/*.test.ts`,
`frontend/tests/**/*.test.{ts,tsx}`), each path checked individually, because `npm test` runs them
without ever printing their names.

Result: **two** criteria have a deciding command that no automation runs, and both are deliberate.
**A6** (`build-production-zip.py --verify`) is release-workflow step 5 — it builds a 131.8 MiB
package, so it runs when a candidate is frozen, not on every push. **C4** (`browser.cjs`) needs
Chromium, which is why C4 is PARTIAL. Every other criterion, including all 26 marked COMPLETE, is
decided by something the gate or a workflow actually executes.

### 3.12 A committed inventory listed a file the repository does not contain

`scripts/inventory-website.py` rebuilds four committed inventories under `docs/website-rebuild/` —
`current-files.csv`, `current-routes.json`, `node-api-routes.json` and the re-categorised baseline
copies. Nothing invoked it: not the gate, not a workflow, not a test. It is the same class of defect
as §3.11, found by sweeping `scripts/` for generators and checkers that no automation runs rather
than by waiting for one to matter.

Running it against this branch's tip produced two findings.

**The generator could put an uncommitted file into a committed artifact.** Its file list came from
`git ls-files --cached --others --exclude-standard`, and `--others` means *untracked*. Verified
directly rather than read off the flag: a scratch file `zz-untracked-scratch.php`, never added to
git, appeared as a row in `current-files.csv` — an inventory that is itself committed, so it would
have described to any reviewer, and to anybody cloning the repository, a path that does not exist
for them. That is the failure mode this whole report is written to avoid: an artifact asserting
something the tree does not contain. The flag is now `--cached` only, and the regression was
re-tested: the same scratch file produces **0** rows.

**Two of the four inventories had drifted.** `current-files.csv` listed 6 875 files where the
repository has 7 939 — 1 065 rows missing, every one of them a tracked file this pass created (the
30 new 3D scenes and their ladder encodings, the two hand-authored vector diagrams, the new suites
and checkers), plus one row for `cloudhost247-node/frontend/public/docs/node-platform-status.md`,
which no longer exists on any branch. `node-api-routes.json` was missing
`GET /api/v1/currency/rates` and `GET /api/v1/currency/geo-country` — the second being the very
endpoint §3.5 fixed, so the inventory predated the fix it should have reflected. Both are
regenerated and committed here. `current-routes.json` and the two baseline CSVs were already in
sync, which is itself evidence the drift was recency rather than a broken generator.

The regenerated CSV was then checked against the tree instead of being trusted: **7 939 rows, 0
listed-but-untracked, 0 tracked-but-unlisted** (outside the generator's own `docs/website-rebuild/`
skip rule), and **0 rows whose recorded byte size disagrees with the file on disk**.

These inventories are deliberately **not** gate-freshness-checked, unlike `page-inventory.json`, and
the reason is measured rather than assumed. Every one of the 7 939 rows carries a byte count, so any
edit to any file in the repository changes this CSV; a strict freshness gate would force a full
regeneration on essentially every commit, and a check that fails constantly gets disabled. Its
history bears that out — one commit ever touched it, against five for the registry-derived
`page-inventory.json`, which changes only when the registry does and is therefore cheap to hold
fresh. The distinction is between an artifact that describes *the registry* and one that describes
*every file*: the first can be gated, the second is a snapshot, and it is labelled as one.

### 3.13 The hygiene scan's scope depended on whether a build had been run

`scripts/check-malformed-bullets.mjs` is the standing guard for the malformed-bullet,
replacement-character and orphan-PUA classes (criterion B5). It reported **6 673 text files** — a
figure quoted in four places across three documents. Re-running it after the recovery in §3.12
reported **5 983**. The same commit, two different counts, and neither machine was wrong.

The difference is `cloudhost247-node/public/`: vite's `outDir` (`frontend/vite.config.ts:66`),
produced by `npm run build:frontend` and ignored by `cloudhost247-node/.gitignore:8`, which
annotates it as "Built frontend static assets … generated, not source". The scanner decided what to
skip from directory *names* (`SKIP_DIRS` — `.git`, `node_modules`, `dist`, `build`, `coverage`,
`.cache`, `.next`, `.turbo`), and `public` is not in that list, so whether 690 generated files were
walked depended on whether a build had been run in that working copy. My sandbox had built the
frontend for the archive in step 5; CI checks out clean and never does. **The documented figure
therefore reproduced only on a machine that had run a build** — it was not what CI scanned, and not
what a reviewer cloning the repository would get. A number that only one person can reproduce is not
evidence, which is the standard this report holds itself to.

The obvious fix is wrong, and worth recording because it would have passed every test in the
repository. Adding `public` to `SKIP_DIRS` cannot work: that set is matched against `entry.name`, the
*basename*, and `cloudhost247-node/frontend/public/` is **tracked source** — 641 files including the
media library this project ships. Skipping by that name would have silently removed 641 authored
files from the hygiene scan while the script still printed `0 finding(s)` and exited 0. That is the
worst available outcome: a check that scans less and reports green. Two directories, same basename,
opposite status — one generated, one authored — is exactly the case a name-based rule cannot
express.

The scope is now derived from git's own ignore rules
(`git ls-files --others --ignored --exclude-standard --directory`), which is where this repository
already records what is generated, so the rule cannot disagree with the tree. Git guarantees the
property the name-based rule could not: an ignored path is by definition untracked, so no authored
file can be skipped by it. Measured before relying on it — of the ignored paths in this tree, **0 are
also tracked** and **0 fall under `frontend/public/`**. Where git is unavailable (a tarball, a sandbox
with no repository) the call fails closed to an empty set and `SKIP_DIRS` alone applies, degrading to
the previous behaviour rather than aborting the check.

Both directions were then falsified rather than assumed, with probes removed afterwards and the tree
confirmed clean:

| Probe | Expected | Observed |
|---|---|---|
| 4 ignored files under `cloudhost247-node/public/`, one containing U+FFFD that would be a finding if scanned | count unchanged, exit 0 | **5 983 files, 0 findings, exit 0** |
| U+FFFD planted in `cloudhost247-node/frontend/public/__probe_fffd.md` (tracked source tree) | finding caught, exit 1 | **1 finding, exit 1** |

The first proves generated output is no longer walked; the second proves no authored file was lost to
achieve it. The count is now stable at **5 983** regardless of build state, and the four stale
`6 673` references — `COMPONENTS.md`, §3.6 and §3.7 of this report, and criterion B5 in
`docs/ACCEPTANCE-CRITERIA.md` — are corrected to it. The verdict was never in doubt: both counts
reported 0 findings, so this changed what the check *covers*, not what it found. It is recorded here
because a coverage defect in a hygiene check is a defect, and because the scan count is the evidence
that the coverage is real.

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
| `node scripts/site/check-links.mjs` | 2 208 surfaces · 926 internal · 899 PHP · 5 external · 17 in-page anchors — **0 broken, 0 placeholder**; 5 informational notes (external legal citations to ICANN, Google, Mozilla, Apple and WHMCS); 722 hrefs inside vendor/dev surfaces recorded but not enforced |
| `python3 scripts/verify-website.py` | 67 registry pages · 83 navigation destinations · 475 first-party classes · 79 includes · **0 source errors**; per-page title and description uniqueness enforced; `#`/empty/external hrefs rejected |
| Regeneration | idempotent — re-running the generator leaves the tracked outputs byte-identical |

Menus are native `<details>`/`<summary>` disclosures, so a mega menu opens without scripting; the
mobile toggle carries `aria-expanded`/`aria-controls` and is now 44×44; the same registry feeds the
SPA navigation through a generated adapter, so the two front ends cannot drift.

## 6. Artwork and asset verification

| Family | Contents |
|---|---|
| Illustrations | 221 SVGs in the library; the 67 registry pages reference 49 distinct diagrams (one key shared, by the 19-page policy family — see §11) |
| 3D scenes | 50, each with 640/960/1280 in **AVIF and WebP** plus the JPEG master (`generate-raster-formats.py --check` → 50 scenes × 2 formats ✓); 30 were added in this pass |
| Brand | 24 files: horizontal / compact / primary / icon-mark × dark, white and mono, in SVG + PNG + WebP |
| Favicons | `favicon.ico` + 16/32/48/192/512 PNG, Apple touch icon, `site.webmanifest` |
| Social | preview artwork in PNG, SVG and WebP |
| Catalogues | 52 neutral application marks (one per manifest) · 19 control-panel marks · 14 operating-system marks |

Asset verification is end-to-end: the fixture QA resolves every `src`/`href`/`srcset` candidate of
every rendered page (907 images, 3 063 asset references, 0 missing); the site verifier checks the
artwork each registry page names; and the production archive independently re-resolves every visual
the theme registry references in **both** the PHP library and the built SPA library, including every
3D encoding.

One gap was found and closed here. The platform's copy of the library
(`cloudhost247-node/frontend/public/media/cloudhost247`, 597 files, 21 MB) is a *second* copy that
Vite's build treats as its public directory, and nothing verified it against `assets/images/cloudhost247`
— `generate-raster-formats.py --check` only counted the ladder. Adding a scene and skipping
`--emit-served` would therefore have shipped a `<picture>` whose `-960.avif` does not exist, which a
browser does not fall back from. `--check` now compares both trees (missing file, differing bytes,
and stale files the library no longer defines) and fails with the names.
`tests/website/test_media_library_parity.py` (9 cases) holds the rule, and the rule was falsified by
hand before it was trusted: deleting one served file, flipping one byte in another, and dropping a
stale file each made the check exit 1 and name the file, and the unmodified tree exits 0 with
`✓ served mirror in sync with assets/images/cloudhost247`.

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
| 18 PHP behavioural suites (`tests/*/run.php`) | all pass — foundation, theme, currency, smm, tools, ovh, rdp, integrations, modules, builder, broker, marketing, cart_recovery, passkey, phoneservices, customaffiliate, cloudhost247_email, payments — with **0 deprecation notices on either PHP leg** (8.2.33 and 7.4.33) since the test fakes declared their interface return types (§11.3) |
| Tools platform | 85 tests / 0 failures · 1 171 shell/menu/footer assertions · 26 static tests · browser-tool module tests pass |
| Static + security suites | **459 tests OK** (2 skipped with recorded reasons) |
| Website suites | **78 tests OK** in the release gate (8 skipped there by design — the rendered-page cases need a fixture tree, which the gate does not build), including the catalogue-honesty guard and the hero-distinctness guard (§3.10) |
| Node platform suite (`npm test`) | **161 test files / 2 242 tests passed**, exit 0 (Vitest, ~30 min; runs the migrations against the in-process Postgres engine) |
| Node currency/i18n suites | the two new suites pass (6 + 8 tests) alongside the existing currency, i18n and switcher suites; `npm run typecheck` and the frontend `tsc --noEmit` exit 0 |
| Server-agent authentication | 71/71 |
| Retired-brand audit | 7 532 text files scanned, **0 matches** (2 728 binary and 18 ionCube files checked by name only) |
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
6. static verification bundle (unittests, website suites — including the **catalogue-honesty**
   and **hero-distinctness** guards — tools tests, site verifier, **published-link audit (new,
   §3.11)**, **accessibility contract (new)**,
   release-workflow document checks, **domain data-provenance checks (new)**, raster ladder and
   served-mirror parity, **rendered-hero check (new, runs when fixtures exist)**, Builder
   widget-class audit, vendor manifest);
7. vendor integrity baseline.

Also verified in this pass:

| Step | Result |
|---|---|
| `node scripts/site/generate.mjs` | 7 menus / 8 columns / 169 links; 55 marketing pages, 120 sections, 174 FAQs, 13 published documents (216 KB) |
| Node platform `npm ci` + `npm run typecheck` + frontend `tsc --noEmit` | 264 top-level packages installed; both typechecks exit 0 |
| Node platform `npm test` | 161 files / 2 242 tests passed, exit 0 |
| `node scripts/check-workflow-yaml.mjs` | 3 workflow files parse, each with jobs and steps (added to the gate and to `content-hygiene.yml`) |
| `python3 scripts/build-production-zip.py --verify` | **verified** — `✓ production archive verified: deployable, complete, no secret material`, exit 0, re-run at the tip of this branch. Structural counts: **9 872 members**, `secret_skipped=0`, **597** media assets, **49** theme illustrations and **49** referenced 3D scenes resolved in both libraries, **13** published documents. The digest is **not** an integrity claim and must not be compared across environments: the writer uses `archive.write(path, rel)` with no `ZipInfo`/`date_time` normalisation, so every member carries its on-disk mtime and a fresh checkout of identical bytes hashes differently. Measured directly rather than assumed — one file, same content, two mtimes, two digests (`71b0a893…` vs `edda2011…`). It also moves with content because `docs/` is inside the walk: 138 243 211 bytes here against 138 237 977 at `de8f7ed`. The counts and the exit status are the evidence; the command is the check, not the digest |

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
  (48-scene ladder, inventory 67 exact / 0 fallback / 47 distinct), and `Independent foundation`
  on the hosted runners passed on the resulting commit as well. A further run after the
  catalogue-honesty guard was added also passed end to end (443 security/static tests plus the
  67 website tests), and again after the domain data-provenance checks were added (457 + 67).
- The latest run, after the two shared heroes were given artwork of their own (§3.10) and the test
  fakes declared their interface return types (§11.3), passed end to end with the rendered-hero check
  enabled: **459 static/security tests**, **78 website tests**, 3 workflow files parsing, a 50-scene
  ladder with the served mirror in sync, inventory 67 exact / 0 fallback / **49 distinct**, 48
  distinct hero artworks across the rendered fixtures with none shared, and **0 deprecation notices**
  in the whole log where the previous run carried 20. It also failed twice on the way and was fixed
  rather than loosened: once on unstaged regenerated surfaces (the freshness check compares the
  worktree with the index) and once on a missing `cloudhost247-node/node_modules` (`tsx: not found`,
  exit 127) — a clean-checkout prerequisite, resolved by `npm ci`.
- **Every commit of this pass is green on the hosted runners**, read per SHA from the check-runs API
  rather than assumed: `ac78d49` 10/10 checks `success`, and `3f41576`, `197df25`, `6b3a2cb`,
  `de8f7ed`, `f8dad20`, `a36457f`, `c2dadc5`, `f969d33` and `5f15a59` 8/8 `success` each. Any
  commit after the last one listed is documentation-only and inherits this evidence: nothing in a
  report sentence can change what a runner executes, and this record is itself such a commit. A
  representative run
  (`Release candidate (PHP 7.4)` 2m4s, `Release candidate (PHP 8.2)` 2m28s,
  `Build, typecheck, test (Node 22.12.0)` 13m31s, `Build, typecheck, test (Node 24.8.0)` 12m53s,
  `Content hygiene` 13s) is the whole board. So the two PHP legs have run the typed fakes on real
  PHP 7.4 and 8.2 rather than only on this sandbox's wasm shim, and the Node matrix has run the
  platform suite on both node versions for every one of these commits.
- What this environment cannot read is the runners' *log text*: `gh run view --log` downloads from
  `results-receiver.actions.githubusercontent.com`, which is outside the hosts reachable here, so the
  zero-deprecation result is evidenced by the local gate log under both shim versions (8.2.33 and
  7.4.33) and by the hosted legs passing — not by reading their output.
- **Not performed:** deployment to the staging host, live WHMCS functional QA (registration, login,
  client area, cart and checkout, payments, provisioning, domain registration, tickets), the live
  registrar/RDAP/appraisal provider calls behind the domain platform (§3.9 — no provider is
  connected here, so availability, premium pricing and valuation are exercised only against the
  recorded mock registrar), and the browser/axe pass across the recorded viewport widths.
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
2. **One illustration key is still shared, deliberately.** Every published page now renders its own
   hero artwork — 48 distinct heroes across 48 pages, none shared, measured on the rendered fixtures
   (§3.10) — and the vector keys are measured the same way: 49 distinct diagrams serve 67 pages, and
   the only key used by more than one page is `security/security`, declared by the **19 legal and
   policy documents** (acceptable-use, backup, cookie, cybercrime, data-deletion, privacy, refund,
   terms and the rest of that family). Those templates render the document as text and no hero at
   all, so the key is metadata they do not consume; a bespoke diagram behind each refund policy
   would be decoration. If the brief is read as requiring one per policy document, that is the
   remaining illustration work — it is not a hero-coverage gap, and the two pairs that were
   (`offers.php` with `cloudhost247-hosting.php`, `help-center.php` with `faqs.php`) are closed.
3. **PHP 8.2 deprecation notices — closed in this pass.** The OVH, broker and marketing *test fakes*
   emitted 20 tentative-return-type notices, and they survived because PHP reports them at
   class-declaration time: before a suite installs its own error handler, so the notices printed and
   the suite still passed. The methods now declare the type PHP wants — `getIterator(): \Traversable`,
   `count(): int`, `offsetExists(): bool`, `offsetSet()/offsetUnset(): void` — except `offsetGet`,
   where the type PHP wants is `mixed` and `mixed` is a parse error on the PHP 7.4 leg this
   repository still runs; it carries `#[\ReturnTypeWillChange]` instead, which 7.4 parses as a
   comment. Both legs were re-run: 8.2.33 and 7.4.33, all three suites pass, zero notices.
   `tests/foundation/test_static.py` now fails on an untyped interface method in any first-party
   class that implements one (459 static/security tests, with a negative case that strips a type and
   requires the rule to fire, and an explicit assertion that a same-named method on a class
   implementing none of them is *not* flagged).
4. **Three stale workflow entries** — `rc-debug.yml`, `smm-debug.yml` and `tools-debug.yml` are still
   listed as *active* by the GitHub Actions API although the files have been deleted from every
   branch, `main` included. Nothing runs from them and nothing in the repository references them,
   so the only effect is confusion in the Actions tab. **Attempted from this session and refused:**
   `gh api -X DELETE repos/{owner}/{repo}/actions/workflows/{369122443,369009771,369041201}` answers
   `404 Not Found` for all three, which is how the API reports a token without the `workflow` scope —
   the token here can read *and* push code but cannot administer workflow entries. They must be
   deleted from the Actions tab by a repository administrator, or the token given `workflow` scope;
   do not re-diagnose this as a stale-file problem, the files really are gone and every workflow run
   is generated from a file that exists.
5. **One published PHP page has no platform counterpart, by design rather than by oversight.**
   `refund-and-cancellation-policy.php` is published, indexable and linked from the PHP Legal &
   Policy Center (`legal.php`, entry `refund-and-cancellation`), but it is not in `registry.legal`,
   so it is not among the 18 documents of `legal.generated.json` and the platform app's `/legal`
   index does not list it. The reason is in its template: it carries no policy text of its own — it
   is a signpost that sends the reader to `refund-policy.php` (which *is* in the registry, at
   `/legal/refund-policy`), to the client area's service list and to a support ticket. Writing a
   cancellation policy so the SPA has something to render is a product decision, not this pass's, so
   the asymmetry is recorded instead: either a real cancellation document is added to
   `registry.legal` with its source, or the page stays PHP-only as the signpost it is. It is not
   among the 23 `excludePhp` entries, so it is in the sitemap on either reading. This is also why
   the hero checks classify legal pages from two sources (§3.10): 19 pages carry the category
   `Legal`, 17 of them are registry documents.
6. **Unfinished modules** recorded in `docs/UNFINISHED-MODULES.md` and
   `docs/UNFINISHED-BUILD-CODE-NAME-LIST.md` are unchanged by this pass and remain unfinished.

## 12. Files changed in this pass

Beyond this report, the pass changes code, gates, documentation and 424 asset files. The
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
| `scripts/check-hero-render.py` | **new** — the hero each *rendered* page paints must be the one the inventory resolves, must exist, and must not be another page's; exits 2 rather than passing when no fixtures exist |
| `tests/website/test_static.py` | adds `test_published_pages_do_not_share_a_hero` and its negative case (21 → 23 tests) |
| `tests/ovh/fakes.php`, `tests/broker/fakes.php`, `tests/marketing/fakes.php` | interface return types declared (20 PHP 8 deprecations removed; both PHP legs re-run clean) |
| `tests/foundation/test_static.py` | adds the tentative-return-type guard and its negative case (11 → 13 tests) |
| `shared/site/content/resources.json`, `modules/addons/cloudhost247_theme/resources/site.json` | `/help` and `/offers` get their own visual keys (`management/help-center`, `cloud/offers`) instead of borrowing another page's |
| `assets/images/cloudhost247/cloud/offers.svg`, `assets/images/cloudhost247/management/help-center.svg` | **new** — the two vector diagrams those keys name, drawn in the library's own house style |
| `docs/website-rebuild/page-inventory.json` / `.csv` | regenerated: footer destinations 67 → 68, hero-scene coverage added |
| `docs/website-rebuild/COMPONENTS.md` | documents the inventory audit, the accessibility contract and the two new suites; registry counts corrected (67 pages, 7 menus, 8 columns) |
| `docs/website-rebuild/DEPLOYMENT.md` | registry-first navigation wording; Node suite figure corrected to the measured 2,242 tests |
| `assets/images/cloudhost247/**` + `cloudhost247-node/frontend/public/media/cloudhost247/**` | **424 files** (212 per tree): 30 new 3D scenes × (JPEG + 640/960/1280 AVIF + WebP) and 2 new vector diagrams, mirrored into the served library |
| `modules/addons/cloudhost247_theme/resources/site.json`, `shared/site/generated/route-report.json`, `cloudhost247-node/frontend/src/content/pages.generated.json` | regenerated from the registry (the new scenes change the resolved `visual3d`) |
| `.github/workflows/content-hygiene.yml` | the unparseable step name that stopped the workflow from ever starting is quoted; the workflow also runs the new checker |
| `scripts/check-workflow-yaml.mjs` | **new** — fails when any `.github/workflows/*.yml` would not start, with the file and line |
| `scripts/release-candidate-check.sh` | also runs the workflow-file checker (this gate is not path-filtered) |
| `cloudhost247-node/src/routes/currency.ts` | the geo hint is no longer publicly cacheable and no longer echoes the caller's address |
| `cloudhost247-node/tests/integration/currency-geo-hint.test.ts` | **new** — 6 tests pinning the hint's cache contract and address handling |
| `cloudhost247-node/frontend/tests/unit/currency-geo-fallback.test.tsx` | **new** — 8 tests pinning the currency signal ordering (hint suggests, never decides) |
| `docs/RELEASE-WORKFLOW.md` | **new** — the staging-only release workflow: thirteen steps, each with its command, evidence and stop condition, ending at the explicit production-approval gate |
| `docs/ACCEPTANCE-CRITERIA.md` | **new** — every acceptance criterion with the command that decides it and a strict status (COMPLETE / PARTIAL / BLOCKED / NOT TESTED) |
| `tests/website/test_catalogue_honesty.py` | **new** — 21 tests at three levels (template source, a repository-wide promise sweep, and the rendered pages when fixtures exist): the application directory and the OS families must label themselves as catalogues, name the platform as the source of availability, carry no fabricated price and promise no provisioning workflow. Every rule has a negative case that mutates a copy and requires the rule to fire |
| `scripts/release-candidate-check.sh` | also runs the catalogue-honesty and release-workflow-document suites |
| `scripts/release-candidate-check.sh` | also runs `scripts/site/check-links.mjs` — the audit that decides A3 and part of B2 was previously invoked by nothing (§3.11) |
| `scripts/site/check-links.mjs` | enforcement narrowed from `tools/` to `tools/admin/` + `tools/preview-router.php`, so the published tools front controller is audited; the exclusion comment now says which parts of the tree are public |
| `tests/website/test_media_library_parity.py` | **new** — 9 tests holding the platform's copy of the media library to the library it mirrors: in-sync, missing, differing, stale and missing-directory cases, plus a subprocess run of `--check` against the real tree |
| `scripts/generate-raster-formats.py` | `--check` now verifies the served mirror as well as the ladder, and names what drifted |
| `tests/security/test_domain_data_provenance.py` | **new** — 14 tests holding the domain platform to its data provenance (§3.9): no TLD/price literal anywhere in first-party source, no seeded catalogue, one provider-reading writer, an honest empty state and the fail-closed services, every rule with a negative case |
| `tests/security/test_release_workflow_docs.py` | **new** — 9 tests holding those two documents to their claims: thirteen numbered steps in order, step 13 is the approval gate, every named repository path exists, only the four status words are used, and each criterion names a deciding command |
| `docs/README.md` | indexes the two new documents |
| `docs/website-rebuild/AUDIT-AND-READINESS-2026-10-12.md` | **this report** |

No WHMCS core file, payment path, provisioning module, migration, authentication control or vendor
tree was modified. No page was deleted, no route was removed, and no backend integration was replaced.

## 13. Release workflow and acceptance criteria

Two documents the brief asks for did not exist in the repository: a single staging-only release
workflow of thirteen steps ending at an explicit production approval, and a consolidated acceptance
criteria list. The material was spread across `docs/independent-rebuild/STAGING-DEPLOYMENT.md`, the
website runbook and the staging reports, so a release had no single ordered sequence to follow and no
single place where "done" was defined.

**`docs/RELEASE-WORKFLOW.md`** is that sequence: thirteen numbered steps, each naming its command,
the evidence it must leave behind and its stop condition, with the WHMCS-touching steps marked
*staging host*. It is built only from commands that already exist (`release-candidate-check.sh`,
`staging-preflight.php`, `staging-backup-verify.php`, `staging-baseline-evidence.php`,
`staging-financial-snapshot.php`, `compare-financial-evidence.py`, `validate-migrations.py`,
`build-production-zip.py --verify`, `browser.cjs`, `generate-staging-report.py`), and it states in
its opening lines that **nothing in the repository deploys to production**. Step 13 is the human
approval gate: it requires a named approver, the candidate SHA, the evidence paths and a *tested*
rollback, and it ends the workflow.

**`docs/ACCEPTANCE-CRITERIA.md`** lists 32 criteria (source and build, design and content,
accessibility, behaviour and integration, release), each with the command that decides it and one of
four statuses. It records what is genuinely done and what is not: C4 (the real-browser sweep) is
**PARTIAL** because the recorded 520-case run predates this pass and no browser binary exists here;
D3 (live catalogue states) is **PARTIAL** pending staging; E2–E4 are **BLOCKED** on the licensed
staging installation; E5 (production approval) is **NOT TESTED**, by design. C6 (a catalogue entry
never implies deployability the backend has not verified) and D7 (the domain platform's numbers come
from the connected provider, never from the repository) were added when those claims were made
checkable — see §3.9 for the domain provenance audit.

A third check closes the honesty gap those criteria flagged: **`tests/website/test_catalogue_honesty.py`**. The applications directory and the operating-system families are where a hosting site most naturally over-claims, so the rendered pages are held to their own wording — the manifest list states it is *not* a claim of deployment availability, each card sends the reader to the live platform, the OS families are labelled catalogue names whose availability comes only from the connected platform, no page carries a price (pricing is WHMCS's) and none promises a provisioning workflow. The check runs at three levels so it bites wherever the claim could appear: the template source (wording and live-catalogue hooks), a repository-wide sweep of every root page and active-theme template for phrases that promise provisioning, and the rendered pages themselves when a fixture tree is present. Every rule has a negative case that mutates a copy and requires the rule to fire — softening the disclaimer, dropping the per-card note, inventing a price, promising "available now", claiming stock, or deleting a live-catalogue hook are each reported, and the disclaimer's own negation is asserted *not* to trip the stock rule.

**`tests/security/test_release_workflow_docs.py`** treats both documents as claims and checks them —
thirteen steps in order, the last one being the approval gate, every repository path the workflow
names actually existing, only the four status words appearing in the criteria table, and every
criterion naming a deciding command. It is wired into the release gate, so a renamed script or a
deleted step fails the build rather than being discovered on a staging host mid-release.
