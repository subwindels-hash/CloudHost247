# Technical debt register

> **Verified locally — not WHMCS-integrated in a live staging environment.**
>
> 0 of 59 products bound · 59 service dispositions (`BLOCKED`) · C2, checkout, payment, customer migration, real orders
> and provisioning are **not authorised**.

One place for work that is known, accepted and deliberately **not** being done now. An entry is here because someone
decided not to fix it yet and can say why — not because it was forgotten. Items that are simply blocked on someone
else (staging access) are in §3, not here.

**Adding an entry.** Give it an ID, say what breaks and what happens if it is never fixed, name the trigger that should
make it urgent, and record where the current mitigation lives. Remove an entry only by closing it with a commit
reference.

---

## 1. Open items

| ID | Area | Debt | Why it matters / risk if left | Current mitigation | Trigger to fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| TD-01 | WHMCS tooling | **No automated end-to-end harness for the operator CLI** (`scripts/whmcs/catalogue-map.ts`). Its behaviour is covered at module level, by static type-checking and by manual probes. | Three real defects (D1 crash on invalid config, D4 evidence self-rebuilding, D5 exit 0 on an unusable snapshot) were each found by running the command by hand. The next CLI-level defect will be found the same way — possibly in staging, possibly by the owner reading a pack. | `tsconfig.scripts.json` is part of `npm run build`, so the script is type-checked; the review and closure reports record the manual probes; `validationVerdict()` centralises the exit decision that D5 was about. | The first time a CLI defect is found after a staging run — or before C2 wiring, whichever comes first. | **Open — accepted residual risk (C1 closure)** |
| TD-02 | Readiness | `whmcs:readiness` has no `--map` / `--register` override; it always probes the default paths. | The tampered-map path is proven through `probeTooling` in tests, not through the command itself. An operator pointing readiness at a copy of a map cannot reproduce that check from the CLI. | `probeTooling()` is unit-tested against a real tampered copy, and `whmcs:map -- verify` accepts `--map` for the same file. | If staging work needs readiness against a non-default map (e.g. a second installation). | **Open — low** |
| TD-03 | Evidence hygiene | Credential redaction is **pattern-based**, not semantic. | An exotic encoding (a secret base64-encoded inside prose, for instance) could survive redaction. | The stronger guarantee is structural: the pack module never receives the configured values except to strip them, and readiness never reads them at all. A test asserts ten credential shapes come out empty. | If a pack is ever produced from a non-WHMCS source of console output. | **Open — accepted** |
| TD-04 | Documentation | The project-wide status sentence is emitted automatically only in the **generated** approval pack. In hand-written documents it is checked by eye. | A future edit could drop the sentence from a hand-maintained document, and a status report would then overstate the integration. | `evidence-pack.ts` emits it with a test; the sentence appears in the integrity review, runbook, handoff, phase report, closure report and README (verified by grep in C1.10). | If a document is added or restructured. | **Open — low** |
| TD-05 | WHMCS configurable options | **B2.3 is not started**: option groups, option names, required flags, prices and the `configoption[n]` ids the cart needs are not read. | Every mapping row reports `configurable options: NOT VERIFIED`. Hosting products that sell options cannot be honestly presented until this lands. | The mapping review and approval pack state the gap in every row rather than fabricating options. | Before C2 presents any product that has configurable options — i.e. before wiring the storefront. | **Open — blocks part of C2** |
| TD-06 | Provisioning capability | **No provisioning module has ever been exercised.** A configured module is a configuration, not a working server. | A product could be approved and bound, then fail to provision for a real customer. | Nothing is bound (0/59), so nothing can be sold that would fail this way. The runbook §9 lists the controlled staging test as a separate authorisation. | Before any binding is approved for a product with a module; the test plan must be written and authorised first. | **Open — blocks order enablement** |
| TD-07 | SSO direction | **B5.2 is not started**: SSO *into* the cart, and the WHMCS → SPA direction. | Only the billing-area hand-off exists. The cart still uses the existing SPA commerce path. | Out of scope by decision, documented in `WHMCS-INTEGRATION.md` §6. | After C2 wiring is approved. | **Open — deferred by decision** |
| TD-08 | Test execution time | The full unit suite takes ~3–5 minutes (126 files, ~1877 tests, isolated workers). | Slower feedback; encourages running a subset and claiming a full pass. | Suites are re-run in full before every commit that touches code; the reports quote the command used. | If CI is introduced for this repository. | **Open — low** |

---

## 2. Closed items (kept for the record)

| ID | Item | Closed by | Note |
| --- | --- | --- | --- |
| TD-C1 | Operator CLI outside TypeScript compilation | `cbed5d6` (C1.6) | `tsconfig.scripts.json` added to `npm run build`; exposing it found four broken flag handlers that would have thrown at runtime |
| TD-C2 | Readiness crashed on invalid configuration (D1) | `bdf32ee` (C1.9) | `readinessRouteTarget()` never throws; states are reported instead |
| TD-C3 | Credential failures mis-attributed to the URL check (D2) | `bdf32ee` (C1.9) | URL resolved independently through the exported `normalizeBaseUrl` |
| TD-C4 | Evidence generator rebuilt the review it was meant to check (D4) | `bdf32ee` (C1.9) | The pack now presents the on-disk review and rebuilds only when none exists |
| TD-C5 | `review`/`evidence` exited 0 on an unusable snapshot (D5) | `36f00eb` (C1.10) | `validationVerdict()` is the shared decision; unusable → exit 1, failed report still written |

---

## 3. Blocked, not debt

These are external dependencies. They are not technical debt and must not be "worked around" locally.

| # | Dependency | Owner | Status |
| --- | --- | --- | --- |
| 1 | Staging WHMCS base URL | Staging owner | **Outstanding** |
| 2 | API identifier (secret) | Staging owner | **Outstanding** |
| 3 | API secret (secret) | Staging owner | **Outstanding** |
| 4 | Read-only API role name | Staging owner | **Outstanding** |
| 5 | WHMCS version | Staging owner | **Outstanding** |
| 6 | System URL, character-for-character | Staging owner | **Outstanding** |
| 7 | Egress IPs for the install's allow-list | Platform operator | **Outstanding** |
| 8 | Named staging owner and named reviewer | Project owner | **Outstanding** |

Details, delivery channels and permissions: [`WHMCS-STAGING-ACCESS-HANDOFF.md`](WHMCS-STAGING-ACCESS-HANDOFF.md).

---

## 4. How this register is kept honest

1. An entry is added only with an owner-visible reason for deferring it, not as a place to hide unfinished work.
2. Closing an entry requires the commit that closed it; entries move to §2 rather than disappearing.
3. Anything that is blocked on an external party belongs in §3, because calling it debt invites someone to "fix" it
   locally — which is exactly how a simulated integration starts.
