# WHMCS discovery runbook (C1.6)

**Purpose.** The exact, ordered procedure for running discovery against the real WHMCS installation, deciding
whether what came back is trustworthy, and turning it into a product mapping proposal for approval.

**Status vocabulary used here:** `DONE` — implemented and covered by a test that fails if the behaviour is removed.
`BLOCKED` — cannot be done in this repository and states what would unblock it. `NOT STARTED` — not written.

| Item | State | Note |
| --- | --- | --- |
| The commands below | **DONE** | `whmcs:doctor`, `whmcs:discover`, `whmcs:validate`, `whmcs:review`, `whmcs:map -- verify` |
| Snapshot validation gate | **DONE** | `src/whmcs/discovery-validation.ts`, 14 tests |
| Proposal integrity check (install fingerprint) | **DONE** | a proposal from another install blocks every row it touches |
| The run itself | **BLOCKED** | needs §2 |
| Product mapping proposal | **NOT STARTED** | written by a human from the artifact; §7 |
| C2 storefront wiring | **NOT STARTED** | gated on §9 and explicit approval |

**The one rule this runbook exists to protect:** nothing in this procedure binds a product, changes a price, or makes
a page orderable. Discovery produces *evidence*; the review produces a *recommendation*; only a reviewed
`npm run whmcs:map -- bind` changes what the storefront can sell, one service at a time.

---

## 1. What a successful run looks like

| # | Step | Command | Writes | Passes when |
| --- | --- | --- | --- | --- |
| 1 | Preflight | `npm run whmcs:doctor` | nothing | exit 0, three catalogue reads answered, mode is `read-only` |
| 2 | Fix critical preflight failures | — | — | no `FAILED` line in step 1 (see §3) |
| 3 | Capture the catalogue | `npm run whmcs:discover` | `config/whmcs/catalogue-snapshot.json`, `docs/WHMCS-DISCOVERY-REPORT.md` | exit 0, product count > 0, warnings read |
| 4 | Validate the snapshot | `npm run whmcs:validate` | nothing | exit 0 — no critical check failed (§5) |
| 5 | Classify every service | `npm run whmcs:review` | `docs/WHMCS-MAPPING-REVIEW.md`, `config/whmcs/mapping-review.json` | 59 rows, summary adds up to 59, no `FAILED` validation row |
| 6 | Write the proposal | human edit of `config/whmcs/mapping-proposal.json`, then re-run step 5 | proposal + review | every entry's pid appears in the artifact; fingerprint copied from it |
| 7 | Submit for approval | — | — | written approval of the review, per service |

Steps 3–5 are idempotent: re-running them rewrites the same two artifacts from the same installation. Steps 6–7 are
human decisions and cannot be automated away.

---

## 2. What must be in hand before step 1

| # | Item | Why it is needed | Who provides it |
| --- | --- | --- | --- |
| 1 | **WHMCS base URL** — the install root, `https://`, no `/includes/api.php` suffix | Every request is built from it; a pasted endpoint is refused at startup | Install owner |
| 2 | **API identifier + secret** with a **read-only** role (catalogue reads only — no client, order, invoice or payment permissions) | Discovery reads the catalogue and nothing else; the role is the enforcement, not our good intentions | Install owner, via the agreed secure secrets mechanism |
| 3 | **WHMCS version** | So the report can be checked against the version the operator believes is running | Install owner |
| 4 | **System URL** (*Setup → General Settings*) recorded character-for-character | It must equal `WHMCS_BASE_URL` exactly, or SSO hand-offs are refused by design (the `www`/apex mismatch is the common case) | Install owner |

**Credentials are never pasted into chat, a ticket, a commit or a document.** They go into the deployment's environment
(`WHMCS_BASE_URL`, `WHMCS_API_IDENTIFIER`, `WHMCS_API_SECRET`, `WHMCS_MODE=read-only`) through the approved secrets
mechanism. The artifacts and reports written by this procedure contain no secret and no base URL — only a sha256
fingerprint of the URL (tested).

**Staging only.** This runbook is written for a staging installation. Running it against production is a separate
decision with its own authorisation, and it changes nothing here: discovery is read-only either way, but the review of
what it returns is not.

---

## 3. Step 1–2: preflight, and what each failure means

```bash
cd cloudhost247-node
npm run whmcs:doctor
```

Expected shape of a healthy run:

