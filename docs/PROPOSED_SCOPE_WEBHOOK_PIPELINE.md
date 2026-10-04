# CloudHost247 — Phase 5D Design & Implementation Proposal: External Payment Webhook Pipeline & Gateway Architecture

**Status**: **PROPOSAL & SCOPE DEFINITION ONLY — NOT AUTHORIZED · NOT IMPLEMENTED · NOT DEPLOYED**  
**Date**: 2026-09-29  
**Target Milestone**: Phase 5D (External Gateway Webhooks & Asynchronous Reconciliation)  
**Prerequisites**: Phase 5A (Accepted), Phase 5B (Accepted B1–B4; B5 separately recorded), Phase 5C (Accepted manual/sandbox synchronous flows)  
**Standing Restrictions**: Financial code frozen, no live credentials, no database migrations created or executed, PR #12 open and unmerged.

> **Status update 2026-10-04 (owner authorization — staging scope only; recorded by the platform
> agent).** The repository owner explicitly authorized execution of migrations **0023, 0024, 0025**
> and **0041** against the **staging database to be provisioned**. **Production remains NOT
> authorized**, the code quarantine in `database/migrate.ts` is unchanged, and nothing has executed
> yet. Per `docs/WEBHOOK_PIPELINE_UNFREEZE_RUNBOOK.md`, the stamp above is updated after an
> authorized execution has taken place. The "PR #12 open and unmerged" wording in the header line
> above is stale — re-verified 2026-10-04: `gh pr view 12` returns `state: CLOSED`, `mergedAt: null`.

---

## 1. Gateway Architecture & Provider Abstraction

To ensure provider-specific protocols, header schemas, and payload quirks do not contaminate core commerce and billing logic, all external integrations implement a unified `PaymentGateway` and `WebhookHandler` abstraction. Core billing code interacts exclusively with a normalized, canonical DTO.

```
                                      ┌────────────────────────────────────────────────────────┐
                                      │              HTTP POST /api/v1/webhooks/:gateway        │
                                      └──────────────────────────┬─────────────────────────────┘
                                                                 │
                                                    [Raw Byte Stream Capture Hook]
                                                    (request.rawBody = unparsed Buffer)
                                                                 │
                                              ┌──────────────────▼──────────────────┐
                                              │  Gateway Resolution & Signature Auth │
                                              │    (verifyWebhookSignature BEFORE    │
                                              │      JSON parsing or DB queries)     │
                                              └──────────────────┬──────────────────┘
                                                                 │ (Signature Valid)
                                              ┌──────────────────▼──────────────────┐
                                              │     Canonical Event Normalization    │
                                              │   (Provider Adapter -> WebhookDTO)   │
                                              └──────────────────┬──────────────────┘
                                                                 │
                                              ┌──────────────────▼──────────────────┐
                                              │   Durable Event Lease & Idempotency  │
                                              │ (Acquire/Renew Lease in webhook_events│
                                              │      with crash recovery timeout)    │
                                              └──────────────────┬──────────────────┘
                                                                 │
                                              ┌──────────────────▼──────────────────┐
                                              │     Zero-Trust Payload Cross-Check   │
                                              │ (Verify payment exists, status=pend,│
                                              │  amount=invoice.total, curr=matches)│
                                              └──────────────────┬──────────────────┘
                                                                 │
                                              ┌──────────────────▼──────────────────┐
                                              │     Atomic Financial Transaction    │
                                              │         (withTransaction)           │
                                              │  1. UPDATE payments status=success  │
                                              │  2. INSERT billing_ledger payment   │
                                              │  3. UPDATE invoices status=paid     │
                                              │  4. UPDATE orders pay_status=paid   │
                                              │  5. UPDATE webhook_events completed │
                                              └──────────────────┬──────────────────┘
                                                                 │
                                                      [200 OK Acknowledgment]
```

### 1.1 Provider-Neutral Canonical Webhook DTO

