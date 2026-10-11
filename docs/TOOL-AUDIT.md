# CloudHost247 tool audit

**Date:** 11 October 2026 · **Branch:** `arena/0c896a5b-cloudhost247` · **Commit at time of writing:** see
`git log -1`

This is the repository-wide audit the brief asked for: what tools exist, where they are, what
actually works, what was broken, what was rebuilt, how each claim is verified, and what is still
open. It is written to be checkable — every "verified" line names the command that produces the
result, and every limitation names the reason.

**Nothing here is marked complete because a page loads.** The sections that could not be verified in
this environment (any PHP execution, and HTTPS to resolvers other than Google's) say so explicitly
and say where they can be verified instead.

---

## 1. The finding that shapes everything else: there are three tool surfaces

The repository ships the same tools three times, in three architectures, with three catalogues that
do not agree:

| Surface | Catalogue | Runtime | Served at | Tests |
|---|---|---:|---|---|
| **Standalone tools shell** — `tools/` | 116 tools + 6 curated collections | PHP 7.4–8.2, catalogue-driven (`config/tools.php` → `Engine` → `Guard`/`Net`) | `/tools/<slug>` and `/tools/<collection>` via `tools/index.php` | `tests/tools/run.php` (PHP), `tests/tools/local.test.mjs`, `tests/tools/compliance-tools.test.mjs` |
| **Node platform** — `cloudhost247-node/` | 68 catalogue slugs (13 DNS, 7 IP, 8 network, 10 developer, 4 webmaster, 4 security, 14 productivity, 3 domain, 5 diagnostics) + 21 business tools + MRZ | TypeScript/Fastify service + React SPA | `/api/tools/*`; SPA `/tools/...` | Vitest: `tests/**`, `frontend/tests/**` (unit + integration) |
| **WHMCS addon** — `modules/addons/cloudhost247_tools/` | 79 tool functions | WHMCS addon, one PHP function per tool | The addon's own page inside WHMCS | Covered only indirectly by `tests/modules/run.php` style suites |

Addon inventory:

| Area | Tools |
|---|---:|
| designer | 4 |
| developer | 12 |
| dns | 14 |
| gaming | 1 |
| ip | 18 |
| network | 4 |
| productivity | 16 |
| security | 4 |
| webmaster | 6 |
| **Total** | **79** |

The three sets overlap heavily (DNS lookups, IP tools, hashes, QR, passwords) and none is a superset
of the others: the PHP shell has 116 entries, the app has 68, the addon has 79, and the same
capability can be spelled `dnskey-lookup` (app), `dnskey-lookup` (shell) and *absent* (addon).

**What was done about it:** nothing was merged, because merging is a destructive change to a live
WHMCS deployment and the brief's instruction is to preserve working features and integrate rather
than to refactor the platform. What was done instead:

1. The **app's** catalogue is treated as the addressing authority for the app: `catalog.ts` publishes
   one canonical path per capability and keeps every previous URL in `legacyPaths`, which is why
   `/tools/dnskey-lookup`, `/tools/domain-dns-health` and `/tools/mrz-parser` all resolve.
2. The **shell's** catalogue remains the addressing authority for the PHP surface, and the app's
   paths were aligned to it for nineteen tools (`SERVED_PATH_SLUGS`), so a visitor who lands on
   either surface sees the same tool at the same URL.
3. A navigation link-integrity test now fails the build if the shared registry projects a link that
   no route, catalogue entry or business tool answers — see §6, which is how the last dead link in
   the footer was found.
4. The consolidation itself is recorded as a **blocker for production**, not as done: see §9.

---

## 2. The 21 SalarioPay-named business tools

The brief lists 21 tools by function. They were checked against the live directories rather than
against a category total: the reference site's `sitemap.xml` was fetched and its `/tools/*` URLs
enumerated (5 calculators, 12 generators, 4 comparisons — see
[`docs/independent-rebuild/SALARIOPAY-INVENTORY.md`](independent-rebuild/SALARIOPAY-INVENTORY.md)).
This repository serves all 21, under its own CloudHost247 slugs.

| # | Tool (this repository's name) | Slug | Category | Route | State |
|---:|---|---|---|---|---|
| 1 | PAYE & Net Salary Calculator | `nigeria-paye-net-salary-calculator` | calculators | `/tools/business-tools/nigeria-paye-net-salary-calculator` | complete |
| 2 | Pension Calculator | `nigeria-pension-calculator` | calculators | `…/nigeria-pension-calculator` | complete |
| 3 | VAT Calculator | `nigeria-vat-calculator` | calculators | `…/nigeria-vat-calculator` | complete |
| 4 | Employer Cost Calculator | `nigeria-employer-cost-calculator` | calculators | `…/nigeria-employer-cost-calculator` | complete |
| 5 | EWA ROI Calculator | `earned-wage-access-roi-calculator` | calculators | `…/earned-wage-access-roi-calculator` | complete (assumptions expanded, see below) |
| 6 | Job Description Generator | `job-description-generator` | generators | `…/job-description-generator` | complete |
| 7 | Job Offer Letter Generator | `job-offer-letter-generator` | generators | `…/job-offer-letter-generator` | complete |
| 8 | Official Payslip Generator | `official-payslip-generator` | generators | `…/official-payslip-generator` | complete |
| 9 | NDA Contract Generator | `nda-contract-generator` | generators | `…/nda-contract-generator` | complete |
| 10 | Employment Contract Generator | `employment-contract-generator` | generators | `…/employment-contract-generator` | complete |
| 11 | CV Generator | `cv-generator` | generators | `…/cv-generator` | complete |
| 12 | Business Invoice Generator | `business-invoice-generator` | generators | `…/business-invoice-generator` | complete |
| 13 | Business Card Generator | `business-card-generator` | generators | `…/business-card-generator` | complete |
| 14 | Employee ID Generator | `employee-id-generator` | generators | `…/employee-id-generator` | complete |
| 15 | Employee ID Card Generator | `employee-id-card-generator` | generators | `…/employee-id-card-generator` | complete — [own audit](independent-rebuild/EMPLOYEE-ID-CARD-GENERATOR.md) |
| 16 | Organizational Chart Generator | `organizational-chart-generator` | generators | `…/organizational-chart-generator` | complete |
| 17 | LinkedIn Engagement Assistant | `linkedin-engagement-assistant` | generators | `…/linkedin-engagement-assistant` | complete |
| 18 | Accounting Tool Comparison | `accounting-tool-comparison` | comparisons | `…/accounting-tool-comparison` | complete |
| 19 | Expense Tool Comparison | `expense-tool-comparison` | comparisons | `…/expense-tool-comparison` | complete |
| 20 | HMO Comparison (Nigeria) | `hmo-comparison-nigeria` | comparisons | `…/hmo-comparison-nigeria` | complete |
| 21 | PFA Comparison (Nigeria) | `pfa-comparison-nigeria` | comparisons | `…/pfa-comparison-nigeria` | complete |

Counts are enforced by the suite, not by this table: `BUSINESS_TOOL_COUNTS` is asserted as
5 calculators / 12 generators / 4 comparisons with unique slugs and paths, so a tool silently
changing category fails the build.

### The five calculators

Each one is checked against a worked example calculated independently of the implementation, with
the statutory inputs dated:

| Calculator | Reference case | Result |
|---|---|---|
| PAYE & Net Salary | ₦8,400,000 gross, 2026 bands (₦800k at 0%, ₦2.2m at 15%, ₦9m at 18%), rent relief at 20% capped | monthly PAYE, net, effective rate, band-by-band breakdown |
| Pension | 8% employee / 10% employer on pensionable pay | monthly and annual contributions, both sides |
| VAT | 7.5%, inclusive and exclusive directions | tax, net, gross, government revenue split |
| Employer Cost | salary plus statutory employer items | ₦5,745,000 total at a 1.92× multiplier |
| EWA ROI | 100 staff, ₦3.6m average salary, 20% turnover, 33% replacement cost, 20% reduction | ₦4,752,000 annual saving; ROI undefined at ₦0 cost |

**What the audit changed in this group (this branch):**

- **EWA ROI** now exposes every assumption the brief asks for — workforce size, average salary,
  turnover rate, replacement cost, expected turnover reduction, **adoption across the workforce**,
  **annual programme cost** and **evaluation period (6/12/24/36 months)** — and reports **savings,
  programme cost, net benefit, payback in months and ROI over the chosen period**. Adoption is not
  decoration: savings are credited only to the share of the workforce that uses the advance, so a
  20% expected reduction at 50% adoption is a 10% reduction across the workforce, and the tool says
  so in a warning and in the arithmetic it prints. Payback is reported as
  *cost ÷ (annual saving ÷ 12)* in months, with an explicit warning when it falls outside the
  evaluation period; with a ₦0 programme cost there is nothing to pay back and the tool says that
  rather than printing a zero.
- Every calculator was already honest about zero-cost division (an infinite ROI is not claimed) and
  about its jurisdiction notes; those behaviours are pinned by tests and were left alone.

**Tests:** `cloudhost247-node/tests/unit/business-tools-engines.test.ts` — **196 assertions**, all
passing, including the new adoption, evaluation-period, payback and CSV-report cases.

---

## 3. The MRZ and compliance tools

| Item | Route | Implementation | Verification |
|---|---|---|---|
| MRZ Generator / Calculator | `/tools/mrz-generator` (app), `/tools/business-tools/mrz-generator`, retained `/tools/document/mrz` | `src/tools/mrz/mrz-engine.ts` | 68 Vitest assertions (engine, API, catalogue, SPA routing) + `tests/tools/mrz-crosscheck.py` |
| MRZ Parser | `/tools/mrz-parser`, `/tools/business-tools/mrz-parser` | same engine, parser tab | as above |
| MRZ (PHP shell) | `/tools/mrz-generator` | browser-only handler `mrz_generate` in `templates/cloudhost247/js/tools-local.js` | `tests/tools/local.test.mjs` |
| Compliance & Document Tools collection | `/tools/compliance-documents` (both surfaces) | PHP collection hub; **new** SPA hub page | `tests/integration/navigation-links.test.ts` |

The MRZ work is verified against the ICAO Doc 9303 specimens with an independent implementation:

```
$ python3 tests/tools/mrz-crosscheck.py
TD1 specimen   ok document number printed 7  recomputed 7   … expiry 9, composite 6
TD2 specimen   ok document number printed 7  recomputed 7   … expiry 9, composite 6
TD1 composite over L1[5:30)+L2[0:25) = 0  (the wrong range, must differ from the specimen)
TD1 composite over the ICAO ranges   = 6  (specimen prints 6)
all specimens verified against an independent implementation
```

The check digits, the composite ranges and a deliberately wrong composite range are all covered, so
the tool cannot pass by computing something self-consistent but wrong.

**Claim discipline:** the tools generate and validate MRZ *format*. They state that they do not
authenticate a document, do not verify it with any government system, and are not a substitute for
the issuing authority's own reader. That wording is asserted by the compliance suite
(`tests/tools/compliance-tools.test.mjs`, **72/72 passing**) which also checks that the compliance
pages carry no unsupported "certified"/"approved"/"guaranteed" claims.

---

## 4. The DNS, IP and infrastructure inventory

The brief's checklist was compared against `dnschecker.org/all-tools.php` (fetched: DNS 14, IP 22,
Developer 14, Designer 4, Webmasters 6, Network 4, Cyber Security 4, Productivity 20, Gaming 1).
**Every reference entry maps to at least one tool in `config/tools.php`** — the shell is a superset,
so there is no missing-slug work in this group. What remains is not coverage but *behaviour*, and
that is where the honest status is thinner:

| Category | Tools | Mode | Verification status |
|---|---:|---|---|
| DNS | 25 | server | Static: every handler exists in `Engine::dispatch`. Live: **not run in this environment — no PHP binary.** See §7. |
| IP | 23 | 13 server / 10 local | Static: handler exists / browser handler key exists. Live: as above for the server half. |
| Network | 4 | server | Port and MAC tools; port checks refused for private ranges by `Guard::resolvePublic`. |
| Cybersecurity | 8 | 6 local / 2 server | Crypto work runs on Web Crypto in the browser; the tool text says so. |
| Developer | 22 | 12 server / 10 local | Includes the MRZ, header and OS-fingerprint tools. |
| Productivity | 23 | mostly local | QR generator/scanner, notepad, word count, misc generators. |
| Webmaster | 6 | server | Link analyser, robots, SERP simulator, PageRank (with its "no longer a public metric" wording). |
| Designer | 4 | local | Colour-space conversions, including a Pantone nearest-match that is labelled as an approximation. |
| Gaming | 1 | local | Minecraft colour codes. |

### What was verified about the network layer without PHP

The resolvers and the request shape are real, and the failure modes are honest. The shell uses
DNS-over-HTTPS JSON (`Accept: application/dns-json`) against a provider list, falling back through
providers and reporting the first that answers, with `elapsedMs` and the resolver name attached to
the result:

