# Proposed scope — signed webhook pipeline (NOT AUTHORIZED, NOT STARTED)

**Status: proposal only. No work has begun. Awaiting explicit approval.**

This document exists solely because you asked for a proposed scope after the concurrency fix and
the 5B corrections. Nothing here has been implemented, no file has been created for it, and no
provider has been contacted, configured or credentialed.

## The gap this would close

Phase 5C shipped real HMAC-SHA256 signing primitives (`src/payments/webhook-signing.ts`) and a
sandbox payload builder (`src/payments/sandbox-gateway.ts#buildSignedWebhookPayload`), both of
which are genuinely cryptographic and independently verified. What it did **not** ship is anything
that receives a webhook:

- No webhook route is registered anywhere in the application.
- `verifySignature` is never called by any route — only by tests.
- `buildSignedWebhookPayload` has no production consumer — its only reference in the repository is
  `tests/integration/payments-schema.test.ts`.
- A correctly-signed "payment successful" payload POSTed to every plausible path returns **404**
  and changes nothing; the payment stays `pending`.

Consequently a `sandbox` payment **cannot currently reach a terminal state by any route**. The
sandbox payment pipeline is **not end-to-end functional**, and this document does not claim
otherwise.

## Proposed scope, if and when authorized

Deliberately small, and deliberately sandbox-only.

### In scope

1. **One receiver route** — `POST /api/v1/webhooks/sandbox`, with raw-body capture (Fastify parses
   JSON by default; the signature must be computed over the exact received bytes, not over a
   re-serialised object, or verification will fail spuriously and tempt someone to weaken it).
2. **Signature verification before anything else** — reject with 401 before the body is parsed,
   interpreted, or logged. Using the existing `verifySignature`, which already uses
   `timingSafeEqual` and fails closed on length mismatch.
3. **Replay protection** — reject events whose `occurredAt` is outside a short window, and reject
   an event id already processed.
4. **Idempotency** — a duplicate delivery of the same event must be a no-op returning the same
   response, never a second ledger entry. The existing partial unique index on
   `(provider, provider_reference)` is the right foundation.
5. **Payload/record agreement** — reject when the amount, currency, payment id or provider
   reference disagree with the stored payment row. A webhook must never be able to change what is
   owed.
6. **Reuse of the now-fixed transition path** — the receiver must resolve a payment through the
   same `expectedCurrentStatus` guard introduced for the manual path, so the webhook receiver
   cannot reintroduce the double-credit defect. This is the main reason to do the concurrency fix
   first, as you directed.
7. **Tests** — valid signature, invalid signature, tampered amount, tampered currency, unknown
   reference, replayed event, concurrent duplicate deliveries, malformed body, oversized body,
   missing signature header, and a full sandbox round trip proving a payment can reach
   `successful` only via a verified signature.

### Explicitly out of scope

- Any real payment provider. No Stripe/PayPal/Flutterwave/Paystack adapter, no SDK, no credentials,
  no outbound call, no account registration.
- Refunds, chargebacks, partial payments, reconciliation reporting.
- Customer-facing "Pay now" UI.
- Any migration, unless the replay-protection design needs a processed-events table — in which case
  it would be a **new additive** migration (`0023`), proposed and approved separately before being
  written.

### Open questions for you

1. Should replay protection use a dedicated `processed_webhook_events` table (needs an additive
   migration) or reuse `payments.provider_reference` (no migration, slightly weaker)?
2. Should the receiver be enabled by configuration (`SANDBOX_GATEWAY_WEBHOOK_SECRET` present) so it
   is inert in any environment that has not deliberately switched it on?
3. Should it be rate-limited separately from the global 300/min?

## What I will not do without your explicit approval

Begin this work, create any file for it, add any route, register any provider, add any credential,
or describe the sandbox pipeline as end-to-end functional.
