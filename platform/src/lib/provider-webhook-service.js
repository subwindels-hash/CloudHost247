/**
 * Strict inbound provider-webhook receiver for the real payment gateways (stripe / paypal /
 * paystack / blockonomics).
 *
 * Ported from cloudhost247-node/src/services/webhook-service.ts, which is the security-critical half
 * of the Phase 5D pipeline: it decides whether a delivery from the internet is allowed to move money.
 * The platform's own sandbox gateway keeps its separate legacy path (src/domains/payments.js) because
 * it is a self-contained test rig, not a provider.
 *
 * Order of operations — this order is the whole design:
 *   1. the gateway must exist and be configured (an unconfigured gateway cannot verify anything)
 *   2. the signature is verified **before any database access at all** — an unverified caller must
 *      not be able to create, read or mutate a single row, not even an audit row
 *   3. the raw body is hashed and parsed into a canonical event
 *   4. the event is claimed by inserting (provider, event_id); the unique index is what makes a
 *      concurrent duplicate impossible, and the claim carries a lease so a crashed worker can be
 *      taken over rather than blocking the event forever
 *   5. unhandled event types are recorded and ignored (a 200, so the provider stops retrying a
 *      delivery we will never act on)
 *   6. settlement runs in one transaction through the same `applySuccessfulPayment` the manual and
 *      sandbox paths use, so money moves identically no matter who reported it
 *
 * Terminal failures are written to the event row *outside* the settlement transaction, deliberately:
 * a rejection must survive as audit evidence, and a status write inside a rolled-back transaction
 * would vanish.
 */
'use strict';

const {
  NotFoundError, UnauthorizedError, ValidationError, ConflictError,
} = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { sha256Hex } = require('../lib/webhook-signing');
const { getWebhookGateway } = require('../lib/gateways');
const { applySuccessfulPayment } = require('../lib/billing-apply');
const { exceedsLedgerPrecision, minorUnitScale, LEDGER_SCALE, toMinorUnits } = require('../lib/money');

/** How long a claimed event may sit unfinished before another delivery takes it over. */
const CLAIM_LEASE_MS = 60 * 1000;

const TERMINAL_STATUSES = new Set(['ignored', 'failed', 'rejected']);

/**
 * A gateway's `amountCents` is already integer minor units (satoshi for a BTC gateway); normalise
 * defensively, do not re-scale.
 */
const minorUnits = (amount) => Math.round(Number(amount ?? 0));

// The precision refusal now lives in `checkInvariants`, where it can name the currency and the
// exact number that would have been stored.

function isDuplicateError(err) {
  return err instanceof ConflictError || err?.statusCode === 409 || err?.code === '23505';
}

/**
 * Records a terminal outcome on the claimed event. Uses the plain store (never a transaction
 * handle) so the write is not rolled back together with a settlement that threw.
 */
async function markEvent(store, recordId, status, error = null) {
  await store.table('webhook_events').updateById(recordId, {
    status,
    error,
    processed_at: new Date().toISOString(),
  });
}

/**
 * Claims the event for processing. Returns one of:
 *   { outcome: 'claimed' | 'already_processed' | 'in_progress' | 'ignored' | 'failed' | 'rejected' }
 */
async function claimEvent(store, event, envelope) {
  const leaseExpiresAt = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();

  try {
    const record = await store.table('webhook_events').insert({
      id: uuidv7(),
      provider: event.gateway,
      event_id: event.providerEventId,
      event_type: event.canonicalEventType,
      signature_valid: true,
      status: 'received',
      payload: { ...envelope, lease_expires_at: leaseExpiresAt },
    });
    return { outcome: 'claimed', record };
  } catch (err) {
    if (!isDuplicateError(err)) throw err;

    const existing = await store.table('webhook_events').findOne({
      provider: event.gateway,
      event_id: event.providerEventId,
    });
    if (!existing) throw new ConflictError('Concurrent webhook event insert conflict');

    if (existing.status === 'processed') return { outcome: 'already_processed' };
    if (TERMINAL_STATUSES.has(existing.status)) return { outcome: existing.status };

    // status 'received': either genuinely in flight, or a worker that died mid-processing. The
    // lease decides which — an expired lease is taken over so the event is not stuck forever.
    const lease = existing.payload?.lease_expires_at ? Date.parse(existing.payload.lease_expires_at) : 0;
    if (lease > Date.now()) return { outcome: 'in_progress' };

    const record = await store.table('webhook_events').updateById(existing.id, {
      payload: { ...existing.payload, lease_expires_at: leaseExpiresAt },
    });
    return { outcome: 'claimed', record };
  }
}

