/**
 * Inbound provider webhooks.
 *
 * Ported from cloudhost247-node/src/routes/webhooks.ts. The raw body bytes are what get signed by
 * the provider, so signature verification uses ctx.rawBody (captured before JSON parsing) — never
 * a re-serialised object, which would change byte ordering and break the MAC.
 */
'use strict';

const { handleProviderWebhook } = require('./payments');

const name = 'webhooks';

function register(router, deps) {
  const { store, config } = deps;

  router.post('/api/v1/webhooks/payments/:provider', async (ctx) => {
    const provider = ctx.params.provider;
    const signature = ctx.headers['x-webhook-signature']
      ?? ctx.headers['x-signature']
      ?? ctx.headers['x-hub-signature-256'];

    const result = await handleProviderWebhook(store, config, provider, ctx.rawBody.toString('utf8'), signature);
    ctx.json({ ok: true, applied: result.applied });
  });
}

module.exports = { name, register };
