# CloudHost247 — Payment Reconciliation Report (Phase 5, 2026-11-09)

Builds on PAYMENT-SECURITY-AUDIT.md (Phase 4) with this phase's hardening closed. Sandbox-only;
no real funds, no live provider network. Server-side enforcement confirmed line-by-line; invoice
/ledger consistency after every adversarial probe verified on a live DB.

## Reconciliation model (as enforced, not as described)

1. **Initiation** — owner-scoped `pending` attempt only; never self-settling (structural).
2. **Settlement** — single transaction: CAS `pending→successful`, append-only ledger `payment`
   (owner/currency derived from the invoice row inside the INSERT), invoice→`paid`,
   order→`paid`, idempotent provisioning hook, durable audit event, lease completion.
3. **Reversal/refund** — admin-only: integer-cents amounts, mandatory audited reason, refundable
   cap = Σ(payments) − Σ(refunds) from the append-only ledger itself, terminal states
   `refunded`/`partially_refunded`. Reversals are append-only compensating entries (refund rows),
   never edits. Suite-verified incl. full lifecycle (`billing-lifecycle-e2e`,
   `admin-billing-api`, financial invariant sweep). ⚠️ Live-permission drill pending OPS-2.
4. **Failure** — `failed`/`cancelled` only from `pending`; invoice stays `unpaid`; zero ledger
   settlement rows. Ambiguous outcomes (`unhandled`) are recorded `ignored`, never settled.

## Ambiguous-response durable reconciliation (P4-F4, new this phase)

| Situation | Response | Persistence | Redelivery behavior |
|---|---|---|---|
| Payment not found (early delivery race) | 404 | event row stays leased `processing` | post-lease takeover → reconcile & settle (suite F4b, end-to-end) |
| Parity violation (amount/currency/owner/order) | 400 | **durable** `rejected` + reason + payment link (post-rollback write) | 200 `{status:'rejected'}` — retry storm stops (suite F4a) |
| Settled-state violation (finished payment re-success) | 409 | durable `rejected` | same short-circuit |
| Truly unknown provider event type | 200 `ignored` | durable `ignored` | idempotent |
| Signature/timestamp failure | 401 | none (pre-parse) | banal deny |

Idempotency under **concurrent** identical deliveries: 6-way burst in the new hardening suite —
exactly one `processed`; every other path short-circuits; ledger holds exactly one payment row.
(Stripe-path 8-way burst + lease-takeover: pre-existing suite tests 17–20 — still green after
the terminal-rejection refactor.)

## Idempotency persistence claim (sharpened)

`webhook_events` is durable Postgres state — idempotency survives process restarts (proved
repeatedly this session by the smoke/probe runs across server restarts) and node crashes
(lease takeover with `--once` worker or next delivery attempt; suite tests 19–20).

## Phase-5 executions on the hardened build

- Staging smoke 33/33 (includes wrong-amount 400 + unpaid, replay dedup ledger 2→2, failed-outcome
  non-settlement).
- Independent probes 23/23 (timestamp-omitted signed webhook → 401; stamped replay →
  `already_processed`; ledger unchanged).
- Webhook suites 42/42 (incl. 9 new hardening tests); broader finance/payment suites 162/162.

## Remaining reconciliation dependencies (external)

- Live per-provider end-to-end (charge → webhook → refund) — B-4 sandbox credentials; per-provider
  retry policy must be mapped onto the terminal/transient table above at integration time
  (P4-F4 reconciliation: this report already defines the target semantics).
- Production-topology invariant probes (`verify:financial`, `verify:authorization` CLI form) —
  B-3 infrastructure.
