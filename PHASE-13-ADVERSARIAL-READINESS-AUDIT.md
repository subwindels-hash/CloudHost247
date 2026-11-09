# Phase 13 — Independent Security, Financial Integrity & Adversarial Readiness Audit (2026-11-09)

Baseline verified: HEAD == origin == `cf48ae99` (Phase 12), tree clean. Scope: 10 directed areas.
Method: source inspection + adversarial executions (6 new integration tests + 1 real-PG race probe).
No speculative rewrites; one remediated defect. No existing security control weakened.

## Findings register

| ID | Area | Severity | Finding | Evidence | Remediation | Regression test |
|---|---|---|---|---|---|---|
| P13-01 | 3. Financial (refunds) | **P0 — confirmed exploit, remediated** | `adminIssueRefund` computed the refundable cap from pre-transaction reads with **no row lock**: 3 concurrent staff refunds of $100 on a $100-paid invoice produced `X:OK, Z:OK`, ledger = $200 refunded | real PG 16.2 probe (scripts/phase13-refund-race-probe.ts), pre-fix output showing refund total 200.00 | Re-ordered validation inside the transaction **after `SELECT … FOR UPDATE` on the invoice row**; the waiter re-evaluates against the committed first refund → `Cannot refund an invoice in 'refunded' status` | Real-PG probe now returns `SAFE (exactly one refund won)`; PGlite regressions: phase13-adversarial tests #1–#3; admin-billing-api 16/16 stays green |
| P13-02 | 3. order fulfillment / invoice lifecycle | none (verified) | Billing untouched by failed deploys; unpaid orders refused before any provider work; ledger append-only trigger blocks UPDATE/DELETE of entries (verified live: probe cleanup attempt was rejected by `billing_ledger_prevent_mutation()`) | Phase 9 #1–#2; probe transcript | — | phase13 #1–#3, webhook-hardening 9/9 |
| P13-03 | 1./8. Tenant isolation & privacy | none (verified) | cross-tenant SSL read blocked (list filtered + by-id 404) booted against **real PG 16.2**; foreign inbox conversation → 404 | Phase 11 smoke 5/5; Phase 9 #5 | — | phase11 smoke re-runnable |
| P13-04 | 4. Webhook signature + replay | none (verified) | HMAC signature enforcement, invalid-signature rejection, durable dedupe incl. 6-way concurrent delivery | tests/integration/webhook-hardening.test.ts 9/9 (re-run Phase 10 batch) | — | existing suite |
| P13-05 | 6. Password reset | none (verified) | single-use link via atomic `UPDATE … WHERE used_at IS NULL` claim; replay returns identical benign outcome (non-enumeration); session-version invalidation on password hash change (`sv` bump inside `updatePasswordHash`) | phase13-adversarial #4 (replay refused twice) | — | #4 |
| P13-06 | 6. MFA replay | none (verified) | TOTP same-timestep replay refused (`timestep > last_used_timestep` gate); recovery codes single-use; challenge tokens 5-min, 5-attempt | phase13-adversarial #5 (enroll code replay refused, next timestep succeeds, its replay refused) | — | #5 |
| P13-07 | 7. Rate limiting / abuse | none (verified) | `/api/auth/login` enforces 10/min → status 429 on 11th attempt; MFA enroll 5/15min, passkey endpoints 5–10/15min | phase13-adversarial #6 | — | #6 |
| P13-08 | 2. Admin boundary | none (verified) | billing staff = `admin`/`super_admin` only (401 unauth, 403 customer); super-admin-only suspend tokens refuse post-suspension | admin-billing-api (401/403 matrix), require-auth suspended-user check | — | existing |
| P13-09 | 9. Backup security / restore integrity | none at platform layer (verified) | pg_dump→pg_restore 221/221 tables with checksum equality on real PG; cPanel restore rejects paths outside `/home/<user>/` | Phase 11 restore transcript; Phase 8 A1 | — | realpg-verify re-run |
| P13-10 | 10. Audit logs / accountability | none (verified) | refund events carry actor, invoice, amounts, reason in immutable `auth_audit_log` | phase13-adversarial #3 | — | #3 |

## Not found in this audit (honestly recorded)

- Backup **encryption-key custody** and third-party storage egress — external-provider gated (CT-06).
- Real concurrent-HTTP tenant isolation under load — API smoke demonstrated sequential; a full concurrent-request stress on real infrastructure is part of CT-03/CT-06 staging work.
- SMTP abuse controls (bulk-send prevention) — relies on relay limits, CT-04.

## Outcome

- **1 P0 found → remediated → regression-covered** (P13-01).
- Verification totals this phase: 6/6 adversarial + 16/16 billing-security regression re-run + SAFE race probe x2 (pre/post) + 16/16 broader auth/billing suite = all recorded.
- Governance improvement applied: `P1-GATE-TRACKER.md` now requires the explicit `INDEPENDENT-SECONDARY-REVIEW: NOT-APPOINTED` marker until a second reviewer exists.

**Production remains NO-GO; engineering-boundary integrity improved by one real exploit class closed.**
