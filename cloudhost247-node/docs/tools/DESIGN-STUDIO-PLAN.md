# CloudHost247 Design Studio — Plan

**Version:** v5 (reconstructed) · **Updated:** 2026-11-11
**Repository:** `subwindels-hash/CloudHost247`
**Implementation branch:** `arena/f259bb51-cloudhost247` (base `main` @ `71dd7197`)
**Status:** Session 2 in progress — one extraction committed (`9ee8e6d4`).

> **Reconstruction notice.** v4 existed only outside the repository and was destroyed by a sandbox
> re-clone before it could be committed. This v5 is rebuilt from the authoring session's context.
> The content — decisions, findings, extraction map, session gates — is faithful; the bytes are not,
> so v4's hash (`aef35947…`) no longer verifies. See §11.

---

## 0. Provenance and the branch override

The intended workflow was a dedicated `feat/design-studio-tools-engine` branch and a fresh Arena
session bound to it. That gate could not be satisfied: this session cannot create branches or start
sessions, and the feature branch was never created.

On 2026-11-11 the project owner **explicitly authorised implementation on
`arena/f259bb51-cloudhost247`**, accepting the stated consequence. That consequence is recorded in
§0.1 rather than glossed.

### 0.1 Consequences of implementing on the fencing branch

1. **PR #122 is no longer a fencing-only change.** The fencing commits remain `4ffba2e` (Phase 36),
   `ca1b502` (Phase 37), `d2fb5758` (Phase 38) and `b61e2548` (corrections). Design Studio work sits
   in commits **after** `b61e2548`. The fencing claim "zero `src/` changes" is true **only** for
   commits up to and including `b61e2548`.
2. **Fencing evidence is unaffected.** The three integration suites and their helpers are untouched
   by this work.
3. **The fencing branch review is now harder**: a reviewer must read the fencing commits separately
   from the Design Studio commits, which is exactly the coupling the original plan tried to avoid.

---

## 1. Locked decisions

| # | Decision | Chosen |
| --- | --- | --- |
| 1 | Symbologies | **`bwip-js`** 4.11.4 — MIT, zero runtime deps, all 17 formats verified encoding |
| 2 | Existing engine | **Extract** a shared render core from `business/id-card/` — never rebuild |
| 3 | VDA-4902 + carrier-branded labels | **Deferred** until authoritative specs and licensing are supplied |
| 4 | Scope | Tools **A, B, D, E**; tool C (VDA) not implemented or registered |
| 5 | Template persistence | **Dedicated table**, ownership enforced at the repository/API boundary |
| 6 | Imposition | **Refuse-on-overflow**; never scale, rotate or clip |
| 7 | Grid resolution | **Mode-dependent**: interactive = grid mandatory; batch = auto-fit **and report** the grid |
| 8 | 2D decode verification | **`zxing-wasm`, test-only** — never in the production runtime |
| 9 | CSV formula injection | **Separately scoped** fix with its own test and commit |

---

## 2. The two findings that shape the work

**(a) A shared draw-op engine already exists.** `business/id-card/types.ts` defined
`DrawRect | DrawCircle | DrawPolygon | DrawLine | DrawText | DrawImage | DrawQr | DrawBarcode` →
`DrawOp[]` → `CardFace.ops`, consumed by **both** `svg.ts::opToSvg` and
`raster.ts::renderFaceToRgba` (via `expand.ts::expandOps`). Barcodes and QR are expanded into
primitives *before* rendering, so they are vector bars, not embedded images. The studio is a
generalisation of a working engine, not a greenfield build.

**(b) The PDF writer is image-only.** `id-card/pdf.ts` embeds one JPEG XObject per page
(`DCTDecode`). It correctly solves catalog, page tree, byte-exact xref and MediaBox geometry, but it
cannot draw text or vector bars. A **vector PDF content-stream backend is new work** and is the
largest genuinely new piece in the project.

---

## 3. Extraction map (Session 2)

Move one file at a time; no logic edits in a move commit; `tests/unit/employee-id-card.test.ts`
(72 tests) must pass after each.

| From `business/id-card/` | To `design-studio/render/` | Symbols | Status |
| --- | --- | --- | --- |
| `types.ts` (draw block) | `draw-ops.ts` | 8 draw interfaces, `DrawOp`, new `Surface` | **done — `9ee8e6d4`** |
| `expand.ts` | `expand.ts` | `expandOps` | next |
| `svg.ts` | `svg.ts` | `opToSvg`, `faceToSvg`, `cardToPrintSvg` | pending |
| `raster.ts` | `raster.ts` | `renderFaceToRgba`, `cropRaster`, primitives | pending |
| `text.ts` + `shared/block-font.ts` | `text-metrics.ts` | glyph metrics and layout | pending |
| `pdf.ts` | `pdf.ts` | `buildCardsPdf`, `buildCardsPdfPair`, xref/catalog internals | pending |
| — | `pdf-vector.ts` | **NEW** content-stream backend (`re f` rects, `Tf`/`TJ` text, clipping) | pending |

Then under `design-studio/`: `shared/document.ts`, `shared/validate.ts`, `shared/units.ts`,
`shared/csv.ts`, `shared/print-layout.ts`, `barcode/formats.ts`, `barcode/encoder.ts`, and per-tool
schemas and templates.

---

## 4. bwip-js — verified, not assumed

Probed against 4.11.4 in a throwaway directory; nothing was added to the repository for the probe.

| Property | Value |
| --- | --- |
| Licence | MIT |
| Runtime dependencies | none |
| Peer dependencies | none |
| Unpacked size | 12.33 MB (includes font data) |

