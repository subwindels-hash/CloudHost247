> **Follow-up.** The main bar now has a dropdown arrow beside each of the seven section
> links, with registry sub-links in a panel under the top menu. The utility line itself is
> unchanged — see `docs/SECTION-DROPDOWNS.md`.

# Utility line under the announcement bar

> **Request:** move `Pricing`, `Help`, `English▾`, `USD▾`, `Sign In`, `Create Account` onto one
> straight line below the announcement bar, and make the **Create Account** button shorter so it
> fits in that section.

## Result

The header is now two shallow rows, both dark, both with every control visible:

```
┌─ announcement bar (gold, site-wide) ───────────────────────────────────────┐
├─ utility line:  ◎ English ▾  USD ▾  Pricing  Help  🔍 🛒  Sign In  [Create Account] ┤  42px
├─ main bar:  ⬡ CloudHost247   Hosting  Cloud & Servers  Domains  Platforms …  ┤  63px
└────────────────────────────────────────────────────────────────────────────┘
```

The row is four flex children, left to right — `.ch247-visitor-privacy` (the privacy/country
strip), `nav.hg-bar__quick` (the locale switchers **and** the Pricing/Help links), `.hg-bar__icons`
(search, cart) and `.hg-bar__actions` (Sign In, `[Create Account]`). The locale switchers live
inside `.hg-bar__quick`, so `locale.nextElementSibling` is the `/pricing` link, not the icon
group; assert the group *order* (`quick → icons → actions`) rather than locale adjacency.

- The six controls sit on **one straight line**, right-aligned, with the same vertical centre at
  1440/1280/1024/834/390px. Real Chromium measured all six centres at `y=63` (desktop) and
  `y=106` (390px). What is asserted is that shared centre, not the container's `flex-wrap` value —
  below 900px the privacy strip takes its own line and the container legitimately wraps, while the
  six controls still measure level.
- The line starts exactly where the announcement bar ends (`38.375px → 38px`) and the main bar
  starts where the line ends (`80px`).
- The **Create Account** button is now **30px tall** (was 42px for `.hg-btn--sm`, 52px for the
  base `.hg-btn`), with reduced padding and font size — it fits inside the 42px row without
  stretching it. On a phone it is 28px inside a 38px row.
- The main bar keeps the white brand mark, all seven registry sections as direct links, and the
  search/cart icons. No dropdowns were reintroduced.
- At 390px the six still fit on one line: the row takes the second visual line under the
  full-width privacy strip, the globe icon is hidden and type/gaps tighten
  (`@media (max-width: 430px)` at the end of `hostinger-chrome.css`), so nothing wraps, scrolls or
  gets clipped and the language/currency disclosures still open. Measured: six centres at `y=106`,
  `scrollWidth === clientWidth`.
- **Create Account is part of the contract, not decoration.** It was dropped from
  `Header.tsx`'s signed-out branch at some point, leaving five controls and no visible route into
  registration from the header. `Header.test.tsx` had been changed to assert its *absence*. Both
  `Header.test.tsx` and `hostinger-chrome.test.tsx` now assert the six by name.

All links are unchanged — `/pricing`, `/help`, `/login`, `/register`, `/search`, `/cart` and the
seven section routes. The professional footer, the homepage 3D Experience and the 221-link
registry are untouched.

## Files

- `frontend/src/layout/Header.tsx` — new `.hg-bar__top` row holding the quick links, locale
  switchers and account controls; `.hg-nav__bar` now holds the brand, `PlatformMenu` and the
  search/cart icons. `#ch247-primary-nav` wraps both rows so the navigation landmark and its
  tests stay intact.
- `frontend/src/hostinger-chrome.css` — section 9: the straight utility line, compact 30px CTA,
  phone compaction. No `overflow-x` scrolling (that would clip the locale disclosures).
- `scripts/check-chrome-benchmark.mjs` — 5 new checks: line position under the announcement,
  six controls sharing one line, shallow row, compact CTA, and the same one-line contract at
  390px (23 checks total).
- `scripts/capture-chrome-benchmark.mjs` — captures `utility-row-{desktop,tablet,mobile}.png`
  as dedicated evidence.

## Verification

| Gate | Result |
| --- | --- |
| `npm run check:chrome` | **31/36** — every header check passes: utility line at y=38–80 under the announcement, 6 controls on one line (centres 63/63/63/63/63/63), 30px CTA; 1280/1024/834/390 all one line, Menu disclosure at 390px. The 5 remaining failures are the footer/brand checks (6-column footer vs. an expected 4, footer intro band, legal-bar back-to-top, light directory background, `-white` brand asset) — all failing identically on the pre-fix commit, none touched by this work |
| `npm run evidence:layout` | 7 widths, **0.0px** overlap; 7 flat section links at ≥768px, the Menu disclosure at 390px |
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
| `npm run evidence:chrome` | 11 chrome/3D/utility views, `flatMenuLinks=7`, `dropdownTriggers=0` |

Before/after evidence: `docs/evidence/utility-row/before/` (everything on the single main bar)
and `docs/evidence/utility-row/after/` (announcement → utility line → main bar, plus all 18 page
renders). `docs/evidence/professional/after/` was refreshed to the current build.

## Scope / unchanged limits

- SPA only. The WHMCS/PHP theme keeps its `<details>/<summary>` navigation because
  `check-accessibility-contract.py`, `test_accessibility_contract.py` and `verify-website.py`
  require it for no-JS operability (see `docs/FLAT-MENU.md`).
- No licensed WHMCS/cPanel staging, Safari/Firefox, real-device, axe/WCAG-AA or Lighthouse audit
  in this pass.
- No production deployment, database change or live transaction; financial and production-deploy
  freezes remain in force.
- The full 166-file Vitest suite was not run (it has historically timed out here); the targeted
  508-test run, 203-test website suite and 77-test security suite are the basis above.
- Photography licence/high-resolution blockers are unchanged (`docs/PHOTOGRAPHY-LICENSES.md`).
