# Phase 9 — Cross-Module Integration, Lifecycle & Failure-Path Certification (2026-11-09)

Baseline verified before starting: HEAD = `669aa91e` (Phase 8) == `origin/arena/fe9b2088-cloudhost247`,
tree clean; the Phase-8 reported 77/77 was **independently reproduced** on this baseline
(7 files, 121s, 2026-11-09 ~14:23Z run) before any Phase-9 work began.

## Certification rules honored

- No fabricated provider responses; no simulated external certification presented as live.
- All eight new tests are **integration** evidence: real cloudhost247-node code (engine, routes,
  services) against real PGlite PostgreSQL. The outermost provider transport is substituted through
  the engine's documented `adapterOverride` test seam; the stub is part of the system under test,
  never its subject. No test here is sandbox or live-provider evidence.
- Unsupported operations remain explicitly unsupported (cpanel `restartApplication`/`applicationLogs`
  still throw; healthcheck reports `unknown`). No credentials invented, no production access.

## Evidence matrix (what is proven, at which level)

| Claim | Level | Evidence |
|---|---|---|
| Failed deploy → installation `failed`, never `healthy`; billing untouched (order stays truthfully `paid`/`pending`, no fabricated refund/completion); failure recorded verbatim (`PROVIDER_DOWN`) with retry-backoff, never smoothed into success | **integration** | phase9-cross-module #1 |
| Unpaid order refused at validation (`ORDER_NOT_PAID`); **zero adapter calls attempted**; billing unchanged | **integration** | phase9-cross-module #2 |
| Deploy-time SSL request marks domain `pending` — never `issued` — until the platform resolver confirms | **integration** | phase9-cross-module #3 |
| Inbox channel with absent email relay reports `not_configured` (with reason + code), becomes `connected` only when transport truly configured | **integration** | phase9-cross-module #4 |
| Internal notes never leak into customer conversation view (SQL-enforced `visibility='public'`); foreign conversation = 404 | **integration** | phase9-cross-module #5 |
| Renew on PENDING cert → 409 (issuance cannot be fabricated) | **integration** | phase9-cross-module #6 |
| Pasted cert parsed (`X509Certificate`): expiry = cert's own `validTo`, provenance `CUSTOM`; renew → `VALIDATING` (no CA adapter — honest pending-reissuance), expiry **does not move**; revoke → `REVOKED`; renew-on-REVOKED → 409 | **integration** | phase9-cross-module #7 |
| Malformed PEM blob rejected (400), never stored as issued | **integration** | phase9-cross-module #8 |
| Duplicate webhooks, 6-way concurrency, durable rejection, billing-ledger integrity | **integration** (pre-existing, Phase 5) | webhook-hardening 9/9 re-run green |
| cPanel WHM lifecycle (create/suspend/unsuspend/terminate) code is a genuine WHM API 1 token-auth client | **static source inspection** (external-run gated by P1-1/P1-2) | Phase 8 A1 |
| PHP phone-services webhooks reject invalid signatures (403), duplicate-delivery safe; Cron reconciliation real | **static source inspection** (runtime gated by WHMCS license) | Phase 8 A4 |
| Full WHMCS provisioning lifecycle for email (Create/Suspend/Unsuspend/Terminate/TestConnection/sync) | **static source inspection** (runtime gated by P1-1) | Phase 8 A4 |

## Result of this phase's run-sets

`tests/integration/phase9-cross-module.test.ts`: **8/8 PASS**. Regression guard on touched code
(customer-domains cast + `src/routes/ssl.ts`): worker-deployments + ssl-firewall-api +
webhook-hardening = **30/30 PASS**; `tsc --noEmit` = exit 0. Total evidence-sets touched/verified
this phase: **77/77 reproduced + 8/8 new + 30/30 regression = 115 executions, 115 green.**

## Findings

- **F9-CXF-1 (test-infra, fixed):** `setDomainSslStatus` used untyped nullable params that real
  Postgres infers but PGlite rejected (`inconsistent types deduced for parameter $2`), causing the
  deploy pipeline's "Provision SSL certificate" step to fail on PGlite. Added explicit
  `::timestamptz`/`::varchar` casts — zero semantic change on real Postgres. No hidden product
  defect was masked: with the fix, the step truthfully records `pending`.
- **No new product defects.** Queue behavior re-verified honest: a business failure records its
  code/message on the row and re-enables the job with exponential backoff rather than claiming
  completion; validation refusals run before any adapter call.

## Cross-module verdict

The four Phase-8 areas interact with truthful failure propagation: deployments affect billing and
installation state only through verified records; a failed provider interaction propagates `failed`
(not success); inbox channel health reflects real email-transport configuration; SSL states advance
only via parsed material or a truthful re-validation marker. **Cross-module integrity: PASS
(integration level).** External (sandbox/live-provider) certification remains blocked by the same
Phase-7 gates (WHMCS license, cPanel account, email relay, provider credentials, browser runtime,
external Postgres) — unchanged: **production NO-GO; limited release CONDITIONAL GO-eligible.**
