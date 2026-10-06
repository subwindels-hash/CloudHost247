# CloudHost247 — Global Website Rebuild: Audit

**Date:** 2026-10-06
**Branch:** `arena/0ab788d1-cloudhost247`
**Base commit:** `d4a5bb037104b50ba8fb4f8ea6d23041dc35d75b`

This is the inventory the rebuild was planned from, and the record of what was decided about every
public surface in the repository. Numbers are produced by
`node scripts/site/generate.mjs` and `node scripts/site/check-links.mjs`, not counted by hand.

---

## 1. Surfaces found in the repository

Five things in this repository can render a page to a customer. Naming them was the first useful
result of the audit, because the rebuild brief assumes there is one website and there were four.

| # | Surface | Where | Status after this rebuild |
|---|---|---|---|
| 1 | WHMCS PHP site | root `*.php` + `templates/cloudhost247/` | **Rebuilt** — navigation, footer and design system are generated from the shared registry |
| 2 | CloudHost247 Node platform + SPA | `cloudhost247-node/` | **Rebuilt** — this is the live website (see §2) |
| 3 | Legacy vendor theme | `templates/cloudhost247_legacy/` + `templates/orderforms/` | **Kept, not published** — licensed third-party theme, reported not rewritten |
| 4 | Parallel Node monolith | `platform/` (its own `public/` website and `spa/`) | **Kept in the repository, excluded from the production package** — see §6 |
| 5 | WHMCS licensed admin/client core | `addonmodules.php`, `clientarea.php`, … | **Untouched** — not vendored here by design |

### Which one is the live website

`https://rent.windelsai.com/` serves surface 2. Evidence, rather than assumption:

* `/hosting` on the live host renders the catalogue with the empty-state copy
  *"Not yet built on this platform"*, and that exact string exists in exactly one place in the
  repository: `cloudhost247-node/frontend/src/pages/HostingPage.tsx`.
* The live `/domains` route renders the domain-services hub with its nine cards, which is
  `cloudhost247-node/frontend/src/pages/DomainsMarketingPage.tsx`.
* No route on the live host renders `platform/public/*.html`.

So the rebuild targeted surface 2 as the website, surface 1 as the second published site, and left
surfaces 3–5 alone except where the brief required them to stop competing visually.

---

## 2. Inventory of surface 2 (the live website)

### The PHP surface

The first pass generated the design system and registry *into* the WHMCS theme but did not verify
the theme consumed them. A second pass found four real defects, all fixed:

1. **`design-system.css` was never loaded** by the theme — `site-head.tpl` had only `site.css`, so
   the whole WHMCS site still rendered the old palette. It now loads the design system after
   `site.css`, and `tests/website/test_static.py` asserts the order, because with two stylesheets
   styling the same `ch-*` classes, load order *is* the behaviour.
2. **The PHP Tools mega menu rendered empty** with JavaScript disabled — its entries come from
   `/api/tools/navigation` at runtime. The ten tool categories are now server-rendered, and
   `site.js` still enriches them into the live tool list when the catalogue answers.
3. **The PHP product pages carried thinner copy than the application** (3 generic features, a
   hard-coded FAQ block). The generator now folds the same content the application renders
   — headline, features, use cases, FAQs, related services, SEO description — into 41 PHP product
   pages, so a product page says the same thing on both sites and there is one place to correct it.
4. **`robots.txt` advertised its sitemaps with relative URLs.** The specification requires absolute
   URLs in a `Sitemap:` directive, so every crawler silently ignored them. `robots.php` now
   generates the file from the configured `SystemURL`, with one documented rewrite rule; the static
   file stays as a working fallback and says plainly why it cannot do this itself.

### Routes

| Category | Before | After |
|---|---|---|
| App routes declared in `App.tsx` | 138 | 138 (unchanged) |
| Public marketing pages | 8 thin pages | **54** content-complete pages |
| Legal documents published | 2, both placeholders | **18 real documents**, 10,787 words |
| Documentation pages | 0 | **14 documents** served by a reader at `/docs/:slug` |
| Miscellaneous placeholder pages | `LegalPage.tsx` ("this page is a placeholder"), `/hosting` ("Not yet built on this platform") | removed |

