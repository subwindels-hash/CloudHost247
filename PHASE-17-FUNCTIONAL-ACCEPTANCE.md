# Phase 17 — Complete Frontend/Backend Functional Acceptance & Browser-Based E2E (2026-11-09, junction-integrity treatment)

Baseline: HEAD == origin == `88c7f417` (Phase 16), tree clean.

## Rule applied

Per your Phase-17 instruction, route existence is never conflated with working functionality. Every
journey below is certified at **junction integrity**: (a) front door correct (auth/entry), (b) backend
accepts & validates, (c) database records the correct state, (d) permissions enforced, (e) failures
presented honestly, (f) retries cannot duplicate financial/provisioning operations.

## Journey certification map

| # | Journey | Front door | Validation | DB state | Permissions | Honest failure | No-dup retry | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | Registration & authentication | ✔ | ✔ | ✔ | ✔ (roles) | ✔ (lockout + 429) | ✔ (tokens single-use) | auth-recovery + auth-flow + phase13-adversarial #4–6 |
| 2 | Dashboard & profile | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (PATCH replay-safe) | account-api.test.ts |
| 3 | Domain search & registration workflow | ✔ | ✔ | ✔ | ✔ (admin catalog closure) | ✔ (COMING-SOON checkout-disabled) | ✔ | domain-services-api + Phase 8 evidence |
| 4 | Product selection & checkout | ✔ | ✔ | ✔ | ✔ | ✔ (fail-closed payments) | ✔ (order create route-safe) | checkout-inbox-integration.test.ts + order-e2e |
| 5 | Invoice payment & confirmation | ✔ | ✔ (amount/method) | ✔ (ledger append-only) | ✔ | ✔ (provider failure leaves invoice unpaid) | ✔ (payment replay honored via provider ref / only one success per invoice) | payment-authorization-matrix + billing-security |
| 6 | Provisioning drill | ✔ (staff) | ✔ | ✔ (installation records) | ✔ BILLING_STAFF_ROLES | ✔ (rolled_back truthfully) | ✔ (idempotent provisioning + in-flight de-dupe) | worker-deployments + Phase 7/9 |
| 7 | Support tickets | ✔ | ✔ | ✔ | ✔ (owner-only 404 for outsiders) | ✔ | ✔ (append-only messages; no dup) | **phase17-support-journey.test.ts (new)** |
| 8 | SSL certificate lifecycle | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ssl-firewall-api.test.ts + Phase 8 |
| 9 | Email account management | ✔ | ✔ | ✔ | ✔ (management authority closure) | ✔ | ✔ | email-messaging-api.test.ts |
| 10 | Admin / super-admin operational workflows | ✔ | ✔ | ✔ | ✔ (super-admin-only integrity actions) | ✔ (audit every action) | ✔ | admin-customers + admin-billing + admin-role-guard-hardening |
| 11 | Refund submission / timeout recovery / idempotent replay | ✔ | ✔ (key mandatory) | ✔ | ✔ | ✔ (staff recovery guidance UI) | ✔ (global operation identity, 409 on mismatch) | phase14/15/16 battery |
| 12 | Mobile responsiveness & browser compatibility | — | — | — | — | — | — | **BLOCKED — CT-07** (no engine-native Chromium; suite prepared; never substituted) |

## Executable this phase vs blocked

- **Executable junctions:** all 11 non-browser journeys certified at junction integrity with the
  cumulative 170/170 test surface (164 reproduction + phase16 4 + phase17 support journey + prior
  targeted), plus the 8/8 real-PG financial probes.
- NEW this phase: dedicated acceptance-grade support-ticket journey test (401 unauth, 400 validation,
  201 create + DB row + owner visibility, outsider 404 enumeration-proof, reply append + persistence,
  outsider reply 404).
- **Blocked:** journey 12 (browser runtime) — requires CT-07; scripts/selectors verified, execution
  pending owner-provided browser environment.

## Honest scope statement

"Functional acceptance" here is server-side junction integrity exercised through the real HTTP API
with the real database. It does not claim pixels on screens until CT-07's real browser proves the
rendered journeys. Certifications remain **internally verified**; independent human review and the
eight P1 gates remain open; production **NO-GO**.
