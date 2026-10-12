# CloudHost247 Tools — Audit Report (2026-10-11)

Scope: the implementation brief covering the SalarioPay business tools, the Employee ID Card
Generator, the DNS Checker tool inventory, the MRZ tools and the Compliance Tools.

This report records what was **checked**, what was **verified**, and what is **still missing**.
It does not claim completion of the whole brief. Items marked *Not verified* or *Missing* are
open work, not hidden defects.

## 1. Method and evidence

| Check | Result | Notes |
|---|---|---|
| `npm ci` (Node 22.22.3, lockfile) | Pass | |
| `npm run typecheck` (server) | Pass | |
| `tsc -p frontend/tsconfig.json --noEmit` | Pass | |
| `npx vitest run` (full suite), before this change | **Pass** — 145 files passed, 1 skipped; 2,009 tests passed, 6 skipped; exit 0 | Takes about 20 minutes on this runner |
| `npx vitest run` (full suite), after the four new tools | **Pass** — 147 files, 2,056 tests, none skipped; exit 0 |
| `npx vitest run` (full suite), after Email Verifier | **Pass** — 148 files, 2,086 tests; exit 0 | Includes `tests/unit/email-verifier.test.ts` (syntax, routing verdicts, handler) | The previously skipped tool-page HTTP status test runs once the production build has created the SPA shell |
| `tests/unit/gap-tools.test.ts` | Pass — 37 tests | Minecraft codes, RAID layouts and invalid input, RFC 4193 layout, IPv6 classification, resolver failure propagation, catalogue wiring |
| `npm run build` (catalogue check, server, frontend, tools bundle) | Pass | |
| `npm audit --omit=dev --audit-level=high` | Pass — 0 vulnerabilities | |
| PHP suites (`tests/**/run.php`, `php -l`) | **Not run** | PHP is not installed in this sandbox. CI runs them. |
| Browser / end-to-end tests | **Present (Playwright, 67 tests)** | `e2e/business-tools.spec.ts` (52), `e2e/id-card.spec.ts` (10), `e2e/mrz.spec.ts` (5). Run with `npm run e2e`. See section 3.6 for scope and limits. |
| Production build served in staging | **Not done** | Requires a staging environment. |
| Live reference comparison | Partial | See §2. |

The repository is the CloudHost247 WHMCS customisation set plus the independent
`cloudhost247-node/` platform. The business, ID-card, DNS and MRZ tools all live in
`cloudhost247-node/`.

## 2. Reference inventories compared

### SalarioPay (`https://www.salariopay.com/tools`)

The live directory reports **49 tools: 5 calculators, 12 generators, 4 comparisons, 28 guides**.
The brief's 21 tools are the 5 + 12 + 4.

* Live-verified: the first directory entries (PAYE & Net Salary, Pension, VAT, Employer Cost,
  EWA ROI, Job Description Generator) match the registry.
* **Not verified:** the directory only exposes the first six entries to this tool; pagination
  parameters returned the same page. The remaining 11 generator names and the 4 comparison names
  could not be confirmed live. The registry's list is the working assumption:

| Category | Registered tools (`src/tools/business/registry.ts`) |
|---|---|
| Calculators (5) | PAYE & Net Salary; Pension; VAT; Employer Cost; EWA ROI |
| Generators (12) | Job Description; Job Offer Letter; Official Payslip; NDA Contract; Employment Contract; CV; Business Invoice; Business Card; Employee ID; **Employee ID Card**; Organizational Chart; LinkedIn Engagement Assistant |
| Comparisons (4) | Accounting Tool; Expense Tool; HMO (Nigeria); PFA (Nigeria) |

Action: capture the full live list (browser, or a directory page that exposes all 49) and diff it
against the registry before calling the 21 tools verified against the reference.

### DNS Checker (`https://dnschecker.org/all-tools.php`)

Categories: DNS, IP, Dev, Designer, Webmaster, Network, Cyber Security, Productivity, Gaming.
The catalogue (`src/tools/catalog.ts`, 68 entries) covers almost all of them. The gaps are below.

