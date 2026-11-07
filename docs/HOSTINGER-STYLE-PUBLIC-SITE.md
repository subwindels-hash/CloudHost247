# CloudHost247 site — Hostinger-style rebuild

## What was studied

`https://www.hostinger.com/` (November 2026 homepage) builds a hosting page as a conversion
funnel. The section order is:

1. Scrolling promo marquee above the header
2. Sticky white header with a mega-menu, search, language/currency, log in and one strong CTA
3. Split hero: large headline + subhead + domain search + CTA + reassurance points, next to a
   product screenshot with floating chips
4. Trust / review-logo strip
5. **Tabbed pricing** (Websites / VPS hosting) with three cards, a highlighted middle plan,
   big prices, "Choose plan" buttons and per-plan feature lists
6. "Explore more deals" three-card row
7. AI builder section with a prompt box
8. "Tools for every online project" tabbed feature showcase (Build / Grow / Manage)
9. Customer-creations gallery and testimonials
10. "Your AI co-worker" feature tabs
11. "More power when you need it" link list
12. FAQ accordion
13. Full-width final CTA
14. Dark, multi-column footer with legal links

## What CloudHost247 now does

The **public surface** follows that same grammar, with CloudHost247 content and **no fabricated
marketing claims**:

| Hostinger | CloudHost247 implementation |
|---|---|
| Promo marquee | Existing `AnnouncementBar`, restyled in brand ink/green; messages are real navigation, not discounts |
| Sticky mega-menu header | `Header` + `PlatformMegaMenu` rebuilt in the Hostinger shape (see below) |
| Hero + product screenshot | `HomePage` hero with domain search, CTAs, and a CSS-only control-panel mockup (no fake metrics) |
| Review logos | Capability strip: live pricing, one account, security defaults — plus a **live** tool count from `/api/tools/catalog` |
| Tabbed pricing | `PricingSection`: three tabs reading `/api/v1/catalog/products/:slug/plans`; loading, 404, error and empty states are worded honestly |
| Explore-more cards | Three registry-linked product cards |
| AI builder prompt | Real prompt form that carries the idea into account creation; built-in generator is always available |
| Build / Grow / Manage tabs | `SHOWCASE` tab panel with real platform areas |
| Customer gallery | Use-case tiles — real starting points instead of invented quotes |
| AI co-worker | Features are listed as chips on the AI section and in the showcase panels |
| More power link list | Six real routes from the product families |
| FAQ | Seven `<details>` accordion items with truthful answers |
| Final CTA + dark footer | Full-width ink/green CTA and a five-column registry-driven dark footer |

The **client area** gets the same treatment in the hPanel sense:

- `DashboardPage` opens with an account hero (one greeting + real account links) and a four-item
  **Quick actions** grid; the existing live service/domain/ticket/installation summaries are kept.
- A wider card column, rounded raised cards, hover-lift service tiles, a pill-style account
  sub-nav and tinted table headers — all CSS, no data-fetching or authorization changes.

## Menu, mega menu and footer

The three shared chrome components were rebuilt, not just recoloured. `Header.tsx`,
`components/navigation/PlatformMegaMenu.tsx` and `layout/Footer.tsx` now render `hg-nav*`,
`hg-mega*`, `hg-drawer*` and `hg-footer*` classes styled by `hostinger-chrome.css`:

- **Menu** — a compact sticky bar: brand, one dropdown trigger per `NAV_SECTIONS` entry with an
  active underline, a utility cluster (language, currency, search), a quiet "Sign In" text link
  and one strong "Create Account" CTA. Signed-in visitors get an account pill, a quiet text link
  and a horizontally-scrolling account sub-nav instead.
- **Mega menu** — a full-width white panel anchored to the header: a tinted "Explore" column with
  the section blurb and a featured card on the left, three columns of icon links with
  descriptions and badges on the right, and a bottom "All …" bar. Panels are mounted only while
  open (the ~110 registry links are not parsed on every page), but the panel element always
  exists so `aria-controls` never dangles. Pointer hover, click, Escape, outside-click, focus
  return and route-change closing are all preserved. The Tools panel still lazy-loads
  `/api/tools/navigation` and degrades to category links if the request fails.
- **Mobile drawer** — below 1281px the trigger bar is replaced by a thumb-sized accordion of the
  same registry, with 52px rows and an "All …" link per section. Language and currency switchers
  stay inside `#ch247-primary-nav` and are never duplicated into the footer.