```
WHMCS preflight (read-only)
  base URL      https://billing.staging.example.com
  API endpoint  https://billing.staging.example.com/includes/api.php
  mode          read-only (writes refused)
  MFA for SSO   required (default)
  currencies    1: USD
  product groups 6
  products      23
  SSO origin    NOT VERIFIABLE read-only. …
  client 2FA    NOT VERIFIABLE over the API. …
  registrar     NOT CHECKED here — domain providers are verified in their own phase.
✓ preflight passed: read-only catalogue access works.
```

`doctor` distinguishes three outcomes, and only one of them is a pass:

| Outcome | Exit | Meaning |
| --- | --- | --- |
| `✓ preflight passed` | 0 | All three catalogue reads answered. Continue to step 3. |
| `✗ preflight failed` | 1 | At least one read failed. **Do not continue** — fix §3.1 first. |
| `✗ configuration: …` | 2 | The environment is not set up (missing variable, `http://`, pasted endpoint, short secret). Fix §3.2. |

### 3.1 Critical failures and their causes

| Symptom | Almost always means | Fix |
| --- | --- | --- |
| `FAILED — WHMCS_HTTP_ERROR 403` | The API IP allow-list does not include this server, or the credential is disabled | Add the egress IP under *Setup → Staff Management → API Credentials*, or disable the allow-list for staging |
| `FAILED — WHMCS_HTTP_ERROR 401` / `Invalid API identifier` | Identifier/secret mismatch, or the credential has no role | Re-issue the credential; assign the read-only role |
| `FAILED — WHMCS_HTTP_ERROR 302` | `WHMCS_BASE_URL` points at a redirecting host, or the install has a `/whmcs` subdirectory | Use the canonical install root; the client never follows redirects on purpose |
| `FAILED — WHMCS_MALFORMED_RESPONSE` (HTML body) | `WHMCS_BASE_URL` is a website, not the billing install; or a WAF challenge page answered | Point at the install root and check with the installer |
| `FAILED — WHMCS_API_ERROR` | WHMCS answered `result=error` — usually "Invalid IP" or a missing API role permission | Read the message in the report; adjust the role |
| `FAILED — WHMCS_TIMEOUT` | Network egress blocked, or the installation is very slow | Check egress to the install; retry once (reads retry by design) |
| `FAILED — no products visible to this API role` | The role cannot read products, or every product is hidden from the API | Grant `GetProducts`; hidden-to-API products are a real discovery finding, not an error to work around |
| `FAILED — no currencies configured` | The install has no currencies — a broken installation | Fix in WHMCS before continuing |

### 3.2 Configuration refusals (`exit 2`)

| Message | Meaning |
| --- | --- |
| `WHMCS_BASE_URL is not set` | Nothing is configured; the app answers `configured: false` on its WHMCS routes |
| `must be https` | Plain HTTP is refused so a secret never crosses the wire in clear text |
| `looks like an API endpoint` | `…/includes/api.php` was pasted; give the install root |
| `API secret is too short` | The secret is shorter than the minimum; re-copy it |
| `invalid mode` | `WHMCS_MODE` must be `read-only` or `full`; keep `read-only` until the read path is verified |

**Mode rule.** Leave `WHMCS_MODE=read-only` for the whole of C1. `full` permits write actions to be sent at all; it is
a C3-and-later decision, not a convenience.

---

## 4. Step 3: capture the catalogue

```bash
npm run whmcs:discover
```

It issues exactly `GetProductGroups`, `GetProducts` and `GetCurrencies` — plus `WhmcsDetails` only when
`WHMCS_DISCOVERY_VERSION=1` is set, which is worth doing once so the artifact records the version. A test asserts that
exact action list and that no `Add*`, `Update*`, `Create*`, `Delete*` or `Module*` action is ever issued.

It writes two files and binds nothing:

