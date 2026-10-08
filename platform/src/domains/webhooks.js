/**
 * Inbound provider webhooks.
 *
 * Ported from cloudhost247-node/src/routes/webhooks.ts. The canonical route is
 * `/api/v1/webhooks/:gateway`; `/api/v1/webhooks/payment/:provider` is retained as the explicit
 * public contract from the hosting platform API specification. Both routes share exactly the same
 * signature verification, idempotency and settlement implementation (as in the original).
 *
 * The raw body bytes are what get signed by the provider, so signature verification uses
 * ctx.rawBody (captured before JSON parsing) — never a re-serialised object, which would change
 * byte ordering and break the MAC.
 *
 * Supported providers: `sandbox` (the self-contained test gateway) plus the real `stripe`,
 * `paypal`, `paystack` and `blockonomics` schemes implemented in src/lib/gateways/. An unknown
 * provider is a 404 — a caller never gets to choose which verification scheme applies to it.
 *
 * One gateway is exempt from the "signed body" shape because its provider does not sign one:
 * Blockonomics calls back with GET and carries a shared secret in the query string. That route is
 * open only to a gateway that declares `queryCallback`; every other provider still needs its bytes,
 * and a name that is not a gateway at all is left to the handler so it answers 404 rather than
 * talking about a missing body.
 */
'use strict';

const { ValidationError } = require('../core/errors');
const { getWebhookGateway, isInitiationGateway } = require('../lib/gateways');
const { handleProviderWebhook } = require('./payments');

const name = 'webhooks';

function register(router, deps) {
  const { store, config } = deps;

  // Shared entrypoint for both public webhook routes (mirrors receiveWebhook in the original).
  async function receiveWebhook(ctx) {
    const gateway = ctx.params.gateway ?? ctx.params.provider;
    if (!gateway) throw new ValidationError('Payment provider is required');

    // The raw bytes are only retained once the body has actually been read off the socket, so
    // parseBody() must run before the signature check — verifying an empty buffer would reject
    // every legitimate provider callback.
    await ctx.parseBody();

    // Blockonomics reports a payment by calling the registered callback URL with the parameters in
    // the query string — there is no body to verify and none to hash. Only a gateway that declares
    // `queryCallback` may be called that way; every other provider still needs its signed bytes.
    //
    // A name that is not a gateway at all is left to the handler so it answers 404, rather than
    // telling a caller that guessed a provider name about a missing body. Every gateway we *do*
    // know — including the local ones — still needs its bytes unless it declares `queryCallback`.
    const known = isInitiationGateway(gateway);
    const queryCallback = getWebhookGateway(gateway)?.queryCallback === true;

    const rawBody = ctx.rawBody;
    const missingBody = !rawBody || !Buffer.isBuffer(rawBody) || rawBody.length === 0;
    if (known && !queryCallback && missingBody) {
      throw new ValidationError('Missing raw request body for webhook processing');
    }

    const signature = ctx.headers['x-webhook-signature']
      ?? ctx.headers['x-signature']
      ?? ctx.headers['x-hub-signature-256'];

    // The raw Buffer is passed through unchanged: each real gateway verifies its own header scheme
    // against the exact signed bytes (stripe-signature, x-paystack-signature, paypal-*), and
    // re-encoding the body first would break the MAC.
    const result = await handleProviderWebhook(store, config, gateway, rawBody, signature, ctx.headers, { query: ctx.query });

    // The original replies with the receiver's own envelope: { received, status }. Keep that
    // contract rather than inventing a new one — gateways branch on `status`.
    //
    // The strict receiver returns its own full status vocabulary (processed, already_processed,
    // in_progress, ignored, failed, rejected); only the sandbox path's legacy { applied, duplicate }
    // shape needs mapping here.
    const status = result.status ?? (result.duplicate
      ? 'already_processed'
      : result.applied
        ? 'processed'
        : 'ignored');
    ctx.json({ received: true, status, applied: result.applied === true });
  }

  router.post('/api/v1/webhooks/:gateway', receiveWebhook);
  router.post('/api/v1/webhooks/payment/:provider', receiveWebhook);

  // Providers that call back with GET + query parameters (Blockonomics). A GET for any other
  // gateway is still refused below — the declaration is what makes the exception explicit.
  router.get('/api/v1/webhooks/:gateway', receiveWebhook);
  router.get('/api/v1/webhooks/payment/:provider', receiveWebhook);

  // Legacy alias kept for the platform's existing integrations.
  router.post('/api/v1/webhooks/payments/:provider', receiveWebhook);
}

module.exports = { name, register };