- **Google Public DNS answered a live query from this environment** —
  `https://dns.google/resolve?name=example.com&type=A` returned HTTP 200, RCODE 0,
  `A=172.66.147.243,104.20.23.154` — which is the exact URL shape, header and JSON field mapping
  (`Answer[].name/type/TTL/data`) that `Net::doh()` parses.
- **Cloudflare, Quad9, OpenDNS and AdGuard resolve** (public addresses returned from 8.8.8.8) but
  their HTTPS endpoints are **blocked from this sandbox** (TLS reset before handshake). That is an
  environment limitation, not a code defect, and it is exactly the case the code is written for: the
  provider loop moves on and, if every provider fails, the tool returns the transport error instead
  of inventing an answer. **Verification of these four belongs in staging**, where egress is open.
- `ipwho.is` and `rdap.org` — the two external HTTP APIs the IP-location and WHOIS tools call —
  resolve from here; their HTTPS is blocked from this sandbox for the same reason.

Dependency and abuse posture read from the code, not assumed:

- `Guard::resolvePublic()` refuses private, loopback, link-local, CGNAT, multicast, documentation and
  IPv6 ULA/link-local destinations, and logs `ssrf-block`.
- `Net::curl()` pins the TLS-verified connection to the resolved address with `CURLOPT_RESOLVE`,
  disables redirect following, restricts protocols to HTTP/HTTPS and caps the body at 512 KB;
  TLS verification is on and host verification is `2`.
- `Guard::rateLimit()` is per client IP and per slug, 30/minute by default and 8/minute for the
  expensive handlers — the resolver sweeps (DNS checker, propagation, DNS health, IPv6
  compatibility), the many-query blacklist checks (IP and email), the crawlers that fetch every link
  on a page (broken links, link analyser) and, since this pass, every handler that opens a raw socket
  or a TLS session to a host the visitor names (ping, traceroute, port, SMTP, SSL). It returns HTTP
  429 with a plain message and a `Retry-After` header.
- Every server tool passes that limiter because it passes `Engine::run()`, and `Engine::dispatch()`
  is private: a new test fails if any file under `tools/` reaches the dispatcher another way.
- `tools/api.php` now meters its own three bulk operations (`catalog`, `speed`, `upload`) on the same
  counter store. They never reach `Engine::run()` — `speed` streams two megabytes of fresh random
  bytes and `upload` reads two megabytes off the wire per request — so before this they were the only
  unmetered way to spend the host's bandwidth.
- `Net::tcp()`, `Net::readBanner()` and `Net::certificate()` refuse a non-public address themselves
  and log `ssrf-block`, instead of trusting the caller to have resolved the name through
  `Guard::resolvePublic()` first. Every current call site does resolve first; this is the second lock
  on the same door, next to the `socket()` call, so a future caller cannot reopen it by omission.
- Port probing is limited to one public address and one port per request, with the public-address
  rule enforced first; SMTP is limited to ports 25, 465 and 587 and sends no credentials.
- Correction to an earlier note in this audit: `Engine::ssl`, `Engine::port` and `Engine::smtp` were
  described here as missing a rate limit. They were not — the limiter sits in `Engine::run()`, above
  the dispatcher, and always covered them. What was wrong was their *tier*: opening a socket to a
  third-party host cost the same 30/minute as a pure calculation. That is what this pass changed.

---

## 5. What was found broken, and what was fixed

Every item below was found by reading or running the code, not by looking at a page.