| File | Contents |
| --- | --- |
| `config/whmcs/catalogue-snapshot.json` | Schema tag, capture time, base-URL **fingerprint**, version, currencies (with the default marked), groups, products (pid, gid, name, description, module, pay type, visibility, per-currency cycles with WHMCS's own price and setup-fee strings), warnings |
| `docs/WHMCS-DISCOVERY-REPORT.md` | The same data as a reviewable report: hidden products, unpriced products, products with no provisioning module, empty groups, currencies with no priced products, missing default currency |

Read the warnings before step 5. A product with **no provisioning module** will be classified `NO PROVISIONING MODULE`
and must not be sold: the customer would be invoiced for something nothing provisions.

---

## 5. Step 4: validate the snapshot

```bash
npm run whmcs:validate        # exit 1 ⇒ the artifact is not evidence; do not review or bind from it
```

The artifact is a committed file, so it can be copied, truncated or left over from an older run. This gate asks a
different question from step 3: *is this file internally consistent enough to classify services against?*

| Check | Type | Critical failure means |
| --- | --- | --- |
| `artifact.is-object` | critical | not JSON we can read |
| `artifact.schema` | critical | written by a different version of this tool — do not mix eras |
| `artifact.retrieved-at` | critical | undatable run; cannot tell staleness |
| `artifact.fingerprint` | critical | cannot tie the artifact to one install (copy from another environment) |
| `currencies.present` / `currencies.codes` / `currencies.unique` | critical | the currency response is unusable or merged |
| `currencies.default` | critical | not exactly one default — every "default currency" price would be a guess |
| `currencies.default-declared` | critical | `defaultCurrency` is not among the reported currencies |
| `groups.unique` | critical | two group responses merged |
| `products.present` | critical | nothing to map |
| `products.unique` | critical | duplicate pid — the review would silently pick one |
| `products.groups` | critical | a product references a group the response did not contain |
| `pricing.cycles` | critical | a cycle that is not a WHMCS billing cycle |
| `pricing.prices` | critical | a price that is not a non-negative numeric string (`0.00` is valid and preserved) |
| `pricing.currencies` | critical | pricing in a currency the install does not report |
| `products.hidden` | warning | hidden products exist — they cannot be sold from `cart.php` |
| `products.module` | warning | products provision nothing — ordering one would invoice for nothing |
| `products.priced` | warning | products have no priced cycle |
| `artifact.warnings` | warning | the run itself flagged something; read it |
| `artifact.version` | warning | the version was not read |

Critical failures are reported **all at once**, not one exit code at a time. A failed validation is not something to
work around: re-run `whmcs:discover` on a clean configuration and investigate.

---

## 6. Step 5: classify every service

```bash
npm run whmcs:review
```

Writes `docs/WHMCS-MAPPING-REVIEW.md` (the document that goes for approval) and
`config/whmcs/mapping-review.json` (the same rows for diffing between runs). It prints the per-state counts and binds
nothing.

Expect **`NOT INTEGRATED` 59** at this point: the artifact exists, nobody has proposed a product yet. That is the
correct, honest output — the opposite (a review full of verified rows nobody wrote) would mean the engine invented
something.

If the artifact fails validation, or the proposal records a different install fingerprint, the affected rows are
`BLOCKED` and the reason appears in the review's blocker list.

---

## 7. Step 6: the proposal

Write `config/whmcs/mapping-proposal.json` **by hand, from the artifact**:

```json
{
  "notes": "proposed by <name> on <date> against the <date> discovery run of <install>",
  "baseUrlFingerprint": "<copy verbatim from config/whmcs/catalogue-snapshot.json>",
  "entries": [
    { "serviceKey": "hosting-business", "productId": 12, "cycles": ["monthly", "annually"], "note": "why this product" }
  ]
}
```

Rules that the tooling enforces and a reviewer must not work around:

1. **The pid must exist in the artifact.** A pid that is not there is `BLOCKED`, never bound.
2. **One pid, one service.** A pid proposed twice blocks both rows — one product cannot be sold as two different pages.
3. **The fingerprint must match the artifact.** A proposal written against another run or another install blocks every
   row it touches. Copy it; never type it from memory.
4. **Cycles are a claim, not a guess.** Omitting `cycles` offers every cycle WHMCS prices for the product. Naming a
   subset binds the page to that subset, and a cycle the product does not price fails closed at orderability time.

Then re-run `npm run whmcs:review` and read the new counts. A row may only read `VERIFIED — READY FOR APPROVAL` when
the product exists, is visible, has a provisioning module and is priced for at least one proposed cycle in the default
currency.

**`VERIFIED — READY FOR APPROVAL` is not production verification.** It means the row meets the discovery evidence
requirements. Nothing has been purchased, ordered, provisioned or charged at that point.

---

## 8. Step 7: the evidence pack

Attach all of the following to the approval request, so the reviewer reads the same bytes the run produced:

| Item | Where |
| --- | --- |
| Doctor output | copy the console block into the request |
| Catalogue artifact | `cloudhost247-node/config/whmcs/catalogue-snapshot.json` |
| Artifact digest | `sha256sum config/whmcs/catalogue-snapshot.json` |
| Discovery report | `docs/WHMCS-DISCOVERY-REPORT.md` |
| Validation result | `npm run whmcs:validate` output |
| Mapping review | `docs/WHMCS-MAPPING-REVIEW.md` |
| Review rows (for diffing) | `cloudhost247-node/config/whmcs/mapping-review.json` |
| Proposal | `cloudhost247-node/config/whmcs/mapping-proposal.json` |
| Map integrity | `npm run whmcs:map -- verify` (must still report 0 bindings) |

---

## 9. Before C2: what a product's existence does **not** prove

Discovery answers "what does WHMCS sell?". It does not answer "can this product be sold on our page, with options,
in the customer's currency, and actually provision?". The following must each be verified separately before C2 is
authorised — **and none of them may be inferred from a product appearing in `GetProducts`**:

| # | Question | Why discovery cannot answer it | How it will be verified |
| --- | --- | --- | --- |
| 1 | **Configurable options** (slice B2.3) | `GetProducts` returns the product, not its option groups, option names, required/optional flags, prices or the `configoption[n]` ids the cart needs | A dedicated read of the option surface, then an order-form test in staging that the cart accepts every option the page renders |
| 2 | **Product-group relationships** | Discovery shows `gid`, but not whether a group is orderable, hidden from the cart, or holds products priced in different currencies | Compare group visibility against `cart.php?gid=` behaviour in staging; a group that renders empty there cannot back a page |
| 3 | **Currency compatibility** | A product may be priced in one currency and not the customer's; WHMCS will fall back or refuse depending on configuration | For each proposed product, price every cycle in each offered currency; a missing price in a currency the page can display is a blocker for that page, not a rounding problem |
| 4 | **Actual provisioning module availability** | `module` names the module a product is configured with — not that the server, module licence, credentials and product mapping actually work | One controlled staging order (explicitly authorised, no live payment) that reaches *pending* and stops; confirming the module invoked the provider and the service appeared |
| 5 | **Orderability end to end** | The public endpoint computes `binding ∩ live product ∩ priced cycles`; it cannot know the cart accepts the combination | Staging cart hand-off per approved service, checking the cart shows the right product, cycle and price |

Until 1–5 are done, pages must keep linking to the existing hand-off and no purchase button may be activated for an
unverified product. **A successful discovery run does not authorise C2; it only produces the input to its review.**

---

## 10. Abort conditions

Stop, revert nothing in WHMCS, and report, if any of these happen:

- `doctor` fails after a credential change that was supposed to fix it — do not iterate on credentials in a loop; the
  next step is a conversation with the install owner, not another attempt.
- The artifact contains a **product the operator does not recognise**, a price that contradicts the live site, or a
  currency nobody expected. That is a finding about the installation, and it belongs in the review, not in a binding.
- The default currency in the artifact differs from the currency the website displays.
- `whmcs:validate` reports a critical failure that re-running `discover` does not clear.
- The System URL and `WHMCS_BASE_URL` cannot be made identical.
- Anyone asks for `WHMCS_MODE=full`, a live payment, a real order, a customer migration or a provisioning action during
  C1. None of those are part of this phase.

---

## 11. What a successful run still does not authorise

- No product is bound. `npm run whmcs:map -- verify` must still report **0 bindings** after this runbook is complete.
- No price is copied into the SPA, no purchase button changes, no checkout is enabled.
- No live payment, no real order, no customer migration, no production provisioning.
- No claim of production certification. The review is evidence about a staging installation at a moment in time.

C2 begins only after the mapping proposal has been reviewed and explicitly approved, service by service.

---

## 12. Current status

| Element | State | Evidence |
| --- | --- | --- |
| Runbook and commands | **DONE** | this document; every command above exists in `scripts/whmcs/catalogue-map.ts` |
| Snapshot validation gate | **DONE** | `src/whmcs/discovery-validation.ts`; 14 tests, every critical check reachable from a fixture |
| Proposal fingerprint integrity | **DONE** | `src/whmcs/mapping-review.ts`; a mismatched fingerprint blocks the rows it touches (3 tests) |
| Operator CLI type-checked | **DONE** | `tsconfig.scripts.json`, `npm run typecheck:scripts` (part of `npm run build`); it previously was not, and four flag handlers were broken |
| The run itself | **BLOCKED** | §2 — staging URL, read-only credential, version, System URL |
| Proposal and approval | **NOT STARTED** | written by a human after the run; §7 |
| C2 wiring | **NOT STARTED** | gated on §9 and explicit approval |
