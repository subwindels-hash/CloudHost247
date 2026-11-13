# CloudHost247 Design Studio — Plan

**Version:** v5 (reconstructed) · **Updated:** 2026-11-11
**Repository:** `subwindels-hash/CloudHost247`
**Implementation branch:** `arena/f259bb51-cloudhost247` (base `main` @ `71dd7197`)
**Status:** Session 2 in progress — one extraction committed (`9ee8e6d4`).
**Implementation status (2026-11-13):** the tools are built on branch
`arena/7339691f-cloudhost247`. **§12 records the first round (five tools), §13 the second (29 more
barcode types, the QR Code Maker and the Barcode Scanner) and §14 the third (the scanner's second
decoder, which needed one word added to the site's security policy), each with how it was tested and
what is still unverified.** Sections 1–11 are kept as the record of the plan; where a later section
contradicts an earlier one, the later section is current.

> **Reconstruction notice.** v4 existed only outside the repository and was destroyed by a sandbox
> re-clone before it could be committed. This v5 is rebuilt from the authoring session's context.
> The content — decisions, findings, extraction map, session gates — is faithful; the bytes are not,
> so v4's hash (`aef35947…`) no longer verifies. See §11.

---

## 0. Provenance and branch status

The intended workflow was a dedicated `feat/design-studio-tools-engine` branch and a fresh Arena
session bound to it. That gate could not be satisfied: this session cannot create branches or start
sessions, and the feature branch was never created.

> Implementation was performed on `arena/f259bb51-cloudhost247`. The owner subsequently instructed
> that implementation stop on this branch. The two preserved commits have been identified as
> candidates for transfer to `feat/design-studio-tools-engine`. The destination branch has not yet
> been created, and no transfer or cherry-pick has been performed. The earlier authorization
> interpretation is recorded as the session's interpretation, not as an independently verified
> authorization to use this branch.

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

> **2026-11-12:** decisions 3 and 4 were reversed at the owner's request (the VDA 4902 tool is built,
> without any certification claim), decision 2 was only partly followed, and decisions 5, 7 and 9 did
> not come into play. See §12.2.

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

- ~~Tools A, B, D, E are **not implemented**. Only the shared draw-op contract has been extracted.~~
  Superseded 2026-11-12: see §12.
- ~~15 of 17 symbologies have no in-tree encoder until `bwip-js` is added.~~ Superseded: `bwip-js`
  4.11.4 is a dependency and 83 barcode types are offered (54 in the first round, §12; 83 since §13).
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
| v6 | **Provenance corrected.** §0's claim that the owner authorised implementation on this branch is replaced with neutral, verifiable wording: implementation *was performed* there, the owner subsequently instructed it stop, the two commits are *candidates for transfer*, and no branch creation, transfer or cherry-pick has occurred. No decision, finding, requirement or code changed | hash reported in the commit message for `docs(design-studio): correct provenance statements` |
| v7 | **Implementation recorded.** §12 added: the five tools as built on `arena/7339691f-cloudhost247`, the differences from this plan, the evidence, and what remains unverified. Header, §1 and §10 point to it. No earlier section was rewritten | not hashed; this file is under version control |
| v9 | **Third round recorded.** §14 added: WebAssembly allowed in the Content-Security-Policy, the scanner page's full decoder (twenty-one types) with the JavaScript decoder kept as the API's decoder and the page's fallback, the corrections that make both decoders report a barcode in the same words (including text beyond ASCII), measurements, and what is still unverified. §13 is kept as the record of the second round. | not hashed; see the commit |
| v8 | **Second round recorded.** §13 added: the inventory of TEC-IT's products against this repository, the 29 barcode types and the numbered series added to the Barcode Generator, the QR Code Maker and the Barcode Scanner, the evidence, and what was not built and why. §12 is marked as the record of the first round | not hashed; this file is under version control |

---

## 12. What was built (2026-11-12)

> **This section is the record of the first round.** Its counts (54 barcode types, five tools, the
> test totals in §12.5) were true on 2026-11-12. §13 records what the second round added and gives
> the current figures.

Branch `arena/7339691f-cloudhost247`, from `main` @ `d1c03bec`.

### 12.1 The tools

| Tool | Page | API | Output |
| --- | --- | --- | --- |
| Barcode Generator | `/tools/barcode-generator` | `POST /api/tools/barcode-generator` | SVG, PNG (resolution written into the file), PDF. 54 barcode types. A batch of up to 50 lines gives a ZIP and a PDF; up to 500 copies on a label sheet |
| Online Label Printing | `/tools/label-designer` | `POST /api/tools/label-designer` | PDF and a one-label SVG. Six templates (asset tag, product label, QR label, part and serial, shelf label, address label), up to 300 labels, optional numbering |
| VDA 4902 Label Generator | `/tools/vda-4902-label-generator` | `POST /api/tools/vda-4902-label-generator` | PDF and SVG. A5 landscape or KLT, up to 100 labels, Code 39 on the barcoded fields |
| Shipping Label Generator | `/tools/shipping-label-generator` | `POST /api/tools/shipping-label-generator` | PDF and SVG. 4 × 6 in, 100 × 150 mm or A6, up to 50 packages, optional SSCC-18 per package |
| QR Code Business Cards | `/tools/qr-business-card-designer` | `POST /api/tools/qr-business-card-designer` | PDF (single card or A4 sheet of 10 with cut marks), SVG, `.vcf` |

All five are public, `POST` only, never cached (`cacheSeconds: 0`) and listed in
`NON_PERSISTABLE_TOOL_SLUGS`: nothing a visitor enters is stored, and a result cannot be saved as a
report or attached to a ticket. Each has short aliases (`/tools/barcode`, `/tools/label-printing`,
`/tools/online-label-printing`, `/tools/vda-4902`, `/tools/shipping-labels`,
`/tools/qr-code-business-cards`). They appear on the All Tools page, in the Tools menu and in site
search through the catalogue, like every other tool.

### 12.2 Where the build differs from this plan