/** Locates the pending payment a verified event refers to: by platform id first, then reference. */
async function findPayment(store, event) {
  if (event.cloudhostPaymentId) {
    const byId = await store.table('payments').findById(event.cloudhostPaymentId);
    if (byId) return byId;
  }
  if (event.providerPaymentReference) {
    return store.table('payments').findOne({
      gateway: event.gateway,
      gateway_reference: event.providerPaymentReference,
    });
  }
  return null;
}

/**
 * Zero-trust invariant checks. Any violation is a refusal with the reason recorded, never a
 * "best effort" settlement: the provider's claim about who paid, in what currency and how much is
 * not trusted just because the signature was valid.
 */
async function checkInvariants(store, payment, event) {
  if (payment.status === 'succeeded') return { ok: true };

  // The ledger cannot hold this currency at all. Money columns are NUMERIC(16,2) and the JSON
  // backend rounds numeric writes to match, so a Bitcoin amount would be stored as 0 — the payment
  // would be marked succeeded and the invoice credited nothing. Refusing names the real reason
  // instead of reporting a misleading amount mismatch, and it holds for any currency finer than the
  // ledger (three-decimal dinars, other crypto), not just for Bitcoin.
  if (exceedsLedgerPrecision(event.currency)) {
    const value = Number(event.amountCents ?? 0) / 10 ** minorUnitScale(event.currency);
    const stored = value.toFixed(LEDGER_SCALE);
    return {
      ok: false,
      reason: `A ${event.currency} delivery cannot be credited: this build's money columns hold ${LEDGER_SCALE} decimal places (NUMERIC(16,2)), so ${value} ${event.currency} (${Number(event.amountCents ?? 0)} minor units) would be stored as ${stored} and the invoice would be marked paid for nothing. The delivery is recorded for audit; settlement of ${event.currency} needs a minor-unit ledger column, and until then it stays on the staff-confirmed manual gateway`,
    };
  }

  if (minorUnits(event.amountCents) !== toMinorUnits(payment.amount, payment.currency)) {
    return {
      ok: false,
      reason: `Webhook amount ${minorUnits(event.amountCents)} does not match the pending payment amount ${toMinorUnits(payment.amount, payment.currency)} (minor units of ${payment.currency})`,
    };
  }
  if (payment.currency !== event.currency) {
    return {
      ok: false,
      reason: `Webhook currency ${event.currency} violates payment currency ${payment.currency}`,
    };
  }

  if (!payment.invoice_id) return { ok: true };

  const invoice = await store.table('invoices').findById(payment.invoice_id);
  if (!invoice) return { ok: false, reason: `Invoice not found for payment ${payment.id}` };

  if (payment.currency !== invoice.currency || event.currency !== invoice.currency) {
    return {
      ok: false,
      reason: `Webhook currency ${event.currency} violates invoice currency ${invoice.currency}`,
    };
  }
  if (payment.user_id !== invoice.user_id) {
    return { ok: false, reason: `Payment owner does not match invoice owner for payment ${payment.id}` };
  }

  // Full settlement only. A provider (or a forged body from a valid provider account) that reports
  // less than the invoice total is refused rather than applied as a partial payment: this platform's
  // local `applySuccessfulPayment` marks the parent order paid on any applied payment, so honouring
  // an underpayment here would hand over goods that were not paid for. Partial/card-installment
  // arrangements stay on the staff-confirmed manual gateway.
  if (minorUnits(event.amountCents) !== toMinorUnits(invoice.total, invoice.currency)) {
    return {
      ok: false,
      reason: `Webhook amount ${minorUnits(event.amountCents)} does not match invoice total ${toMinorUnits(invoice.total, invoice.currency)} (minor units of ${invoice.currency})`,
    };
  }

  if (invoice.order_id) {
    const order = await store.table('orders').findById(invoice.order_id);
    if (!order) return { ok: false, reason: `Order not found for invoice ${invoice.id}` };
    if (
      invoice.user_id !== order.user_id
      || invoice.currency !== order.currency
      || Number(invoice.total) !== Number(order.total)
    ) {
      return { ok: false, reason: `Invoice ${invoice.id} does not agree with its parent order` };
    }
  }

  return { ok: true };
}

