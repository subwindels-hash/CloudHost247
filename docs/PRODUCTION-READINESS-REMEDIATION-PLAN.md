# Production-readiness remediation plan

**Date:** 2026-11-08<br>
**Status:** Planning only — **not approved for production**.<br>
**Scope:** Fix, integrate and verify existing CloudHost247 functionality. No unrelated feature development or homepage redesign during this phase.

This plan translates `docs/FEATURE-REVIEW-2026-11-08.md` and the subsequent AI-builder investigation into a sequence of **Sessions → Steps → Slices**. A session is a reviewable work package, a step groups related work, and a slice is the smallest independently testable change or investigation. The objective is genuine operation of every advertised launch feature, not simply a green test suite. The numbers are an execution order, **not a time estimate**. The audit results are a historical baseline; re-run them on the current candidate rather than treating the counts as current.

## 1. Non-negotiable launch rules

1. **No simulated operation may be presented as a successful production operation.** A request being accepted, a local record changing, a mock passing, or a provider job being queued is not proof of an upstream outcome. Show `pending`/`in progress` until an authoritative observation establishes the outcome; timeout, unknown or unreachable must not become success.
2. Keep **environment mode** and **operational state** separate. Mode is `demo`, `sandbox` or `production`; availability is `unconfigured`, `operational`, `degraded` or `failed`. Where no recent authoritative observation exists, show **unknown/not checked**, not operational. Operation lifecycle (`pending`, `succeeded`, `failed`, `unknown`) is a third dimension. Do not collapse these into a single optimistic flag.
3. A temporary fail-closed switch is containment, **not implementation or launch approval**. The requested P0 certificate lifecycle and other required integrations must be implemented and independently verified against their actual upstream staging/sandbox services before approval. If a required upstream is unavailable, the gate remains **blocked**; a narrower release scope requires a separate documented business/security decision, not an automatic waiver.
4. All real tests use **isolated staging**, disposable test data and provider sandbox/test accounts; no real customers, production data, live charges, production DNS, production certificates or production credentials. Cleanup is part of each test. Never paste secrets, tokens, private keys, raw payment details or personal data into chat, Git, screenshots or test logs.
5. Work on **one slice at a time**: finish implementation or investigation, tests, documentation, evidence and the designated verification before starting the next slice. If a slice cannot meet its gate, mark it blocked, keep the affected capability fail-closed and stop advancement; do not start another slice or treat containment as completion. Baseline and containment are themselves numbered slices, subject to the same rule.
6. Do not weaken assertions, skip failing tests, disable security checks, alter migration history or change reported status to make a gate green. An intentional test or scope change needs an explained, independently reviewed contract and evidence.
7. Preserve standing product requirements: automatic pinned country, no manual country dropdown, independent language/currency controls, and the existing WIL® footer line. The audit separately flags GeoLite attribution for legal review. Do **not** restore the user-prohibited MaxMind footer text as an ad hoc fix; have the appropriate owner determine a compliant distribution/attribution approach and treat unresolved licensing as a release blocker.

## 2. Baseline and evidence protocol

### Current known findings — to reproduce, not presumed fixed

| Area | Historical or recently observed finding | Initial status |
|---|---|---|
| Database status | `/ready` reported 503 for an unreachable DB while `/api/v1/public/status` reported operational (`cloudhost247-node/src/routes/health.ts`). | P0; reproduce |
| SSL | `cloudhost247-node/src/routes/ssl.ts` changes certificate status/expiry without a CA renewal; real issuance/deployment not verified. | P0; contain and integrate |
| Control panels | `cloudhost247-node/src/control-panels/adapters/base.ts` contains success/health stubs without upstream calls. | P0; trace and contain |
| Tests/types | Audit: 6 Vitest failures, 1 unhandled exception; frontend test TypeScript failures. Backend type-check/build passed at audit time. | P0; re-baseline |
| Dependencies | Audit reported one production high (`ip-address` path) and additional full-tree highs. | P0; re-audit |
| Accessibility | 10 serious contrast failures in the previous browser run (8 marketing, 2 ID-card states). | P1; re-run |
| AI site builder | Demo browser generated a plan but no plan/apply UI appeared: history returns `output`, UI expects `plan`. List-item text was observed truncated to 24 characters; applying can overwrite the home draft without warning; initial engine choice is not carried through. API application and a demo publication worked separately. | P1; reproduce and repair |
| External services | Real provider, CA, payments, licensed WHMCS/cPanel, mail and restoration were not verified. | Blocked until staging is approved |

