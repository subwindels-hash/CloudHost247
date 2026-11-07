# 3D Experience + professional menu/footer

Two requests, implemented on both public surfaces:

1. **Add 3D Experience to Homepage.**
2. **Make the menu and footer look Professional. Rearrange in the footer links.**

This iteration supersedes the Amazon-footer / GoDaddy-menu chrome from `4c34a2d`
(`docs/CHROME-BENCHMARK-REPORT.md`). The registry links, keyboard/ARIA behaviour, responsive
breakpoints and the metallic gold/silver palette are preserved throughout.

## Interpretation

The two sentences are short, so these are the decisions taken (both are easy to revise):

- **"3D Experience"** = a *new interactive homepage section* with real CSS 3D depth, not a WebGL
  model or a third-party 3D library. The site already ships a dependency-free motion controller
  (`shared/site/motion.js` + `shared/site/metals.css`) with pointer tilt, reduced-motion and
  coarse-pointer off switches; reusing it avoids a new dependency, a GPU requirement and a second
  animation system. If a real Three.js/WebGL model was intended instead, that is a different scope
  and would add a runtime dependency — say the word and it can be swapped in.
- **"Professional"** = restrained corporate chrome: a light hairline-bordered menu bar and mega
  panel, dark-ink typography, a single solid accent, and a deep-slate footer with clear hierarchy
  instead of the retail-style navy bands, boxed locale pills and full-width "Back to top" strip.
- **"Rearrange in the footer links"** = regroup the eight registry footer columns into four
  *balanced* topic columns, each with two labelled sub-groups, so no column is a wall of links and
  no column is more than twice the size of another.

## #1 — 3D Experience on the homepage

New section after pricing: `Explore the platform in three dimensions`.

- Four platform layers (Edge & DNS, Compute & Hosting, Cloud & Storage, Operations) are drawn as
  real CSS 3D planes (`perspective` + `translateZ`) inside a `data-tilt` stage. The nearest plane is
  the first/active one; the stack staggers so every label stays readable.
- Pointer movement tilts the stack via the existing `shared/site/motion.js` controller (verified in
  real Chromium: `--tilt-x=3.92deg`, `--tilt-y=-4.48deg`). No parallax was added — motion.js keeps
  parallax hero-only, and the existing 34-check motion gate pins that contract.
- Four real buttons with `aria-pressed` drive an `aria-live="polite"` detail panel containing a link
  to the real route for the selected layer (`/domains`, `/hosting`, `/cloud`, `/status`). The planes
  are decorative (`aria-hidden`), so keyboard and screen-reader users get the same information and
  destination.
- Under `prefers-reduced-motion: reduce`, coarse pointers, or below 1024px, the planes become an
  ordinary vertical list — never four overlapping cards with invisible content.
- No WebGL, no new npm dependency, no external asset and no animation loop.

## #2 — Professional menu and footer, rearranged links

**Menu (SPA + WHMCS):** light `#fff` sticky bar with a hairline border, a slim light utility strip
(Pricing / All products / Platform status · Help / Search / Cart), dark ink nav triggers with a
single gold active underline, a white full-width mega panel with a tinted intro column and clearly
grouped links, and a compact gold CTA. The signed-in row and mobile drawer follow the same light
family. "Deals & pricing" was renamed "Pricing"; the retail tagline in the WHMCS utility bar was
replaced with a plain platform label.

**Footer (SPA + WHMCS):** a brand/description intro row with status + CTA, then four balanced
columns, then a compact legal bar with copyright, a plain locale read-out, policy links and an
inline "Back to top ↑" link. The retail pill boxes and the full-width back-to-top band are gone.

The eight registry columns are rearranged as follows (all 90 unique destinations still rendered —
no link invented or dropped):

| Column | Sub-groups | Links |
| --- | --- | --- |
| Products & Domains | Hosting · Domains | 20 |
| Cloud & Resources | Infrastructure · Resources | 23 |
| Developers & Tools | Developers · Tools | 24 |
| Company & Legal | Company · Legal | 23 |

Desktop footer height went from 820px (previous iteration) to 1053px because sub-headings and
single-column lists are more readable; the phone footer went from 2136px to **1964px**.

## Files

**SPA**

