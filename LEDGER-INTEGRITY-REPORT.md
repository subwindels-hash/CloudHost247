# Ledger Integrity Report — Phase 14 (2026-11-09, real PostgreSQL 16.2)

## Structural guarantees (enforced by the engine, not by convention)

| Guarantee | Mechanism | Verified by |
|---|---|---|
| Append-only ledger | `billing_ledger_prevent_mutation()` trigger rejects UPDATE/DELETE of existing rows (including moderation "cleanup" attempts by admins) | Phase 13 probe: script teardown attempt explicitly refused with `P0001 billing_ledger is append-only` |
| Entries can never be negative or zero | CHECK `amount > 0` | Phase 13 adversarial #2 |
| Entry cannot attribute the wrong customer/currency | `recordLedgerEntry` derives `user_id`/`currency` from the invoice inside the same SQL statement (finding B3 remediation) | code review + suites |
| One refund per idempotency key per invoice | unique partial index `billing_ledger_idempotency_key_unique_idx` (migration 0093) | Phase 14 S5 concurrency probe |
| Concurrency-safe refundable-cap math | `SELECT … FOR UPDATE` on invoice before validating/computing (Phase 13 P13-01) | Phase 14 S1/S5 probes |

## Concurrency certification outcomes (summary — full log: docs/staging/FINANCIAL-CONCURRENCY-TEST-RESULTS.json)

| Scenario | Result |
|---|---|
| S1 two simultaneous partial refunds | exactly one accepted; refundedTotal=60 ≤ paid=100 |
| S2 concurrent refunds on distinct invoices (same customer) | both succeed (no false cross-invoice conflict) |
| S3 concurrent refund + cancel (unpaid) | cancel wins, refund refused, no ledger row |
| S4 timeout + retry with same idempotency key | exactly one refund entry; retry returns current state |
| S5 concurrent duplicate refund, same key | one entry only (index + replay check) |
| S6 connection destroyed mid-transaction | rollback; no refund row; invoice stays `paid` |
| S7 engineered deadlock | PG detects (40P01) one victim; winner commits; rollback path clean |
| S8 idempotent replay after full refund | returns existing `refunded` state; zero new entries |

## Reconciliation boundary (honest)

Internal ledger ↔ provider reconciliation: internal side is verified (ledger coherent under all
scenarios above). Provider-side money movement requires payment sandbox credentials (gate CT-05).
Procedure is the Phase-6 payment runbook; evidence artifact path `docs/staging/ct05-payment-sandbox-<date>.json`.
Not certified until CT-05 closes; no claim is made otherwise.