The earlier full Node run reported 2,343 passed / 6 failed / 6 skipped and one unhandled error; browser run 110 passed / 10 failed. Results may have changed since then. The demo preview uses an in-memory database; its success cannot verify deployment or production provider behavior.

### Evidence required for **every slice**

Record in a per-slice ledger: slice ID; requirement; owner and independent verifier; candidate commit SHA and dirty-tree state; **changed files** (or explicitly none); environment/mode and approved target identifier; preconditions; action and exact redacted command or UI steps; expected and observed outcomes; exit codes; automated test names/results; upstream-side evidence and correlation ID where relevant; negative/failure case; cleanup and rollback; artifact location; **outstanding limitations** and residual risks; decision (`not started`, `in progress`, `blocked`, `failed`, `ready for review`, `verified`). Evidence is immutable or linked to a retained CI run; a later change invalidating it requires re-verification on the new candidate.

Store sanitized small reports and a pointer to restricted logs in the approved evidence location (for example, a new dated subdirectory under `docs/evidence/` only when suitable for Git). Keep provider logs, screenshots with sensitive data, backups, credentials and large artifacts in access-controlled storage outside Git; record hashes and retention/access rules, not raw secrets. Redact without removing the facts necessary to determine what happened. A screenshot or a mock alone is not upstream verification.

**Sign-off:** the implementer attaches evidence; a different qualified reviewer conducts a separate verification pass and records pass/fail and date before the next slice starts. This is mandatory for every critical slice. Security, finance, operations, accessibility, product and legal owners approve their respective gates. Missing independent reviewers, required owners or staging mean **blocked**, never implied approval. Mocked APIs, simulated provider responses and UI demonstrations cannot satisfy real-upstream gates.

## 3. Sessions → Steps → Slices

### Session 0 — Freeze scope, baseline and establish safe staging

**Step 0.1 — Inventory and reproduce**
- **S0.1a:** Inventory enabled routes, provider adapters, SSL, payment and provisioning entry points, including background jobs, admin/API paths, PHP/WHMCS and customer-visible statuses. Identify every call site of the P0 stubs and any other path that reports success without proof. List each operation and responsible owner.
- **S0.1b:** Capture candidate SHA, Node/npm/browser versions, environment mode and baseline outputs. From `cloudhost247-node/`, run `npm ci` in a clean environment, `npx vitest run --maxWorkers=2`, `npm run typecheck`, `npx tsc -p frontend/tsconfig.json --noEmit`, `npm run build`, `npm run e2e`, `npm audit --omit=dev --audit-level=high`, and `npm audit --audit-level=high`. Capture nonzero exit codes and unhandled errors. Use CI's supported Node version and documented Playwright browser configuration; do not assume a test requiring the backend is meaningful against fixture-only Vite preview.
- **S0.1c:** Compare failures against the audit, migration inventory and `.github/workflows/node-platform.yml`; classify new, unchanged and resolved findings, including skips and unhandled exceptions.

**Step 0.2 — Staging preflight**
- **S0.2a:** Prepare an isolated Node/real PostgreSQL environment, licensed WHMCS and cPanel staging, approved CA ACME staging, payment/registrar/DNS/cloud sandboxes, mail sink, test domains, worker/cron and secure evidence store. Validate egress and provider-specific sandbox capabilities. Use `docs/STAGING-ENVIRONMENT-REQUIREMENTS.md` and `docs/RELEASE-WORKFLOW.md` as checklists, but revalidate their historical versions/counts.
- **S0.2b:** Record exact staging targets and ownership, least privilege, non-production markers, budget/spend controls, teardown, timeouts, rollback, fresh backup and restore point. Credentials are configured by authorized operators in a secrets manager, never requested in chat or committed. Use production-like versions and migrations; quarantine stays in place unless separately authorized.

