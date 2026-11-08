# WHMCS integration — phase report

**Status vocabulary used in this document, and nowhere else:** `DONE` means implemented *and* covered by an automated
test that fails if the behaviour is removed. `BLOCKED` means it cannot be finished here and states exactly what would
unblock it. `NOT STARTED` means it has not been written. Nothing is described as *verified* unless it was exercised
against a live WHMCS installation — which, as of this report, has not happened.

Companion documents: [`WHMCS-INTEGRATION-AUDIT.md`](WHMCS-INTEGRATION-AUDIT.md) (the plan and the audit trail) and
[`WHMCS-INTEGRATION.md`](WHMCS-INTEGRATION.md) (how the pieces work and the rules a change must not break).

---

## 1. Summary

| Phase | Slice | State | Evidence |
| --- | --- | --- | --- |
| Central adapter | B1.1–B1.4 | **DONE** | `src/whmcs/{config,client,errors,schemas,transport}.ts`; covered by the 62 tests shared with catalogue/cart/idempotency/coverage |
| Catalogue normalisation | B2.1 | **DONE** | `src/whmcs/catalogue.ts`; included in the 62 tests above |
| Cart hand-off | B3.1 | **DONE** | `src/whmcs/cart.ts`; included in the 62 tests above |
| Public orderability | B2.4 | **DONE** | `src/whmcs/orderability.ts`, `src/routes/whmcs-public.ts`; 30 tests |
| One identity + SSO | B5.1 | **DONE** | `src/whmcs/sso.ts`, `src/routes/account-whmcs.ts`, migrations `0087`/`0088`; 50 tests |
| Security review | B5.1 follow-up | **DONE** | §4 of this document; `whmcs-sso` unit + integration suites |
| Discovery tooling | C1.1–C1.3 | **DONE** | `scripts/whmcs/catalogue-map.ts` (`doctor`, `discover`, `snapshot`, `bind`, `dispose`, `verify`), `src/whmcs/discovery.ts`; 11 tests |
| Product mapping review | C1.5 / C2.0 | **DONE** | `src/whmcs/mapping-review.ts`, `src/whmcs/service-register.ts`, `npm run whmcs:review`; 27 tests; `docs/WHMCS-MAPPING-REVIEW.md` (59/59 `BLOCKED` — see §6) |
| Discovery readiness | C1.6 | **DONE** | `docs/WHMCS-DISCOVERY-RUNBOOK.md`, `src/whmcs/discovery-validation.ts`, `npm run whmcs:validate`, proposal fingerprint check, `npm run typecheck:scripts`; 18 tests (§7) |
| Approval pack | C1.7 step 6 | **DONE** | `src/whmcs/evidence-pack.ts`, `npm run whmcs:evidence`; 12 tests (§8) |
| **Staging discovery run** | C1.7 | **BLOCKED** | no credentials and no route to a WHMCS installation from this environment (§8.1) |
| **Discovery run against staging** | C1.4 | **BLOCKED** | needs the staging URL and a read-only API credential |
| Verified product mapping | C2.0 | **BLOCKED** | depends on the discovery run; the committed map has 0 bindings and the review classifies 0 services as verified (§6) |
| SPA catalogue wiring | C2 | **NOT STARTED** | gated on a reviewed, verified mapping |
| Unified cart, checkout, payments | C3 | **NOT STARTED** | gated on C2 |
| Provider verification (domains, hosting, SSL) | D | **NOT STARTED** | needs staging providers |

Test inventory for the whole integration: **210 tests across 15 files** (`tests/unit/whmcs-*.test.ts`,
`tests/integration/whmcs-*.test.ts`). Backend unit suite overall: **1069 tests / 62 files**. Frontend unit suite:
**782 tests / 63 files** unchanged.

---

## 2. Phase B2.4 — public orderability endpoint