| Plan | What was done | Why |
| --- | --- | --- |
| §1 decision 2, §3: move the ID card renderers into `design-studio/render/` one file at a time | **Not done.** `business/id-card/` is untouched apart from being imported for `buildZip`. The studio has its own renderers (`render/svg.ts`, `render/pdf-vector.ts`, `render/text-metrics.ts`) working from studio types added to `render/draw-ops.ts` | The ID card PDF writer embeds one JPEG per page (§2b); the studio needs millimetre geometry and vector output, which is new code either way. Moving a shipped tool's files was not needed to get there, so they were left alone |
| §1 decisions 3 and 4: VDA 4902 deferred, not registered | **Built**, at the owner's request | The tool follows the VDA 4902 field numbering, data identifiers and Code 39, in CloudHost247's own cell arrangement. It says on every result that it is not certified by the VDA and must be checked against the receiving plant's packaging guideline |
| §1 decision 3: carrier-branded labels deferred | Still not built | The shipping label is carrier-neutral and says so on every result |
| §1 decision 5: saved templates in a dedicated table | **Not built** | The tools are stateless. There is no template storage, no migration and no account feature |
| §1 decision 7: `interactive` and `batch` grid modes, `GRID_REQUIRED` | **Not applicable** | There is no free columns × rows input. A label goes on a named stock whose grid is fixed in `definitions.ts`, or one label per page. The forms offer only stock a template fits |
| §1 decision 9, §7 session 4: CSV import, free-form element designer | **Not built** | Labels are made from the six templates. Batches are lines of text (barcodes) or a numbered run (labels, VDA, packages). With no CSV there is no formula-injection surface to fix |
| §4: 17 barcode types | **54** | `barcode/symbologies.ts` is the registry. 41 are read back by a decoder in the tests; 13 cannot be (zxing does not support them) and the result says so to the visitor |
| §6: `qr-generator` extended, never duplicated | `qr-generator` is unchanged | The Barcode Generator offers QR Code as one of its types; the two tools link to each other as related tools |

### 12.3 Where things are

| Concern | Where |
| --- | --- |
| Catalogue entries, aliases, related tools | `src/tools/catalog.ts` (end of `newTools`) |
| Handlers | `src/tools/handlers/design-studio.ts`, registered in `handlers/index.ts` |
| Barcode types and encoder | `src/tools/design-studio/barcode/` (`symbologies.ts`, `encoder.ts`, `carried.ts`). `encoder.ts` is the only module that imports `bwip-js` |
| Drawing surface, SVG, vector PDF, text metrics, PNG resolution | `src/tools/design-studio/render/` |
| Label canvas, sheets, imposition, input parsing, GS1, vCard and MeCard | `src/tools/design-studio/shared/` |
| The five tools | `src/tools/design-studio/tools/` |
| Stocks, templates, formats; the forms | `src/tools/design-studio/definitions.ts`, `forms.ts` |
| Page for the five tools | `frontend/src/pages/tools/DesignStudioPage.tsx` (one component, prop `slug`) |
| Result panel (previews, downloads, notices, facts) | `frontend/src/components/tools/StudioResult.tsx`, also used by the general `ToolPage.tsx` and so by the embedded build |

The browser bundle imports `forms.ts`, `definitions.ts` and `render/png-meta.ts` and nothing else from
the server tree; a test follows those imports and fails if they ever reach the encoder, the PDF
writer or a Node module. `zxing-wasm` is a dev dependency used only by tests.

### 12.4 Print rules as implemented

- **Artwork is never scaled, rotated or clipped to fit** (§5). Imposition places a label at true size
  or refuses with `LABEL_EXCEEDS_CELL`, `LABEL_EXCEEDS_PAGE`, `GRID_EXCEEDS_PAGE`, `INVALID_GEOMETRY`
  or `TOO_MANY_PAGES` (40 sheets per request).
- **A barcode is narrowed to fit its place, never below a floor**: 0.264 mm for retail codes, 0.19 mm
  for other linear codes, 0.25 mm on VDA labels, 0.3 mm for the code on a card. Below the floor the
  request is refused with the sizes in the message. Above the floor but under 0.25 mm (linear) or
  0.33 mm (2D) the result carries a notice to print at 300 dpi or finer and test-scan.
- **Every PDF** is version 1.6 and vector only (no images), with `/PrintScaling /None`. Text uses
  the fonts every PDF reader provides (Helvetica and Courier, regular and bold), so nothing is
  embedded. Text outside Windows-1252 prints in its nearest form or as `?`, with a notice; there is
  no font for non-Latin scripts.
- **Results state what they contain**: the data each barcode carries (including an added check
  digit), the module width, the stock, and the count.

### 12.5 Evidence

Run from `cloudhost247-node/`.

| Check | Command | Result on 2026-11-12 |
| --- | --- | --- |
| Engines and tools | `npx vitest run tests/unit/design-studio-tools.test.ts tests/unit/design-studio-barcodes.test.ts` | 259 passed (90 + 169) |
| Pages in jsdom | `npx vitest run frontend/tests/unit/design-studio-page.test.tsx` | 29 passed |
| Pages in Chromium, production bundle | `npx playwright test e2e/design-studio.spec.ts` | 30 passed |
| Types | `npm run typecheck`, `npx tsc -p frontend/tsconfig.json --noEmit` | clean |
| Build | `npm run build` | passes |
| Catalogue projection | `npm run tools:catalog:check` | verified |

The Playwright spec runs against the production bundle served by `vite preview`, so run
`npm run build:frontend` first; where Playwright cannot download its own Chromium, set
`CH247_CHROMIUM_PATH` (see `playwright.config.ts`).

What the tests establish, as opposed to assume:

- **The PDFs are read, not trusted.** `tests/helpers/studio-pdf.ts` parses the PDF bytes and replays
  each page's drawing operators; `studio-raster.ts` turns them into pixels at 300 and 203 dpi; and
  `barcode-reader.ts` decodes those pixels. A barcode test passes when a decoder reads the expected
  data out of the file a visitor would download.
- **In Chromium** the PDF, PNG and SVG a visitor saves are compared byte for byte with what the
  handler produced; the PNG the browser draws for labels and cards is checked for its size in
  pixels, the 300 dpi it declares, and that its barcodes decode.