## 3. Tool-by-tool status

### 3.1 Business Tools (5 calculators, 12 generators, 4 comparisons)

| Tool | Route | Existing | Status |
|---|---|---|---|
| PAYE & Net Salary | `/tools/business-tools/…` | NTA 2025 bands (0/15/18/21/23/25%, ₦800k zero band, effective 1 Jan 2026), reliefs, pension, NHF, NHIS, gross↔net solver | **Band table verified** against five published sources. Calculation, reset and export behaviour covered by `business-tools-engines.test.ts`. |
| Pension | same | 8% employee / 10% employer, PRA 2014 floor checks | Rules correct for the statute; reference-case tests exist. |
| VAT | same | 7.5% standard rate, add/remove modes | Correct. |
| Employer Cost | same | Pension, NSITF, group life, ITF, HMO, workspace, one-offs | Rates are user-adjustable estimates, labelled as such. |
| EWA ROI | same | Workforce, adoption, turnover, replacement cost, evaluation period | Assumptions are user inputs, shown in the output. |
| 12 generators | same | Each has a pure compute function and a form schema | Covered by the registry test. Output quality per generator not reviewed in this pass. |
| 4 comparisons | same | Criteria, weights and scores templates | Covered by the registry test. Live comparison data sources not reviewed in this pass. |

### 3.2 Employee ID Card Generator (`/tools/business-tools/employee-id-card-generator`)

Verified by reading the code and the 59 unit tests in `tests/unit/employee-id-card.test.ts`
(not by a browser run):

| Requirement | Status |
|---|---|
| 12 templates, each a distinct layout program, fingerprint-tested | Implemented |
| 8 colour presets (Salario Green … Charcoal) | Implemented (`id-card/types.ts`) |
| Four custom colour controls (accent, background, text, detail) | Implemented (`id-card/colors.ts`) |
| QR code (validated URL) and Code128 barcode, with toggles | Implemented; Code128 round-trip is tested by a raster decoder |
| Front/back preview, ID-1 proportions | Implemented |
| Photo / logo / signature validation (type, size, dimensions, corrupt data) | Implemented (`images.ts`) |
| PDF, PNG and JPG export; SVG export | Implemented (`frontend/src/lib/id-card/export.ts`, `pdf.ts`) |
| Bulk import: CSV and XLSX parsing, column mapping, validation, duplicate IDs rejected in both directions, rejected-row report, batch ZIP with manifest | Implemented (`batch.ts`, `zip.ts`) |
| Photo URLs in bulk import (https only; fetched in the browser only at generation time) | Implemented |
| Local-only storage, image consent, clear-local-data | Implemented in `frontend/src/lib/id-card/storage.ts` (`localStorage` only) |

Browser end-to-end flow is now covered (`e2e/id-card.spec.ts`, 10/10): templates and presets, custom hex validation, canvas preview change, reset, photo rejection and acceptance, PNG/JPG/PDF exports, bulk duplicate-ID rejection with a rejected-row report, ZIP download, and clear-local-data.

Gaps not verified in this pass: real printed-card scan tests (requires physical scanners), and a pixel-level check of every template at export resolution. The QR and Code128 payloads are checked by unit tests, not by a scanner.

### 3.3 DNS Checker inventory

Covered by catalogue entries, handlers and tests (examples: `dns-lookup`, `mx-lookup`,
`spf-checker`, `dmarc-checker`, `dmarc-generator`, `dkim-checker`, `dnskey-lookup`, `ds-lookup`,
`reverse-dns`, `ip-lookup`, `ip-whois`, `ip-blacklist`, `ssl-checker`, `port-checker`,
`mac-lookup`, `mac-generator`, `asn-whois`, `http-headers`, `smtp-tester`, `email-header`,
`qr-generator`, `qr-scanner`, `morse` and `ROT13` in `encoding-tools`, `color-tools`,
`word-counter`, `notepad`, `password-tools`, `robots-generator`, `serp-simulator`,
`open-graph`, `broken-links`, `punycode`, `time-card`, `speed-test`, `ping`, `traceroute`).