The core billing engine never parses Stripe, PayPal, or Paystack payload structures. Each gateway adapter transforms the verified raw event into a normalized `WebhookEventDTO`:

```typescript
export interface WebhookEventDTO {
  gateway: 'stripe' | 'paypal' | 'paystack' | 'sandbox';
  providerEventId: string;           // Provider's unique event ID (e.g., 'evt_1N...', 'WH-8...', 'ev_...')
  providerTransmissionId?: string;   // Provider's transmission/delivery ID (e.g., PayPal transmission ID)
  providerPaymentReference: string;  // Provider's payment intent / capture reference
  cloudhostPaymentId?: string;       // CloudHost247 payment UUID if present in custom_id / metadata
  canonicalEventType: 'payment.success' | 'payment.failed' | 'payment.cancelled' | 'unhandled';
  eventOccurredAt: Date;             // Timestamp reported by provider
  receivedAt: Date;                  // Ingestion timestamp at CloudHost247 edge
  amountCents: number;               // Normalized integer amount in cents
  currency: string;                  // Normalized uppercase 3-letter ISO currency code
  outcome: 'succeeded' | 'failed' | 'pending' | 'unhandled';
  failureReason?: string;            // Standardized error message on failure
  rawPayloadHash: string;            // SHA-256 digest of original raw request Buffer
}
```

---

## 2. Provider-Specific Verification, Delivery & Event Specifications

Each payment provider is handled by an isolated adapter implementing provider-specific cryptographic verification, freshness validation, and idempotency mapping:

### 2.1 Stripe (`/api/v1/webhooks/stripe`)
- **Signature Scheme**: HMAC-SHA256 via `Stripe-Signature` header (`t=timestamp,v1=signature`).
- **Signature Computation**: `HMAC-SHA256(STRIPE_WEBHOOK_SECRET, "${t}.${rawBody.toString('utf8')}")`.
- **Freshness & Replay**:
  - Extracts timestamp `t` from header. Rejects requests if `|NOW() - t| > 300` seconds (5-minute tolerance window).
  - Uses `timingSafeEqual` over hex-encoded digest strings.
- **Idempotency Identity**: `event.id` (e.g., `evt_1N...`).
- **Authoritative Event Policy**:
  - **`payment_intent.succeeded`**: **Authoritative financial success event**. Transitions payment to `successful` and records billing ledger entry.
  - **`payment_intent.payment_failed`**: **Authoritative failure event**. Transitions payment to `failed` with provider reason; invoice remains `unpaid`.
  - **`payment_intent.canceled`**: Transitions payment to `cancelled`.
  - **`checkout.session.completed`**: Acknowledged with `200 OK` as an order-completion indicator, but **NOT** used for ledger credit if `payment_intent.succeeded` is enabled (prevents dual-event credit).
  - **`checkout.session.async_payment_succeeded`**: Authoritative only for delayed payment methods (e.g., SEPA/ACH).
  - **`checkout.session.async_payment_failed`**: Transitions delayed attempt to `failed`.
  - **`payment_intent.processing`**: Acknowledged with `200 OK`; payment remains `pending`.

### 2.2 PayPal (`/api/v1/webhooks/paypal`)
- **Signature Scheme**: Asymmetric RSA-SHA256 via standard PayPal verification headers:
  - `paypal-transmission-id`: Unique transmission UUID.
  - `paypal-transmission-time`: ISO-8601 UTC timestamp.
  - `paypal-transmission-sig`: Base64-encoded RSA signature.
  - `paypal-cert-url`: HTTPS URL of PayPal's public X.509 signing certificate.
  - `paypal-auth-algo`: Signature algorithm (must be `SHA256withRSA`).
- **Signature Verification String**:
  $$\text{verification\_string} = \text{transmission\_id} \,\|\, \text{transmission\_time} \,\|\, \text{PAYPAL\_WEBHOOK\_ID} \,\|\, \text{CRC32}(\text{rawBody})$$
  *(Note: CRC32 is computed as a decimal string over the unparsed raw request Buffer).*
