# Visual-preservation restoration — 2026-10-16

Scope: correct the unintended changes to the website's appearance and prevent their recurrence.
Preservation-first: no redesign, no theme replacement, no header/footer rebuild, no new design
system. Baseline for "original appearance" is `668a3523` (merge of PR #83) — the last known-good
tree before the two changes investigated below. Starting revision of this branch: `94d20e9`
(merge of PR #86), working tree clean.

## 1. Root cause

Two recent commits changed the website's appearance without a defect being reported for either
change. Both ride in PRs whose stated purpose was a 503 fix and an audit respectively.

**a. Homepage hero redesign — `4ef8faba` ("Fix 503 error, redesign homepage…", PR #84).**
The commit message itself names the change: *"Redesigned hero section with 'Build. Host. Deploy.
Scale.' positioning / Added three strategic CTAs / Updated description."* On
`platform/public/index.html` this replaced the hero headline *"Power Your Digital World With
CloudHost247"*, its lede, and the two CTAs (*Get Started*, *Explore Hosting*) with a new
three-CTA block (*Explore Hosting*, *Explore Cloud & Servers*, *Find a Domain*). The PR's actual
work — the 503 fix — lives in `platform/server.js`, `platform/src/core/config.js` and
`platform/.htaccess` and is untouched by this restoration.

**b. Page artwork flattened into one template — `18246b68` ("synchronize website registry, visual
assets…", PR #85).** The two asset trees (`assets/images/cloudhost247/` and
`cloudhost247-node/frontend/public/media/cloudhost247/`) were already byte-identical before this
commit (verified on `data-centers.svg` at `668a3523`), so nothing was out of sync. What the commit
actually did was overwrite 19 page illustrations in **both** trees with output from the one-shot
bootstrap generator `scripts/generate-website-assets.py` (2026-10-05), which draws every scene
from a single generic three-node template. The unique, page-specific diagrams (the data-center
rack stack, the Docker container yard, the offers catalogue/billing/price-tag trio, the backup
vault, the DNS zone editor, …) were replaced by near-identical *COMPUTE / STORAGE / NETWORK*
cube scenes differing only in a caption. The result contradicted the asset library's own contract
(`assets/images/cloudhost247/README.md`: every registered page resolves its own illustration) and
de-coupled each page's SVG fallback from the unique `*-3d.jpg` hero scene it is supposed to pair
with. The same commit also clobbered `backups.php`'s use-case list with a verbatim copy of
`nodejs-hosting.php`'s ("New projects / Migrations / Teams standardizing on one provider"), and
deleted the `seo_description` of `dns-management.php` and `domain-dns.php` — the page inventory
itself recorded those two rows as `no seo_description`.

**Already self-corrected — no action needed:** PR #86's tool-surface guard briefly withheld 24
working menu links and 4 footer links on every PHP page (per its own commit messages `4e96ae73`
→ `e03fd5ea`); the guard was removed within the same PR and the current `site.js`/footer are back
to the baseline behaviour. Verified at HEAD before any change was made.

## 2. Affected files

| File(s) | Role in the regression |
| --- | --- |
| `platform/public/index.html` | hero headline, lede and CTAs redesigned (`4ef8faba`) |
| `assets/images/cloudhost247/{blog/documentation, cloud/data-centers, cloud/network, cloud/offers, deployment/api, deployment/docker, deployment/laravel, deployment/nodejs, deployment/paas, deployment/php, deployment/python, domains/dns-management, domains/domain-dns, hosting/business-hosting, management/backups, management/help-center, management/ip-management, management/managed-services, security/platform-security}.svg` | 19 unique illustrations replaced by the generic template (`18246b68`) |
| `cloudhost247-node/frontend/public/media/cloudhost247/…` (same 19 paths) | the Node platform's mirror of the library, flattened identically |
| `modules/addons/cloudhost247_theme/resources/site.json` | `backups.php` use-cases clobbered; `seo_description` removed from 2 pages |
| `docs/website-rebuild/{page-inventory.json,page-inventory.csv,current-files.csv}` | generated records of the above (regenerated) |

## 3. Correction

All corrections are targeted reverts to the `668a3523` baseline content; no page, template,
component or stylesheet was redesigned.

1. **Hero restored** — `platform/public/index.html` returned to its baseline hero (headline,
   lede, *Get Started* + *Explore Hosting* CTAs), byte-identical to `668a3523`. The 503 fix files
   are untouched.
2. **Artwork restored** — the 19 scene SVGs restored byte-identical to `668a3523` in the
   canonical library **and** in the platform mirror (38 files). Verified in sync afterwards by
   the repository's own parity check (`scripts/generate-raster-formats.py --check` → "served
   mirror in sync").
3. **Content restored** — `backups.php` use-cases and the two `seo_description` fields restored
   in `site.json` (via an exact reverse application of PR #85's `site.json` hunks).
4. **Derived artefacts regenerated** — `node scripts/site/generate.mjs`,
   `python3 scripts/audit-navigation-inventory.py`, `python3 scripts/inventory-website.py`, so
   the page inventory and file inventory describe the restored tree (the two SEO rows now read
   `ok` instead of `no seo_description`).
5. **Recurrence guard** — `scripts/generate-website-assets.py` now carries a caution block naming
   the mechanism above: re-running that one-shot bootstrap flattens the page-specific scenes.
   Behaviour of the script is unchanged; nothing in the gate runs it.

## 4. Design preservation (deliberately unchanged)

- PHP theme (`templates/cloudhost247/**`) — homepage, header, announcement bar, mega menu,
  footer, `site.css`, `design-system.css`: untouched.
- Homepage hero of the served theme (`homepage.tpl`: *"Build. Host. Deploy. Scale."* + domain
  search) — untouched; matches the recorded baseline screenshot
  `docs/website-rebuild/screenshots/homepage-desktop.webp`.
- Brand marks, favicon, social card, 3D raster heroes (`*-3d.jpg` + AVIF/WebP ladder) — untouched.
- Navigation registry, 7 mega menus, 8 footer columns (169 links) — untouched.
- Reviewed-and-**kept** changes from the same PRs, each justified:
  - `cloud-hosting.svg` label fix from PR #85 (its caption read *"CH247 / OFFERS"* on the
    cloud-hosting artwork — a copy-paste defect; geometry untouched).
  - PR #85's re-sync of QR/Wi-Fi QR tool copy in `config/tools.php`: that file is **generated**
    ("Do not edit by hand", `generatedFrom: scripts/generate-global-platform.py`); the baseline
    wording was a hand-edit drift away from its generator and the re-sync restores the generated
    state. If camera-aware wording is wanted, it must be changed in the generator's tool table.
  - PR #85's `legal.generated.json` regeneration (both copies): the committed JSON was stale
    against its Smarty source; regeneration matches `templates/cloudhost247/includes/legal/*.tpl`.
  - PR #85's 22 new `icons/*.svg` files and the feature-card icon references to
    `icons/firewall.svg` / `icons/network.svg`: these follow the generator's documented icon
    precedence ("`icons/cloud.svg` wins over `cloud/cloud.svg`: the icon family is the one drawn
    for cards"), complete the documented `icons/` family, and give the 14–21 px icon slots real
    icons instead of shrunken 660×560 scenes.
  - PR #84's 503 fix (`.htaccess`, `server.js`, `config.js`, docs) and PR #86's audits/tests.
  - `toolsServed` in `site.json`/`Site.php` stays: server-side measurement for the release gate,
    deliberately not published to the browser (its own comment and `test_tools_surface.py` pin
    that decision).

## 5. Functional verification

- `bash scripts/release-candidate-check.sh` → **exit 0** end-to-end ("Release-candidate source
  verification passed"), run with `scripts/php-wasm/php` on PATH (this sandbox has no native PHP;
  the shim is the repository's documented interpreter for such hosts and reports real exit codes).
- Rendered site: `bash scripts/verify-rendered-site.sh --fetch` → 229 published pages rendered
  through the shipped Smarty components; fixture QA **0 problems** (907 images, 3,063 asset
  references, 42,393 links, 45,510 controls, 194 canonicals all resolving); hero audit: 48
  distinct hero artworks, every page paints its own, matching the inventory; tool surface:
  257 derivable / 265 published, both directions empty.
- PHP: 838 files lint clean; 18 module behavioural suites pass; `tests/website/run.php`
  310 assertions / 0 failed; tools shell 1,171 assertions pass.
- Node: server-agent 71 tests pass; tools catalog check (75 entries) and `build:tools` pass;
  `tests/tools/local.test.mjs` passes.
- Python: the release-gate static/security suites pass; website suites **135 tests OK** (8
  skipped by design — they need rendered fixtures, which the rendered-site step covers);
  `scripts/verify-website.py` passes; link integrity 0 broken/placeholder/dangling;
  accessibility contract holds (63 markup files); raster ladder complete (50 scenes × 2 formats).

## 6. Regression results

- The rendered audit covers **all 229 published pages**, including the ones not touched here:
  every page renders, is fully styled, and has no dead internal link — no unrelated page changed.
- Homepage (PHP theme) hero and sections match the recorded baseline screenshot byte-for-byte in
  structure (no template change in the diff).
- `git diff` is 43 files: 38 restored SVGs, `platform/public/index.html`, `site.json`, three
  regenerated inventory files, plus this report and the generator caution (see §8). No CSS,
  template, PHP module, WHMCS core, payment, provisioning or vendor file appears in the diff.
- The vendor integrity baseline (`docs/independent-rebuild/original-file-manifest.sha256`,
  strict `sha256sum --check`) passes unchanged.

## 7. Build and tests

| Check | Result |
| --- | --- |
| `bash scripts/release-candidate-check.sh` (full gate) | **exit 0**, incl. rendered-site audit |
| PHP lint (php-wasm 8.2.33, 838 targets) | 0 syntax errors |
| PHP module suites (18) | pass |
| `php tests/website/run.php` | 310 assertions, 0 failed |
| `php tests/tools/site-integration.php` | 1,171 assertions passed |
| `node --test server-agent/tests/*.test.js` | 71 tests pass |
| Python static/security suites (gate list) | pass |
| `tests/website/` Python suites | 135 OK, 8 skipped (fixture-dependent, covered by rendered audit) |
| `node scripts/site/check-links.mjs` | 0 broken / placeholder / dangling |
| `python3 scripts/check-accessibility-contract.py` | holds |
| `python3 scripts/generate-raster-formats.py --check` | 50×2 ladder complete, mirror in sync |
| `bash scripts/verify-rendered-site.sh --fetch` | 229 pages, 0 problems, heroes correct |

Not run / cannot run here: licensed WHMCS staging flows (login, cart, checkout, provisioning —
blocked on a staging install, as for every previous pass); browser-based QA (no browser binary;
the repository records this as `browser-qa (blocked…)` per route in the page inventory).

## 8. Git changes

Branch `arena/10cbd765-cloudhost247` (from `94d20e9`). One commit: the restoration described
above (43 files + this report + the generator caution). No force-push, no history rewrite, no
other branch touched.

## 9. Remaining issues

- The `config/tools.php` QR/Wi-Fi QR copy still under-describes the shipped camera capture,
  because the generator's tool table is the source of truth for that file. Updating the *copy*
  is an approved content change in `scripts/generate-global-platform.py`, not a visual fix.
- Browser QA and licensed-WHMCS staging checks remain blocked in this environment (unchanged
  blockers, recorded per route in `page-inventory.json`).
- `docs/website-rebuild/screenshots/` still shows the 2026-10-05 section ordering of the PHP
  homepage (pre-"Start here" section); it is a historical record, and the hero it shows is the
  one preserved. Refreshing screenshots needs a browser-capable host.

## 10. Deployment status

Work is local to the working branch and delivered as a pull request against `main`. **No staging
or production deployment was performed.** Production deployment requires separate approval after
staging verification.