- **The print rules were mutation-checked.** More than two dozen of them were broken on purpose, one
  at a time (barcode placement and floors, check digits, numbering, sheet tolerance, `/PrintScaling`,
  the vCard line ends, the result panel's file and preview checks), and the suite had to fail each
  time. One survived at first (the VDA floor, checked only through a rounded figure); its test was
  made exact and it now fails. This is a spot check of the rules that matter in print, not a
  mutation score for the whole code.

### 12.6 Not verified

- **No paper.** Nothing here was printed or scanned with a hardware scanner. "Reads back" means a
  software decoder read a rendering of the file.
- **13 barcode types are not read back at all**: Code 11, MSI Plessey, Standard 2 of 5,
  Industrial 2 of 5, Pharmacode (one-track and two-track), Han Xin Code, DotCode, Codablock F,
  USPS Intelligent Mail, USPS POSTNET, Royal Mail 4-State and KIX. The decoder used by the tests
  does not support them, so they are encoder output only, and the result tells the visitor so.
- **No certification** of any kind: not VDA, not GS1, not any carrier.
- **The PHP (WHMCS) shell** was not run. Its catalogue projection (`tools.json`, `site.json`) was
  regenerated and passes the projection check, but its pages for these tools were never loaded.
- **Label stock measurements** are the nominal sizes of common A4 and Letter sheets. A pack from a
  given manufacturer may differ by a fraction of a millimetre; print one sheet on plain paper first.

---

## 13. Second round (2026-11-13): the rest of TEC-IT's browser tools

> **This section is the record of the second round.** What it says of the Barcode Scanner (one
> decoder, thirteen types, no WebAssembly; §13.4, the scanner rows of §13.5 and the last item of
> §13.6) was true when it was written. §14 records what the third round changed and gives the
> current figures.

The owner asked for everything TEC-IT offers at <https://www.tec-it.com/en> to be brought here.
Their site was read at the start of this round (the product list at `/en/software`, and the three
online tools at `barcode.tec-it.com`, `label.tec-it.com` and `qrcode.tec-it.com`). This section
records what that came to: what is here, what was added, and what was not and why. Nothing of
TEC-IT's was copied: no code, no label layouts, no text and no artwork. Each tool here is this
repository's own implementation of a published barcode or data format.

### 13.1 Their products, and where each stands here

| TEC-IT product | What it is | Here |
| --- | --- | --- |
| Online Barcode Generator | Browser tool | **Barcode Generator**, 83 types (§13.2) |
| Online QR Code Generator | Browser tool with typed forms (URL, Wi-Fi, vCard, event, SEPA, ...) | **QR Code Maker**, new (§13.3) |
| Online Label Printing | Browser tool with a library of label templates in about 20 groups, most of them one car maker's or one standard's supplier label | **Online Label Printing** (six templates: asset tag, product, QR, part and serial, shelf, address), **VDA 4902 Label Generator** (A5 and KLT, five languages) and **Shipping Label Generator** (which can carry an SSCC-18 in GS1-128). See §13.6 for the groups that are not here |
| QR Code Business Cards | Part of the generators above | **QR Code Business Cards** (first round) |
| Scan-IT Cloud | Scanning in the browser | **Barcode Scanner**, new (§13.4) |
| TWedge Cloud | Tables of captured data | The scanner's list, with CSV export. No stored tables |
| TBarCode API | A barcode image from a URL | Not built (§13.6). `POST /api/tools/barcode-generator` returns the files as JSON |
| TFORMer API | Labels from layouts and data, over HTTP | `POST /api/tools/<slug>` for each label tool. No uploaded layouts |
| Barcode Studio, TFORMer Designer, TFORMer Workstation, Scan-IT Desktop, TWedge | Desktop programs for Windows, macOS or Linux | Not applicable: these are installed software, not something a website hosts |
| Scan-IT to Office, Scanner Keyboard | Phone apps | Not applicable. The scanner page works in a phone's browser |
| TBarCode Office, TBarCode/SAPwin | Add-ins for Microsoft Office and SAP | Not applicable |
| TBarCode SDK, TBarCode/X, TFORMer SDK, TFORMer Server | Developer libraries and print servers | Not applicable |

### 13.2 Barcode Generator: 54 to 83 types, and a numbered series

Twenty-nine types were added, all drawn by the same encoder: Flattermarken; ISMN; ISBN with a
five-digit add-on and ISSN with a two-digit add-on; the EAN-13, EAN-8, UPC-A and UPC-E composites;
GS1 DataBar Expanded Stacked; GS1 Digital Link Data Matrix; the GS1-128 and six GS1 DataBar
composites; USPS PLANET, Australia Post, Japan Post, the generic DAFT 4-state code and Royal Mail
Mailmark 2D; PZN8; and HIBC in Code 39, QR Code, Aztec, PDF417, MicroPDF417 and Codablock F.

How far each has been checked is stated, not implied (`verification` and `readBack` in
`barcode/symbologies.ts`):

| | Types | Meaning |
| --- | --- | --- |
| Read back | 51 | An independent decoder reads the sample from the vector artwork and from the PNG |
| Read in part | 13 | A composite symbol's linear part, or the main symbol beside an add-on, is read; the 2D part or the add-on is not. The result says "Partly read back" |
| Encoder output only | 19 | No decoder available to the tests reads the type. The result says so |

From TEC-IT's list, five are not offered because the encoder does not have them or they are a
carrier's own data format on top of a type that is offered: Korean Postal Authority code, Royal
Mail Mailmark 4-state, DPD, USPS IM Package and UPU S10. NTIN and PPN are Data Matrix contents and
can be entered as GS1 DataMatrix or Data Matrix data, but have no form of their own. HIBC is offered
in eight symbols, each adding the leading `+` and the check character to the data as it is entered;
there are no separate forms for the supplier (LIC) and provider (PAS) data structures. Swiss QR,
ZATCA and EPC payment codes: EPC is in the QR Code Maker; the other two are not built.

**Numbered series** (TEC-IT: "Create Sequence"): `series: true` with `seriesPrefix`, `seriesStart`,
`seriesCount` (up to 50), `seriesStep`, `seriesDigits` and `seriesSuffix` makes one barcode per
number, as a batch does per line. A retail type completes each number with its own check digit, and
the result states the first and last value as the symbols carry them.

### 13.3 QR Code Maker (`/tools/qr-code-maker`, `POST /api/tools/qr-code-maker`)

Twelve kinds of code, chosen by what a phone should do: open a website, show text, join a Wi-Fi
network, save a contact (vCard or MeCard), write an email, call a number, send an SMS, open a
WhatsApp chat, add a calendar event, show a map location, open a social media profile, or set up a
SEPA transfer (EPC QR code). Output is PNG, SVG and PDF, as a QR Code, Data Matrix or Aztec Code; a
contact also gives a `.vcf`.

- The payload formats are written by `shared/qr-content.ts`, one builder per kind, each escaping
  its own reserved characters (Wi-Fi: `\ ; , " :`; iCalendar: `\ ; ,` and line breaks; `mailto:`
  percent-encoding). A name or password made only of hexadecimal digits is quoted, as the Wi-Fi
  format asks, and the result says so.
- A SEPA payment code is a QR Code at error correction level M and at most 331 bytes, by its
  standard; the IBAN and an RF creditor reference are checked by their check digits.
- The result shows what the code carries. A Wi-Fi password is the one thing it hides, and it is in
  no file name, fact, notice or history label.
- The code holds the content itself. Nothing is redirected through this site and nothing is
  tracked, so a code keeps working for as long as its content does.

The existing `qr-generator` (free text in, QR out) and `wifi-qr` are unchanged.

### 13.4 Barcode Scanner (`/tools/barcode-scanner`, `POST /api/tools/barcode-scanner`)

Reads barcodes with a camera or from a picture and keeps a list that can be copied or downloaded as
CSV.

- **One decoder in two places** (`src/tools/scanner/decode.ts`): the page runs it in the browser, on
  camera frames and chosen pictures, so nothing is uploaded; the API runs it on an uploaded PNG, for
  the general tool page, the embedded build and integrators.
- **The decoder is ZXing in plain JavaScript** (`@zxing/library` 0.21.3, MIT licence; it brings
  `ts-custom-error`, MIT, and the optional `@zxing/text-encoding`, Unlicense or Apache-2.0). The
  better decoder used by the test suite (zxing-cpp as WebAssembly) was not used in the page, because
  the site's
  Content-Security-Policy (`src/plugins/security.ts`) has no `'wasm-unsafe-eval'` and adding it is a
  change of security policy that was not asked for. The price is the list of types: **thirteen**
  (QR Code, Data Matrix, Aztec, PDF417, Code 128, Code 39, Code 93, Interleaved 2 of 5, Codabar,
  EAN-13, EAN-8, UPC-A, GS1 DataBar). UPC-E, Micro QR, MicroPDF417, MaxiCode, DataBar Limited and
  Expanded, and postal codes are not read, and the page says so. Version 0.21.3 is pinned because
  later versions declare Node 24 as their minimum and this application supports Node 20.9.
- **Work is bounded by size and by time.** A still image is searched quickly at up to 2,000 pixels
  a side and exhaustively at up to 1,000, within a four-second budget. Before those limits, an
  exhaustive search of a twelve-megapixel picture with no barcode in it took 106 seconds to give up.
  With them, measured on the development machine on 2026-11-13: the largest image of pure noise the
  API accepts (4,096 × 4,096 pixels, 2.1 MB as a PNG) is given up on in about 3.5 seconds, and a
  twelve-megapixel frame of noise through the page's passes in about 1 second. The API also refuses
  an image from its header, before decoding it, when a side exceeds 4,096 pixels.
- **The list**: a barcode is listed once and counted again only after it has left the picture for
  1.5 seconds. The CSV writes a value that begins with `=`, `+`, `-`, `@`, a tab or a carriage
  return with a leading apostrophe, because a scanned barcode is untrusted text and a spreadsheet
  would run it as a formula.
- **Nothing in a code is acted on**: a web address is shown as text, never as a link.
- **The camera is never left on.** It is switched off when Stop is pressed, when the page is left,
  when the tab goes into the background, and on every failure to start. That includes the decoder
  file failing to load after the browser has already granted the camera: the first version of the
  page lost track of the camera in that case and left it running behind an error message. A tab that
  is already in the background when the camera arrives does not get one.
- **When the decoder file cannot be loaded** the page says so and asks for a refresh. Chromium does
  not ask the network again for a script that failed to load, so a second press cannot succeed
  before the page is refreshed; nothing is lost by refreshing, because the decoder is fetched on the
  first scan and the list is still empty then.
- **The embedded build** (`assets/cloudhost247-tools/tools.js`, used by the WHMCS theme) holds the
  forms and the list of barcode types, and neither the encoder nor the decoder: there the scanner is
  the upload form that calls the API. Across both rounds that file grew from 355 kB to 456 kB (91 kB
  to 114 kB compressed).

### 13.5 Evidence (2026-11-13)

Run from `cloudhost247-node/`. These replace the figures in §12.5.

| Check | Command | Result |
| --- | --- | --- |
| Barcode types | `npx vitest run tests/unit/design-studio-barcodes.test.ts` | 231 passed |
| Label, card and barcode tools | `npx vitest run tests/unit/design-studio-tools.test.ts` | 96 passed |
| QR Code Maker | `npx vitest run tests/unit/design-studio-qr.test.ts` | 94 passed |
| Barcode Scanner decoder and API | `npx vitest run tests/unit/barcode-scanner.test.ts` | 50 passed |
| Pages in jsdom | `npx vitest run frontend/tests/unit/design-studio-page.test.tsx frontend/tests/unit/barcode-scanner-page.test.tsx` | 44 passed (32 + 12) |
| Pages in Chromium, production bundle | `npx playwright test e2e/design-studio.spec.ts e2e/barcode-scanner.spec.ts` | 44 passed (35 + 9) |
| Every unit test in the application | `npx vitest run frontend/tests/unit tests/unit` | 2,990 passed in 175 files, none failed |
| Integration suites that touch the tools, the catalogue's derived files, routes, the sitemap or the assistant's knowledge | `npx vitest run tests/integration/{ai-website-knowledge,ai-website-publish,financial-invariant-sweep,mrz-td-formats-api,mrz-tools-api,mrz-tools-catalogue,navigation-links,page-rate-limit,payment-authorization-matrix,platform-services-api,seo-routes,tool-page-status,tools-api,visitor-ip-surfaces}.test.ts` | 137 passed in 14 files. **The other 98 integration files were not run here**: they cover accounts, billing and other code this work does not touch, and take more than an hour on the development machine. The pull-request workflow runs all of them |
| Types | `npm run typecheck`, `npx tsc -p frontend/tsconfig.json --noEmit` | both exit 0 |
| Production build | `npm run build` | exit 0, "82 tool entries; projection verified" |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |

What these establish:

- Each of the twelve kinds of QR code is decoded from the PNG and from the PDF and compared
  character for character with the payload written out by hand in the test. Eleven of them are
  checked the same way as a Data Matrix and as an Aztec Code; a SEPA payment is a QR Code only.
- The scanner's decoder reads the Barcode Generator's output for all thirteen types it claims: two
  independent implementations (BWIPP drawing, ZXing reading) agree on the content.
- In Chromium the scanner reads nine barcode types from chosen PNG pictures, three more pictures as
  lossy JPEG and WebP files, and one barcode from a camera. **The camera there is a video file that
  Chromium plays as if it were a camera.** No real lens was used.
- Every camera track the page is given is ended again in each of these cases: Stop, a decoder file
  that fails to load (twice in a row), and a tab that is in the background. Undoing either fix makes
  its test fail.

Two checks were made by hand and are not part of the suite:

- **Under the production Content-Security-Policy.** `vite preview`, which the e2e suite runs
  against, sends no security headers, so the production build was also served by a throwaway server
  with the header `src/plugins/security.ts` sends (copied from a live response of the application;
  `upgrade-insecure-requests` left out, since the check ran over plain HTTP on a loopback port). All
  seven pages were then used in Chromium: an example generated on each of the six artwork tools,
  every download taken, "Open to print" pressed, and the scanner given a picture, a camera and the
  path older browsers take. No policy violation was reported. This is why previews and uploaded
  pictures are handled as `data:` URLs, which `img-src` allows, and never as `blob:` URLs, which it
  does not.
- **The whole Playwright suite against the commit this branch started from.** This branch: 129
  passed, 67 failed, 6 skipped. The starting commit: 89 passed, 66 failed, 6 skipped. The failures
  were there before this work and are in other specs (`business-tools`, `a11y-marketing`,
  `a11y-id-card` and four more); none is in `design-studio.spec.ts` or `barcode-scanner.spec.ts`.
  The two lists of failures differ in five tests: three `business-tools.spec.ts` "resets its form"
  tests failed only here, and a PAYE test and a `promo-video.spec.ts` test failed only on the
  starting commit. Run three more times each on both, all five fail on some runs here, and all but
  the `promo-video` one pass on some runs on the starting commit: the difference is unstable tests,
  not this work.

**Derived files.** Everything generated from the catalogue was regenerated for 82 entries, in the
order given in [OPERATIONS.md](./OPERATIONS.md) under "Adding a tool". That includes the website
assistant's knowledge of the site (`src/ai-website/content/website-knowledge.generated.json`), which
now holds a document for each of the seven tools, so the assistant can answer questions about them.
Its `--check` was already failing on the starting commit for drift that has nothing to do with these
tools (eight admin routes and the punctuation of one description); regenerating brought that in as
well, and the check now passes. One generated set was deliberately left as it was: the published
copies under `frontend/public/docs/` and `docs.generated.json`, which the generator rewrites on the
starting commit too (dashes in twelve documents) and which no tool touches.

### 13.6 Not built, and why

- **A barcode image from a URL** (TEC-IT's TBarCode API). It would let any website embed barcodes
  served by this application, which is traffic and processing the owner pays for, and it needs the
  cross-origin resource policy relaxed for that route. That is a decision for the owner, not a
  default.
- **The rest of the label library.** Most of TEC-IT's templates are one car maker's or one industry
  body's supplier label: VDA 4992 and 4994, Ford, Volkswagen, General Motors, Caterpillar, Autoliv,
  Bosch, AIAG B-3, B-5, B-10 and B-15, Odette OTL 1 and 3, Galia ETI.9, MAT labels. Each is defined
  by a specification that is sold or issued to suppliers, and none of those documents is in this
  repository. A label drawn from memory of a standard and offered as that standard would be worse
  than no label.
- **Label templates with public rules, not built yet**: the full GS1 logistic label (the shipping
  label can carry the SSCC-18, but not the content lines such as GTIN, count, batch and best-before
  date as GS1-128), LTO tape cartridge labels, nutrition facts panels, the SEPA mandate form and the
  Swiss QR-bill. Each is a piece of work of its own and can be added one at a time.
- **Swiss QR and ZATCA payment codes.**
- **Stored data**: saved label layouts, CSV import, tables of scans kept on the server (TWedge
  Cloud). The tools remain stateless.
- **Scanning with the better decoder in the page.** Possible if `'wasm-unsafe-eval'` is added to the
  script policy; the scanner would then read the same types the test suite's decoder does.

### 13.7 Still not verified

Everything in §12.6 still holds, and in addition:

- **No phone was used.** What a phone's camera app does with each kind of QR code (offer to join the
  network, save the contact, open the banking app) was not observed. The payloads follow the
  formats phones recognise and are read back by a decoder; that is all that is claimed.
- **No real camera was used** for the scanner. Focus, glare, motion and a low-end phone's processor
  are untested.
- **No bank was involved.** A SEPA payment code was not scanned with a banking app.

---

## 14. Third round (2026-11-13): the scanner's second decoder

The second round ended with three questions to the owner. The third was whether to allow WebAssembly
in the site's security policy so that the scanner could read more barcode types (the last item of
§13.6). The owner's reply was "3". **That was read as a yes to the third question, and this section
records what was done on that reading.** If it meant something else, the change is one word in one
file and is withdrawn as described in [SECURITY.md](./SECURITY.md) §8.

