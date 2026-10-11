# Employee ID Card Generator — audit and completion record

**Route:** `/tools/business-tools/employee-id-card-generator` (also reachable through
Business Tools → Generators; the API slug is `employee-id-card-generator`)
**Category:** Business Tools → Generators (one of the twelve)
**Status:** implemented, tested, and verified against the acceptance list in
[Testing](#9-testing-and-what-each-test-would-catch) below.

This document is the tool-by-tool audit for the Employee ID Card Generator. It records what was
there, what was missing or broken, what was built, how it is verified, and what it deliberately does
not claim. The plain-language inventory of every tool in the section lives in
[TOOL-AUDIT.md](../TOOL-AUDIT.md).

---

## 1. What the tool does

A browser-side staff-badge designer. An employee record and a company record go in; twelve
print-ready front-and-back cards come out, with a real QR symbol, a real Code 128 barcode, and
downloads in PDF, PNG, JPG and SVG. A roster can be imported from CSV or Excel and generated as a
batch.

Everything runs in the tab. No card, photograph, signature or employee record is sent to a
CloudHost247 server, and nothing is written to browser storage unless the user opts in (see
[Privacy](#7-privacy-model)).

---

## 2. Where the code lives

The tool is split in two, and the split is the reason the same card comes out of the browser, the
API and the test suite.

| Half | Path | What it holds |
|---|---|---|
| Engine (isomorphic, no DOM) | `cloudhost247-node/src/tools/business/id-card/` | Form validation, the twelve layouts, the colour system, both code encoders, PDF/ZIP/SVG writers, the bulk importer, and the Tools Center adapter |
| Page (browser only) | `cloudhost247-node/frontend/src/pages/tools/IdCardGeneratorPage.tsx` and `frontend/src/components/tools/IdCard*.tsx` | The form, the live preview, uploads, downloads, storage |
| Browser plumbing | `cloudhost247-node/frontend/src/lib/id-card/{canvas,read-image,export,storage}.ts` | Canvas drawing, file reading and image validation, file downloads, localStorage policy |
| Shared font | `cloudhost247-node/src/tools/shared/block-font.ts` | The 5×7 block font used by the verification rasteriser and the logo maker |

Engine modules (all under `id-card/`): `types.ts` (geometry, templates, presets), `model.ts` (form →
spec, validation), `templates.ts` (the twelve layouts and the shared blocks they are built from),
`colors.ts`, `text.ts` (metrics, fitting, dates), `qr.ts`, `code128.ts`, `svg.ts`, `raster.ts`,
`pdf.ts`, `zip.ts`, `images.ts`, `expand.ts`, `batch.ts`, `tool.ts` (registry/API adapter),
`index.ts` (public surface).

---

## 3. Audit: what existed, what was missing, what was done

| Area | State found | Action |
|---|---|---|
| Tool registration | Registered as one of the 21 tools; reachable, and the page rendered a generic schema-driven form | Replaced for this slug by a purpose-built workspace; the registry entry and the API path are unchanged |
| Templates | A single portrait/landscape layout with a band and a footer | Twelve distinct layouts (see [§4](#4-the-twelve-templates)) |
| Colour | One `themeColor` input | Eight presets with names and hex values, plus four custom colours that also drive the surfaces derived from them |
| QR | Present, and genuinely encoded; payload defaulted to the employee ID | Kept the encoder and the payload contract; the symbol is now raster-verified on every template, and both code symbols sit on their own light plate |
| Barcode | Encoded but positioned by a proportional slot, which printed it too dense to scan on at least one template | Full-width on the back face, a density guard that refuses to print a symbol below 2.5 px/module and says why, and a read-back test |
| Preview | None (schema-driven result panel) | Live front/back preview that *is* the export canvas, scaled with CSS |
| Exports | SVG only, from the result document | PDF (one page per side or both sides on a sheet), PNG, JPG, SVG, print sheet; one archive for two-sided and bulk downloads |
| Photographs | `includePhoto` flag, no upload | Photo, logo and signature upload with type/size/dimension/corrupt-file validation, replace and remove |
| Bulk | None | CSV and XLSX import in the browser, column mapping, validation with a rejected-row report and a downloadable rejected-rows CSV, batch generation to one ZIP with a manifest |
| Privacy | Not addressed | Documented, enforced in code, with a "clear stored data" control and an explicit opt-in for storing images and contact details |
| Validation | Required name/ID; bad blood group and expiry-before-issue were advisories | Blood group and the date pair are enforced or warned per [§6](#6-validation-rules); the downloads stay locked while a mandatory field is wrong |
| Legacy API contract | `employeeName`, `designation`, `themeColor`, `issueDate`, `expiryDate`, `includePhoto`, `includeQr` | All still honoured through `formStateFromInput()`; the tests pin them |

### Defects found and fixed during this work

These were real and would have shipped. Each has a regression test.

1. **Text was shortened, then drawn at the size it was measured at.** `fitText()` dropped trailing
   words in preference to shrinking, and every call site took `.text` while keeping the original
   `size`. A 388 px emergency-contact line was measured against a 254 px column, shortened, and then
   drawn 388 px wide — straight under the next column. `fitText()` now shrinks to a floor *before*
   dropping words, single-token values (an ID, an email, a URL) are completed rather than clipped,
   and the call sites use the fitted size. (Regression: "prints the employee ID, email and emergency
   contact in full on ..." across all twelve templates and both orientations.)
2. **The QR's white plate printed on top of other fields.** On `startup-frame` it covered the
   employee ID, the email address and the telephone number; on `portrait-pass`, three field rows; on
   `tech-diagonal` it clipped the photograph and the monogram; on `corporate-split` the footer band
   covered the "EMPLOYEE ID" caption. The plate is opaque, so those fields simply were not on the
   printed card. All four layouts were re-placed. (Regression: "prints nothing on top of text or a
   photograph on ..." across all 24 template/orientation pairs.)
3. **The Code 128 symbol could print too dense to scan.** At ~1.7 px per module nothing decoded.
   The barcode now has the full card width above the footer, and `MIN_CODE128_MODULE_PX = 2.5` makes
   the renderer refuse to draw a symbol it cannot print legibly, with a warning saying so.
   (Regression: read-back of every template's back face, plus the "too dense to print" case.)
4. **The QR payload was a decorative sentence** ("CloudHost247 employee badge · ID … · …") rather
   than something a scanner can act on. It is now the employee ID, or `NAME:<full name>` for a card
   with no ID — the contract the tool has always documented.
5. **Expiry dates were printed as "31 Dec 2027"** and the expiry row could be dropped from the back
   face in favour of the company website. Both changed: the month is spelled out, and the back-face
   rows are ordered so the security and safety facts come first and the issuer's address last.

---

## 4. The twelve templates

Each template is a different layout — where the photograph, the details, the codes and the branding
sit — not a colour swap. The evidence is
[`docs/id-card/template-contact-sheet.png`](../id-card/template-contact-sheet.png), a single image
rendered from the shipped engine (see [§10](#10-how-to-re-verify)) with front above back for every
template.

| Template | Layout idea |
|---|---|
| Corporate Split | Colour brand panel with the photograph, details on white |
| Modern Badge | Dark card, accent stripe, monogram tile, ID pill under the portrait |
| Minimal Centre | Centred monogram, centred name block, hairline rule |
| Signature Wave | Layered wave through the lower third, signature on the wave |
| Creative Panel | Full-height colour panel, round monogram, details down the spine |
| Startup Frame | Inset keyline frame with corner brackets |
| Gradient Edge | Layered edge bands, portrait column on the right |
| Portrait Pass | Photo column with a lanyard slot, details on the left |
| Tech Diagonal | Diagonal band, technical grid hairlines, monospace identifier |
| Mono Stripe | Graphic stripe block through the lower half |
| Executive Ribbon | Corner ribbon, serif-formal detail rows |
| Soft Geometry | Organic translucent circles with a frosted detail panel |

Each face is ISO/IEC 7810 ID-1 (85.60 × 53.98 mm) rendered at 300 dpi: 1011 × 638 px landscape,
638 × 1011 px portrait.

---

## 5. Colour

Eight presets — Salario Green, Corporate Blue, Midnight, Royal Purple, Bright Orange, Crimson,
Elegant Teal, Charcoal — each supplying an accent and a detail colour, and four custom pickers
(primary accent, card background, text colour, detail accent) with a colour input *and* a hex field.
The derived surfaces (panel tints, hairlines, muted text, "on-accent" text) come from the palette's
values and are re-derived whenever it changes, so a custom palette controls the card rather than just
recolouring two strokes. Choosing any colour switches the palette to *custom* and the preset chips
show which starting point is in use; **Reset form** returns to the default template and Salario
Green.

Text contrast is measured (WCAG relative luminance) and a ratio below 4.5:1 produces a warning naming
the ratio. It is a warning, not a block: the user may be printing a deliberate low-contrast
photographic background.

---

## 6. Validation rules

**Blocking** (the preview still draws, the downloads stay disabled, and every message names its
field): missing or non-letter employee name; missing or malformed employee ID; missing company name;
malformed email or telephone; a blood group that is not one of the eight; a date that is not a real
calendar date; oversized fields; a website that is not a URL; an unknown template.

**Advisory** (shown, nothing blocked): no photograph (the card shows a monogram); no signature; a
joining date in the future; an expiry that is not after the issue date; text whose contrast is below
4.5:1; any value the layout had to shorten, quoted back to the user; and the standing note that an
ID card is an identity artefact and that printing one for a non-employee or altering an existing
card may constitute fraud.

**Employee ID check digit.** If the identifier's digits satisfy the Luhn scheme the card reports
`Valid (Luhn)`; if they do not, it reports `Invalid (Luhn)` and warns that the ID will not match a
payroll or access-control record. Identifiers that are not long enough to carry a check digit are
reported as `Not verifiable` rather than being passed as valid.

---

## 7. Privacy model

The published promise is that employee data and photographs stay in the browser. That is enforced,
not just stated:

- The only storage is `localStorage` under `ch247.id-card.v1`; there is no request that carries card
  data anywhere.
- Photographs, signatures, the emergency-contact line, the phone number and the email address are
  **not written** to storage unless the user ticks "Also remember uploaded photographs, signatures
  and contact details in this browser". Without it, the text fields are remembered between visits
  and the sensitive fields live in memory until the tab closes — which is the right default on a
  shared or kiosk machine.
- **Clear stored data** removes the card record and the consent flag, and says so. If nothing is
  stored, the button says "(nothing stored)" rather than pretending to do something.
- The one case where data leaves the browser is a bulk import whose rows reference
  `https://` photo URLs: those images are fetched by the browser so they can be drawn. That is
  stated on the panel before the user uploads, only `https` URLs are fetched, they are capped at
  6 MB with an 8-second timeout, and a failure is reported as a missing photograph on that one card.

---

## 8. What the tool does not claim

- **No verification service.** A QR code containing a URL is a link. CloudHost247 does not host a
  verification endpoint, does not check that the holder works for the issuing organisation, and
  prints no claim of verification. If the user supplies a URL, the page says plainly that
  CloudHost247 does not host or check that page, and that anything it shows about the holder must be
  accurate. A plain-text payload is labelled as plain text that verifies nothing.
- **No biometric or legal identity.** The card identifies, it does not authenticate.
- **Printing is the user's step.** The downloads are ID-1 at 300 dpi with instructions to print at
  100 % scale; the tool cannot know what the printer does with "fit to page".
- The requirement "tested with actual scanners" is met at the decoding level — a real QR decoder
  (`jsqr`) reads the symbol back out of the rendered pixels for every template and orientation, and
  the barcode is read back by the module-quantising decoder. Physical scanner hardware is outside
  what this repository can verify; the Downloads section of the page states the print scale needed
  for that step to succeed.

---

## 9. Testing, and what each test would catch

| Suite | Tests | Covers |
|---|---|---|
| `cloudhost247-node/tests/unit/employee-id-card.test.ts` | 72 | Twelve templates and their geometry, the colour system and injection safety, QR encoding and decoding off rendered pixels, Code 128 encode/decode including corruption detection, SVG/PDF/ZIP structure, validation, bulk import (CSV, quoted CSV, semicolon CSV, XLSX, BOM, duplicates, missing columns, photo URLs), fitting and overprint |
| `cloudhost247-node/frontend/tests/unit/id-card-generator-page.test.tsx` | 13 | The workspace: twelve templates, eight presets, four custom pickers, locked-until-valid downloads, QR payload disclosure, reset, palette switching, storage consent, clear, restore, bulk panel, the stated limits |
| `cloudhost247-node/tests/unit/business-tools-engines.test.ts` | 189 (whole section) | Included in the section suite: the generator's legacy field names, the two faces, the print sheet, the Luhn verdict, the refusal of an unknown blood group, and a QR decoded off the rendered back face |

Notable mechanisms, because they are the difference between a test that passes and a test that
proves something:

- **The QR is decoded from pixels, not markup.** `raster.ts` renders the same operations the browser
  draws, including text (with the shared block font) and the light plates under the codes, and the
  suite hands the result to the same `jsqr` decoder the Tools Center QR reader uses.
- **The layout is audited for overprints.** Any opaque shape drawn *after* a piece of text or an
  image, and overlapping it by more than 60 px², fails — for all twelve templates in both
  orientations. This is the test that found the four plate collisions in §3.
- **The ZIP and PDF writers are checked structurally**: CRC32s, central-directory offsets, path
  traversal, PDF cross-reference offsets landing on the objects they claim.

---

## 10. How to re-verify

```bash
cd cloudhost247-node
npm ci
npx tsc -p tsconfig.json --noEmit
npx vitest run tests/unit/employee-id-card.test.ts frontend/tests/unit/id-card-generator-page.test.tsx
npx tsx scripts/render-id-card-sheet.ts                        # docs/id-card/template-contact-sheet.png
npx tsx scripts/render-id-card-sheet.ts --only=tech-diagonal --scale=1 --orientation=landscape
```

`scripts/render-id-card-sheet.ts` is a development tool, not part of the build. It renders every
template's front and back through the shipped rasteriser so the question "do these look like twelve
different cards?" can be answered by looking rather than by trusting a test.

---

## 11. Dependencies and limits

| Dependency | Used for | Behaviour when unavailable |
|---|---|---|
| Browser canvas | Preview and every raster export | The page reports that no drawing context was provided instead of downloading an empty file |
| Browser `FileReader` / `Image` | Uploads, photo URLs in bulk | The upload is refused with the reason (type, size, dimensions, or a corrupt-file message) |
| `DecompressionStream('deflate-raw')` | Reading `.xlsx` | The importer says the file needs a current browser rather than silently reading nothing |
| `jsqr` (existing dependency) | The test suite's QR read-back | Test-only |
| Platform fonts | All user-visible text | The block font is used only by the verification rasteriser; it is not a fallback for anything a user downloads |

---

## 12. Remaining limitations

- The card is composed for a 300 dpi card printer; inkjet printing on plain paper needs the user to
  trim to size. The print sheet says so.
- The layout shrinks a long value a long way before it shortens it. On an extreme input (a 48
  character name on a portrait card) something must still give; the card warns with the shortened
  value quoted, and the engine's answer is to shorten the *prose*, never the identifier.
- Bulk generation renders in the tab. A roster above `BULK_MAX_ROWS` (500 per run, 5,000 imported) is
  split and the page says which part it is generating.
- A photograph supplied by URL must be reachable from the user's browser with CORS permitted;
  otherwise that employee gets a monogram and the row's report says why.
