/**
 * Domain brokerage — customers request acquisition of a taken domain; brokers work the case
 * through offers, messages, payment and transfer.
 *
 * Ported from cloudhost247-node/src/routes/domain-brokerage.ts. Customer routes live under
 * /api/v1/account/domain-brokerage, admin under /api/v1/admin/domain-brokerage. Every mutation
 * writes a broker event + audit row and notifies the customer. Lifecycle statuses follow spec §11.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError, ConflictError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin, asSuperAdmin } = require('../lib/auth');

const name = 'domain-brokerage';

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CURRENCY_RE = /^[a-zA-Z]{3}$/;

const CASE_STATUSES = ['request_submitted', 'broker_assigned', 'under_review', 'contacting_seller', 'negotiation', 'offer_received', 'offer_accepted', 'payment_pending', 'transfer_pending', 'completed', 'rejected', 'cancelled'];
const STATUS_LABELS = {
  request_submitted: 'Submitted', broker_assigned: 'Broker assigned', under_review: 'Under review',
  contacting_seller: 'Contacting seller', negotiation: 'Negotiating', offer_received: 'Offer received',
  offer_accepted: 'Offer accepted', payment_pending: 'Payment pending', transfer_pending: 'Transfer pending',
  completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled',
};

const money = () => v.coerce.number().min(0.01);
const currency = () => v.string().regex(CURRENCY_RE, 'currency must be a 3-letter code');

function nextNumber() {
  return `BRK-${new Date().getUTCFullYear()}-${uuidv7().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

function publicCase(row) {
  return {
    id: row.id, brokerageId: row.brokerage_id, domain: row.domain, status: row.status,
    domainStatus: row.domain_status, acquisitionRoute: row.acquisition_route,
    currentOffer: row.current_offer, currency: row.currency,
    paymentStatus: row.payment_status, transferStatus: row.transfer_status,
    assignedBrokerId: row.assigned_broker_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  async function writeEvent(caseId, actorId, type, metadata) {
    await store.table('domain_broker_events').insert({ id: uuidv7(), case_id: caseId, actor_id: actorId ?? null, event_type: type, metadata: metadata ?? {}, correlation_id: uuidv7() });
  }
  async function writeAudit(caseId, actorId, action, metadata) {
    await store.table('domain_broker_audit_logs').insert({ id: uuidv7(), case_id: caseId ?? null, actor_id: actorId ?? null, action, metadata: metadata ?? {} });
  }
  async function notify(userId, title, body) {
    try { await store.table('notifications').insert({ id: uuidv7(), user_id: userId, title, body }); } catch { /* never roll back the operation */ }
  }
  async function ownCase(userId, caseId) {
    const kase = await store.table('domain_broker_cases').findOne({ id: caseId, user_id: userId });
    if (!kase) throw new NotFoundError('No brokerage case was found');
    return kase;
  }

  // ---- honest availability ------------------------------------------------
  router.get('/api/v1/domains/:domain/brokerage-status', async (ctx) => {
    const d = String(ctx.params.domain).toLowerCase();
    if (!DOMAIN_RE.test(d)) throw new ValidationError('A valid domain is required');
    const providers = await store.table('domain_broker_providers').all();
    const canSearch = providers.some((p) => p.status === 'connected' && p.capabilities && (p.capabilities.domainAvailability === true || p.capabilities.domainSearch === true));
    ctx.json({
      domain: d,
      status: canSearch ? 'unknown' : 'provider_unavailable',
      brokerThisDomain: false,
      message: canSearch
        ? 'Domain search result is not available from the configured provider.'
        : 'Domain provider temporarily unavailable. Please try again later.',
    });
  });

  // ---- customer: create / list / detail -----------------------------------
  router.post('/api/v1/account/domain-brokerage/cases', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({
      domain: v.string().trim().toLowerCase().regex(DOMAIN_RE, 'A valid domain is required'),
      customerName: v.string().min(1).max(255),
      contactInformation: v.string().min(1).max(1000),
      maxBudget: money(),
      currency: currency(),
      openingOffer: money().optional(),
      message: v.string().max(5000).optional(),
      negotiationInstructions: v.string().max(5000).optional(),
      deadline: v.string().optional(),
      termsAccepted: v.boolean(),
      idempotencyKey: v.string().min(8).max(128).optional(),
    }));
    if (input.termsAccepted !== true) throw new ValidationError('You must accept the terms');
    if (input.openingOffer && input.openingOffer > input.maxBudget) throw new ValidationError('Opening offer cannot exceed the confidential maximum budget');

    if (input.idempotencyKey) {
      const prior = await store.table('domain_broker_cases').findOne({ user_id: auth.id, idempotency_key: input.idempotencyKey });
      if (prior) return ctx.json({ case: publicCase(prior) });
    }

    const caseId = uuidv7();
    const brokerageId = nextNumber();
    const row = await store.table('domain_broker_cases').insert({
      id: caseId, brokerage_id: brokerageId, user_id: auth.id,
      customer_name: input.customerName, contact_information: input.contactInformation,
      domain: input.domain, domain_status: 'registered', acquisition_route: 'manual_broker_required',
      max_budget: input.maxBudget, currency: input.currency.toUpperCase(),
      opening_offer: input.openingOffer ?? null, deadline_at: input.deadline ?? null,
      negotiation_instructions: input.negotiationInstructions ?? null, customer_message: input.message ?? null,
      terms_accepted_at: new Date().toISOString(), idempotency_key: input.idempotencyKey ?? null,
      status: 'request_submitted',
    });
    await writeEvent(caseId, auth.id, 'request_created');
    await writeAudit(caseId, auth.id, 'case_created', { route: 'manual_broker_required' });
    await notify(auth.id, 'Your domain broker request was received', `We received your acquisition request for ${input.domain} (${brokerageId}). A broker will review it and contact you through the case messages.`);
    ctx.code(201).json({ case: publicCase(row) });
  });

  router.get('/api/v1/account/domain-brokerage/cases', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('domain_broker_cases').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ cases: rows.map(publicCase) });
  });

  router.get('/api/v1/account/domain-brokerage/cases/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const kase = await ownCase(auth.id, ctx.params.id);
    const offers = (await store.table('domain_broker_offers').all()).filter((o) => o.case_id === kase.id);
    const messages = (await store.table('domain_broker_messages').all()).filter((m) => m.case_id === kase.id && m.visibility === 'customer');
    const events = (await store.table('domain_broker_events').all()).filter((e) => e.case_id === kase.id);
    const payment = (await store.table('domain_broker_payments').all()).find((p) => p.case_id === kase.id) ?? null;
    const transfer = (await store.table('domain_broker_transfers').all()).find((t) => t.case_id === kase.id) ?? null;
    ctx.json({
      case: publicCase(kase),
      offers: offers.map((o) => ({ id: o.id, amount: o.amount, currency: o.currency, senderType: o.sender_type, recipientType: o.recipient_type, status: o.status, expiresAt: o.expires_at, createdAt: o.created_at })),
      messages: messages.map((m) => ({ id: m.id, authorId: m.author_id, body: m.body, createdAt: m.created_at })),
      timeline: events.map((e) => ({ eventType: e.event_type, metadata: e.metadata, createdAt: e.created_at })),
      payment, transfer,
    });
  });

  // ---- customer: offers / messages / decision -----------------------------
  router.post('/api/v1/account/domain-brokerage/cases/:id/offers', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const kase = await ownCase(auth.id, ctx.params.id);
    const input = await ctx.validate(v.object({ amount: money(), currency: currency(), recipientType: v.enum(['customer', 'broker', 'seller', 'provider']), expiresAt: v.string().optional() }));
    if (input.amount > Number(kase.max_budget)) throw new ValidationError('Offer exceeds your confidential maximum budget');

    const offer = await store.table('domain_broker_offers').insert({
      id: uuidv7(), case_id: kase.id, amount: input.amount, currency: input.currency.toUpperCase(),
      sender_type: 'customer', recipient_type: input.recipientType, expires_at: input.expiresAt ?? null, status: 'open',
    });
    await store.table('domain_broker_cases').updateById(kase.id, { current_offer: input.amount, status: 'negotiation' });
    await writeEvent(kase.id, auth.id, 'customer_offer_submitted', { amount: input.amount, currency: input.currency.toUpperCase() });
    ctx.json({ offer: { id: offer.id, amount: offer.amount, currency: offer.currency, status: offer.status } });
  });

  router.post('/api/v1/account/domain-brokerage/cases/:id/messages', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const kase = await ownCase(auth.id, ctx.params.id);
    const input = await ctx.validate(v.object({ body: v.string().min(1).max(10000), visibility: v.enum(['customer', 'internal']).default('customer') }));
    if (input.visibility === 'internal') throw new ValidationError('Customers cannot create internal notes');
    const message = await store.table('domain_broker_messages').insert({ id: uuidv7(), case_id: kase.id, author_id: auth.id, visibility: 'customer', body: input.body });
    await writeEvent(kase.id, auth.id, 'customer_message');
    ctx.json({ message: { id: message.id, body: message.body, createdAt: message.created_at } });
  });

  router.post('/api/v1/account/domain-brokerage/cases/:id/offers/:offerId/decision', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const kase = await ownCase(auth.id, ctx.params.id);
    const input = await ctx.validate(v.object({ action: v.enum(['accept', 'reject']) }));
    const offer = await store.table('domain_broker_offers').findOne({ id: ctx.params.offerId, case_id: kase.id, status: 'open' });
    if (!offer || !['seller', 'provider'].includes(offer.sender_type)) throw new NotFoundError('No open seller offer was found');

    await store.table('domain_broker_offers').updateById(offer.id, { status: input.action === 'accept' ? 'accepted' : 'rejected' });
    const newStatus = input.action === 'accept' ? 'offer_accepted' : 'negotiation';
    await store.table('domain_broker_cases').updateById(kase.id, { status: newStatus });
    await writeEvent(kase.id, auth.id, input.action === 'accept' ? 'customer_approved_offer' : 'customer_rejected_offer', { offerId: offer.id });
    await writeAudit(kase.id, auth.id, `offer_${input.action}`, { offerId: offer.id });
    ctx.json({ ok: true, status: newStatus });
  });

  // ---- admin: list / assign / providers / overview ------------------------
  router.get('/api/v1/admin/domain-brokerage/cases', async (ctx) => {
    await asAdmin(ctx, deps);
    const query = await ctx.validateQuery(v.object({ status: v.string().optional(), search: v.string().optional(), page: v.coerce.number().int().min(1).default(1), limit: v.coerce.number().int().min(1).max(100).default(25) }));
    let rows = await store.table('domain_broker_cases').all();
    if (query.status) rows = rows.filter((c) => c.status === query.status);
    if (query.search) {
      const s = query.search.toLowerCase();
      rows = rows.filter((c) => c.brokerage_id.toLowerCase().includes(s) || c.domain.toLowerCase().includes(s));
    }
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const start = (query.page - 1) * query.limit;
    ctx.json({ cases: rows.slice(start, start + query.limit).map(publicCase), page: query.page, limit: query.limit });
  });

  router.post('/api/v1/admin/domain-brokerage/cases/:id/assign', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const kase = await store.table('domain_broker_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('No brokerage case was found');
    const input = await ctx.validate(v.object({ brokerId: v.string().min(1) }));
    await store.table('domain_broker_cases').updateById(kase.id, { assigned_broker_id: input.brokerId, status: 'broker_assigned' });
    await store.table('domain_broker_assignments').insert({ id: uuidv7(), case_id: kase.id, broker_id: input.brokerId, assigned_by: auth.id });
    await writeEvent(kase.id, auth.id, 'broker_assigned', { brokerId: input.brokerId });
    await writeAudit(kase.id, auth.id, 'broker_assigned', { brokerId: input.brokerId });
    await notify(kase.user_id, 'A broker was assigned to your request', `A broker has been assigned to your acquisition request for ${kase.domain} (${kase.brokerage_id}).`);
    ctx.json({ ok: true });
  });

  router.get('/api/v1/admin/domain-brokerage/providers', async (ctx) => {
    await asSuperAdmin(ctx, deps);
    const rows = await store.table('domain_broker_providers').all();
    ctx.json({ providers: rows.map((p) => ({ id: p.id, providerKey: p.provider_key, name: p.name, providerType: p.provider_type, status: p.status, environment: p.environment, capabilities: p.capabilities })) });
  });

  router.post('/api/v1/admin/domain-brokerage/providers', async (ctx) => {
    const auth = await asSuperAdmin(ctx, deps);
    const input = await ctx.validate(v.object({
      providerKey: v.string().min(1).max(80), name: v.string().min(1).max(160),
      providerType: v.enum(['marketplace', 'broker', 'registrar', 'manual']),
      capabilities: v.object({}).passthrough().default({}),
      environment: v.enum(['sandbox', 'production']).default('production'),
    }));
    const row = await store.table('domain_broker_providers').insert({
      id: uuidv7(), provider_key: input.providerKey, name: input.name, provider_type: input.providerType,
      environment: input.environment, capabilities: input.capabilities, status: 'configured',
    });
    await writeAudit(null, auth.id, 'provider_configured', { providerKey: input.providerKey });
    ctx.code(201).json({ provider: { id: row.id, providerKey: row.provider_key, name: row.name, providerType: row.provider_type, status: row.status } });
  });

  router.get('/api/v1/admin/domain-brokerage/overview', async (ctx) => {
    await asAdmin(ctx, deps);
    const rows = await store.table('domain_broker_cases').all();
    const counts = {};
    for (const c of rows) counts[c.status] = (counts[c.status] || 0) + 1;
    ctx.json({ counts });
  });

  // ---- admin: case detail / status / offers / messages / payment / transfer
  router.get('/api/v1/admin/domain-brokerage/cases/:id', async (ctx) => {
    await asAdmin(ctx, deps);
    const kase = await store.table('domain_broker_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('No brokerage case was found');
    const offers = (await store.table('domain_broker_offers').all()).filter((o) => o.case_id === kase.id);
    const messages = (await store.table('domain_broker_messages').all()).filter((m) => m.case_id === kase.id);
    const events = (await store.table('domain_broker_events').all()).filter((e) => e.case_id === kase.id);
    const payment = (await store.table('domain_broker_payments').all()).find((p) => p.case_id === kase.id) ?? null;
    const transfer = (await store.table('domain_broker_transfers').all()).find((t) => t.case_id === kase.id) ?? null;
    const assignments = (await store.table('domain_broker_assignments').all()).filter((a) => a.case_id === kase.id);
    ctx.json({ case: publicCase(kase), offers, messages, timeline: events, payment, transfer, assignments, statusLabels: STATUS_LABELS });
  });

  router.patch('/api/v1/admin/domain-brokerage/cases/:id/status', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const kase = await store.table('domain_broker_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('No brokerage case was found');
    const input = await ctx.validate(v.object({ status: v.enum(CASE_STATUSES), note: v.string().max(1000).optional() }));
    if (kase.status === input.status) return ctx.json({ ok: true, status: input.status });

    await store.table('domain_broker_cases').updateById(kase.id, { status: input.status });
    if (input.note) await store.table('domain_broker_messages').insert({ id: uuidv7(), case_id: kase.id, author_id: auth.id, visibility: 'internal', body: `Status ${kase.status} → ${input.status}: ${input.note}` });
    await writeEvent(kase.id, auth.id, 'status_changed', { from: kase.status, to: input.status });
    await writeAudit(kase.id, auth.id, 'case_status_updated', { from: kase.status, to: input.status });
    await notify(kase.user_id, 'Broker request update', `Your acquisition request for ${kase.domain} (${kase.brokerage_id}) is now: ${STATUS_LABELS[input.status] ?? input.status}.`);
    ctx.json({ ok: true, status: input.status });
  });

  router.post('/api/v1/admin/domain-brokerage/cases/:id/offers', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const kase = await store.table('domain_broker_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('No brokerage case was found');
    if (['completed', 'rejected', 'cancelled'].includes(kase.status)) throw new ConflictError('Offers cannot be added to a closed case');
    const input = await ctx.validate(v.object({
      amount: money(), currency: currency(),
      senderType: v.enum(['broker', 'seller', 'provider']),
      recipientType: v.enum(['customer', 'broker', 'seller', 'provider']).default('customer'),
      expiresAt: v.string().optional(), providerReference: v.string().max(255).optional(),
    }));

    // Supersede any still-open offers so a customer can never accept a stale one.
    const open = (await store.table('domain_broker_offers').all()).filter((o) => o.case_id === kase.id && o.status === 'open');
    for (const o of open) await store.table('domain_broker_offers').updateById(o.id, { status: 'superseded' });

    const offer = await store.table('domain_broker_offers').insert({
      id: uuidv7(), case_id: kase.id, amount: input.amount, currency: input.currency.toUpperCase(),
      sender_type: input.senderType, recipient_type: input.recipientType,
      expires_at: input.expiresAt ?? null, provider_reference: input.providerReference ?? null, status: 'open',
    });
    if (input.recipientType === 'customer') await store.table('domain_broker_cases').updateById(kase.id, { current_offer: input.amount, status: 'offer_received' });
    await writeEvent(kase.id, auth.id, 'offer_recorded', { offerId: offer.id, amount: input.amount, senderType: input.senderType });
    await writeAudit(kase.id, auth.id, 'offer_recorded', { offerId: offer.id, senderType: input.senderType });
    if (input.recipientType === 'customer') await notify(kase.user_id, 'Broker offer received', `An offer of ${input.amount} ${input.currency.toUpperCase()} was recorded for ${kase.domain} (${kase.brokerage_id}).`);
    ctx.code(201).json({ offer: { id: offer.id, amount: offer.amount, currency: offer.currency, status: offer.status } });
  });

  router.post('/api/v1/admin/domain-brokerage/cases/:id/messages', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const kase = await store.table('domain_broker_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('No brokerage case was found');
    const input = await ctx.validate(v.object({ body: v.string().min(1).max(10000), visibility: v.enum(['customer', 'internal']).default('internal') }));
    const message = await store.table('domain_broker_messages').insert({ id: uuidv7(), case_id: kase.id, author_id: auth.id, visibility: input.visibility, body: input.body });
    await writeEvent(kase.id, auth.id, input.visibility === 'internal' ? 'internal_note' : 'broker_message', { messageId: message.id });
    if (input.visibility === 'customer') await notify(kase.user_id, 'New message on your broker case', `Your broker posted an update on ${kase.domain} (${kase.brokerage_id}).`);
    ctx.code(201).json({ message: { id: message.id, visibility: message.visibility, body: message.body, createdAt: message.created_at } });
  });

  router.put('/api/v1/admin/domain-brokerage/cases/:id/payment', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const kase = await store.table('domain_broker_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('No brokerage case was found');
    const input = await ctx.validate(v.object({
      acquisitionAmount: money(), brokerageFee: v.coerce.number().min(0).default(0),
      transferFee: v.coerce.number().min(0).default(0), paymentFee: v.coerce.number().min(0).default(0),
      currency: currency(), status: v.enum(['pending', 'initiated', 'authorized', 'paid', 'failed', 'refunded', 'cancelled']),
    }));
    // Total is computed server-side from the fee components; clients never supply it.
    const total = Math.round((input.acquisitionAmount + input.brokerageFee + input.transferFee + input.paymentFee) * 100) / 100;
    const cur = input.currency.toUpperCase();

    const existing = (await store.table('domain_broker_payments').all()).find((p) => p.case_id === kase.id);
    const fields = { acquisition_amount: input.acquisitionAmount, brokerage_fee: input.brokerageFee, transfer_fee: input.transferFee, payment_fee: input.paymentFee, total_amount: total, currency: cur, status: input.status };
    const payment = existing
      ? await store.table('domain_broker_payments').updateById(existing.id, fields)
      : await store.table('domain_broker_payments').insert({ id: uuidv7(), case_id: kase.id, ...fields });

    if (kase.payment_status !== input.status) await store.table('domain_broker_cases').updateById(kase.id, { payment_status: input.status });
    await writeEvent(kase.id, auth.id, 'payment_updated', { status: input.status, total, currency: cur });
    await writeAudit(kase.id, auth.id, 'payment_updated', { status: input.status, total });
    if (kase.payment_status !== input.status) await notify(kase.user_id, 'Broker payment update', `Payment status for ${kase.domain} (${kase.brokerage_id}) is now ${input.status} (${total.toFixed(2)} ${cur}).`);
    ctx.json({ payment });
  });

  router.put('/api/v1/admin/domain-brokerage/cases/:id/transfer', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const kase = await store.table('domain_broker_cases').findById(ctx.params.id);
    if (!kase) throw new NotFoundError('No brokerage case was found');
    const input = await ctx.validate(v.object({
      status: v.enum(['not_started', 'authorization_required', 'initiated', 'processing', 'verified', 'failed']),
      registrar: v.string().max(255).optional(), providerReference: v.string().max(255).optional(), failureReason: v.string().max(1000).optional(),
    }));
    const initiatedNow = input.status === 'initiated' || input.status === 'processing';
    const completedNow = input.status === 'verified';
    const now = new Date().toISOString();

    const existing = (await store.table('domain_broker_transfers').all()).find((t) => t.case_id === kase.id);
    const fields = {
      status: input.status,
      registrar: input.registrar ?? (existing ? existing.registrar : null),
      provider_reference: input.providerReference ?? (existing ? existing.provider_reference : null),
      failure_reason: input.failureReason ?? null,
      initiated_at: initiatedNow ? (existing?.initiated_at ?? now) : (existing ? existing.initiated_at : null),
      completed_at: completedNow ? (existing?.completed_at ?? now) : (existing ? existing.completed_at : null),
    };
    const transfer = existing
      ? await store.table('domain_broker_transfers').updateById(existing.id, fields)
      : await store.table('domain_broker_transfers').insert({ id: uuidv7(), case_id: kase.id, ...fields });

    if (kase.transfer_status !== input.status) await store.table('domain_broker_cases').updateById(kase.id, { transfer_status: input.status });
    await writeEvent(kase.id, auth.id, 'transfer_updated', { status: input.status });
    await writeAudit(kase.id, auth.id, 'transfer_updated', { status: input.status });
    if (kase.transfer_status !== input.status) await notify(kase.user_id, 'Broker transfer update', `Transfer status for ${kase.domain} (${kase.brokerage_id}) is now ${input.status}.`);
    ctx.json({ transfer });
  });
}

module.exports = { name, register };