Gaps found by comparison with the reference:

| Reference tool | Status | Reason / action |
|---|---|---|
| Minecraft Color Codes (Gaming) | **Implemented** (`minecraft-color-codes`) | Full standard code table with colour values; `&`↔`§` conversion and stripping, counting the codes changed. Filed under Productivity because the catalogue has no gaming category. |
| RAID Calculator (Productivity) | **Implemented** (`raid-calculator`) | RAID 0/1/5/6/10 usable and raw capacity, overhead, guaranteed and best-case failures, decimal TB and binary TiB. Metadata, filesystem overhead and hot spares are not modelled. |
| Local IPv6 Address Generator (IP) | **Implemented** (`ipv6-address-generator`) | RFC 4193 ULA prefix, /64 subnet and sample address from `crypto.randomBytes`. |
| IPv6 Compatibility Checker (DNS) | **Implemented** (`ipv6-compatibility-checker`) | AAAA and A lookups through the resolver layer, with resolver evidence. Reports DNS publication only, not reachability. |
| Name Checker (Productivity) | **Missing** | Requires per-platform username probes. Needs a source decision and rate limits before implementation. |
| Google PageRank | **Not implementable** | Google discontinued public PageRank data. Document as unavailable; do not fake results. |
| Credit Card Checker | **Deliberately excluded** | The repository's BIN checker explicitly refuses full card numbers. Keep this boundary; do not add Luhn validation of full PANs. |
| HTACCESS / URL rewrite generator | Covered | Inside `url-tools` (Multi-URL opener, rewrite and .htaccess generators). |
| Email Verifier | **Implemented, DNS-only** (`email-verifier`) | Syntax rules (RFC 5321/5322 dot-atom; quoted local parts reported as unsupported), then MX routing: accepts mail, null MX (RFC 7505), implicit MX fallback, unresolvable MX. **Mailbox existence is not checked** — that needs an SMTP RCPT probe, which is unreliable, often blocked and abusable, so it is not offered. Every result says so. |

The four implemented tools added catalogue entries, so `modules/addons/cloudhost247_theme/resources/tools.json`
was regenerated with `npm run tools:catalog` (74 entries; `--check` verified). The PHP catalogue
tests (`tests/tools/catalogue.php`, `tests/tools/site-integration.php`) could not be run here because
PHP is not installed; they run in CI and must pass before merge.

### 3.4 MRZ tools (`/tools/mrz-generator`, `/tools/mrz-parser`)

Verified:
* ICAO Doc 9303 check digits with weights 7, 3, 1 (`MRZ_WEIGHTS`), tested in
  `tests/unit/mrz-engine.test.ts` with valid and corrupted check digits.
* Parsing reports `checkDigitStatus` pass/fail and states that a valid MRZ does not prove a
  document is genuine.
* Routes are registered (`src/routes/mrz-tools.ts`); catalogue and API tests exist
  (`tests/integration/mrz-tools-api.test.ts`, `tests/unit/mrz-tools-catalogue.test.ts`).

Added (TD1/TD2, ICAO Doc 9303 Part 5):
* `src/tools/mrz/td-formats.ts` is a pure module. One table of field positions per format drives
  validation, field extraction and generation. Formats: TD1 (ID card, 3×30) and TD2 (2×36).
* Check digits use the same 7-3-1 function as TD3. The composite covers the ICAO character ranges.
  Impossible dates are rejected even when the check digit matches.
* Name handling: diacritics are transliterated, spaces and hyphens become `<`, and names that do
  not fit the format are refused rather than truncated.
* Generation validates its own output before returning it. If that validation fails, the response
  is an error, not a partial MRZ.
* Routes: `/api/tools/mrz/generate` accepts `format` (TD1, TD2, TD3; TD3 default). `validate` and
  `parse` detect the layout from the lines and accept `line3`. TD3 keeps its existing response shape.
  TD1/TD2 responses include `format`.
* Frontend: `MrzToolPage.tsx` has an MRZ format selector and a shared `TdResultCard`. The page
  imports the TD1/TD2 module from `src/tools`, the same pattern as the ID-card page.
