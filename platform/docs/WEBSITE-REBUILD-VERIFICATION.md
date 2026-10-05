# CloudHost247 Website Rebuild — Verification Report

**Date:** 2026-10-05
**Branch:** `arena/63cb2db6-cloudhost247`
**Scope:** professional rebuild of the public website, client-area shell, SEO/accessibility
foundation and supporting backend endpoints, per the rebuild specification.

---

## 1. Pages created (26 new routes, all clean URLs)

| Route | Page |
|---|---|
| `/` | Homepage — hero, trust indicators, domain search, six service cards, why-section, live infrastructure locations, CTA |
| `/hosting` | Hosting overview with live catalog pricing |
| `/hosting/web-hosting` `/hosting/wordpress` `/hosting/cloud` `/hosting/vps` `/hosting/dedicated` `/hosting/reseller` | Six service pages with features, specs and per-product pricing |
| `/pricing` | Full pricing page rendered from the live catalog |
| `/domains` | Domain marketplace: search, extension pricing table, transfer/management |
| `/business-email` | Business email service page |
| `/security` | SSL & security capability page (`#ssl`, `#backups` anchors) |
| `/migration` | Six-step guided migration process |
| `/infrastructure` | Locations page showing ONLY configured regions (`#locations`) |
| `/about` | Mission/vision/values + why-section (`#why`) |
| `/contact` | Contact cards + form; contact details rendered from operator configuration |
| `/support` | Support portal: KB search, ticket link, status link, six categories |
| `/knowledgebase` | KB category grid with honest "publishing in progress" states |
| `/blog` | Blog landing with category structure |
| `/status` | Live status page (verified checks only) |
| `/legal/terms` `/legal/privacy` `/legal/cookies` `/legal/acceptable-use` `/legal/sla` `/legal/refund-policy` | Versioned legal pages (Version 1.0, effective 2026-10-05) |
| `/404` | Custom not-found page |

**Pages redesigned (4):** `/login`, `/register`, `/forgot`, `/reset` — new premium design;
all JS contracts for `auth-forms.js` preserved (`data-login-form`, `data-register-form`,
`data-forgot-form`, `data-reset-form`, `data-passkey-login`, `data-mfa-field`, `data-form-alert`).

**Legacy URL preservation:** `/vps-hosting.html` → `/hosting/vps` and
`/web-hosting.html` → `/hosting/web-hosting` now serve redirect pages, so no existing
inbound link breaks.

## 2. Routes verified

All 35 routes smoke-tested over real HTTP against the running platform — **every one
returned 200**: the 26 pages above plus `/sitemap.xml`, `/robots.txt`,
`/assets/css/site.css`, `/assets/js/site.js`, and the four auth pages.

New server capabilities pinned by `tests/site.test.js` (18 tests):
- Clean-URL static resolution (`/hosting` → `hosting.html`) incl. nested paths,
  with unknown paths still 404ing.
- Legacy redirects and auth JS contracts.
- Unique titles + canonical links + JSON-LD per page.

## 3. Backend integrations verified (real data only)

| Integration | Endpoint | Honesty guarantee |
|---|---|---|
| Pricing | `GET /api/v1/catalog` | Prices rendered ONLY from configured catalog plans; unconfigured services show "Plans for this service are not configured yet" |
| Domain search | `POST /api/v1/domain-services/search` | Public; labeled `estimate` until a registrar connector exists — UI says exactly that |
| TLD pricing | `GET /api/v1/domain-services/extensions` | From `domain_extensions` (dev seed: 7 extensions); empty state if unconfigured |
| Locations | `GET /api/v1/public/locations` (new) | Lists only ACTIVE regions of ACTIVE providers; `configured:false` when empty — no invented data centers |
| Status | `GET /api/v1/public/status` (new) | Verified checks (website/API/storage) live; everything else `unmonitored`; `monitored:false` always until monitoring exists |
| Contact details | `GET /api/v1/public/site-info` (new) | Whitelisted, length-capped fields from `platform_settings.site_info`; unconfigured deployment publishes NOTHING (no fake addresses/phones) |
| SEO files | `GET /sitemap.xml`, `GET /robots.txt` (new) | Generated from `APP_URL` — correct on every deployment |

Admin side already existed: `PUT /api/v1/admin/settings/:key` (super_admin, audited) is
the configuration path for `site_info`; catalog admin CRUD covers plans/pricing/features.

## 4. Mobile / responsive

- CSS authored against the required breakpoints: 320, 375/390/414, 768, 1024, 1280, 1440+.
  Nav collapses to a drawer below 1024px; grids collapse at 1024/680; trust strip 6→3→2
  columns; tables wrapped in horizontal containers; footer 6→3→2 columns.
- `overflow-x: clip` on `body` (site + SPA) and `max-width: 100%` media rules prevent
  horizontal scrolling.