| # | Defect | Impact | Fix | Regression test |
|---:|---|---|---|---|
| 1 | ID-card text was shortened to fit and then drawn at the size it was measured at | Values printed over the next column; the fitted width was never applied | `fitText` shrinks before dropping words; all 17 call sites use `fitOp()` and the fitted size | `employee-id-card.test.ts` "prints the employee ID, email and emergency contact in full on …" (24 combinations) |
| 2 | The QR's opaque plate was painted over field rows, photo frames and the "EMPLOYEE ID" caption on four templates | Those fields were simply absent from the printed card | Four layouts re-placed | "prints nothing on top of text or a photograph on …" (24 combinations) |
| 3 | Code 128 could print below a scanable module width | Unreadable barcode on the back of some templates | Full-width symbol above the footer, `MIN_CODE128_MODULE_PX = 2.5`, warning instead of a dense print | barcode read-back per template + density case |
| 4 | The ID-card QR payload was a decorative sentence | A scanner would read prose, not an identifier | Payload is the employee ID, or `NAME:<name>` | payload tests |
| 5 | `/tools/compliance-documents` was in the registry footer with no route in the app | Clicking a footer link showed "Tool not found" | New SPA hub page, entries resolved against the live catalogue | `navigation-links.test.ts` (5 tests) |
| 6 | The QR scanner could only read an uploaded image | The brief's camera requirement was unmet | Camera capture with permission handling, one shared decoder, honest refusal states | local.test.mjs frame decoder driven with real QR pixels |
| 7 | EWA ROI did not expose adoption, evaluation period or payback | Three of the brief's required assumptions and one required output were missing | Added, with the arithmetic printed and warnings when a result is unfavourable | 7 new assertions |
| 8 | No test asserted that navigation links resolve | Dead links could ship unnoticed (and one did) | Link-integrity test over the whole registry projection | `navigation-links.test.ts` |
| 9 | **All twenty-one business tools and the compliance hub were served with HTTP 404** (`X-Robots-Tag: noindex`, SPA shell inside) | The pages rendered perfectly in a browser while every crawler, uptime check and link checker was told the URL did not exist — invisible in a renderer test, and exactly the kind of "the page loads so the route is fine" assumption the brief warns about | `resolveToolPage()` now resolves the business-tool paths and the collection hub, so the not-found handler serves them with 200 and their own titles; a genuinely unknown `/tools/...` URL still 404s and an API path still answers JSON | `tool-page-status.test.ts` — asks the built app over HTTP for the catalogue, the categories, the hub, all twenty-one business tools, a bogus tools URL and a bogus API path |
| 10 | The three bulk operations of `tools/api.php` were unmetered, and `Engine`'s socket-opening handlers shared the cheap tier with pure calculators | A loop against `?op=speed` could pull ~2 MB of fresh random bytes per request with nothing counting, and probing a third party's port cost the same allowance as a base64 conversion | The three operations carry explicit per-minute limits (catalogue 60, speed 12, upload 12) answered with 429 + `Retry-After`; ping, traceroute, port, SMTP and SSL moved to the 8/minute tier; `Net`'s socket helpers refuse non-public targets themselves | `tests/tools/test_static.py` `ToolsEngineHardeningStaticTests` (6 tests, and each one was checked to fail when its guard is removed) |

### Earlier work in this branch that this audit relies on

The Employee ID Card Generator was rebuilt end to end (twelve templates, eight presets plus four
custom colours, live front/back preview, QR and Code 128, PDF/PNG/JPG/SVG, CSV and XLSX bulk with a
rejected-row report, local-only privacy). Its own document —
[`docs/independent-rebuild/EMPLOYEE-ID-CARD-GENERATOR.md`](independent-rebuild/EMPLOYEE-ID-CARD-GENERATOR.md) —
records the contract, the defects and the verification in full, including the honest statement that
a QR containing a URL is a link and not a verification service.

---

## 6. Test inventory and how to reproduce every claim

| Suite | Command | Result on this branch |
|---|---|---|
| Business tools engines (21 tools) | `cd cloudhost247-node && npx vitest run tests/unit/business-tools-engines.test.ts` | **196 passed** |
| Employee ID Card engine + page | `npx vitest run tests/unit/employee-id-card.test.ts frontend/tests/unit/id-card-generator-page.test.tsx` | **72 + 13 passed** |
| Navigation link integrity | `npx vitest run tests/integration/navigation-links.test.ts` | **5 passed** |
| Tool page HTTP status | `npx vitest run tests/integration/tool-page-status.test.ts` | **6 passed** (and re-checked against the running preview server: 200 with the right titles) |
| Tools engine hardening | `python3 -m unittest tests.tools.test_static` | **26 passed** (20 pre-existing + 6 new hardening invariants) |
| Whole Vitest suite | `npm test` | **143 files, 1 999 assertions, 0 failed, exit 0** — 29.6 minutes, on the tree that carries the ID-card rebuild, the EWA assumptions, the QR camera and the navigation work; the four commits after it touch only the tests and routes listed in the rows above, which were re-run individually (404 + 5 + 5 assertions) |
| Browser-only PHP tools | `node --test tests/tools/local.test.mjs` | **1 passed** (all assertions, incl. the QR frame decoder) |
| Compliance wording | `node --test tests/tools/compliance-tools.test.mjs` | **72 passed** |
| MRZ cross-check | `python3 tests/tools/mrz-crosscheck.py` | **all specimens verified** |
| PHP shell (catalogue, engine, DNS wire client, security) | `php tests/tools/run.php` | **not run here — no PHP binary in this environment**; runs in CI and in staging |
| Type check | `npx tsc -p tsconfig.json --noEmit` | clean |
| Production build | `npm run build` | **exit 0** — `tools:catalog:check`, `tsc`, the SPA bundle and the embeddable tools library all built |
| Branding audit | `python3 scripts/branding-audit.py` | **PASSED** — 7 440 text files scanned, 0 retired-brand matches |
| Release-candidate gate | `bash scripts/release-candidate-check.sh` | registry, content, PHP theme and crawl policy **pass**; stops at `php: No such file or directory` (§7) |
| DNS tool set | `npx vitest run tests/integration/dns-api.test.ts dns-propagation.test.ts tools-api.test.ts` | **52 passed** |
| MRZ tool set | `npx vitest run tests/integration/mrz-tools-api.test.ts mrz-tools-catalogue.test.ts` | **13 passed** (the remaining MRZ coverage is in the SPA-routing and engine suites) |
| Live platform smoke | `npx tsx scripts/tools-preview-server.ts 3000` + the calls in [LIVE-TOOL-VERIFICATION.md](independent-rebuild/LIVE-TOOL-VERIFICATION.md) | **70/70 tools answered in a typed way**; twelve computed verified results; four reported honest dependency failures |

TypeScript type-checking is clean across the whole Node project, including the new page, the
expanded calculator and the new test.

---

## 7. Verification this environment could not complete

These are stated plainly because the alternative — marking them green — is what the brief forbids.

