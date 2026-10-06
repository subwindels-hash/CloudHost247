# CloudHost247 website rebuild — implementation and verification report

**Updated:** 2026-10-06 (original rebuild: 2026-10-05)
**Branch:** `arena/ad9fd719-cloudhost247`
**Status:** Source implementation available for review. **Not production accepted or deployed.**

This is a website-wide **WHMCS child-theme implementation**, not a separate demo
application. Original billing, account, domain, catalog, provisioning and Builder
code remains in place. The local preview renders the real new templates but does
not contain the licensed WHMCS runtime or production database.

## Pages

| Requested result | Actual result |
|---|---|
| Total pages found | **54 root PHP entry points**, **701 Smarty templates**, **152 Node frontend route declarations**, in **6,246 original files**. These are separate inventories, not 907 independently public pages. A further 382 literal Node API registrations are recorded in the source audit. |
| Total pages rebuilt | **Homepage + presentation integration for 41 existing registered public PHP routes**, shared CMS/error/Builder layouts, and the global shell inherited by client/authentication/checkout pages. This does **not** mean 701 individual templates or the separate Node dashboard were rewritten. |
| Total pages added | **7 PHP routes:** applications, deployments, operating-systems, server-management, infrastructure, site-search, service-error. Also 5 static error documents. |
| Total pages preserved | **All 54 original root PHP entry points remain.** No protected legacy/vendor file was changed or baseline hash re-cut. |
| Canonical routes | Existing `dedeicated-server.php` → `dedicated-server.php` 301 preserved. Known generic CMS aliases redirect to their registered PHP destination. |
| Legal coverage | 15 legal template names now use the shared reading layout (including the repaired AUP selection); existing policy copy retained. The formerly template-less AUP route is fixed. The refund/cancellation placeholder is replaced by guidance to the existing real Refund Policy. Three CMS-backed legal routes still need published content confirmed on deployment. |

Authoritative source records: `baseline-files.csv`, `baseline-routes.json`,
`baseline-templates.csv`, `baseline-node-routes.json`, `current-files.csv`,
`current-routes.json`, `node-api-routes.json`. Classifications use the requested
20 categories. Dynamic WHMCS/Builder database routes cannot be enumerated as
published HTTP destinations without the deployment database.

## Navigation

| Item | Verification result |
|---|---|
| Mega menu | Six shared multi-column menus: Hosting, Cloud & Servers, Domains, Applications, Developers, Resources. Actual route registry; no hard-coded unsupported app/OS list. |
| Footer | Single grouped first-party footer. **54 unique navigation/footer destinations** pass source validation; licensed core destinations are explicit WHMCS dependencies, not pretend repository files. |
| Mobile navigation | Native disclosure accordions + progressive mobile toggle. All six menus tested for opening, Escape, focus return and overflow at all ten widths: **60 menu checks**. |
| Broken links | **0 source-verification failures** for critical registry navigation and literal assets. **Production HTTP results unknown.** CMS/Builder-authored URLs require staging verification. |
| Existing custom menus | Core/account navbar integrations retained. Reconcile deployment-specific public Theme Manager menus with the new registry when activating the child theme. |

## Assets

Original Orbit vector library: **126 generated files, 462,504 bytes** before its
README. There are no stock photos or invented third-party/customer logos.

| Item | Actual files / implementation |
|---|---|
| Logos | **24 files:** 8 SVG designs/variants with PNG and WebP counterparts; primary, horizontal, compact, icon, dark/white/monochrome treatments. |
| Favicons | **8 files:** ICO, PNG 16/32/48/180/192/512, manifest. Global head includes favicon, Apple touch icon and manifest. |
| Hero images | **2 SVGs:** six-part infrastructure ecosystem and conceptual global connectivity; no location claims. |
| Hosting images | **8 SVGs**, including email, WordPress, cPanel, Plesk, Windows and web hosting. |
| Cloud images | **6 SVGs** for cloud/public/private/VPS/performance/scalability concepts. |
| Server images | **3 SVGs** for dedicated, enterprise and game server concepts. |
| Domain images | **1 SVG** domain-network illustration. |
| Application logos | Reusable neutral **ApplicationLogo** badge; **1 application-stack illustration**. Catalog comes from published backend entries, not fabricated logos or application availability. |
| Deployment/PaaS images | **2 SVGs**, developer hosting and deployment pipeline. |
| OS images | **1 OS-catalog SVG** plus neutral badges for actual verified API-returned image families. No pretend Ubuntu/Windows/provider mappings. |
| Management images | **7 SVGs**, including server control, monitoring, backup, DNS, migration and support. |
| Security / other | **3 security SVGs**, 1 blog illustration, **56 product/utility icons**, **3 social-preview formats**. |
| Invoice/email usage | Compatible PNG exports provided; production invoice/email settings were not changed or visually certified. |

See `assets/images/cloudhost247/README.md` for provenance and regeneration.

## Quality

