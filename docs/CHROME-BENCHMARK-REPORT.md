> **Superseded.** This report describes the Amazon-footer / GoDaddy-menu iteration (commit
> `4c34a2d`). The current chrome is the professional corporate restyle with rearranged footer
> links and the homepage 3D Experience — see `docs/3D-EXPERIENCE-AND-PROFESSIONAL-CHROME.md`.

# Menu & footer chrome benchmark

Two requests, applied to both public surfaces:

1. Make the **footer** area look like the `www.amazon.com` footer.
2. Make the **menu** area look like the `www.godaddy.com` menu.

## What "look like" means here

Only the **visual anatomy** is borrowed. No third-party logo, mark, copy, review score,
product name, commerce link or stylesheet was copied, and no link was invented. CloudHost247's
brand, the shared registry (`NAV_SECTIONS` / `FOOTER_COLUMNS` / `UTILITY`), the gold/silver
metallic palette, the existing keyboard/ARIA behaviour and every responsive breakpoint are
preserved. This is a restyle of the same components, not a second implementation.

The reference pages were consulted as rendered text/structure (Amazon footer bands and GoDaddy's
dark two-tier navigation), not screenshotted or cloned.

## #1 — Amazon-style footer (SPA + WHMCS)

Amazon's footer is a five-band directory. CloudHost247 now uses the same shape:

| Band | Implementation |
| --- | --- |
| Full-width "Back to top" strip | `.hg-footer__top` / `.ch-footer__top`, a real anchor to `#ch247-top` on the header |
| Deep navy link directory | four topic columns, white 16px headings, dense 13px muted links, hover underline |
| Divided brand + locale row | white logo, tagline, three outlined locale pills, one gold Create Account CTA |
| Darkest legal band | centred policy links, then the copyright line |

The eight registry footer columns are merged into four topics (`Hosting, Cloud & Servers`,
`Domains & Developers`, `Tools & Resources`, `Company & Legal`) and de-duplicated by destination.
**All 92 unique registry destinations remain rendered** — no link is dropped, and the
`hostinger-chrome.test.tsx` / `navigation-links.test.ts` contracts still cover every one. The
WHMCS theme renders its eight registry groups in a four-column grid in the same bands.

The locale pills are a **read-out**, not a second set of interactive switchers: language and
currency controls still live in the header only (`Header.test.tsx`). Amazon's own affiliate-brand
band has no CloudHost247 equivalent, so it was not imitated with invented brands.

Result: the desktop footer is **820px tall instead of 1173px**, and the phone footer **2136px
instead of 3107px**. Long labels now wrap at spaces rather than breaking mid-word (the old
`overflow-wrap: anywhere` on 100px-wide columns produced "Complian ce", "Registrati on").

## #2 — GoDaddy-style menu (SPA + WHMCS)

| Element | Implementation |
| --- | --- |
| Slim dark utility strip | "Deals & pricing / All products / Platform status" and "Help / Search / Cart", all pre-existing registry destinations; collapses below 768px |
| Near-black product bar | `#0d1116` sticky header, white brand mark, white dropdown triggers with a gold active underline |
| Full-width dark mega panel | `#171e27` panel, highlighted promo column, gold group headings, "see all" foot bar |
| Right-hand cluster | language/currency pills, search, Sign In, gold Create Account CTA |
| Signed-in row + mobile drawer | restyled in the same dark family; the accordion, Escape-to-close and outside-click behaviour are unchanged |

The extra cart icon in the main bar was removed after `evidence:layout` measured a **25.8px
overlap** at 1440px; the cart link lives in the utility strip instead. Final measurement is
**0.0px overlap at all seven widths** (1920 / 1600 / 1440 / 1280 / 1024 / 834 / 390).

## Files

**SPA**

- `frontend/src/layout/Footer.tsx` — Amazon band structure, four topics, locale pills, legal band
- `frontend/src/layout/Header.tsx` — utility strip, `#ch247-top`, white brand mark, dark-bar cluster
- `frontend/src/components/navigation/PlatformMegaMenu.tsx` — `on-dark` white logo support
- `frontend/src/hostinger-chrome.css` — new section 5 (GoDaddy chrome + Amazon bands)
- `frontend/tests/unit/hostinger-chrome.test.tsx` — footer contract updated to the new anatomy,
  still asserting every registry destination is rendered
- `scripts/capture-chrome-benchmark.mjs`, `scripts/check-chrome-benchmark.mjs` — new evidence and
  real-Chromium acceptance checks; exposed as `npm run evidence:chrome` / `npm run check:chrome`

**WHMCS theme**

- `templates/cloudhost247/includes/site-footer.tpl` — Amazon bands, same registry footer links
- `templates/cloudhost247/includes/site-nav.tpl` — `#ch247-top`, extra utility links, cart link
- `templates/cloudhost247/css/chrome-benchmark.css` — new first-party sheet, loaded last
- `templates/cloudhost247/includes/site-head.tpl` — links the new sheet with its own `?v=` stamp
- `tests/website/test_visual_regressions.py` — new cache-busting digest
- `scripts/verify-website.py` — class audit now reads the two additional shipped sheets

## Verification

| Check | Result |
| --- | --- |
| `node scripts/site/generate.mjs --check` | ✓ 221 links (210 app, 217 PHP) |
| `node scripts/site/check-links.mjs` | ✓ 2221 surfaces, no broken/dangling links (5 pre-existing external notes) |
| `python3 -m unittest discover -s tests/website` | **203 OK** (8 skipped) |
| PHP-WASM `verify-rendered-site.sh --fetch` | **235 fixtures** rendered; QA/hero/tools audits pass; new sheet and footer classes present in rendered HTML |
| `npm run typecheck`, `tsc -p frontend/tsconfig.json --noEmit` | ✓ clean |
| Targeted Vitest (11 files incl. `Header`, `hostinger-chrome`, `navigation-links`) | **506/506** |
| `npm run build:frontend` | ✓ clean |
| `npm run evidence:layout` | ✓ 7 widths, **0.0px** overlap |
| `npm run check:chrome` | **16/16** real-Chromium checks (dark header, full-width dark mega, back-to-top anchor, 4 columns, 92 links, 3 pills, dark legal band, no overflow at 1440/390) |
| `npm run evidence:screenshots` | 18/18 HTTP 200 |
| `npm run evidence:chrome` | 7 chrome views (3 headers, 3 footers, 1 open mega menu) captured before **and** after |

Before/after evidence: `docs/evidence/chrome/before/` and `docs/evidence/chrome/after/`
(`header-*`, `footer-*`, `menu-open-desktop.png`, `chrome-report.json`). The `after/` folder also
holds the 18-page `evidence:screenshots` sweep showing the new chrome on every published route;
`docs/evidence/redesign/after/` (the merged pre-benchmark design) serves as the wider page-level
"before".

## Scope and blockers

- No licensed WHMCS/cPanel staging install: the WHMCS theme was verified through the PHP-WASM
  Smarty fixture renderer, not a live WHMCS instance.
- No Safari/Firefox, real-device, axe/WCAG-AA or Lighthouse audit was run in this pass.
- No production deployment, database change or live transaction. The financial freeze and
  production-deploy freeze remain in force.
- The full 166-file Vitest suite was not run (it has historically timed out here); the targeted
  506-test run plus the 203-test website suite are the basis for the checks above.
- Photography licence/high-resolution blockers from the previous redesign are unchanged and
  documented in `docs/PHOTOGRAPHY-LICENSES.md`.
