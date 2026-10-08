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
  provisionable. No vendor logo is drawn or traced.
- `operating-systems/`: the catalogue hub plus one neutral mark per distribution
  seeded in migration 0041. `Unknown` is an internal placeholder for pre-existing
  servers and deliberately has no public mark.
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