| Item | Why it is blocked here | Where it gets verified |
|---|---|---|
| Any PHP execution (the 116-tool shell, `tests/tools/run.php`, PHP lint) | No PHP binary is installed in this sandbox and the package mirrors are not reachable from it | `independent-foundation.yml` runs PHP 7.4 and 8.2 with the full PHP behaviour suites; the staging host runs the same |
| DNS/IP/WHOIS tools against live resolvers | Sandbox egress: TLS to all resolvers except `dns.google` is reset before the handshake | Staging — the DoH provider loop, the SSRF guard and the rate limiter are all exercised there |
| Full Vitest suite, exact final commit | The full run in §6 finished green (1 999 assertions, 29.6 minutes) on a tree four commits behind the branch tip. Those four commits add two test files, one page, one route and regenerated navigation data; each affected suite was re-run individually and passes, but a single full run naming the tip commit belongs in CI | `npm test` in CI, and `/tmp/full-final.log` in this session |
| Real camera capture | The sandbox has no camera; the decoder is tested with real QR pixels instead | Manual pass on a device — the permission-refusal, no-camera and camera-busy paths are all reachable by denying the prompt |
| Physical scanner hardware | Outside what a test runner can assert | The Downloads section of the ID-card page states the print scale; the decode is verified against `jsqr` |

---

## 8. Deliverables in this branch

| Deliverable | Location |
|---|---|
| This audit | `docs/TOOL-AUDIT.md` |
| Employee ID Card audit and completion record | `docs/independent-rebuild/EMPLOYEE-ID-CARD-GENERATOR.md` |
| Reference-site inventory (SalarioPay 21 tools) | `docs/independent-rebuild/SALARIOPAY-INVENTORY.md` |
| DNS reference inventory and gap analysis | `docs/independent-rebuild/DNS-TOOL-COLLECTION.md` |
| Live tool verification transcript (real API responses) | `docs/independent-rebuild/LIVE-TOOL-VERIFICATION.md` |
| Tool inventory tables (shell, app, addon) | §1 and §4 of this document; the app's catalogue also publishes `/api/tools/catalog` |
| Contact sheets (every ID-card template rendered) | `docs/id-card/template-contact-sheet.png`, `…-portrait.png`, `…-landscape.png` |
| Source and tests | this branch, commits listed by `git log --oneline` |
| Branch state | The branch already carried one earlier commit (`d2badaa`, an ID-card snapshot from 13:48 on the same base) whose tree names the page `EmployeeIdCardPage.tsx` and the engine test `id-card-engine.test.ts`. This session's tree names them `IdCardGeneratorPage.tsx` and `employee-id-card.test.ts` and is the state that has been type-checked, built and run through the suites. The two were **not** content-merged — that would have put two ID-card pages and two engine test files in one tree — so the earlier commit is kept in history by an `ours` merge and the tested tree is what the branch serves. Nothing was deleted from history. |

### External dependencies and their limits

| Dependency | Used by | Behaviour when unavailable |
|---|---|---|
| DNS-over-HTTPS providers (Google, Cloudflare, Quad9, OpenDNS, AdGuard) | every server-side DNS tool | provider loop, then an explicit transport error naming the last failure |
| `ipwho.is`, `rdap.org` | IP location, IP WHOIS, domain WHOIS | error message names the provider; no cached or invented answer |
| Authoritative nameservers (DNS TCP/UDP) | delegation checks | NOT_CHECKED / UNKNOWN, never PASS |
| Web Crypto (`crypto.subtle`) | password hashing, digests, random material | explicit message that the API needs a secure origin |
| Browser camera + `getUserMedia` | QR scanner | the upload path remains; the failure names the reason |
| Browser canvas, `FileReader`, `DecompressionStream` | ID-card preview, uploads, XLSX import | explicit message, never an empty file |

---

## 9. Remaining limitations, and the blockers before production

**Known limitations (with reasons):**

1. **Three parallel tool catalogues** (116 / 68 / 79) as described in §1. Consolidation is a
   product decision that would delete or rewrite a live WHMCS addon; it is not done. The app and the
   shell were aligned so a visitor sees the same URL on both, and the link-integrity test now keeps
   the registry honest.
2. **No PHP runtime here**, so the shell's behaviour is verified by reading code and by the CI jobs,
   not by running it locally.
3. **Sandbox egress** blocks live resolver testing for four of five providers.
4. **Port probing** is deliberately limited to a single public address and a single port per request
   and is rate limited; a real port scanner is not offered and should not be.
5. **The ID card prints at 300 dpi for a card printer**; printing on plain paper needs trimming, and
   the page says so.
6. **Text fitting can still shorten prose** on extreme portrait inputs; identifiers are never
   shortened, and the card warns with the shortened value quoted.

**Blockers that must be cleared before a production deploy (none of them code):**

| # | Blocker | Why it matters | How to clear |
|---:|---|---|---|
| 1 | PHP behaviour suites have not been run against this branch | The 116-tool shell is the largest surface and its tests need PHP | Run `php tests/tools/run.php` and the other PHP suites in CI or staging |
| 2 | Live DNS/IP verification | The brief explicitly forbids reporting simulated results as live measurements | Run the DNS/IP tools from staging against real resolvers |
| 3 | Full Vitest suite result on the final commit | The audit must reflect the shipped tree | `npm test` in CI |
| 4 | Production build | The SPA must build with the new page and route | `npm run build` (run here; see §7) |
| 5 | Manual device pass for the ID card and the QR camera | Camera permission flows and printed output cannot be asserted in a headless runner | A device pass with the checklist in `docs/independent-rebuild/EMPLOYEE-ID-CARD-GENERATOR.md` §10 |
| 6 | Browser QA pass (widths 320–1440, axe accessibility, overflow) | The repository already ships the harness — `tests/tools/browser.cjs` drives Chromium over the built site at eight widths and runs axe; it is not wired into CI and no browser is installed here. `docs/website-rebuild/PASS-2026-10-08.md` §5 already lists it as gated on staging | Run `node tests/tools/browser.cjs` against the staging build (it needs Playwright, `@axe-core/playwright` and `CH247_QA_URL`), then the same for `tests/website/browser.cjs` |

Until those five are cleared, the honest status of this branch is: **the Node platform and the SPA
are verified; the PHP shell is verified structurally and by its existing suites but not executed
here; nothing is deployed to production.**

---

## Appendix A — complete inventory of the standalone tools shell (`config/tools.php`)

