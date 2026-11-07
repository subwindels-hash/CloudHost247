> **Superseded.** The compact dropdowns described below were removed in the next iteration:
> the menu is now a completely flat bar of direct links — see `docs/FLAT-MENU.md`. The dark
> bar styling, WHMCS parity, footer and 3D Experience notes below otherwise still apply.

# Dark single-row horizontal menu

> **Request:** “make the menu show like this not the dropdown we have now” — with a reference
> screenshot of a near-black, single-row bar showing every top-level link inline.

The previous light, two-tier header with its **full-width mega panel** is gone. The menu is now one
dark bar with all seven registry sections visible inline (each with a small caret), a short
right-hand utility cluster, and a **compact dropdown** anchored to the item you open. The
professional four-column footer, the homepage 3D Experience and every registry destination are
unchanged.

## What the reference asked for, and what was done

| Reference | Implementation |
| --- | --- |
| Near-black single bar, white brand mark | `#1b1d20` sticky bar, white `logo-horizontal-white.svg` |
| All top-level links visible in one row | 7 registry sections (`Hosting`, `Cloud & Servers`, `Domains`, `Platforms`, `Tools`, `Resources`, `Company`) inline, 62px tall bar |
| Small carets on nav items | `▾` on every trigger; gold underline on hover/open |
| Deals / Help / Sign In / cart on the right | `Pricing`, `Help`, cart icon, `Sign In`, gold `Create Account`; language/currency as compact text disclosures |
| No giant dropdown panel | A 292px dark dropdown anchored under its own trigger, scrollable, with grouped links and an “All …” link |

The reference's numeric cart badge and `$12.99` price were **not** copied — those are another
company's live commerce data, and this project does not reproduce third-party marks, copy or
commerce content. The cart link points at our own `/cart`.

**Dropdown decision (worth confirming):** the reference shows carets, so sub-pages are still
reachable through a *small* dropdown. The old viewport-wide mega panel is what was removed. If you
want **no dropdowns at all** — every item a direct link, with sub-pages only in the footer and
sitemap — say so and I'll drop them; it's a small change.

## Responsive behaviour

- **≥1440px** — exactly one bar. The slim utility strip is hidden and its destinations fold into
  the bar's right-hand cluster. This is the width of the reference screenshot.
- **1200–1439px** — the same horizontal bar with every section inline; triggers tighten slightly
  and the quick links move to the slim dark strip, so a 1280/1366 laptop sees the inline menu
  rather than a hamburger. The old design switched to the drawer below 1440px.
- **<1200px** — the dark drawer/accordion with the same registry, and the slim strip for quick
  links. Nothing is horizontally scrollable.

Verified with real Chromium: **0px header overlap at 1920 / 1600 / 1440 / 1280 / 1024 / 834 /
390**, and no document overflow at any of those widths.

## Files

**SPA**

- `frontend/src/layout/Header.tsx` — white brand mark; new `.hg-nav__quick` cluster
  (`Pricing`, `Help`, cart); slim utility strip retained for compact widths
- `frontend/src/components/navigation/PlatformMegaMenu.tsx` — panel marked `hg-mega--compact`;
  pointer-hover breakpoint lowered to 1200px; registry data and interaction model unchanged
- `frontend/src/hostinger-chrome.css` — new section 7: dark bar, compact item-anchored dropdown,
  desktop-bar restoration for 1200–1439px, dark drawer, dark signed-in subnav
- `scripts/check-chrome-benchmark.mjs` — rewritten for the single-row bar + compact dropdown,
  plus a new 1280px laptop assertion (18 checks)
- `scripts/check-redesign-motion.mjs` — pricing link in the route-transition check now targets a
  visible link; hard-exit on failure so a stray Chromium cannot hang the run
- `scripts/capture-chrome-benchmark.mjs` — deterministic dropdown capture (DOM click + Escape),
  scroll-to-top before the menu shot
- `frontend/tests/unit/hostinger-chrome.test.tsx` — menu tests pin the compact panel class

**WHMCS theme** (parity, CSS-only — no template or registry change)

- `templates/cloudhost247/css/chrome-benchmark.css` — dark bar, white brand, compact
  `<details>` dropdown; intro column reduced to its “Explore …” link; drawer stays in flow
- `templates/cloudhost247/includes/site-head.tpl` — stamp `?v=20261110`
- `tests/website/test_visual_regressions.py` — SHA-256 digest re-cut to
  `d44a96eabf370985fe0141d8a6a4f8fec3f4864a2d39f0df4f4d7f294af51c13`

## Verification

| Gate | Result |
| --- | --- |
| `npm run check:chrome` | **18/18** — dark single row, 7 inline triggers, compact 292px dropdown, 0px overlap at 1440 and 1280, professional footer intact |
| `npm run check:3d` | **15/15** — 3D Experience unaffected |
| `node scripts/check-redesign-motion.mjs` | **34/34** — existing motion/responsive contract intact |
| `npm run evidence:layout` | 7 widths, **0.0px** header overlap |
| `python3 -m unittest discover -s tests/website` | **203 OK** (8 skipped) |
| `python3 -m unittest discover -s tests/security` | **77 OK** (1 skipped) |
| Targeted Vitest (12 files) | **509/509** |
| `npm run typecheck`, frontend `tsc --noEmit`, `npm run build:frontend` | clean |
| `node scripts/site/generate.mjs --check` | 221 links (210 app, 217 PHP) |
| `node scripts/site/check-links.mjs` | no broken/placeholder/dangling links |
| `bash scripts/verify-rendered-site.sh --fetch` | 235 PHP-WASM fixtures; new stylesheet stamp present; 4 footer columns, 8 sub-groups, 8 nav disclosures, tools hook |
| `python3 scripts/check-accessibility-contract.py` | 73 files, 47 controls, 1320 CSS rules, 19 media widths — all hold |
| `npm run evidence:screenshots` | 18/18 HTTP 200 |
| `npm run evidence:chrome` | 8 chrome/3D views |

Before/after evidence: `docs/evidence/menu-bar/before/` (light two-tier menu + full-width mega
panel) and `docs/evidence/menu-bar/after/` (dark single-row bar + compact dropdown, plus all 18
page renders).

## Scope and blockers

- No licensed WHMCS/cPanel staging: the theme is verified via the PHP-WASM Smarty fixture
  renderer, not a live WHMCS instance. Its compact dropdown is CSS-only; the `<details>` markup
  and all links are unchanged.
- The slim utility strip is still present at 1200–1439px in both surfaces, so the header is two
  rows at those widths. At ≥1440px it is a single bar exactly as in the reference.
- No Safari/Firefox, real-device, axe/WCAG-AA or Lighthouse audit in this pass.
- No production deployment, database change or live transaction. Financial and
  production-deploy freezes remain in force.
- The full 166-file Vitest suite was not run (it has historically timed out here); the targeted
  509-test run, 203-test website suite and 77-test security suite are the basis above.
- Photography licence/high-resolution blockers from the earlier redesign are unchanged
  (`docs/PHOTOGRAPHY-LICENSES.md`).
