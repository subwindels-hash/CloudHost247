# CloudHost247 public website — rebuild report

**Date:** 2026-10-07
**Branch:** `arena/3fdb12d4-cloudhost247`
**Pull request:** https://github.com/subwindels-hash/CloudHost247/pull/62 (draft, base `main`)
**Evidence:** `docs/website-rebuild/verification-2026-10-07.json`
**Supersedes for this branch:** `docs/website-rebuild/REBUILD-REPORT.md` (PR #61, branch `arena/0ab788d1-cloudhost247`)
**Deployment state:** **not deployed.** Production release is gated on WHMCS staging verification, which
cannot run in this environment (no licensed WHMCS runtime, no production database, no browser binary).

This report covers the whole public-site rebuild carried on this branch: the pass that audited the
published content and navigation claims (`84e519b`) and the pass that made the sitemap, robots
surface and tool taxonomy registry-driven and verified (`a329775`, plus the changes below).

---

## 1. Pages audited

| Surface | Count | How it was counted |
|---|---|---|
| Root PHP pages shipped by this repository | 84 | `phpPagesKnown` in `shared/site/generated/route-report.json` |
| SPA route declarations | 134 | `<Route path=…>` parsed from `App.tsx` at generation time |
| Marketing page definitions | 54 | `shared/site/content/*.json`, validated by the generator |
| Published documentation files | 13 | `docs/` files listed for publication, copied and indexed |
| Legal documents | 17 | `registry.legal`, rendered by both surfaces |
| Tool paths in the published catalogue | 67 | theme projection `tools.json` |
| Tool paths in the PHP engine catalogue | 105 | `config/tools.php` (native engine, standalone-capable) |
| Link-checked surfaces | 2,176 | `scripts/site/check-links.mjs` |
| WHMCS theme templates (`templates/cloudhost247`) | 86 | `current-templates.csv` baseline |
| Legacy vendor theme (`templates/cloudhost247_legacy`) | ~130 | reported, not rewritten (vendor baseline) |

Every audited page is classified as rebuilt, kept, redirected or reported. The per-page inventory
is in `docs/website-rebuild/GLOBAL-AUDIT.md` §8 and the machine-readable
`baseline-routes.json` / `current-routes.json` pair.

## 2. Pages rebuilt

* **54 marketing pages** generated from one registry and one content model (116 sections, 170 FAQs).
* **41 PHP product pages** enriched from the same content source, so the WHMCS surface and the
  application describe the same product the same way.
* **18 legal documents** published as real documents, replacing two placeholder legal pages.
* **13 documentation files** published in a reader at `/docs/:slug` (one internal ledger was de-published, §6).
* **Homepage** (both surfaces) rebuilt end to end.
* **Header, nine mega menus, mobile drawer and nine footer columns** rebuilt from the registry.
* **Tools surface** reconciled onto one published taxonomy in this pass (§9).

## 3. Routes audited

134 SPA declarations + 84 root PHP pages + 14 licensed WHMCS entry points + 67 published tool paths.
The generator is the gate:

```
node scripts/site/generate.mjs --check
✓ registry valid — 227 links (227 app, 227 PHP)
```

`227 app / 227 PHP` means every navigation destination was resolved on **both** surfaces, not just
the one it was authored for. `spaRoutesKnown = 134`, `toolPathsKnown = 67`, `phpPagesKnown = 84`,
`errors = []`, `warnings = []`.

## 4. Navigation links audited

227 destinations across 9 mega menus (`hosting`, `cloud`, `domains`, `platforms`, `developers`,
`websites`, `tools`, `resources`, `support`), including section roots and featured destinations —
not only grouped links. The generator now validates every one against the router, the tool
catalogue, the legal index and the shipped PHP files, on both surfaces.

## 5. Footer links audited

9 footer columns plus the tools column, all generated from the same registry. Every item resolves;
the PHP footer is asserted item by item by `tests/tools/site-integration.php`.

## 6. Broken and placeholder links found and fixed

| Finding | Resolution |
|---|---|
| Nine of ten tool-category links published by the header/footer pointed at slugs no engine resolved | registry publishes the nine discovery categories both engines serve; pinned by a Node test and by the PHP tools suite |
| The PHP Tools mega menu published **zero** links (empty groups) | server-rendered category floors published; the PHP suite fails if the panel is empty |
| `tools-sitemap.php` advertised the catalogue's internal engine grouping (`/tools/category/dns`, `ip`, …) — nine URLs no navigation surface links to | publishes the discovery categories, read from the registry projection |
| The PHP sitemap advertised `submitticket.php` while `robots.txt` disallowed it | both now read one policy; the sitemap filters through it (§11) |
| `robots.txt` disallowed `/cloudhost247-page.php`, which is the canonical URL of every CMS-authored page the sitemap lists | route stays published; only the internal sample/element pages are excluded |
| Sitemap endpoints were disallowed by the policy while `robots.txt` advertised them (a blocked sitemap cannot be fetched) | endpoints are excluded from the policy and send `X-Robots-Tag: noindex` instead |
| `/tools/dns-checker`, `/tools/ssl-certificate-checker`, `/tools/json-beautifier` on the homepage were reported as broken in the previous pass | **verified working, no change made** — see below |
| `docs/NODE_PLATFORM_STATUS.md` was published as a public documentation page, and it is the internal phase-acceptance ledger (branch names, PR numbers, commit hashes, unexecuted migrations) | removed from the published set; the file stays in the repository for engineers |
| De-publishing a document left its markdown file in the built site (`/docs/<slug>.md` stayed fetchable) | the generator now prunes de-published files and reports what it removed |
| The **production archive** still carried the de-published internal ledger in two stale build outputs (`cloudhost247-node/public/docs`, `assets/cloudhost247-tools/docs`) because it was packed with `--skip-build` | outputs rebuilt; the packer now compares the packaged documentation set against the generated index and fails the archive on a de-published or missing file |

**The three homepage tool links are not broken.** The previous pass checked them against the theme
projection (`tools.json`) only. The PHP surface resolves a native tool path first, and all three
resolve there with a working handler:

| Homepage link | Native catalogue | Handler | Verified |
|---|---|---|---|
| `/tools/dns-checker` | `config/tools.php` | `dns_checker` → `Engine::dnsChecker()` | yes |
| `/tools/ssl-certificate-checker` | `config/tools.php` | `ssl` → `Engine::ssl()` | yes |
| `/tools/json-beautifier` | `config/tools.php` | browser-local mode, no server call | yes |

They were **not** "repaired" by inventing routes; the link check reports 0 broken links with them in
place. The theme-only equivalent shorthands (`/tools/ssl-checker`, `/tools/json-tools`) also exist
through the fallback resolver. Independently: `check-links.mjs` reports
`2176 surfaces · 955 internal · 441 PHP · 5 external · 17 in-page anchors · 0 broken`, with five
informational notes about third-party legal URLs (browser cookie help pages, ICANN UDRP, WHMCS).

## 7. Assets, illustrations and logos

* `assets/images/cloudhost247/` — 16 organised families, 161 assets copied into the build.
* Every `visual` and section `visual` referenced by the registry is validated by the generator
  (54 pages, 116 sections): a missing or renamed illustration fails the build.
* No template references a missing image: all image references across `templates/cloudhost247`,
  the theme addon and the tools renderer resolve on disk.
* Tool cards and the tools hero are asserted to exist for every published tool category
  (`tests/tools/site-integration.php`).
* The illustration captions state that the artwork is conceptual wherever it could be read as a
  claim (locations, network reach, uptime).

## 8. Menu categories

Nine published families, asserted by `id` on both surfaces (the PHP suite previously asserted a
stale "seven categories"):

```
hosting · cloud · domains · platforms · developers · websites · tools · resources · support
```

Tool discovery categories — one taxonomy, now published by the registry, the app catalogue
(`src/tools/catalog.ts`), the PHP theme projection (`tools.json`) and the native PHP catalogue:

```
dns-domains · ip-network · security · ssl · email · website · developer · calculators · utilities
```

`toolsCategoryToolCounts` (published tools per category):
`dns-domains 18 · ip-network 15 · utilities 18 · developer 10 · email 8 · website 6 · security 4 ·
calculators 3 · ssl 1`. The generator fails if any published category has no tools behind it.

## 9. Tool surface reconciliation

Before this pass the deployment published **two** category systems: the menus advertised the
discovery categories while `/tools` and `tools-sitemap.php` used the native engine's internal
grouping (`dns`, `ip`, `designer`, `gaming`, …). A visitor following "DNS & Domains" and a visitor
opening `/tools` saw different catalogues, and eight of the nine published category URLs could only
be resolved by the theme fallback.

Now:

* `/tools/category/<discovery-slug>` resolves in the **native** PHP catalogue (all nine verified),
  as well as through the theme fallback;
* the tools hub navigation and each tool breadcrumb publish the discovery categories;
* the engine grouping still resolves for older URLs instead of turning them into 404s;
* the generator asserts registry ↔ app catalogue ↔ theme projection taxonomy parity and that every
  published category has at least one tool;
* the PHP tools suite asserts the native resolution and the icon asset for every tool card
  (650 assertions).

### One URL per tool capability

The shared registry (`tools.json`) and the native catalogue (`config/tools.php`) slugged the same
tool differently, so **18 capabilities were published twice**: two indexable pages with one title,
and the second URL rendered by the theme fallback with no implementation behind it — `/tools/whois`
and `/tools/domain-whois`, `/tools/ssl-checker` and `/tools/ssl-certificate-checker`,
`/tools/speed-test` and `/tools/internet-speed-test`, and fifteen more.

Fixed in data rather than with new routes: each of the 18 registry entries now carries the served
(native) path and declares its previous path in `legacyPaths`, which the tools front controller
already redirects. `tests/tools/site-integration.php` fails if a capability is ever published under
two paths again, and the fixture QA fails on two indexable pages sharing a title.

The 30 registry entries that only the platform application implements no longer present themselves
as working tool pages. They send `X-Robots-Tag: noindex`, publish no canonical, explain that the
tool runs in the connected platform, and link to it. They were orphan routes — no PHP page linked
them, because the hub and the category pages publish the 105 native tools — so this removes thin,
indexable, unreachable pages instead of a navigation path a visitor could follow.

## 10. Remaining legacy branding

`python3 scripts/branding-audit.py` → 6,913 text files scanned, **0** retired-brand matches,
0 unregistered matches. The vendor integrity baseline
(`docs/independent-rebuild/original-file-manifest.sha256`, 1,897 templates + 368 modules files)
verifies clean in the release gate; no vendor file was modified in this pass.

## 11. Crawl policy and SEO — one policy, four consumers

`sitemap.exclude` (29 single-page-app destinations) and `sitemap.excludePhp` (23 PHP/WHMCS paths)
in `shared/site/registry.json` are the only place crawl exclusions are authored. Four surfaces read
them and can no longer contradict each other:

| Surface | Behaviour |
|---|---|
| Node `/robots.txt` | publishes both halves; root-relative rules, directory rules kept as directories |
| `robots.txt` (static fallback) | generated by the generator; hands off to `robots.php` for absolute `Sitemap:` lines |
| `robots.php` | reads the policy through `CloudHost247\Theme\CrawlPolicy`, emits absolute sitemap URLs |
| `cloudhost247-sitemap.php`, `tools-sitemap.php`, `builder-sitemap.php` | filter through the same policy, send `X-Robots-Tag: noindex` |

Build-time and test-time invariants: the policy may not exclude a registered public page, a
published tool category, or a sitemap endpoint; the compiled PHP fallback lists must equal the
registry (drift fails the suite); every sitemap entry must pass `isSitemapPathAllowed`
(asserted against a live `/sitemap.xml` response in the Node suite). A URL can therefore no longer
be listed in a sitemap and disallowed in robots.txt at the same time.

### What a page tells a crawler — asserted per page

The fixture harness renders the shipped `includes/site-head.tpl` instead of a hand-written copy, so
the QA checks the head a visitor and a crawler actually receive, on all 218 rendered pages:
stylesheet order (`site.css`, then `design-system.css`), exactly one non-empty `<title>`, a meta
description, and the rule that a page is **either** indexable with a canonical URL and parseable
JSON-LD **or** explicitly `noindex` — never a canonical on a `noindex` page, never two indexable
pages sharing a title. Result: 182 indexable / 36 `noindex`, 0 violations.

Two defects fell out of that check and were fixed: `notfound.php` was indexable without a canonical
(it is now in the noindex list), and the tool duplication above appeared as seventeen pairs of
indexable pages with identical titles.

Honest-claims work in the same area: product availability, pricing, locations, certifications and
uptime remain product-catalogue facts; the marketing content carries no invented provider,
location, OS/panel or customer claims, and the audit note in `GLOBAL-AUDIT.md` records the
specific sentences that were rewritten for this reason.

## 12. Accessibility and responsiveness

* semantic landmarks, one `<h1>` per page, skip link, `aria-current` on the active navigation item,
  `details`/`summary` disclosure menus operable from the keyboard, labelled form controls.
* `:focus-visible` outlines defined globally, with a high-contrast variant on dark surfaces.
* `prefers-reduced-motion` honoured in the design system and every component stylesheet, including
  `css/tools.css`, which was the last one without it.
* every `ch-`/`ch247-` class the fixtures render (116 distinct) is defined by a stylesheet the
  repository ships — asserted, so markup cannot drift back into unstyled boxes. The registry section
  renderer is stricter still: its 24 classes must all exist, and its card, step, check-list, note,
  grid and split classes must come from the design system, because that layer loads last and wins
  every name the two share.
* responsive breakpoints at 1199 / 767 / 479 px, `overflow-x: clip` on the shell, fluid `clamp()`
  typography, no fixed-width element in the audited templates.
* **Not verified in a browser** — no browser binary is available in this environment. Responsive and
  accessibility behaviour is asserted at source level plus the static fixture checks above (one
  `<h1>`/`<main>`/`<header>`/`<footer>` per page, no duplicate `id`, every image with an `alt`, every
  fragment target present, 59,979 interactive controls enumerated) — see §16.

## 13. Tests and gates run for this pass

| Check | Command | Result |
|---|---|---|
| Registry generator | `node scripts/site/generate.mjs` and `--check` | passed — 227 links, 0 errors, 54 marketing pages, 116 sections, 13 published documents, 43 enriched product pages, crawl policy 23 exclusions / 86 public PHP paths |
| Release-candidate gate | `bash scripts/release-candidate-check.sh` (WASM PHP 8.2) | **passed** — every first-party PHP target linted, 18 PHP behavioural suites, server-agent suite, 22 python static suites, retired-brand audit, vendor baseline, tools projection + build, website gates |
| PHP website suite | `scripts/php-wasm/php tests/website/run.php` | 315 assertions, 0 failed (section rendering, fragments, crawl policy, tool taxonomy, design-system class contract) |
| PHP tools suite | `scripts/php-wasm/php tests/tools/site-integration.php` | 650 assertions, 0 failed (adds one published path per tool capability) |
| Static website tests | `python3 -m unittest discover -s tests/website -p 'test_*.py'` | 13 tests, OK (generator/template type parity, registry link and asset integrity) |
| Rendered-page fixture QA | `CH247_FIXTURE_DIR=… python3 tests/website/check-fixtures.py` | 218 pages, 815 images, 2,492 asset references, 53,778 links, 116 classes, 182 indexable / 36 noindex — **0 problems** |
| Node SEO suite | `npx vitest run tests/integration/seo-routes.test.ts` | 6 tests passed (2 new: one-policy robots contract, sitemap/registry policy agreement) |
| Link integrity | `node scripts/site/check-links.mjs` | 2,176 surfaces, 0 broken |
| Website source gate | `python3 scripts/verify-website.py` | `registry_pages 67`, `navigation_destinations 95`, `source_errors []`, `passed true` |
| Retired-brand audit | `python3 scripts/branding-audit.py --quiet` | 0 matches |
| Node platform suite | `npm test` (cloudhost247-node) | **136 test files, 1,636 tests, 0 failures** (1113.72s) |
| Typecheck / build | `npm run typecheck`, `npm run build` | passed |

## 14. Build and production archive

```
python3 scripts/build-production-zip.py --skip-build --verify
wrote /home/user/CloudHost247-release/CloudHost247-production-1.0.0.zip files=7888 bytes=57870228 secret_skipped=0
media assets present: 161
published documentation files: 13
archive members: 7888 · archive size: 55.2 MB
✓ production archive verified: deployable, complete, no secret material
```

The archive is verified by extracting it: required entry points present, the 161 media assets the
website references are inside it, the packaged documentation set equals the published set exactly
(13 documents — de-published and missing files both fail the archive), and no file matches the
secret scanner. `node_modules`, `.git`, `dist`, build caches and development artefacts are excluded
by the packer's own allow-list.

## 15. Commit and pull request

* Branch `arena/3fdb12d4-cloudhost247`, PR [#62](https://github.com/subwindels-hash/CloudHost247/pull/62)
  (draft, base `main`).
* `84e519b` — audit public site content and navigation claims.
* `a329775` — make sitemap, robots and tool navigation registry-driven and verified.
* This pass adds the crawl-policy unification, the tool-taxonomy reconciliation, the new tests and
  the regenerated outputs; commit hash recorded in the PR timeline.

## 16. Blockers, not verified, and next steps

**Blockers (environment, not code):**

1. **WHMCS staging verification cannot run here.** The root PHP routes need a licensed WHMCS
   runtime and a production-like database. `scripts/staging-preflight.php` and the staging
   evidence tools are ready for that environment; nothing in this pass was deployed.
2. **No browser binary**, so responsive layout, focus order and contrast are asserted from source,
   not observed. A browser pass remains outstanding acceptance evidence.
3. `.php` execution of the *full* sitemap chain (`cloudhost247-sitemap.php` inside WHMCS) is
   source-verified; the policy class itself is exercised directly by the PHP suite.

**Deliberately out of scope for this pass** (still open on the brief):

* the fifteen `includes/legal/*.tpl` documents: their copy is preserved verbatim, but they still
  carry the legacy Bootstrap/WB class soup (`terms-banner`, `inner-policy-section`, `bg-navy`, …)
  that no stylesheet defines. They render as readable plain documents today and are listed as the
  next visual-consistency item;
* per-page PHP visual regeneration beyond the registry-driven illustrations and card grids;
* the illustration expansion (new artwork families) — the existing 161 assets are validated and
  organised, but no new art was commissioned;
* browser-level responsive/accessibility QA (see blocker 2);
* retiring `scripts/generate-global-platform.py`'s legacy `tools-public.json` export: it is now a
  secondary source (the PHP sitemap reads the registry, and the generator validates against the
  theme projection), but nothing has been deleted.