116 tools in nine categories plus six curated collections. `Mode` is the catalogue's own field:
`server` handlers run in PHP behind the SSRF guard and the rate limiter; `local` handlers run in the
visitor's browser and the server refuses to execute them at all. Every `server` entry was checked
against `Engine::dispatch()` — there are **no server-mode tools without a handler** — and every
`local` entry was checked against `templates/cloudhost247/js/tools-local.js` — there are **no local
entries without a browser implementation key**.

| # | Tool | Slug | Route | Mode | Handler |
|---:|---|---|---|---|---|
| | **DNS (25)** | | | | |
| 1 | A Record Lookup | `a-record-lookup` | `/tools/a-record-lookup` | server | `dns_lookup` |
| 2 | AAAA Lookup | `aaaa-lookup` | `/tools/aaaa-lookup` | server | `dns_lookup` |
| 3 | CAA Lookup | `caa-lookup` | `/tools/caa-lookup` | server | `dns_lookup` |
| 4 | CNAME Lookup | `cname-lookup` | `/tools/cname-lookup` | server | `dns_lookup` |
| 5 | DKIM Checker | `dkim-checker` | `/tools/dkim-checker` | server | `dkim` |
| 6 | DMARC Checker | `dmarc-checker` | `/tools/dmarc-checker` | server | `dmarc` |
| 7 | DMARC Record Generator | `dmarc-record-generator` | `/tools/dmarc-record-generator` | local | `dmarc_generate` |
| 8 | DNS Checker | `dns-checker` | `/tools/dns-checker` | server | `dns_checker` |
| 9 | DNS Lookup | `dns-lookup` | `/tools/dns-lookup` | server | `dns_lookup` |
| 10 | DNS Propagation | `dns-propagation` | `/tools/dns-propagation` | server | `dns_propagation` |
| 11 | DNS / Domain Configuration Generator | `dns-record-generator` | `/tools/dns-record-generator` | local | `dns_record_generate` |
| 12 | DNSKEY Lookup | `dnskey-lookup` | `/tools/dnskey-lookup` | server | `dns_lookup` |
| 13 | Domain DNS Health Checker | `domain-dns-health` | `/tools/domain-dns-health` | server | `dns_health` |
| 14 | Domain DNS Validation | `domain-dns-validation` | `/tools/domain-dns-validation` | server | `dns_validation` |
| 15 | Domain WHOIS | `domain-whois` | `/tools/domain-whois` | server | `domain_whois` |
| 16 | DS Lookup | `ds-lookup` | `/tools/ds-lookup` | server | `dns_lookup` |
| 17 | MX Lookup | `mx-lookup` | `/tools/mx-lookup` | server | `dns_lookup` |
| 18 | NS Lookup | `ns-lookup` | `/tools/ns-lookup` | server | `dns_lookup` |
| 19 | PTR Lookup | `ptr-lookup` | `/tools/ptr-lookup` | server | `ip_hostname` |
| 20 | Reverse IP Lookup | `reverse-ip-lookup` | `/tools/reverse-ip-lookup` | server | `reverse_ip` |
| 21 | SOA Lookup | `soa-lookup` | `/tools/soa-lookup` | server | `dns_lookup` |
| 22 | SPF Record Checker | `spf-record-checker` | `/tools/spf-record-checker` | server | `spf` |
| 23 | SPF Record Generator | `spf-record-generator` | `/tools/spf-record-generator` | local | `spf_generate` |
| 24 | SRV Lookup | `srv-lookup` | `/tools/srv-lookup` | server | `dns_lookup` |
| 25 | TXT Lookup | `txt-lookup` | `/tools/txt-lookup` | server | `dns_lookup` |
| | **IP (23)** | | | | |
| 26 | Domain to IP | `domain-to-ip` | `/tools/domain-to-ip` | server | `domain_to_ip` |
| 27 | Email Blacklist Checker | `email-blacklist-checker` | `/tools/email-blacklist-checker` | server | `email_blacklist` |
| 28 | IP Blacklist Checker | `ip-blacklist-checker` | `/tools/ip-blacklist-checker` | server | `ip_blacklist` |
| 29 | IP Location Lookup | `ip-location-lookup` | `/tools/ip-location-lookup` | server | `ip_location` |
| 30 | IP Subnet Calculator | `ip-subnet-calculator` | `/tools/ip-subnet-calculator` | local | `subnet` |
| 31 | IP to Decimal | `ip-to-decimal` | `/tools/ip-to-decimal` | local | `ip_decimal` |
| 32 | IP to Hostname | `ip-to-hostname` | `/tools/ip-to-hostname` | server | `ip_hostname` |
| 33 | IP WHOIS | `ip-whois` | `/tools/ip-whois` | server | `ip_whois` |
| 34 | IPv4 to IPv6 | `ipv4-to-ipv6` | `/tools/ipv4-to-ipv6` | local | `ipv4_to_ipv6` |
| 35 | IPv6 CIDR to Range | `ipv6-cidr-to-range` | `/tools/ipv6-cidr-to-range` | local | `ipv6_cidr_range` |
| 36 | IPv6 Compatibility Checker | `ipv6-compatibility-checker` | `/tools/ipv6-compatibility-checker` | server | `ipv6_compat` |
| 37 | IPv6 Compression | `ipv6-compression` | `/tools/ipv6-compression` | local | `ipv6_compress` |
| 38 | IPv6 Expand | `ipv6-expand` | `/tools/ipv6-expand` | local | `ipv6_expand` |
| 39 | IPv6 Range to CIDR | `ipv6-range-to-cidr` | `/tools/ipv6-range-to-cidr` | local | `ipv6_range_cidr` |
| 40 | IPv6 to IPv4 | `ipv6-to-ipv4` | `/tools/ipv6-to-ipv4` | local | `ipv6_to_ipv4` |
| 41 | IPv6 WHOIS | `ipv6-whois` | `/tools/ipv6-whois` | server | `ip_whois` |
| 42 | Local IPv6 Address Generator | `local-ipv6-generator` | `/tools/local-ipv6-generator` | local | `ipv6_ula` |
| 43 | Ping IPv4 | `ping-ipv4` | `/tools/ping-ipv4` | server | `ping` |
| 44 | Ping IPv6 | `ping-ipv6` | `/tools/ping-ipv6` | server | `ping` |
| 45 | Trace Email | `trace-email` | `/tools/trace-email` | local | `trace_email` |
| 46 | Traceroute | `traceroute` | `/tools/traceroute` | server | `traceroute` |
| 47 | What Is My IP | `what-is-my-ip` | `/tools/what-is-my-ip` | server | `my_ip` |
| 48 | What Is My ISP | `what-is-my-isp` | `/tools/what-is-my-isp` | server | `isp` |
| | **Developer (22)** | | | | |
| 49 | Base64 Encoder / Decoder | `base64-generator` | `/tools/base64-generator` | local | `base64` |
| 50 | Binary Translator | `binary-translator` | `/tools/binary-translator` | local | `binary` |
| 51 | Broken Link Checker | `broken-link-checker` | `/tools/broken-link-checker` | server | `broken_links` |
| 52 | Email Verifier | `email-verifier` | `/tools/email-verifier` | server | `email_verify` |
| 53 | .htaccess Redirect Generator | `htaccess-redirect-generator` | `/tools/htaccess-redirect-generator` | local | `htaccess` |
| 54 | HTTP Headers Checker | `http-headers-checker` | `/tools/http-headers-checker` | server | `http_headers` |
| 55 | JSON Beautifier | `json-beautifier` | `/tools/json-beautifier` | local | `json_beautify` |
| 56 | JSON Formatter / Generator | `json-formatter` | `/tools/json-formatter` | local | `json_format` |
| 57 | JSON Minifier | `json-minifier` | `/tools/json-minifier` | local | `json_minify` |
| 58 | JSON Viewer | `json-viewer` | `/tools/json-viewer` | local | `json_view` |
| 59 | MD5 Generator | `md5-generator` | `/tools/md5-generator` | local | `md5` |
| 60 | MRZ Generator | `mrz-generator` | `/tools/mrz-generator` | local | `mrz_generate` |
| 61 | Multi URL Opener | `multi-url-opener` | `/tools/multi-url-opener` | local | `multi_url` |
| 62 | Open Graph Checker | `open-graph-checker` | `/tools/open-graph-checker` | server | `open_graph` |
| 63 | RAID Calculator | `raid-calculator` | `/tools/raid-calculator` | local | `raid` |
| 64 | SMTP Test | `smtp-test` | `/tools/smtp-test` | server | `smtp` |
| 65 | Text to Binary | `text-to-binary` | `/tools/text-to-binary` | local | `text_binary` |
| 66 | Unit & Data Conversion Calculator | `unit-data-converter` | `/tools/unit-data-converter` | local | `unit_data` |
| 67 | Timestamp / Unix Time Calculator | `unix-timestamp-calculator` | `/tools/unix-timestamp-calculator` | local | `unix_timestamp` |
| 68 | URL Rewrite Generator | `url-rewrite-generator` | `/tools/url-rewrite-generator` | local | `rewrite` |
| 69 | UUID Generator | `uuid-generator` | `/tools/uuid-generator` | local | `uuid` |
| 70 | Website Operating System Checker | `website-os-checker` | `/tools/website-os-checker` | server | `server_os` |
| | **Productivity (23)** | | | | |
| 71 | Age & Date Calculator | `age-date-calculator` | `/tools/age-date-calculator` | local | `age_date` |
| 72 | BIMI Checker & Generator | `bimi-checker-generator` | `/tools/bimi-checker-generator` | server | `bimi` |
| 73 | BIN Checker | `bin-checker` | `/tools/bin-checker` | local | `bin` |
| 74 | Credit Card Checker | `credit-card-checker` | `/tools/credit-card-checker` | local | `card` |
| 75 | Date & Duration Calculator | `date-duration-calculator` | `/tools/date-duration-calculator` | local | `date_duration` |
| 76 | Domain Name Search | `domain-name-search` | `/tools/domain-name-search` | server | `domain_search` |
| 77 | Image to Text | `image-to-text` | `/tools/image-to-text` | local | `image_text` |
| 78 | Internet Speed Test | `internet-speed-test` | `/tools/internet-speed-test` | server | `speed` |
| 79 | Invisible Character Generator | `invisible-character-generator` | `/tools/invisible-character-generator` | local | `invisible` |
| 80 | Lorem Ipsum Generator | `lorem-ipsum-generator` | `/tools/lorem-ipsum-generator` | local | `lorem` |
| 81 | Morse Code Translator | `morse-code-translator` | `/tools/morse-code-translator` | local | `morse` |
| 82 | Name Checker | `name-checker` | `/tools/name-checker` | server | `name_check` |
| 83 | Online Notepad | `online-notepad` | `/tools/online-notepad` | local | `notepad` |
| 84 | Percentage & Rate Calculator | `percentage-calculator` | `/tools/percentage-calculator` | local | `percentage` |
| 85 | QR Code Generator | `qr-code-generator` | `/tools/qr-code-generator` | local | `qr_generate` |
| 86 | QR Scanner | `qr-scanner` | `/tools/qr-scanner` | local | `qr_scan` |
| 87 | Reverse Image Search | `reverse-image-search` | `/tools/reverse-image-search` | local | `reverse_image` |
| 88 | ROT13 Encoder/Decoder | `rot13` | `/tools/rot13` | local | `rot13` |
| 89 | Runic Translator | `runic-translator` | `/tools/runic-translator` | local | `runic` |
| 90 | Small Text Generator | `small-text-generator` | `/tools/small-text-generator` | local | `small_text` |
| 91 | Time Card Calculator | `time-card-calculator` | `/tools/time-card-calculator` | local | `timecard` |
| 92 | WiFi QR Scanner | `wifi-qr-scanner` | `/tools/wifi-qr-scanner` | local | `wifi_qr` |
| 93 | Word Counter | `word-counter` | `/tools/word-counter` | local | `word_count` |
| | **Webmaster (6)** | | | | |
| 94 | Google Page Rank Checker | `pagerank-checker` | `/tools/pagerank-checker` | server | `pagerank` |
| 95 | Punycode Converter | `punycode-converter` | `/tools/punycode-converter` | local | `punycode` |
| 96 | Robots.txt Generator | `robots-txt-generator` | `/tools/robots-txt-generator` | local | `robots` |
| 97 | Google SERP Simulator | `serp-simulator` | `/tools/serp-simulator` | local | `serp` |
| 98 | User Agent Checker | `user-agent-checker` | `/tools/user-agent-checker` | local | `user_agent` |
| 99 | Website Link Analyzer | `website-link-analyzer` | `/tools/website-link-analyzer` | server | `link_analyzer` |
| | **Network (4)** | | | | |
| 100 | ASN WHOIS Lookup | `asn-whois-lookup` | `/tools/asn-whois-lookup` | server | `asn` |
| 101 | MAC Address Generator | `mac-address-generator` | `/tools/mac-address-generator` | local | `mac_generate` |
| 102 | MAC Address Lookup | `mac-address-lookup` | `/tools/mac-address-lookup` | local | `mac_lookup` |
| 103 | Port Checker | `port-checker` | `/tools/port-checker` | server | `port` |
| | **Cybersecurity (8)** | | | | |
| 104 | API Key / Token Generator | `api-key-generator` | `/tools/api-key-generator` | local | `api_key_generate` |
| 105 | Checksum / Hash Generator | `checksum-hash-generator` | `/tools/checksum-hash-generator` | local | `checksum_hash` |
| 106 | HTTP Security Headers Generator | `http-security-headers-generator` | `/tools/http-security-headers-generator` | local | `http_security_headers` |
| 107 | Password Encryption | `password-encryption` | `/tools/password-encryption` | local | `password_hash` |
| 108 | Password Policy Generator | `password-policy-generator` | `/tools/password-policy-generator` | local | `password_policy` |
| 109 | Password Strength Checker | `password-strength-checker` | `/tools/password-strength-checker` | local | `password_strength` |
| 110 | Random Password Generator | `random-password-generator` | `/tools/random-password-generator` | local | `password_generate` |
| 111 | SSL Certificate Checker | `ssl-certificate-checker` | `/tools/ssl-certificate-checker` | server | `ssl` |
| | **Designer (4)** | | | | |
| 112 | CMYK to Colortone | `cmyk-to-colortone` | `/tools/cmyk-to-colortone` | local | `color_cmyk` |
| 113 | HEX to Colortone | `hex-to-colortone` | `/tools/hex-to-colortone` | local | `color_hex` |
| 114 | HSV to Colortone | `hsv-to-colortone` | `/tools/hsv-to-colortone` | local | `color_hsv` |
| 115 | RGB to Colortone | `rgb-to-colortone` | `/tools/rgb-to-colortone` | local | `color_rgb` |
| | **Gaming (1)** | | | | |
| 116 | Minecraft Color Codes | `minecraft-color-codes` | `/tools/minecraft-color-codes` | local | `minecraft` |

