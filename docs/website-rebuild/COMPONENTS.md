# Architecture and component map

## Before / after

The baseline is commit `bb7598c14189ed5883d087e18c4832fdbfe6ed1b`.
`baseline-files.csv` records the actual tree and SHA-256 of each original file;
`baseline-routes.json`, `baseline-templates.csv` and `baseline-node-routes.json`
record the route/template surface found before implementation. This supersedes
any assumption that an older page list was complete. Counts are different units:
PHP entry points, Smarty templates and React routes are not interchangeable.

The existing child theme inherited its header/footer from the installed
Twenty-One parent. Several custom legal templates existed only in the protected
legacy theme. Many product routes depended entirely on published database copy.
The rebuilt child now owns the global shell and the custom public templates;
WHMCS still owns authentication, billing, checkout and service authorization.

## Reusable parts

| Component | Source / behavior |
|---|---|
| Registry | `modules/addons/cloudhost247_theme/resources/site.json`: 46 editorial page definitions, six mega menus, grouped footer; no prices or provider IDs |
| Context / publication | `lib/Site.php`, `lib/PublicPage.php`, existing `ThemeRepository`; published overrides, explicit unpublished states, neutral absent-record editorial fallback |
| Header | `templates/cloudhost247/header.tpl`; retains captcha, head/body hook outputs, account notifications, switching, masquerading, sidebars, verification notices |
| Navigation | `includes/site-nav.tpl`; native disclosures, mobile toggle, escaped data, actual account destinations |
| Footer | `includes/site-footer.tpl`; one route-backed footer; footer.tpl retains WHMCS AJAX/localisation/password-generator modals |
| Design tokens | `css/site.css`; ink/mint palette, spacing, buttons, cards, typography, responsive grids, visible focus, RTL/reduced-motion rules |
| Product hero | `includes/product-hero.tpl`; product-specific image and registered content |
| Plans | `includes/product-plans.tpl`; existing Builder product reader, escaped values and honest unavailable/empty states |
| Features / related services | Shared page template + registry; not duplicated into root route files |
| FAQ | Native details/summary product FAQ and public FAQ template; existing email FAQ content is retained |
| CTA | `includes/site-cta.tpl`; consistent primary/secondary action treatment |
| Legal | `includes/legal-layout.tpl`, `includes/legal/*.tpl`; pre-existing policy content in a shared reading layout |
| ApplicationLogo | Neutral text badge in `js/site.js` and `includes/application-logo.tpl`; no fabricated third-party mark |
| OS / application cards | `cloudhost247-platform.tpl`, `site.js`; read-only existing public platform APIs, no example catalog or fake controls |
| Search | `PublicDiscovery`, `ThemeRepository::publicPageIndex`, `site-search.php`, `cloudhost247-search.tpl`; publication-aware page/landing discovery, bounded results and real WHMCS KB form |
| Errors | `cloudhost247-error.tpl`, `error/page-not-found.tpl`, `access-denied.tpl`, `service-error.php`, static `errors/*.html` |
| SEO | `includes/site-head.tpl`, Site context, canonical generic-route redirects, sitemap and robots; no invented review/offer structured data |
| Builder | Existing published parts win on Builder pages; core schema, renderer, form processing and visibility unchanged |
| Checkout | Existing `standard_cart` inheritance + child CSS; checkout form fields, tokens and processing not replaced |
| Client / authentication | Existing Twenty-One inheritance + global shell/tokens; authentication, registration, reset, invoice and service templates not rewritten into mockups |

## Source provenance and compatibility

The new shell preserves the documented integration contract of WHMCS's
Twenty-One header/footer. The reference used for that contract was
`WHMCS/templates-twenty-one` at
`d8a5aba3a739ecbc1e75f1238995750ea21f89cf`. The parent is still installed and licensed
with WHMCS; it has **not** been vendored into this repository. Check the installed
WHMCS version's matching templates when upgrading. Modals retain their required
IDs/classes; localisation items are buttons rather than dummy links, and the
parent's `.item-selector .item` handler supports them.

No file in `templates/cloudhost247_legacy` or another protected vendor baseline
was edited. The integrity manifest was not re-cut. A small number of legal
presentation fragments were copied into the first-party child and stripped of
legacy inline styling/stock imagery; the actual original files remain available.
The existing first-party brokerage escaping was retained, not replaced with a
less-safe legacy version.

The tests that inspected a monolithic page template were updated to inspect its
now-extracted product/legal fragment as well. Their escaping/required-content
assertions were retained. All existing release/security checks remain enabled;
the website gate is additive. `PHP_LINT_JOBS` only controls lint concurrency and
does not exclude targets or convert failures to success.

## Deliberately not advertised

No new unsupported GPU/compute, reseller plan, region, runtime, app family,
provider image, monitoring service or data-center count is advertised as live.
Catalog headings may explain an existing service route without asserting that a
particular purchasable configuration exists. The real plans/configurations are
authoritative. Careers/partners/tutorial routes were not fabricated simply to
fill a footer column.

## Tests and how to reproduce

- `python3 scripts/inventory-website.py`: current Git-visible source inventory.
- `python3 scripts/verify-website.py`: fail on invalid critical navigation URLs,
  deleted baseline routes, unresolved registered page images and literal assets.
- `php tests/website/run.php`: editorial/draft precedence, unsafe mount rejection,
  safe JSON-LD, fail-closed DB behavior, explicit draft publication, canonical
  discovery, published custom pages/landings, translation visibility, slug
  collisions, sitemap opt-out, missing optional fields and the 40-result limit.
- `python3 -m unittest tests/website/test_static.py`: link mutation tests, parent
  hook contracts, Builder precedence and read-only API use.
- `tests/website/render-fixtures.php`: real Smarty rendering of shipped templates
  with honest empty/no-runtime states; not a production WHMCS emulator.
- `tests/website/render-shell.php`: guest/authenticated shell contract rendering
  against real upstream includes and test doubles for framework functions. Core
  authentication is not exercised. Generic Smarty 4 reports expected deprecations
  for framework-provided functions; WHMCS supplies their production integration.
- `tests/website/browser.cjs`: actual Chromium rendering, 10 widths, menu/Escape,
  image/H1/shell/overflow assertions, all six menus at every width, search-state
  and long-query regressions, selected axe WCAG A/AA checks.

Fixture tools use environment paths for Smarty, a disposable output directory,
Playwright/Chromium and axe. No fixture is a production page or substitutes for
`init.php`. The local preview server only serves rendered fixtures and an explicit
allowlist of theme assets; it never exposes PHP sources or configuration files.

Follow-up CI publication checks in `tests/foundation/test_static.py` and
`tests/security/test_security.py` inspect the full route → shared discovery →
repository publication chain. The original publication, sitemap opt-out, XML
escaping and canonical checks remain enforced; the PHP behavior suite additionally
exercises draft and database-failure paths with the actual repository classes.
