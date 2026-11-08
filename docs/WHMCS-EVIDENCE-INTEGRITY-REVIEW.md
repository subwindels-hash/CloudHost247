# Independent review — WHMCS evidence integrity (C1.9)

**Scope.** An independent review of the controls delivered in C1.5–C1.8, performed against commit `270cda4` and the
changes made during this review. It inspects the implementation, executes the commands, and records what was
*actually observed*. It is not a summary of what the previous milestone claimed.

**Status statement that must survive into any project status report:**

> **Verified locally — not WHMCS-integrated in a live staging environment.**
>
> Tooling, validation gates and evidence controls are implemented and tested. No WHMCS installation has been
> contacted, no product is bound (0 of 59), and all 59 advertised services are `BLOCKED`.

**Method.** Source inspection, the automated suites, and manual adversarial probes run in this environment: a local
TCP listener to prove the readiness probe sends nothing, a mutated snapshot to break the digest chain, and a
credential-laden doctor transcript to attack the redactor. Nothing below is described as live provider verification,
because none was performed.

---

## 1. Readiness diagnostics

Source: `cloudhost247-node/src/whmcs/readiness.ts`; CLI `scripts/whmcs/catalogue-map.ts` → `readiness()`.

| # | Control | Source | Test | Actual result | Limitation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1 | No authenticated request | `assessReadiness` (no HTTP client); `readinessRouteTarget` + `probeRoute` (TCP connect only) | `has no HTTP client, so it cannot issue an authenticated request even by accident` | A local listener was pointed at via `WHMCS_BASE_URL=http://127.0.0.1:<port>`; readiness reported `READY` for the route and the listener logged `bytes_received=0` | Proven by absence of an HTTP client + zero bytes on the wire; a future refactor that imported the client would be caught by the static test | **LOCAL VERIFIED** |
| 1.2 | No secret in output | `assessReadiness`, `renderReadinessReport` | `never puts a credential value in the report` | Ran with a real-looking secret and identifier; `grep` found 0 occurrences in the output | Redaction-by-omission (values never enter the module); does not protect against a caller printing its own env | **LOCAL VERIFIED** |
| 1.3 | Five states reachable | `READINESS_STATES`, `assessReadiness` | `reports ready when …`, `distinguishes MISSING … from an INVALID one`, `separates UNREACHABLE from MISSING …`, `always reports every one of the five states` | All five produced in the suite; `MISSING`, `INVALID`, `UNREACHABLE`, `NOT CHECKED` also observed from the CLI | `NOT CHECKED` also covers "cannot assess here", so it is never a pass | **LOCAL VERIFIED** |
| 1.4 | Invalid URL cannot yield a READY route | `assessReadiness` (route branch keys off the resolved URL) | `distinguishes MISSING configuration from an INVALID one` | `WHMCS_BASE_URL=http://billing.example.com` → `INVALID Install URL`, `NOT CHECKED Network route`, exit 1 | The guarantee is on the report; a caller passing an unrelated probe is ignored by design | **LOCAL VERIFIED** |
| 1.5 | Placeholder credentials rejected | `looksLikePlaceholder` | `flags a placeholder secret as INVALID rather than ready`, `recognises the values people leave behind` | `changeme` → `INVALID Credential delivery channel` with the placeholder reason | Heuristic vocabulary; an unusual placeholder passes (see §4) | **LOCAL VERIFIED** |
| 1.6 | Tampered map fails via the checksum path | `probeTooling` → `readProductMapFile` | `reports a tampered map as invalid rather than reading it anyway`, `treats a checksum-invalid map as INVALID tooling, not as absent` | A copied map with an injected `services` entry became `INVALID`; an unrelated failure mode (absent file) stays `absent` | The CLI has no `--map` override, so the probe is exercised through the module and the default path | **LOCAL VERIFIED** |

**Defects found and fixed during this review** (all were real, all had tests added):

| # | Finding | Impact | Fix |
| --- | --- | --- | --- |
| D1 | `whmcs:readiness` **crashed** on an invalid URL or a short secret: the CLI called `loadWhmcsConfig` unguarded, so the exception escaped before any state was printed | The command's whole purpose is to report `INVALID`; instead the operator got a stack trace | `readinessRouteTarget()` never throws; a null target becomes `NOT CHECKED` and the module reports `INVALID` with the loader's own message |
| D2 | A short secret was attributed to the **Install URL** check, and hid the route and identity lines ("no install URL") | Mis-attribution points the operator at the wrong system | The URL is resolved independently through the newly exported `normalizeBaseUrl`; loader messages are attributed by the variable they name |
| D3 | The synthetic-credential trick used to isolate the URL rules tripped the existing *"no credential anywhere in the source tree"* guard | The guard is valuable; weakening it would have been the wrong fix | Replaced with the exported URL normaliser — the guard was left intact and still passes |

