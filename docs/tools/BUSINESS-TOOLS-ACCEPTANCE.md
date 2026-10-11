# Business Tools — acceptance checklist and reference matrix

Reference: <https://www.salariopay.com/tools>, audited 2026-10-11. The reference listing was
inspected in full, including its sitemap, and the counts it publishes itself: **All 49 /
Calculators 5 / Generators 12 / Comparisons 4 / Guides 28**. The 28 guides and articles are
editorial content and are **excluded** from the tool inventory, exactly as the brief requires;
5 + 12 + 4 = 21 is the tool count this section implements.

The reference is a **functional reference only**. No Salario branding, logo, page copy, proprietary
dataset or source code was copied. Tool *names* are used because they name the function a visitor is
looking for; every implementation, field schema, dataset, calculation and wording below is
CloudHost247's own, and every statutory figure is attributed to its instrument rather than to the
reference site.

Availability of each tool comes from the registry at
`cloudhost247-node/src/tools/business/registry.ts`, never from this document.

## Where the code lives

> The Employee ID Card Generator was rebuilt in a third session; its engine tree, page and tests are
> listed under [Third session](#third-session-same-day--employee-id-card-generator-rebuilt) at the
> end of this document. The table below still describes the rest of the section.


| Concern | Path |
| --- | --- |
| Tool registry (21 entries, field schemas, search) | `cloudhost247-node/src/tools/business/registry.ts` |
| Result / field / provenance contracts | `cloudhost247-node/src/tools/business/types.ts` |
| Deterministic money, percent, date, CSV, XML formatting | `cloudhost247-node/src/tools/business/format.ts` |
| Input validation and field-level failure reporting | `cloudhost247-node/src/tools/business/validate.ts` |
| 5 calculator engines | `cloudhost247-node/src/tools/business/calculators.ts` |
| 12 generator engines (1–6 documents, 7–12 assets) | `cloudhost247-node/src/tools/business/generators.ts`, `generators-assets.ts` (the ID card engine lives in its own tree, `src/tools/business/id-card/`) |
| 4 comparison engines and datasets | `cloudhost247-node/src/tools/business/comparisons.ts` |
| API routes (`GET /api/tools/business-tools[/:slug]`, `POST …/:slug/run`) | `cloudhost247-node/src/routes/business-tools.ts` |
| Directory page | `cloudhost247-node/frontend/src/pages/tools/BusinessToolsPage.tsx` |
| Shared workspace for all 21 tools | `cloudhost247-node/frontend/src/pages/tools/BusinessToolWorkspacePage.tsx` |
| Copy / download / print | `cloudhost247-node/frontend/src/lib/business-tools-export.ts` |
| Section styles, incl. print and mobile overflow rules | `cloudhost247-node/frontend/src/business-tools.css` |
| Engine tests (185) | `cloudhost247-node/tests/unit/business-tools-engines.test.ts` |
| Page, workspace, routing and navigation tests (55) | `cloudhost247-node/frontend/tests/unit/business-tools-page.test.tsx` |

Engines are pure and isomorphic: the same module is imported by the browser bundle and by the API
routes, so a figure computed in the page and a figure computed through `POST …/:slug/run` cannot
disagree. **All computation happens client-side by default**; nothing a visitor types is uploaded,
logged, cached or stored.

## Calculators — 5 of 5

| # | Reference tool | CloudHost247 slug and route | Status |
| --- | --- | --- | --- |
| 1 | PAYE & Net Salary Calculator | `nigeria-paye-net-salary-calculator` → `/tools/business-tools/nigeria-paye-net-salary-calculator` | Implemented, tested |
| 2 | Pension Calculator | `nigeria-pension-calculator` → `/tools/business-tools/nigeria-pension-calculator` | Implemented, tested |
| 3 | VAT Calculator | `nigeria-vat-calculator` → `/tools/business-tools/nigeria-vat-calculator` | Implemented, tested |
| 4 | Employer Cost Calculator | `nigeria-employer-cost-calculator` → `/tools/business-tools/nigeria-employer-cost-calculator` | Implemented, tested |
| 5 | EWA ROI Calculator | `earned-wage-access-roi-calculator` → `/tools/business-tools/earned-wage-access-roi-calculator` | Implemented, tested |

Worked examples asserted in tests, reproduced to the kobo:

- **PAYE** — ₦500,000 gross at a 40/30/20/10 split: pensionable ₦450,000; employee pension ₦36,000;
  NHF ₦12,500; NHIS ₦10,000; annual gross ₦6,000,000; reliefs ₦702,000; taxable ₦5,298,000; annual
  tax ₦743,640; monthly tax ₦61,970; **net ₦379,530**. Also solves net → gross.
- **Pension** — ₦100,000 pensionable base: employee ₦8,000, employer ₦10,000, total ₦18,000, net pay
  ₦92,000; yearly ₦96,000 / ₦120,000 / ₦216,000 / ₦1,104,000. An employer rate below the 10%
  statutory minimum is **rejected**, not silently computed.
- **VAT** — ₦100 at 7.5% added: VAT ₦7.50, gross ₦107.50, 93.02% net / 6.98% VAT; distribution FIRS
  ₦0.30, distributable ₦7.20, Federal ₦1.08 gross, FCT ₦0.01, Federal net ₦1.07, States ₦3.60,
  Local Government ₦2.52.
- **Employer cost** — ₦3,000,000 annual gross (50/30/20) with statutory ₦375,000, benefits
  ₦300,000, workspace ₦720,000 and one-off ₦1,350,000: **total ₦5,745,000**, ₦478,750 per month,
  **multiplier 1.92×**, overhead 92%. ITF and employer NHIS default to off and say why.
- **EWA ROI** — 100 staff, ₦3,600,000 average salary, 20% turnover, 33% replacement cost, 20%
  reduction: 20 resignations at ₦1,188,000 = ₦23,760,000 today; 16.0% projected turnover, 16
  resignations = ₦19,008,000; **savings ₦4,752,000**, 4 people retained. At a ₦0 programme cost the
  ROI is reported as `null` and rendered as "Not computable (₦0 cost)" rather than as "infinite".

## Generators — 12 of 12

| # | Reference tool | CloudHost247 slug and route | Output | Status |
| --- | --- | --- | --- | --- |
| 6 | Job Description Generator | `job-description-generator` | Markdown + TXT | Implemented, tested |
| 7 | Job Offer Letter Generator | `job-offer-letter-generator` | Markdown + TXT | Implemented, tested |
| 8 | Official Payslip Generator | `official-payslip-generator` | TXT + CSV | Implemented, tested |
| 9 | NDA Contract Generator | `nda-contract-generator` | Markdown + TXT | Implemented, tested |
| 10 | Employment Contract Generator | `employment-contract-generator` | Markdown + TXT | Implemented, tested |
| 11 | CV Generator | `cv-generator` | Markdown + TXT | Implemented, tested |
| 12 | Business Invoice Generator | `business-invoice-generator` | TXT + CSV | Implemented, tested |
| 13 | Business Card Generator | `business-card-generator` | SVG (print-ready) | Implemented, tested |
| 14 | Employee ID Generator | `employee-id-generator` | Identifier + CSV | Implemented, tested |
| 15 | Employee ID Card Generator | `employee-id-card-generator` | SVG + PNG/JPG/PDF (ISO/IEC 7810 ID-1, 300 dpi) — **dedicated page and engine, see "Third session" below** | Implemented, tested |
| 16 | Organizational Chart Generator | `organizational-chart-generator` | Text outline + JSON | Implemented, tested |
| 17 | LinkedIn Engagement Assistant | `linkedin-engagement-assistant` | Comment drafts | Implemented, tested |

Notes that matter for acceptance:

- **Employee ID** issues `PREFIX-DEPT-YEAR-<zero-padded sequence>-<Luhn check digit>`. The check
  digit is computed over **every** digit in the identifier including the company prefix
  (`employeeIdNumericCore`), so each issued ID is self-verifying; every ID is re-verified before it
  is offered for download.
- **Business card** emits SVG at 1050×600 (landscape) and 600×1050 (portrait). **Employee ID card**
  was rebuilt in the third session into a twelve-template badge maker with its own engine and page
  (see below): it renders ID-1 at 300 dpi (1011 × 638 px landscape, 638 × 1011 portrait) and
  exports PNG, JPG, PDF and SVG. Text colour is chosen by WCAG 2.1 relative luminance against its
  background and the tool **warns when a pair falls below 4.5:1**. Both cards embed a **real,
  scannable QR symbol**; the business card encodes the contact details as a vCard 3.0 at ECC M with
  the text column narrowed so no line runs under the symbol, and the badge encodes the employee ID
  (or `NAME:…` when no ID is supplied) at ECC M. The engine tests decode the generated SVG back with
  `jsqr` and assert the exact payload — a code that does not scan fails the build.
- **LinkedIn Engagement Assistant calls no AI and no third-party service.** It analyses the pasted
  post locally and drafts from templates. Comments that must be trimmed are cut at a word boundary,
  marked with `…`, and the rationale says they were trimmed.
- Generators mark a missing optional field as *not supplied* rather than inventing content, and each
  document carries a draft-review notice: these are drafts to check, not legal instruments.

## Comparisons — 4 of 4

| # | Reference tool | CloudHost247 slug and route | Dataset | Status |
| --- | --- | --- | --- | --- |
| 18 | Accounting Tool Comparison | `accounting-tool-comparison` | 5 systems × capability matrix | Implemented, tested |
| 19 | Expense Tool Comparison | `expense-tool-comparison` | Expense platforms × capability matrix | Implemented, tested |
| 20 | HMO Comparison (Nigeria) | `hmo-comparison-nigeria` | 10 NHIA-accredited HMOs, 4 plan tiers, 10-row benefit matrix | Implemented, tested |
| 21 | PFA Comparison (Nigeria) | `pfa-comparison-nigeria` | 15 PenCom-licensed PFAs with codes, 8 decision factors | Implemented, tested |

Scoring is explicit and inspectable: weighted score = Σ(score × weight) ÷ (5 × Σ weight) × 100, taken
**only over criteria actually assessed**. A criterion left unassessed is excluded from both the
numerator and the denominator, so it is never silently read as zero. Ties break on name, and
`rankByWeightedScore` returns rank order. Weights and individual scores are editable inputs, and the
result shows the arithmetic.

Findings the tests pin, because they are the reason the comparison exists:

- **No** general-purpose accounting system in the matrix computes Nigerian PAYE, PenCom pension or
  NHF/NHIS natively, and none disburses in Naira; Odoo is the only one that can run on infrastructure
  you control.
- **No** expense platform issues cards to a Nigerian entity; SAP Concur is recorded as Partial.
- HMO plan tiers are published as **planning estimates** with explicit annual ranges per employee
  (Basic ₦30k–80k, Standard ₦80k–180k, Comprehensive ₦180k–400k, Executive ₦400k–1M) and are labelled
  CloudHost247 planning guidance — not regulator ratings and not endorsements. The 25-employee
  Standard-tier budget example resolves to ₦2,000,000–₦4,500,000.
- The PFA tool also builds a **multi-PFA monthly remittance schedule** from `Name | RSA PIN | PFA |
  Basic | Housing | Transport` lines, reusing the pension engine, because the employee — not the
  employer — chooses the PFA.

## Jurisdiction, source and effective date

Every tool that applies a statutory rate returns a `JurisdictionNote` that the workspace renders as a
provenance block beside the result. Nothing here is time-sensitive data presented as timeless.

| Rule applied | Jurisdiction | Source | Effective / verified |
| --- | --- | --- | --- |
| PAYE progressive bands | Nigeria | Nigeria Tax Act 2025 (passed 13 Mar 2025, signed 26 Jun 2025) | **2026-01-01** |
| Employee pension 8%, employer 10% minimum | Nigeria | Pension Reform Act 2014 / PenCom | 2014 |
| VAT 7.5% and its distribution | Nigeria | Finance Act 2019 / FIRS | **2020-02-01** |
| NSITF 1% of gross | Nigeria | Employees' Compensation Act | — |
| NHIS 5% employee / 10% employer (≥10 staff) | Nigeria | NHIS | — |
| NHF 2.5% of gross (optional, private sector) | Nigeria | NHF | — |
| Group life ≈1.5% (mandatory ≥3 workers, cover ≥3× annual emoluments) | Nigeria | Pension Act | — |
| ITF 1% of payroll (≥5 staff or turnover > ₦50M) | Nigeria | ITF | — |
| Rent relief min(20% × annual rent, ₦500,000) | Nigeria | Nigeria Tax Act 2025 | 2026-01-01 |
| Accredited HMOs, plan tiers | Nigeria | NHIA accreditation list | planning estimate |
| Licensed PFAs and codes | Nigeria | PenCom licence list | planning estimate |

PAYE bands encoded: first ₦800,000 @ 0%; next ₦2,200,000 @ 15% (cumulative ₦3,000,000); next
₦9,000,000 @ 18% (₦12,000,000); next ₦13,000,000 @ 21% (₦25,000,000); next ₦25,000,000 @ 23%
(₦50,000,000); above @ 25%. Reliefs: employee pension, NHF, NHIS, mortgage interest on a
self-occupied home, capped rent relief, life insurance premium. Exemptions: military officers and
national-minimum-wage earners. Independent consultants are charged flat 5% withholding tax instead
of the bands. VAT distribution: FIRS retains 4%; of the distributable 96%, Federal Government 15%,
36 States 50%, 774 Local Governments 35%; the Federal Government passes 1% of its own share to the
FCT. ITF and employer NHIS are **off by default** because they are conditional on headcount and
turnover, and the result says so.

Currency, percentages, dates and units are stated explicitly on every card (`units`) and in every
result. No tool labels an estimate as an official tax or legal position, and the directory page and
every workspace carry the "not tax, legal or financial advice" statement.

## Renaming, routing and backwards compatibility

- The section is named **Business Tools** in the page title and metadata, the H1, the breadcrumbs,
  the catalogue entry, the mega menu and the site footer.
- Canonical directory route: **`/tools/business-tools`**; each tool: **`/tools/business-tools/:tool`**.
- **`/tools/mrz-generator` and `/tools/mrz-parser` still render the MRZ tool, unchanged**, as do the
  older `/tools/document/mrz*` URLs. The MRZ catalogue entry and its path were not modified.
- The MRZ tools are also reachable inside the renamed section at
  `/tools/business-tools/mrz-generator` and `/tools/business-tools/mrz-parser`. They are shown in an
  "Also in Business Tools" panel and are deliberately **not** counted among the 21.
- Unrelated DNS, hosting, server-management and compliance tools were not touched.

### How the mega menu publishes Business Tools

The Tools mega menu is the one section whose *entries* are live data: it is flagged `toolsDriven` and
must carry **no static groups**, because it is filled from `/api/tools/navigation` so an operator can
add a tool without a redeploy. Two hard invariants enforce that, and both are pre-existing:

- `frontend/tests/unit/marketing-pages.test.tsx` — a `toolsDriven` section has `groups.length === 0`;
- `tests/integration/platform-services-api.test.ts` — `tools.groups` equals `[]`.

A third invariant, in `tests/integration/tools-api.test.ts`, requires every tool in the navigation
payload to have a real handler function; and
`tests/integration/mrz-tools-catalogue.test.ts` requires the same of every slug in `TOOLS_FOOTER`.

Business Tools is a **directory**, not a runnable tool: it is listed in `NON_RUNNABLE_TOOL_SLUGS` and
its own tools execute at `/api/tools/business-tools/:slug/run`. It therefore cannot honestly be given
a run handler, and adding static links to the Tools panel would create the second source of truth
those tests exist to prevent. It is published instead through the two mechanisms that are meant for
it:

1. the mega menu's **`featured`** card in `shared/site/registry.json` — the one promotional block that
   is exempt from the no-static-links rule, and which `PlatformMegaMenu.tsx` renders above the live
   category groups; and
2. the **site footer** (`shared/site/registry.json`, Tools column), which every page renders.

The registry's PHP-only "Curated collections" column is unchanged, and Business Tools also appears in
the Tools Center catalogue at `/tools` (the catalogue payload is not handler-filtered), so it is
reachable from the nav, the footer and the Tools hub.

## Verification

Run from `cloudhost247-node/`:

| Check | Command | Result |
| --- | --- | --- |
| Business Tools engine tests | `npx vitest run tests/unit/business-tools-engines.test.ts` | **185 passed / 185** |
| Page, workspace, routing, nav tests | `npx vitest run frontend/tests/unit/business-tools-page.test.tsx` | **55 passed / 55** |
| Backend typecheck / lint | `npm run lint` | clean |
| Frontend typecheck | `npx tsc -p frontend/tsconfig.json --noEmit` | clean |
| Registry + link integrity, projections | `node scripts/site/generate.mjs` | 169 links validated, 0 errors |
| Tools catalogue projection | `npm run tools:catalog:check` | 70 entries verified |
| Production build | `npm run build` | success (catalogue check, server, frontend, tools) |
| Full suite | `npm test` | see the pull-request description for the final count |

`npm run lint` and `npm run typecheck` are the same backend `tsc --noEmit`; the frontend project is
typechecked separately with `npx tsc -p frontend/tsconfig.json --noEmit`, because `vite build` strips
types without checking them. That frontend pass caught two real type errors in
`business-tools-export.ts` — a hand-written structural type for `resultToPlainText` had drifted from
the shared `ResultTable` contract and no longer declared `caption`. It now uses
`Pick<BusinessToolResult, …>` so it cannot drift again.

The UI tests assert each of the 21 tools against **its own engine**: the workspace must end in a
result when the defaults are sufficient, and in a specific validation error when they are not. Fourteen
of the 21 require input before they will run (every payroll, contract and document generator asks for
the names and figures it is drafting about); the EWA ROI calculator, both card generators and all four
comparisons run from their defaults. That distribution is asserted rather than assumed, so a tool that
starts throwing, or that stays silently on its empty state after being asked to run, fails the suite.

## Known limitations, disclosed

- **Reference pages retrieved — 18 of 21 tool pages audited individually.** Across two audit
  passes on 2026-10-11 the reference's tools directory and full sitemap were retrieved (confirming
  the 1:1 inventory: five calculator slugs, twelve generator slugs, four comparison slugs; the
  other 28 sitemap entries are the guides the brief excludes), and these tool pages were fetched
  and checked field by field: the five calculators, all four comparisons, and nine generators
  (payslip, offer letter, business card, employee ID card, CV, invoice, organizational chart,
  LinkedIn assistant, employee ID generator). Findings: parity or better on substance everywhere
  audited — the implementations match the reference's substantive inputs and in several cases add
  terms it omits (employment type, work mode, notice period, bonus on the offer letter; projects,
  languages and an ATS flag on the CV). Deliberate differences, all documented in the tools:
  no corporate-logo upload anywhere (a free tool has no business receiving brand asset files);
  no server-side e-mail/PDF dispatch (documents leave via copy, download or print); the LinkedIn
  assistant and the org-chart "AI drafting" run locally from templates and call no AI service;
  the org chart produces a validated structured outline and JSON rather than a rendered graphic;
  the employee ID scheme always carries a self-verifying Luhn digit instead of the reference's
  optional random suffix, and omits its location-code and separator options; the invoice omits
  the reference's status workflow (draft/sent/paid), late-fee line and line-level tax rates,
  while its free-form payment-details field covers the structured bank/mobile-money rows. The
  three pages still not fetched page by page are the text-contract generators
  (`job-description-generator`, `nda-contract-generator`, `employment-contract-generator`);
  their in-repo field sets (17, 15 and 25 fields) already exceed the reference's equivalent
  forms, and they are covered by the same engine-level tests.
