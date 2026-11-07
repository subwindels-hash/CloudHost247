# Website visual redesign — delivery report

**Date:** 2026-11-07 · **Branch:** `arena/1b329121-cloudhost247` · **PR:** #91 (merged on request)
**Scope:** metallic gold/silver brand, restrained 3D depth, authentic infrastructure photography,
responsive/accessible verification. **No backend, checkout, account, provisioning, database or
payment behaviour was changed.**

> This report is additive to `docs/PHASE-DELIVERY-REPORT.md` (P0 fix, canonical ADR, multi-currency
> core, Phase 3 chrome). That earlier work is already on this branch.

## 1. What changed

### Palette — green retired from the canonical surfaces

`shared/site/design-system.css` now defines the metallic anchors
`#d4af37` / `#b8860b` / `#e6c875` (gold) and `#c0c0c0` / `#e5e4e2` / `#858585` (silver), with
dedicated ink colours for contrast (`--ch-gold-ink #5f450a`, `--ch-silver-ink #4d5257`). Buttons,
CTA bands, plan-table headers, soft/dark/footer sections and the announcement bar use multi-stop
anisotropic ramps with a specular band rather than a flat swatch. Legacy token names
(`--ch-mint`, `--ch-green`, `--ch-accent`…) are retained as **aliases to gold** so existing
templates keep working; no green pixels are painted by any active surface.

`shared/site/metals.css` is the new shared material/depth layer: gold/silver ramps, specular
highlights, photo bezel, tilt/parallax/reveal primitives, route transition, focus-visible ring,
reduced-motion / coarse-pointer / `<1024px` / print guards, and `body { overflow-x: clip }`.
The generator emits an identical copy to `templates/cloudhost247/css/metals.css`;
`cloudhost247-node/frontend/src/main.tsx` imports the shared sheet last, and
`templates/cloudhost247/includes/site-head.tpl` links the generated copy last.

Rewritten: `templates/cloudhost247/css/{site,design-system,auth,tools,custom,announcementbar,
email-hosting}.css`, `templates/orderforms/cloudhost247/css/custom.css`,
`templates/cloudhost247/includes/{announcementbar.tpl,site-head.tpl}`, 21 SPA stylesheets and 14
TSX files (Tailwind utility names switched from emerald/green to amber/gold),
`cloudhost247-node/frontend/src/hostinger.css`, `hostinger-chrome.css`, `ai-support.css`,
`id-card.css`. Stale `.hg-browser*` CSS rules for the removed CSS-only dashboard mock were deleted.

`tests/website/test_theme_palette.py` gained `MetallicPaletteTests`: hue-based detection of any
green on the WHMCS theme, canonical SPA, shared design system, cart skin and brand marks; metal
anchors in every layer; and byte parity between shared sources and generated copies. Existing
palette-pinning tests were re-cut to the new gold values (still equally strict). The active-surface
green audit returns **zero green-dominant hex colours**.

### Brand marks

`brand/icon-mark.svg` (champagne gold glyph on navy) and `brand/logo-compact.svg` (deep gold
lockup) were recoloured; their PNG/WebP rasters and all favicon/apple-touch/ICO derivatives were
regenerated at the original dimensions, and the SPA mirror is byte-identical.

### Motion — restrained, dependency-free

`shared/site/motion.js` is one small controller (no animation library, no idle loop): delegated
pointer tilt → `--tilt-x/--tilt-y`, one parallax layer → `--parallax-y`, IntersectionObserver
reveals, and an opacity-only route transition on `.ch247-main`. It self-disables under
`prefers-reduced-motion`, coarse pointers and viewports below 1024 px. It is imported by the SPA
and linked (deferred, generated copy) by the WHMCS head.

Wired: `Layout.tsx` restarts the route transition on every `pathname` change; `HomePage.tsx` has
one `data-tilt` hero frame, one `data-parallax` soft metallic light and six `data-reveal` section
heads. No card, button or list item spins, floats or bounces. All effects use GPU-friendly
`translate3d`/opacity/transform and are disabled on small screens.

### Photography