- **Certificate Validation & SSRF Prevention Policy**:
  To prevent Server-Side Request Forgery (SSRF) and malicious certificate injection:
  1. **Strict Protocol**: Must be `https:`.
  2. **Hostname Allowlist**: Must strictly match PayPal trusted domains (`api.paypal.com`, `api.sandbox.paypal.com`, `api-m.paypal.com`, `api-m.sandbox.paypal.com`).
  3. **No Private/Internal IP**: Resolved IP address must not be in loopback (`127.0.0.0/8`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), or link-local (`169.254.0.0/16`) ranges.
  4. **No Arbitrary Redirects**: Certificate fetch disables HTTP redirects (`redirect: 'error'`).
  5. **Secure In-Memory Caching & Rotation**: Certificates are cached by URL in memory for up to 24 hours with an LRU cap (max 10 certs). Expired or rotated certificates trigger a fresh fetch against the allowlisted URL.
- **Freshness & Replay**:
  - Parses `paypal-transmission-time`. Rejects if `|NOW() - transmission_time| > 600` seconds (10-minute tolerance).
  - Uses `event.id` (e.g., `WH-...`) for durable deduplication; logs `transmission-id` for transmission audit.
- **Authoritative Settlement Policy (Approval vs. Capture)**:
  - **`PAYMENT.CAPTURE.COMPLETED`**: **The ONLY authoritative financial settlement event**. Marks payment `successful`, invoice `paid`, order `paid`, and writes 1 ledger payment row.
  - **`CHECKOUT.ORDER.APPROVED`**: **APPROVAL ONLY — NOT A SETTLEMENT**. Marks buyer intent only. **Must NOT** mark invoice `paid`, **must NOT** mark payment `successful`, and **must NOT** write any ledger entry.
  - **`PAYMENT.CAPTURE.DENIED` / `PAYMENT.CAPTURE.DECLINED`**: Transitions payment `pending → failed`.
  - **`PAYMENT.CAPTURE.REFUNDED`**: Handled as unhandled / recorded in audit only.

### 2.3 Paystack (`/api/v1/webhooks/paystack`)
- **Signature Scheme**: HMAC-SHA512 via `x-paystack-signature` header.
- **Signature Computation**: `HMAC-SHA512(PAYSTACK_SECRET_KEY, rawBody)`. Verified with `timingSafeEqual`.
- **Delivery Model & Retry Handling**:
  - Paystack sends POST requests with a 20-second timeout.
  - Retries exponentially if non-200 received.
  - Signature verification runs **before** financial checks or database queries. Returns `200 OK` on successful authentication to prevent duplicate delivery loops.
- **Idempotency Identity**: `event.data.reference` (transaction reference) combined with `event.event` or `event.data.id`.
- **Authoritative Event Policy**:
  - **`charge.success`**: **Authoritative financial success event**. Transitions payment to `successful` and records ledger credit.
  - **`charge.failed`**: Transitions payment to `failed`.

### 2.4 Sandbox Gateway (`/api/v1/webhooks/sandbox`)
- **Signature Scheme**: HMAC-SHA256 via `x-cloudhost-signature` and `x-cloudhost-timestamp`.
- **Signature String**: `${timestamp}.${rawBody.toString('utf8')}`. Verified with `timingSafeEqual`.
- **Freshness**: Rejects if `|NOW() - timestamp| > 300` seconds.
- **Simulation Isolation**: Provider ID is strictly `'sandbox'`, methods prefixed `sandbox_demo`, references prefixed `sandbox_`. Never connects to external networks.

---

## 3. Webhook Raw-Body Guarantee & Security Architecture