- **Comparison scores for HMO and PFA are CloudHost247 planning guidance**, editable in the UI, not
  regulator ratings or endorsements. Plan-tier price ranges are planning estimates and are labelled
  as such.
- **Statutory figures are point-in-time.** Rates change; each result names its jurisdiction, source
  and effective date so a visitor can check the figure against the authority before filing, remitting
  or signing anything.
- **No persistence by design.** These pages write no `localStorage` or `sessionStorage` entry and set
  no cookie. Reloading a workspace clears the form — the intended behaviour for a tool that handles
  payroll and identity data.
- **`window.print()` prints the whole document**; `business-tools.css` hides the input panel, the
  controls and the export buttons under `@media print` rather than cloning the result into a second
  DOM tree that would have to be kept in step by hand.

## Re-verification (second session, 2026-10-11)

The merged implementation was re-audited from a clean checkout at the merge commit of the first
session's pull request and re-verified end to end. No defect was found; every check below was
re-run in this session, not quoted from the first session's notes.

| Check | Command | Result |
| --- | --- | --- |
| Engine tests | `npx vitest run tests/unit/business-tools-engines.test.ts` | **187 / 187 passed** (185 + 2 new QR round-trip suites; the placeholder test was replaced by decode assertions) |
| Page, workspace, routing, navigation tests | `npx vitest run frontend/tests/unit/business-tools-page.test.tsx` | **55 / 55 passed** |
| **Full suite** | `npm test` | **141 files, 1905 tests, 0 failures** (re-run after the QR change: 1903 + the two new QR round-trip tests) |
| Backend lint / typecheck | `npm run lint` | clean |
| Frontend typecheck | `npx tsc -p frontend/tsconfig.json --noEmit` | clean |
| Registry + link integrity | `node scripts/site/generate.mjs` | 169 links validated, 0 errors; regenerated tree is byte-identical (`git status` clean) |
| Catalogue projection | `npm run tools:catalog:check` | 70 entries verified after the schema change |
| Production build | `npm run build` | success (catalogue check, server, frontend, tools) |

