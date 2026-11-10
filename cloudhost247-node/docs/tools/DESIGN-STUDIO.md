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
  shared/units.ts            mm/cm/in/px conversions
  shared/validate.ts         colour/text/dimension validation with actionable messages
  shared/draw-ops.ts         the page model every renderer consumes (rect, line, text, barcode)
  shared/text-metrics.ts     text width/cap-height measurement for the bundled fonts
  shared/svg-renderer.ts     draw ops → SVG preview
  shared/pdf-renderer.ts     draw ops → print-ready PDF (pdf-lib, exact mm)
  shared/barcode-engine.ts   bwip-js encoding, module sizing, human-readable captions
  shared/barcode-catalog.ts  the 17 supported symbologies and their constraints
  shared/csv.ts              CSV parse/serialise, formula-injection hardening, row validation
  barcode/generator.ts       barcode document + fit checks
  labels/model.ts            label document model (elements, styles, units)
  labels/templates.ts        system templates (label sizes + layouts)
  labels/layout.ts           document → pages → sheets → draw ops
  shipping-labels/model.ts   generic shipping layouts (no invented carriers)
  vda/spec.ts                VDA-4902 field/dimension specification + limitations
  vda/schema.ts              VDA input schema and validation
  vda/generator.ts           VDA label document
  business-cards/model.ts    contact schema, vCard/MeCard payloads, eight card designs
  templates/repository.ts    saved-template persistence (ownership enforced)
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
* **Privacy.** Rendering happens on the server and nothing is written per generation — a preview is
  not stored. The one thing that persists is a template a signed-in user explicitly saves; it is
  owner-scoped, and its audit row records the name and kind only, never the document.

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

### Saved templates

A signed-in user's layouts persist in the existing template store —
`src/tools/design-studio/templates/repository.ts`, migration
`0099_create_design_studio_templates.sql` — behind these routes
(`src/routes/design-studio-templates.ts`, mounted on both `/api` and `/api/v1`):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/tools/design-studio/templates?kind=label` | List the caller's templates (**no** documents), newest first |
| `POST` | `/api/tools/design-studio/templates` | Save one: `{ kind, name, summary?, document, sourceTemplate? }` |
| `GET` | `/api/tools/design-studio/templates/:id` | Read one, document included |
| `PUT` | `/api/tools/design-studio/templates/:id` | Update name, summary or document |
| `POST` | `/api/tools/design-studio/templates/:id/duplicate` | Copy under a new name |
| `DELETE` | `/api/tools/design-studio/templates/:id` | Delete |

`kind` is one of `label`, `shipping`, `vda`, `card`. Rules the routes enforce rather than document:

* **Authentication is required** — an anonymous call is a 401, never a row under a placeholder owner.
* **Ownership is a 404, not a 403.** Another account's template is indistinguishable from one that
  does not exist, so the endpoint cannot be used to enumerate ids.
* **Names are unique per owner and kind**, and a clash returns advice ("You already have a label
  template called … Rename this one or update the existing template."), not a raw constraint error.
  The same name in a *different* kind is allowed.
* **`document` is an opaque layout object** (≤ 2 MB serialised). The list endpoint omits it; only the
  single-template read returns it.
* **Audit rows record `{kind, name, sourceTemplate}`** on save and delete — never the document. A
  saved label can carry a customer's address in its values, and an audit log is not the place for it.

In the SPA, `SavedTemplatesPanel` (one component, used by the label, shipping and card pages) lists,
loads, saves and deletes. What a template *contains* is each studio's decision: the Label Designer
stores `{ templateId, values }`, the shipping page `{ templateId, code, shipment }`, the card page
`{ templateId, side, payloadFormat, contact }`. Loading a template restores those fields, and the
label page sends the whole stored object back with the next preview so a changed size or extra
element survives the round trip. The panel says plainly what will be stored; a visitor who is not
signed in sees why saving needs an account instead of a button that can only fail.

Not exposed: a standalone `/export` route — the envelope above already carries the PDF, which is the
only export the pages need.

## 6. Verification status vocabulary

Every claim in the final report is labelled:

* **Implemented** — code exists and is wired into the catalogue/routes.
* **Tested** — covered by an automated test in this repository.
* **Externally verified** — checked against an independent implementation (a decoder, a spec
  document) rather than against our own output.
* **Certified** — audited by a third party for a named standard. *Nothing in this module is
  certified.*
