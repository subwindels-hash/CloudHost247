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

**Honest public documentation.** `docs/NODE_PLATFORM_STATUS.md` was published as a public page while
being the internal phase-acceptance ledger (branch names, PR numbers, commit hashes, unexecuted
migrations). It is no longer published; the generator now also prunes de-published documents from
the build output instead of leaving them fetchable.

**Earlier in this PR:** sitemap/robots registry-driven, content and claim audit, navigation
validation for section roots and featured destinations, `PUBLIC_DOC_ROUTES`/`PUBLIC_TOOL_ROUTES`
emitted, PHP Tools mega menu floors, MRZ footer link.

## Verification

| Check | Result |
|---|---|
| `node scripts/site/generate.mjs` (+ `--check`) | 227 links (227 app / 227 PHP), 0 errors, 0 warnings |
| `bash scripts/release-candidate-check.sh` (WASM PHP 8.2) | passed — full PHP lint, 18 PHP suites, server-agent suite, 22 python suites, brand audit, vendor baseline, tools projection + build, website gates |
| `tests/website/run.php` | 97 assertions, 0 failed (41 new crawl-policy/taxonomy assertions) |
| `tests/tools/site-integration.php` | 596 assertions, 0 failed |
| `vitest tests/integration/seo-routes.test.ts` | 6 passed (2 new: one-policy robots, sitemap/policy agreement) |
| `node scripts/site/check-links.mjs` | 2,176 surfaces, 0 broken links |
| `python3 scripts/verify-website.py` | 67 registry pages, 95 destinations, 0 source errors |
| `npm run typecheck` / `npm run build` | clean |

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