* Tests: `tests/unit/td-formats.test.ts` (ICAO TD1 and TD2 specimens, corrupted check digits,
  name handling, generation round-trip) and `tests/integration/mrz-td-formats-api.test.ts`.

Limits:
* A passing MRZ check shows internal consistency only. Every TD1/TD2 result carries the
  `MRZ_AUTHENTICITY_NOTICE`. The output does not verify that a document is genuine.
* Not implemented: MRZ-OCR, and TD1 generation of optional data on line 2. Generation writes
  TD1 optional data (15 characters) to line 1 and fills line 2's optional field with `<`.
  Parsing and validation read both optional fields.
* Browser-level testing of the MRZ page controls has not been run in this pass.

Gaps:
* MRZ page controls are now exercised in a browser (`e2e/mrz.spec.ts`, 5/5).
* TD1 generation writes the user's optional data into line 1 only. TD1 line 2 optional positions (19–29) are filled with `<`. This is valid per ICAO Doc 9303 Part 5 because optional data may be empty, but it is a deliberate limitation.

### 3.5 Compliance Tools (`/tools/compliance-documents`)

Page and test exist (`frontend/src/pages/tools/ComplianceDocumentsPage.tsx`,
`frontend/tests/unit/compliance-documents-page.test.tsx`). Controls were not reviewed in this pass.

## 4. Missing or unverified items, by priority

1. Partly done: all 21 tool names and URLs match `salariopay.com/sitemap.xml`. The full live directory (49 entries) is still not captured in a browser, so only the sitemap names are confirmed.
2. Run the PHP catalogue suite in CI for the four new tools (done in code; PHP not run locally).
   Name Checker remains open.
3. (Done) Browser end-to-end tests (Playwright) for the ID-card flow, the business tools and MRZ. All pass locally: business 52/52, ID card 10/10, MRZ 5/5.
4. (Done) TD1 and TD2 MRZ support. MRZ page controls are browser-tested (`e2e/mrz.spec.ts`, config route stubbed).
5. Name Checker: decide the data source and rate-limit policy, or document as unavailable.
6. Staging deployment of the production build and screenshots of the principal flows.
7. PHP suites: run in CI on this branch (not available in this sandbox).

## 5. External dependencies

* DNS and IP lookups use the platform's resolver and RDAP / WHOIS integrations, which need
  outbound network access in production.
* BIN checker: a configured provider; the tool refuses full card numbers.
* Image OCR and reverse image search: operator-configured providers.
* ID-card photo URLs in bulk import: fetched by the user's browser, not the server.
* No employee photos, signatures or contact details are sent to a server by the ID-card generator.

### 3.6 End-to-end test suite (Playwright)

Run: `npm run e2e` (uses `playwright.config.ts`; serves the built frontend with `vite preview` on port 4173). Results: `e2e-results/` and `e2e-report/` are generated and git-ignored.

| Spec | Tests | Result (local, this session) | Scope |
|---|---|---|---|
| `e2e/business-tools.spec.ts` (+ `business-fixtures.ts`) | 52 | 52 passed (run 4) | Every form tool: fixtures per slug, generate, output shown, download contents. |
| `e2e/id-card.spec.ts` | 10 | 10 passed | ID card editor, uploads, exports, bulk import. |
| `e2e/mrz.spec.ts` | 5 | 5 passed | MRZ generator, validator and parser pages; `/api/tools/mrz/config` is stubbed. |

Limits of the E2E suite:
* DNS and IP tools and the Email Verifier are covered by unit and integration tests only. They need the API server with PostgreSQL, which is not part of the E2E run.
* The MRZ config endpoint is stubbed in the browser test. The backend route is covered by the integration tests.
* The Compliance Tools page (`/tools/compliance-documents`) has no E2E test yet.
* Chromium comes from the sandbox, because `npx playwright install` cannot reach the CDN from here. CI must install the browser normally.
* PHP catalogue suites were not run locally (PHP is not installed in this sandbox).