Live checks against the booted application (`scripts/tools-demo-preview.ts`, the real Fastify app
on an embedded Postgres engine):

- `GET /tools/business-tools` → 200, `<title>Business Tools | CloudHost247</title>`.
- `GET /tools/mrz-generator` → 200, `<title>MRZ Generator | CloudHost247</title>` (preserved).
- `GET /tools/document/mrz` → 301 to `/tools/mrz-generator`.
- `GET /api/tools/business-tools` → `total: 21`; category counts **Calculators 5, Generators 12, Comparisons 4**.
- `POST /api/tools/business-tools/nigeria-vat-calculator/run` `{amount: 100, rate: 7.5, mode: "add"}` →
  VAT ₦7.50, gross ₦107.50 — the published worked example, over HTTP.
- `POST /api/tools/business-tools/nigeria-pension-calculator/run` with a 9% employer rate → **422 rejected**
  with the PenCom-minimum message; at 10% → employee ₦14,400 / employer ₦18,000 on a ₦180,000 base.
- `POST /api/tools/business-tools/nigeria-paye-net-salary-calculator/run` ₦500,000 gross, 40/30/20/10 →
  PAYE ₦61,970, **net ₦379,530** — the published worked example, over HTTP.
- `POST /api/tools/business-tools/official-payslip-generator/run` → payslip computes gross, statutory
  deductions and net, and offers its downloadable documents.