### 14.1 What changed

- **The policy.** `script-src` in `src/plugins/security.ts` gained `'wasm-unsafe-eval'`. It lets a
  page compile WebAssembly and nothing else: `eval()` and `new Function()` stay refused, because
  `'unsafe-eval'` is not granted. The header is the same on every page, so the allowance covers the
  whole site and not the scanner alone. What that does and does not expose is set out in
  SECURITY.md §8.
- **Two decoders.** The scanner page now decodes with zxing-cpp compiled to WebAssembly
  (`zxing-wasm` 3.1.6, MIT; zxing-cpp itself is Apache-2.0), which was already the test suite's
  independent decoder. Its binary is served from this site, never from the CDN the library would
  use by default. The JavaScript decoder of the second round (`src/tools/scanner/decode.ts`) stays:
  it is what the API runs on the server, and what the page falls back to.
- **Twenty-one types on the page, thirteen from the API.** The eight that are new need the full
  decoder: UPC-E, GS1 DataBar Limited, GS1 DataBar Expanded, Micro QR Code, rMQR Code, MicroPDF417,
  Telepen and MaxiCode. `src/tools/scanner/formats.ts` is the one list both the page and the API
  description are written from.
- **Choosing the decoder** (`frontend/src/lib/scan-engine.ts`). The page compiles an eight-byte
  empty module to learn whether the browser will run WebAssembly at all, which is how a policy
  without the allowance shows itself. If it will, the binary is fetched on the first scan; if that
  fails for any reason (a proxy that will not pass `.wasm` files, a binary that will not start), the
  page loads the JavaScript decoder instead. With the basic decoder the page says so in a notice and
  marks the eight types "not in this browser". Nothing is retried in the page: Chromium does not ask
  again for a script that failed to load, so the message asks for a refresh (§13.4).
