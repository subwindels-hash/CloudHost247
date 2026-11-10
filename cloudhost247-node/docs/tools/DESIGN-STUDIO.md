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
| `PUT` | `/api/tools/design-studio/templates/:id` | **Overwrite** the document in place: `{ document, expectedRevision, summary? }` — or the deprecated `{ document, force: true }` |
| `PATCH` | `/api/tools/design-studio/templates/:id` | **Rename** / change the description: `{ name?, summary? }` — cannot carry a document |
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
* **Audit rows record `{kind, name, sourceTemplate}`** on save, and `{kind, name, revision,
  previousRevision}` / `{kind, name, previousName}` on overwrite and rename — never the document. A
  saved label can carry a customer's address in its values, and an audit log is not the place for it.

### Overwrite, rename, and why they are different verbs

A template's lifecycle is *create → load → save over → branch*, and two of those steps are
destructive in different ways, so they are different calls:

* **`PUT` replaces the document and keeps the id.** The response carries a `revision` that increments
  on every overwrite. A client that sends back the `expectedRevision` it loaded is refused with a
  **409** when the stored template has moved on — the second of two open tabs loses rather than
  silently discarding the first. The check is `... WHERE revision = $expected` inside the `UPDATE`, so
  two concurrent saves cannot both pass it; there is no read-then-write window. Zero rows matched is
  disambiguated by re-reading: gone/not yours is 404, still yours but newer is 409.
* **A failed overwrite changes nothing.** A rejected document, an unknown revision, an oversized
  payload or a stale revision all leave the stored row byte-identical; the tests read the template
  back after each kind of failure to prove it.
* **`PUT` never changes the name.** A `name` in the body is ignored, because a rename is not a
  version — it leaves `revision` alone and cannot overwrite a document by accident.
* **`PATCH` renames and cannot touch the document.** A `document` in a `PATCH` body is a 400, so a
  rename request that carries a stale layout (a retry, a buggy client) cannot become a silent
  overwrite wearing a different verb.
* **`expectedRevision` is required.** A request without it is a 400 that says where the number comes
  from. An optional check would protect only the callers who opted in, and the last unconditional
  writer would win — the same silent data loss, just rarer. There is no unconditional code path in the
  repository at all.
* **The compatibility path is explicit, audited and dated.** A client that genuinely cannot send a
  revision sends `force: true` (or `X-Design-Studio-Allow-Unconditional: true`). That request:
  writes with a different audit action (`DESIGN_STUDIO_TEMPLATE_FORCED`), stamps `last_forced_at` on
  the row so the users of the escape hatch are a query rather than archaeology, returns a `warning`
  stating that any edit since the last read has been replaced, and remains owner-scoped. Sending both
  `force` and `expectedRevision` is a 400: a caller that knows the version can do the safe thing.
  **Sunset `DESIGN_STUDIO_FORCED_OVERWRITE_SUNSET`: 2026-05-09**, after which the function, the route
  branch and `last_forced_at` are removed. No second extension — each one re-opens the window.
* **The SPA has no access to the compatibility path.** Its client type requires `expectedRevision`, and
  it refuses to load a template that arrives without a version number rather than inventing one.
Migration `0100_add_design_studio_template_revision.sql` adds the counter with `DEFAULT 1`, so every
template saved by an earlier release is version 1 and keeps working without a re-save. Nothing about
the stored document changes.

In the SPA, `SavedTemplatesPanel` (one component, used by all four studio pages) lists, loads, saves
and deletes. What a template *contains* is each studio's decision: the Label Designer
stores `{ templateId, values }`, the shipping page `{ templateId, code, shipment }`, the card page
`{ templateId, side, payloadFormat, contact }`. Loading a template restores those fields, and the
label page sends the whole stored object back with the next preview so a changed size or extra
element survives the round trip. The panel says plainly what will be stored; a visitor who is not
signed in sees why saving needs an account instead of a button that can only fail.

The panel offers **Save as new** (a `POST`, leaving the loaded template alone) and, once a template
is loaded, **Save over \"name\"**, which names the template and the version it will become before it
does anything. A 409 clears the loaded template and refreshes the list, so the operator reloads the
copy that won rather than retrying a losing write. Rename is a row action with its own input: it
sends only `{ name }`, and on a collision it leaves the box open with the rejected text so the
operator corrects it instead of retyping.

Each page also supplies a `validateLoad` guard, because the document is stored across releases: a
template saved against a layout this build no longer offers is refused with a message and the editor
is left exactly as it was. Applying it anyway would place stored elements on a different layout — a
label that looks finished and is wrong, which is the failure mode the whole issue list exists to
prevent.

Not exposed: a standalone `/export` route — the envelope above already carries the PDF, which is the
only export the pages need.

### Outstanding limitations of saved templates

Recorded here rather than discovered later:

* **The concurrency tests run against PGlite**, which serialises requests within a single connection.
  They therefore prove the *predicate* — that a write whose `WHERE revision = $n` does not match
  returns 409 and changes nothing, verified by deleting that predicate and watching the test fail with
  `[200, 200]` — rather than a true two-connection race. The protection is single-statement and needs
  no read-modify-write window, so it holds when serialised, but "tested under real concurrency" is a
  Postgres test we do not yet have, and it should not be claimed until there is one.
* **No revision history is kept.** A version-safe overwrite prevents losing an edit; it does not let
  anyone recover one. `revision` is a counter, not a log — after an overwrite the previous document is
  gone.
* **No staging or production verification.** Everything above is local: unit and integration tests,
  `tsc`, and a migration applied to a throwaway PGlite instance. Nothing has been deployed, and a
  passing local suite is not a deployment.
* **The forced-overwrite path still exists** until 2026-05-09. While it does, a client that uses it can
  lose another writer's edit; the column, the audit action and the warning make it visible and
  countable but do not prevent it.

## 6. Verification status vocabulary

Every claim in the final report is labelled:

* **Implemented** — code exists and is wired into the catalogue/routes.
* **Tested** — covered by an automated test in this repository.
* **Externally verified** — checked against an independent implementation (a decoder, a spec
  document) rather than against our own output.
* **Certified** — audited by a third party for a named standard. *Nothing in this module is
  certified.*