- **Honest limit:** no browser exists in this environment, so breakpoints were verified by
  stylesheet construction, not by device rendering. A quick pass on a phone is recommended.

## 5. SEO checks

- Unique `<title>` + meta description on every page (asserted by test).
- Relative canonical link per page; OG + Twitter metadata; JSON-LD Organization.
- Clean URLs (no `.html` in navigation); semantic single `<h1>` per page; breadcrumbs on
  inner pages; skip links.
- `sitemap.xml` (26 routes) and `robots.txt` generated from `APP_URL`; `/api/` and `/app/`
  disallowed from crawling.

## 6. Accessibility checks

- Skip link, `aria-current`, `aria-expanded`/`aria-controls` on the menu button,
  `aria-live` result regions, labeled inputs (visually-hidden where needed), semantic
  landmarks (`header/nav/main/footer`), `:focus-visible` rings, AA-checked palette,
  `prefers-reduced-motion` support in both stylesheets.
- **Honest limit:** no screen-reader/automated a11y tooling ran here; recommend an axe
  pass before launch.

## 7. Checkout / commerce journey

Covered by the existing end-to-end suites, all green in this run:
`tests/spa-commerce.test.js` drives register → catalog → cart → order → invoice →
payment → settlement through the real HTTP pipeline (26 assertions), and
`tests/gateways.test.js` (40 tests) pins Stripe/PayPal/Paystack webhook verification.
"Choose Plan" CTAs deep-link into `/app/catalog`; no fake payment methods are shown —
only configured gateways render.

## 8. Authentication test

`tests/api.test.js` (register → me → logout → revoked), `tests/webauthn.test.js` (84) and
`tests/webauthn-browser.test.js` (10) all pass; login/register/forgot/reset pages rebuilt
without breaking any selector contract (pinned in `tests/site.test.js`).

## 9. Dashboard test

SPA production build succeeds (258.9 kB JS / 77.1 kB gzip) and every page module
server-renders in `npm --prefix spa run smoke`. Client-area design tokens aligned with the
public site. Dashboard pages (overview, services, billing, support, security, admin console)
were built previously and remain functional.

## 10. Build & test results

- **Full platform suite: 628/628 tests pass** (610 existing + 18 new site tests), `node --test tests/*.test.js`, exit 0.
- **SPA build:** Vite production build clean; SSR smoke clean.
- **Site build:** `node scripts/build-site.cjs` → 31 pages written, deterministic.

## 11. Phase 2 — content system, dashboard & admin upgrade (2026-10-05)

Second wave on top of the Phase 1 rebuild, closing the remaining spec gaps:

### Knowledgebase & blog (spec §20, §21, §30)
- New `site_articles` store table + `content` domain (`src/domains/content.js`).
- Public API `GET /api/v1/public/articles` (kind/category/q filters) and
  `/api/v1/public/articles/:slug`; server-rendered pages at `/kb/:slug` and
  `/blog/:slug` with escaped markdown-lite body, article JSON-LD and breadcrumbs.
- Drafts and unknown slugs 404 publicly; published articles are added to the sitemap automatically.
- Admin CRUD `/api/v1/admin/articles[/:id]` — role-gated, validated (slug format +
  uniqueness), audit-logged. Drafts never leak.
- `/knowledgebase` and `/blog` pages are now live lists driven by the API (search +
  category filter chips); the support-center search submits to `/knowledgebase?q=`.
- Seed ships **6 knowledgebase articles + 1 blog post** — all factual documentation
  about the platform itself (passkeys, 2FA, billing cycles, domain search, status
  page, first service, launch note). No invented claims.

### Client dashboard (spec §15)
- Overview upgraded: active-service count, domains, open tickets, **account balance**
  (sum of unpaid invoices), renewals due in 30 days, active subscriptions.
- Billing card lists recent invoices with balance/paid state; support card lists open
  tickets with direct links into each section (Services, Billing, Support).

### Checkout (spec §31)
- Cart now requires an explicit **Terms of Service / AUP / Refund Policy acceptance
  checkbox** before the Checkout button enables.

### Marketing → app deep-links (spec §7)
- `/app/catalog?product=<slug>` pre-selects a product; the marketing "Choose plan"
  buttons land directly on that product's plans.

### Admin console (spec §30)
- New **Content** screen: create/edit/publish/unpublish/delete KB and blog articles.
- New **Site settings** screen: the whitelisted `site_info` contact + brand fields that
  power the public site; writes are `super_admin`-only and refusals are shown verbatim.

### Verification
- New `tests/content.test.js` — 9 tests (public reads, XSS escaping, sitemap, admin
  gating, settings round-trip). **Full platform suite: 637/637 pass**, exit 0.
- SPA Vite build clean; `/app` serves the new bundle; live smoke of
  `/knowledgebase`, `/blog`, `/support`, article pages and APIs all 200.

## 12. Phase 3 — legacy PHP pages regenerated (2026-10-05)