- `frontend/src/components/marketing/Experience3D.tsx`, `experience-3d.css` — new section
- `frontend/src/pages/HomePage.tsx` — section inserted after pricing
- `frontend/src/layout/Footer.tsx` — professional bands + four balanced grouped columns
- `frontend/src/layout/Header.tsx` — Professional labels, dark brand mark on the light bar
- `frontend/src/hostinger-chrome.css` — new section 6 (professional overrides)
- `frontend/tests/unit/experience-3d.test.tsx` — new keyboard/AT contract (3 tests)
- `frontend/tests/unit/hostinger-chrome.test.tsx` — footer contract updated
- `scripts/check-3d-experience.mjs` (`npm run check:3d`) — new real-Chromium acceptance check
- `scripts/check-chrome-benchmark.mjs` (`npm run check:chrome`) — updated for the professional chrome
- `scripts/capture-chrome-benchmark.mjs` (`npm run evidence:chrome`) — also captures the 3D section
- `scripts/check-redesign-motion.mjs` — reveal assertion de-flaked (scrolls the candidate into view)

**WHMCS theme**

- `templates/cloudhost247/includes/site-footer.tpl` — four paired columns with sub-headings,
  brand intro and compact legal bar; keeps `data-ch-tools-footer` on the Tools group
- `templates/cloudhost247/includes/site-nav.tpl` — neutral utility-bar label
- `templates/cloudhost247/css/chrome-benchmark.css` — professional overrides; stamp `20261109`
- `templates/cloudhost247/includes/site-head.tpl` — new `?v=` stamp
- `tests/website/test_visual_regressions.py` — cache-busting digest re-cut

## Verification

| Check | Result |
| --- | --- |
| `npm run check:3d` | **15/15** — 3D depth (`matrix3d`), tilt, layer switching, reduced-motion fallback, phone fallback, no overflow, no page errors |
| `npm run check:chrome` | **16/16** — light sticky header, light full-width mega panel, 4 balanced columns / 8 sub-groups, 90 links, inline back-to-top, dark legal bar, no overflow |
| `node scripts/check-redesign-motion.mjs` | **34/34** — existing motion/responsive contract intact |
| `npm run evidence:layout` | 7 widths, **0.0px** header overlap |
| `python3 -m unittest discover -s tests/website` | **203 OK** (8 skipped) |
| `python3 -m unittest discover -s tests/security` | **77 OK** (1 skipped) |
| Targeted Vitest (12 files) | **509/509** |
| `npm run typecheck`, frontend `tsc --noEmit`, `npm run build:frontend` | clean |
| `node scripts/site/generate.mjs --check` | 221 links (210 app, 217 PHP) |
| `node scripts/site/check-links.mjs` | no broken/placeholder/dangling links; 5 informational external-URL notes in untouched legal templates |
| `bash scripts/verify-rendered-site.sh --fetch` | **235 PHP-WASM fixtures**; 4 footer columns, 8 sub-groups, 103 links, tools hook present, all audits pass |
| `npm run evidence:screenshots` | 18/18 HTTP 200 |
| `npm run evidence:chrome` | 8 chrome/3D views captured before **and** after |

Before/after evidence: `docs/evidence/professional/before/` (7 chrome views + report, captured
from the previous iteration) and `docs/evidence/professional/after/` (8 chrome/3D views, 18 page
renders + reports). The before footer shots were taken with the earlier capture script and retain
its sticky-header overlay artifact; the after shots temporarily unstick the sticky header so the
brand intro row is visible, and wait for the section's one-shot reveal animation before capturing
the 3D section. Neither change affects the shipped page.

## Scope and blockers

- No licensed WHMCS/cPanel staging: the theme is verified through the PHP-WASM Smarty fixture
  renderer, not a live WHMCS instance.
- No Safari/Firefox, real-device, axe/WCAG-AA or Lighthouse audit in this pass.
- No production deployment, database change or live transaction. Financial and production-deploy
  freezes remain in force.
- The full 166-file Vitest suite was not run (it has historically timed out here); the targeted
  509-test run, 203-test website suite and 77-test security suite are the basis above.
- Photography licence/high-resolution blockers from the earlier redesign are unchanged
  (`docs/PHOTOGRAPHY-LICENSES.md`).