/**
 * @param {object} [context] request context — `{ query }` for gateways whose provider reports state
 *   in the query string (Blockonomics) rather than in a signed body.
 * @returns {Promise<{received: true, status: string, applied: boolean}>}
 */
async function processProviderWebhook(store, config, providerId, rawBody, headers, context = {}) {
  const gateway = getWebhookGateway(providerId);
  if (!gateway) throw new NotFoundError(`Unknown webhook gateway: ${providerId}`);

  if (!gateway.isConfigured(config)) {
    throw new UnauthorizedError(
      `Webhook gateway "${providerId}" is not configured (${gateway.configKey} is unset)`,
    );
  }

  const hasBody = Buffer.isBuffer(rawBody) && rawBody.length > 0;
  if (!hasBody && gateway.queryCallback !== true) {
    throw new ValidationError('Missing raw request body for webhook processing');
  }

  // 1. Signature first — before parsing, and before touching the database.
  const valid = await gateway.verify(rawBody, headers, config, context);
  if (!valid) throw new UnauthorizedError('Invalid or unverified webhook signature');

  // 2. Hash and parse. A query callback has no body to hash, so its raw material is the query
  //    string itself; the hash still records exactly what was received.
  const payloadHash = sha256Hex(hasBody ? rawBody : JSON.stringify(context.query ?? {}));
  let event;
  let providerPayload;
  try {
    providerPayload = hasBody ? JSON.parse(rawBody.toString('utf8')) : { ...(context.query ?? {}) };
    event = gateway.parseEvent(rawBody, headers, payloadHash, { ...context, config });
  } catch (err) {
    throw new ValidationError(`Malformed webhook payload: ${err.message}`);
  }

  if (!event.providerEventId) {
    throw new ValidationError('Webhook payload has no event id, so it cannot be de-duplicated');
  }

  // 3. Claim (unique index on provider + event_id makes concurrent duplicates impossible).
  const envelope = {
    outcome: event.outcome,
    provider_reference: event.providerPaymentReference ?? null,
    cloudhost_payment_id: event.cloudhostPaymentId ?? null,
    transmission_id: event.providerTransmissionId ?? null,
    amount_cents: event.amountCents,
    currency: event.currency,
    payload_hash: payloadHash,
    event_occurred_at: event.eventOccurredAt,
    provider_payload: providerPayload,
  };

  const claim = await claimEvent(store, event, envelope);
  if (claim.outcome !== 'claimed') {
    // already_processed / in_progress / ignored / failed / rejected are all 200s to the provider:
    // nothing more can or should happen for this delivery.
    return { received: true, status: claim.outcome, applied: false };
  }

  const record = claim.record;

  // 4. Unhandled events are recorded and ignored.
  if (event.canonicalEventType === 'unhandled') {
    await markEvent(store, record.id, 'ignored');
    return { received: true, status: 'ignored', applied: false };
  }

  // 5. Locate the payment this event claims to settle.
  const payment = await findPayment(store, event);
  if (!payment) {
    const reason = `No payment record matches webhook reference ${event.providerPaymentReference || '(none)'}`;
    await markEvent(store, record.id, 'rejected', reason);
    throw new NotFoundError(reason);
  }

  // 6. Invariants before any money moves.
  const verdict = await checkInvariants(store, payment, event);
  if (!verdict.ok) {
    await markEvent(store, record.id, 'rejected', verdict.reason);
    throw new ValidationError(verdict.reason);
  }

  // 7. Failure / cancellation: the payment is marked failed, nothing is credited.
  if (event.canonicalEventType === 'payment.failed' || event.canonicalEventType === 'payment.cancelled') {
    await store.table('payments').updateById(payment.id, {
      status: 'failed',
      rejection_reason: event.failureReason ?? `Reported ${event.canonicalEventType} by ${event.gateway}`,
    });
    await markEvent(store, record.id, 'processed');
    return { received: true, status: 'failed', applied: false };
  }

  // 8. Settlement: same code path as manual/sandbox, idempotent, one transaction.
  let applied = false;
  await store.transaction(async (tx) => {
    const result = await applySuccessfulPayment(tx, {
      paymentId: payment.id,
      gatewayReference: event.providerPaymentReference || undefined,
      // `store` + `config` is everything a queued provider action needs; this module has no logger.
      deps: { store, config, logger: undefined },
    });
    applied = result.applied;
  });

  await markEvent(store, record.id, 'processed');
  return { received: true, status: applied ? 'processed' : 'already_processed', applied };
}

module.exports = { processProviderWebhook, CLAIM_LEASE_MS };