**17/17 formats encode to vector SVG:** `code128`, `code39`, `code93`, `ean8`, `ean13`, `upca`,
`upce`, `itf14`, `interleaved2of5`, `rationalizedCodabar`, `gs1-128`, `databaromni`, `qrcode`,
`datamatrix`, `pdf417`, `azteccode`, `microqrcode`.

**One quirk, encoded into the registry rather than the call site:** `databaromni` rejects plain
digits (`databaromniBadLength`); it requires GS1 AI form `(01)…` with `parse: true`.

**Server-side only.** 12.33 MB of font data must never reach the browser bundle; the handler encodes
and the client receives SVG/PNG, matching the contract `qr-generator` already documents.

---

## 5. Print and imposition rules (ratified)

**Two failure classes that must never be conflated:**

- **Class A — layout infeasible, refuse.**
  - `LABEL_EXCEEDS_PAGE` — cell larger than the printable area; the error states the mm shortfall.
  - `GRID_EXCEEDS_PAGE` — a requested columns × rows grid does not fit; refused, **never silently
    reduced**.
  - `INVALID_GEOMETRY` — dimensions/margins/gutters that leave no printable area.
- **Class B — layout feasible, job needs more sheets, paginate.** With capacity ≥ 1,
  `sheets = ceil(N / capacity)`, row-major placement, final sheet may be partially filled.
  Pagination is the **only** accommodation: never scaling, rotation, cropping or overlap.

**Grid resolution is mode-dependent.** `interactive` requires an explicit grid (`GRID_REQUIRED`
otherwise); `batch` may omit it, in which case the maximum grid is computed **and returned**. The
mode is an explicit input and must never be inferred from label count or request shape.

---

## 6. Integration points (all pre-existing)

`src/tools/catalog.ts` (73 entries) · `src/tools/routes.ts` · `src/tools/handlers/index.ts`
(`handlerFor`/`targetFor`/`missingHandlers`) · `src/tools/core/executor.ts` ·
`frontend/src/pages/tools/` + `frontend/src/lib/tools-api.ts` · `npm run tools:catalog:check` ·
`npm run catalog:docs` · `tools-sitemap.php` (PHP shell, additive only).

New slugs: `barcode-generator`, `label-designer`, `shipping-label-generator`,
`qr-business-card-designer`. `qr-generator` is **extended, never duplicated**. Shipping and
business-card slugs join `NON_PERSISTABLE_TOOL_SLUGS` because they carry addresses, phone numbers and
contact records.

---

## 7. Sessions

| Session | Deliverable | Gate |
| --- | --- | --- |
| 2 | `render/` extraction, vector PDF backend, bwip-js registry | ID-card suite green after every move; all 17 formats encode; PDF emits vector operators |
| 3 | Barcode Generator (page, API, PNG/SVG/PDF, validation) | every supported format decodes back to its payload |
| 4 | Label Designer (document model, elements, templates, CSV, batch, imposition) | 15 imposition cases pass; no clipping or overlap |
| 5 | Shipping Labels, unbranded | sender/recipient validation; multi-package correct |
| 6 | QR Business Cards (vCard/MeCard, front+back) | QR decodes byte-identical to the payload |
| 7 | Integration (catalogue, nav, SEO, sitemap, PHP projection, responsive) | `tools:catalog:check` passes; no duplicate QR generator |
| — | VDA-4902 | **deferred** |
| 8 | Final verification | typecheck ×2, unit suite, `git diff --check`, export decode |

---

## 8. Risks

1. **Vector PDF is new** — test by parsing emitted operators and decoding rasterised output.
2. **Extraction touches a shipped tool** — mitigated by move-only commits and 72 tests per step.
3. **The regression suite does not typecheck** — type-only moves compile-break while the runtime
   suite still passes (observed: `TS2307` and cascading errors while 72/72 tests were green). Always
   run `typecheck` *and* the suite.
4. **Workspace instability** — the sandbox re-cloned three times, destroying uncommitted work and
   `/home/user` documents. Commit and push small increments; keep documents in the repository.
5. **Deferred VDA** means 1 of 5 requested tools ships in this phase, deliberately.

---

## 9. Session log

| Date | Commit | What |
| --- | --- | --- |
| 2026-11-11 | `4ffba2e`…`b61e2548` | Fencing work from PR #122 (0 `src/`) |
| 2026-11-11 | `9ee8e6d4` | Draw-op contract extracted to `render/draw-ops.ts`; typecheck exit 0; 72/72 tests |

---

## 10. Non-claims

- Tools A, B, D, E are **not implemented**. Only the shared draw-op contract has been extracted.
- 15 of 17 symbologies have no in-tree encoder until `bwip-js` is added.
- No VDA, GS1 or carrier certification is held, sought or implied.
- Nothing here is production-certified.

---

## 11. Change log

| Version | Change | Integrity |
| --- | --- | --- |
| v1 | Initial inspection and plan | `5ea9068c…`, 10,776 B |
| v2 | Added verified gap analysis | `55fccabe…`, 14,142 B |
| v3 | Added acceptance baseline | `783eb0d8…`, 18,625 B |
| v4 | Added ratified requirements, provenance, change log | `aef35947…`, 21,358 B — **lost to a workspace re-clone before it could be committed** |
| v5 | Reconstructed into the repository; §0 rewritten to record the branch override; imposition and grid rules folded in from the ratified decisions; session log added | hash reported in the commit message for `docs(design-studio): add plan v5` |