- **What the full decoder is asked** (`frontend/src/lib/scan-cpp.ts`). Exactly the types on the
  list, by name, one symbol per picture, the content as plain text. Four of the names are chosen
  against the library's defaults, each for a misreading found by trying it:
  - `Code39Std`, not `Code39`: asked for the family, the library reads a HIBC code "+A999..." as
    "a999...", a full-ASCII Code 39 in mixed case, and a six-character Code 39 as a Code 32 number.
  - `TelepenAlpha`, not `Telepen`: the bars cannot say whether a Telepen is text or a number. The
    scanner reads text and offers the number beside it.
  - `AztecCode`, not `Aztec`, which would add Aztec runes: a number from 0 to 255 in a mark small
    enough to be found in a picture of something else.
  - `EAN13` also finds UPC-A (a UPC-A is an EAN-13 that begins with 0), and is shown as its twelve
    digits.
- **A second look for bars printed light on dark.** The library finds the square types either way
  round but not the types made of bars, whatever it is asked. A still picture is therefore searched a
  second time with light and dark exchanged, for those types only. A camera frame gets one look.

### 14.2 The same words from both decoders

A barcode that both decoders read is reported with the same type and the same text by both, so a
visitor's result does not depend on which one their browser ran, and the API agrees with the page.
That took corrections on both sides:

