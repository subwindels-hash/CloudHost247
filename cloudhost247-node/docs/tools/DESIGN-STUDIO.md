# CloudHost247 Design Studio — Barcode, QR, Label & Shipping tools

Design Studio is the shared engine behind five Tools Center pages:

| Tool | Route | Slug |
| --- | --- | --- |
| Barcode Generator | `/tools/barcode-generator` | `barcode-generator` |
| Label Designer & Printing | `/tools/label-designer` | `label-designer` |
| VDA-4902 Label Generator | `/tools/vda-4902-label-generator` | `vda-4902-label-generator` |
| Shipping Label Generator | `/tools/shipping-label-generator` | `shipping-label-generator` |
| QR Business Card Designer | `/tools/qr-business-card-designer` | `qr-business-card-designer` |

It is **not** a second Tools Center. It reuses the existing architecture:

* the catalogue in `src/tools/catalog.ts` (identity, route, auth, limits) and the single
  execution funnel `runTool` in `src/tools/core/executor.ts`;
* the Tools Center SPA shell, its design tokens (`tools-center.css`, `styles.css`) and the
  `Business Tools` component vocabulary (`bt247-*` classes);
* the existing QR encoder (`qrcode`) and decoder (`jsqr`), the Employee ID Card's QR/SVG/PDF
  discipline, and `bwip-js` (BWIPP) for standards-compliant linear and 2D symbologies.

## 1. Why a shared engine

All five pages ask the same four questions:

1. *What does the symbol say?* — a real, standards-compliant encoder (never hand-drawn bars).
2. *Where does it sit on the page?* — one layout model in millimetres.
3. *How does it leave the browser?* — SVG, PNG and PDF from the same draw list.
4. *What happens in bulk?* — CSV → rows → labels, with per-row validation and an error report.

So the engine is built once and parameterised:

```
src/tools/design-studio/
  shared/units.ts          mm/cm/in/px conversion, paper sizes, print scaling
  shared/barcode-catalog.ts the format registry (bcid, validation, capability, notes)
  shared/barcode-engine.ts  bwip-js → normalised draw ops (SVG path data, module grids)
  shared/qr-engine.ts       qrcode → module grid (QR, Micro QR via bwip-js, Data Matrix)
  shared/svg-renderer.ts    draw ops → standalone SVG
  shared/pdf-renderer.ts    draw ops → print-ready PDF (pdf-lib, exact mm)
  shared/csv.ts             CSV parse/serialise, formula-injection hardening, row validation
  shared/validate.ts        colour/text/dimension validation with actionable messages
  labels/model.ts           label document model (elements, styles, units)
  labels/templates.ts       system templates (label sizes + layouts)
  labels/layout.ts          document → pages → sheets → draw ops
  labels/renderer.ts        labels document → SVG/PDF/PNG
  labels/csv-import.ts      CSV → label batches with field mapping
  labels/repository.ts      saved-template persistence contract (ownership enforced)
  shipping/schema.ts        sender/recipient/shipment schema + validation
  shipping/templates.ts     shipping layouts (no invented carriers)
  shipping/generator.ts     shipping label document
  vda/spec.ts               verified VDA-4902 field/dimension specification + limitations
  vda/templates.ts          A5 master label and KLT (210 × 74 mm) layouts
  vda/validation.ts         standard-specific required-field rules
  vda/generator.ts          VDA label document
  business-cards/schema.ts  contact schema, vCard 3.0 / MeCard payload builders
  business-cards/templates.ts eight card designs, front/back
  business-cards/generator.ts card document
  api/handlers.ts           Tools Center handlers for the five slugs
  api/routes.ts             /api/tools/design-studio/* (templates, CSV, batch, export)
```

## 2. Honesty rules baked into the engine

* **No fake symbologies.** Only formats with a real encoder are offered; the catalogue marks each
  one's capability and the UI says "not supported in this build" instead of drawing bars.
* **Decodable output.** Tests rasterise the generated SVG and decode it with an independent
  decoder (`@zxing/library` for linear/2D, `jsqr` for QR) — a symbol that does not scan fails the
  build.
* **Physical dimensions.** Layout is computed in millimetres and converted to PDF points
  (`1 pt = 1/72 in`). Page, margin, pitch and element geometry come from one model.