**Implemented.** `GET /api/v1/whmcs/orderability` and `/:serviceKey`. A service is orderable only when a checksummed
binding exists **and** the product is still live in `GetProducts` and not hidden **and** WHMCS prices one of the
binding's cycles in the requested currency **and** a cart URL can be built for that cycle. Every other outcome is a
named, machine-readable refusal (`NOT_INTEGRATED`, `WHMCS_DISABLED`, `MAP_INVALID`, `PRODUCT_NOT_IN_CATALOGUE`,
`NO_CYCLES_OFFERED`, `CURRENCY_UNAVAILABLE`, `UPSTREAM_UNAVAILABLE`). Catalogue reads are shared through a 60-second
single-flight cache; failures are never cached.

**Tested.** 15 unit + 15 integration tests, including: `-1` cycles absent rather than free; prices returned as the
strings WHMCS sent; hidden or deleted product → not orderable; currency mismatch refused with no fallback; a tampered
map fails closed; `GetProducts` failure degrades to `UPSTREAM_UNAVAILABLE` on **HTTP 200**, never a 500; a request
carrying `pid`, `price`, `orderable` and `force` changes nothing.

**Blocked.** The real payload shapes of the target installation, and the first real binding.

**Evidence.** `tests/unit/whmcs-orderability.test.ts`, `tests/integration/whmcs-orderability-api.test.ts`,
`docs/WHMCS-INTEGRATION.md` §8.

**Honest statement.** With the committed map (0 bindings), every one of the 59 advertised services returns
`NOT_INTEGRATED`. That is the correct answer and the same message the SPA already shows.

---

## 3. Phase B5.1 — one identity and secure session hand-off

**Implemented.** `whmcs_client_links` (migration `0087`) maps one CloudHost247 account to one WHMCS client, unique in
both directions. Linking requires a verified account address and an exact, unambiguous WHMCS email match; it is
idempotent and never overwrites another account's link. A hand-off mints a 60-second single-use `CreateSsoToken` for an
allow-listed destination, returns WHMCS's prepared redirect URL (pinned to the configured origin), and records an audit
row — never the token. MFA is required on the CloudHost247 account before a token exists, because WHMCS redeems a
trusted token without re-prompting for 2FA. Admin support sessions cannot mint hand-offs; unlink requires the account
password.

**Tested.** 32 unit + 18 integration tests. Highlights: a client id placed in the request body is ignored; a foreign
redirect origin is refused with the offending host absent from the response; the minted token does not appear in a
`row_to_json` dump of the hand-off table; a lost race between two link requests for the same account is resolved as the
same link rather than an error; a deleted WHMCS client produces `WHMCS_SSO_LINK_STALE` rather than a generic outage.

**Blocked.** Live compatibility: the `GetClients` shape of the target version, whether the install's System URL matches
`WHMCS_BASE_URL`, and whether customers have SSO enabled (`WHMCS_SSO_BLOCKED`).

**Evidence.** `tests/unit/whmcs-sso.test.ts`, `tests/integration/whmcs-sso-api.test.ts`,
`docs/WHMCS-INTEGRATION.md` §7 and §9.

---

## 4. Security review (closing the four review points)

### 4.1 CSRF

**Control.** Every route on this surface authenticates from an `Authorization: Bearer` header and nothing else;
`authenticate()` never reads a cookie. A browser does not attach that header automatically, so a cross-site form post
carries no identity — there is no ambient credential to ride, which is why no CSRF token is needed.

**Evidence.** Integration test *"cannot be driven by a cross-site request: there is no cookie session to ride"* sends
`POST /api/v1/account/whmcs/sso` with `cookie` (three shapes) and a foreign `origin`, and asserts `401` with **zero**
WHMCS calls. The tokens the SPA stores are in web storage and are sent explicitly by `apiFetch`, not as cookies.

**Residual risk.** If cookie-based session auth is ever added to these routes, CSRF protection becomes mandatory in the
same change. That condition is recorded rather than assumed.

### 4.2 Session fixation

