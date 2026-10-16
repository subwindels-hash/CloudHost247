# Website preservation report — 2026-10-16

Preservation-first maintenance pass on `subwindels-hash/CloudHost247`. This report answers the ten
required items in order, records what was deliberately **not** changed and why, and lists the
decisions that are still yours to make.

Branch `arena/4497b4b5-cloudhost247` · baseline `94d20e94f4e7b8a45c973823bbd30d1a0953afcc` (the
merge of PR #86) · three commits, pushed to `origin` · **nothing deployed anywhere**.

---

## 1. Root cause

The appearance of the PHP/WHMCS site changed on **2026-10-15** in one commit that described itself as
a synchronisation with no visual effect:

| | |
|---|---|
| commit | `18246b6` |
| pull request | #85 — "Complete repository-wide website audit, visual asset synchronization, and production verification" |
| merged | `5057b0b`, 2026-10-15 05:19Z |
| what it claims | "Synchronized visual asset ladders … Verified 3D scene renders … 0 missing image references" |
| what it changed | twelve card slots on eleven pages, the copy on one page, the descriptions on two, and none of that was mentioned |

**Mechanism.** `scripts/site/generate.mjs` builds `contentIconAssets()`: one index of every artwork
file under `assets/images/cloudhost247/`, keyed by file *basename*, with a single tie-break rule —

```js
// `icons/cloud.svg` wins over `cloud/cloud.svg`: the icon family is the one drawn for cards.
if (!index.has(name) || family === 'icons') index.set(name, `${family}/${name}.svg`);
```

PR #85 added twenty-one files to the `icons/` family, two of them named `firewall.svg` and
`network.svg` — names the isometric families `management/` and `cloud/` already owned. Because
`icons/` wins the tie, regenerating the theme registry repointed the card slots at the new glyphs.

The result is a visible mismatch, not a neutral swap. `product-sections.tpl` draws each of these
slots as a 21×21 `<img>` inside `.ch-card__icon` — a 42px tile that paints its own light background
and border — while the new flat glyph carries a baked-in opaque `#ecf5ef` rounded square. So a flat
icon landed inside a tile drawn for isometric scenes, on cards whose own page hero still showed the
scene. The flat `icons/` family is drawn for the homepage card (`.ch-card-top`, no tile background).

**Two further drifts from the same commit**, both data rather than markup, so no rendered-page gate
could see them:

* `backups.php` lost the list authored for it ("Your own copy of critical data / A tested recovery
  plan / A version control system for code") to the generic list fourteen other pages already showed.
* `dns-management.php` and `domain-dns.php` lost the descriptions authored for them. `Site.php`
  prefers a page's `seo_description` over its `summary` precisely so that pages do not all share one
  formulaic sentence; the regenerated inventory flagged both rows `no seo_description` afterwards.

**A second instance of the same class of defect, found while auditing.** `platform/public/index.html`
is *generated* by `platform/scripts/build-site.cjs`, but the 2026-10-16 homepage pass edited only the
generated file. The headline "Build. Host. Deploy. Scale.", its lede and its three CTAs existed in
the served page and nowhere else, so the next build reverted them — and the platform's own test suite
rebuilds the site on every run, so the page and the repository disagreed for as long as nobody
rebuilt. This one is now resolved (see §3 and §9).

**A separate defect fixed in the same pass.** Five theme assets are served under a `?v=` cache-busting
stamp, and the repository bumps it deliberately after asset changes (`3096eb6`, "bump asset versions
to 20261007 to force cache invalidation"). `site.css` and `design-system.css` (2026-10-12), `site.js`
(2026-10-16), `tools.css` and `tools.js` (2026-10-11) all changed while the stamp stayed at
`20261007`, so a returning visitor could hold a pre-change stylesheet against post-change markup.

## 2. Affected files

Introduced by `18246b6`, confirmed by `git log -S` on the exact strings:

* `modules/addons/cloudhost247_theme/resources/site.json` — 12 `icon` values, the `backups.php`
  `uses` list, 2 `seo_description` values (all generator output for `shared/site/**` plus the
  page-authoring fields).
* `assets/images/cloudhost247/icons/firewall.svg`, `…/icons/network.svg` — the two shadowing files.
* Their served mirrors under `cloudhost247-node/frontend/public/media/cloudhost247/icons/`, which
  `scripts/generate-raster-formats.py --check` keeps byte-identical.

Stamp defect: `templates/cloudhost247/includes/site-head.tpl`,
`templates/cloudhost247/cloudhost247-tools.tpl`.

Generator/source defect: `platform/scripts/build-site.cjs` versus `platform/public/index.html`.

## 3. Correction

Three commits, each deliberately minimal.

**`a57db72` — "Restore the artwork and copy a synchronisation pass changed on eleven pages"** (12 files, +269/−34):

1. Deleted the two shadowing files, source library **and** served mirror.
2. Regenerated. The diff is *exactly* the twelve slots and `assetsCopied: 468 → 466` in the route
   report — nothing else in any surface moved:

   | page | slot | broken state | restored |
   |---|---|---|---|
   | `vps-hosting.php` | 4 | `icons/firewall.svg` | `management/firewall.svg` |
   | `vps-privatecloud.php` | 5 | `icons/network.svg` | `cloud/network.svg` |
   | `vps-publiccloud.php` | 4 | `icons/firewall.svg` | `management/firewall.svg` |
   | `cloudhost247-hosting.php` | 20, 22 | `icons/network.svg`, `icons/firewall.svg` | `cloud/network.svg`, `management/firewall.svg` |
   | `server-management.php` | 4 | `icons/firewall.svg` | `management/firewall.svg` |
   | `infrastructure.php` | 2 | `icons/network.svg` | `cloud/network.svg` |
   | `data-centers.php` | 4 | `icons/network.svg` | `cloud/network.svg` |
   | `network.php` | 3 | `icons/firewall.svg` | `management/firewall.svg` |
   | `monitoring.php` | 3 | `icons/network.svg` | `cloud/network.svg` |
   | `firewall.php` | 1 | `icons/firewall.svg` | `management/firewall.svg` |
   | `managed-services.php` | 4 | `icons/firewall.svg` | `management/firewall.svg` |

3. Restored the `backups.php` list and the two descriptions. Regenerating afterwards keeps all three
   — the registry is the durable source for those fields, verified by re-running the generator.
4. Moved the stamp `20261007 → 20261016` on all five assets.
5. Added `tests/website/test_visual_regressions.py` (6 tests), wired into
   `scripts/release-candidate-check.sh`. It fails when a card icon resolves from a family the
   `icons/` names shadow, when the reviewed artwork stops being the artwork, when a page loses its
   authored copy, or when an asset changes without its stamp moving (that last rule is an approval
   gate: re-cutting the recorded `(stamp, digest)` pairs is the reviewed act).

**`1bb76dc` — "Add an opt-in FRAME_ANCESTORS setting so a preview host can embed the platform."**
`X-Frame-Options: DENY` and `frame-ancestors 'none'` remain the default; a configured
`FRAME_ANCESTORS` (empty by default, documented in `.env.example`) emits its own enforced
`Content-Security-Policy: frame-ancestors …` header. Policies combine by intersection, so this can
only add the framing rule and relaxes nothing else.

**`fd74ef9` — "Keep the homepage headline in the generator that emits it."** Per your decision, the
headline stays "Build. Host. Deploy. Scale." — and moves into `build-site.cjs`, so the built page is
the reviewed page, all three CTA targets resolve (`/hosting`, `/hosting/vps`, `/domains`), and a
rebuild of the 42-page site is now a no-op. No other page changes.

No template markup, stylesheet, layout, palette, font, spacing or component was redesigned. The
patch moves no CSS byte.

## 4. Design preservation (deliberately unchanged)

* Header, announcement bar, mega menu, navigation registry, footer — untouched.
* `site.css`, `design-system.css`, `custom.css`, `tools.css`, `announcementbar.css` — byte-identical
  to the baseline; only the `?v=` query string moved.
* Artwork files keep their bytes, including PR #85's caption normalisation (see §9).
* All templates except the two stamp lines; `templates/orderforms/**`; every root `*.php` page;
  `shared/site/**` except the regenerated route report.
* Homepage, hero, 3D/isometric system, logo, favicon, icon sets.
* Nothing else was deleted; no CSS or asset was removed on the suspicion of being unused.

## 5. Functional verification

* `bash scripts/verify-rendered-site.sh` — **exit 0**, all 229 published pages rendered through the
  shipped Smarty components and audited on a clean rebuild: 907 images, 3 063 asset references,
  42 393 links, 194 canonical addresses, 47 pages with a 3D hero, tools surface 265 published /
  257 derivable. Run before and after the fix; both green — which is exactly why this regression
  needed a new check rather than a louder existing one.
* Registry-to-render proof for the fixed slots is in §3; the guard pins them against future drift.
* `python3 scripts/audit-navigation-inventory.py` — rebuilt; `ORPHANED PAGES 0`,
  `MENU LINKS WITHOUT PAGES 0`, `PAGES WITHOUT NAV DISCOVERY 0`, `UNREGISTERED PUBLIC PAGES 0`,
  `DANGLING REDIRECTS 0`, `DUPLICATE CANONICALS 0`.
* `python3 scripts/generate-raster-formats.py --check` — served mirror in sync.
* Live platform instance: `/health` 200, `/api/v1/catalog` serving the seeded catalogue, homepage
  serving the kept hero, and the framing header now `Content-Security-Policy: frame-ancestors
  https://*.e2b.app` with no `X-Frame-Options: DENY` — the sandbox-only case the setting exists for.
* Platform suite: 846 tests, **846 pass** on the committed tree (see §7 for the local-`.env` caveat).
* Authentication, billing, checkout, provisioning and WHMCS flows: unchanged by this patch and
  exercised by the release gate; no WHMCS-licensed behaviour could be executed here (§7).

## 6. Regression results

* All 229 rendered pages: no dead internal links, no missing images, no duplicate ids, one title per
  page, intact heading outline. Before/after figures are identical except the twelve slot URLs above.
* Website suite: **141 tests ok**, 8 skipped, including the 6 new ones.
* Page inventory: 84 root PHP pages, 67 registered public, 89 navigation destinations, 68 footer
  destinations, 49 distinct hero scenes, 0 orphans, 0 dangling redirects, 0 duplicate canonicals.
* Unrelated panels, menus, forms, routes and assets: covered structurally, because the audit renders
  every published page rather than a sample. A pixel-level comparison is **not** available in this
  environment — there is no browser binary — so "unchanged" means identical rendered markup plus
  byte-identical stylesheets.

## 7. Build and tests — exact results

| check | result |
|---|---|
| `bash scripts/verify-rendered-site.sh` | exit 0 — 229 pages, all audits pass (clean rebuild after the sandbox reset) |
| `python3 -m unittest … tests/website/test_*.py` (10 modules) | 141 tests **ok**, 8 skipped |
| `python3 -m unittest tests.website.test_visual_regressions` | 6 tests **ok** |
| `python3 scripts/audit-navigation-inventory.py` | exit 0, six defect classes at 0 |
| `python3 scripts/generate-raster-formats.py --check` | exit 0, mirror in sync |
| `platform: npm test` (`node --test tests/*.test.js`) | **846 tests, 846 pass, 0 fail** on the committed tree |
| `bash scripts/release-candidate-check.sh` | **exit 0 — the whole gate passes** (see below) |
| browser/visual-diff test | **not run** — no browser binary in this environment |
| licensed-WHMCS behaviour (client area, cart, provisioning) | **not run** — no licensed installation, and not touched by this patch |
| 18 `tests/<name>/run.php` suites | all run and pass, inside the gate below |

**The release gate passes in full.** It needs `php` on `PATH`; this host has none, so the run used
the repository's own WebAssembly interpreter (`scripts/php-wasm/php`, the documented fallback) with a
shim on `PATH`. It then stopped at `tsx: not found` — a dev dependency of `cloudhost247-node` whose
`node_modules` had not been installed in this sandbox; after `npm ci` it ran to the end. Neither
blocker is a defect in the repository: one is a missing interpreter on this host, the other a missing
local install. Result — *Release-candidate source verification passed*, exit 0, every stage green:

* registry v2.1.0 → 7 mega menus, 8 footer columns, 169 links validated (160 app / 167 PHP);
  content → 55 marketing pages, 120 sections, 174 FAQs, 13 documents (216 KB); PHP theme → 43 product
  pages enriched; crawl policy → 23 exclusions, 88 public paths
* canonical inventory: 84 root PHP pages, 67 registered public, 89 navigation destinations, 68 footer
  destinations, 49 distinct hero scenes / 67 exact / 0 fallback; **0** orphans, menu links without
  pages, pages without navigation discovery, unregistered public pages, dangling redirects, duplicate
  canonicals
* the 18 `tests/<name>/run.php` module suites all run and pass (foundation 60 assertions, OVH 237,
  broker, marketing, cart recovery, passkey, phoneservices 23/23, customaffiliate 36/36, payments,
  tools, rdp, integrations, modules, builder, smm, currency, cloudhost247_email, theme)
* server-agent Node suite, migration validation, retired-brand audit (0 matches, 0 unregistered)
* Python static suites including `tests/security/**` and the release-gate structural tests
* workflow YAML parse, SPA production build (48 modules)
* rendered-site audit: all 229 pages well-formed, fully referenced, fully styled, no dead links;
  hero artwork matched against the inventory; tool surface fully answered
* website suite 310 assertions, 0 failed; accessibility contract; raster ladder 50 scenes × 2;
  served mirror in sync

**Platform suite caveat, stated plainly.** With the sandbox's own `.env` present, 844 of 846 pass:
the two failures are the same assertion reported twice — `x-frame-options === 'DENY'` — and it fails
only because that `.env` sets `FRAME_ANCESTORS` for the preview, which is exactly the intended effect
of the setting. With `.env` absent (the committed state; `.env` is git-ignored) the suite is 846/846.
The assertion itself is left strict rather than made env-conditional, so production's default stays
pinned.

## 8. Git changes

* Branch `arena/4497b4b5-cloudhost247`, branched from `94d20e9`.
* `a57db72` — website fix (12 files, +269/−34)
* `1bb76dc` — opt-in `FRAME_ANCESTORS`
* `fd74ef9` — homepage headline moved into its generator
* this report and the regenerated `docs/website-rebuild/current-files.csv` committed on top
* **Pushed to `origin/arena/4497b4b5-cloudhost247`.** No pull request opened, nothing merged.
* No other branch touched; no force-push; no resets; no user work discarded.

**Disclosure — this sandbox was rebuilt mid-session.** The sandbox re-cloned the repository, which
discarded the two local commits made earlier and cleared `/tmp`, the Smarty cache, `node_modules` and
the running preview. All three commits were re-established from the intact working tree and pushed;
the reset cost time, not content. It is also why the branch is pushed rather than left local: a
sandbox rebuild cannot silently lose work that `origin` already has.

## 9. Remaining issues and decisions for you

1. **The two restored descriptions do not reach the rendered page on a fresh install.** `site.json`
   now carries them (pinned by test), and they are what `Site::context` uses for a registry page. But
   `domain-dns.php` and `dns-management.php` are served by the editorial route, and when no CMS entry
   is published `Site::editorial()` builds the page — setting `seo_description` from `summary`, which
   `Site::context` then prefers. So on a fresh install those two pages render the summary as their
   meta description, and the fixture agrees. That fallback behaviour predates PR #85 and my patch does
   not change it. Fixing it is a one-line change in `Site::editorial()` (carry the registry's
   authored description when the registry has one) and would affect every editorial page without a
   published entry. **Your call — I have not made it.**
2. **`platform/.htaccess` (added by the 2026-10-16 pass) is not valid as shipped.** `<Directory>` and
   `<Location>` are server-config/vhost context only, so Apache rejects the file with
   "not allowed here" (a 500 for the directory) once `AllowOverride` permits `.htaccess`. It also
   carries placeholder paths (`/home/YOUR_CPANEL_USER/…`) and hardcodes
   `RewriteRule … http://127.0.0.1:3000/$1 [P,L]` while Passenger manages the process itself.
   Nothing in the gate inspects this file, and `scripts/build-production-zip.py` ships it. I have not
   touched it — it is deployment configuration, not appearance.
3. **Trial-deployment JWT fallback (same pass).** A `NODE_ENV=production` host whose `APP_URL` matches
   `try.|trial.|demo.|staging.` may now boot without `JWT_SECRET`, generate an ephemeral secret, and
   invalidate every session on restart. That is what fixed the 503; it also weakens "no secret, no
   start" for any host whose URL matches. Worth a decision.
4. **Tool copy shortened by PR #85.** `config/tools.php` lost the longer, more specific text for the
   QR-scanner and Wi-Fi-QR tools — including the sentence stating the camera is optional, asks
   permission first, and that no frame leaves the browser. The camera feature is still implemented
   (`getUserMedia` in `js/tools.js`), so the public description now under-describes the tool.
5. **Acceptable Use Policy** (`shared/site/content/legal.generated.json`) lost its duplicated
   `<h2>Acceptable Use Policy</h2>` title and its section headings moved `<h3>` → `<h2>`; it is now
   the only one of seventeen policy documents whose sections use `h2`. A content decision, reported
   rather than changed.
6. **Artwork captions normalised by PR #85 (kept).** 45 artworks had their `<title>` text extended
   and their in-artwork caption normalised to the `CH247 / <PAGE>` form the majority (47 of 65)
   already used. One change is a genuine fix — `CH247 / OFFERS` moved off `cloud-hosting.svg` onto
   `offers.svg`, its correct file — so the normalisation is kept and flagged here rather than
   silently reversed.
7. **Not verified:** anything needing a licensed WHMCS installation or a real browser — client area,
   cart/checkout, provisioning, mobile breakpoints, pixel diffing. Unchanged by this patch and
   unavailable in this environment; recorded, not implied away.

## 10. Deployment status

**Nothing is deployed.** No production change, no staging deployment, no archive built, no pull
request opened. The correction exists as three commits on `origin/arena/4497b4b5-cloudhost247`, with
the evidence above reproducible by re-running the commands in §7.

---

## Acceptance checklist

- [x] Cause of the unintended visual change investigated and named (§1, with the generator rule)
- [x] Affected design restored to the verified baseline (12 slots on 11 pages, §3)
- [x] Existing CloudHost247 visual identity preserved — no artwork, palette, font or layout changed
- [x] Homepage and unrelated pages not redesigned
- [x] Header, mega menu and footer appearance preserved
- [x] Existing PHP, WHMCS and Node functionality intact; no architectural change
- [x] No working feature replaced with a mockup
- [x] Links, assets and routes verified (229 pages; 42 393 links, 3 063 asset references, 0 unresolved)
- [x] Regression checks on affected and representative unaffected pages (every published page)
- [ ] Desktop and mobile layouts checked in a browser — **rendered markup yes, viewport no**: no
      browser binary available; the patch changes no layout rule
- [x] Build and test results reported accurately, including what could not be run
- [x] Git diff contains only justified changes, each explained in §3
- [x] No production deployment without approval
- [x] Approved enhancement implemented additively (homepage headline, per your decision)
