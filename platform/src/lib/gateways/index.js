/**
 * Payment gateway registry for the zero-dependency platform.
 *
 * One place that answers three questions:
 *   1. which gateways can *receive* a webhook (signature scheme implemented and configured), and
 *   2. which gateways can *initiate* a checkout right now, and if not, why not, and
 *   3. which gateway module handles a given provider id.
 *
 * `available: false` reasons are returned to the API verbatim so the customer UI and the operator can
 * see the real reason instead of a dead button or a fabricated checkout URL.
 */
'use strict';

const stripe = require('./stripe');
const paypal = require('./paypal');
const paystack = require('./paystack');
const blockonomics = require('./blockonomics');

/** Webhook-capable gateways, keyed by the provider id used in the URL and the payments row. */
const WEBHOOK_GATEWAYS = { stripe, paypal, paystack, blockonomics };

/** Everything the initiation API accepts, including the self-contained local gateways. */
const INITIATION_GATEWAYS = ['sandbox', 'manual', 'stripe', 'paypal', 'paystack', 'blockonomics'];

/** Human labels for the non-webhook (local) gateways. */
const LOCAL_GATEWAY_LABELS = {
  sandbox: 'Card (sandbox)',
  manual: 'Bank transfer',
};

function getWebhookGateway(providerId) {
  return WEBHOOK_GATEWAYS[providerId] ?? null;
}

function isWebhookGateway(providerId) {
  return Boolean(WEBHOOK_GATEWAYS[providerId]);
}

function isInitiationGateway(gatewayId) {
  return INITIATION_GATEWAYS.includes(gatewayId);
}

/**
 * Whether a customer can start a payment through `gatewayId` in this build, with the reason when
 * they cannot.
 *
 * The real providers can *receive* and settle a webhook (implemented here, tested), but starting a
 * checkout with them needs live provider egress (creating a PaymentIntent / order / transaction
 * against the provider's API with that account's credentials). This build has no provider egress and
 * no PSP credentials, so initiation is refused with that exact reason rather than handed a fabricated
 * provider reference — the failure mode the Phase 5 audit explicitly forbade.
 */
function initiationStatus(gatewayId, config) {
  if (gatewayId === 'manual') {
    return { available: true, reason: null };
  }

  if (gatewayId === 'sandbox') {
    return { available: true, reason: null };
  }

  const gateway = WEBHOOK_GATEWAYS[gatewayId];
  if (!gateway) {
    return { available: false, reason: `Unknown payment gateway: ${gatewayId}` };
  }

  if (!gateway.isConfigured(config)) {
    return {
      available: false,
      reason: `${gateway.label} is not configured for this deployment (${gateway.configKey} is unset)`,
    };
  }

  if (gateway.id === blockonomics.id) {
    return {
      available: false,
      // Naming all three, because the first two are credentials and the third is the platform: even
      // with an API key and a quote, `NUMERIC(16,2)` money columns cannot hold a Bitcoin amount.
      reason: `${gateway.label} checkout needs three things this build does not have: the Blockonomics address-issuance call (an API key plus provider egress), a recorded BTC quote for the invoice (BTC amount + rate + quoted-at), and a ledger that can hold a Bitcoin amount (money columns are two-decimal). Incoming callbacks are verified and recorded; initiation is refused rather than handing a customer an address nobody is watching`,
    };
  }

  return {
    available: false,
    reason: `${gateway.label} checkout needs live provider egress (creating the provider-side payment), which this build does not have; incoming ${gateway.label} webhooks are verified and settled normally`,
  };
}

/** The list returned by GET /billing/invoices/:id/payment-methods. */
function listGateways(config) {
  const ids = [...INITIATION_GATEWAYS];
  return ids.map((gatewayId) => {
    const status = initiationStatus(gatewayId, config);
    return {
      id: gatewayId,
      label: LOCAL_GATEWAY_LABELS[gatewayId] ?? WEBHOOK_GATEWAYS[gatewayId]?.label ?? gatewayId,
      available: status.available,
      reason: status.reason,
    };
  });
}

module.exports = {
  getWebhookGateway,
  isWebhookGateway,
  isInitiationGateway,
  initiationStatus,
  listGateways,
  INITIATION_GATEWAYS,
  WEBHOOK_GATEWAY_IDS: Object.keys(WEBHOOK_GATEWAYS),
};
