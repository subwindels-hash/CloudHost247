# CloudHost247 Design Studio — Gap Analysis and Acceptance Baseline

**Measured:** 2026-11-11 against `main` @ `71dd7197` and branch `arena/f259bb51-cloudhost247`
**Version:** v2 (reconstructed) — the previous copy was destroyed by a sandbox re-clone
**Status:** evidence baseline for Sessions 3–8; amended as implementation lands.

Every figure below was produced by a command run against the repository. Nothing is inherited from
an earlier report without re-measurement.

---

## 1. Measured baseline

| Check | Command | Result |
| --- | --- | --- |
| Backend typecheck | `npm run typecheck` | exit 0 |
| Frontend typecheck | `npx tsc -p frontend/tsconfig.json --noEmit` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |
| Unit suite | `vitest run tests/unit` | **167 files, 2,387 tests, all passed** (207 s) |
| ID-card regression net | `vitest run tests/unit/employee-id-card.test.ts` | **72 passed** |
| QR decode round-trip | `vitest run tests/unit/business-tools-engines.test.ts` | **202 passed**, real `jsQR` decodes |
| Fencing integration suites | 3 suites | **not run** — no Patroni/PostgreSQL binaries, no env vars |

**Two corrections to earlier documentation**, both found by re-running rather than trusting:

1. `employee-id-card.test.ts` has **72 tests, not 49** — `grep -c "it("` misses nested `it.each`.
2. The unit suite **completes** in this workspace (207 s). The earlier "not verified" was an
   artefact of running the whole tree, including integration suites that block without a database.

---

## 2. Classification summary

| Class | Count |
| --- | --- |
| `implemented` | 14 |
| `partial` | 7 |
| `missing` | 21 |
| `blocked` | 3 |
| `not verified` | 2 |

---

## 3. Tools Center and integration

| Requirement | Class | Evidence | Missing |
| --- | --- | --- | --- |
| Canonical catalogue | `implemented` | `src/tools/catalog.ts`, 1,559 lines, 73 entries | 4 new slugs |
| API routes | `implemented` | `src/tools/routes.ts` (663) | endpoints for A/B/D/E |
| Execution pipeline | `implemented` | `src/tools/core/executor.ts` (313) | — |
| Handler registry | `implemented` | `src/tools/handlers/index.ts` | handlers for new slugs |
| Frontend API client | `implemented` | `frontend/src/lib/tools-api.ts` | — |
| Tool pages | `partial` | 6 files, 3,382 lines; `BusinessToolWorkspacePage.tsx` (694) is the reusable shape | pages for A/B/D/E |
| Navigation / search | `implemented` | catalogue-driven | new tools not indexed until catalogued |
| PHP/WHMCS projection | `implemented` | `tools-sitemap.php`, `scripts/export-tools-site.ts`, `tests/tools/*` | new tools not projected |
| Rate limiting | `implemented` | `executor.ts:173` `rateLimitProfile`; route-level `config.rateLimit` | profiles for new tools |

---

## 4. Tool A — Barcode Generator

| Requirement | Class | Evidence | Missing |
| --- | --- | --- | --- |
| Code 128 encode + decode | `implemented` | `id-card/code128.ts` (`encodeCode128`, `decodeCode128`, `rasterToCode128`) | — |
| QR Code | `implemented` | `productivity/qr.ts` (`qrcode` + `jsqr`) | — |
| Other 15 symbologies | `missing` | grep for `ean13\|upca\|code39\|code93\|itf14\|datamatrix\|pdf417\|aztec\|codabar\|gs1` over `src/tools/` → 0 hits | all 15 |
| Tool page, selector, live preview | `missing` | 0 slugs, no page | entire tool |
| Dimensions, colours, human-readable text, margins | `missing` | — | option plumbing |
| PNG / SVG export | `partial` | `raster.ts::renderFaceToRgba`; `svg.ts::faceToSvg` | generic export wiring |
| **Vector PDF export** | `missing` | `id-card/pdf.ts` is JPEG `DCTDecode` only | content-stream backend |
| Decode verification for 2D | `missing` | no decoder for 2D formats | `zxing-wasm` (test-only, ratified) |

