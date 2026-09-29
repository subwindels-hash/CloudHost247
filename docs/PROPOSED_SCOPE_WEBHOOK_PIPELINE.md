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
   an event already processed.

   > **Correction (2026-09-29).** An earlier draft of this document said "reject an event id
   > already processed". **There is no event id.** `SandboxWebhookPayload`
   > (`src/payments/sandbox-gateway.ts`) carries exactly `provider`, `providerReference`,
   > `paymentId`, `outcome`, `amount`, `currency`, `occurredAt` — no unique per-event identifier.
   > This matters because Phase 5C committed to that payload as "a known-correct shape for 5D to
   > start from", so discovering the omission mid-build would mean changing the very thing that
   > was supposed to be settled. See open question 1 below for the two honest options.
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

1. **How should a replayed event be recognised, given there is no event id?** Three options, in
   my order of preference:

   a. **Dedupe on a hash of the exact raw body** (no payload change, no migration if the hash is
      stored against the payment; an additive `processed_webhook_events` table if you want a
      proper audit trail). A genuine replay is a byte-identical re-delivery, so its hash matches;
      two legitimately different events differ in `occurredAt` and so hash differently. This works
      with the payload exactly as Phase 5C already built and signed it.

   b. **Add an `eventId` field** to `SandboxWebhookPayload`. Cleanest long term and closest to how
      real providers do it — but it changes the signed payload shape that 5C committed to, so the
      "known-correct groundwork" claim would need restating.

   c. **Key on `(paymentId, outcome)`** — no migration, but it cannot distinguish a replay from a
      legitimate second event for the same payment (a `failed` retried to `successful` is fine;
      two `successful` events are not). Weakest of the three.

   Option (a) needs no change to anything already written. I recommend it, but this is your call.
2. Should the receiver be enabled by configuration (`SANDBOX_GATEWAY_WEBHOOK_SECRET` present) so it
   is inert in any environment that has not deliberately switched it on?
3. Should it be rate-limited separately from the global 300/min?

## What I will not do without your explicit approval

Begin this work, create any file for it, add any route, register any provider, add any credential,
or describe the sandbox pipeline as end-to-end functional.