| Barcode | Reported as | Corrected in |
| --- | --- | --- |
| UPC-A | its twelve digits | full decoder (it gives thirteen, with a leading 0) |
| UPC-E | the eight digits printed under it | full decoder (it gives the thirteen-digit number they stand for) |
| GS1 DataBar | `01` and the fourteen-digit GTIN | basic decoder (its library gives the digits alone, and a wrong number when a composite part is printed above the bars) |
| GS1-128 | the fields, separated by the GS character; the opening FNC1 is not data | basic decoder |
| GS1 DataMatrix | the fields, without a leading GS | basic decoder |
| Code 39 | the characters as printed | full decoder (`Code39Std`) |
| Aztec Code | read again from the corrected bits by ISO/IEC 24778 | basic decoder: its library knows nothing of the code that introduces an FNC1 or a character set and reads the bits after it as data, so a GS1 Aztec Code came out as a confident string of wrong characters |

**Text beyond ASCII.** A two-dimensional barcode holds bytes, and mostly does not say what
characters they are. This is where the basic decoder's library was furthest out, and differently by
where it ran: under Node it read unstated bytes as UTF-8 and found no barcode at all in anything
else (a QR Code of Latin-1 text was "not found" by the API), while in a browser it read them as
Latin-1 (a Data Matrix of UTF-8 text came out with two wrong characters for each accented letter).
In both it ignored a character set stated in a Data Matrix or a PDF417, and in a Data Matrix read
the number of the set as a character of the data. Now:

- The library is not left to convert anything. Bytes it asks to have converted are set aside and
  put back afterwards (`decode.ts`, "Bytes to text"), so the answer is the same under Node and in a
  browser.
- Bytes that state no character set are judged once, by one rule (`formats.ts`): UTF-8 if they are
  valid UTF-8, Shift JIS if they look like it, otherwise Latin-1. It was written to give what
  zxing-cpp gives, and the comparison in §14.5 found no barcode on which the two differ.
- A character set the barcode states (an ECI) is applied: UTF-8, UTF-16, the ISO-8859 and Windows
  sets, Shift JIS, Big5, GB 18030 and EUC-KR are exercised in the tests, in each of QR Code, Data
  Matrix, PDF417 and Aztec Code.
- Windows-1252 is converted by a table of the decoder's own (`formats.ts`), not by the runtime.
  Node 24.8.0's converter gives ISO-8859-1 for that set, so under it the API reported a euro sign
  as a control character, while the page, in a browser, reported the euro sign. The pull request's
  CI found this: its Node 24.8.0 job failed the test that reads each character set with both
  decoders, and its Node 22.12.0 job passed. The table is checked against the full decoder's, byte
  by byte, and against a stand-in for the faulty converter, so the check does not depend on which
  Node runs it. The converters for thirty-five other sets were compared between Node 22.22.3 and
  24.8.0 on the bytes 00 to FF and gave the same text.
- Bytes that are not text in any of these are given one character to each byte by both decoders.
  Left to itself the full decoder's library gives a few stray characters and a row of replacement
  marks for them, and the bytes are gone; where its text holds such a mark the scanner works the
  text out from the bytes instead (`fromBytes` in `scan-cpp.ts`).
- Shown, a control character is drawn as a picture of it. The controls from U+0080 to U+009F, which
  only data that is not text produces, share one picture.

**Where the basic decoder does not read what the full one does.** Each of these is "no barcode was
read", never a wrong text, and each is pinned by a test:

- A character set stated part-way through a Data Matrix or a PDF417, or one whose number is above
  126 in a Data Matrix. The library's text for these cannot be put right from outside it.
- Code page 437 (ECI 0 and 2), which neither Node nor a browser has a converter for. ISO-8859-16
  (ECI 18) is read in a browser and not under Node, for the same reason.
- A Codabar that holds a plus sign: the library has the wrong bars for it.
- A small share of clean symbols its library fails to locate. In the random comparison below that
  was 1 in 2,500; a rectangular Data Matrix drawn by another encoder was a second.

**One wrong guess both decoders share.** Three or more accented capitals in a row, in Latin-1 with
no character set stated, are taken for Japanese by every ZXing, this one included. The barcode has
to state its character set to be read otherwise.

### 14.3 Limits of the full decoder

- **MaxiCode** is read only from a clean, upright image of the code alone, on white or nearly white.
  A turn of three degrees, a quarter turn, noise, a ground darker than light grey or anything else
  dark in the picture defeats it. The page's list says "from a clean, upright image only", and a note says it is not
  read from a camera or a photograph.
- **Codablock F** is not read by either decoder. It is built from rows of Code 128, and both report
  one row of it as a Code 128 barcode: a fragment, not the content. The notes say so. It was left
  that way because a real Code 128 cannot be told from one row of a Codablock F by its bars.
- **A tilt of about seventeen degrees** loses the low or dense types made of bars (Code 39, Telepen,
  PDF417, the stacked and limited GS1 DataBar forms, PZN, HIBC) with either decoder. Upright, turned
  a quarter or upside down, and blurred at half size, the full decoder read every type but MaxiCode.
- **Not read by either decoder**: postal barcodes, Code 11, MSI, Pharmacode, DotCode and Han Xin;
  the two-dimensional part of a GS1 composite symbol; the add-on beside an EAN or ISBN barcode.

### 14.4 Measurements

