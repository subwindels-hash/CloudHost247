/**
 * Stripe webhook gateway (signature verification + canonical event parsing).
 *
 * Ported from cloudhost247-node/src/payments/stripe-gateway.ts. Stripe signs with the
 * `Stripe-Signature` header:
 *
 *     t=<unix seconds>,v1=<hex hmac>,v1=<hex hmac>…
 *
 * where the HMAC-SHA256 is taken over the ASCII string `<t>.<raw body>`. Multiple `v1` entries
 * appear while a signing secret is being rotated, so any one of them matching is a valid delivery.
 * The timestamp is bound into the signed string and must be within 5 minutes, which is what stops a
 * captured delivery being replayed later.
 */
'use strict';

const { verifySignature, headerValue } = require('../webhook-signing');

const id = 'stripe';
const label = 'Card (Stripe)';
/** Env var whose presence makes this gateway able to receive webhooks. */
const configKey = 'STRIPE_WEBHOOK_SECRET';
/** Deliveries outside this window are refused (replay protection). */
const MAX_SKEW_SECONDS = 300;

function isConfigured(config) {
  return Boolean(config?.[configKey]);
}

async function verify(rawBody, headers, config) {
  const secret = config?.[configKey];
  if (!secret) return false;

  const sigHeader = headerValue(headers, 'stripe-signature');
  if (!sigHeader) return false;

  let timestamp = null;
  const signatures = [];
  for (const part of sigHeader.split(',')) {
    const [key, value] = part.trim().split('=');
    if (key === 't' && value) timestamp = Number.parseInt(value, 10);
    else if (key === 'v1' && value) signatures.push(value);
  }

  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > MAX_SKEW_SECONDS) return false;

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  return signatures.some((candidate) => verifySignature(secret, signedPayload, candidate, 'sha256'));
}

function parseEvent(rawBody, _headers, payloadHash) {
  const json = JSON.parse(rawBody.toString('utf8'));
  const eventType = String(json.type || '');
  const data = json.data?.object || {};

  let canonicalEventType = 'unhandled';
  let outcome = 'unhandled';
  let failureReason;

  if (eventType === 'payment_intent.succeeded') {
    canonicalEventType = 'payment.success';
    outcome = 'succeeded';
  } else if (eventType === 'payment_intent.payment_failed') {
    canonicalEventType = 'payment.failed';
    outcome = 'failed';
    failureReason = data.last_payment_error?.message || 'Payment intent failed';
  } else if (eventType === 'payment_intent.canceled') {
    canonicalEventType = 'payment.cancelled';
    outcome = 'failed';
    failureReason = 'Payment intent was canceled';
  }

  return {
    gateway: id,
    providerEventId: String(json.id || ''),
    providerPaymentReference: String(data.id || json.id || ''),
    cloudhostPaymentId: data.metadata?.payment_id ? String(data.metadata.payment_id) : undefined,
    canonicalEventType,
    outcome,
    amountCents: typeof data.amount === 'number' ? data.amount : 0,
    currency: typeof data.currency === 'string' ? data.currency.toUpperCase() : 'USD',
    failureReason,
    eventOccurredAt: json.created ? new Date(json.created * 1000).toISOString() : new Date().toISOString(),
    payloadHash,
  };
}

module.exports = { id, label, configKey, isConfigured, verify, parseEvent, MAX_SKEW_SECONDS };
