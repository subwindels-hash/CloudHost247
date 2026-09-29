# Recovery patches — PREPARED, VERIFIED, and DELIBERATELY NOT APPLIED

Both patches in this directory are **staged for your approval, not active**. The working tree and
every commit on this branch leave Phase 5B and Phase 5C source code **completely unmodified** —
financial development remains frozen exactly as instructed.

Each patch was applied temporarily, verified against **real PostgreSQL 18.4**, and then reverted.
The revert was itself verified (the 5C defect reproduces again with the patch off), so these are
not untested suggestions.

```bash
# inspect
git apply --check recovery/<patch>      # confirm it still applies cleanly
git apply --stat  recovery/<patch>      # see what it touches

# apply (ONLY after you approve)
git apply recovery/<patch>

# undo
git checkout -- cloudhost247-node/src/
```

---

## 1. `5c-fix-concurrent-manual-confirm.patch` — fixes the critical defect

**Fixes:** `PHASE_5_CHECKPOINT_REPORT.md` §3.1 — concurrent staff confirmations of the same manual
payment each append a `payment` entry to the append-only `billing_ledger`, recording one invoice as
paid several times over.

**Touches:** `src/db/payments.ts`, `src/services/payment-service.ts`. **Code only — no migration,
no schema change, no data change.**

**What it does:** adds an optional `expectedCurrentStatus` to `updatePaymentStatus`, folded into the
`UPDATE`'s own `WHERE` clause (`AND ($6::text IS NULL OR status = $6)`), so the status check and the
write become one atomic statement instead of a read followed by a write. `confirmManualPayment` and
`rejectManualPayment` pass `'pending'`. The loser of a race updates zero rows and receives a plain
`ValidationError` ("This payment has already been resolved by another request") — never a success,
never a 500.

**Verified:**

| Check | Before | After |
| --- | --- | --- |
| 25 rounds × 6 concurrent confirms (HTTP) | **6 simultaneous 200s, 6 ledger entries on one invoice** | **1 success, 1 ledger entry** |
| Forced interleave (both reads before either write) | 2/2 succeeded, ledger 39.98 vs invoice 19.99 | 1/2 succeeded, ledger 19.99 = invoice 19.99 |
| Payments + billing test suites | 58/58 | **58/58** |
| Full 5C adversarial audit | 67/68 | **67/68** (the one failure is the missing webhook receiver, §3.2 — unrelated) |
| `tsc --noEmit` | clean | clean |

**Not included on purpose:** a regression test. Adding one means writing to Phase 5C test files,
which your directive scoped as audit-only. Say the word and it goes in with the fix — it should,
because a green suite currently hides this defect.

---

## 2. `option-b-disable-payment-routes.patch` — the reversible off switch

**Implements:** Recovery Option B from `PHASE_5_CHECKPOINT_REPORT.md` §4. Prepared per your
instruction to "prepare only, await approval."

**Touches:** `cloudhost247-node/src/app.ts` only — it comments out `registerPaymentRoutes` and
`registerAdminBillingRoutes`, with an explanatory block naming the defect and the report section.

**What it deliberately does NOT do:** no table is dropped, no migration reverted, no row deleted, no
commit reverted. It is an off switch, not a rollback.

**Verified — 14/14 against real PostgreSQL:**

- **Phase 4 intact:** `/health`, public catalog, account services all 200.
- **Phase 5A intact:** add-to-cart 201, checkout 201, order history readable.
- **Phase 5B intact:** checkout still issues its invoice atomically; invoices still readable.
- **Payment surface gone:** all four endpoints (`POST /api/v1/invoices/:id/payments`,
  `GET /api/v1/payments/:id`, `POST /api/v1/admin/payments/:id/confirm-manual`, `.../reject-manual`)
  return 404.
- **History preserved:** 28 invoices, 175 ledger entries, 26 payment rows still present; all three
  Phase 5B/5C tables still exist.

**Caveat:** it disables the *only* mechanism by which a payment can be recorded. Any legitimate
manual bank transfer received while it is in effect must be reconciled by hand afterwards. If your
goal is to stop the double-credit rather than stop payments altogether, patch 1 is the smaller and
better-targeted change.

---

## Recommendation

Apply **patch 1 alone**. It removes the only exploitable defect found in the whole audit, is
code-only, and leaves the platform functional. Patch 2 exists because you asked for it to be ready,
and is the right choice only if you want payments halted outright while you decide.

**Neither has been applied. Nothing has been merged. Awaiting your decision.**
