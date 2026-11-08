# C1 closure report — final review and staging handoff (C1.10)

> **Verified locally — not WHMCS-integrated in a live staging environment.**
>
> No WHMCS installation has been contacted. No product is bound (0 of 59). All 59 advertised services are `BLOCKED`.
> C2, checkout, payment, customer migration, real orders and provisioning remain **not authorised**.

This is the closure record for the C1 chain (discovery tooling → mapping review → validation → evidence → readiness →
independent review). It reports what was verified, how, and what is still missing. Nothing here is a claim about a
live installation.

---

## 1. Milestones and commits

| # | Milestone | Commit | Accepted on | What it delivered |
| --- | --- | --- | --- | --- |
| C1.5 | Product mapping review | `7179243` | Stakeholder approval | Six-state classifier over the 59-service register, reviewed-document generator, `whmcs:review` |
| C1.6 | Discovery execution readiness | `cbed5d6` | Stakeholder approval | Runbook, `whmcs:validate` snapshot gate, proposal fingerprint integrity, CLI brought under strict TypeScript |
| C1.7 | Evidence-pack generator | `0464fa4` | Stakeholder approval | Sanitised approval pack with provenance; staging run correctly **not** attempted without access |
| C1.8 | Readiness and evidence safeguards | `270cda4` | Stakeholder approval | `whmcs:readiness` (five states, no authenticated request), broader redaction, artifact-swap detection, approval-false guarantee, staging handoff document |
| C1.9 | Independent evidence-integrity review | `bdf32ee` | Stakeholder approval | Control-by-control review; **4 defects found and fixed** (D1–D4) |
| C1.10 | Closure review and staging handoff | this commit | **this report** | Chain verification, documentation consistency, register verification, **1 further defect fixed** (D5) |

---

## 2. Chain verification

Each control was re-checked against the source, the suite and — where a claim was testable — a live probe in this
environment.

| # | Confirmation | How verified | Result |
| --- | --- | --- | --- |
| 1 | Discovery remains read-only | `src/whmcs/discovery.ts` issues `GetProductGroups`, `GetProducts`, `GetCurrencies`, plus `WhmcsDetails` only when `WHMCS_DISCOVERY_VERSION=1`; the test asserts the exact action list and that no `Add*`/`Update*`/`Create*`/`Delete*`/`Module*` action is ever issued | ✅ 4 read actions, no writes |
| 2 | Snapshot validation is mandatory before mapping review | `whmcs:validate` exits 1 on a critical failure; `buildMappingReview` marks **every** row `BLOCKED` when validation fails; `review` and `evidence` now also exit 1 (defect D5, below) | ✅ enforced in-engine **and** signalled to the operator |
| 3 | Proposal fingerprints match the discovery installation | `buildMappingReview` compares `proposal.baseUrlFingerprint` with the artifact's; a mismatch blocks every proposed row | ✅ probed: mismatch → 1 `BLOCKED`, 58 `NOT INTEGRATED`, 0 verified |
| 4 | Evidence SHA-256 values detect artifact changes | `whmcs:review` records the artifact digest; `whmcs:evidence` presents the **on-disk** review and compares | ✅ probed: snapshot edited after review → **EVIDENCE INVALIDATED** with both digests |
| 5 | Approval packs cannot imply owner approval | `ownerApproved: false` is a literal type; header always reads "not recorded — this pack is a request, not an approval" | ✅ no code path can set it |
| 6 | Credential redaction applies to every generated report | Pack redacts transcripts (10 shapes probed → 0 occurrences); readiness prints no values; discovery artifact and review contain neither the base URL nor a secret (asserted by tests) | ✅ all four generators covered |
| 7 | Readiness performs no authenticated requests | No HTTP client is imported by `readiness.ts` (static test); the route probe is a bare TCP connect | ✅ local listener recorded `bytes_received=0` |
| 8 | CLI handles invalid configuration without crashing | `readinessRouteTarget()` never throws; states are reported per prerequisite | ✅ invalid URL → `INVALID`, short secret → `INVALID`, exit 1, no stack trace |
| 9 | Existing review evidence is not silently rebuilt over a changed artifact | `evidence()` reads `config/whmcs/mapping-review.json` and rebuilds only when absent, saying which it used | ✅ verified by probe and code inspection |

### Defect D5 — found by this closure review and fixed

| Field | Detail |
| --- | --- |
| Reproducible defect | With a snapshot that failed validation, `whmcs:review` and `whmcs:evidence` printed a **normal success line and exited 0**. They refused to classify anything (rows `BLOCKED`), but neither the operator nor a pipeline could tell a rejection from a pass — the same class of gap as D4 |
| Fix | `validationVerdict()` in `discovery-validation.ts` is the single decision all three commands use: no artifact → exit 0; usable → exit 0; unusable → **exit 1** with a message naming the critical count. The failed report is still written, so the failure remains investigable (runbook §5) |
| Evidence | Unusable artifact: `review exit=1`, `evidence exit=1`, both printing "artifact FAILED validation (4 critical check(s)) — nothing may be reviewed, approved or bound from it; the report was still written…" |
| Regression test | `gives review and evidence a non-zero verdict for an unusable artifact (C1.10 defect)` |