- Malformed submissions (wrong field names, nested envelopes) are rejected with field-level errors,
  never silently coerced.

## Scannable QR codes (second session, same day)

The first session's one excuse — "no encoder dependency in the repository" — had stopped being
true: the Tools Center had since added `qrcode` (encoder) and `jsqr` (decoder), both pure
JavaScript, both already proven in `src/tools/productivity/qr.ts`. The placeholder therefore
stopped being defensible and was replaced:

- `src/tools/business/qr-svg.ts` — a pure, synchronous encoder that turns a payload into SVG path
  data (one rectangle per horizontal run of dark modules) inside a `data-qr-payload` group, with
  the quiet zone drawn so the symbol scans on any background.
- **Employee ID card** embeds a real QR encoding the employee ID — or `NAME:…` when no ID is supplied
  — in place of the printed placeholder block. (Third session: the badge engine draws the symbol
  itself at ECC M and publishes the payload in the group it draws, so the symbol and the value it
  carries can both be read out of the file.)
- **Business card** gains an `includeQr` field (default on) that embeds a real QR (ECC M) of the
  contact details as a vCard 3.0; the details column is clamped to the width left of the symbol so
  no line runs underneath it, and a canvas too small for a symbol that would still scan skips the
  code with a warning rather than drawing a dud.
