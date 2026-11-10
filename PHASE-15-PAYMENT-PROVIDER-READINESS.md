# Phase 15 — End-to-End Payment Provider Certification & Financial Reconciliation (2026-11-09, scope decision + in-boundary completion)

## Scope decision (truthful, per your rules)

The ten directed provider-certification items (sandbox connectivity, authorization/confirmation,
provider refunds/disputes, cross-provider reconciliation) require **provider sandbox credentials and
egress access — both absent here and blocked by the environment allowlist**. Fabricating those
responses or substituting mocks is prohibited by the certification rules, so **provider execution is
not attempted and is not claimed**. What this phase does deliver is the two in-boundary improvements
you demanded before financial certification closes (A: mandatory idempotency; B: staff-facing
recovery guidance), plus the binding of this work to CT-05.

## A. Mandatory refund idempotency — implemented

- Backend route: `refundInvoiceSchema` now **requires** `idempotencyKey` (zod, 8–128 chars) — a
  keyless refund returns 400 before any ledger work. Code path: `src/routes/admin-billing.ts`.
- Staff UI: `AdminRefundModal.tsx` generates **one `crypto.randomUUID()` per opened refund dialog**
  (per invoice) and preserves it across retries of that same submission; closing/reopening starts a
  deliberate new operation with a new key.
- This preserves your noted distinction: retries of the SAME operation share the key; a genuinely
  new operation always mints a new key — nothing silently collapses distinct operations.
- Suite maintenance: admin-billing-api + billing-lifecycle-e2e refund calls now carry keys
  (17/17 green incl. adversarial 6/6). `tsc` exit 0 (API + frontend).

## B. Staff-facing recovery guidance — implemented

The refund modal detects transient/ambiguous failures (timeout/network/5xx/deadlock) and shows
actionable guidance inline: *check the invoice ledger for a completed refund before retrying; a retry
from this dialog reuses the same idempotency key and will report the existing refund instead of
creating a second one.* Non-transient errors surface unchanged.

## C. Provider reconciliation — remains CT-05 (blocked), with a ready terminal state

Execution stays gated on payment sandbox credentials (owner `subwindels-hash`). When supplied:
run `PAYMENT-PROVIDER-CERTIFICATION.md` verbatim per provider → produce
`docs/staging/ct05-payment-sandbox-<date>.json` → verifier signature; only then is the ledger-vs-
provider trail certified. No interim claim made.

## Evidence

| Item | Runs |
|---|---|
| Adversarial + billing suites (regression with mandatory keys) | 17/17 |
| Webhook + payment-authorization suites | 11/11 |
| API `tsc --noEmit` | exit 0 |
| Frontend `tsc --noEmit` | exit 0 |
| Real-PG 8 scenario probes (unchanged, still green from Phase 14 commit state) | reference |

**Financial certification status: internal correctness certified through Phase 14; the two
pre-closure improvements (A, B) are now implemented and tested. Full financial certification remains
open pending (C) provider reconciliation (CT-05) and independent human review. Production NO-GO stands.**
