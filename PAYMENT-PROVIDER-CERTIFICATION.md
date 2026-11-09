# CloudHost247 — Payment Provider Certification (Phase 6, 2026-11-09)

## Status: STOPPED — credential + network gates (Phase 6 §7), per provider

| Provider | Credentials present? | Sandbox reachable? | Authorization scope recorded? | Executed? |
|---|---|---|---|---|
| Stripe | ☐ none | ☐ `api.stripe.com` → 000 (2026-11-09 sweep) | none supplied | **NO** |
| PayPal | ☐ none | ☐ `api-m.sandbox.paypal.com` → 000 | none supplied | **NO** |
| Paystack | ☐ none | ☐ (same egress allowlist) | none supplied | **NO** |
| Blockonomics | ☐ none | ☐ | none supplied | **NO** |
| In-app sandbox gateway | ✅ env local secret | n/a (in-process) | n/a (first-party lab) | ✅ repeatedly (Phases 3–5) |

No money moved, no test keys were minted, invented, or simulated as real. Stripe/PayPal/Paystack/
Blockonomics receivers stay in their verified code state: **unset secrets ⇒ gateway reports "not
connected"; webhooks refuse to settle** (existing suite gates).

## Matrix of required verification — current standing per cell

Success/failed payments, duplicate notifications, invalid signatures, refunds, reversals,
delayed notifications, ambiguous outcomes, reconciliation, ledger integrity:

| Cell | In-app sandbox (executed) | Each real provider (this phase) |
|---|---|---|
| Successful | ✅ signed webhook → paid, ledger+order atomically (Phase 3 step 23) | ☐ B-4 |
| Failed | ✅ failed outcome → unpaid, no ledger payment row (step 28) | ☐ |
| Duplicate notifications | ✅ replay dedup ledger 2→2 (step 24); concurrent 6-way burst = exactly one settlement (hardening suite) | ☐ |
| Invalid signatures | ✅ tampered → 401 (step 25); timing-safe compare code-verified | ☐ (Stripe/Paystack HMAC + PayPal cert suit units pass vs fixtures) |
| Refunds | ✅ logic: partial+full, cap = Σpays−Σrefunds, append-only ledger + audit (`billing-lifecycle-e2e`, `admin-billing-api`) — live drill awaits super_admin boundary (OPS-2) | ☐ |
| Reversals | ✅ reversal-as-compensating-entry design executed in suites | ☐ |
| Delayed notifications | ✅ transient not-found → lease expiry → post-delay redelivery settles (Phase 5 suite F4b) | ☐ per-provider retry policy mapping (P4-F4 residual) |
| Ambiguous outcomes | ✅ wrong-amount → 400 unpaid (step 27); durable terminal rejection + retry-storm stop (Phase 5 F4a) | ☐ |
| Reconciliation | ✅ ledger/invoice/order cascade re-read after each adversary (steps 23–29; probes) | ☐ |
| Ledger integrity | ✅ append-only DB triggers; financial invariant sweep suite green | ☐ (production-probe B-3) |

## Certification procedure per provider (ready on gate opening)

1. Owner issues TEST keys via a secure channel; scope logged (who/what/when) in
   `docs/staging/phase6-authorizations.md`.
2. Keys placed only in staging env; secrets never printed (logger redaction verified live).
3. Full matrix above executed end-to-end with real test-mode charges; stripe-cli/paypal simulator
   redeliveries for the duplicate/delayed/ambiguous cells; refund issued from a **test** charge;
   signature tampering re-confirmed per provider's actual scheme (`t=`-timestamped for Stripe,
   cert-chain for PayPal, HMAC-SHA512 for Paystack); provider retry behavior mapped to the
   terminal/transient rejection table in PAYMENT-RECONCILIATION-REPORT.md.
4. Evidence with provider event IDs (redacted accounts) filed per provider.
5. **Never real customer funds.** Test credentials retired before production key minting.

**Standing state until then:** receivers fail closed; only the in-app sandbox gateway settles.