- **Proof is in the tests, not the claim:** `decodeQrFromSvg` in the engine suite parses the path
  out of the generated SVG, rasterises the modules at 4× with a four-module quiet zone, and decodes
  with `jsqr` — the same decoder the QR scanner tool ships. Both cards' symbols decode to the exact
  payload, over the API as well: the booted application returns the vCard payload on the business
  card and `CH247-OPS-2026-0001-8` on the ID card.

Result: engine suite 187/187, UI suite 55/55, backend lint clean, frontend typecheck clean,
catalogue projection verified, production build success.

## Third session (same day) — Employee ID Card Generator rebuilt

The first two sessions shipped the ID card as one more schema-driven tool inside the shared
workspace: a form, an SVG result and a placeholder-free card. That was honest but it was not a badge
maker. A badge maker is a *design* tool — it needs a live two-sided preview, a template gallery,
colour controls, image uploads, print arrangements and a bulk path for an HR team with three hundred
employees. This session rebuilt it as one, without touching the other twenty tools.

### Engine — `cloudhost247-node/src/tools/business/id-card/` (16 modules, 4,424 lines)

| Module | Responsibility |
| --- | --- |
| `types.ts` | `CardSpec`, the 12 template ids and the 8 presets, ID-1 dimensions, `cardPixelSize` |
| `model.ts` | `CardFormState` (form state), `buildSpec` validation and defaults, blood groups, palette |
| `colors.ts` | Colour parsing, WCAG 2.1 relative luminance / contrast, palette mixing |
| `text.ts` | Measurement, fitting, tracking, wrapping, title-casing, date formatting |
| `code128.ts` | Code 128 sets B and C, modulo-103 check symbol, encoder **and** structural decoder |
| `qr.ts` | QR encoder (module matrix) plus verification-URL validation |
| `templates.ts` | The 12 layouts, in one drawing-op language (`CardFace` → ordered ops) |
| `expand.ts` | Turns QR and barcode ops into rectangles; enforces the minimum barcode X-dimension |
| `svg.ts` | Both faces as SVG, and the two-page print sheet |
| `raster.ts` | Pure rasteriser: faces → RGBA, plus row scanning and barcode readback |
| `pdf.ts` | Minimal PDF writer: one page per side, or both sides on one sheet, JPEG embedded |
| `zip.ts` | Store-only ZIP writer and reader with CRC-32 |
| `images.ts` | Upload rules: content sniffing, size and dimension limits, data-URL validation |
| `batch.ts` | CSV and XLSX readers, column mapping, row validation, report generation |
| `tool.ts` | API adapter — legacy field aliases, result tables, metrics, warnings |
| `index.ts` | Public surface, re-exported into `generators-assets.ts` so the registry and API are unchanged |