| Check | Real result |
|---|---|
| PHP lint | Current **797 PHP targets** and the complete release gate passed native **PHP 7.4 and 8.2 GitHub CI** at code commit `9cf1b15` (push and PR). Six follow-up PHP files also linted on PHP 7.4 WebAssembly. Licensed production PHP/ionCube integration still requires staging. |
| Existing PHP/security tests | The native GitHub release gate passed: PHP behavior suites, Python source/staging checks, migration policies, retired-brand scan, vendor integrity and **71 server-agent tests**. The local Python source run passed **423 tests (2 existing skips)**. Static publication guards now follow the shared discovery read model instead of requiring obsolete direct calls in the sitemap; no security checks were removed. |
| New website tests | **53 PHP assertions** on PHP 7.4 and 8.2, 7 Python website tests; theme suite **60 assertions**. No security gate was disabled. |
| Node tests | **1,158 tests across 129 files passed** on Node 22.22.3 in **875.96 seconds**, using `npm test -- --maxWorkers=2`. This supersedes the earlier incomplete run. DNS tests now release Fastify/PGlite resources after every case; all 9 DNS propagation tests passed. No Node application source or test timeout was changed. The **GitHub Node 22.12/24.8 matrix also passed** at `a7da6dc`; the Node tree is byte-identical in the later security-check commit. Head-specific CI reruns must still be green before merge. |
| Build | Server and frontend TypeScript checks, production server/frontend build and compiled-app import passed again. Production dependency audit: **0 vulnerabilities reported**. WHMCS has no standalone frontend compilation step; all 52 real Smarty fixtures rendered successfully. |
| Responsive QA | **52 rendered template scenarios × 10 widths = 520 checks**, covering 320/360/375/390/414/768/1024/1280/1440/1920. **0 horizontal-overflow failures**. Coverage now includes search results, empty/unavailable search, 100-character unbroken queries and long CMS titles. A reproduced 320px query overflow was fixed with scoped text wrapping. Fixture states are not live content certification. |
| Accessibility | Automated axe WCAG 2/2.1 A/AA checks on **16 selected views: 0 detected violations**. Visible focus, skip link, semantic disclosure navigation and reduced-motion rules included. This is not a complete WCAG certification or a screen-reader audit. |
| SEO | Unique registry titles/descriptions, canonical URLs derived from SystemURL, OG/social image, safe WebSite/WebPage JSON-LD, canonical alias redirects, sitemap updates and crawl guidance. Absolute sitemap directives require the real deployment URL. No fake ratings, Offers or certification schema. |
| Broken assets | **0 detected** in source checks and rendered browser fixtures. WHMCS-owned runtime assets and database-authored images require live verification. |
| Broken routes | All original entry-point files and registered new routes exist; dedicated typo redirect retained. **Live HTTP route acceptance not verified.** |
| Branding | Repository-wide retired-brand audit reported **0 matches**. Protected vendor compatibility identifiers and files retained. |
| Security | Existing sessions, authorization, CSRF and checkout handlers retained. New admin actions require capability + token; publishing additionally requires confirmation and is audited. Platform catalog is read-only and does not expose credentials. |

Machine-readable evidence: `verification-summary.json`, `node-verification.json`,
`source-verification.json` and `browser-verification.json`. The Node evidence
includes all 129 test-file counts and a SHA-256 digest of the full local log.
Selected screenshots from the original design verification are in `screenshots/`.

## Follow-up implementation — 2026-10-06

- Search and sitemap now share `PublicDiscovery` and a single page/landing
  publication snapshot. Draft bodies are never hydrated into that read model.
- Published custom pages, landing pages and translations are discoverable;
  canonical registered URLs are not duplicated. A published entry wins over an
  unpublished page/landing collision; the lowest-ID published entry is selected
  consistently with the actual page renderer.
- Existing non-CMS policy routes remain discoverable. The three CMS-only legal
  routes still require actual publication; no policy content was generated.
- Search fails closed with an unavailable state, HTTP 503 and retry guidance on
  a content/translation lookup failure. Search responses are non-cacheable and
  noindex. Sitemap opt-out is preserved, but is not treated as access control.
- The initial follow-up CI run correctly failed two static assertions that still
  expected direct repository calls in the sitemap. The guards were updated to
  inspect the complete route → discovery → publication-query chain, with an
  additional failure-path guard. The subsequent native PHP matrix passed.
- Changes are delivered on the same branch in draft
  [PR #56](https://github.com/subwindels-hash/CloudHost247/pull/56).
  Nothing was merged or deployed.

## Remaining blockers — production acceptance is not complete

1. This repository does not contain WHMCS `init.php`, licensed parent/runtime,
   the production database, product/currency mappings, or provider credentials.
   Live login/register/reset, payment, cart, client-area and provisioning flows
   therefore have **not** been certified.
2. `https://rent.windelsai.com/` could not be reached from the sandbox: its TLS
   connection failed again on 2026-10-06 (`curl` exit 35, HTTP 000). No TLS
   verification bypass or live deployment was performed.
3. Confirm published Terms of Service, Legal Notice and Data Protection Standards
   in Theme Manager. Explicit unpublished content remains unpublished; prices,
   legal terms and infrastructure claims were not invented to fill gaps.
4. Configure/verify the optional Node reverse-proxy mount and router base before
   enabling live app/OS browsing. The separate Node frontend was not globally
   redesigned by this WHMCS theme change. The full local Node suite now passes;
   the required GitHub Node matrix must also be green before merging.
5. Configure actual invoice/email logo settings, server-level error responses and
   absolute sitemap declarations. Verify active parent-theme compatibility,
   language/currency controls, custom navigation and Builder-authored URLs.
6. Perform authenticated staging visual/functional QA and full runtime crawling
   before merging/deploying. Site search covers registered pages, published CMS pages/landings and native KB
   search, not a cross-platform index of private account records.

**Do not describe this report as “all acceptance criteria complete.”** It records
implemented code, passing source/template checks and the exact remaining runtime
acceptance work. Deployment steps and rollback are in `DEPLOYMENT.md`.