---

## 2. Approval-pack integrity

Source: `cloudhost247-node/src/whmcs/evidence-pack.ts`; CLI `evidence()`; `src/whmcs/mapping-review.ts`.

| # | Control | Source | Test | Actual result | Limitation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1 | Every supported auth format redacted | `redact()` | `redacts JSON, header, env and Basic-auth credential shapes`, `removes credential-shaped pairs even when the value was never supplied as a secret` | A doctor transcript with 10 credential shapes (query `identifier`/`secret`, `Authorization: Basic`, `Authorization: Bearer`, env dump, JSON, `X-Api-Secret`, `?token=`) produced **0 occurrences** of any value; the pack shows `[redacted]` and hosts only | Pattern-based; an exotic encoding (e.g. base64 of a secret in prose) can evade it. The tool also never reads the configured secret into the document, so this is defence in depth | **LOCAL VERIFIED** |
| 2.2 | Missing artifacts cannot read as validated | `buildEvidenceSummary`, `renderEvidencePack` (artifact state) | `cannot report a validated discovery without a validated artifact`, `produces an honest pack when no discovery has ever run` | No artifact → "**none — no discovery run has been captured**"; artifact without validation → "**NOT VALIDATED — this file is not evidence**"; failed validation → "**UNUSABLE**" | A caller could pass a fabricated `validation` object; the CLI always derives it with `validateDiscoveryArtifact` | **LOCAL VERIFIED** |
| 2.3 | Changed artifact invalidates prior evidence | `review.artifactSha256` (mapping-review) vs `discovery.sha256`; `artifactIntegrity` | `invalidates its own evidence when the artifact changed after the review`, `records a consistent digest chain …` | Review recorded `f1bc8b91…`; the snapshot's price was then edited to `4.50`; the pack printed **EVIDENCE INVALIDATED** with both digests and the instruction to re-run `whmcs:review` | Detects change, not authorship: a person who regenerates the review after editing gets a consistent chain (correct — that is a new review) | **LOCAL VERIFIED** |
| 2.4 | Approval stays false until an owner decision | `ownerApproved: false` (literal type), header row, decision table | `never claims an owner approval` | Pack always prints "**owner approval: not recorded — this pack is a request, not an approval**"; JSON carries `ownerApproved: false` | The report's decision table is filled in by the owner, outside this tool; nothing in the codebase records an approval | **LOCAL VERIFIED** |
| 2.5 | A stale proposal cannot be applied to a different install | `buildMappingReview` (`proposalProblem`) | `blocks a proposal written against a different install fingerprint`, `accepts a proposal whose fingerprint matches …` | With a proposal claiming fingerprint `bbbb…` against artifact `aaaa…`: 1 `BLOCKED` with "the proposal records a different install fingerprint …", 58 `NOT INTEGRATED`; 0 verified | Only applies to *proposed* rows; an existing binding is validated against the checksummed snapshot instead | **LOCAL VERIFIED** |
| 2.6 | Evidence generation never modifies bindings | `evidence()` reads the map; no writer | `does not bind anything: an empty map stays empty however good the proposal looks` | `sha256` of `config/whmcs/product-map.json` identical before and after `whmcs:evidence`; map still 0 bindings / 59 dispositions; `whmcs:map -- verify` exit 0 | The pack writes two files of its own (`docs/WHMCS-APPROVAL-PACK.md`, `config/whmcs/approval-pack.json`) and nothing else | **LOCAL VERIFIED** |

**Defect found and fixed during this review:**

| # | Finding | Impact | Fix |
| --- | --- | --- | --- |
| D4 | `whmcs:evidence` **rebuilt the review in-process**, so the digest it compared against was always the current file's. The swap detector could therefore never fire from the CLI — the one path that matters | The control existed but was unreachable in production use; a snapshot edited after review would have shown a clean, consistent chain | `evidence()` now presents the **review on disk** — the document the owner read — and only rebuilds when none exists, saying which it used. Re-verified with the mutated snapshot (§2.3) |

---

## 3. Security boundaries

