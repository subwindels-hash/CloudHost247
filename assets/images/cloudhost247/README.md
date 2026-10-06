# CloudHost247 / Orbit asset library

Original, reproducible vector geometry; no stock photos, invented partner marks,
customer logos, awards or location assertions. The mint / ink palette matches
`templates/cloudhost247/css/site.css`.

- `brand/`: primary stacked, horizontal, compact and icon marks; dark, white and
  monochrome SVG variants, plus transparent PNG and lossless WebP exports.
- `hero/`: six-part infrastructure ecosystem and conceptual world connectivity.
  **The world illustration is not a data-center location map.**
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

`python3 scripts/generate-website-assets.py` generates vectors deterministically.
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
