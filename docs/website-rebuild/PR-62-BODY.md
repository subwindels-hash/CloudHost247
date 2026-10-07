# Public website rebuild — registry-driven navigation, tools, sitemaps and crawl policy

Branch: `arena/3fdb12d4-cloudhost247` · Draft · Base `main`
Full report: `docs/website-rebuild/FINAL-REPORT.md` · Evidence: `docs/website-rebuild/verification-2026-10-07.json`

The public site is now driven by one source of truth (`shared/site/registry.json` → generated
projections) across the WHMCS/PHP surface and the Node/React platform, with the crawl policy, the
tool taxonomy and every navigation destination verified by gates instead of by hand.

## What this PR changes

**One crawl policy, four consumers.** `sitemap.exclude` (29 app destinations) and
`sitemap.excludePhp` (23 PHP/WHMCS paths) are the only place crawl exclusions are authored. The
Node `/robots.txt`, the generated static `robots.txt`, `robots.php` and all three PHP sitemaps read
them, so a URL can no longer be listed in a sitemap and disallowed in robots.txt at the same time:

* `cloudhost247-sitemap.php` no longer advertises session-gated PHP routes (`submitticket.php` was
  listed while robots.txt disallowed it);
* sitemap endpoints are no longer disallowed (a blocked sitemap cannot be fetched, which silently
  voids the `Sitemap:` directive) — they send `X-Robots-Tag: noindex` instead;
* the static `robots.txt` disallowed `/cloudhost247-page.php`, the canonical URL of every
  CMS-authored page the sitemap lists — that route stays crawlable;
* Node `/robots.txt` now publishes **both** halves of the policy with root-relative rules (a
  registry entry written `admin/` previously produced the invalid `Disallow: admin/`);
* `robots.php` and the sitemaps read a new `CloudHost247\Theme\CrawlPolicy` whose compiled fallback
  must equal the registry (asserted), instead of each keeping a hand-written list;
* the build fails if the policy excludes a registered public page, a published tool category or a
  sitemap endpoint.

**One published tool taxonomy.** The menus advertised nine discovery categories while the native PHP
catalogue, the tools hub and `tools-sitemap.php` used the engine grouping (`dns`, `ip`, `designer`,
`gaming`, …); eight published category URLs resolved only through the theme fallback, and the
sitemap advertised nine category URLs no navigation linked to. Now `/tools/category/<discovery-slug>`
resolves in the native engine, the hub navigation and tool breadcrumbs publish the discovery
categories, the sitemap lists them, and the generator asserts parity between the registry,
`src/tools/catalog.ts` and the theme projection `tools.json` (including ≥1 tool per category).

**One rendered section system, taken from the design system.** Registry content reached the
application but not the PHP pages: 67 pages carried a `sections` array that nothing rendered. The
pages now render it through one partial (`includes/product-sections.tpl`, 82 sections across 39
pages: features 37, note 21, checks 9, steps 8, cards 4, split 3). The first version invented its own
`.ch-card-grid` / `.ch-steps` / `.ch-note` classes in `site.css` — which lost the cascade, because
`includes/site-head.tpl` loads `site.css` and then `design-system.css`, and the design system wins
every name the two share. It was rewritten onto the design-system primitives (`ch-section`,
`ch-grid--3`, `ch-card`, `ch-step`, `ch-check-list`, `ch-note`, `ch-split`, `ch-visual`) and the
duplicate block was removed; the three genuinely missing component rules (icon image sizing, a
points list, a light illustration frame) were added to the design system source, which is also what
the React side reads. `tests/website/run.php` now fails if the renderer uses a class the site does
not ship or one that does not belong to the design system, and the fixture QA fails on any rendered
`ch-`/`ch247-` class no stylesheet defines.

**One URL per tool capability.** The shared registry and the native catalogue slugged the same tools
differently, so 18 capabilities were published twice — two indexable pages with one title, the
second rendered by the theme fallback with no implementation behind it (`/tools/whois` +
`/tools/domain-whois`, `/tools/ssl-checker` + `/tools/ssl-certificate-checker`, …). The registry
entries now carry the served path with the previous path kept as an alias, so the existing redirect
resolves one URL per capability; the tools suite fails if that ever drifts again. The 30 routes only
the platform application implements are no longer presented as working tool pages: they send
`X-Robots-Tag: noindex`, publish no canonical and link to the platform route they describe.

