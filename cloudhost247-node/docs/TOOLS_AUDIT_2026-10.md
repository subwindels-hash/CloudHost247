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
| `npx vitest run` (full suite) | **Pass** — 145 files passed, 1 skipped; 2,009 tests passed, 6 skipped; exit 0 | Takes about 20 minutes on this runner |
| `npm run build` (catalogue check, server, frontend, tools bundle) | Pass | |
| `npm audit --omit=dev --audit-level=high` | Pass — 0 vulnerabilities | |
| PHP suites (`tests/**/run.php`, `php -l`) | **Not run** | PHP is not installed in this sandbox. CI runs them. |
| Browser / end-to-end tests | **Not present** | No Playwright or Cypress setup exists in the repository. |
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

Gaps not verified in this pass: real printed-card scan tests (requires physical scanners),
browser rendering of every template at export resolution, and a browser end-to-end flow.

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
| Minecraft Color Codes (Gaming) | **Missing** | Static reference data. Add a catalogue entry and handler. |
| RAID Calculator (Productivity) | **Missing** | Pure arithmetic (RAID 0/1/5/6/10 capacity and fault tolerance). Add. |
| Local IPv6 Address Generator (IP) | **Missing** | RFC 4193 ULA generation with `crypto.randomBytes`. Add. |
| IPv6 Compatibility Checker (IP) | **Missing** | Needs AAAA lookups through the existing DNS resolver layer. Add. |
| Name Checker (Productivity) | **Missing** | Requires per-platform username probes. Needs a source decision and rate limits before implementation. |
| Google PageRank | **Not implementable** | Google discontinued public PageRank data. Document as unavailable; do not fake results. |
| Credit Card Checker | **Deliberately excluded** | The repository's BIN checker explicitly refuses full card numbers. Keep this boundary; do not add Luhn validation of full PANs. |
| HTACCESS / URL rewrite generator | Covered | Inside `url-tools` (Multi-URL opener, rewrite and .htaccess generators). |
| Email Verifier | **Missing** | No catalogue entry. `email-header` (header analysis) and `smtp-tester` (SMTP test) do not verify mailbox addresses. Add as a separate tool with an honest-dependency statement. |

Why the four "Missing" IP/DNS items were not implemented in this pass: adding a catalogue entry
regenerates `modules/addons/cloudhost247_theme/resources/tools.json`, changes the tool count
asserted by `tests/integration/tools-api.test.ts`, and affects PHP catalogue tests
(`tests/tools/catalogue.php`) that cannot run in this sandbox. These should be added in one
reviewed change with the PHP suite run in CI.

### 3.4 MRZ tools (`/tools/mrz-generator`, `/tools/mrz-parser`)

Verified:
* ICAO Doc 9303 check digits with weights 7, 3, 1 (`MRZ_WEIGHTS`), tested in
  `tests/unit/mrz-engine.test.ts` with valid and corrupted check digits.
* Parsing reports `checkDigitStatus` pass/fail and states that a valid MRZ does not prove a
  document is genuine.
* Routes are registered (`src/routes/mrz-tools.ts`); catalogue and API tests exist
  (`tests/integration/mrz-tools-api.test.ts`, `tests/unit/mrz-tools-catalogue.test.ts`).

Gaps:
* **Only TD3 (passport, 2×44) is implemented.** TD1 (ID cards, 3×30) and TD2 (2×36) are not
  supported. The brief requires supported formats to be stated; the tool currently states TD3 only.
* Visible controls in the MRZ page were not individually exercised in a browser.

### 3.5 Compliance Tools (`/tools/compliance-documents`)

Page and test exist (`frontend/src/pages/tools/ComplianceDocumentsPage.tsx`,
`frontend/tests/unit/compliance-documents-page.test.tsx`). Controls were not reviewed in this pass.

## 4. Missing or unverified items, by priority

1. Capture the full live SalarioPay directory and confirm the 12 generators and 4 comparisons.
2. Add the four missing DNS Checker tools (Minecraft codes, RAID, local IPv6, IPv6 compatibility)
   in one change, with the PHP catalogue suite run in CI.
3. Add browser end-to-end tests (Playwright) for the ID-card flow, the business tools and MRZ.
4. Add TD1 and TD2 MRZ support, or document TD3-only as the supported scope in the UI.
5. Name Checker: decide the data source and rate-limit policy, or document it as unavailable.
6. Staging deployment of the production build and screenshots of the principal flows.
7. PHP suites: run in CI on this branch (not available in this sandbox).

## 5. External dependencies

* DNS and IP lookups use the platform's resolver and RDAP / WHOIS integrations, which need
  outbound network access in production.
* BIN checker: a configured provider; the tool refuses full card numbers.
* Image OCR and reverse image search: operator-configured providers.
* ID-card photo URLs in bulk import: fetched by the user's browser, not the server.
* No employee photos, signatures or contact details are sent to a server by the ID-card generator.
