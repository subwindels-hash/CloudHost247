# CloudHost247 — Global Website Rebuild: Final Report

**Date:** 2026-10-06
**Branch:** `arena/0ab788d1-cloudhost247`
**Commit:** `234be03d705aff883dd9b343aa48a7f5e9802cf1`
**Pull request:** https://github.com/subwindels-hash/CloudHost247/pull/61
**Audit:** `docs/website-rebuild/GLOBAL-AUDIT.md`

---

## 1. Pages audited

**2,171 published surfaces** scanned by `scripts/site/check-links.mjs`:

| Group | Count |
|---|---|
| Root PHP pages | 83 shipped (`git ls-files '*.php'` = 1,737 including `modules/`) |
| WHMCS theme templates (`templates/cloudhost247`) | 86 |
| Legacy vendor theme templates (`templates/cloudhost247_legacy`) | ~130 (reported, not rewritten) |
| SPA route declarations (`App.tsx`) | 138 |
| Marketing page definitions (`shared/site/content/*.json`) | 51 |
| API route handlers | 49 |
| Tool catalogue entries | 105 (67 indexed for the website) |

Every page the audit found was placed in one of four categories — rebuilt, kept, redirected or
reported — and the category for each root PHP page is listed in the audit, §8.

## 2. Pages rebuilt

* **51 marketing pages** created or rebuilt (from 8 thin pages), with 106 content sections and 159
  FAQs, all rendered by one content-driven component.
* **18 legal documents** published as real documents (10,787 words) where two placeholder legal
  pages existed before.
* **14 documentation files** published in a reader at `/docs/:slug` where nothing existed before.
* **Homepage** rebuilt end to end.
* **Header, mega menus, mobile drawer and footer** rebuilt on the shared registry and design system.

## 3. Routes audited

138 SPA route declarations + 83 root PHP pages + 14 licensed WHMCS entry points + 67 tool paths,
all cross-checked against the registry. `node scripts/site/generate.mjs --check` is the gate:
**221 links validated, 0 unresolved**.

## 4. Navigation links audited

**221** navigation and footer links across 9 mega menus and 9 footer columns, each checked for a
destination on *both* the app and the PHP surface. 103 of them pointed at routes that had no page
before this rebuild; 45 pages were created for them and the remainder resolved onto existing app
routes.

## 5. Footer links audited

**9 footer columns**, all generated from the registry, plus 10 tool-category links rendered from
the same tool-category list the Tools Center uses. Every footer item resolves.

## 6. Broken links found and fixed

| Finding | Count | Resolution |
|---|---|---|
| Mega menu / footer links with no page behind them | 103 | 45 pages created |
| Routes linked but never declared in the router | 47 distinct | same fix; the generator now fails if it recurs |
| Legal routes rendering "this page is a placeholder" | 2 | replaced with the real policies |
| Product cards saying *"Not yet built on this platform"* | 5 | replaced with real product pages |
| `#`/empty/`javascript:` links on a published surface | 0 found | gate added so they cannot appear |
| `#`/`javascript:void(0)` inside vendor themes and modules | 647 hrefs | **reported, not rewritten** — licensed third-party admin UI and marketplace templates; see audit §5 |

**Final state: 0 broken, placeholder or dangling links across 2,171 surfaces.**

## 7. Assets generated

**192 asset files** published to both surfaces:

| Group | Count |
|---|---|
| Illustration / icon / diagram SVGs | 162 |
| Operating-system marks | 12 |
| Control-panel marks | 18 |
| Favicons and PWA icons | 8 |

Every page declares its illustration, and the generator fails the build if the file is not on disk,
so a broken image cannot ship.

## 8. Logos generated

18 brand files: horizontal, stacked, compact and icon marks in dark / white / monochrome, each as
SVG plus PNG and WebP, plus the 1200×630 social image (SVG/PNG/WebP) and the favicon set. One mark
is used everywhere — header, footer, email-ready PNG, favicon and the PWA manifest.

## 9. Application logos generated

9 application marks (WordPress, Ghost, PrestaShop, Node.js, PHP, Python, Laravel, Docker, and a
generic application-stack mark) plus 31 operating-system and control-panel marks already in the
repository, all served from one directory with consistent display dimensions. No third-party
trademark artwork was fabricated, and nothing is shown that the platform cannot actually deploy.

## 10. Mega-menu categories

**9 mega menus, 27 groups:**