**Control.** The WHMCS session is created from the client id **stored against the authenticated account**; no request
value selects a client, a user, a destination scope or a redirect. There is no inbound SSO direction (WHMCS → SPA), so
there is no attacker-supplied session to adopt.

**Evidence.** The mint test asserts the API call body is exactly `identifier, secret, action, client_id, destination,
responsetype`, `client_id` equals the stored link, and the destination equals the allow-listed scope. A separate test
sends `client_id: 999`, `destination_scope: 'sso:custom_redirect'` and asserts the request still resolves to client
`4242` / `clientarea:invoices`.

### 4.3 Email normalisation and verified addresses

**Control.** Comparisons use a canonical form: Unicode format characters (zero-width, bidi controls) removed, NFKC
normalised, trimmed, lower-cased. On top of that, an address is **only** linkable if it is *already* canonical
(ignoring case); an address that merely *becomes* the billing address after normalisation is refused
(`WHMCS_SSO_EMAIL_NOT_CANONICAL`). Without that rule, NFKC folding would let a look-alike registration collide with
somebody else's WHMCS client. The account address must additionally be verified (`email_verified_at`).

**Evidence.** Unit tests for `normalizeEmail`/`isCanonicalAddress` (full-width and zero-width cases); integration test
*"refuses a look-alike account address…"* registers `ｃｕｓｔｏｍｅｒ＠ｅｘａｍｐｌｅ.com`, gets `409`, and asserts no WHMCS
call was made and no link row exists.

### 4.4 Link ownership and concurrency

**Control.** `users.id` is the primary key of `whmcs_client_links` and `whmcs_client_id` is `UNIQUE`, so "one each way"
is a database constraint, not a check-then-write. The insert handles `23505` by **re-reading**: a row now owned by this
account means the concurrent call was ourselves (idempotent success); a row owned by someone else is a conflict a human
must resolve.

**Evidence.** Unit test *"treats a lost race with itself as the same link"*; integration tests *"never lets one WHMCS
client belong to two accounts"* (staff-assisted pre-link → `409`, no overwrite, one row) and *"survives two
simultaneous link requests for the same account"*.

### 4.5 Rate limiting across multiple application instances

**Finding (fixed in this phase).** The first implementation counted `whmcs_sso_handoffs` rows and then inserted — a
read-then-write, so two instances could both read "9 used" and both proceed. The in-process Fastify limiter could not
help, being per process.

**Control.** Migration `0088` adds `whmcs_sso_rate_limits`, one row per account per fixed 5-minute window, incremented
by a single `INSERT … ON CONFLICT DO UPDATE … RETURNING issued`. The increment and the read are the same statement, so
N instances see 1..N and only the first *limit* are allowed. A refused request still increments, so hammering cannot
reset the budget. Buckets older than a day are pruned per account by the limiter itself. A fixed window can allow up to
2× the limit across a boundary; that is accepted because the authoritative replay control is WHMCS's single-use
60-second token.

**Evidence.** Unit tests assert the SQL is an upsert with `RETURNING issued` and that **no** `SELECT count(*)` is
issued; integration test *"throttles repeated hand-offs for the same account"* asserts 10 allowed then `429`.

### 4.6 Revocation, expiry and logout

See §9 of `docs/WHMCS-INTEGRATION.md` for the full table. Summary:

| Event | Effect | Cannot do |
| --- | --- | --- |
| SPA logout / token revoked | no further hand-offs; `authenticate()` rejects the revoked `jti` | end an already-open WHMCS session |
| Hand-off expiry (60 s) | URL inert; WHMCS rejects reuse | — |
| Unlink (password required) | link row deleted; no further hand-offs | delete the WHMCS client or its invoices |
| WHMCS client deleted | `WHMCS_SSO_LINK_STALE` (`409`) with support wording | auto-repair the link |
| Customer disables SSO in WHMCS | `WHMCS_SSO_BLOCKED` (`409`) | override the customer's choice |
| Account suspended/disabled | `authenticate()` rejects before any WHMCS call | — |

