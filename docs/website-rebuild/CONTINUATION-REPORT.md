# CloudHost247 public website — 3D visual continuation

**Date:** 2026-10-07
**Branch:** `arena/14d4207f-cloudhost247`
**Base:** `fd5ceec` (merge of PR #62)
**Deployment state:** **not deployed.** Production release remains gated on WHMCS staging verification.

This pass continues the rebuild after PR #62. That merge delivered the registry, the design system,
the nine mega menus, the nine footer columns, the 54 marketing pages and the crawl policy. What it
explicitly left open was the **premium 3D/isometric visual language**, per-page illustration
upgrade, homepage domain search, and PHP header account controls matching the brief.

This report is the record of that continuation. It does not claim that PR #62’s work is undone;
it claims the remaining visual system is now implemented on both published surfaces.

---

## 1. Pages audited

| Surface | Count |
|---|---|
| Root PHP pages | 84 (`phpPagesKnown`) |
| SPA route declarations | 134 |
| Marketing page definitions | 54 |
| Legal documents | 17 |
| Published documentation files | 13 |
| Tool paths in the published catalogue | 67 |
| WHMCS theme templates | 86 |
| Link-checked surfaces | 2,179 |

Every public page already classified in `GLOBAL-AUDIT.md` remains accounted for. This pass did not
add or remove routes; it upgraded the visual presentation of the pages that already exist.

## 2. Pages rebuilt (this pass)

* **Homepage (SPA + PHP)** — 3D hero, live domain search, four product-family spotlights,
  developer-platform split, existing trust/tools/CTA retained.
* **54 marketing pages** — every page now prefers a 3D raster via `<picture>` while keeping the
  SVG diagram as the `<img>` fallback (the file the generator and the page tests assert).
* **67 PHP product/legal pages** — `visual3d` attached in `site.json`; `product-hero.tpl` and
  `product-sections.tpl` render through one `includes/visual.tpl`.
* **Header (PHP)** — logged-out controls are Sign In + Create Account, matching the brief and the
  SPA header. Search was already present.

## 3. Routes audited

134 SPA declarations + 84 root PHP pages + 14 licensed WHMCS entry points + 67 published tool paths.

```
node scripts/site/generate.mjs --check
✓ registry valid — 227 links (227 app, 227 PHP)
```

Registry version **2.1.0**.

## 4. Navigation links audited

227 destinations across 9 mega menus. Unchanged in count from PR #62; destinations still resolve
on both surfaces. PHP header now publishes Create Account on desktop (it was mobile-only).

## 5. Footer links audited

9 footer columns, registry-driven. `check-links.mjs`: **0 broken**.

## 6. Broken links found and fixed

| Finding | Resolution |
|---|---|
| PHP header hid Create Account behind `ch-mobile-only` and duplicated Client Area / Get Started | Sign In + Create Account, matching the SPA |
| Homepage had no domain search | SPA form navigates to `/domains?q=`; PHP form posts into `cart.php?a=add&domain=register` |
| `/domains?q=` was ignored | `DomainsMarketingPage` reads `q` and runs the real search |
| 3D rasters were missing (PR #62 left this open) | 10 original 3D scenes, family fallbacks for every page |

`check-links.mjs`: **2,179 surfaces · 957 internal · 441 PHP · 0 broken**.

## 7. Assets generated

**10 original 3D JPEG scenes** (1280px wide, 71–136 KB each), plus the existing 161 SVG/PNG/WebP
library. Generator copy: **171 assets**.

| File | Use |
|---|---|
| `hero/infrastructure-3d.jpg` | Homepage hero, family fallback |
| `hero/global-network-3d.jpg` | Conceptual network (explicitly not a location map) |
| `hosting/web-hosting-3d.jpg` | Web hosting + hosting-family fallback |
| `hosting/wordpress-hosting-3d.jpg` | WordPress hosting |
| `cloud/vps-3d.jpg` | VPS + cloud-family fallback |
| `servers/dedicated-servers-3d.jpg` | Dedicated / servers-family fallback |
| `domains/domain-network-3d.jpg` | Domains family |
| `applications/application-stack-3d.jpg` | Applications / marketplace |
| `deployment/deployment-pipeline-3d.jpg` | Developer / deployment family |
| `tools/hero-3d.jpg` | Tools family |

Every marketing page and every PHP page receives a `visual3d` key: exact match if the file exists,
otherwise the family fallback, otherwise the homepage infrastructure scene. Missing rasters are
never published — the template falls back to the SVG.

Folders reserved for future artwork (`website/`, `panels/`, `platforms/`, `backgrounds/`,
`network/`) are documented; pages currently fall back rather than inventing unsupported panels.

## 8. Logos generated

None in this pass. The existing brand system (horizontal / stacked / compact / icon, dark / white /
mono, SVG + PNG + WebP, favicon set, social image) from PR #62 remains the source of truth.

## 9. Application logos generated

None fabricated. Existing application marks (WordPress, Ghost, PrestaShop, Node.js, PHP, Python,
Laravel, Docker, generic stack) remain. Third-party trademarks are still not invented.

## 10. Mega-menu categories

Unchanged nine families:

```
hosting · cloud · domains · platforms · developers · websites · tools · resources · support
```

## 11. Remaining legacy branding

`python3 scripts/branding-audit.py --quiet` → **0** retired-brand matches (5,613 text files).

Vendor module directory names and ionCube identifiers remain for compatibility, as documented in
`docs/BRANDING-COMPATIBILITY.md`.

## 12. Tests executed (this pass)

| Check | Result |
|---|---|
| Registry generator `--check` | 227 links, 0 errors |
| `python3 -m unittest discover -s tests/website` | **14 tests, OK** (includes new 3D raster existence test) |
| PHP website suite (`tests/website/run.php`) | **315 assertions, 0 failed** |
| PHP tools suite | **882 assertions, 0 failed** |
| `python3 scripts/verify-website.py` | `passed true`, 67 registry pages |
| Link integrity | 2,179 surfaces, 0 broken |
| Frontend marketing + design-system tests | **343 passed** |
| Frontend `tsc --noEmit` | clean |
| Retired-brand audit | 0 matches |

## 13. Build result

Generator copy: 171 media assets into `/media/cloudhost247`. Design-system copy refreshed.
Frontend typecheck clean. Production archive: see §14.

## 14. Production ZIP

```
/home/user/CloudHost247-release/CloudHost247-production-2.1.0.zip
```

```
python3 scripts/build-production-zip.py --version 2.1.0 --verify
wrote .../CloudHost247-production-2.1.0.zip files=7717 bytes=60259534 secret_skipped=0
media assets present: 171
published documentation files: 13
archive members: 7717
archive size: 57.5 MB
✓ production archive verified: deployable, complete, no secret material
```

## 15. Commit and pull request

* Commit: `8abf70d451cad0e6b17528214cc8187d79a37acd`
* Branch: `arena/14d4207f-cloudhost247`
* PR: https://github.com/subwindels-hash/CloudHost247/pull/63 (draft, base `main`)

## 16. Genuine blockers

1. **WHMCS staging verification cannot run here.** Licensed runtime and production-like database
   are not in this sandbox. Nothing was deployed.
2. **No browser binary**, so 3D layout, focus order and contrast are asserted from source and
   stylesheet contract, not observed on a device.
3. **Image-generation cap** limited this pass to ten 3D scenes. Remaining families (security,
   website builder, email, SSL, data-center hall) use the family fallback until more art is added.
   The SVG diagrams remain for every page.
4. **WebP encode** is not available in this environment’s ImageMagick; 3D scenes ship as
   optimized JPEG (71–136 KB) with SVG fallback. Adding WebP later is a compression change, not a
   design change.

Inherited from PR #62, still owner decisions rather than code defects:

* legal copy still contains “CloudHost247 Isc.” (approved brand form in the brief) and a WHMCS
  attribution at the end of the privacy document;
* addon admin/client-area Bootstrap templates are vendor-integrity pinned;
* two native tools labelled `customer`/`auth-required` in the registry are published as public
  pages (`/tools/broken-link-checker`, `/tools/reverse-ip-lookup`) — gate or relabel.