**Gate 0:** Reviewed baseline and dependency graph; staging identity, isolation and cost limits independently verified. Local-only work may be marked verified locally; upstream-dependent work remains blocked until actual services are available. No customer operations enabled.

### Session 1 — P0: truthful database and platform health

**Step 1.1 — Fix and test**
- **S1.1a:** Trace `/health`, `/ready`, `/api/v1/public/status`, DB probe and callers. Fix the false boolean handling; define status mapping for healthy, unreachable, timeout and unknown, including timestamp/freshness and no sensitive diagnostics in public output.
- **S1.1b:** Add regression tests with a real success, false result, rejected query and timeout. Assert `/ready` fails appropriately and public status never calls a failed/unknown DB operational. Test recovery and no stale positive cache.

**Step 1.2 — Verify upstream**
- **S1.2a:** In isolated staging with real PostgreSQL, capture healthy read, safely interrupt DB connectivity and observe endpoint, metrics/alert and recovery. Correlate with an independent DB probe; avoid destructive production-like outage outside the approved window.

**Gate 1:** Negative and recovery tests pass; actual staged outage is accurately surfaced and independently observed. Evidence includes timings, response codes/bodies and redacted monitoring output.

### Session 2 — P0: contain false-success paths and define integration state

**Step 2.1 — Inventory and contain**
- **S2.1a:** Trace SSL creation/renewal and all inherited control-panel create, suspend, unsuspend, terminate, status and health paths through API/UI/workers. List any other fake/simulated success on payment, domain, hosting, VPS and backup routes identified in S0.
- **S2.1b:** Until backed by a verified upstream, return explicit unsupported/unconfigured/failure states, preserve existing records, label demo output and disable actionable production controls. No synthetic active, successful, renewed, healthy, paid or restored status. Fail safely in worker, API and UI, including retries and partially configured modes.

**Step 2.2 — Contract**
- **S2.2a:** Specify mode, integration health, operation lifecycle, verification source, timestamps, correlation IDs and UI/admin representations as separate fields; define timeout, retry, idempotency, reconciliation and authorization behavior. Avoid exposing provider secrets or sensitive diagnostics.
- **S2.2b:** Add contract, unit and integration tests for unconfigured, unsupported, sandbox, upstream rejection/timeout, ambiguous response, success only after observed result, and legacy adapter call paths. Review all callers for misleading success.

**Gate 2:** Independent reviewer demonstrates no contained path reports production success without upstream proof. Containment remains in place until the relevant later integration gate passes.

### Session 3 — P0: real SSL issuance, installation and renewal

**Step 3.1 — Design and fail-safe implementation**
- **S3.1a:** Choose and document an approved CA/ACME staging and production design: supported DNS/HTTP challenge, domain ownership, certificate/key storage and rotation, key access, deployment targets, job/idempotency model, renewal schedule, rollback and audit trail. Do not store private keys in evidence. Explicitly distinguish uploaded certificates from CA-issued certificates; parse and validate actual certificate dates, SANs and chain rather than inventing expiry.
- **S3.1b:** Implement issuance/renewal as asynchronous stateful operations with authoritative CA verification, challenge verification, certificate validation and installation verification. Preserve previous usable certificate and avoid claiming renewal on failed issuance or deployment. Handle challenge expiry, rate limits, provider errors, retry/recovery and permission failures. Keep issuance disabled where CA or installation is not configured.
- **S3.1c:** Add unit/integration coverage for actual certificate parsing, failure cases, idempotency, safe key handling, valid status transitions, no false expiry and owner authorization. Provider mocks prove contracts only.