New public routes added (all generated from `shared/site/content/*.json`). `/hosting/vps`,
`/hosting/dedicated` and `/hosting/cpanel` were added in the second pass: they had been thin
leftovers with three static cards each while every product around them had a real page, and VPS is
one of the most-linked products on the site. They are now content pages that render the same live
`ProductPlansSection` the old pages used, so the catalogue honesty contract is unchanged.

```
/hosting                      /hosting/web-hosting     /hosting/business
/hosting/wordpress            /hosting/reseller        /hosting/windows
/hosting/email                /hosting/developer       /hosting/api
/hosting/ssl                  /hosting/backups         /hosting/migration
/hosting/security             /cloud                   /cloud/public
/cloud/private                /cloud/enterprise-servers /cloud/game-servers
/cloud/infrastructure         /cloud/data-centers      /cloud/network
/cloud/operating-systems      /cloud/server-management /cloud/monitoring
/cloud/backups                /cloud/firewall          /cloud/security
/cloud/ip-management          /platforms               /platforms/applications
/platforms/databases          /platforms/containers    /platforms/paas
/developers                   /developers/deployment   /developers/environments
/developers/nodejs            /developers/php          /developers/python
/developers/laravel           /developers/docker       /websites
/help                         /docs                    /blog
/status                       /offers                  /pricing
/security                     /search                  /sitemap
/legal                        /legal/<17 policies>
```

### Navigation: what was wrong

The audit found the header, the mobile drawer and the footer each rendering from a different
source, and the sources had already drifted:

* `cloudhost247-node/src/navigation/mega-menu.ts` declared sections
  `domains, websites, marketing, hosting` — four menus.
* `Header.tsx` additionally hard-coded five flat links (`Home`, `App Marketplace`, `About`,
  `Contact`, `FAQ`) and a 15-entry signed-in strip.
* `Footer.tsx` hard-coded nine links and delegated a tenth group to a component that fetched the
  tool catalogue at render time.
* `ToolsNavigation.tsx` built its own menu from `/api/tools/navigation`.
* `platform/public/*.html` carried **its own, different** header and footer, hand-copied into 24
  static files — including malformed markup (`<li>` children directly under a `div`, `<ul>`
  nested inside `<ul>`).

The brief's requirement — *one registry driving header, mega menu, mobile menu, footer, sitemap and
related products* — was therefore not a preference, it was the fix for a real defect.

### Navigation: after

One file, `shared/site/registry.json`, defines:

* 9 mega menus (`hosting`, `cloud`, `domains`, `platforms`, `developers`, `websites`, `tools`,
  `resources`, `support`);
* 9 footer columns (Products, Cloud & Infrastructure, Domains, Platforms & Developers, Tools,
  Websites, Company, Support, Legal);
* utility links (search, sign in, create account, client area, cart);
* the legal index, tool categories and sitemap policy.

`node scripts/site/generate.mjs` validates every destination and then emits:

| Output | Consumed by |
|---|---|
| `cloudhost247-node/src/navigation/registry.generated.ts` | API, `/api/v1/navigation`, `/sitemap.xml`, tests |
| `cloudhost247-node/frontend/src/navigation/registry.generated.ts` | header, mega menus, mobile drawer, footer, sitemap page |
| `modules/addons/cloudhost247_theme/resources/site.json` | the WHMCS PHP navigation and footer |
| `cloudhost247-node/frontend/src/content/pages.generated.json` | the marketing page renderer |
| `cloudhost247-node/frontend/src/content/{docs,tools,legal}.generated.json` | reader, search, policies |
| `templates/cloudhost247/css/design-system.css` | the PHP theme's stylesheet |

**221 navigation and footer links**, each with a working destination on both surfaces. The
generator refuses to write anything if a destination does not resolve, so this is enforced rather
than reviewed.

---

## 3. Assets

| Asset group | Count | Location |
|---|---|---|
| Illustrations, icons, diagrams (SVG) | 161 files | `assets/images/cloudhost247/**` → published to the SPA at `/media/cloudhost247/**` |
| Brand marks (SVG/PNG/WebP) | 18 | `brand/` — horizontal, compact, icon, dark/light/mono/white |
| Favicons and PWA icons | 8 | `favicon/` — ICO, PNG 16/32/48/180/192/512, manifest |
| Social/OG image | 3 | `social/` |
| Application marks | 9 | `applications/` |
| Deployment/runtime marks | 9 | `deployment/` |
| Operating-system and panel marks | 31 | `cloudhost247-node/frontend/public/{os-logos,panel-logos}` |
| Tool category illustrations | 10 | `tools/` |