**Explicit limitation, unchanged:** WHMCS exposes no API to terminate a client session. Signing out of CloudHost247
stops *new* hand-offs; an already-open WHMCS session lives until WHMCS expires it or the customer signs out there. Do
not ship copy claiming otherwise.

---

## 5. Phase C1 — discovery tooling (ready to run; run BLOCKED)

**Implemented.**

| Command | Purpose | Writes |
| --- | --- | --- |
| `npm run whmcs:doctor` | Preflight: config, mode, MFA policy, then live `GetCurrencies`/`GetProductGroups`/`GetProducts` counts with pass/fail per check | nothing |
| `npm run whmcs:discover` | Reads the catalogue and writes the two review artifacts | `config/whmcs/catalogue-snapshot.json`, `docs/WHMCS-DISCOVERY-REPORT.md` |
| `npm run whmcs:map -- snapshot` | Writes the checksummed product-map snapshot (the artifact bindings are stamped against) | `config/whmcs/product-map.json` |
| `npm run whmcs:map -- bind …` | Binds one service key to one snapshot product id, refusing ids or cycles the snapshot does not contain | product map |
| `npm run whmcs:map -- verify` | Re-validates checksums, provenance and referential integrity | nothing |

**Read-only by construction.** `collectDiscovery` issues `GetProductGroups`, `GetProducts`, `GetCurrencies` and — only
when `WHMCS_DISCOVERY_VERSION=1` — `WhmcsDetails`. A test asserts the exact action list and that no `Add*`/`Update*`/
`Create*`/`Delete*`/`Module*` action is ever issued.

**What `discover` records per product:** pid, gid, name, description, provisioning module, pay type, visibility, and per
currency the cycles WHMCS offers with its own price and setup-fee strings. It also emits the warnings a reviewer needs:
hidden products, products with no priced cycle, products with **no provisioning module** (ordering one would invoice
for nothing), empty groups, currencies with no priced products, and a missing default currency.

**Tested.** 11 tests against a scripted installation: cycle `-1` absent rather than free; hidden product kept and
flagged; unpriced product reported with `available: false`; no cross-currency fallback; report table escaping; the
artifact contains neither the base URL nor the API secret.

**Blocked.** The run itself — see §10.

---

## 6. Product mapping review (the C2 gate)

This is the deliverable the brief asked for: **every advertised hosting service, with evidence, classified and
recommended — and nothing bound.**

**Implemented.**

| Piece | What it does |
| --- | --- |
| `src/whmcs/service-register.ts` | RFC-4180 reader for `config/whmcs/service-register.csv` (the cross-stack inventory, 59 rows). Quoting, embedded commas, doubled quotes and CRLF are tested; a row without a service key is skipped rather than becoming a phantom service. |
| `src/whmcs/mapping-review.ts` | `classifyService()` decides one row; `buildMappingReview()` builds the whole document; `renderMappingReview()` writes it. It takes a *proposal* as input and returns data — it accepts no path and writes no file, which is why "does not bind" is a test rather than a promise. |
| `npm run whmcs:review` | Writes `docs/WHMCS-MAPPING-REVIEW.md` and `config/whmcs/mapping-review.json`; prints the per-state counts and refuses to imply a binding. |

**The six classifications, checked in this order** (each earlier state invalidates the later questions):

| # | State | Trigger |
| --- | --- | --- |
| 1 | `VERIFIED — READY FOR APPROVAL` | product exists in the discovery artifact, is visible, has a provisioning module, and is priced for at least one proposed cycle in the install's default currency |
| 2 | `NOT INTEGRATED` | the service has no proposal |
| 3 | `NO PROVISIONING MODULE` | the product would invoice for nothing |
| 4 | `NO VALID PRICE` | no proposed cycle is priced in the default currency |
| 5 | `HIDDEN PRODUCT` | hidden in WHMCS, so `cart.php` cannot sell it |
| 6 | `BLOCKED` | no discovery run; a proposal whose pid is absent from the discovery artifact; one pid proposed for two services; a bound pid that has vanished from discovery |

