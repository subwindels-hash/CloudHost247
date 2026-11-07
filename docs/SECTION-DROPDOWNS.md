# Section dropdown arrows + sub-links on the top menu

> **#1** — keep `Sign In` on the same straight line as the controls beside it.
> **#2** — add a dropdown arrow to `Hosting`, `Cloud & Servers`, `Domains`, `Platforms`,
> `Tools`, `Resources`, `Company`, and add their sub-links on the top menu.

## #1 — Sign In stays on the line

All six utility controls (`Pricing`, `Help`, `English ▾`, `USD ▾`, `Sign In`,
`Create Account`) are now hard-pinned to a single non-wrapping line: every child group and every
control gets `flex-wrap: nowrap` / `white-space: nowrap`, and the row itself is `flex-wrap: nowrap`.
Nothing can drop onto a second row at any width or text-zoom level.

This is now checked at **every** tested width, not just 1440 and 390. Real Chromium reports the
six vertical centres as `59/59/59/59/59/59` at 1280, 1024 and 834, and `57/57/57/57/57/57` at
390 — i.e. one straight line, with the compact 30px (28px on phones) Create Account button still
beside Sign In.

## #2 — Arrows and sub-links

Every section label is **still a direct, always-visible link** beside the logo. Each now has its
own dropdown arrow immediately after it:

```
⬡ CloudHost247   Hosting ▾  Cloud & Servers ▾  Domains ▾  Platforms ▾  Tools ▾  Resources ▾  Company ▾   🔍 🛒
```

- Clicking the **label** goes to the section landing page (`/hosting`, `/cloud`, `/domains`,
  `/platforms`, `/tools`, `/docs`, `/about`), exactly as before.
- Clicking the **arrow** opens a full-width directory under the top menu with that section's real
  sub-links, grouped by category, plus a "View all …" link, a Close button and the section's
  featured destination.
- Sub-links come straight from the shared registry — **108 verified routes across the seven
  panels** (Hosting 21, Cloud & Servers 19, Domains 13, Platforms 18, Tools 11, Resources 15,
  Company 11). Tools is built from `TOOLS_CATEGORIES` because its contents are catalogue-driven.
  No link is invented, and `check:chrome` now verifies every rendered sub-link `href` against
  `shared/site/registry.json`.
- **Click-only**, not hover: pointer, touch and keyboard behave identically and a click can never
  toggle a hover-opened panel shut. Each caret is a real `<button>` with
  `aria-label="<Section> sub-links"`, `aria-expanded` and `aria-controls="ch247-menu-panel"`.
  `Escape` closes and returns focus to the arrow; an outside click or a route change closes it.
  Only one section is open at a time.
- The panel is absolutely positioned against the sticky header, so opening it never changes the
  bar height or shifts the page. It scrolls internally on small screens; no horizontal overflow
  at 390 / 834 / 1280 / 1440.
- No hamburger, drawer, `+` accordion or legacy mega panel returned. The professional footer,
  3D Experience, utility line and all 221 registry destinations are unchanged.

## Files

- `frontend/src/components/navigation/PlatformMegaMenu.tsx` — `PlatformMenu` now renders seven
  link + caret pairs and one shared sub-link panel; `Brand` / `useNavigationSections` unchanged.
- `frontend/src/hostinger-chrome.css` — section 10: caret states, dark dropdown directory,
  grouped sub-links, badges, reduced-motion rule, plus the utility-line nowrap hardening.
- `frontend/tests/unit/hostinger-chrome.test.tsx` — rewritten for the arrow contract: 7 carets,
  labels/ARIA, a hidden panel, registry-exact sub-links on open, Escape-to-close, and the six
  controls on one utility line.
- `scripts/check-chrome-benchmark.mjs` — 36 checks; new: 7 labelled carets, registry-verified
  sub-links for all seven sections, Escape/focus restoration, and the straight utility line at
  every width.
- `scripts/capture-chrome-benchmark.mjs` — reports `dropdownCarets` / `openSubLinks` and captures
  `menu-open-desktop.png` alongside the closed-state shot.

## Verification

| Gate | Result |
| --- | --- |
| `npm run check:chrome` | **36/36** — 7 carets, 7 panels with 21/19/13/18/11/15/11 registry-verified sub-links, Escape restores focus, utility line straight at 1280/1024/834/390 |
| `npm run evidence:layout` | 7 widths, **0.0px** overlap, 7 section links visible at each |
| `npm run check:3d` | **15/15** |
| `node scripts/check-redesign-motion.mjs` | **34/34** |
| `python3 -m unittest discover -s tests/website` | **203 OK** (8 skipped) |
| `python3 -m unittest discover -s tests/security` | **77 OK** (1 skipped) |
| Targeted Vitest (12 files) | **510/510** |
| `npm run typecheck`, frontend `tsc --noEmit`, `npm run build:frontend` | clean |
| `node scripts/site/generate.mjs --check` | 221 links (210 app, 217 PHP) |
| `node scripts/site/check-links.mjs` | no broken/placeholder/dangling links |
| `python3 scripts/check-accessibility-contract.py` | 73 files, 47 controls, 1320 CSS rules, 19 media widths — all hold |
| `bash scripts/verify-rendered-site.sh --fetch` | 235 PHP-WASM fixtures, audits pass |
| `npm run evidence:screenshots` | 18/18 HTTP 200 |
| `npm run evidence:chrome` | 12 chrome/views, `flatMenuLinks=7`, `dropdownCarets=7`, `openSubLinks=21` |

Before/after evidence: `docs/evidence/section-dropdowns/before/` (no arrows) and
`docs/evidence/section-dropdowns/after/` (closed bar with arrows, `menu-open-desktop.png` showing
the Hosting directory, plus all 18 page renders). `docs/evidence/professional/after/` was
refreshed to the current build.

## Scope / unchanged limits

- SPA only. The WHMCS/PHP theme keeps its `<details>/<summary>` navigation because
  `check-accessibility-contract.py`, `test_accessibility_contract.py` and `verify-website.py`
  require it for no-JS operability (see `docs/FLAT-MENU.md`).
- `English ▾` / `USD ▾` remain settings disclosures, now inline on the utility line.
- No licensed WHMCS/cPanel staging, Safari/Firefox, real-device, axe/WCAG-AA or Lighthouse audit
  in this pass.
- No production deployment, database change or live transaction; financial and production-deploy
  freezes remain in force.
- The full 166-file Vitest suite was not run (it has historically timed out here); the targeted
  510-test run, 203-test website suite and 77-test security suite are the basis above.
- Photography licence/high-resolution blockers are unchanged (`docs/PHOTOGRAPHY-LICENSES.md`).
