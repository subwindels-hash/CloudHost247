# Phase 16 — Full Application Regression, Release Packaging & Deployment Readiness (2026-11-09)

Baseline: HEAD == origin == `4ebab362` (Phase 15), tree clean.

## §2 Idempotency hardening (your demanded tests) — implemented + verified

Your five checks, with what the code now guarantees:

| Check | Verdict | Evidence |
|---|---|---|
| Reusing a key with a different invoice | **Rejected (409 ConflictError)** | phase16-idempotency-hardening #1 |
| Reusing a key with a different refund amount | **Rejected (409)** | #2 |
| Replaying a completed refund with modified metadata (reason) | **Rejected (409)**; identical replay honored | #3 |
| Keyless refund at the route | **400 before ledger work** | #4 |
| Two browser tabs sharing an operation key | **Impossible by construction** — key generated per open dialog via `crypto.randomUUID()` in useMemo per invoice; separate dialogs never share keys | `AdminRefundModal.tsx` |
| Page refresh after ambiguous timeout | Original dialog (and its key) is gone; the transient-error guidance (Phase 15-B) instructs checking the ledger first; a *new* dialog deliberately mints a new key — the correct, non-colliding behavior | code + guidance text |

Supporting change: migration `0094_refund_idempotency_global_uniqueness.sql` makes keys **globally
unique** (one key = one operation, forever); the replay guard now matches on invoice + amount +
reason. The Phase-14 real-PG probe battery was re-executed against this hardened code path —
**8/8 PASS** (probe transcripts treat a true retry as same invoice/amount/reason).

## Phase-16 application-integration scope status

| Directed item | Status here |
|---|---|
| 1. Frontend routes vs backend | Anchored by platform-services suite: "serves one navigation definition in which every link resolves to a real route" (green, Phase-10 reproduction). |
| 2. Admin actions/permission boundaries | admin-billing 401/403 matrix; staff/pricing authority closures — green. |
| 3. Forms/validation/error states | checkout/quote/contact/inbox integration suites green — green. |
| 4. Registration/login/recovery/MFA | auth-recovery + auth-flow + adversarial 6/6 — green. |
| 5. Cart/checkout/order/invoice lifecycle | billing-lifecycle-e2e + payment-authorization-matrix — green. |
| 6. Provisioning/suspension workflows | worker-deployments + rollback evidence — green. |
| 7. Email/domain/SSL/cPanel module boundaries | Phases 8–9 source+integration evidence — green at boundary; runtime gated. |
| 8. **Mobile responsiveness / browser compatibility** | **BLOCKED (CT-07)** — no Chromium here; not substituted, preparation retained (selectors verified, suite ready to execute). |
| 9. Full regression after integration | This phase: 27/27 targeted + prior 164/164 reproduction — green. |
| 10. Release manifest + deployment checklist | `RELEASE-MANIFEST.json` + `DEPLOYMENT-CHECKLIST.md` delivered. |

## Deliverables (committed)

- `RELEASE-MANIFEST.json`, `DEPLOYMENT-CHECKLIST.md`, this report
- `database/migrations/0094_refund_idempotency_global_uniqueness.sql`
- `tests/integration/phase16-idempotency-hardening.test.ts` (4/4)
- Refreshed `docs/staging/FINANCIAL-CONCURRENCY-TEST-RESULTS.json` (8/8 under hardened semantics)

**Position: production NO-GO; the application is one integrated, evidence-backed whole except
browser-runtime ceremonies and external provider gates — both tracked, both owner-gated.**


> **Renumber note (2026-11-09, PR #113 merge):** migration numbers renamed to avoid a collision with main's GA4/forensics 0093–0096 — `0093_refund_idempotency_key.sql` is now **`0097_refund_idempotency_key.sql`**, `0094_refund_idempotency_global_uniqueness.sql` is now **`0098_refund_idempotency_global_uniqueness.sql`**. Content identical (0098 additionally gained `IF NOT EXISTS`, staging checksum reconciled). Authoritative mapping: `docs/ops/MIGRATION-RENUMBER-0093-0094.md`.