---

## 3. Documentation consistency

The exact sentence — **Verified locally — not WHMCS-integrated in a live staging environment.** — appears in all five
documents and in the generated pack:

| Document | Where | Verified |
| --- | --- | --- |
| `docs/WHMCS-EVIDENCE-INTEGRITY-REVIEW.md` | opening status block | ✅ |
| `docs/WHMCS-DISCOVERY-RUNBOOK.md` | purpose paragraph | ✅ |
| `docs/WHMCS-STAGING-ACCESS-HANDOFF.md` | rule paragraph | ✅ |
| `docs/WHMCS-APPROVAL-PACK.md` | generated header (emitted by `evidence-pack.ts`, so it cannot be omitted from a future pack) | ✅ |
| `docs/WHMCS-INTEGRATION-REPORT.md` | status banner above §1 | ✅ |
| `docs/README.md` | index status row | ✅ |

---

## 4. Service register verification

| Check | Command | Result |
| --- | --- | --- |
| Product bindings | `product-map.json` → `services` | **0** |
| Service dispositions | `product-map.json` → `unmapped` | **59** |
| Blocked services | `mapping-review.json` → summary | **59 `BLOCKED`**, 0 in every other state |
| Register ↔ review coverage | keys compared both ways | 59 = 59; 0 register keys missing from the review, 0 review keys absent from the register |
| Register ↔ map coverage | union of bindings and dispositions | covers all 59 registered services |
| Nothing orderable without integration evidence | orderability tests; 0 bindings | no service is offered for sale |
| No automatic binding | writes to the map exist only in `snapshot`, `bind`, `dispose` and `dispositions` (explicit commands); `src/whmcs` contains **no** filesystem writes | ✅ |
| No automatic proposal approval | nothing in `src/` or `scripts/` writes `mapping-proposal.json`; only reads | ✅ |
| No product id in the frontend | grep for `pid=<n>` / `productId: <n>` in `frontend/src` | none |

---

## 5. Test totals and commands

Run from `cloudhost247-node` unless stated:

| Suite | Command | Result |
| --- | --- | --- |
| WHMCS integration | `npx vitest run tests/unit/whmcs-*.test.ts tests/integration/whmcs*.test.ts` | **16 files, 236 tests, all passing** |
| Backend + frontend unit | `npx vitest run tests/unit` | **126 files, 1877 tests** (backend 1095, frontend 782) |
| Migrations | `npx vitest run tests/integration/migrate.test.ts tests/integration/migration-quarantine.test.ts` | 2 files, 18 tests passing |
| Migration lint (repo root) | `python3 scripts/validate-migrations.py` | PASS — ordering, uniqueness, additive behaviour, namespace isolation, repeat-execution guards |
| TypeScript (application) | `npx tsc -p tsconfig.json --noEmit` | clean |
| TypeScript (operator scripts) | `tsc -p tsconfig.scripts.json --noEmit` | clean |
| Links (repo root) | `node scripts/site/check-links.mjs` | no broken, placeholder or dangling links |
| Markdown hygiene (repo root) | `node scripts/check-malformed-bullets.mjs` | 0 findings over 6323 files |
| Static site (repo root) | `python3 tests/website/test_static.py` | 23 tests OK |
| Map integrity | `npm run whmcs:map -- verify` | exit 0 — 0 bindings, 59 dispositions |
| Mapping review | `npm run whmcs:review` | 59 `BLOCKED`, exit 0 (no artifact is not an error) |
| Approval pack | `npm run whmcs:evidence` | 0 bindings, `ownerApproved: false`, exit 0 |

---

## 6. Security controls and their test evidence

| Control | Implementation | Test evidence | Status |
| --- | --- | --- | --- |
| Read-only discovery | `discovery.ts`; `assertWriteAllowed` in `config.ts`/`client.ts` | `whmcs-discovery.test.ts` (exact action list); `whmcs-client.test.ts` (write refused in read-only, never retried) | **LOCAL VERIFIED** |
| Snapshot validation gate | `discovery-validation.ts` (14 critical + warning checks) | 15 tests incl. duplicate pid, dangling group, unknown cycle, bad price, unreported currency, multiple defaults | **LOCAL VERIFIED** |
| Unusable artifact is signalled | `validationVerdict()` | D5 regression test + manual probe (exit 1) | **LOCAL VERIFIED** |
| Proposal provenance | fingerprint comparison in `buildMappingReview` | 3 tests (mismatch blocks, match verifies, invalid artifact blocks) | **LOCAL VERIFIED** |
| Evidence digest chain | `review.artifactSha256` vs `discovery.sha256` | 4 tests + manual swap probe | **LOCAL VERIFIED** |
| No implied approval | `ownerApproved: false` literal; pack header/decision table | 1 test + pack inspection | **LOCAL VERIFIED** |
| Credential redaction | `redact()` (auth schemes, quoted/unquoted pairs, JSON, env, headers, URLs→host) | 4 tests + hostile transcript probe (10 shapes → 0 occurrences) | **LOCAL VERIFIED** |
| Secrets never in the source tree | `whmcs-client.test.ts` guard over `src/whmcs` and `src/config` | 1 test (and it caught D3 during C1.9) | **LOCAL VERIFIED** |
| No authenticated readiness request | `readiness.ts` has no HTTP client; `probeRoute` is a TCP connect | 1 static test + listener probe (`bytes_received=0`) | **LOCAL VERIFIED** |
| No customer data in C1 modules | grep of `discovery`, `discovery-validation`, `mapping-review`, `evidence-pack`, `readiness`, `service-register` | no client/order/invoice/ticket action | **LOCAL VERIFIED** |
| SSO hardening (B5.1, unchanged) | `sso.ts`, `routes/account-whmcs.ts`, migration `0088` | 38 tests incl. cross-instance rate limiting, canonical email, bearer-only routes | **LOCAL VERIFIED** |
| **Server-side API role limits** | WHMCS configuration | — | **REQUIRES STAGING** |
| **System URL equality** | WHMCS configuration | — | **REQUIRES STAGING** |
| **TLS validity / egress** | deployment network | — | **REQUIRES STAGING** |