Made on the development machine, in Node, with the same code the page runs. A picture with no
barcode in it is the slow case, because every way of looking is tried before giving up.

| Picture with no barcode | Full decoder | Basic decoder |
| --- | --- | --- |
| 960 × 540 (a camera frame as the page sizes it) | 62 ms | 1,434 ms |
| 1,280 × 720 | 117 ms | 1,325 ms |
| 2,000 × 1,500 (the largest still picture the page searches) | 378 ms | 2,058 ms |
| 4,000 × 3,000 | 1,759 ms | not measured |

A frame that holds a barcode took the full decoder 1 to 5 ms. Three hundred empty camera-sized
frames in a row produced no false reading. The decoder's memory stayed between 21 and 64 MB. The
page sends the full decoder a camera frame every 180 ms at most 960 pixels a side and a still
picture at most 2,000 pixels a side, as it does the basic one.

What a visitor's browser fetches the first time something is scanned, in addition to the page:

| | With WebAssembly | Without |
| --- | --- | --- |
| Decoder | `zxing_reader-*.wasm`, 946.9 kB (411.6 kB if compressed in transit) and its loader, 37.4 kB (13.5 kB) | `decode-*.js`, 397.0 kB (106.0 kB) |

So the full decoder is the larger download, by about 0.6 MB as stored. The application itself sends
static files uncompressed; whether the binary travels compressed depends on the web server in front
of it. The scanner page's own script is 23.1 kB (9.0 kB compressed) and its style sheet 4.4 kB. The
embedded build for the WHMCS theme was not changed by this round: there the scanner is still the
upload form that calls the API, and the bundle holds neither decoder. It was 456 kB (114 kB
compressed) before `main` was merged and is 480 kB (119 kB) after, the difference being the two
tools `main` added.

### 14.5 Evidence (2026-11-13)

Run from `cloudhost247-node/`. These replace the scanner rows and the totals of §13.5.

| Check | Command | Result |
| --- | --- | --- |
| Both decoders and the API | `npx vitest run tests/unit/barcode-scanner.test.ts` | 142 passed |
| The loader: which decoder a browser is given | `npx vitest run tests/unit/barcode-scanner-engine.test.ts` | 6 passed |
| The policy the application sends | `npx vitest run tests/unit/spa-security-headers.test.ts` | 6 passed |
| The page in jsdom | `npx vitest run frontend/tests/unit/barcode-scanner-page.test.tsx` | 13 passed |
| Pages in Chromium, production bundle | `npx playwright test e2e/design-studio.spec.ts e2e/barcode-scanner.spec.ts` | 49 passed (35 + 14) |
| Every unit test in the application | `npx vitest run frontend/tests/unit tests/unit` | 3,147 passed in 184 files, none failed, under Node 22.22.3 and again under Node 24.8.0 |
| The integration suites listed in §13.5, and the four more that `main` had changed | `npx vitest run tests/integration/<name>.test.ts` | 168 passed in 18 files |
| Types | `npm run typecheck`, `npx tsc -p frontend/tsconfig.json --noEmit` | both exit 0 |
| Production build | `npm run build` | exit 0, "84 tool entries; projection verified" |
| The compiled server starts | the `node -e "require('./dist/src/app.js')"` step of `.github/workflows/node-platform.yml` | loads cleanly |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| Python suites, from the repository root | `python3 -m unittest discover -s tests/website -p "test_*.py"`, the same with `-s tests/tools` | 247 OK (8 skipped), 26 OK |
| The release-candidate gate, without its PHP steps | each non-PHP command of `scripts/release-candidate-check.sh`, in order | 24 of 24 pass |
| The whole gate, PHP steps included | CI on the pull request, jobs "Release candidate (PHP 7.4)" and "(PHP 8.2)" | both pass |
| Every unit and integration suite, build and start | CI on the pull request, job "Build, typecheck, test (Node 22.12.0)" | passes |

**These figures were taken after `main` was merged into the branch.** `main` had gained two tools
(Email & Link Extractor, Email Extractor Pro) and their tests since the branch was cut, so the
catalogue now holds 84 entries. Before the merge the same commands gave 3,088 unit tests in 176
files, 137 integration tests in 14 files and 82 catalogue entries. The scanner's and the Design
Studio's own counts in the rows above did not change with the merge.

**What CI found.** The first run on the pull request passed on PHP 7.4, PHP 8.2 and Node 22.12.0
and failed on Node 24.8.0, in one test: the Windows-1252 case of §14.2. That is a fault in the
scanner's API under that Node version, not in the test, and it is fixed as §14.2 describes; the
fix added one test, which is why the scanner's file now counts 142 and the suite 3,147. The row for
Node 22.12.0 above is from the run before the fix.

What these establish:

- **Under the policy the application really sends.** The e2e spec takes the header from the
  application's own security plugin, serves the page with it in Chromium, and checks that the full
  decoder runs, that the browser refuses nothing the scanner does, that everything the page fetches
  comes from this site, and that `new Function` still throws there. The same spec takes the one word
  out and checks the other path: the notice, the eight types marked, the thirteen read with the same
  text, and the binary never requested.
- **The full decoder reads the Barcode Generator's output for all twenty-one types** (rMQR, which
  the generator does not draw, from the encoder library directly), and the basic decoder for its
  thirteen. Where both read a symbol, three independent implementations agree on its content: BWIPP
  drawing, ZXing reading and zxing-cpp reading.
- **Both decoders give the same text.** Beyond the fixed cases, 160 barcodes of random bytes (text,
  almost-text and data, in QR Code, Data Matrix, PDF417 and Aztec Code) are read by both in the unit
  suite and compared. A longer run of the same comparison outside the suite, 2,500 barcodes, gave
  2,499 identical, one the basic decoder did not find, and none that differed. In Chromium the same
  eight pictures (Latin-1, UTF-8, stated character sets, a GS1 Aztec Code, data that is not text)
  are read once with each decoder and must show the same text.
- **Each new behaviour fails its test when it is undone.** Twenty-two deliberate breakages were
  tried one at a time, among them: the word removed from the policy, `'unsafe-eval'` added to it, no
  fallback, no second look, `Code39` for `Code39Std`, the Aztec text as the library reads it, a
  stated character set ignored, a set stated part-way passed on, the full decoder's replacement
  marks passed on. One was not caught, and showed that the condition it removed could never be
  false; the condition was deleted. The other twenty-one each failed at least one test.

