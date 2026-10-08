# CloudHost247 / Orbit asset library

Original, reproducible vector geometry; no stock photos, invented partner marks,
customer logos, awards or location assertions. The mint / ink palette matches
`templates/cloudhost247/css/site.css`.

- `brand/`: primary stacked, horizontal, compact and icon marks; dark, white and
  monochrome SVG variants, plus transparent PNG and lossless WebP exports.
- `hero/`: six-part infrastructure ecosystem and conceptual world connectivity.
  **The world illustration is not a data-center location map.**
  Pair files named `*-3d.jpg` are original 3D raster scenes in the same ink/mint art
  direction. Each one ships with `-640`, `-960` and `-1280` AVIF and WebP siblings (see
  the raster ladder below); templates offer AVIF → WebP → JPEG → SVG, so a browser
  takes the smallest file that covers the box it is about to paint and a missing raster
  never becomes a broken image.
- `panels/`: one neutral mark per control-panel adapter that ships a working install
  path, plus a catalogue hub illustration. The catalogue is published by the platform
  (`cloudhost247-node/src/control-panels/adapters/*.ts`), **not** by this directory: a
  mark existing here is presentation only and is not a claim that a panel is
  provisionable. No vendor logo is drawn or traced. Every panel shares the rack
  silhouette and differs by the glyph in its lower bay, so eighteen rows stay
  glanceable at 28 px without reproducing anyone's trademark.
- `operating-systems/`: the catalogue hub plus one neutral mark per distribution
  seeded in migration 0041. `Unknown` is an internal placeholder for pre-existing
  servers and deliberately has no public mark. Each distribution has its own prompt
  glyph and its own display name, because `slug.replace('-',' ').title()` renders
  "Nixos" and "Opensuse" for two projects that spell themselves NixOS and openSUSE.
- `catalogue-marks.json`: generated index of the marks above and the platform paths
  they are served from. `tests/website/test_static.py` reads it.

### These two families are also served by the platform

The platform's catalogue stores one logo URL per row, so the marks are served from
`cloudhost247-node/frontend/public/{panel-logos,os-logos}` as well — the paths its
seed data and its tests reference. Those two directories previously held **genuine
vendor artwork**: the Ubuntu roundel, the cPanel wordmark, Debian's `#A80030`,
openSUSE's `#73BA25`. That contradicted the policy in the paragraph below and, on a
catalogue whose rows are mostly `DISABLED`, implied an endorsement no vendor gave.
Both directories now hold copies of the first-party marks defined here, byte-identical
to the canonical files, and `scripts/generate-catalog-assets.py --emit-served` is what
writes them. A test fails the build if a vendor brand hex or a mismatched copy returns.
- `website/`, `platforms/`, `backgrounds/`, `network/`: reserved families for future
  artwork. Product pages currently fall back to the closest existing family
  illustration rather than inventing unsupported panels or locations.
- `hosting/`, `cloud/`, `servers/`, `domains/`: labeled, product-specific diagrams.
- `applications/`, `deployment/`, `operating-systems/`: platform/catalog diagrams,
  not a claim that any particular runtime or image is provisionable.
- `management/`, `security/`, `blog/`: reusable service illustrations.
- `icons/`: product and neutral utility icons. Decorative icons use empty alt text;
  content illustrations have descriptive alt text in the consuming component.
- `favicon/`: ICO (16/32/48), PNG 16/32/48/180/192/512, Apple touch icon and manifest.
- `social/`: 1200 × 630 social preview in SVG, PNG and WebP. OG uses PNG for crawler
  compatibility.

Application/OS cards use the neutral `ApplicationLogo` text badge in `site.js`
and `includes/application-logo.tpl`. No third-party logos are fabricated, bundled
without a license, or used to imply affiliation. The public platform API, not this
asset directory, determines what may be shown in the catalog.

`tests/website/test_static.py` enforces this over every tree the project serves —
this directory, `assets/cloudhost247-tools/` and the platform's two logo
directories — by rejecting the vendors' own brand colours.

**One exemption, and it is not ours to change:** `templates/orderforms/ovh_cart/`
is a vendor order-form skin that ships its own distribution icons. It is listed in
`docs/independent-rebuild/original-file-manifest.sha256`, which the release gate
verifies with a strict `sha256sum --check` and no exemptions, so "tidying" those
files would modify a third-party surface *and* fail the build. It is a checkout
skin, not part of the public website. The exemption is written into the test's
`VENDOR_EXEMPT` tuple rather than assumed, so the scope of the policy is visible
where the policy is checked.

