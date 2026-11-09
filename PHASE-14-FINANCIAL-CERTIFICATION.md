# Phase 14 — Financial Systems Certification & Independent Review (2026-11-09)

Baseline: HEAD == origin == `d1d255b8` (Phase 13), tree clean.

## Directed scenario matrix — all executed against REAL PostgreSQL 16.2 (unix socket) with the actual transaction implementation

| # | Scenario demanded | Probe | Result | Evidence |
|---|---|---|---|---|
| 1 | Two simultaneous partial refunds | S1 | **PASS** — `OK / ERR:exceeds refundable balance ($60 vs $40)`, refundedTotal=60 | FINANCIAL-CONCURRENCY-TEST-RESULTS.json |
| 2 | Refunds against multiple invoices, same customer | S2 | **PASS** — both succeed (no false conflict) | same |
| 3 | Concurrent refund + invoice cancellation | S3 | **PASS** — cancel voids unpaid invoice; refund refused; no refund ledger row | same |
| 4 | Refund timeout followed by retry | S4 | **PASS** — retry **with idempotency key** → exactly 1 refund entry, retry returns current `partially_refunded` state | same |
| 5 | Duplicate refunds with same idempotency key | S5 | **PASS** — concurrent same-key duplicates collapse to 1 entry (unique index + replay check) | same |
| 6 | DB connection interruption mid-refund | S6 | **PASS** — socket destroyed pre-COMMIT → full rollback; ledger pristine; invoice stays `paid` | same |
| 7 | Deadlock & rollback recovery | S7 | **PASS** — PG deadlock detector kills victim (40P01); winner commits; both roll back cleanly after artifact | same |
| 8 | Ledger–provider reconciliation | — | **CONDITIONAL** — internal ledger coherence certified; provider-side requires CT-05 (payment sandbox creds). Procedure at `PAYMENT-PROVIDER-CERTIFICATION.md`; no claim beyond internal side | LEDGER-INTEGRITY-REPORT.md |

## New remediation this phase (P14-02)

**Refund endpoint now supports idempotency keys** (schema `idempotencyKey?: string(8..128)` → billing_ledger column + unique partial index per invoice). Without it, any timed-out staff refund was un-retryable without duplicate-risk. The replay path returns the already-issued refund's current state instead of duplicating. Migration `0093_refund_idempotency_key.sql`; PGlite and real-PG both at **93 migrations** (checksum verify OK); migrate.test.ts inventory updated to match (10/10).

## Verification totals this phase

- Real-PG scenario probes: **8/8 PASS** (`docs/staging/FINANCIAL-CONCURRENCY-TEST-RESULTS.json`).
- Regression: admin-billing 7/7, billing-lifecycle-e2e pass, payment-authorization-matrix pass, phase13-adversarial 6/6, webhook-hardening 9/9, migrate 10/10 (incl. 0093), `tsc --noEmit` exit 0.
- Pre/post P13-01 race probe re-run: SAFE (exactly one refund won) — unchanged by 0093.

## Deliverables committed

- `PHASE-14-FINANCIAL-CERTIFICATION.md` (this file)
- `docs/staging/FINANCIAL-CONCURRENCY-TEST-RESULTS.json`
- `LEDGER-INTEGRITY-REPORT.md`
- `INDEPENDENT-SECURITY-REVIEW.md` (marker: `INDEPENDENT-SECONDARY-REVIEW: NOT-APPOINTED`)
- `P1-GATE-TRACKER.md` updated in Phase 13; CT-03/CT-05 evidence pointers referenced

## Residual financial-integrity risks (owner's eye view)

1. Non-keyed retry still duplicates (documented; recommend mandatory keys once admin UI supplies them).
2. Provider-side reconciliation unexecuted (CT-05 blocked, runbook ready).
3. Deadlock handling unpolished UX-wise (correct, but a retry hint would reduce operator confusion).

**Position unchanged: production NO-GO. Financial integrity under concurrency/failure: certified at internal evidence level; independent human reviewer outstanding.**