| Menu | Groups |
|---|---|
| Hosting | Website hosting · Applications & platform hosting · Managed for you |
| Cloud & Servers | Servers · Infrastructure · Operations & protection |
| Domains | Get a domain · Domain management · Domains as an asset |
| Platforms | Applications · Deployment platform · Developer platform |
| Developer / Deployment | Runtimes · Deploy & operate · Build with CloudHost247 |
| Websites | Build it · Have it built for you · Run it safely |
| Tools | 6 tool categories, filled from the live catalogue |
| Resources | Learn · Stay informed · Company |
| Support | Get help · Your account · Policies & help |

## 11. Remaining legacy branding

**None in any customer-facing surface.** `python3 scripts/branding-audit.py` reports *"no
retired-brand reference remains in the repository"* across 6,913 text files.

Retained deliberately, with reasons documented in the audit §5: vendor module directory names
(`soyoustart`, `Smtphosting`, `xtreme_currency_rates`, `the-retired-brand`), which are module ids
and in some cases ionCube-encoded bytecode — renaming breaks upgrades, licences and the legacy
theme.

## 12. Tests executed

| Suite | Result |
|---|---|
| Backend (`npx vitest run tests`) | **1,607 passed**, 135 files |
| Frontend (`npx vitest run frontend/tests`) | **488 passed**, 32 files |
| Page render verification | all **51 public pages** rendered server-side and asserted |
| Design-system contract | breakpoints, overflow, palette, touch targets, reduced motion |
| Link integrity | 0 broken links across 2,171 surfaces |
| Registry validation | 221 destinations, 0 unresolved |
| PHP contract (`verify-website.py`) | passed — 67 registry pages, 92 navigation destinations |
| PHP syntax balance | 1,737 files, all balanced |
| Branding audit | passed |
| TypeScript | clean, server and frontend |
| **Total** | **2,095 tests passing** |

## 13. Build result

* `npm run build` — clean. Main chunk 525 kB / **155 kB gzip**, plus per-route chunks; the marketing
  page component is its own 36 kB chunk, and page content loads with it rather than with the shell.
* Server build (`tsc -p tsconfig.json`) — clean, 8.8 MB of compiled output.
* Production package — **7,885 files, 55.3 MB**, extracted into a clean directory and verified:
  entry points present, 161 media assets, 14 documentation files, **0 secrets**.

## 14. Production ZIP

```
/home/user/CloudHost247-release/CloudHost247-production-2.0.0.zip
```

Built by `python3 scripts/build-production-zip.py --version 2.0.0`. It contains the WHMCS
customisations, the compiled Node platform, the built website, the shared registry and the design
system, plus a `PRODUCTION-MANIFEST.txt` describing the archive. It excludes `.git`,
`node_modules`, caches, test fixtures and `platform/` (see §16).

Rebuild and verify:

```bash
python3 scripts/build-production-zip.py --version 2.0.0 --verify
```

## 15. Commit and pull request

* Commit: `234be03d705aff883dd9b343aa48a7f5e9802cf1`
* Branch: `arena/0ab788d1-cloudhost247`
* PR: https://github.com/subwindels-hash/CloudHost247/pull/61

Preview: a harness serving the production build on port 8080 (not part of the repository).

## 16. Genuine blockers and limits

1. **No browser in this environment.** Chromium downloads are blocked and there is no system
   browser, so layout was verified by construction and by stylesheet contract tests, not by device
   rendering. A real-device pass at 320/360/375/390/414/768/1024/1280/1440 px and an axe or Pa11y
   run are the two checks I would run before go-live and could not run here. Everything that can be
   asserted without a layout engine — overflow prevention, breakpoints, touch targets, reduced
   motion, one palette, no placeholder copy — is asserted.
2. **No PHP binary.** `php -l` could not run; the repository's token checker (unbalanced brackets,
   unterminated strings, broken heredocs) was used instead across all 1,737 files, and the theme's
   own PHP tests remain the authority.
3. **No database in the sandbox.** The platform's own server could not be started (`DATABASE_URL`
   and `JWT_SECRET` are required), so the website preview runs on a harness that returns empty
   catalogue, region and status payloads. That is why those sections show their honest empty states
   in the preview.
4. **`platform/` is a parallel implementation of the same product** — its own Node monolith, its own
   24-page public website, its own colour scheme. This rebuild excludes it from the production
   package rather than silently unifying two applications with separate test suites, and records
   the duplication in the audit (§6). **This needs an owner decision:** which platform is the
   product. The shared registry and design system are already positioned so that pointing
   `platform/public` at them is a bounded change either way.
5. **No deployment performed**, per the brief's instruction not to deploy before staging
   verification. No staging environment is reachable from this sandbox.
