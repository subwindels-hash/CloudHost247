/**
 * Generic HMAC request-signing primitives for provider webhooks.
 *
 * Ported from cloudhost247-node/src/payments/webhook-signing.ts. Every real payment provider uses
 * this technique to let a receiver prove a payload came from the provider and was not tampered with
 * in transit; the three gateway modules in ../gateways build their provider-specific schemes on top
 * of these helpers.
 *
 * Comparison is always `crypto.timingSafeEqual` over the decoded digest bytes (never `===` on the
 * hex strings), so a forged signature cannot be guessed one byte at a time from response timing.
 * A malformed candidate fails closed instead of throwing — `Buffer.from('zz', 'hex')` decodes to an
 * empty buffer, and passing unequal-length buffers to `timingSafeEqual` would throw.
 */
'use strict';

const crypto = require('node:crypto');

/** Signs `rawBody` (the exact bytes a receiver would see, before JSON parsing) with `secret`. */
function signPayload(secret, rawBody, algorithm = 'sha256') {
  return crypto.createHmac(algorithm, secret).update(rawBody, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests. Malformed input returns false, never throws. */
function timingSafeEqualHex(expectedHex, providedHex) {
  if (typeof expectedHex !== 'string' || typeof providedHex !== 'string') return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');

  // Empty on either side means the candidate was not valid hex at all (or absent), and unequal
  // lengths would make timingSafeEqual throw. Both must be a hard false.
  if (expected.length === 0 || expected.length !== provided.length) return false;

  return crypto.timingSafeEqual(expected, provided);
}

/** True when `signature` is the correct HMAC digest of `rawBody` under `secret`. */
function verifySignature(secret, rawBody, signature, algorithm = 'sha256') {
  if (!secret || typeof signature !== 'string' || signature.length === 0) return false;
  return timingSafeEqualHex(signPayload(secret, rawBody, algorithm), signature);
}

/** SHA-256 of the raw request bytes — the audit fingerprint stored with every webhook event. */
function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Case-insensitive header lookup. Node lower-cases incoming names; arrays take the first value. */
function headerValue(headers, name) {
  if (!headers) return null;
  const lowered = name.toLowerCase();
  const raw = headers[lowered] ?? headers[name];
  if (raw === undefined || raw === null) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

module.exports = { signPayload, verifySignature, timingSafeEqualHex, sha256Hex, headerValue };