### 3.1 Raw-Body Guarantee in Fastify
Fastify's default JSON parser destructively re-encodes request bodies. To guarantee 100% cryptographic integrity:
1. Fastify configures a custom content parser for `application/json` on webhook routes:
   ```typescript
   fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
     req.rawBody = body; // Unparsed Buffer attached directly
     try {
       const json = JSON.parse(body.toString('utf8'));
       done(null, json);
     } catch (err) {
       done(err, undefined);
     }
   });
   ```
2. Cryptographic signature verification and SHA-256 payload hashing (`rawPayloadHash`) compute directly over `req.rawBody`.
3. No JSON re-serialization or stringification is ever used for signature validation.

### 3.2 Security Controls & Threat Mitigations

| Threat Vector | Attack Scenario | Mitigation in Phase 5D Design |
| :--- | :--- | :--- |
| **Forged Webhook** | Attacker POSTs fake JSON claiming payment success. | Rejected immediately (`401 Unauthorized`) via HMAC-SHA256/RSA verification before any database interaction. |
| **PayPal Malicious Cert / SSRF** | Attacker passes `paypal-cert-url: http://169.254.169.254/latest/meta-data` or private IP. | Cert fetcher enforces HTTPS, validates domain against `*.paypal.com` allowlist, blocks private/loopback IPs, and disables redirects (`401 Unauthorized`). |
| **Replay Attack** | Attacker replays a valid historical signed payload. | Rejected by timestamp freshness window (<300s/600s) or by unique constraint in `webhook_events`. |
| **Amount Tampering** | Attacker pays $0.01 for a $1,000 order and alters JSON payload amount. | Server **never** trusts payload amount. Validates `webhook.amount == payment.amount == invoice.total_amount`. Mismatch triggers transaction rollback (`400 Bad Request`). |
| **Currency Tampering** | Attacker pays 100 NGN instead of 100 USD. | Trigger `trg_enforce_payment_billing_invariants` & webhook pre-check enforce currency exact match against parent invoice (Invariant B1). |
| **Cross-Tenant Substitution** | Attacker applies valid payment ID to another user's invoice. | Trigger `trg_enforce_payment_billing_invariants` rejects user mismatch (Invariant B2). |
| **Concurrent Duplicate Deliveries** | Provider sends 8 simultaneous webhooks across worker threads. | Unique constraint on `webhook_events(gateway, event_id)` + atomic `UPDATE payments ... WHERE status = 'pending'`. Exactly 1 thread updates 1 row; 7 threads update 0 rows. |
| **Browser Injection** | Customer attempts to invoke `/api/v1/webhooks/*` from browser. | Webhook routes reject requests missing valid provider signature headers (`401 Unauthorized`). |
| **Secret Leakage Prevention** | Webhook secrets logged or leaked in API responses. | Logger configuration redacts `*signature*`, `*secret*`, `*token*`. Secrets are never returned in HTTP bodies or bundled into frontend assets. |

---

## 4. Amount and Payment Scope Limitations for Phase 5D

To preserve rock-solid financial integrity, Phase 5D explicitly enforces the following scope boundaries:

1. **One Full Payment per Invoice**: Phase 5D supports **only full payments** where `payment.amount == invoice.total_amount`.
2. **No Partial Payments in Phase 5D**: Webhooks presenting `amount < invoice.total_amount` are rejected.
3. **No Overpayments in Phase 5D**: Webhooks presenting `amount > invoice.total_amount` are rejected (Invariant B4).
4. **Single Active Payment Attempt**: A new payment initiation automatically cancels any previous pending attempt.
5. **No Automated Refunds / Splits in Phase 5D**: Split captures, multi-party payouts, provider fee subtractions, and automated refund ledger adjustments are deferred to Phase 5F.

---

## 5. Durable Idempotency, Processing Lease & Crash Recovery

### 5.1 Proposed Candidate Migration Schema (`0024_create_webhook_events.sql` — Proposed Only)

