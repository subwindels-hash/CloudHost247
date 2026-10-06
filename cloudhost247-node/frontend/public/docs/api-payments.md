# Payments API Contract (Phase 5C)

This document is the API contract for Phase 5C, "Payment integration": a payment gateway
abstraction, a manual/offline (bank-transfer) gateway with staff-confirmed resolution, and a
self-contained sandbox gateway that stops at initiation. Keep this in sync with the code — the
source of truth is `cloudhost247-node/src/payments/*`, `cloudhost247-node/src/routes/payments.ts`,
`cloudhost247-node/src/routes/admin-billing.ts`, `cloudhost247-node/src/services/payment-service.ts`,
and `cloudhost247-node/database/migrations/0021`–`0022`; this document should never describe
behavior the code doesn't actually have.

See `docs/API_BILLING.md` for the invoice/ledger layer this builds directly on top of.

## Explicit non-goals (this phase)

- **No webhook receiver exists yet, at all.** There is no route anywhere that accepts an inbound
  webhook call. `src/payments/webhook-signing.ts` (generic HMAC-SHA256 sign/verify) and
  `src/payments/sandbox-gateway.ts#buildSignedWebhookPayload` are groundwork only — proven correct
  by unit tests, wired into zero routes. Receiving, verifying, and idempotently processing a
  webhook is entirely **Phase 5D**.
- **A `sandbox`-provider payment can never leave `pending` in this phase.** Initiating one produces
  a realistic `providerReference` and `pending` status, exactly like a real hosted-checkout
  provider would — but nothing in this phase's code can ever mark it `successful`/`failed`, because
  that would require the (nonexistent) webhook receiver. `tests/integration/payments-api.test.ts`
  includes a static/grep-based test proving this boundary — that `updatePaymentStatus` (the only
  function capable of changing a payment's status) has exactly one caller in the entire codebase
  (`src/services/payment-service.ts`), and every call site there is preceded by a guard that
  requires `provider === 'manual'`.
- **The manual gateway's resolution is a direct, audited human action, not an automated one.** A
  staff member (`admin` or `super_admin`) explicitly asserts "this bank transfer arrived" or "it
  didn't" via two narrow endpoints (see below). This is the one deliberate exception the Phase 5
  spec's "no simulated success" rule allows for — it is not a simulated webhook, it is a person
  making a real-world claim, and it is permanently attributed to them
  (`payments.confirmed_by_user_id`) and logged to `auth_audit_log`.
- **No broader admin billing dashboard.** The two new admin endpoints in this phase exist only to
  resolve a `manual`-provider payment. Searching/filtering/viewing all invoices across every
  customer, issuing refunds, etc. remain deferred to Phase 5F.
- **No real, external payment provider (Stripe/PayPal/etc.) integration.** `manual` and `sandbox`
  are the only two gateways. Adding a real one later means adding one more `PaymentGateway`
  implementation and registering it in `src/payments/gateway-registry.ts` — no other code needs to
  change, since routes and services already work only in terms of the `PaymentGateway` interface.
- **No customer billing UI wiring yet** (a "Pay now" button, a payment-status page) — that's Phase
  5E. This phase is backend-only, per the locked "checkpoint after every sub-phase" cadence.
- Still single-currency (`USD`), still no cPanel/WHM/registrar automation of any kind.

## Architecture

```
Customer-facing payment API (Fastify routes)
  src/routes/payments.ts            (/api/v1/invoices/:id/payments, /api/v1/payments/:id)
Staff-facing payment API (Fastify routes)
  src/routes/admin-billing.ts       (/api/v1/admin/payments/:id/confirm-manual, .../reject-manual)
        │
        ▼
Service layer
  src/services/payment-service.ts
    initiatePaymentForInvoice()  ───► calls a gateway, then writes the `payments` row atomically
    getMyPaymentDetail()
    confirmManualPayment() / rejectManualPayment()  ───► manual gateway's own resolution path
        │
        ▼
Gateway abstraction                              Repository layer
  src/payments/types.ts       (PaymentGateway interface)   src/db/payments.ts
  src/payments/manual-gateway.ts   (id='manual')            src/db/invoices.ts (setInvoiceStatus)
  src/payments/sandbox-gateway.ts  (id='sandbox')            src/db/orders.ts  (setOrderPaymentStatus)
  src/payments/gateway-registry.ts (id -> implementation)    src/db/billing-ledger.ts (recordLedgerEntry)
  src/payments/webhook-signing.ts  (HMAC sign/verify — Phase 5D groundwork, unused by any route)
        │
        ▼
PostgreSQL (database/migrations/0021..0022, extending 0020's `payments` table and 0002/0013's
`auth_audit_log`)
```

Every response is built only through `src/dto/payments.ts` — the same "never leak an internal
field, never fabricate a value" mapping-layer pattern used throughout this codebase.

## Data model summary

- `payments.confirmed_by_user_id` (`0021`) — `uuid NULL REFERENCES users(id) ON DELETE SET NULL`.
  Records which staff member confirmed/rejected a manual payment. `NULL` for every
  `sandbox`-provider payment (nothing automated has confirmed anything yet in this phase) and for
  every payment still `pending`. `ON DELETE SET NULL`, not `RESTRICT`: deleting the staff account
  that once confirmed a payment must never be blocked by, or corrupt, that payment's own record.
- `auth_audit_log.event_type` (`0022`) — widened (same drop/re-add `CHECK` pattern as `0013`) to
  additionally allow `payment_initiated`, `manual_payment_confirmed`, `manual_payment_rejected`.

## Payment gateway abstraction (`src/payments/types.ts`)

```ts
interface PaymentGateway {
  readonly id: string;
  initiatePayment(input: InitiatePaymentInput, env: Env): Promise<GatewayInitiationResult>;
}
```

`initiatePayment` only ever returns "here are the details of a now-pending attempt" — never
"whether it succeeded." Every real gateway confirms a payment asynchronously (redirect, webhook, or
here, a human); modelling the interface this way keeps Phase 5D's job (receiving those async
confirmations) a separate, additive layer instead of something baked into this interface's shape.

