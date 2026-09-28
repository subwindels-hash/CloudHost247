import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Generic HMAC-SHA256 request-signing primitives for provider webhooks — the same technique every
 * real payment provider (Stripe, PayPal, etc.) uses to let a webhook receiver prove a payload
 * actually came from the provider and was not forged or tampered with in transit.
 *
 * This module is pure, side-effect-free crypto with no knowledge of payments/routes/the database —
 * intentionally so, since it is reusable groundwork for **Phase 5D's webhook receiver**, which will
 * import `verifySignature` to authenticate incoming sandbox-gateway (and, later, real-provider)
 * webhook requests before trusting a single byte of their body. Phase 5C itself calls only
 * `signPayload`, from `src/payments/sandbox-gateway.ts#buildSignedWebhookPayload`, to produce a
 * realistic *example* signed payload for that later work to consume — no route in this phase
 * accepts a webhook request at all.
 */

/** Signs `rawBody` (the exact bytes a webhook receiver would see, before any JSON parsing) with
 * `secret`, returning a hex-encoded HMAC-SHA256 digest. */
export function signPayload(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Verifies that `signature` is the correct HMAC-SHA256 signature of `rawBody` under `secret`.
 * Uses `crypto.timingSafeEqual` (not `===`) so an attacker probing the endpoint cannot use
 * response-time differences to guess a valid signature one byte at a time.
 */
export function verifySignature(secret: string, rawBody: string, signature: string): boolean {
  const expected = signPayload(secret, rawBody);

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  // Buffers of different lengths would make timingSafeEqual throw rather than just returning
  // false — an invalid/malformed signature must fail closed, not crash the caller.
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, actualBuf);
}