**What a page tells a crawler, checked per page.** The fixture harness renders the shipped
`site-head.tpl` rather than a hand-written head, and the QA now asserts, on all 218 rendered pages,
the stylesheet order, one non-empty `<title>`, a description, and the rule that a page is either
indexable with a canonical and parseable JSON-LD or explicitly `noindex`. Two defects came out of
it: `notfound.php` was indexable without a canonical, and the tool duplication above showed up as 17
pairs of indexable pages sharing a title. `css/tools.css` also gained the `prefers-reduced-motion`
block it was missing, and `ch-tool-explain` — rendered by every native tool page — is now styled.

**The legal documents rebuilt onto the design system.** The fifteen `includes/legal/*.tpl` documents
carried a parallel legacy vocabulary — Bootstrap grid classes, old theme blocks (`terms-banner`,
`bg-navy`), icon-font markup and `btn btn-primary` — that no stylesheet defines, plus a title banner
repeating the heading the layout already renders and a heading outline jumping from `h1` to `h3`.
They now use the design system, with fragment anchors kept as `<section>` elements, document cards
in `legal.tpl` and a real checklist on the consent page, whose "Submit Consent" button posted to a
form nothing handles. Copy is untouched and verified: 214 of 218 rendered pages have byte-identical
visible text, and the four that differ lost exactly their duplicate title.

**Honest public documentation.** `docs/NODE_PLATFORM_STATUS.md` was published as a public page while
being the internal phase-acceptance ledger (branch names, PR numbers, commit hashes, unexecuted
migrations). It is no longer published; the generator prunes de-published documents from the build
output, and `build-production-zip.py` now compares the packaged documentation set against the
generated index — a de-published document left in a stale build directory fails the archive instead
of shipping (two such copies were found in the previous archive and are gone).

**Earlier in this PR:** sitemap/robots registry-driven, content and claim audit, navigation
validation for section roots and featured destinations, `PUBLIC_DOC_ROUTES`/`PUBLIC_TOOL_ROUTES`
emitted, PHP Tools mega menu floors, MRZ footer link.

## Verification

| Check | Result |
|---|---|
| `node scripts/site/generate.mjs` (+ `--check`) | 227 links (227 app / 227 PHP), 0 errors, 0 warnings |
| `bash scripts/release-candidate-check.sh` (WASM PHP 8.2) | passed — full PHP lint, 18 PHP suites, server-agent suite, 22 python suites, brand audit, vendor baseline, tools projection + build, website gates |
| `tests/website/run.php` | 315 assertions, 0 failed (sections, fragments, crawl policy, taxonomy, design-system class contract) |
| `tests/tools/site-integration.php` | 650 assertions, 0 failed (adds one published path per tool capability) |
| `python3 -m unittest discover -s tests/website -p 'test_*.py'` | 13 tests OK |
| `tests/website/render-fixtures.php` + `check-fixtures.py` | 218 pages, 2,492 asset references, 53,778 links, 116 classes, 182 indexable / 36 noindex, **0 problems** |
| `vitest tests/integration/seo-routes.test.ts` | 6 passed (2 new: one-policy robots, sitemap/policy agreement) |
| `node scripts/site/check-links.mjs` | 2,176 surfaces, 0 broken links |
| `python3 scripts/verify-website.py` | 67 registry pages, 95 destinations, 0 source errors |
| `npm test` (cloudhost247-node) | 136 test files, 1,636 tests, 0 failures |
| `npm run typecheck` / `npm run build` | clean |
| `python3 scripts/build-production-zip.py --skip-build --verify` | 7,888 members, 57,870,228 bytes, 161 media assets, 13 published documents, 0 secret matches, extraction verified |

Investigated and **not** changed: `/tools/dns-checker`, `/tools/ssl-certificate-checker` and
`/tools/json-beautifier` on the homepage are reachable and functional on the PHP surface (native
catalogue, handlers `dns_checker` / `ssl` / browser-local). The earlier "broken" report came from
checking the theme fallback catalogue only.

## Not verified / not deployed

* No production deployment: WHMCS staging verification is required and cannot run in this
  environment (no licensed runtime, no production database, no browser binary).
* Browser-level responsive and accessibility QA remains outstanding; layout, focus order and
  contrast are asserted at source level only.
* Per-page PHP visual regeneration and new illustration artwork remain out of scope for this pass.