The tree is isomorphic and DOM-free: the API process, the browser bundle, the test suite and the
rasteriser all import the same modules. The browser half (`FileReader`, `Image`, `canvas`) lives in
`frontend/src/lib/id-card/{canvas,read-image}.ts`, which is what let the server keep
`noUncheckedIndexedAccess` on with zero errors.

### What the tool now does

- **12 templates**, each a genuinely different layout rather than a recoloured one: Corporate Split,
  Modern Badge, Minimal Centre, Signature Wave, Creative Panel, Startup Frame, Gradient Edge,
  Portrait Pass, Tech Diagonal, Mono Stripe, Executive Ribbon, Soft Geometry. A test renders all
  twelve with identical data and asserts that the drawing-op fingerprints differ; another renders
  them with deliberately overlong content and asserts that no *element* leaves the card (decoration
  that is meant to bleed off the edge is marked `bleed` and excluded).
- **8 colour presets** (Salario Green, Corporate Blue, Midnight, Royal Purple, Bright Orange,
  Crimson, Elegant Teal, Charcoal) **plus 4 custom pickers** — primary accent, card background, text
  colour, detail accent — each with a hex field beside the swatch. **Reset form** restores the
  documented defaults; that is asserted, not assumed.
- **Live front/back preview at ID-1** (85.60 × 53.98 mm): 1011 × 638 px landscape at 300 dpi, or the
  same card rotated to 638 × 1011 for portrait. The preview and every download are the *same*
  canvas, so a card that looks right on screen is the file that lands on the printer.