| # | Boundary | Evidence | Actual result | Status |
| --- | --- | --- | --- | --- |
| 3.1 | Staging credentials never committed | `git grep` for assigned values; `.gitignore`; `whmcs-client` guard | No credential value in any tracked file — only variable names and `…` placeholders in documentation, and a fixture string in a redaction test. `.env` and `.env.*` are ignored (`.env.example` keeps empty values); `keeps no credential anywhere in the source tree` passes | **LOCAL VERIFIED** |
| 3.2 | Read-only discovery cannot invoke write actions | `discovery.ts` (`collectDiscovery`), `client.call(..., {write})` + `assertWriteAllowed` | Discovery issues exactly `GetProductGroups`, `GetProducts`, `GetCurrencies` and (opt-in) `WhmcsDetails`. A test asserts the exact action list and that no `Add*`/`Update*`/`Create*`/`Delete*`/`Module*` action is issued. The client refuses writes unless `WHMCS_MODE=full`, and that refusal is tested | **LOCAL VERIFIED**; the *server-side* role restriction is **STAGING** |
| 3.3 | No customer data collected | Grep of the C1 modules for client/order/invoice/ticket actions | No match in `discovery`, `discovery-validation`, `mapping-review`, `evidence-pack`, `readiness`, `service-register`. The only client lookups in the codebase are in the SSO bridge (B5.1), which stores a WHMCS client id and no profile data, and which is inert without configuration | **LOCAL VERIFIED** for C1 modules |
| 3.4 | No secrets in generated reports | Grep of `docs/WHMCS-*.md` and `config/whmcs/*.json` for `secret/identifier/token/password` + a value | No match. The C1.9 transcript probe left 0 occurrences after redaction | **LOCAL VERIFIED** |
| 3.5 | No production configuration modified | `git diff --name-only` from the branch base | No `.php`, `.tpl`, theme, template or WHMCS `modules/(addons|servers)/` file is touched on this branch. Changes are application code, tests, three application-side migrations (`0086`–`0088`), generated marketing artifacts and documentation | **LOCAL VERIFIED** |
| 3.6 | No payment, checkout, order or provisioning path activated | Product map (0 bindings), orderability tests, `assertWriteAllowed` | 59/59 services `NOT_INTEGRATED`/`BLOCKED`; the orderability endpoint has no bound service to offer; no order, invoice, payment or module action exists in any code path shipped here | **LOCAL VERIFIED** |

---

## 4. Remaining limitations

These are stated because a review that lists only strengths is not a review:

1. **Nothing here is live verification.** No WHMCS installation has been contacted. Every WHMCS interaction in this
   repository ran against a scripted transport. `VERIFIED — READY FOR APPROVAL` will still mean "meets the discovery
   evidence requirements", not "works".
2. **The operator CLI has no automated end-to-end harness.** `scripts/whmcs/catalogue-map.ts` is type-checked and was
   exercised manually during this review, but its behaviour is tested at the module level plus manual probes. D1 and
   D4 were both CLI-level defects that only a manual run exposed; a scripted CLI test would catch the next one.
3. **Readiness has no path override.** `--map` does not exist, so the tampered-map path is proven through
   `probeTooling` rather than through the command.
4. **Redaction is pattern-based.** It covers the formats WHMCS and shell tools actually emit; it is not a proof
   against arbitrary encodings. The stronger guarantee is that configured secret values never enter the pack.
5. **`NOT VERIFIED` is a statement about evidence, not a defect.** Configurable options were not read (B2.3) and no
   provisioning module has ever been exercised; both remain unverifiable locally.
6. **Staging-dependent controls cannot be closed here:** the API role's real permission set, the allow-list, the
   System URL equality, TLS validity from the deployment host, egress routing, and every fact about the actual
   product catalogue.

---

## 5. Verification run (this review)

| Gate | Result |
| --- | --- |
| WHMCS suites | 16 files, **234 tests**, all passing |
| Backend unit (`tests/unit`) | 126 files, **1875 tests** passing (backend 1093 / frontend 782) |
| Readiness + evidence suites | **36 tests** (19 readiness, 17 pack) |
| TypeScript (application) | clean |
| TypeScript (operator scripts) | clean |
| Migrations | 18/2 passing; `validate-migrations.py` **PASS** |
| Static | `check-links.mjs` ✓, `check-malformed-bullets.mjs` 0 findings, `tests.website.test_static` 23 OK |
| Product map | 0 bindings, 59 dispositions, `whmcs:map -- verify` exit 0 |
| Mapping review | 59 `BLOCKED`, 0 verified |

---

## 6. Verdict

| Question | Answer |
| --- | --- |
| Are the readiness and evidence controls implemented as claimed? | Yes — with the four defects above found by this review and fixed |
| Is any of it verified against a live WHMCS installation? | **No** |
| Are products bound? | **No — 0 of 59** |
| Is C2, checkout, payment, migration or provisioning authorised or reachable? | **No** |
| What remains before the next milestone? | The eight staging handoff items (`WHMCS-STAGING-ACCESS-HANDOFF.md`), then the runbook sequence |

**Recommendation.** Stop here. The remaining dependency is access to a staging WHMCS installation, not more local
tooling. Once the handoff items are satisfied through the approved channels, run
`whmcs:readiness` → `doctor` → `discover` → `validate` → `review` → `evidence` and return the pack for review.
