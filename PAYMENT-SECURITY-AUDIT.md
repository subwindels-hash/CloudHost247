# CloudHost247 — Payment Security Audit (Phase 4 independent, 2026-11-09)

Method: line-level re-review of the implementation (not the Phase-3 conclusions), plus live
adversarial probes (evidence: `docs/staging/phase4-independent-probe-evidence-2026-11-09.json`,
prior live run `docs/staging/staging-evidence-2026-11-09.json`, suite evidence 2,901/2,901
including `payment-authorization-matrix`, `financial-invariant-sweep`).

Files reviewed in full: `src/routes/webhooks.ts`, `src/services/webhook-service.ts`,
`src/payments/sandbox-gateway.ts`, `src/payments/webhook-signing.ts`, `src/payments/types.ts`,
`src/db/billing-ledger.ts`, `src/services/billing-service.ts` (refund path), `src/routes/payments.ts`,
`src/lib/money.ts` usage sites.

## Control-by-control verdicts

| Control | Implementation (verified at source) | Live probe | Verdict |
|---|---|---|---|
| Webhook signature | HMAC-SHA256 over **raw body bytes** and `crypto.timingSafeEqual`; malformed-length signature returns false (fail-closed, no throw); verification runs **before** JSON parse and before any DB call (`webhook-service` step 1) | tampered → 401 (Phase-3 step 25) | SOUND |
| Timestamp tolerance | 300 s freshness window **if `x-cloudhost-timestamp` present** | stale → 401 (Phase-3 step 26) | SOUND but see **P4-F1** |
| Replay protection | (gateway, providerEventId) unique row in `webhook_events` insert-first-dedup; crash-recovery lease with takeover only after expiry | byte-identical replay: processed→already_processed, ledger 2→2 (Phase-3 step 24; Phase-4 P-9 with **no timestamp header**: same dedup) | SOUND |
| Idempotency persistence | `webhook_events` is durable (Postgres), not in-memory — survives process restarts | restart-resilient evidence in recovery exercise (ledger rows intact) | SOUND |
| Invoice settlement | single transaction: payment pending→successful (optimistic `expectedCurrentStatus` compare-and-set), append-only ledger `payment` row derived from invoice (user+currency read from the invoice inside the INSERT — structurally unspoofable), invoice→paid, order→paid, provisioning hook (idempotent per (order,item)), audit log, lease completion | full chain observed; Phase-4 ledger counts | SOUND |
| Ledger consistency | append-only enforced by **database triggers** (migration 0019) in addition to code — no update/delete functions exist by design; whole-DB invariant sweep suite executes | ledger = charges+payments exactly reconciled | SOUND |
| Wrong amount | **B4 inside the settlement tx**: webhook cents AND recorded payment cents must equal invoice total cents exactly, any mismatch → event rejected + ValidationError, invoice untouched | wrong-amount → 400, invoice stays unpaid (Phase-3 step 27) | SOUND |
| Wrong currency | **B1**: payment.currency == invoice.currency == event.currency else reject | reflected in B1 code path; currency-uppercased in parse | SOUND (code + suite) |
| Failed outcomes | failed only from pending; invoice stays unpaid; audit-visible event status `failed` | failed → 200/unpaid (Phase-3 step 28) | SOUND |
| Ambiguous outcomes | unknown outcome ⇒ `unhandled` ⇒ event marked `ignored`, never settles | code-verified; Phase-3 step 27 covers the dangerous "wrong amount success" variant | SOUND |
| Refunds / reversals | **admin-only** `adminIssueRefund`: integer-cents validation, mandatory reason, invoice must be paid/partially_refunded, refundable balance = Σpayments−Σrefunds enforced, full refund flips statuses, append-only `refund` ledger row + audit event, all in one tx | **NOT executed live** (super_admin bootstrap boundary — honored, not bypassed); suite-covered | SOUND (code+tests); live run is a final-stage item |
| Owner-only initiation | invoice resolved by (`auth.userId`, id) — other tenants' ids ⇒ 404; anonymous 401 | Phase-4 probe: cross-tenant read 404, **cross-tenant initiation 404** | SOUND |
| Forbidden trust of client claims | `recordLedgerEntry` derives owner/currency from the invoice row; client values only cross-checked | reviewed line-level | SOUND |
| Provider-settlement exclusivity | no route lets a customer mark a payment successful (Phase 5C contract: pending-only initiation; settlement only via webhook receiver or manual-gateway staff confirm) | reviewed; code has no such branch | SOUND |

## Findings

- **P4-F1 (hardening, low):** sandbox gateway treats the timestamp header as *optional*; freshness
  enforced only when present. Live probe P-9 proves the impact is bounded: a timestamp-omitted
  replay of a settled event is accepted only as `already_processed` with zero ledger movement —
  idempotency + parity checks hold the wall. Still, requiring the timestamp for the sandbox gateway
  (and defining per-provider signed-timestamp schemes at live integration, e.g. Stripe's
  `t=` component) closes a gratuitous replay window for environments where the webhook store is
  unavailable. **Recommendation, not a certification failure.**
- **P4-F2 (contract ambiguity, cosmetic):** sandbox `parseEvent` accepts `amount` as
  string (major units) or number (cents). B4 exact-cent equality makes either representation safe,
  but the dual-unit contract should be documented string-first.
- **P4-F3 (operational):** webhook routes have no explicit per-route rate limit beyond the global
  limiter; each attempt inserts a webhook_events row. Dedup keeps correctness; operators should
  apply WAF/edge throttling in production.
- **P4-F4 (observability):** rejected webhook events return 4xx to the sender (correct for the
  sandbox/audit), but production provider practice generally expects a 2xx-with-rejected-status to
  stop provider retry storms; **verify each real provider's retry semantics before activation** or
  reconcile this contract at integration time (B-4).

## Invariant enforcement location (the audit question)

**Every financial invariant is enforced server-side**, and moreover below the HTTP layer:
B1/B2/B4/B5 parity checks run inside the settlement transaction; append-only-ness is enforced by
database triggers; initiation ownership is structurally scoped by query shape; refund caps derive
from ledger sums, not request input. The client cannot alter any of: currency, amount, recipient,
ownership, settlement state machine, ledger contents.

## Conclusion

No financial-security defect found. One bounded hardening recommendation (P4-F1), two
documentation/operational notes (P4-F2/F3), one provider-contract note (P4-F4). Sandbox-gateway
payment integrity: **CERTIFIED (sandbox)**. Real-provider variants of identical logic: **pending
owner credentials (B-4).**