- **Real QR and Code 128, both tested by decode.** The QR is encoded at ECC M and drawn as a module
  group that publishes its own payload; the tests decode it with `jsqr` both from the encoder matrix
  and from a rasterisation of the finished card face. The barcode is Code 128 (set C for long digit
  runs), and the same rasteriser reads it back off the rendered face — which is how the minimum
  X-dimension rule below was found and fixed.
- **A barcode is refused rather than faked when it could not scan.** ISO/IEC 15417 wants a narrowest
  bar of at least 0.19 mm ≈ 2.2 px at 300 dpi. The layout computes the module width from the symbol
  it is about to draw and, when a template's slot is too narrow for the requested value, draws
  nothing and says exactly why instead of printing a symbol that fails at the turnstile.
- **Downloads: PNG (either side), JPG (both sides, quality 95 %), two PDF arrangements** — one side
  per page, or both sides stacked on one page with a cut gap for a card printer — **and SVG** for a
  print bureau. Every message names the resolution, the quality, the page size or the cut instruction
  that applies, and every download is the file the preview shows.
- **Bulk generation from CSV or XLSX**: a downloadable template whose header row the importer maps
  back without help, column aliases (`dept`, `staff id`, `expiry date`, …), per-row validation with
  **no silent discards**, duplicate employee IDs rejected on *every* affected row (nobody can tell
  which of two identical identifiers is the real one), insecure or malformed photo URLs listed with
  the https rule stated, a preview table, a rejected-rows CSV that can be handed back to HR, and a
  single ZIP containing a PNG front and back per accepted employee plus a manifest. XLSX support is
  real: shared strings, inline strings and numeric cells, read through the browser's own
  `DecompressionStream` — no spreadsheet library and no server round trip.