```sql
-- Candidate Migration 0024: Create webhook_events table for durable idempotency & lease recovery.
-- PROPOSED ONLY - NOT AUTHORIZED FOR CREATION OR EXECUTION.

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway VARCHAR(32) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  transmission_id VARCHAR(255),
  event_type VARCHAR(64) NOT NULL,
  provider_reference VARCHAR(255),
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed', 'rejected', 'ignored')),
  payload_hash VARCHAR(64) NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  processing_node_id VARCHAR(64),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMPTZ,
  CONSTRAINT webhook_events_gateway_event_id_unique UNIQUE (gateway, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_lookup
  ON webhook_events (gateway, event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_payment
  ON webhook_events (payment_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_lease
  ON webhook_events (status, lease_expires_at)
  WHERE status = 'processing';
```

### 5.2 Processing Lease & Crash Recovery State Machine

To prevent an abandoned `processing` row (caused by node crash or unhandled kill) from permanently blocking subsequent legitimate provider retries:

1. **Lease Allocation**: When a new webhook arrives, `INSERT INTO webhook_events` sets `status = 'processing'` and `lease_expires_at = NOW() + INTERVAL '60 seconds'`.
2. **Lease Takeover on Retry**: If a retry for the same `(gateway, event_id)` arrives while `status = 'processing'`:
   - **Active Lease (`lease_expires_at > NOW()`)**: Another thread is currently processing the event. Return `200 OK` (or `409 Conflict`) to let the active thread finish.
   - **Expired Lease (`lease_expires_at <= NOW()`)**: Previous worker crashed. The retry executes an atomic lease takeover:
     ```sql
     UPDATE webhook_events
     SET lease_expires_at = NOW() + INTERVAL '60 seconds',
         processing_node_id = $new_node_id,
         received_at = NOW()
     WHERE gateway = $1 AND event_id = $2 AND status = 'processing' AND lease_expires_at <= NOW()
     RETURNING id;
     ```
   - If the update succeeds, the worker re-initiates the financial transaction.
3. **Completion**: Upon successful commit of `payments`, `billing_ledger`, `invoices`, and `orders`, `webhook_events.status` is updated to `'completed'`, clearing the lease.

---

## 6. Financial State Machine & Concurrency Strategy

### 6.1 State Transitions

```text
[Payment Lifecycle]
       ┌───────────────┐
       │    pending    │
       └───┬───────┬───┘
           │       │
 (Webhook  │       │ (Webhook
  Success) │       │  Failure)
           ▼       ▼
┌──────────────┐ ┌──────────────┐
│  successful  │ │    failed    │
└──────────────┘ └──────────────┘

[Invoice Lifecycle]
       ┌───────────────┐
       │    unpaid     │
       └───────┬───────┘
               │ (Atomic with Payment 'successful')
               ▼
       ┌───────────────┐
       │     paid      │
       └───────────────┘
```

**Forbidden Terminal State Rewrites**:
- `successful → successful` (rejected; never appends a second ledger entry).
- `successful → failed` (rejected).
- `successful → cancelled` (rejected).
- `failed → successful` (rejected; requires opening a new payment attempt).
- `cancelled → successful` (rejected).

### 6.2 Authoritative Database Concurrency Controls
1. **No Application-Only Locks**: Concurrency safety relies strictly on PostgreSQL transaction isolation and database constraints.
2. **Row-Level Lock**: Webhook processing acquires `SELECT ... FROM payments WHERE id = $1 FOR UPDATE`.
3. **Atomic Conditional Update**:
   ```sql
   UPDATE payments
   SET status = 'successful', completed_at = NOW(), updated_at = NOW()
   WHERE id = $1 AND status = 'pending'
   RETURNING id;
   ```
   If 0 rows are updated, the transaction aborts without creating a ledger entry.
4. **Append-Only Trigger Safety**: Trigger `trg_billing_ledger_no_update_delete` ensures ledger entries are immutable once written.

---

## 7. Deterministic HTTP Response Policy