**Collections (hub pages, not tools):** `compliance-documents` (5 groups, 16 tools),
`business-tools`, and four further curated groups. A collection URL is resolved before the tool
pattern, so a collection can never be shadowed by a tool of the same name.

---

## Appendix B — the Node platform catalogue (68 slugs)

These are the tools the app serves at `/tools/<slug>` and through `/api/tools/*`:

`asn-whois`, `bimi-checker`, `bin-checker`, `broken-links`, `business-tools`, `color-tools`, `dkim-checker`, `dmarc-checker`, `dmarc-generator`, `dns-health`, `dns-lookup`, `dns-propagation`, `dnskey-lookup`, `domain-availability`, `domain-health`, `domain-to-ip`, `ds-lookup`, `email-header`, `encoding-tools`, `http-headers`, `image-ocr`, `invisible-character`, `ip-blacklist`, `ip-converters`, `ip-lookup`, `ip-to-hostname`, `ip-whois`, `isp-lookup`, `json-tools`, `lorem-ipsum`, `mac-generator`, `mac-lookup`, `mrz-generator`, `mx-lookup`, `my-ip`, `notepad`, `open-graph`, `password-tools`, `ping`, `port-checker`, `punycode`, `qr-generator`, `qr-scanner`, `reverse-dns`, `reverse-image-search`, `reverse-ip`, `robots-generator`, `runic-translator`, `serp-simulator`, `server-os`, `small-text`, `smtp-tester`, `speed-test`, `spf-checker`, `ssl-checker`, `subnet-calculator`, `time-card`, `tool-favorites`, `tool-history`, `tool-monitors`, `tool-reports`, `traceroute`, `url-tools`, `user-agent`, `uuid-generator`, `whois`, `wifi-qr`, `word-counter`

Nineteen of them publish the slug the PHP shell serves (`SERVED_PATH_SLUGS`) with the app's own
slug kept in `legacyPaths`, so both surfaces answer the same URL.

---

## Appendix C — commands used to produce this audit

```bash
# Inventory
grep -c "'slug' => '" config/tools.php          # 122 entries: 116 tools + 6 collections
# handler cross-check: every server-mode tool has an Engine::dispatch case, every local-mode tool
# has an implementation key in templates/cloudhost247/js/tools-local.js

# Verification
cd cloudhost247-node
npx tsc -p tsconfig.json --noEmit
npx vitest run tests/unit/business-tools-engines.test.ts
npx vitest run tests/unit/employee-id-card.test.ts frontend/tests/unit/id-card-generator-page.test.tsx
npx vitest run tests/integration/navigation-links.test.ts
npm run build
cd ..
node --test tests/tools/local.test.mjs
node --test tests/tools/compliance-tools.test.mjs
python3 tests/tools/mrz-crosscheck.py
```
