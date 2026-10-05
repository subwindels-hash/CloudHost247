/**
 * Payments: gateway selection, initiation, the self-contained sandbox gateway, and the manual
 * (bank-transfer) gateway.
 *
 * Ported from cloudhost247-node/src/routes/payments.ts. The sandbox gateway simulates a provider
 * on both sides purely for testing and signs the webhooks it emits with
 * SANDBOX_GATEWAY_WEBHOOK_SECRET; the receiver in webhooks.js verifies that signature. The manual
 * gateway never fabricates bank details — with no configured instructions it returns an honest
 * "contact support" message.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ValidationError, UnauthorizedError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin } = require('../lib/auth');
const { applySuccessfulPayment } = require('../lib/billing-apply');

const name = 'payments';

const initiateSchema = v.object({
  invoiceId: v.string().min(1),
  gateway: v.enum(['sandbox', 'manual']),
});

function signWebhook(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function register(router, deps) {
  const { store, config } = deps;

  router.get('/api/v1/billing/invoices/:id/payment-methods', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const invoice = await store.table('invoices').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!invoice) throw new NotFoundError('Invoice not found');

    ctx.json({
      invoiceId: invoice.id,
      balanceDue: Math.round((invoice.total - (invoice.amount_paid ?? 0)) * 100) / 100,
      gateways: [
        { id: 'sandbox', label: 'Card (sandbox)', available: true },
        { id: 'manual', label: 'Bank transfer', available: true },
      ],
    });
  });

  router.post('/api/v1/payments', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(initiateSchema);

    const invoice = await store.table('invoices').findOne({ id: input.invoiceId, user_id: auth.id });
    if (!invoice) throw new NotFoundError('Invoice not found');

    const balance = Math.round((invoice.total - (invoice.amount_paid ?? 0)) * 100) / 100;
    if (balance <= 0) throw new ValidationError('This invoice is already paid');

    const payment = await store.table('payments').insert({
      id: uuidv7(),
      invoice_id: invoice.id,
      order_id: invoice.order_id,
      user_id: auth.id,
      gateway: input.gateway,
      currency: invoice.currency,
      amount: balance,
      status: 'pending',
    });

    if (input.gateway === 'manual') {
      const instructions = config.MANUAL_PAYMENT_INSTRUCTIONS
        ?? 'Manual bank transfer is not configured yet. Please contact support to arrange payment.';
      ctx.code(201).json({ paymentId: payment.id, gateway: 'manual', instructions, status: 'pending' });
      return;
    }

    // Sandbox: hand the client a token it uses to complete the simulated provider flow.
    const sandboxToken = crypto.randomBytes(24).toString('base64url');
    await store.table('payments').updateById(payment.id, {
      metadata: { sandbox_token: sandboxToken },
    });
    ctx.code(201).json({ paymentId: payment.id, gateway: 'sandbox', sandboxToken, status: 'pending' });
  });

  /**
   * Sandbox completion: produces a signed webhook exactly like a real provider would, then routes
   * it through the same verified receiver the production gateways use.
   */
  router.post('/api/v1/payments/:id/sandbox/complete', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const payment = await store.table('payments').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.gateway !== 'sandbox') throw new ValidationError('Not a sandbox payment');

    if (!config.SANDBOX_GATEWAY_WEBHOOK_SECRET) {
      throw new ValidationError('Sandbox gateway is not configured (SANDBOX_GATEWAY_WEBHOOK_SECRET unset)');
    }

    const payload = {
      provider: 'sandbox',
      event_id: `evt_${uuidv7()}`,
      event_type: 'payment.succeeded',
      payment_id: payment.id,
      gateway_reference: `sbx_${crypto.randomBytes(8).toString('hex')}`,
      amount: payment.amount,
      currency: payment.currency,
    };
    const body = JSON.stringify(payload);
    const signature = signWebhook(config.SANDBOX_GATEWAY_WEBHOOK_SECRET, body);

    // Drive it through the genuine receiver so the signature path is really exercised.
    const handled = await handleProviderWebhook(store, config, 'sandbox', body, signature);
    ctx.json({ ok: true, applied: handled.applied, status: 'succeeded' });
  });

  router.get('/api/v1/payments', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('payments').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({
      payments: rows.map((p) => ({
        id: p.id,
        gateway: p.gateway,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        createdAt: p.created_at,
      })),
      total,
    });
  });
}

/**
 * Shared provider-webhook handler (also used by webhooks.js).
 * Verifies the HMAC signature, de-duplicates by provider+event_id, records the event, and applies
 * the payment. Returns { applied }.
 */
async function handleProviderWebhook(store, config, provider, rawBody, signature) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ValidationError('Webhook body is not valid JSON');
  }

  const secret = provider === 'sandbox' ? config.SANDBOX_GATEWAY_WEBHOOK_SECRET : config.SANDBOX_GATEWAY_WEBHOOK_SECRET;
  if (!secret) throw new ValidationError(`No webhook secret configured for ${provider}`);

  const expected = signWebhook(secret, rawBody);
  const provided = String(signature ?? '');
  const valid = provided.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));

  const eventId = payload.event_id ?? null;
  const duplicate = eventId
    ? await store.table('webhook_events').findOne({ provider, event_id: eventId })
    : null;

  if (duplicate) {
    await store.table('webhook_events').updateById(duplicate.id, { status: 'duplicate' });
    return { applied: false, duplicate: true };
  }

  const record = await store.table('webhook_events').insert({
    id: uuidv7(),
    provider,
    event_id: eventId,
    event_type: payload.event_type ?? null,
    signature_valid: valid,
    status: 'received',
    payload,
  });

  if (!valid) {
    await store.table('webhook_events').updateById(record.id, { status: 'failed', error: 'bad signature' });
    // Matches the original webhook-service contract: an unverifiable signature is a 401.
    throw new UnauthorizedError('Invalid or unverified webhook signature');
  }

  let applied = false;
  if (payload.event_type === 'payment.succeeded' && payload.payment_id) {
    await store.transaction(async (tx) => {
      const result = await applySuccessfulPayment(tx, {
        paymentId: payload.payment_id,
        gatewayReference: payload.gateway_reference,
      });
      applied = result.applied;
    });
  }

  await store.table('webhook_events').updateById(record.id, {
    status: 'processed',
    processed_at: new Date().toISOString(),
  });

  return { applied };
}

module.exports = { name, register, handleProviderWebhook, signWebhook };