---

## 7. Outstanding staging prerequisites

The eight items from [`WHMCS-STAGING-ACCESS-HANDOFF.md`](WHMCS-STAGING-ACCESS-HANDOFF.md) — all **OUTSTANDING**:

| # | Item | Secret? |
| --- | --- | --- |
| 1 | Staging base URL (install root, `https`) | no |
| 2 | API identifier | **yes** |
| 3 | API secret | **yes** |
| 4 | API role name (read-only) | no |
| 5 | WHMCS version | no |
| 6 | System URL (character-for-character) | no |
| 7 | Egress IPs of the application host | no |
| 8 | Named staging owner and named reviewer | no |

Delivery is through the approved channels only: deployment environment variables (preferred), a `0600` dotenv file on
the staging host, or a secret manager. Never through issues, commits, chat, documentation, screenshots or logs.

---

## 8. Remaining limitations and risks

1. **No live verification of anything WHMCS-side.** Every WHMCS interaction in this repository ran against a scripted
   transport. The first real run can still surprise us — that is the point of the runbook's abort conditions.
2. **The operator CLI has no automated end-to-end harness** — tracked as **TD-01** in
   [`TECHNICAL-DEBT-REGISTER.md`](TECHNICAL-DEBT-REGISTER.md). It is type-checked and was probed manually; D1, D4 and
   D5 were all CLI-level defects found by running it, not by the unit suite. A scripted CLI test remains the obvious
   next hardening step; it is recorded as accepted residual risk and not started, because it is not a blocker for
   staging.
3. **Redaction is pattern-based.** It covers what WHMCS and shell tools actually emit; the stronger guarantee is that
   configured secret values never enter the pack module at all.
4. **Readiness has no `--map` override**, so the tampered-map path is proven through `probeTooling` rather than
   through the command.
5. **`VERIFIED — READY FOR APPROVAL` will still not mean "works".** It means the row meets the discovery evidence
   requirements. Configurable options (slice B2.3) and real provisioning capability remain unverified by design.
6. **Two named gaps outside C1** remain untouched: B2.3 configurable options, and any real module provisioning test.
   The latter requires separate authorisation and a written test plan with rollback — which has not been proposed.

---

## 9. What the next milestone is

The next milestone is **not** a tooling milestone. It is the first real staging discovery, and it begins only when all
eight items in §7 are satisfied through the approved channels. The sequence is the existing runbook:

```bash
npm run whmcs:readiness    # what would stop a run, without sending a request
npm run whmcs:doctor       # read-only preflight against the installation
npm run whmcs:discover     # capture the catalogue
npm run whmcs:validate     # is the captured file evidence at all?
npm run whmcs:review       # classify all 59 services against it
npm run whmcs:evidence     # assemble the pack for the owner
```

Then stop and present the pack. Binding stays a separate reviewed command per service; C2 stays unauthorised.

---

## 10. Closure statement

| Question | Answer |
| --- | --- |
| Is the C1 chain complete as scoped? | **Yes** — C1.5 through C1.10 delivered and reviewed |
| Is it verified locally? | **Yes** — 236 WHMCS tests, 1877 unit tests, all gates green |
| Is it integrated with a live WHMCS installation? | **No** |
| Are products bound? | **No — 0 of 59** |
| Are 59 services correctly blocked rather than falsely orderable? | **Yes** |
| Is C2, checkout, payment, migration or provisioning enabled? | **No** |
| What unblocks the next phase? | The eight staging handoff items (§7) |
| Where is the deferred work recorded? | [`TECHNICAL-DEBT-REGISTER.md`](TECHNICAL-DEBT-REGISTER.md) — 8 open items, 5 closed, external blockers kept separate |

**Recommendation: close C1 here.** No further local milestone should be started unless the staging run exposes a
specific, reproducible defect.