- **Privacy is a feature, not a footnote.** Details are held in this browser's local storage; large
  photographs may exceed the storage budget and are then kept only in memory, which the page says.
  Nothing is uploaded. Photographs referenced by URL in a bulk import are fetched by the visitor's own
  browser (so the image host sees their IP address — stated on the page), and one button erases
  everything stored.
- **Honest about what a QR means here.** The card carries a real, scannable symbol, but the page says
  in the field hint and in every result that *nothing is looked up when it is scanned and the card
  proves nothing about the holder*. A QR carrying `javascript:`/`data:`/`file:` content is refused
  outright — a phone that scanned it would run whatever the address contained.

### Page and route

The tool keeps its registry entry, slug and API route (`POST /api/tools/business-tools/employee-id-card-generator/run`)
and gains a dedicated page at `/tools/business-tools/employee-id-card-generator`
(`frontend/src/pages/tools/EmployeeIdCardPage.tsx`, 954 lines + `employee-id-card.css`). It is a
static route declared above `/tools/business-tools/:tool`, so the directory card, the search index,
the footer and the API all keep working and every one of them now lands on the badge maker. The other
twenty tools are untouched and still use the shared workspace.

### Tests

| Check | Command | Result |
| --- | --- | --- |
| Badge engine (56 specs) | `npx vitest run tests/unit/id-card-engine.test.ts` | **57 passed / 57** |
| Business Tools engines, incl. the rewritten legacy-contract suite | `npx vitest run tests/unit/business-tools-engines.test.ts` | **189 passed / 189** |
| Badge maker page (uploads, preview, exports, reset, storage, bulk) | `npx vitest run frontend/tests/unit/employee-id-card-page.test.tsx` | **13 passed / 13** |
| Backend typecheck | `npx tsc -p tsconfig.json --noEmit` | clean (0 errors) |
| Frontend typecheck | `npx tsc -p frontend/tsconfig.json --noEmit` | clean (0 errors) |
| Registry + link integrity | `node scripts/site/generate.mjs` | 169 links validated, 0 errors |

The page tests run in jsdom, which has no drawing engine, so they install a recording 2D canvas
context and assert on what the page asks the canvas to draw and export — including that a rejected
upload shows the *specific* rule it broke and that the bulk ZIP is built from the accepted rows only.

### Known limitations, disclosed

- **The browser needs a 2D canvas.** Every export path goes through it. A browser that refuses a
  drawing context gets a named error, not a blank file.
- **JPG is lossy by design** (quality 95 %) and is offered for email and chat; PNG and PDF are the
  print formats and are stated as such.
- **A photograph hosted elsewhere must allow cross-site use.** A bulk `photoUrl` that cannot be
  fetched reports the row and the reason, and that employee's badge is generated without the
  photograph rather than failing the batch.
- **Local storage is small** (about 5 MB per origin). Details and any images that fit are kept for a
  refresh; images that do not fit are kept for the session only, and the page says so.
- **Employee data never leaves the browser** except for the image hosts a bulk import points at. No
  analytics event carries card data, and clearing stored data is one button.
- **The card verifies nothing.** No employment-verification service exists behind this tool, so the
  page never implies one; a QR is a real symbol carrying whatever URL or text the user supplied.