| Processing Condition | HTTP Status Code | Response Body | Provider Action | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Valid & Processed** | `200 OK` | `{"received": true, "status": "processed"}` | Halts retry | State successfully transitioned and committed. |
| **Duplicate Already Completed** | `200 OK` | `{"received": true, "status": "already_processed"}` | Halts retry | Idempotent acknowledgment; no second financial mutation. |
| **Duplicate In-Flight (Active Lease)** | `200 OK` | `{"received": true, "status": "in_progress"}` | Halts retry | Concurrent worker is already executing transaction. |
| **Valid but Unsupported Event** | `200 OK` | `{"received": true, "status": "ignored"}` | Halts retry | Unhandled event recorded in audit log; no retry needed. |
| **Invalid Signature / Malicious Cert** | `401 Unauthorized` | `{"error": "INVALID_SIGNATURE"}` | Provider alerts | Request failed cryptographic or allowlist checks. |
| **Malformed JSON Payload** | `400 Bad Request` | `{"error": "MALFORMED_PAYLOAD"}` | Provider alerts | Body cannot be parsed into required schema. |
| **Invariant Mismatch (B1–B5)** | `400 Bad Request` | `{"error": "INVARIANT_VIOLATION"}` | Provider alerts | Currency, owner, or ceiling mismatch against server invoice. |
| **Unknown Payment / Order Reference** | `404 Not Found` | `{"error": "PAYMENT_NOT_FOUND"}` | Provider alerts | Webhook references non-existent CloudHost247 entity. |
| **Internal DB Error / Crash** | `500 Internal Error` | `{"error": "INTERNAL_ERROR"}` | Triggers retry | Transient failure; provider retries during lease recovery window. |

---

## 8. Comprehensive Adversarial Test Matrix

| Test ID | Category | Scenario / Attack Vector | Expected HTTP | Expected Database State |
| :--- | :--- | :--- | :--- | :--- |
| **T01** | Stripe Success | Valid HMAC-SHA256 signature, `payment_intent.succeeded` | `200 OK` | `payments.status='successful'`, `invoices.status='paid'`, 1 `billing_ledger` row, `webhook_events.status='completed'`. |
| **T02** | Stripe Tamper | Tampered payload amount with original signature | `401 Unauthorized` | State unchanged. Zero DB writes. |
| **T03** | Stripe Replay | Valid signature with timestamp older than 300s | `401 Unauthorized` | State unchanged. Zero DB writes. |
| **T04** | PayPal Success | Valid RSA-SHA256 signature, `PAYMENT.CAPTURE.COMPLETED` | `200 OK` | `payments.status='successful'`, `invoices.status='paid'`, 1 ledger row. |
| **T05** | PayPal Intent Only | Valid signature, `CHECKOUT.ORDER.APPROVED` | `200 OK` | `payments.status='pending'`, `invoices.status='unpaid'`, 0 ledger rows. |
| **T06** | PayPal SSRF 1 | `paypal-cert-url` pointing to `http://169.254.169.254` | `401 Unauthorized` | Rejected before network call. Zero DB writes. |
| **T07** | PayPal SSRF 2 | `paypal-cert-url` pointing to `https://evil.com/cert.pem` | `401 Unauthorized` | Domain not in allowlist. Zero DB writes. |
| **T08** | PayPal SSRF 3 | `paypal-cert-url` pointing to `http://api.paypal.com` (non-HTTPS) | `401 Unauthorized` | Non-HTTPS rejected. Zero DB writes. |
| **T09** | PayPal Bad Sig | Malformed RSA signature bytes | `401 Unauthorized` | Fails closed. State unchanged. |
| **T10** | PayPal Cert Rotation| Valid signature with new, valid allowlisted PayPal cert | `200 OK` | Fetches new cert, caches it, processes payment successfully. |
| **T11** | Paystack Success | Valid HMAC-SHA512 signature, `charge.success` | `200 OK` | `payments.status='successful'`, `invoices.status='paid'`, 1 ledger row. |
| **T12** | Paystack Mutate | Flipped byte in `x-paystack-signature` | `401 Unauthorized` | Fails closed. Zero DB writes. |
| **T13** | Currency Mismatch | Valid signature, but webhook currency `EUR` vs invoice `USD` | `400 Bad Request` | Trigger rejects. Payment stays `pending`, 0 ledger rows. |
| **T14** | Ceiling Violation | Valid signature, but webhook amount > invoice total | `400 Bad Request` | Trigger rejects. Payment stays `pending`, 0 ledger rows. |
| **T15** | Cross-Tenant Attack | Webhook references stranger's `user_id` | `400 Bad Request` | Trigger rejects. State rolled back. |
| **T16** | Exact Duplicate | Same event ID sent 5 seconds later | `200 OK` | 1 total ledger row, payment stays `successful`. |
| **T17** | Concurrent Bursts | 8 identical webhooks delivered simultaneously | 1x `200`, 7x `200` | Exactly 1 status transition, exactly 1 ledger row. |
| **T18** | Abandoned Lease | Node crashes with `status='processing'`; retry after 65s | `200 OK` | Retry claims expired lease, completes transaction cleanly. |
| **T19** | Concurrent Lease | 2 retries race to take over expired lease simultaneously | 1 wins, 1 waits | Exactly 1 worker completes transaction. |
| **T20** | Secret Leak Audit | Sentinel secret in headers inspected in logs/responses | Clean | Zero occurrences of secret in logs, bundles, or errors. |
| **T21** | Browser Origin | Browser POSTs to `/api/v1/webhooks/*` without secret | `401 Unauthorized` | Fails closed. Zero DB writes. |