---

## 5. Tool B — Label Designer

| Requirement | Class | Evidence | Missing |
| --- | --- | --- | --- |
| Draw-op element model | `implemented` | `render/draw-ops.ts` (extracted, commit `9ee8e6d4`) | — |
| SVG renderer | `implemented` | `svg.ts::opToSvg → faceToSvg` | arbitrary page sizes |
| Raster renderer | `implemented` | `raster.ts::renderFaceToRgba` | — |
| Units and physical dimensions | `partial` | `CARD_MM`, `mmToPoints`; mm only | cm/in/px, orientation, paper sizes |
| Element positioning / alignment | `partial` | absolute mm coordinates | user-editable layout |
| Templates (system + user) | `missing` | no persistence layer | table, CRUD, ownership (ratified: dedicated table) |
| CSV import + column mapping | `partial` | `batch.ts::parseCsv` (RFC 4180, delimiter detection), aliases, per-row rejects, `rejectedRowsCsv` | generic mapping UI, formula guard |
| Multiple labels per sheet | `missing` | no imposition logic | ratified rules, 15 test cases |
| Batch generation | `partial` | `batch.ts` report + `zip.ts::buildZip` | wiring to new templates |
| Print stylesheet | `missing` | — | print-specific CSS |

---

## 6. Tool C — VDA-4902

`blocked`. Deferred by decision: no implementation, no catalogue entry, no UI. Unblocking requires
the authoritative VDA 4902 specification and its licensing terms.

---

## 7. Tool D — Shipping Labels

| Requirement | Class | Missing |
| --- | --- | --- |
| Sender/recipient/shipment schema | `missing` | entire schema; must join `NON_PERSISTABLE_TOOL_SLUGS` |
| Layout templates | `missing` | layouts on the shared writers |
| GS1-128 barcode | `missing` | registry entry + AI-form normalisation |
| Tracking references, package data | `missing` | fields and validation |
| CSV bulk generation | `partial` | mapping from `batch.ts` pattern |
| Vector PDF printing | `missing` | `pdf-vector.ts` |
| Carrier branding | `blocked` | requires carrier specs and authorisation — **not implemented** |

---

## 8. Tool E — QR Business Cards

| Requirement | Class | Evidence | Missing |
| --- | --- | --- | --- |
| QR encode + decode verification | `implemented` | `business-tools-engines.test.ts:168,213` | — |
| vCard payload | `partial` | `qr-generator` advertises vCard support | MeCard; shared builder |
| Front/back card output | `partial` | ID-1 CR80 85.6 × 54 mm | 89 × 51 mm business card |
| Logo upload | `implemented` | `images.ts` magic-byte sniffing, 6 MB, dimension bounds | — |
| Colour/typography/templates | `partial` | `colors.ts`, `text.ts`, `templates.ts` (CR80 only) | business-card template set |
| Data Matrix | `missing` | no encoder | `datamatrix` via registry |
| PDF/PNG/SVG | `partial` | SVG + PNG yes; PDF raster-only | vector PDF |

---

## 9. Template management and persistence

| Requirement | Class | Evidence |
| --- | --- | --- |
| Save/browse/duplicate/delete | `missing` | no `tool_saved_templates` table, migration or repository anywhere |
| Ownership enforcement | `missing` | depends on the above |

**Ratified approach:** dedicated table; ownership enforced by predicate at the repository boundary
(`WHERE owner_id = $1`), never by a post-fetch check in the UI; system templates immutable to users.
Acceptance: user A cannot read, update or delete user B's template; no user can overwrite a system
template.

---

## 10. Security and privacy

