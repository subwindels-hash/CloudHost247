# CloudHost247 — Payment Integrity Certification Report (2026-11-09)

**Sandbox-only statement: no real customer funds, live provider network, or production
credential was used at any point.** All live evidence below comes from the platform's
built-in sandbox gateway (`src/payments/sandbox-gateway.ts` — a self-hosted simulator that
exists precisely so the payment pipeline can be exercised without faking money movement),
driven over real HTTP against the staging stack. Deeper adversarial coverage additionally
comes from the executed integration suites (2,901/2,901 tests) named per row.

Live evidence: `scripts/staging/smoke-staging.mjs` run of 2026-11-09,
`docs/staging/staging-evidence-2026-11-09.json`.

| # | Control | Method | Result | Evidence |
|---|---|---|---|---|
| F-1 | Payment authorization (only the invoice owner can initiate) | live HTTP: customer token → `POST /api/v1/invoices/:id/payments`; cross-tenant probe | ✅ owner-only; cross-tenant invoice read/initiation → **404** (existence not leaked), anonymous → 401 | staging evidence; `payments-api.test.ts`, `payment-authorization-matrix.test.ts` (state byte-identical after every refused attempt) |
| F-2 | Webhook signature verification | live: valid HMAC settles; **tampered signature → 401** | ✅ | staging evidence rows "TAMPERED"/"SIGNED" |
| F-3 | Replay protection (timestamp freshness) | live: timestamp 10 min old → **401** | ✅ 5-minute freshness window enforced | staging evidence; `webhook-signing.ts` |
| F-4 | Duplicate webhook rejection / idempotency | signed success webhook replayed twice: settlement rows before=2 after=2; **no double settlement**, single `payment` ledger entry | ✅ | staging evidence "REPLAY", "ledger" |
| F-5 | Payment→invoice reconciliation | after signed success webhook: invoice status `paid`; ledger = charges 2 + payment 1 (two invoices, exactly one settlement); failed invoice zero payments | ✅ | staging evidence; `financial-invariant-sweep.test.ts` (whole-DB append-only sweep) |
| F-6 | Refund handling | refund lifecycle tested in-payment suites incl. refunded-first-payment affiliate/commission interplay | ✅ (suite) | `refund`/`credit` ledger vocabulary in `src/db/billing-ledger.ts`; payments suites. Live refund execution requires an admin/owner flow — deferred to B-2 staging (admin rows need super_admin bootstrap)",
| F-7 | Wallet/ledger consistency | append-only ledger, atomic invoice+charge issuance at checkout; whole-database invariant sweep executes in CI and here | ✅ | `financial-invariant-sweep.test.ts`; live rows consistent (2 charges/1 payment exactly) |
| F-8 | Currency & rounding accuracy | money math in integer minor units (`src/lib/money.ts`), discount-spread invariant tests (never below zero, discount proportional) | ✅ | suites: `billing-*`, `customaffiliate` PHP suite (rounds to cents); live seed invoice arithmetic consistent |
| F-9 | Failed & ambiguous outcomes | live: `failed` outcome → payment failed, invoice stays `unpaid`; **wrong-amount webhook → 400, invoice unpaid** (ambiguous settlements cannot land) | ✅ | staging evidence rows "WRONG AMOUNT"/"FAILED" |
| F-10 | Unauthorized state mutation impossibility | adversarial matrix: every 5B/5C financial route probed; DB byte-identical after every rejection | ✅ | `payment-authorization-matrix.test.ts` (executed in the 2,901-test suite) |
| F-11 | Manual/offline gateway honesty | no fabricated bank details when instructions unset — honest "not configured" | ✅ | `payments.ts`, suites |
| F-12 | Real-gateway webhook secrets absent → gateways report not connected | Stripe/PayPal/Paystack unset here; settlement paths stay manual/invoiced; no silent fallback | ✅ | env schema + webhooks route tests |

## Residual items before production payment certification

- Live sandbox runs **per real provider** (Stripe/PayPal/Paystack test modes + Blockonomics)
  — requires owner-issued test credentials (B-4).
- Admin refund execution path verified end-to-end on staging where a super_admin exists
  (bootstrap requires super_admin or DB access — intentionally not self-created here).
- The standalone whole-database probes (`verify:financial`, `verify:authorization` CLI form)
  re-run against the staging production-shaped Postgres (their logic already executed here
  via the integration suites against embedded Postgres).

**Conclusion:** The payment pipeline's integrity properties — authentication, authorization,
signature validity, freshness, replay rejection, amount consistency, idempotency, atomic
reconciliation — all hold under live adversarial execution in sandbox. No live funds involved.