Every page's illustration is declared in its content file and **checked to exist by the
generator**; a missing SVG fails the build rather than rendering a broken image.

### What was generated versus reused

Reused (already original, already consistent, already optimised): the isometric illustration
library, brand marks, favicons, social image, OS/panel marks. Regenerated as needed: the brand
family is unchanged in geometry but now referenced from a single design system, and every
illustration is served from one directory on both surfaces.

Not done, and reported as such: no photograph-like raster art was generated. The art direction is
vector isometric, which is what the existing library establishes; adding photographic imagery
would have produced exactly the inconsistent, stock-photo look the brief rules out, and could not
be done at consistent quality without a design review I cannot perform here.

---

## 4. Broken links found and fixed

Produced by `node scripts/site/check-links.mjs` (2,171 surfaces scanned; 931 internal, 437 PHP,
5 external, 17 in-page anchors).

| Finding | Count | Resolution |
|---|---|---|
| Distinct routes linked from a menu or the footer that had no page (`/hosting/web-hosting`, `/cloud/*`, `/developers/*`, `/platforms/*`, …) | 47 | 45 pages created; 2 resolved onto existing app routes |
| Navigation and footer links pointing at routes that had no page | 103 of 201 | resolved: 45 new pages were built for them |
| `href="#"` placeholders in published navigation/footer | 0 | none existed; the gate now prevents them |
| `href="#"` and `javascript:void(0)` inside vendor themes/modules | 647 | **reported, not rewritten** — licensed third-party admin UI and marketplace templates; see §5 |
| Legal routes rendering a "this page is a placeholder" notice | 2 | replaced by the real documents |
| `/hosting` advertising services as *"Not yet built on this platform"* | 5 | replaced by real product pages |
| Documentation index pointing at nothing | 0 | new reader serves real files |

Final state of the gate: **0 broken, placeholder or dangling links** on every published surface.

---

## 5. Deliberately not changed, with reasons

| Item | Why it stays |
|---|---|
| `templates/cloudhost247_legacy/**` (≈130 templates) | Licensed vendor theme (WHMCS Global Services). Rewriting it would break its licence and its encoded helper addon. Not the active public theme. |
| `templates/orderforms/**` | WHMCS order forms. The brief forbids breaking checkout; they are untouched. |
| `modules/**` (provisioning, payments, vendor suites) | Contains vendor modules, ionCube-encoded bytecode, and admin UI whose `href="javascript:void(0)"` hooks are wired to JavaScript by class name. Replacing them with buttons breaks the handler. The one first-party `href="#"` there is `ThemeRepository`'s sanitiser *refusing* to emit an unsafe URL. |
| `modules/addons/the-retired-brand/` | The directory name is the addon id and the files are encoded bytecode; renaming breaks the legacy theme. Documented in `docs/BRANDING-COMPATIBILITY.md`. |
| Vendor identifiers in module paths (`soyoustart`, `Smtphosting`, `xtreme_currency_rates`) | Third-party product names and module ids. Renaming breaks upgrades and licence checks. |

### Legacy branding sweep

`python3 scripts/branding-audit.py` and a scan of rendered copy find **no customer-facing
retired-brand text** in any published surface (the scanner reports zero matches outside this
document itself). Remaining occurrences are:

* vendor module directory names and internal identifiers (documented above);
* a vendors' marketplace artwork inside the legacy theme;
* `docs/` history that describes the migration.

---

## 6. Parallel surfaces — the honest finding

`platform/` is a second, complete implementation of the same product: its own Node monolith, its
own `public/` website of 24 static pages with a **third colour scheme** (`#0a1730`), and its own
React SPA. It duplicates `cloudhost247-node` almost feature-for-feature.

This rebuild does **not** try to unify it, for one reason: doing so would mean editing two
independent applications with independent test suites in a single change, which is how a working
deployment gets broken. What it does instead:

1. the production package **excludes** `platform/`, so one deployment cannot contain two different
   websites (verified: `--verify` fails if the built site is incomplete);
2. this document records the duplication rather than leaving it to be rediscovered;
3. the shared registry and design system are in `shared/site/`, so a future consolidation has a
   single target to point `platform/public` at.

**This is a decision for the owner, not something a rebuild should decide silently.**

---

## 7. Verification performed