`shared/site/photography.json` is the single registry: 11 real data-centre photographs (server
aisles, rack hardware, fibre patch panels, structured cabling, switches, storage arrays, engineers,
a network operations centre), each with alt text, credit and a family-to-photo map. Scenes rotate
deterministically through a curated per-family pool so neighbouring product pages do not repeat the
same picture; a generated resolver is emitted for both surfaces
(`templates/cloudhost247/includes/photo-map.tpl` and
`cloudhost247-node/frontend/src/components/marketing/photo-map.generated.ts`).

`visual.tpl` and `Illustration.tsx` now offer photo AVIF → WebP → JPEG first, then the original
3D raster ladder, then the SVG diagram as the last `<img>` fallback. Non-critical images are
`loading="lazy" decoding="async"`; the homepage hero is eager with `fetchpriority="high"`.
`HomePage.tsx`'s CSS-only browser mock was replaced by the real photograph in a metallic frame.
11 × 1280 px masters plus 640/960/1280 AVIF+WebP ladders were generated and mirrored to the SPA
(`--check`: 61 scenes × 2 formats, mirror in sync).

**Licensing/resolution blocker — see `docs/PHOTOGRAPHY-LICENSES.md`.** The masters are 500 px-class
search previews upscaled to 1280 px; individual source pages, photographers and licence grants
could not be verified in this sandbox. They are **staging/demo assets and must be replaced with
verified full-resolution originals before a production launch.** They are not used on account,
cart, checkout, dashboard or provisioning surfaces.

### Generator and docs

`scripts/site/generate.mjs` now validates the photo registry (masters, ladder, overrides, pools),
copies `metals.css`/`motion.js`, and emits both photo resolvers. `node scripts/site/generate.mjs`
is idempotent. `.gitignore` excludes the `image-search/` acquisition previews.
`docs/PHOTOGRAPHY-LICENSES.md` records sources, processing and the four pre-production blockers.

## 2. Files changed

93 paths (61 modified, 32 new). Main groups:

| Group | Files |
| --- | --- |
| Shared canonical | `shared/site/design-system.css`, `metals.css`, `motion.js`, `photography.json`, `generated/route-report.json` |
| WHMCS theme | 8 CSS, `includes/{site-head,announcementbar,visual,photo-map}.tpl`, `js/motion.js`, `homepage.tpl`, `cloudhost247-tools.tpl`, cart skin CSS |
| Canonical SPA | `main.tsx`, `layout/Layout.tsx`, `pages/HomePage.tsx`, `components/marketing/{Illustration.tsx,photo-map.generated.ts}`, `hostinger.css`, `hostinger-chrome.css`, `ai-support.css`, `id-card.css`, 21 CSS + 14 TSX palette rewrites |
| Assets | 11 photo masters + 66 ladder variants + SPA mirror; 2 brand SVGs + 2 PNG/WebP + 7 favicon/ICO derivatives + mirror |
| Tooling/tests | `scripts/site/generate.mjs`, `scripts/check-redesign-motion.mjs` (new), `tests/website/{test_theme_palette,test_cart_skin,test_visual_regressions}.py`, `.gitignore` |
| Docs/evidence | `docs/PHOTOGRAPHY-LICENSES.md`, `docs/VISUAL-REDESIGN-DELIVERY-REPORT.md`, `docs/evidence/redesign/{before,after}/` |

## 3. Database / API / integrations

- **Database:** none. No schema change, no migration added, edited or applied. The preview uses the
  existing in-memory PGlite demo data only.
- **APIs:** none added, removed or changed. No routes, handlers, contracts, catalogue, cart,
  checkout, invoicing, provisioning, auth or dashboard endpoints were touched.
- **Integrations / financial:** unchanged and still frozen. No live payment gateways, live webhooks,
  quarantined migrations, production payment settings, real transactions or provider credentials.
- **Deployment:** none. Merging the PR changes source only; nothing was deployed.

## 4. Tests executed and results