| Requirement | Class | Finding |
| --- | --- | --- |
| CSV formula injection | `missing` | `batch.ts:434` `csvCell` quotes only on `[",\n;]`; leading `= + - @` pass through. **Pre-existing defect**; separate commit and test required |
| Upload validation | `implemented` | `images.ts`: magic-byte sniffing, allow-list, 6 MB, 240–4000 px — type by content, not filename |
| SVG sanitization | `implemented` by exclusion | `allowedTypes = ['image/png','image/jpeg','image/webp']`, comment "SVG is excluded on purpose: it can carry script" |
| PDF safety | `partial` | `pdfString()` escapes `\`, `(`, `)`; content is images only today — vector text path must reuse it |
| Input validation | `implemented` | zod across routes; `FieldIssue` in `model.ts` |
| Batch-size limits | `partial` | per-row rejects and a summary; **no explicit row cap found** |
| Rate limiting | `implemented` | profiles → executor; route-level limits |
| Sensitive contact data | `partial` | `NON_PERSISTABLE_TOOL_SLUGS` covers `mrz-generator` only |
| Auth / authorisation | `implemented` | `lib/require-auth`, availability gating |

---

## 11. Acceptance criteria — measured baseline

| # | Criterion | Baseline | Evidence |
| --- | --- | --- | --- |
| 1 | Every tool has a working page | `not met` | 0 of 4 slugs (A/B/D/E) exist |
| 2 | Forms have validated functionality | `not met` | no studio forms; `FieldIssue` pattern available |
| 3 | Real machine-readable encoders | `partial` | Code 128 + QR real and decode-verified; 15 formats absent |
| 4 | QR decodes to correct payload | **`met`** | `jsQR` round-trips, `business-tools-engines.test.ts:168,213` |
| 5 | Label templates correct layouts | `not met` | `templates.ts` is CR80-only |
| 6 | VDA specs documented/verified | `blocked` | spec + licensing not supplied |
| 7 | Shipping labels printable | `not met` | no module |
| 8 | Business cards front/back | `not met` | CR80 ≠ 89 × 51 mm |
| 9 | CSV bulk generation | **`met`** (ID-card scope) | RFC 4180 + XLSX + per-row rejects + `rejectedRowsCsv`; **reuse, do not rewrite** |
| 10 | PDF/SVG/PNG exports | `partial` | SVG + PNG yes; PDF raster-only |
| 11 | Print respects physical dimensions | `not met` | exact ID-1 only; no imposition |
| 12 | Saved templates persist | `not met` | no storage layer |
| 13 | All tools in Tools Center | `not met` | 73 entries, none of the new slugs |
| 14 | Existing tools keep working | **`met`** | 2,387 unit tests + 72 ID-card tests green |
| 15 | PHP/WHMCS compatibility | `not verified` | PHP suite not executed here |
| 16 | All relevant tests pass | `partial` | unit suite green; fencing integration unrun |

**Final acceptance rule:** every row must finish `met`, `not met` or `blocked`. No `not verified`
may remain. A `blocked` row names the decision and its approver. Code added is not completion — a
row moves to `met` only when a command produces the output that proves it.

---

## 12. Ratified decisions and their guardrails

1. **Template persistence** — dedicated table, ownership at the repository/API boundary.
2. **Imposition** — refuse-on-overflow; never scale, rotate or clip.
3. **2D decode** — `zxing-wasm` test-only; a test asserts no production module imports it.
4. **Grid resolution** — mode-dependent (`interactive` explicit, `batch` auto-fit and reported); the
   mode is an explicit input, never inferred.

**Multi-page continuation**, defined so refuse-on-overflow cannot prohibit valid pagination:

- **Class A (refuse):** `LABEL_EXCEEDS_PAGE`, `GRID_EXCEEDS_PAGE` (never silently reduced),
  `INVALID_GEOMETRY`.
- **Class B (paginate):** capacity ≥ 1 → `sheets = ceil(N / capacity)`, row-major, final sheet may be
  partially filled.

Required tests before implementation: capacity exactly full → 1 sheet; `capacity + 1` → 2 sheets;
`3 × capacity` → 3 full sheets; oversized cell → A1 with the shortfall named; requested 3 columns
where only 2 fit → A2 **not** a silent fallback; grid omitted interactive → `GRID_REQUIRED`; grid
omitted batch → auto grid returned; explicit grid via both modes → identical placements.

---

## 13. Non-claims

- Tools A, B, D and E are not implemented; only the shared draw-op contract has been extracted.
- No VDA, GS1 or carrier certification is held or implied.
- The two `not verified` rows are environmental, not judgement calls.