**Each row carries:** service name, service key, website page (SPA route or PHP page), product group, product id,
product name, currencies, monthly and annual price (WHMCS's own strings), available cycles, provisioning module,
visibility, classification, missing dependencies, and the evidence for the verdict. Configurable options are a column
that reads **"not read — slice B2.3"** for every row: the WHMCS options surface has not been read, so the report says so
instead of inventing options.

**Current output — complete, and honestly empty.**

| Classification | Services |
| --- | --- |
| VERIFIED — READY FOR APPROVAL | 0 |
| NOT INTEGRATED | 0 |
| NO PROVISIONING MODULE | 0 |
| NO VALID PRICE | 0 |
| HIDDEN PRODUCT | 0 |
| BLOCKED | 59 |

All 59 rows are `BLOCKED` for one reason: no discovery artifact exists (`config/whmcs/catalogue-snapshot.json`), so
there is no evidence to classify against, and the report says exactly that in each row's *missing dependencies* and
*evidence* cells. The document also lists the repository-level blockers a reviewer must clear first and ends with the
proposal format and the single next action. Nothing is proposed, so nothing is recommended for binding.

**Tested.** 27 tests: all six classifications are reachable from fixtures (an assertion fails if any branch stops being
exercised), the summary is a partition of the register, a bound pid missing from discovery is `BLOCKED` rather than
verified, an empty map stays byte-identical after a review of a proposal that would verify, and the rendered table
escapes pipes.

**Why it cannot flatter the installation.** The proposal file (`config/whmcs/mapping-proposal.json`) does not exist and
is not generated by any command; it is written by hand from the discovery artifact. Without it the engine can only
report `BLOCKED` or `NOT INTEGRATED`. A pid may be proposed only if it appears in the discovery artifact, and it may be
bound only by a separate, reviewed `whmcs:map -- bind`.

**Blocked.** The evidence: same three items as §10. The review is the one artefact that will populate itself the moment
`whmcs:discover` runs against staging.

---

## 7. Phase C1.6 — discovery execution readiness

The reviewer's next step is a run against the real installation, so this phase is about making that run
reproducible and hard to fool: a runbook, a validation gate between capture and review, and an integrity check
that stops a proposal from being applied to the wrong install.

| Piece | State | What it does |
| --- | --- | --- |
| [`WHMCS-DISCOVERY-RUNBOOK.md`](WHMCS-DISCOVERY-RUNBOOK.md) | **DONE** | The ordered procedure: prerequisites and how credentials are delivered, `doctor` failures mapped to their causes, the validation gate, the proposal rules, the evidence pack, abort conditions, and the five C2 questions discovery cannot answer |
| `src/whmcs/discovery-validation.ts` + `npm run whmcs:validate` | **DONE** | Validates a *captured* artifact: schema, provenance, currency set and default, group references, pid uniqueness, billing-cycle names, price strings, currency coverage. Critical failures make the artifact unusable (exit 1); market facts (hidden, unpriced, module-less products) are reported as warnings, not failures |
| Artifact validation inside `whmcs:review` | **DONE** | A review is never built from an artifact that fails validation: every row becomes `BLOCKED` with the reason, and the review carries a *Snapshot validation* table |
| Proposal install-fingerprint check | **DONE** | A proposal whose `baseUrlFingerprint` differs from the artifact blocks every proposed row — a mapping written against another installation cannot silently verify here |
| `npm run typecheck:scripts` (in `npm run build`) | **DONE** | The operator CLI was outside TypeScript's reach; enabling the check found **four broken flag handlers** (`--out`, `--report`, `--json`, `--proposal` referenced an undefined variable and an uncallable `value()`) plus the `import.meta` usage in `help()`. All fixed; the CLI now compiles under the same strict settings as the application |

**Why a validation gate rather than trusting `discover`.** `discovery.ts` controls what is written when a run
succeeds. The artifact is then a committed file that a human can copy, truncate, or leave over from an older run, and
a review built on it would look exactly like evidence. The gate encodes the conditions that cannot be true of a
correct read: two defaults, a price in a currency the install does not have, a product in a group that was not
returned, a cycle that is not a WHMCS cycle, a duplicated pid.

**Tested.** 14 tests on the validator (every critical check reachable from a fixture, `0.00` preserved, all problems
reported in one run) and 4 on the review integration (invalid artifact ⇒ all rows `BLOCKED`; fingerprint mismatch ⇒
proposed rows `BLOCKED`, blocker recorded; matching fingerprint ⇒ `VERIFIED`; validation table rendered only when an
artifact exists).

**What this phase deliberately does not do.** It does not propose products, does not infer a pid from a name, and does
not make the run any less blocked. §10 still lists what is missing.

---

## 8. Phase C1.7 — staging discovery execution (attempted; BLOCKED at step 1)

The instruction was to run the first real discovery against staging. **It could not be executed from this
environment, and nothing was simulated in its place.** What was done instead was to build the one piece of C1.7 that
did not exist yet and that the run needs in order to be reviewable: a generated, sanitised approval pack.

### 8.1 Why the run did not happen

| Check | Result |
| --- | --- |
| `WHMCS_BASE_URL`, `WHMCS_API_IDENTIFIER`, `WHMCS_API_SECRET` in the environment | **none present** (0 variables set; no `.env` file — only `.env.example`) |
| `npm run whmcs:doctor` | `✗ configuration: WHMCS is not connected: … not set`, exit 2 — the documented configuration refusal, not a connectivity failure |
| Staging WHMCS reachable from this build environment | no — this environment has no route to a WHMCS installation, so a "successful" run here would have to be fabricated |

There was nothing to resolve in the sense §3 of the runbook describes: the run stops before the first HTTP request.
Bypassing that — fake credentials, a scripted transport presented as staging, or a hand-written artifact — would
produce exactly the kind of evidence this project has refused at every milestone.

### 8.2 What was delivered instead

| Piece | State | What it does |
| --- | --- | --- |
| `src/whmcs/evidence-pack.ts` + `npm run whmcs:evidence` | **DONE** | Builds the C1.7 step 6 approval pack from the artifacts on disk: provenance (capture time, fingerprint, artifact sha256), measured prerequisites, the doctor transcript, discovery and validation verdicts, the review summary, per-product evidence and per-service evidence |
| Redaction as a property of the tool | **DONE** | Removes configured secret/identifier values, credential-shaped pairs (`identifier=`, `secret=`, `token=`, `Authorization:`), bearer tokens, and reduces absolute URLs to their host — so a captured transcript can be attached without a second review |
| `NOT VERIFIED` is structural | **DONE** | Configurable options and provisioning-module *capability* are printed as `NOT VERIFIED` in every product row; the four owner attestations (staging not production, read-only role, System URL equality, no credential in evidence) are emitted as unticked boxes, never pre-filled |
| `docs/WHMCS-APPROVAL-PACK.md`, `config/whmcs/approval-pack.json` | **DONE (empty, honest)** | The current pack: no artifact, no proposal, 0 bindings, 59 dispositions, every service `BLOCKED`, one pending owner-decision row |

**Tested.** 12 tests: redaction of supplied secrets and of credential-shaped pairs that were never supplied; ordinary
console text left intact; an empty pack that says so instead of rendering a fictional product table; a populated pack
listing group, pid, name, visibility, per-cycle prices, module (`NOT VERIFIED`) and options (`NOT VERIFIED`);
provenance fields; an unusable artifact reported as **NOT USABLE** rather than reviewed; attestations never ticked;
and the JSON form carrying no secret either.

**Why this is C1.7 work and not a substitute for it.** The pack is a *reading* of evidence. With no evidence it says
so, in the same words the runbook uses. It cannot manufacture a discovery run, and the moment one exists it produces
the pack the owner asked for — with the digest of the exact bytes reviewed.

---

## 9. Frontend regression baseline

The 19 pre-existing failures recorded at the previous milestone are **closed: 782/782 frontend unit tests pass across
63 files**. Each was investigated and classified; none was excluded, skipped or silenced.

| # | Failure | Classification | Cause | Fix |
| --- | --- | --- | --- | --- |
| 12 | `marketing-pages.test.tsx` — "renders links with no destination: `/service-plans/catalog/…`" | **Stale generated artifact** (not an app defect) | `SPA_ROUTE_PATTERNS` in `frontend/src/navigation/registry.generated.ts` was generated before the three `/service-plans*` routes were added to `App.tsx`, so the test could not resolve links the router does serve | `node scripts/site/generate.mjs`; 3-line generated diff, no hand edits |
| 1 | `link-integrity.test.ts` — "empty to/href" | **Genuine defect** | `AppErrorBoundary` rendered `<a href="">Refresh page</a>`: an empty target navigates to the current URL and re-triggers the failing render, and it is a dead link | Real `<button type="button" onClick={() => window.location.reload()}>`, which also refetches the failed lazy chunk |
| 1 | `hostinger-chrome.test.tsx` — utility line order | **Genuine UI regression** | A seventh control ("Service plans") was added to the utility line that both this test and `scripts/check-chrome-benchmark.mjs` document as exactly six, with a comment recording that a crowded line is how "Create Account" previously went missing | Removed the extra quick link; `/service-plans` remains reachable from `/services` ("Browse plans"), the catalog pages and the account menu |
| 5 | `hostinger-homepage.test.tsx` | **Environment-triggered real robustness bug** | `element.play().catch(…)` in `PromoVideoHero`: `HTMLMediaElement.play()` returns `undefined` in jsdom (and older webviews), so the `.catch` threw a `TypeError` that took the hero down | Guard the return value before calling `.catch`; behaviour unchanged where `play()` returns a promise |

**Regression status.** After these changes: frontend 782/782, backend unit 1012/1012, and the repo gates
(`scripts/site/check-links.mjs`, `scripts/check-malformed-bullets.mjs`, `python3 -m unittest tests.website.test_static`)
pass. The regenerated navigation artifact was the only generated file touched; its diff is three added route patterns.

---

## 10. What is blocking C1, precisely

1. **Staging WHMCS URL** — the install root, no `/includes/api.php` suffix, https.
2. **Restricted API identifier and secret** — read-only role (catalogue reads only; no client, order or payment
   permissions).
3. **WHMCS version and System URL** — so `doctor` output can be checked against them; the System URL must equal the
   base URL exactly or SSO hand-offs will be refused by design.
4. Supplied through the agreed secure secrets mechanism — never in chat, never in Git.

With those, the sequence is: `npm run whmcs:doctor` → `npm run whmcs:discover` → `npm run whmcs:validate` → review
`docs/WHMCS-DISCOVERY-REPORT.md` → write the proposal → `npm run whmcs:review` → approve the mapping review →
`npm run whmcs:map -- snapshot` → bind services one at a time → `whmcs:map -- verify` → re-run the orderability
endpoint against staging. Each step, its expected output and its abort conditions are in
[`WHMCS-DISCOVERY-RUNBOOK.md`](WHMCS-DISCOVERY-RUNBOOK.md).

---

## 11. What this report does *not* claim

- Not production-ready. No production checkout, live payment, customer migration or real provisioning has been enabled.
- Not verified against any live WHMCS installation. Every WHMCS interaction so far ran against a scripted transport.
- No hosting service is orderable. The committed map has 0 bindings and 59 explicit non-orderable dispositions, and
  the mapping review classifies 0 services as verified (§6) — it is a complete structure with no evidence in it yet.
- The SPA catalogue, cart and checkout are untouched and still the working commerce path.
- SSO is not evidence that cart, checkout, provisioning or invoicing works; those remain separate phases with their own
  evidence requirements.