**Step 3.2 — Real CA staging proof**
- **S3.2a:** With a disposable authorized staging domain, contact the actual CA staging endpoint, complete challenge, issue and install a certificate, and independently verify its chain/issuer, SAN and validity at the target endpoint. Exercise renewal and confirm the new actual certificate, validity and deployment; test challenge/installation failure and recovery without affecting the old certificate.

**Gate 3:** Genuine CA staging issuance **and renewal plus installation** verified by an independent client and upstream evidence. The feature stays blocked otherwise; staged certificates do not prove production CA setup.

### Session 4 — P0: control-panel adapters

**Step 4.1 — Honest adapter implementation**
- **S4.1a:** For each intended panel, document exact supported upstream APIs, permissions and operation mappings. Remove base stub successes; unsupported operations fail explicitly and capability listings must match reality.
- **S4.1b:** Implement selected approved adapters with server-side verification after create/suspend/unsuspend/terminate and actual health queries; handle provider failure, timeout, duplicate calls, idempotency and reconciliation. Preserve audit logs and role checks.
- **S4.1c:** Add provider-contract tests and negative tests covering inherited base methods, invalid credentials, unsupported operations and ambiguous results. Never change a local success state ahead of verified upstream completion.

**Step 4.2 — Real panel proof**
- **S4.2a:** On disposable cPanel/WHM or other approved panel staging, execute each enabled lifecycle operation, independently inspect upstream state, verify failure/permission cases, and clean up the test account. Record each adapter individually; tests for one panel do not certify another.

**Gate 4:** All enabled/required panel operations have evidence for their exact adapter and upstream; others remain unavailable, not successful. Licensed staging remains required.

### Session 5 — P0: test, type-check and supply-chain repair

**Step 5.1 — Failures and unhandled errors**
- **S5.1a:** Reproduce each failing Node test and the unhandled catalog exception individually, then in the complete suite. Review migration `0084_catalog_product_translations.sql` and migration policy before updating any expected count. Distinguish bad fixtures from malformed-response handling defects; correct root causes without hiding errors. Investigate hosting hub/catalog, VPS fetch and design/header assertions against actual intended contracts.
- **S5.1b:** Fix frontend strict TypeScript failures, including the reported footer test lines if still present; run both actual frontend CI and backend checks. Keep all previously passing tests intact and investigate every skip.
- **S5.1c:** Run the entire Vitest suite with zero failures **and zero unhandled errors**, complete build, both type-checks and affected workflows at the candidate SHA. Document skips and obtain owner disposition; do not count skips as passes.

**Step 5.2 — Dependency advisory**
- **S5.2a:** Capture `npm audit` JSON and dependency paths for production and full dependency sets; inspect the high-severity `ip-address` advisory and other current highs, affected/reachable code, exploit conditions and version constraints. Review lockfile and license effects.
- **S5.2b:** Upgrade the direct/transitive dependency through supported versions, or document a specific compensating control, reachability analysis, expiry, responsible security approver and monitoring for any remaining high. Re-run both audits, tests and build; do not use an unreviewed forced breaking upgrade or dismiss an advisory based only on a passing test.

**Gate 5:** CI-equivalent tests/types/build pass with zero unhandled errors; production highs resolved or formally time-bounded and security-approved, with full-tree findings also assessed. Record remaining skips and advisories.

### Session 6 — P1: accessibility and responsive regression

**Step 6.1 — Fix identified contrast**
- **S6.1a:** Re-run the axe marketing and ID-card suites; enumerate each current failing state, selector, foreground/background, contrast ratio and required threshold. Fix shared tokens/components at source (including `.ch-kicker`, plan descriptions and `.ch247-page__hint` if still affected) without masking content or weakening checks.
- **S6.1b:** Add regression coverage for all 10 historical states and any new failures; rerun full browser suite and targeted accessibility scans. Check normal, hover, focus, selected, error and disabled states as applicable.

**Step 6.2 — Human verification**
- **S6.2a:** Independently check keyboard access, visible focus, screen-reader names/state, zoom and responsive layout, reduced motion and representative desktop/tablet/mobile browsers. Capture short evidence of checks and any residual issues. Test actual rendered WHMCS pages after Session 11, not only the SPA.