* **No carrier claims.** Shipping labels offer *generic* layouts only. No carrier logo, name or
  tracking format is presented as supported unless verified; the page says so.
* **VDA-4902 is documented, not certified.** `vda/spec.ts` records the version, the two label
  sizes, the field list and the PDF417/Code 39 payload structure, plus an explicit statement that
  resemblance is not certification.
* **Privacy.** Generation runs in the browser. Nothing in this module writes to the database;
  templates saved by a signed-in user are stored in the existing Tools Center template store with
  the owner's user id, and no contact or shipment data is logged.

## 3. Units and geometry

`shared/units.ts` owns every conversion:

* `MM_PER_UNIT` for `mm`, `cm`, `in`, `px` (px = 96 dpi CSS reference);
* `toMillimetres(value, unit)` / `fromMillimetres(mm, unit)`;
* `PAPER_SIZES` (A4, A5, A6, Letter, Legal, and common label sheets);
* `sheetGrid()` — rows × columns, margins, gutters, label size → per-label rectangles;
* `mmToPt()` for PDF.

Elements are positioned in millimetres from the top-left of the label. `layout.ts` maps a
document to sheets, then to absolute page coordinates, then to draw ops.

## 4. Draw ops (the single rendering contract)

Every exporter consumes one list of operations:

```ts
type DrawOp =
  | { kind: 'rect'; x; y; w; h; radius?; fill?; stroke?; strokeWidth? }
  | { kind: 'text'; x; y; text; size; color; family; weight?; align?; maxWidth?; letterSpacing? }
  | { kind: 'lines'; x; y; lines; size; lineHeight; color; family }
  | { kind: 'image'; x; y; w; h; href; fit }
  | { kind: 'barcode'; x; y; w; h; bcid; payload; text?; showText }
  | { kind: 'symbol'; x; y; size; modules; payload };  // QR / Data Matrix / Aztec matrix
```

`shared/barcode-engine.ts` produces `barcode`/`symbol` ops with cached encoding results, so the
preview, the SVG and the PDF cannot disagree.

## 5. API

All five slugs are runnable Tools Center tools: `POST /api/tools/<slug>` through the single
execution funnel, nothing else. Each answers with one envelope:

```
{
  document,        // the pages, their size in mm and the element list
  svg, preview,    // the full document, and the first page for the in-page preview
  issues: [{ level: 'error'|'warn'|'info', field?, message, hint? }],
  blocked,         // true when any issue is an error — the UI disables export
  summary: [ ... ], sizeMm, sizePx, meta,
  pdf?,            // base64 PDF, opt-in with "pdf": true (the default for these five)
  pngScale?, pngPx?
}
```

Per-tool actions travel in the body, not in new routes:

| Slug | `action` | Also accepts |
| --- | --- | --- |
| `barcode-generator` | — | `formatId, payload, moduleMm, barHeightMm, showText, foreground, background, errorCorrection, paddingMm` |
| `label-designer` | `preview` (default), `templates`, `csv` | `templateId, values, document, rows, csv, mapping` |
| `vda-4902-label-generator` | `preview` (default), `spec` | `data` (or the fields at the top level) |
| `shipping-label-generator` | `preview` (default), `templates` | `templateId, code, shipment` |
| `qr-business-card-designer` | `preview` (default), `templates`, `payload` | `templateId, side, payloadFormat, contact` |

**Not yet exposed.** `src/tools/design-studio/templates/repository.ts` and migration
`0099_create_design_studio_templates.sql` implement owner-scoped saved templates, but no route uses
them and the SPA has no save/load control, so there is deliberately no endpoint here for it: a
documented endpoint that 404s is worse than an absent one. The same applies to a standalone
`/export` route — the envelope above already carries the PDF, which is the only export the pages
need. Wiring the repository to routes is the next step if saved templates are wanted.

## 6. Verification status vocabulary

Every claim in the final report is labelled:

* **Implemented** — code exists and is wired into the catalogue/routes.
* **Tested** — covered by an automated test in this repository.
* **Externally verified** — checked against an independent implementation (a decoder, a spec
  document) rather than against our own output.
* **Certified** — audited by a third party for a named standard. *Nothing in this module is
  certified.*