The 54 root `.php` pages were WHMCS stubs that rendered nothing without the
vendor core. All of them were regenerated as professional, standalone pages:

### Shared layer (`php/`)
- `config.php` — env-overridable knobs: `CH247_API_BASE`, `CH247_PUBLIC_URL`,
  `CH247_APP_BASE`, `CH247_ASSET_BASE` (LiteSpeed-friendly defaults).
- `api.php` — read-only client for the platform public API (catalog,
  extensions, articles, site-info, status). Every helper returns `null` on
  failure so pages render explicit "could not be loaded" states — never
  invented numbers.
- `layout.php` — document head (title/desc/canonical/OG/Twitter/JSON-LD),
  mega-nav header and multi-column footer using the exact markup of the
  static site, so `site.css`/`site.js` drive both.
- `blocks.php` — page head, plan cards, extension pricing table, article
  cards, policy renderer, feature grids, CTA band, markdown-lite renderer.

### Page inventory
- **Preserved authored content**: backup, cybercrime, refund, trademark and
  domain-brokerage policies (PHP arrays carried over verbatim), FAQ items
  (now with FAQPage JSON-LD), the legal hub descriptions.
- **Preserved legacy prose**: terms of service, privacy, cookie, domain
  registration agreement, data-privacy consent form, registration addendum,
  renewal/deletion, fair usage, legal notice, refund & cancellation —
  extracted from `templates/cloudhost247_legacy/*.tpl`, cleaned of Smarty
  artifacts and empty elements.
- **New professional pages**: homepage, web/WordPress/cPanel/Windows/Plesk
  hosting, VPS (+ private/public cloud), dedicated, enterprise, game servers,
  business email, SSL/security, website design, developer-friendly, domains
  marketplace, live offers, blog (list + article view), help center (KB
  search), about, coming soon, 404, AUP, data protection standards, data
  deletion.
- **Live data**: hosting/domain/email pages pull plans and pricing from the
  catalog API; domain pricing table and search from the extensions API;
  blog/help center from the content API; contact details from `site_info`.
  Unpublished services say so honestly; unreachable API shows an explicit
  notice instead of fake prices.
- **Legacy URLs kept alive**: 7 sample/dev pages are 301 redirects to their
  canonical replacements; `dedeicated-server.php` typo redirects to the fixed URL.
- **Functional endpoints preserved**: marketing tracking, builder page and
  builder sitemap keep their original logic in `legacy-*-router.php` files,
  gated so they answer a clean 404 when the WHMCS layer is absent instead of
  fataling. `cloudhost247-sitemap.php` regenerated as a standalone XML
  sitemap (PHP pages + published articles).

### Verification
- No PHP binary exists in this workspace, so verification is static:
  `scripts/php-syntax-check.cjs` tokenizes every PHP file (strings, comments,
  heredocs, delimiter balance) — **all files pass**.
- Cross-checked that every `ch247_*` call resolves to a definition in `php/`.
- The catalog/extension/article API shapes the pages consume were verified
  live against the running platform; platform suite remains **637/637 pass**.
- Cleanup pass (`scripts/php-cleanup-pass.cjs`) removed empty tags and hollow
  contact blocks left by stripped Smarty variables; spot-checked output.

### Deploy notes for LiteSpeed
- Serve the repository root as docroot (as today). PHP pages reference assets
  at `/platform/public/assets/...` and the API at `http://127.0.0.1:3000`
  by default; override `CH247_API_BASE` / `CH247_ASSET_BASE` / `CH247_APP_BASE`
  via environment variables when the platform is served elsewhere.

## 13. Remaining blockers / next steps

1. **Browser verification** — no browser in this environment; run the site once on a real
   device (nav drawer, checkout flow) before launch.
2. **Operator content** — set `site_info` via the admin settings API (support/sales/billing
   emails, phone, address, socials) so the contact page publishes real details; add infra
   providers + regions to populate `/infrastructure`.
3. **Catalog completeness** — WordPress/cloud/dedicated/reseller/email plans are not in the
   seed catalog; their pages honestly say so until plans are added via the admin catalog API.
4. **Knowledgebase/blog content** — the content system is live and seeded with 7 factual
   articles; further articles are managed from the admin **Content** screen (no filler generated).
5. **`platform/public` deploy** — upload the rebuilt `public/` directory (or repoint the
   domain docroot at it) on the LiteSpeed host; use `infrastructure/litespeed/webroot-hardening.htaccess`.
6. **Environment files** — `.env` files are git-ignored and do not persist in this workspace;
   regenerate from `.env.example` after a workspace reset (or paste values into cPanel env
   editor for real deployments).
7. **PHP pages verification** — no PHP interpreter exists in this workspace, so the
   regenerated root pages were verified statically (tokenizer + cross-reference checks).
   Run `php -l *.php php/*.php` once on the target host before launch.