**Gate 6:** All identified contrast failures resolved and full applicable browser suite green; manual checks recorded and accessibility owner signs off. An axe pass is not a substitute for manual review.

### Session 7 — P1: authentication, MFA, passkeys and authorization

**Step 7.1 — Automated and real staging ceremonies**
- **S7.1a:** Test registration, verification, login/logout, recovery and session revocation with a staging mail sink; expiration, replay, enumeration/rate limiting and incorrect credentials must fail safely. Verify access isolation across at least two disposable accounts and staff/admin roles.
- **S7.1b:** Test TOTP enrollment, recovery codes, failure, replay, removal and re-enrollment; verify passkey enrollment/login on the **actual staging HTTPS origin and RP ID** with a real browser authenticator (and a second supported authenticator where practical), plus bad-origin/replay/revocation cases. Record RP/origin without secrets.
- **S7.1c:** Review CSRF/session/token handling, XSS/CSP, CORS, secret rotation, security logs and account recovery with the security owner; run relevant auth, passkey, authorization and browser tests.

**Gate 7:** Real staging mail and browser ceremonies, negative authorization/security cases and independent security review pass. Local mocks or an emulator alone do not prove real-origin setup.

### Session 8 — P1/P2: cart, checkout, billing, payments and reconciliation

**Step 8.1 — Invariants and sandbox payment flows**
- **S8.1a:** Map cart → priced order → invoice → sandbox payment → verified webhook → ledger → entitlement/provisioning. Confirm server-side price/tax/currency authority, immutable financial records, ownership and duplicate-submission behavior. Run `npm run verify:financial`, `npm run verify:authorization`, relevant integration tests and reconciliation checks against isolated staging data.
- **S8.1b:** For each gateway intended for launch (Stripe, PayPal, Paystack or others as actually configured), use its **real test/sandbox service** for success, decline, cancellation, duplicate/out-of-order delivery, signature rejection, refund and reconciliation. Verify provider transaction and webhook signature against independent provider-side records and the ledger/invoice. Test retry after timeout and no duplicate charge/provisioning. Record transaction IDs only in restricted redacted evidence.
- **S8.1c:** Exercise renewal, proration, invoice/refund authorization, chargeback handling if supported, reconciliation mismatch alerts and rollback. Confirm unsupported paths cannot appear paid or fulfilled. No production gateway credentials or real charges.

**Gate 8:** Finance and security owners reconcile sandbox balances, provider events, application records and entitlements for every enabled gateway, including failure/replay cases. Automated mocks alone are insufficient.

### Session 9 — P1/P2: infrastructure, domains and other provider integrations

**Step 9.1 — Provider-by-provider verification**
- **S9.1a:** For each required provider and adapter, record supported operations, sandbox availability, account limits, exact config state, permissions and expected costs. Set unconfigured/unsupported paths to fail closed; verify API/UI states and lifecycle reconciliation.
- **S9.1b:** Execute VPS/server sandbox provisioning → independently query provider → usable instance/health → controlled lifecycle → deletion, including duplicate/retry and failure cases. Verify shared hosting/control-panel fulfillment separately. If a provider lacks a sandbox, obtain an explicit authorized disposable staging strategy with spending controls; otherwise remain blocked.
- **S9.1c:** For every required registrar/DNS provider, use a test domain or provider sandbox to verify registration/transfer/renewal as available, DNS record and nameserver changes, propagation, ownership, failure/retry and cleanup. Confirm no live production domain is touched and no local success precedes registrar confirmation.
- **S9.1d:** Verify real staging outbound mail/delivery to a sink, support/escalation and required provider callbacks. Record capability-specific gaps; unrelated successful adapters do not cover them.

**Gate 9:** Operations owner independently correlates each enabled operation to its actual upstream result; failures remain failed/unknown and teardown is confirmed.

### Session 10 — P1: backups, restoration and disaster recovery