### `manual` gateway (`src/payments/manual-gateway.ts`)

The "offline" gateway. `providerReference` is always `null` (there is no external system).
`method` is always `bank_transfer`. `instructions` come from the `MANUAL_PAYMENT_INSTRUCTIONS` env
var if set, or an honest generic fallback ("...contact support...") if not — **never a fabricated
bank account/reference number**. The payment stays `pending` until a staff member calls one of the
two admin endpoints below.

### `sandbox` gateway (`src/payments/sandbox-gateway.ts`)

A self-contained "fake real gateway" for demoing/testing the async, webhook-driven flow without a
real integration or real money. `providerReference` is `sandbox_<32 hex chars>` (unique per call).
`method` is always `sandbox_demo`. As documented above, a sandbox payment cannot leave `pending` in
this phase. `buildSignedWebhookPayload(payment, outcome, env)` produces the exact JSON payload and
HMAC-SHA256 signature (under `SANDBOX_GATEWAY_WEBHOOK_SECRET`) that Phase 5D's webhook receiver will
need to accept — not called by any route yet.

### Gateway registry (`src/payments/gateway-registry.ts`)

`getGateway(id, env)` resolves `'manual'` or `'sandbox'` to their implementation, or throws a `400
VALIDATION_ERROR` for anything else. `AVAILABLE_GATEWAY_IDS` is the exact set the customer-facing
`gateway` request field accepts, kept in the same module so the two can never drift apart.

## New environment variables

| Variable | Required? | Purpose |
|---|---|---|
| `MANUAL_PAYMENT_INSTRUCTIONS` | No | Free-text bank-transfer/cash instructions shown when a customer chooses the `manual` gateway. If unset, an honest generic fallback message is shown — never a fabricated bank account. |
| `SANDBOX_GATEWAY_WEBHOOK_SECRET` | No (validated only if/when actually used) | HMAC secret the sandbox gateway signs its (not-yet-wired-up) webhook payloads with. A deployment that never exercises the sandbox gateway never needs to set it. |

## Authorization model

Same "404, never 403" ownership pattern as every other customer-facing route in this codebase for
the two customer-facing endpoints. The two new admin endpoints are gated to `admin` **and**
`super_admin` (not `super_admin`-only) — confirming/rejecting a manual bank-transfer payment is
routine billing support work, the staff equivalent of an automated webhook arriving, not an
account-integrity action; it can't lock anyone out of their account or escalate anyone's privilege.
This mirrors the same `admin`+`super_admin` split already used for routine customer support work in
`src/routes/admin-customers.ts`.

