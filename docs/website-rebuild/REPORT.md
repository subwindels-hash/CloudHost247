# CloudHost247 website rebuild — implementation and verification report

**Date:** 2026-10-05
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
| Mobile navigation | Native disclosure accordions + progressive mobile toggle. Opening/Escape/focus behavior tested in Chromium at 375px and 1440px. |
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
| PHP lint | Final full release run linted **796 PHP targets on PHP 8.2 WebAssembly**, all passed. All **19 changed/added PHP files** and the website/theme behavior suites also passed PHP 7.4 WebAssembly checks. Native production PHP/ionCube runtime still requires staging. |
| Existing PHP/security tests | `scripts/release-candidate-check.sh` passed: existing PHP behavior suites, **422 Python tests (2 existing skips)**, 6 staging-tool tests, migration policies, retired-brand scan, vendor integrity and **71 server-agent tests**. New website checks are additive. The final release run includes the extracted presentation fragments and explicit draft-publication flow. |
| New website tests | **20 PHP assertions**, 7 Python website tests; theme suite **60 assertions**. No security gate was disabled. |
| Node tests | **32 focused catalog/protocol tests passed**. The complete Node run did **not** finish within the tool timeout; its partial output included a DNS propagation failure under load. It was stopped and is **not reported as passing**. No Node application source was modified. |
| Build | Existing Node `npm run typecheck` and production `npm run build` passed. WHMCS has no standalone frontend compilation step; real Smarty fixture rendering passed. |
| Responsive QA | **48 rendered template scenarios × 10 widths = 480 checks**, covering 320/360/375/390/414/768/1024/1280/1440/1920. **0 horizontal-overflow failures**. Empty/unpublished/legal-dependent scenarios are explicitly fixture states, not live content certification. |
| Accessibility | Automated axe WCAG 2/2.1 A/AA checks on **12 selected views: 0 detected violations**. Visible focus, skip link, semantic disclosure navigation and reduced-motion rules included. This is not a complete WCAG certification or a screen-reader audit. |
| SEO | Unique registry titles/descriptions, canonical URLs derived from SystemURL, OG/social image, safe WebSite/WebPage JSON-LD, canonical alias redirects, sitemap updates and crawl guidance. Absolute sitemap directives require the real deployment URL. No fake ratings, Offers or certification schema. |
| Broken assets | **0 detected** in source checks and rendered browser fixtures. WHMCS-owned runtime assets and database-authored images require live verification. |
| Broken routes | All original entry-point files and registered new routes exist; dedicated typo redirect retained. **Live HTTP route acceptance not verified.** |
| Branding | Repository-wide retired-brand audit reported **0 matches**. Protected vendor compatibility identifiers and files retained. |
| Security | Existing sessions, authorization, CSRF and checkout handlers retained. New admin actions require capability + token; publishing additionally requires confirmation and is audited. Platform catalog is read-only and does not expose credentials. |

Machine-readable evidence: `source-verification.json`,
`browser-verification.json`. Selected screenshots are in `screenshots/`.

## Remaining blockers — production acceptance is not complete

1. This repository does not contain WHMCS `init.php`, licensed parent/runtime,
   the production database, product/currency mappings, or provider credentials.
   Live login/register/reset, payment, cart, client-area and provisioning flows
   therefore have **not** been certified.
2. `https://rent.windelsai.com/` could not be reached from the sandbox: its TLS
   connection failed. No live deployment was performed.
3. Confirm published Terms of Service, Legal Notice and Data Protection Standards
   in Theme Manager. Explicit unpublished content remains unpublished; prices,
   legal terms and infrastructure claims were not invented to fill gaps.
4. Configure/verify the optional Node reverse-proxy mount and router base before
   enabling live app/OS browsing. The separate Node frontend was not globally
   redesigned by this WHMCS theme change. Run its **complete** test suite in CI.
5. Configure actual invoice/email logo settings, server-level error responses and
   absolute sitemap declarations. Verify active parent-theme compatibility,
   language/currency controls, custom navigation and Builder-authored URLs.
6. Perform authenticated staging visual/functional QA and full runtime crawling
   before merging/deploying. Site search is editorial discovery + native KB
   search, not a new cross-platform full-text database index.

**Do not describe this report as “all acceptance criteria complete.”** It records
implemented code, passing source/template checks and the exact remaining runtime
acceptance work. Deployment steps and rollback are in `DEPLOYMENT.md`.