**Step 10.1 — Restore drill**
- **S10.1a:** Define database, files/media, configuration/secrets recovery and provider-managed backup scope, consistency, encryption, retention, off-server storage, restore prerequisites, RPO/RTO and ownership. Exclude credentials from artifacts; test data only.
- **S10.1b:** Take a real staging backup, verify integrity and restore into a **separate clean environment**, including database and files. Validate representative accounts, site data and critical relations; exercise app startup and access after restore. Independently compare source/restored counts and hashes. Verify backup/restore failure alerts and access controls.
- **S10.1c:** Time the drill, record achieved RPO/RTO, cleanup and rollback. Test provider snapshot/backup and actual restoration for each enabled provider, not merely creation or metadata.

**Gate 10:** Operations owner verifies complete restore and integrity, records timings and accepts the runbook. A backup creation success without a restoration is a failed gate.

### Session 11 — P2: WHMCS, cPanel deployment and cross-stack staging

**Step 11.1 — Licensed integration**
- **S11.1a:** On an approved disposable licensed WHMCS installation and real cPanel staging account, verify native PHP/ionCube/extensions, compatible supported versions, installation, module activation, hooks, scheduled jobs, upgrade, rollback and Node Passenger deployment. Execute only approved versioned migrations after backup and migration verification; keep quarantined migrations quarantined unless separately authorized.
- **S11.1b:** Verify each required WHMCS module against its actual enabled provider and test account; exercise lifecycle, failures, authorization, billing and post-operation upstream state. Check SPA/WHMCS currency, language, pinned country and generated shared assets. Record version matrix and any unsupported combinations.
- **S11.1c:** Run native PHP tests, real WHMCS-rendered desktop/mobile accessibility and usability checks, server-agent deployment tests on a disposable host, plus real restore after a staged deployment. A PHP WASM pass or a mock is not licensed-runtime evidence.

**Gate 11:** WHMCS/cPanel owners sign off the supported version matrix with actual rendered and upstream evidence, or the release remains blocked.

### Session 12 — P1: AI website builder and other existing customer workflows

**Step 12.1 — Repair observed builder defects**
- **S12.1a:** Reproduce the `output` versus `plan`/error-field response mismatch in the project history and repair the API/UI contract with compatibility and regression tests. Failed generations must not show a success message; report the actual error and allowance state.
- **S12.1b:** Repair list-item text truncation at validation while maintaining each field's own length limit, list size bounds and sanitization. Test generated and manually edited nested content for complete text, over-limit values, safe URLs and XSS defenses.
- **S12.1c:** Make applying to an existing site explicitly disclose and require confirmation of any homepage/theme replacement; prevent accidental draft loss and preserve recoverable revisions. Verify reapplication, duplicate paths, ownership, failed partial operations and published snapshot isolation. Make the initial engine selection meaningful or remove the misleading control; do not silently substitute another engine.
- **S12.1d:** Test the entire UI on a real staging database: sign in → create a site and AI project → select available engine → generate → review → apply → edit/save → publish → open public pages → unpublish; check keyboard/mobile and error cases. Validate generated content and links, not merely HTTP status. Test limits and provider errors. The native rules engine is deterministic; do not describe it as an external model.
- **S12.1e:** For an external model intended for launch, use an approved actual staging provider and verify configuration, output validation, privacy, cost/usage limits, timeouts and failure handling. If unconfigured, it stays unavailable; no claim of provider verification.

**Step 12.2 — Other advertised workflows**
- **S12.2a:** Use the S0 inventory and `docs/feature-parity-register.csv` to identify other launch-scope existing features not covered above (e.g., storefront, email, support, tools, AI support, custom domains). For each, record an owner, smallest testable slice, actual upstream dependency, positive/negative tests, cleanup and release state. Resolve critical failures or explicitly remove the capability from proposed launch scope with product/security approval; do not relabel mocks as integrations.

**Gate 12:** Product owner validates the repaired UI and published output; the external engine is independently verified only if actually tested. All launch-scope features have evidence or an explicitly approved scope decision.