| Capability | customer | admin | super_admin |
|---|---|---|---|
| Initiate a payment for own invoice | ✅ (self only) | ✅ (self only, as a customer) | ✅ (self only, as a customer) |
| View own payment detail | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| View/confirm/reject another customer's payment as staff | ❌ | ✅ (confirm/reject-manual only) | ✅ (confirm/reject-manual only) |
| Broader billing dashboard (search/filter/refunds) | ❌ | ❌ (deferred to 5F) | ❌ (deferred to 5F) |

## Endpoints

All endpoints require `Authorization: Bearer <token>` and return `401` if missing/invalid.

### `POST /api/v1/invoices/:id/payments`

Initiates a new payment attempt for one of the caller's own invoices.

Request body: `{ "gateway": "manual" | "sandbox" }`

Rules:
- `404` if the invoice doesn't exist or isn't owned by the caller (never distinguishable from one
  that doesn't exist).
- `400` if the invoice's `status` is not `unpaid` (e.g. already `paid`).
- `400` if `gateway` isn't one of the registered ids.
- Any other payment attempt for the same invoice still sitting in `pending` is cancelled first —
  a customer can always abandon a stale attempt and start a fresh one.
- Logs a `payment_initiated` event to `auth_audit_log` (actor = the initiating customer).

```json
// 201 Created
{
  "payment": {
    "id": "…", "invoiceId": "…", "provider": "manual", "providerReference": null,
    "method": "bank_transfer", "amount": "24.50", "currency": "USD", "status": "pending",
    "failureReason": null, "initiatedAt": "2026-09-28T…", "completedAt": null,
    "instructions": "Bank transfer instructions have not been configured for this environment yet. Please contact support with your invoice number to arrange payment."
  }
}
```

`instructions` is only ever populated on this immediate initiation response — it is a property of
the gateway call that created the attempt, not persisted on the `payments` row, so it is `null` on
every later read of the same payment via `GET /api/v1/payments/:id` or an invoice's `payments` list.

### `GET /api/v1/payments/:id`

Ownership-checked read of a single payment (`404`, not `403`, for another customer's payment).

```json
{ "payment": { "id": "…", "invoiceId": "…", "provider": "sandbox", "providerReference": "sandbox_ab12…", "method": "sandbox_demo", "amount": "15.00", "currency": "USD", "status": "pending", "failureReason": null, "initiatedAt": "2026-09-28T…", "completedAt": null, "instructions": null } }
```

### `POST /api/v1/admin/payments/:id/confirm-manual`

**Staff only (`admin` or `super_admin`).** Asserts that a manual/offline payment was actually
received. Atomically:
1. Marks the payment `successful`, recording `confirmed_by_user_id` = the acting staff member's id.
2. Records a `payment` ledger entry (`src/db/billing-ledger.ts`).
3. Marks the invoice `paid`.
4. Marks the parent order's `payment_status` `paid` — the order's own fulfillment `status` is
   deliberately left untouched (order lifecycle and payment status remain separate concerns, per
   Phase 5A/5B's design).
5. Logs a `manual_payment_confirmed` event to `auth_audit_log` (actor = the confirming staff
   member; metadata includes the target customer's id).

Rules: `404` if the payment doesn't exist. `400` if `provider !== 'manual'` (this route cannot
touch a `sandbox` payment) or the payment's `status` isn't `pending` (already resolved, or
cancelled).

```json
// 200 OK
{ "payment": { "id": "…", "status": "successful", "completedAt": "2026-09-28T…", … } }
```

### `POST /api/v1/admin/payments/:id/reject-manual`

**Staff only (`admin` or `super_admin`).** Asserts that a manual/offline payment did *not* arrive.

Request body: `{ "reason": "…" }` (required, non-empty).

Marks the payment `failed` with the given `failureReason`. No ledger entry is recorded (nothing was
actually charged); the invoice is left `unpaid` so the customer can initiate a fresh attempt. Logs a
`manual_payment_rejected` event to `auth_audit_log`. Same `404`/`400` guards as confirm-manual.

## What's next (later Phase 5 sub-phases)

- **5D** — a real webhook-receiving route: signature verification (`src/payments/webhook-signing.ts`
  is already built and tested for this), idempotency (`findPaymentByProviderReference` is already
  in place), and replay protection — the *only automated* way a `sandbox` (or future real-provider)
  payment can ever leave `pending`.
- **5E/5F** — customer-facing "Pay now" UI and the broader admin billing dashboard
  (search/filter/view-all-invoices, refunds).
- **5G** — SMTP notifications (payment received/failed) and reconciliation jobs.