---

## 9. Environment Secrets & cPanel Configuration Specification

No live credentials will be committed to the repository. The required environment variables for staging/production deployment are:

```bash
# Environment Configuration Specification (NO REAL SECRETS IN REPO)
STRIPE_WEBHOOK_SECRET=whsec_...
PAYPAL_WEBHOOK_ID=...
PAYSTACK_SECRET_KEY=sk_live_...
SANDBOX_GATEWAY_WEBHOOK_SECRET=... # Test-only HMAC secret (min 16 chars)
```

---

## 10. Scope Boundaries: Explicitly Out of Phase 5D

The following capabilities remain **strictly out of scope** for Phase 5D:
- Live external provider activation / account registration.
- Live Stripe, PayPal, or Paystack API keys.
- Production webhook registration.
- Automated refunds, chargebacks, or dispute workflows (Phase 5F).
- Recurring subscriptions or tokenized billing.
- External provider API polling / cron reconciliation.
- Background worker queues (Redis, BullMQ, Celery).
- Production database migration execution.

---

## 11. Rollout, Staging, and Rollback Strategy

1. **Staging Rollout**:
   - Phase 5D code will be developed and tested in isolated unit/integration suites.
   - Candidate Migration `0024_create_webhook_events.sql` will be submitted for independent review before execution.
2. **Rollback Strategy**:
   - Webhook endpoints can be deactivated instantaneously via feature flags or route comment-out (`recovery/option-b-disable-payment-routes.patch` pattern) without disturbing core commerce or manual billing operations.
   - Candidate Migration `0024` includes a clean drop script: `DROP TABLE IF EXISTS webhook_events CASCADE;`.

---

## 12. Strict Phase Boundaries & Stop Notice

- **Documentation Only**: This submission is a comprehensive design package. Zero application routes, migrations, background workers, or external provider adapters have been implemented.
- **Migration 0023**: Remains **frozen** (prepared and tested; unrun on production).
- **PR #12**: Remains **OPEN and UNMERGED**.
- **Phase 5D Status**: **FROZEN / NOT STARTED**. Awaiting explicit written authorization before code implementation begins.
