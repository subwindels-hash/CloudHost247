/**
 * Payments: gateway selection, initiation, the self-contained sandbox gateway, and the manual
 * (bank-transfer) gateway.
 *
 * Ported from cloudhost247-node/src/routes/payments.ts. The sandbox gateway simulates a provider
 * on both sides purely for testing and signs the webhooks it emits with
 * SANDBOX_GATEWAY_WEBHOOK_SECRET; the receiver in webhooks.js verifies that signature. The manual
 * gateway never fabricates bank details — with no configured instructions it returns an honest
 * "contact support" message.
 *
 * The real providers (stripe / paypal / paystack / blockonomics) are recognized here so the
 * customer-facing gateway list and the initiation guards can name them, but initiation is refused
 * with the exact reason: creating a provider-side checkout needs live provider egress this build
 * does not have (and for Bitcoin, the provider's address-issuance call plus a recorded quote).
 * Their *inbound* webhooks are fully implemented in src/lib/provider-webhook-service.js.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError, ValidationError, UnauthorizedError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { paymentDto } = require('../lib/payments-dto');
const { authenticate, asAdmin } = require('../lib/auth');
const { applySuccessfulPayment } = require('../lib/billing-apply');
const {
  INITIATION_GATEWAYS, isWebhookGateway, initiationStatus, listGateways,
} = require('../lib/gateways');
const { processProviderWebhook } = require('../lib/provider-webhook-service');

const name = 'payments';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const initiateSchema = v.object({
  invoiceId: v.string().min(1),
  gateway: v.enum(INITIATION_GATEWAYS),
});

/** The invoice-scoped route takes the gateway alone; the invoice comes from the path. */
const gatewayOnlySchema = v.object({
  gateway: v.enum(INITIATION_GATEWAYS),
});

/**
 * Refuses a gateway this deployment cannot actually run, naming the reason. A 400 rather than a
 * generic failure: the caller asked for something the deployment does not offer, and the message
 * says which piece is missing (credentials, or provider egress) instead of leaving a dead end.
 */
function assertGatewayCanInitiate(gatewayId, config) {
  const status = initiationStatus(gatewayId, config);
  if (!status.available) throw new ValidationError(status.reason);
  return status;
}

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
      gateways: listGateways(config),
    });
  });

  router.post('/api/v1/payments', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(initiateSchema);
    assertGatewayCanInitiate(input.gateway, config);

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
   * Invoice-scoped initiation (payments.ts). Same rules as POST /payments — a payment that exists
   * but belongs to another customer is indistinguishable from one that does not (404, never 403) —
   * but it answers with the original's { payment } DTO rather than the platform's flat shape.
   */
  router.post('/api/v1/invoices/:id/payments', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const { gateway } = await ctx.validate(gatewayOnlySchema);
    assertGatewayCanInitiate(gateway, config);

    const invoice = await store.table('invoices').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!invoice) throw new NotFoundError('Invoice not found');

    const balance = Math.round((invoice.total - (invoice.amount_paid ?? 0)) * 100) / 100;
    if (balance <= 0) throw new ValidationError('This invoice is already paid');

    const payment = await store.table('payments').insert({
      id: uuidv7(),
      invoice_id: invoice.id,
      order_id: invoice.order_id,
      user_id: auth.id,
      gateway,
      currency: invoice.currency,
      amount: balance,
      status: 'pending',
    });
    ctx.code(201).json({ payment: paymentDto(payment) });
  });

  /** A customer's own payment detail (payments.ts getMyPaymentDetail). */
  router.get('/api/v1/payments/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');

    const payment = await store.table('payments').findById(ctx.params.id);
    if (!payment || payment.user_id !== auth.id) throw new NotFoundError('No payment was found with that id');
    ctx.json({ payment: paymentDto(payment) });
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
 * Shared provider-webhook entrypoint.
 *
 * Two deliberately different paths:
 *
 *  - **sandbox** — the self-contained test rig. It emits its own HMAC-SHA256-signed deliveries and
 *    verifies them with the same secret, and a failed attempt is recorded on the event row for
 *    audit (the integration suite pins that).
 *  - **stripe / paypal / paystack / blockonomics** — real providers, handled by the strict receiver
 *    in src/lib/provider-webhook-service.js: the delivery is verified before any database access
 *    (a signature over the raw bytes, or Blockonomics' query-string secret), parsed into a canonical
 *    event, claimed through a unique index with lease takeover, checked against zero-trust
 *    amount/currency/owner invariants, and settled through the same `applySuccessfulPayment` the
 *    other paths use.
 *
 * `context` carries what a query-parameter callback needs (`ctx.query`); gateways that sign a body
 * ignore it.
 *
 * An unknown provider is a 404 rather than falling back to the sandbox secret: a caller must never
 * be able to pick which verification scheme applies to them.
 *
 * `rawBody` may be a Buffer (preferred — the exact bytes the provider signed) or a string.
 * `signature` is kept for the sandbox path's backwards-compatible call shape; the real gateways read
 * their own headers from `headers`.
 */
async function handleProviderWebhook(store, config, provider, rawBody, signature, headers = {}, context = {}) {
  const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  const rawText = rawBuffer.toString('utf8');

  if (isWebhookGateway(provider)) {
    return processProviderWebhook(store, config, provider, rawBuffer, headers, context);
  }

  if (provider !== 'sandbox') {
    throw new NotFoundError(`Unknown webhook gateway: ${provider}`);
  }

  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new ValidationError('Webhook body is not valid JSON');
  }

  const secret = config.SANDBOX_GATEWAY_WEBHOOK_SECRET;
  if (!secret) throw new ValidationError(`No webhook secret configured for ${provider}`);

  const expected = signWebhook(secret, rawText);
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
        // This handler is module-scope (it is called directly by tests and by the router), so the
        // deps a queued provider action needs are rebuilt from what it already holds.
        deps: { store, config, logger: undefined },
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
