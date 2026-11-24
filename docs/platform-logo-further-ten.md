# Ten further original artwork entries

Ten previously missing entries. No trace migrations, invented marks, or hidden
catalogue entries. All files were visually inspected; raster pixel content and
SVG source files are unchanged. Coverage is not a legal-clearance claim.

| Slug | Provenance pin | Stored format | Terms / review |
| --- | --- | --- | --- |
| `matrix-conduit` | selfhst/icons@8d96200b728b377b2d3bb361e8fdc4daa1541f60 | PNG | CC-BY-4.0 collection attribution |
| `twingate-connector` | selfhst/icons@8d96200b728b377b2d3bb361e8fdc4daa1541f60 | PNG | CC-BY-4.0 collection attribution |
| `ubooquity` | homarr-labs/dashboard-icons@9d019529dfd4431770e7380bfafd6628800b7986 | PNG | Apache-2.0 collection terms |
| `komari` | komari-monitor/komari-web@d54ce1288df41ead08aa19f8700186e68028a889 | PNG | Open artwork-rights review |
| `zenfeed` | glidea/zenfeed-web@cdfa01412379b8fc5db124dbc6b00746b448a74e | PNG | Open artwork-rights review |
| `gowa` | aldinokemal/go-whatsapp-web-multidevice@3dd0f71d30af3bb4c56619b2f33c13dc410554bf | SVG | Open artwork-rights review |
| `yucca` | yuccastream/yuccastream-com@07872732e4e08cd14bbdbd8fadda82dd6b0a6003 | JPG | Open artwork-rights review |
| `yao` | YaoApp/website@bd1f7be20a7ecafda5b26a21e80cb2459796311b | SVG | MIT (official website artwork) |
| `emailengine` | postalsys/emailengine@92cfab95de7e985d4fee67d1074c34c0df339314 | PNG | Open artwork-rights review |
| `metatrader-5` | Official website; captured SHA-256 (no upstream Git revision supplied) | PNG | Open artwork-rights review |

## Source distinctions

- Matrix Conduit: https://conduit.rs/ explicitly identifies the Matrix server
  and selects its yellow lightning-bolt logo. Not Conduit Open WebUI.
- Twingate Connector: uses the shared Twingate product mark, not an invented
  connector-specific mark. Collection attribution is retained.
- Ubooquity: pinned dashboard-icons original raster, preserving the books/cloud
  emblem without tracing.
- Komari: main README explicitly embeds the exact frontend revision and
  public/favicon.png selected here. Its character artwork has no separate
  grant established in this pass; do not confuse source proof with rights.
- Zenfeed: official web client static/icon.png, selected in src/app.html.
  No root artwork licence was found. Preserve the original Z artwork as-is.
- GoWA: official README directly selects gallery/gowa.svg. The source contains
  two embedded PNGs plus a mask; keep the entire upstream SVG unchanged.
  No invented trace or new raster-in-SVG wrapper. No root artwork grant found.
- Yucca: original JPEG from the official NVR site, not a similarly named ML
  project. Its MIT licence names the Bootstrap template author, so no implied
  artwork grant is inferred from that template notice.
- Yao: official website's own logo and MIT licence, not the separately licensed
  engine source. Native SVG paths are retained.
- EmailEngine: original official PWA icon. Retain the downloaded proprietary
  terms, including their stated effective date, without treating them as an
  external-logo reuse grant or accepting them on behalf of the user.
- MetaTrader 5: original product wordmark from the official product website,
  not a screenshot. Source URL and captured SHA-256 are retained; no Git blob,
  upstream checksum or repository revision was available or invented.

## Not admitted

At the time of this batch, Susie was held because its use as a default avatar
did not establish project-logo identity. **Later corrected:** the author explicitly
calls Susie the snac logo; the original PNG is now admitted. See
[expanded-search evidence](platform-logo-expanded-search.md). LittleLink's logo is not automatically the server fork's logo. Svix's
site terms expressly require prior permission for marks; that item remains
pending rather than borrowing an arbitrary third-party image.

## Rendering and provenance

Local JPEG and original SVG are now supported alongside PNG/WebP/ICO.
Original SVG audit disallows scripts, events, foreignObject, external URLs,
stylesheets, entity declarations and active tags. Only the reviewed GoWA SVG
opts into embedded data:image/png references. No external browser image loads.
Each of the ten images links to its source/rights notice. The six uncertain
artwork grants are explicit in the manifest and notices, not silently cleared.

## Validation

21 unit tests passed (one coverage TODO), logo audit passed, and frontend
TypeScript passed. All ten served image responses matched their pinned SHA-256
byte for byte; all ten public notices loaded and contained their image hash.
Nine source Git blob hashes were verified before installation. MetaTrader 5
is explicitly recorded as a website capture without a Git blob.
