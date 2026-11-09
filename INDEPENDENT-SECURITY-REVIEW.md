# Independent Security Review — P13-01 & P14 Remediations (2026-11-09)

**Independence statement (honesty required by the gate tracker):** this review is produced by the
same agent that authored the fix. It is therefore a *secondary* review, not an *independent* one.
Per `P1-GATE-TRACKER.md`, independent secondary review is recorded as
`INDEPENDENT-SECONDARY-REVIEW: NOT-APPOINTED`. All claims below are evidence-backed and re-runnable
by any reviewer against the committed scripts.

## Scope of review

1. `src/services/billing-service.ts` — Phase 13 refund lock (`SELECT … FOR UPDATE` + in-transaction re-validation); Phase 14 idempotent replay.
2. `src/db/billing-ledger.ts` — idempotency_key plumbing; append-only protections intact.
3. `src/routes/admin-billing.ts` — optional `idempotencyKey` schema addition.
4. `database/migrations/0093_refund_idempotency_key.sql` — additive, non-destructive, index-only-if-present semantics.

## Checks performed

| Check | Result |
|---|---|
| Lock is taken **before** any refund decision inside the tx | PASS (code order verified) |
| Validation covers status + refundable cap against **committed** state under the lock | PASS |
| Idempotent replay returns existing state without writing (no duplicate entry, no status drift) | PASS (S8) |
| Unique partial index covers NULL keys (old callers unaffected) | PASS (S1/S3 used no key, still serialized by the lock) |
| Registering a refund never bypasses the ledger's invoice-owner/currency invariant | PASS (`recordLedgerEntry` statement unchanged apart from the new parameter) |
| Append-only trigger untouched by 0093 | PASS (trigger untouched; probe cleanup attempt still refused) |
| No weakening: reasons still mandatory, role gate unchanged (BILLING_STAFF_ROLES), audit event still written | PASS (`tsc` + suites) |
| Migration inventory updated in migrate.test.ts (`0093_refund_idempotency_key.sql` present, 10/10) | PASS |

## Residual risk register

- Timeout-retry with NO key still double-refunds: the endpoint *accepts* a key but does not require one. **Recommendation:** flip to mandatory for all staff refunds once the admin UI always supplies one (owner decision; flagged here, not silently changed).
- Deadlock victims currently surface as generic failures to the staff UI (engine-level retry policy for 40P01 is standard PG practice; a targeted retry hint could be added — non-blocking).
- Provider-side refund execution remains a CT-05 gate; the ledger records intent + state, not external money movement.

## Verdict

The concurrent over-refund vulnerability class is closed for the covered paths, with eight real-PG
failure-mode probes green. Independent human verification of this review's claims is still required
before the fix is considered *independently* certified.

Marker: `INDEPENDENT-SECONDARY-REVIEW: NOT-APPOINTED`


> **Renumber note (2026-11-09, PR #113 merge):** migration numbers renamed to avoid a collision with main's GA4/forensics 0093–0096 — `0093_refund_idempotency_key.sql` is now **`0097_refund_idempotency_key.sql`**, `0094_refund_idempotency_global_uniqueness.sql` is now **`0098_refund_idempotency_global_uniqueness.sql`**. Content identical (0098 additionally gained `IF NOT EXISTS`, staging checksum reconciled). Authoritative mapping: `docs/ops/MIGRATION-RENUMBER-0093-0094.md`.