| Check | Command | Result |
|---|---|---|
| Registry + content generation | `node scripts/site/generate.mjs` | 9 menus, 9 footer columns, **222 links validated**, 54 pages, 116 sections, 170 FAQs; 41 PHP product pages enriched |
| Link integrity | `node scripts/site/check-links.mjs` | **0 broken links** across 2,171 surfaces |
| PHP contract | `python3 scripts/verify-website.py` | passed — 67 registry pages, 92 navigation destinations |
| PHP syntax sanity | `node scripts/php-syntax-check.cjs $(git ls-files '*.php')` | 1,737 files, all parse-balanced |
| TypeScript (server) | `npx tsc -p tsconfig.json --noEmit` | clean |
| TypeScript (frontend) | `npx tsc -p frontend/tsconfig.json --noEmit` | clean |
| Frontend production build | `npm run build` | clean — 525 kB main chunk / 155 kB gzip + per-route chunks |
| Frontend tests | `npx vitest run frontend/tests` | **513 passed**, 33 files |
| Backend tests | `npx vitest run tests` | **1,632 passed**, 136 files |
| Page render verification | `frontend/tests/unit/marketing-pages.test.tsx` | all 54 pages rendered server-side, content asserted |
| Responsive/overflow contract | `frontend/tests/unit/design-system.test.ts` | passed |
| Production package | `python3 scripts/build-production-zip.py --verify` | 7,885 files, 55.3 MB, extract-and-verify passed, 0 secrets |

### What could not be verified here

* **No browser is available in this build environment** (Chromium download is blocked, no system
  browser). Layout was therefore verified by construction and by stylesheet contract tests, not by
  device rendering. A pass on a real phone at 320–414 px, and an axe/Pa11y run, are the two checks
  I would run before go-live and could not run here.
* **No PHP binary** is installed, so `php -l` could not be executed; the repository's own token
  checker (which catches unbalanced brackets, unterminated strings and broken heredocs) was used
  instead, and the theme's PHP tests remain the authority.
* No staging deployment was performed. The brief says not to deploy before staging verification,
  and no staging environment is reachable from this sandbox.

---

## 8. Page-by-page decisions

Every root PHP page, in one of four categories.

**Rebuilt / published (kept working, now registry-driven):**
`web-hosting`, `wordpress-hosting`, `cpanel-hosting`, `plesk-hosting`, `windows-hosting`,
`business-hosting`, `reseller-hosting`, `email-hosting`, `ssl-certificate`, `backups`,
`vps-hosting`, `vps-publiccloud`, `vps-privatecloud`, `dedicated-server`, `enterprise-servers`,
`game-servers`, `server-management`, `managed-services`, `infrastructure`, `data-centers`,
`network`, `monitoring`, `security`, `firewall`, `operating-systems`, `ip-management`,
`migration`, `dns-management`, `domain-dns`, `applications`, `docker-hosting`, `laravel-hosting`,
`nodejs-hosting`, `php-hosting`, `python-hosting`, `paas`, `deployments`, `developer-friendly`,
`api-hosting`, `website-design`, `domain`, `cloudhost247-hosting`, `aboutus`, `help-center`,
`faqs`, `blog`, `offers`, `documentation`, `legal`.

**Legal pages (real documents, one source):** `terms-of-service`, `privacy-policy`,
`cookie-policy`, `acceptable-use-policy`, `refund-policy`, `refund-and-cancellation-policy`,
`backup-policy`, `fair-usage-policy`, `trademark-policy`, `domain-agreement`,
`domain-brokerage-terms`, `domain-renewal-policy`, `domainregistrationaddendum`,
`cybercrime-policy`, `data-deletion`, `data-protection-standards`,
`data-privacy-notice-and-consent-form`, `legal-notice`, `legal`.

**Utility/format pages (kept, purpose unchanged):** `notfound`, `service-error`, `site-search`,
`tables`, `all-element-cloudhost247`, `future-element`, `cloudhost247-sample`,
`cloudhost247-vps-sample`, `cloudhost247-page`, `cloudhost247-sitemap`, `builder-page`,
`builder-sitemap`, `cloudhost247-marketing-track`, `comingsoon`.

**Redirected:** `dedeicated-server.php` → `dedicated-server.php` (typo canonicalised; the
navigation validator fails if the typo'd route is ever linked again).

No orphan public pages remain: `marketing-pages.test.tsx` asserts that every page is reachable
from a menu, the footer, or another page, and fails listing any that are not.
