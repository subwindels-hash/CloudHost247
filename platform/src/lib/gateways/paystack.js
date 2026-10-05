/**
 * Paystack webhook gateway (signature verification + canonical event parsing).
 *
 * Ported from cloudhost247-node/src/payments/paystack-gateway.ts. Paystack signs the raw request
 * body with HMAC-SHA512 keyed by the account's **secret key** and sends the hex digest in
 * `x-paystack-signature`. There is no timestamp in the signed material, so replay protection comes
 * from the event-id idempotency in the receiver, not from the signature.
 *
 * Settlement rule: only `charge.success` settles, and only when the charge's own `data.status`
 * agrees (`success`). A `charge.success` event whose embedded status says otherwise is treated as
 * unhandled rather than paid — the event name alone is not proof the money moved.
 */
'use strict';

const { verifySignature, headerValue } = require('../webhook-signing');

const id = 'paystack';
const label = 'Card / bank (Paystack)';
const configKey = 'PAYSTACK_SECRET_KEY';

function isConfigured(config) {
  return Boolean(config?.[configKey]);
}

async function verify(rawBody, headers, config) {
  const secret = config?.[configKey];
  if (!secret) return false;

  const signature = headerValue(headers, 'x-paystack-signature');
  if (!signature) return false;

  return verifySignature(secret, rawBody.toString('utf8'), signature, 'sha512');
}

function parseEvent(rawBody, _headers, payloadHash) {
  const json = JSON.parse(rawBody.toString('utf8'));
  const eventType = String(json.event || '');
  const data = json.data || {};

  let canonicalEventType = 'unhandled';
  let outcome = 'unhandled';
  let failureReason;

  const statusAgrees = data.status === undefined || String(data.status).toLowerCase() === 'success';

  if (eventType === 'charge.success' && statusAgrees) {
    canonicalEventType = 'payment.success';
    outcome = 'succeeded';
  } else if (eventType === 'charge.failed') {
    canonicalEventType = 'payment.failed';
    outcome = 'failed';
    failureReason = data.gateway_response || 'Paystack charge failed';
  }

  const providerPaymentReference = String(data.reference || '');

  return {
    gateway: id,
    providerEventId: String(data.id ? `${eventType}_${data.id}` : `${eventType}_${providerPaymentReference}`),
    providerPaymentReference,
    cloudhostPaymentId: data.metadata?.payment_id ? String(data.metadata.payment_id) : undefined,
    canonicalEventType,
    outcome,
    amountCents: typeof data.amount === 'number' ? data.amount : 0,
    currency: typeof data.currency === 'string' ? data.currency.toUpperCase() : 'USD',
    failureReason,
    eventOccurredAt: data.paid_at ? new Date(data.paid_at).toISOString() : new Date().toISOString(),
    payloadHash,
  };
}

module.exports = { id, label, configKey, isConfigured, verify, parseEvent };