### The raster ladder

The `*-3d.jpg` scenes are the only rasters the site serves, and they are wide — 1280 or
1376 px against a CSS box that caps at 660 px. Left alone, a phone downloads a 325 KB
`public-cloud-3d.jpg` to paint a 390 px column. `python3 scripts/generate-raster-formats.py`
writes `-640`, `-960` and `-1280` encodings in AVIF and WebP next to every scene
(ImageMagick, which is already present — no Python wheels, `convert -list format` shows
both codecs). The same scene then costs a 1× phone 56 KB and a 2× phone 172 KB, or 12 KB
for the homepage scene.

`templates/cloudhost247/includes/visual.tpl` and the SPA's
`frontend/src/components/marketing/Illustration.tsx` are the only two places that build a
`<picture>`; both name the three widths literally and pass `sizes`. **Change the ladder in
all three places or the srcset advertises a file that does not exist** — a `<source>` whose
URL 404s does not fall through to the next one, so that is a broken image, not a slow one.
The script enforces the other half of the contract: it refuses to write a scene narrower
than the largest step, and `--check` exits non-zero if any step is missing.

| flag | effect |
| --- | --- |
| *(none)* | write only the variants that are missing |
| `--force` | re-encode every variant (use after replacing a scene) |
| `--check` | write nothing; fail if a step is missing. Runs in `scripts/release-candidate-check.sh` |
| `--emit-served` | also refresh the platform's copy, below |

### The platform's copy of the raster library

The platform does not read this directory. It serves the illustrations at
`/media/cloudhost247/...` from `cloudhost247-node/public/media/cloudhost247`, and
`public/*` is a git-ignored build output, so that tree is a **copy** of this one and
nothing in the repository regenerated it. A build that was one generation behind still had
a media directory and still passed a file count; it was simply missing the artwork, which
is exactly how a product page ships with a broken image.

`--emit-served` refreshes it from here, byte for byte, and prunes whatever this directory no
longer defines — the two trees are an exact mirror apart from this README and
`catalogue-marks.json`, which are not served. `scripts/build-production-zip.py --verify`
independently resolves every visual the theme registry names against the archived copy.

## Regeneration

`python3 scripts/generate-catalog-assets.py` writes **only** the `panels/` and
`operating-systems/` mark families. It is additive and idempotent: it never rewrites a
file it did not create, so it cannot flatten hand-tuned artwork. Use it when a control
panel or distribution is added to the platform catalogue.

Two flags opt into rewriting, and neither touches any other family:

| flag | effect |
| --- | --- |
| `--refresh-marks` | rewrite the panel and distribution marks this script owns. This is how the original four-glyph banks — which made five distributions render the same icon — became one distinct glyph per catalogue entry. |
| `--emit-served` | also write the copies the platform serves under `cloudhost247-node/frontend/public/{panel-logos,os-logos}`, from the same definition, and refresh `catalogue-marks.json`. |

A glyph bank smaller than the catalogue it covers, a duplicated glyph, or a colour
outside the mint/ink palette makes the script exit non-zero rather than emit a
half-consistent family.

`python3 scripts/generate-website-assets.py` generates the rest of the vectors
deterministically. Note that several product illustrations were hand-tuned after the
last full run, so re-running it will replace those with the generic composition —
review the diff before committing.
Rasterising the vectors — the PNG logo exports, the favicons and the social card — needs
Pillow and a resvg adapter. Set `CH247_RASTER_SCRIPT` to a Node script accepting
`input.svg output.png width` and rendering with `@resvg/resvg-js`; the adapter below
documents the complete contract. (This is not how the `*-3d.jpg` scenes are made. Those are
authored artwork; `generate-raster-formats.py` re-encodes them for delivery and never draws
them.)

```js
const fs = require('fs');
const { Resvg } = require('@resvg/resvg-js');
const [input, output, width] = process.argv.slice(2);
fs.writeFileSync(output, new Resvg(fs.readFileSync(input, 'utf8'), {
  fitTo: { mode: 'width', value: Number(width) },
  font: { loadSystemFonts: true }
}).render().asPng());
```

Use DejaVu Sans (or metrically compatible Arial) for raster export. SVG remains
resolution-independent. Runtime never loads the generator, raster tools or fonts
from a third-party CDN.

For WHMCS invoices/emails, configure the supplied PNG logo in the deployment's
existing brand/email/invoice settings. This repository intentionally does not
write production settings or replace invoice/payment templates.