| Check | Result |
| --- | --- |
| `python3 -m unittest discover -s tests/website -p 'test_*.py' -q` | **203 tests OK** (8 skipped) — includes new metallic-palette, cache-busting, hero-ladder and fixture gates |
| `bash scripts/verify-rendered-site.sh --fetch` (PHP 8.2 WASM + Smarty 4.5.6) | **235 page fixtures rendered**; 935 images, 3,841 asset references, 55,236 links, 58,457 controls, 194 canonical addresses, 0 dead internal links; hero audit 47 3D + 1 flat + 19 legal = 48 distinct; tools resolution 257 derivable / 265 published, all matched |
| `node scripts/site/generate.mjs` and `--check` | 221 links validated (210 app / 217 PHP); 55 pages, 129 sections, 174 FAQs, 43 product pages; photo map idempotent |
| `python3 scripts/generate-raster-formats.py --check` / `--emit-served` | 61 scenes × 2 formats complete; served mirror in sync (694 files) |
| `npm run typecheck` (backend) | clean |
| `tsc -p frontend/tsconfig.json --noEmit` | clean |
| `npm run tools:catalog:check` | 75 tool entries, projection verified |
| `npm run build:frontend` | clean → `index-DX0Dh9-x.js` (324 kB / 101 kB gzip), `index-D23OkEcv.css`; metals.css + motion.js confirmed in the bundle |
| Vitest (5 targeted files) | **361 / 361 passed** (homepage, marketing, domains, hosting catalogue, navigation links) |
| `npm run evidence:screenshots` (before and after) | **18/18 HTTP 200** each, 0 page errors |
| `npm run evidence:layout` | 1920/1600/1440/1280/1024/834/390 px — **0.0 px overlap** at every width |
| `node scripts/check-redesign-motion.mjs` (new, real Chromium) | **34/34 passed**: tilt sets/resets `--tilt-x/y`, parallax sets `--parallax-y`, reveals fire, route transition restarts on navigation, no page errors, no horizontal overflow and readable h1 / visible controls at 1920/1440/1280/1024/834/768/390/360 px, reduced-motion disables tilt |

Full 166-file Vitest suite was **not** re-run (it historically times out in this sandbox); the
targeted suites above are the verification basis.

## 5. Screenshots of actually rendered pages

- Before: `docs/evidence/redesign/before/` — 18 viewport screenshots (6 routes × 3 breakpoints),
  one full-page homepage capture and `render-report.json`. Shows the original mint/green scheme.
- After: `docs/evidence/redesign/after/` — same 18 routes/breakpoints plus `render-report.json`.
  Home, pricing, hosting, domains, tools and about at desktop / tablet / mobile.

These are real Chromium renders of the running SPA preview (`@sparticuz/chromium` +
`playwright-core`), not mockups. **PHP/WHMCS pages were verified through 235 rendered Smarty
fixtures, not through a live WHMCS installation or a WHMCS browser screenshot.**

## 6. Outstanding blockers and implemented-but-unverified features

1. **Photography provenance (blocker).** Licences, photographers and full-resolution originals are
   unverified; upscaled previews are staging assets. See `docs/PHOTOGRAPHY-LICENSES.md`.
2. **No licensed WHMCS / cPanel staging.** Cart, checkout, client-area, provisioning and module
   behaviour cannot be exercised end to end. Fixture rendering proves template output only.
3. **Frozen legacy surfaces still carry the old green.** Per the Accepted ADR, `platform/` is
   frozen/read-only; its manifests, favicon and two stylesheets still use `#16704b`, and
   `templates/cloudhost247_legacy/` (an inactive legacy theme) retains its own green scheme. The
   canonical Node frontend and the active WHMCS `cloudhost247` theme are green-free.
4. **Browser coverage.** Motion, overflow and layout were verified in headless Chromium only; no
   Safari, Firefox, real-device, screen-reader or automated axe/WCAG-AA audit was run. Contrast was
   computed by hand for the ink tokens (gold ink 8.6:1, silver ink 7.7:1 on white).
5. **Core Web Vitals.** No field/lab LCP/CLS/INP measurement. Mitigations are in place (no JS
   animation library, opacity-only route transition, one parallax layer, lazy non-critical images,
   640/960/1280 AVIF/WebP ladders, reduced-motion and small-screen off switches) but were not
   measured with Lighthouse.
6. **Conceptual SVG fallback.** The original isometric illustrations remain as the last-resort
   `<img>` behind the photographs. They are only shown if every photo and 3D source fails.
7. **Tailwind utility rewrites.** TSX class names were changed from emerald/green to amber/gold;
   there is no Tailwind config in this repository, so those particular utility strings may be
   inert. They are not relied upon for the shipped appearance and no test asserts them.
8. **No production deployment**, no live financial service activation, no real customer
   transaction. The financial freeze from earlier phases remains in force.