**Derived files** were regenerated in the order given in [OPERATIONS.md](./OPERATIONS.md), for the
scanner's new description and notes, and again from the merged catalogue after `main` was merged.
The figures the website report declares (`docs/website-rebuild/FINAL-REPORT-2026-10-16.md`: rows of
the page inventory, aliases, signpost routes, served tool routes) were brought into line with the
regenerated inventory, as `main` did for its own two tools. The published copies under
`frontend/public/docs/` and `docs.generated.json`, which the second round left alone because the
generator rewrote them for unrelated reasons, are no longer rewritten by the generator on `main`.

### 14.6 Still not verified

Everything in §12.6 and §13.7 still holds, and in addition:

- **The PHP steps of the release-candidate gate** (PHP lint, the PHP test runners including
  `tests/tools/site-integration.php`, and the rendered-site audit) have been run only by the pull
  request's CI, where they pass (§14.5). PHP is not installed where this was developed, so they
  cannot be repeated there.
- **The other integration suites.** The application has more than a hundred; eighteen were run in
  development, chosen because they touch tools, the catalogue's derived files, routes, the sitemap,
  the assistant's knowledge, or were changed on `main`. The whole set has been run only by CI.
- **Other versions of Node.** The scanner's tests were run under 22.12.0, 22.22.3 and 24.8.0. The
  application supports Node from 20.9; no other version was tried, and the Windows-1252 fault shows
  that a runtime's converters can differ between versions.
- **Chromium only.** The policy word, the full decoder and the fallback were run in headless
  Chromium. Firefox and Safari were not tried. A browser that does not know the word, or will not
  run WebAssembly for another reason, is expected to take the fallback, which is the path tested in
  Chromium with the word removed; that expectation was not observed in any other browser.
- **No phone and no real camera**, as before. How fast the full decoder is on a low-end phone was
  not measured; the figures above are from a development machine.
- **Notices for the libraries.** The page now delivers zxing-cpp (Apache-2.0) to visitors' browsers
  inside the binary, as it already delivered ZXing's JavaScript (MIT). Both licences ask that their
  notice go with copies. The site has no page of third-party notices, and none was added.
- **Kanji mode with other bytes.** A QR Code in Kanji mode is read (drawn for the test by
  zxing-cpp's own encoder, since BWIPP does not use the mode). One that mixes Kanji mode with bytes
  in a different character set was not available to test.

---

## 15. Fourth round (2026-11-13): presented the way TEC-IT presents them

### 15.1 What was wrong

After §13 the five tools did what TEC-IT's do — 83 barcode types, six label templates, VDA 4902,
shipping labels, QR business cards and the QR Code Maker — but the page did not read like theirs.
Everything was one long form: the barcode type was a dropdown of eighty-three names with no hint of
what any of them is for, the template and the kind of code were dropdowns too, and the sections were
headed "Barcode", "Size and appearance", "PDF layout". TEC-IT's pages are browse-first: a numbered
sequence, a described list of types to choose from, then the data, then the options, with the artwork
and its downloads beside them the whole time.

### 15.2 What changed

- **The picker.** `StudioField` gained `chooser` and `popular`; `StudioOption` gained `help`; and
  `StudioSection` gained `stepTitle`. A field marked `chooser` is rendered by the new
  `frontend/src/components/tools/StudioChooser.tsx` as a grid of described radio cards, with a
  search box, group filters that count their options, and shortcut chips for the handful of types
  most people want (EAN-13, UPC-A, Code 128, Code 39, QR Code, Data Matrix, PDF417). Five tools use
  it: barcode type, label template, VDA format, shipping label size, card layout and what a QR code
  does. The dropdowns remain for every field whose options are few or not a catalogue.
- **Descriptions from the registries, not from the page.** Each card's second line is the
  symbology's own `summary`, the template's `summary`, or a one-line statement added beside the VDA
  formats, shipping sizes, card layouts and QR kinds. Nothing describes a choice the tool cannot
  draw.
- **Numbered steps.** The barcode form was split so that choosing the type is its own step, as it is
  on TEC-IT's page: *1 Choose a barcode type*, *2 Enter the data*, *3 Size and appearance*,
  *4 Printing and PDF layout*. Every other tool gets the same treatment from its own section list,
  and each step's heading is a sentence rather than a noun.
- **The action next to the artwork.** The preview panel now carries a compact copy of the form's
  submit button, so a visitor working down a long form does not have to scroll back to the end of it.
  It is deliberately small: the panel is sized so that the preview and its first download stay on
  screen together on a 1280×720 laptop, and the laptop test in `e2e/design-studio.spec.ts` holds it
  to that.
- **An empty data field adopts the example of the choice just made.** Picking EAN-13 on an untouched
  form now shows thirteen digits that EAN-13 accepts, instead of an empty box with a hint in it.
  Anything typed is left alone.

### 15.3 How it was tested

- `npx vitest run tests/unit` — 190 files, 3,200 tests, all passing, including the 96 Design Studio
  backend tests (which build requests from the same `forms.ts` this round changed).
- `npx vitest run frontend/tests` — 96 files, 1,499 tests, all passing, including a new
  `frontend/tests/unit/studio-chooser.test.tsx` (5 tests: every option rendered as a radio, search
  and group filters narrow without losing an option, the empty state offers the way back, a short
  list gets no search box) and the existing `design-studio-page.test.tsx`, updated where the page's
  controls changed rather than weakened.
- `npx playwright test e2e/design-studio.spec.ts` — 35 tests, all passing in headless Chromium
  against the production build: every tool draws and saves its PDF, the QR fields follow the kind,
  the panel layout holds on a laptop and on a phone, the long-form button brings the result into
  view, and the axe WCAG 2.1 AA scan finds nothing serious or critical. That scan caught two
  contrast faults in the new CSS (the group-count chips and the small group caption in each card);
  both were darkened until they pass.
- `npx tsc -p tsconfig.json --noEmit` and `-p tsconfig.scripts.json --noEmit` — clean.

### 15.4 Still not verified

- **Chromium only.** The picker was exercised in headless Chromium. Firefox and Safari were not
  tried; the layout uses ordinary grid, flexbox and a native radio group, but that is an argument,
  not an observation.
- **No phone and no touch.** The phone layout was measured at 390×900 with no sideways scrolling;
  it was not used on a device.
- **The scrolled rack.** With more than twelve options the picker scrolls inside a 430 px panel
  rather than lengthening the page. It was checked at desktop and phone widths; a keyboard-only pass
  through all 83 cards with a screen reader was not done.
- **PHP and the rest of the gate** stand as in §14.6.
