# CloudHost247 / Orbit asset library

Original, reproducible vector geometry; no stock photos, invented partner marks,
customer logos, awards or location assertions. The mint / ink palette matches
`templates/cloudhost247/css/site.css`.

- `brand/`: primary stacked, horizontal, compact and icon marks; dark, white and
  monochrome SVG variants, plus transparent PNG and lossless WebP exports.
- `hero/`: six-part infrastructure ecosystem and conceptual world connectivity.
  **The world illustration is not a data-center location map.**
  Pair files named `*-3d.jpg` are original 3D raster scenes in the same ink/mint art
  direction. Templates prefer the JPEG via `<picture>` and keep the SVG as the
  fallback, so a missing raster never becomes a broken image.
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
Raster generation needs Pillow and a resvg adapter. Set `CH247_RASTER_SCRIPT` to a
Node script accepting `input.svg output.png width` and rendering with
`@resvg/resvg-js`; the adapter below documents the complete contract:

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
