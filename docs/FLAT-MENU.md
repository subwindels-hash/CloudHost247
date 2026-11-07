# Flat menu — every link beside the logo, no dropdowns

> **Request:** “Move all the menu link out from dropdown e.g: `English▾`, `USD▾`, `Sign In`,
> `Create Account`, `Hosting+`, `Cloud & Servers+`, `Domains+`, `Platforms+`, `Tools+`,
> `Resources+`, `Company+` and show them on the menu area beside logo”.

The compact dropdowns, the caret triggers and the `+` accordion drawer are all gone. The SPA header
is now one dark bar containing **direct, always-visible links** for all seven registry sections,
next to the logo, with the settings and account controls inline as well.

## Before → after

| Before | After |
| --- | --- |
| `Hosting ▾` … `Company ▾` opened a 292px compact dropdown | `Hosting`, `Cloud & Servers`, `Domains`, `Platforms`, `Tools`, `Resources`, `Company` are plain `<a>` links to `/hosting`, `/cloud`, `/domains`, … |
| Below 1200px those items became `+` accordions in a hamburger drawer | No hamburger, no accordion, no drawer — the same links stay visible at every width |
| Language/currency, Sign In, Create Account sat in a separate utility strip or drawer | All shown inline in the bar beside the logo |
| Sub-pages reachable from the header | Sub-pages still reachable from each section's landing page, the professional four-column footer and the sitemap |

The registry is unchanged: 221 links, all destinations intact. The professional footer and the
homepage 3D Experience are untouched.

## What is still a disclosure, and why

`English ▾` and `USD ▾` are still disclosures — but they are **settings controls**, not menu
links, and they are now rendered inline in the bar rather than hidden behind a hamburger. Removing
their disclosure would remove the ability to change language or display currency. If you want them
as plain text (no picker) or as links to a settings page instead, say so and I'll change them.

No third-party cart badge count or price was copied; the cart icon links to our own `/cart`.

## Responsive behaviour

The bar **wraps** instead of collapsing. All seven links remain visible at every tested width and
the header never pins over the content on phones.

| Width | Header height | Notes |
| --- | --- | --- |
| 1920 / 1600 / 1440 | 63px | One row: logo + all links + settings + account |
| 1280 / 1024 / 834 | ~107–109px | Logo stays on the same line as the section links; the account group wraps to a second row |
| 390 | 235px | Five wrapped rows, every link visible; header is non-sticky |

Real-Chromium checks confirm 0px overlap and 0px horizontal overflow at 1920, 1600, 1440, 1280,
1024, 834 and 390.

## Scope: WHMCS theme deliberately unchanged this round

The PHP/WHMCS theme keeps its `<details>/<summary>` menus. That is not an oversight:
`scripts/check-accessibility-contract.py`, `tests/website/test_accessibility_contract.py` and
`scripts/verify-website.py` all require those disclosures plus `.ch-menu-toggle` and `.ch-mega` in
`site-nav.tpl`, because they keep the navigation operable without JavaScript. Flattening that
surface would mean rewriting that contract, its fixture tests and the rendered-page audit. The
user-facing surface in the live preview is the SPA, which is what this change addresses. If you
want the WHMCS menu flattened too, that is a follow-up with those contract updates included.

## Files

- `frontend/src/components/navigation/PlatformMegaMenu.tsx` — replaced with `PlatformMenu`, a
  plain list of `NavLink`s; `Brand` and `useNavigationSections` kept for the footer and hub
- `frontend/src/layout/Header.tsx` — one flat `.hg-bar__body`; no `menuOpen` state, no Escape
  handler, no toggle, no drawer, no utility strip; settings/quick/account groups inline
- `frontend/src/hostinger-chrome.css` — section 8: flat link bar, 44px targets, gold focus ring,
  wrapping at narrow widths, non-sticky below 900px
- `frontend/tests/unit/hostinger-chrome.test.tsx` — rewritten to pin direct links, zero
  disclosures, inline settings/account controls and the footer contract
- `scripts/check-chrome-benchmark.mjs` — 18 checks for the flat bar at 1440/1280/1024/834/390
- `scripts/check-header-layout.mjs` — now measures `.hg-menu__link` (fails if any link is hidden)
- `scripts/capture-chrome-benchmark.mjs` — captures `menu-flat-desktop.png` instead of an opened
  dropdown, and reports `flatMenuLinks` / `dropdownTriggers`

## Verification

| Gate | Result |
| --- | --- |
| `npm run check:chrome` | **18/18** — 7 direct links, 0 disclosure remnants, settings/account inline, all widths visible, professional footer intact |
| `npm run evidence:layout` | 7 widths, **0.0px** overlap, 7 links visible at each |
| `npm run check:3d` | **15/15** |
| `node scripts/check-redesign-motion.mjs` | **34/34** |
| `python3 -m unittest discover -s tests/website` | **203 OK** (8 skipped) |
| `python3 -m unittest discover -s tests/security` | **77 OK** (1 skipped) |
| Targeted Vitest (12 files) | **508/508** |
| `npm run typecheck`, frontend `tsc --noEmit`, `npm run build:frontend` | clean |
| `node scripts/site/generate.mjs --check` | 221 links (210 app, 217 PHP) |
| `node scripts/site/check-links.mjs` | no broken/placeholder/dangling links |
| `python3 scripts/check-accessibility-contract.py` | 73 files, 47 controls, 1320 CSS rules, 19 media widths — all hold |
| `bash scripts/verify-rendered-site.sh --fetch` | 235 PHP-WASM fixtures, audits pass |
| `npm run evidence:screenshots` | 18/18 HTTP 200 |
| `npm run evidence:chrome` | 8 chrome/3D views, `flatMenuLinks=7`, `dropdownTriggers=0` |

Before/after evidence: `docs/evidence/flat-menu/before/` (caret triggers, compact dropdown and
`+` drawer accordion) and `docs/evidence/flat-menu/after/` (flat bar plus all 18 page renders).

## Blockers / unchanged limits

- No licensed WHMCS/cPanel staging; the theme is verified via PHP-WASM Smarty fixtures only.
- No Safari/Firefox, real-device, axe/WCAG-AA or Lighthouse audit in this pass.
- No production deployment, database change or live transaction. Financial and
  production-deploy freezes remain in force.
- The full 166-file Vitest suite was not run (it has historically timed out here); the targeted
  508-test run, 203-test website suite and 77-test security suite are the basis above.
- Photography licence/high-resolution blockers from the earlier redesign are unchanged
  (`docs/PHOTOGRAPHY-LICENSES.md`).