- **Footer** — a "Build. Host. Deploy. Scale." CTA band, a brand block with the white logo and a
  platform-status link, five curated columns, and a legal bar. The eight source
  `FOOTER_COLUMNS` are merged by topic and de-duplicated by destination — **no link is dropped**,
  so every destination in the generated registry is still reachable (long columns split into two
  internal columns rather than becoming a wall of links). That keeps the navigation / SEO
  link-integrity tests the single source of truth. No invented social, award or review links.

The inert CSS for the retired `ch247-mega-panel` / `ch247-platform-nav` / `ch247-mobile-nav` /
`ch247-header__collapsible` / `ch247-footer__columns` rules was removed from `platform.css`,
`styles.css` and the override block in `hostinger.css`. The canonical
`shared/site/design-system.css` keeps its generic mega-menu block because it is also copied to
the WHMCS/PHP theme; those rules are inert for the SPA's new class names.

## Palette

CloudHost247's own **ink (#0c1c26) + mint/green (#0f8a5f / #7ff0b4)** palette, taken from
`shared/site/design-system.css`. The Hostinger-style layout is retained; only the accent changed.
All tokens live at the top of `hostinger.css` (`--hg-accent*`), so the whole site can be
recoloured from one place. The chrome reuses those tokens — there is no second palette.

## Scope switch

`Layout.tsx` puts `hg-theme` on **every** route, then adds `hg-shell` on public marketing routes
(`/`, `MARKETING_ROUTES`, and the public `/hosting`, `/cloud`, `/domains`, `/apps`, `/docs`,
`/legal`, … families) or `hg-app` on the client area, admin and Tools Center.
`isMarketingSurface()` is the only branch. Every selector in `hostinger.css` is prefixed with
`.hg-theme` (or is an `hg-*` class); the last section uses `.hg-app` for account-specific layout.

`main.tsx` loads the application CSS, the feature CSS, the canonical shared design system,
`hostinger.css`, then `hostinger-chrome.css` last — the chrome layer intentionally overrides the
marketing layer's earlier header/footer treatment so the menu, mega menu and footer look the
same on public pages, the client area and the Tools Center.

## Demo catalogue (preview only)

`scripts/seed-preview-catalog.ts` seeds nine demo plans across `web-hosting`,
`vps-hosting` and `cloud-hosting` into the **in-memory** PGlite database used by
`npm run preview`. It is never imported by the production server or the cPanel package. This
lets the pricing cards be reviewed against the real catalog API, DTO mapping and currency
formatting. Production still publishes no price until an administrator explicitly creates
one — the `never invent a price` rule is unchanged.

## Files

- `cloudhost247-node/frontend/src/hostinger.css` — design system (public + account sections)
- `cloudhost247-node/frontend/src/hostinger-chrome.css` — menu / mega menu / drawer / footer
- `cloudhost247-node/frontend/src/layout/Header.tsx` — menu bar and account sub-nav
- `cloudhost247-node/frontend/src/components/navigation/PlatformMegaMenu.tsx` — mega panel + drawer
- `cloudhost247-node/frontend/src/layout/Footer.tsx` — CTA band, five columns, legal bar
- `cloudhost247-node/frontend/src/pages/HomePage.tsx` — new funnel
- `cloudhost247-node/frontend/src/pages/DashboardPage.tsx` — account hero + quick actions
- `cloudhost247-node/frontend/src/layout/Layout.tsx` — `hg-theme` / `hg-shell` / `hg-app` switch
- `cloudhost247-node/frontend/src/main.tsx` — stylesheet load order
- `cloudhost247-node/scripts/seed-preview-catalog.ts` + `tools-preview-server.ts` — preview data
- `cloudhost247-node/frontend/tests/unit/hostinger-homepage.test.tsx` — funnel / scope tests
- `cloudhost247-node/frontend/tests/unit/hostinger-chrome.test.tsx` — menu / panel / footer tests
- `cloudhost247-node/package.json` — `npm run preview` shortcut

## Run / verify

```bash
cd cloudhost247-node
npm ci
npm run build:frontend
npm run preview            # or: npx tsx scripts/tools-preview-server.ts 3000
npm run typecheck
npx tsc -p frontend/tsconfig.json --noEmit
npx vitest run \
  frontend/tests/unit/hostinger-homepage.test.tsx \
  frontend/tests/unit/hostinger-chrome.test.tsx \
  frontend/tests/unit/Header.test.tsx \
  frontend/tests/unit/dashboard-protected.test.tsx \
  frontend/tests/unit/tools-integration.test.tsx \
  tests/integration/navigation-links.test.ts \
  tests/integration/seo-routes.test.ts \
  tests/unit/health.test.ts
```

The preview serves the SPA and the API from one origin on port 3000. Because the preview server
pre-registers static files at startup, restart it after each `npm run build:frontend` so new
hashed CSS/JS bundles are served.