### Session 13 — Release candidate, operational readiness and final approval

**Step 13.1 — Re-run at the exact release candidate**
- **S13.1a:** Freeze a clean candidate SHA and rebuild/retest in CI: full Node suite with zero failures/unhandled exceptions, frontend and backend type-checks, full build, browser/accessibility suites, security/audit checks, native PHP/server-agent tests and documented skips. Re-run integration and staging checks invalidated by changes; link every result to the SHA and environment.
- **S13.1b:** Verify real staging health/alerts, logging, incident response, dependency/secret rotation, retry queues, reconciliation, backup monitoring and restoration. Exercise deployment/rollback and compare financial/data snapshots. Document support coverage and escalation without inventing availability claims.
- **S13.1c:** Security, finance, operations, product, accessibility and legal review open findings, GeoLite attribution/licensing, privacy and terms, enabled integration inventory and evidence. Every item has an accountable disposition; an untested required feature is not green.

**Step 13.2 — Go/no-go**
- **S13.2a:** Produce a release matrix with SHA, evidence links, date, owner, verifier, environments, failures, residual risks and decisions. Obtain explicit independent approvals; any P0/P1 blocker, missing mandatory upstream proof, failing core gate or absent owner is **NO-GO**.
- **S13.2b:** Production deployment, production credentials, live payment activation, customer migration and other live customer operations require a **separate explicit authorization** and change plan. This plan itself does not authorize any of them. NO-GO can be removed only after all mandatory release gates pass and the required approvals are recorded.

**Gate 13:** All mandatory evidence and sign-offs complete on the frozen candidate; production remains off until a separately approved release decision.

## 4. Mandatory launch acceptance matrix

| Gate | Required result | Evidence / approver |
|---|---|---|
| Node tests | Full suite passes; zero unhandled errors; skips classified and approved | CI logs + engineering reviewer |
| Type-check and build | Frontend and backend type-check and full build pass | CI logs on candidate SHA |
| Security/dependencies | High-severity production issue fixed or formally mitigated by security; full-tree findings reviewed | Redacted audit, dependency paths, approval and expiry |
| Accessibility | All identified contrast failures fixed, full relevant browser suite and manual checks pass | Axe reports, device/keyboard/screen-reader evidence + accessibility owner |
| Database/status | Live staging DB outage and recovery reported truthfully | Independent probe, endpoint and alert logs + operations |
| SSL | Actual CA staging issuance, renewal and independently verified installation | CA/endpoint evidence + security/operations |
| Panels and providers | Real staging lifecycle operations verified individually; failures truthful | Provider-side observations + operations |
| Auth | Real staging email, MFA and passkey ceremonies including negative tests | Security evidence + security owner |
| Commerce/billing | Real gateway sandbox payment, signed webhook, refund and reconciliation | Provider and ledger evidence + finance/security |
| Backups | Separate-environment restore with verified integrity and recovery timing | Restore drill + operations |
| WHMCS/cPanel | Real licensed staging and native runtime verified | Version matrix, execution logs and owner sign-off |
| AI builder | UI generates, applies safely, edits and publishes; engine claims accurate | Browser/API results and output review + product owner |
| Monitoring/release | Alerts, rollback, incident ownership, legal review and clean candidate | Release matrix + all required approvers |

## 5. Handoff template for each slice

```text
Slice ID / requirement:
Candidate SHA and clean/dirty state:
Owner / independent verifier:
Environment mode and approved isolated target:
Preconditions and cleanup plan:
Change or investigation:
Changed files (or none):
Tests and exact redacted command(s), exit codes:
Observed result (positive + failure/retry):
Actual upstream evidence and correlation reference (if applicable):
Artifact links / restricted evidence hash:
Remaining risks / blocked dependencies:
Verifier decision, date and sign-off:
```

**Overall decision now: NO-GO.** This document is a plan, not evidence that the work or staging verification has been completed. The prior 6/10 implementation-maturity and 4/10 readiness scores are audit judgments, not certifications.
