/**
 * Domain Services — search, registration, transfer, WHOIS, appraisal, auctions, the Discount
 * Domain Club, availability watches and transactions.
 *
 * Ported from cloudhost247-node/src/routes/domain-services.ts. Provider-backed lookups (search,
 * WHOIS/RDAP, appraisal) are honest: with no registrar/RDAP/appraisal connector configured they
 * report `provider_unavailable` (or a clearly-marked structural estimate) and never fabricate a
 * definitive answer. Registrations, transfers, bids, club and watches are stored and queued for
 * the (deferred) provider worker. Ownership rule: "exists but isn't yours" is a 404, never a 403.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'domain-services';

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const domainName = () => v.string().trim().min(1).max(253).regex(DOMAIN_RE, 'must be a valid domain name or search term');
const money = () => v.coerce.number().min(0);

const TRANSFER_LABELS = { pending: 'Pending', awaiting_auth: 'Awaiting authorization', in_progress: 'In progress', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };

function structuralAvailability(term) {
  // No registrar connector: a structural guess only, clearly marked as an estimate.
  const available = !/(^|\.)test\.|^example\.|google|facebook/.test(term);
  return { domain: term, available, estimate: true };
}

function register(router, deps) {
  const { store } = deps;

  async function queue(userId, kind, resourceType, resourceId, payload) {
    return store.table('provisioning_jobs').insert({ id: uuidv7(), user_id: userId, kind, resource_type: resourceType, resource_id: resourceId, status: 'queued', payload: payload ?? {} });
  }

  // ---- readiness (public) -------------------------------------------------
  router.get('/api/v1/domain-services/readiness', async (ctx) => {
    // No registrar/RDAP/appraisal connector is configured in this deployment.
    ctx.json({
      registrar: { configured: false },
      rdap: { configured: false },
      appraisal: { configured: false },
      auctions: { configured: true }, // internal marketplace, always operational
    });
  });

  // ---- search / bulk-search / history -------------------------------------
  router.post('/api/v1/domain-services/search', async (ctx) => {
    const input = await ctx.validate(v.object({ query: domainName() }));
    let userId = null;
    try { userId = (await authenticate(ctx, { ...deps, allowMissing: true }))?.id ?? null; } catch { userId = null; }

    const term = input.query.toLowerCase();
    const results = [structuralAvailability(term), structuralAvailability(`get${term}`), structuralAvailability(`try${term}`)];
    const searchId = uuidv7();
    if (userId) await store.table('domain_searches').insert({ id: searchId, user_id: userId, query: term, results, kind: 'single' });
    ctx.json({ searchId: userId ? searchId : null, status: 'estimate', estimate: true, query: term, results });
  });

  router.post('/api/v1/domain-services/bulk-search', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({ content: v.string().min(1).max(100000), sourceType: v.enum(['text', 'csv', 'txt']).default('text') }));
    const terms = input.content.split(/[\s,;]+/).map((t) => t.trim().toLowerCase()).filter((t) => DOMAIN_RE.test(t)).slice(0, 500);
    const results = terms.map(structuralAvailability);
    const searchId = uuidv7();
    await store.table('domain_searches').insert({ id: searchId, user_id: auth.id, query: `${terms.length} terms`, results, kind: 'bulk' });
    ctx.json({ searchId, status: 'estimate', estimate: true, acceptedCount: terms.length, rejectedCount: 0, results });
  });

  router.get('/api/v1/domain-services/searches', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_searches').all()).filter((s) => s.user_id === auth.id && s.kind !== 'bulk');
    ctx.json({ searches: rows.map((s) => ({ id: s.id, query: s.query, createdAt: s.created_at })) });
  });

  router.get('/api/v1/domain-services/searches/bulk', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_searches').all()).filter((s) => s.user_id === auth.id && s.kind === 'bulk');
    ctx.json({ searches: rows.map((s) => ({ id: s.id, query: s.query, createdAt: s.created_at })) });
  });

  router.get('/api/v1/domain-services/searches/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_searches').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No search was found with that id');
    ctx.json({ results: row.results ?? [] });
  });

  // ---- extensions directory (public) --------------------------------------
  router.get('/api/v1/domain-services/extensions', async (ctx) => {
    const query = await ctx.validateQuery(v.object({ search: v.string().optional() }));
    let rows = await store.table('domain_extensions').all();
    if (query.search) rows = rows.filter((e) => e.tld.includes(query.search.toLowerCase()));
    ctx.json({ extensions: rows.map((e) => ({ tld: e.tld, registerPriceCents: e.register_price_cents, renewPriceCents: e.renew_price_cents })) });
  });

  // ---- registration -------------------------------------------------------
  router.post('/api/v1/domain-services/registrations/quote', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({ domainName: domainName(), years: v.coerce.number().int().min(1).max(10).default(1) }));
    const tld = input.domainName.split('.').pop();
    const ext = (await store.table('domain_extensions').all()).find((e) => e.tld === tld);
    const perYear = ext ? ext.register_price_cents / 100 : 9.99;
    ctx.json({ quote: { domainName: input.domainName, years: input.years, currency: 'USD', total: Math.round(perYear * input.years * 100) / 100, estimate: !ext } });
  });

  router.post('/api/v1/domain-services/registrations', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({
      domainName: domainName(),
      years: v.coerce.number().int().min(1).max(10).default(1),
      contact: v.object({}).passthrough(),
    }));
    const id = uuidv7();
    await store.table('domain_registrations').insert({ id, user_id: auth.id, domain: input.domainName.toLowerCase(), domain_name: input.domainName.toLowerCase(), years: input.years, status: 'pending' });
    await queue(auth.id, 'register_domain', 'domain_registrations', id, { domainName: input.domainName, years: input.years });
    ctx.code(201).json({ registrationId: id, status: 'pending' });
  });

  router.get('/api/v1/domain-services/registrations', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_registrations').all()).filter((r) => r.user_id === auth.id);
    ctx.json({ registrations: rows.map((r) => ({ id: r.id, domainName: r.domain, years: r.years, status: r.status, createdAt: r.created_at })) });
  });

  router.get('/api/v1/domain-services/registrations/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_registrations').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No registration was found with that id');
    ctx.json({ registration: { id: row.id, domainName: row.domain, years: row.years, status: row.status, createdAt: row.created_at } });
  });

  // ---- transfer -----------------------------------------------------------
  router.post('/api/v1/domain-services/transfers', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({
      domainName: domainName(),
      currentRegistrar: v.string().max(255).optional(),
      authCode: v.string().min(4).max(128),
      authorizationConfirmed: v.boolean(),
      contact: v.object({}).passthrough().optional(),
    }));
    if (input.authorizationConfirmed !== true) throw new ValidationError('You must confirm authorization');
    const id = uuidv7();
    await store.table('domain_transfers').insert({ id, user_id: auth.id, domain: input.domainName.toLowerCase(), domain_name: input.domainName.toLowerCase(), auth_code: input.authCode, status: 'pending' });
    await queue(auth.id, 'transfer_domain', 'domain_transfers', id, { domainName: input.domainName });
    ctx.code(201).json({ transferId: id, status: 'pending', statusLabel: TRANSFER_LABELS.pending });
  });

  router.get('/api/v1/domain-services/transfers', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_transfers').all()).filter((t) => t.user_id === auth.id);
    ctx.json({ transfers: rows.map((t) => ({ id: t.id, domainName: t.domain, status: t.status, statusLabel: TRANSFER_LABELS[t.status] ?? t.status, createdAt: t.created_at })) });
  });

  router.get('/api/v1/domain-services/transfers/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_transfers').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No transfer was found with that id');
    ctx.json({ transfer: { id: row.id, domainName: row.domain, status: row.status, statusLabel: TRANSFER_LABELS[row.status] ?? row.status } });
  });

  // ---- WHOIS (honest) -----------------------------------------------------
  router.post('/api/v1/domain-services/whois', async (ctx) => {
    const input = await ctx.validate(v.object({ domainName: domainName() }));
    let userId = null;
    try { userId = (await authenticate(ctx, { ...deps, allowMissing: true }))?.id ?? null; } catch { userId = null; }
    const id = uuidv7();
    await store.table('domain_whois_lookups').insert({ id, user_id: userId, domain: input.domainName.toLowerCase(), status: 'provider_unavailable' });
    ctx.json({ lookupId: id, domainName: input.domainName.toLowerCase(), status: 'provider_unavailable', message: 'WHOIS/RDAP lookup requires a provider connector (deferred).' });
  });

  router.get('/api/v1/domain-services/whois/history', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_whois_lookups').all()).filter((l) => l.user_id === auth.id);
    ctx.json({ lookups: rows.map((l) => ({ id: l.id, domain: l.domain, status: l.status, createdAt: l.created_at })) });
  });

  // ---- appraisal (provider-gated) -----------------------------------------
  router.post('/api/v1/domain-services/appraisals', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({ domainName: domainName() }));
    const id = uuidv7();
    await store.table('domain_appraisals').insert({ id, user_id: auth.id, domain: input.domainName.toLowerCase(), status: 'pending' });
    ctx.code(201).json({ appraisalId: id, status: 'pending', message: 'Appraisal requires a provider connector (deferred).' });
  });

  router.get('/api/v1/domain-services/appraisals', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_appraisals').all()).filter((a) => a.user_id === auth.id);
    ctx.json({ appraisals: rows.map((a) => ({ id: a.id, domain: a.domain, status: a.status, estimatedValue: a.estimated_value, createdAt: a.created_at })) });
  });

  router.get('/api/v1/domain-services/appraisals/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_appraisals').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No appraisal was found with that id');
    ctx.json({ appraisal: { id: row.id, domain: row.domain, status: row.status, estimatedValue: row.estimated_value } });
  });

  // ---- auctions -----------------------------------------------------------
  router.get('/api/v1/domain-services/auctions', async (ctx) => {
    const query = await ctx.validateQuery(v.object({ status: v.string().optional(), search: v.string().optional(), page: v.coerce.number().int().min(1).default(1), limit: v.coerce.number().int().min(1).max(100).default(20) }));
    let rows = await store.table('domain_auctions').all();
    if (query.status) rows = rows.filter((a) => a.status === query.status);
    if (query.search) rows = rows.filter((a) => (a.domain || '').includes(query.search.toLowerCase()));
    const start = (query.page - 1) * query.limit;
    ctx.json({ auctions: rows.slice(start, start + query.limit).map((a) => ({ id: a.id, domain: a.domain, status: a.status, currentBid: a.current_bid, endsAt: a.ends_at })), page: query.page, limit: query.limit });
  });

  router.get('/api/v1/domain-services/auctions/:id', async (ctx) => {
    const auction = await store.table('domain_auctions').findById(ctx.params.id);
    if (!auction) throw new NotFoundError('No auction was found with that id');
    const bids = (await store.table('domain_auction_bids').all()).filter((b) => b.auction_id === auction.id);
    ctx.json({ auction: { id: auction.id, domain: auction.domain, status: auction.status, currentBid: auction.current_bid, endsAt: auction.ends_at }, bids: bids.map((b) => ({ id: b.id, amount: b.amount, createdAt: b.created_at })) });
  });

  router.post('/api/v1/domain-services/auctions/:id/bids', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const auction = await store.table('domain_auctions').findById(ctx.params.id);
    if (!auction) throw new NotFoundError('No auction was found with that id');
    if (auction.status !== 'active') throw new ValidationError('Auction is not active');
    const input = await ctx.validate(v.object({ amount: money(), idempotencyKey: v.string().min(8).max(128).optional() }));
    if (input.amount <= Number(auction.current_bid ?? 0)) throw new ValidationError('Bid must exceed the current bid');
    const bidId = uuidv7();
    await store.table('domain_auction_bids').insert({ id: bidId, auction_id: auction.id, user_id: auth.id, amount: input.amount, amount_cents: Math.round(input.amount * 100) });
    await store.table('domain_auctions').updateById(auction.id, { current_bid: input.amount, current_bid_cents: Math.round(input.amount * 100) });
    ctx.code(201).json({ bidId, amount: input.amount });
  });

  router.get('/api/v1/domain-services/auctions/my/bids', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_auction_bids').all()).filter((b) => b.user_id === auth.id);
    ctx.json({ bids: rows.map((b) => ({ id: b.id, auctionId: b.auction_id, amount: b.amount, createdAt: b.created_at })) });
  });

  router.get('/api/v1/domain-services/auctions/my/won', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const auctions = (await store.table('domain_auctions').all()).filter((a) => a.status === 'won' && a.user_id === auth.id);
    ctx.json({ auctions: auctions.map((a) => ({ id: a.id, domain: a.domain, status: a.status })) });
  });

  router.get('/api/v1/domain-services/auctions/my/lost', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const auctions = (await store.table('domain_auctions').all()).filter((a) => a.status === 'lost' && a.user_id === auth.id);
    ctx.json({ auctions: auctions.map((a) => ({ id: a.id, domain: a.domain, status: a.status })) });
  });

  router.post('/api/v1/domain-services/auctions/:id/pay', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const auction = await store.table('domain_auctions').findById(ctx.params.id);
    if (!auction) throw new NotFoundError('No auction was found with that id');
    const orderId = uuidv7();
    await store.table('domain_transactions').insert({ id: uuidv7(), user_id: auth.id, transaction_type: 'auction_payment', status: 'pending', amount: auction.current_bid ?? 0, order_id: orderId });
    ctx.code(201).json({ orderId, amount: auction.current_bid ?? 0 });
  });

  // ---- Discount Domain Club -----------------------------------------------
  router.get('/api/v1/domain-services/club/plans', async (ctx) => {
    const rows = (await store.table('domain_club_plans').all()).filter((p) => p.active);
    ctx.json({ plans: rows.map((p) => ({ id: p.id, name: p.name, priceCents: p.price_cents, discountType: p.discount_type, discountValue: p.discount_value })) });
  });

  router.post('/api/v1/domain-services/club/plans/:id/subscribe', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const plan = await store.table('domain_club_plans').findById(ctx.params.id);
    if (!plan || !plan.active) throw new NotFoundError('No plan was found with that id');
    const membershipId = uuidv7();
    await store.table('domain_club_memberships').insert({ id: membershipId, user_id: auth.id, plan_id: plan.id, status: 'active' });
    ctx.code(201).json({ membershipId, orderId: null, planId: plan.id });
  });

  router.get('/api/v1/domain-services/club/membership', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = (await store.table('domain_club_memberships').all()).find((m) => m.user_id === auth.id && m.status === 'active');
    ctx.json({ membership: row ? { id: row.id, planId: row.plan_id, status: row.status, startedAt: row.started_at } : null });
  });

  router.delete('/api/v1/domain-services/club/membership', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = (await store.table('domain_club_memberships').all()).find((m) => m.user_id === auth.id && m.status === 'active');
    if (!row) throw new NotFoundError('No membership was found');
    await store.table('domain_club_memberships').updateById(row.id, { status: 'cancelled', cancelled_at: new Date().toISOString() });
    ctx.noContent();
  });

  router.get('/api/v1/domain-services/club/pricing-preview', async (ctx) => {
    const query = await ctx.validateQuery(v.object({ standardPrice: v.string().optional() }));
    const standard = query.standardPrice && /^\d{1,10}(\.\d{1,2})?$/.test(query.standardPrice) ? Number(query.standardPrice) : null;
    if (standard === null) throw new ValidationError('Provide standardPrice as a decimal amount, e.g. 20.00');
    let userId = null;
    try { userId = (await authenticate(ctx, { ...deps, allowMissing: true }))?.id ?? null; } catch { userId = null; }

    let discount = null;
    if (userId) {
      const membership = (await store.table('domain_club_memberships').all()).find((m) => m.user_id === userId && m.status === 'active');
      if (membership) {
        const plan = await store.table('domain_club_plans').findById(membership.plan_id);
        if (plan) discount = plan;
      }
    }
    if (!discount) {
      const plans = (await store.table('domain_club_plans').all()).filter((p) => p.active).sort((a, b) => a.price_cents - b.price_cents);
      discount = plans[0] ?? null;
    }
    if (!discount) return ctx.json({ standardPrice: standard.toFixed(2), memberPrice: standard.toFixed(2), savings: '0.00', clubName: null });

    const standardCents = Math.round(standard * 100);
    const discountCents = discount.discount_type === 'percentage'
      ? Math.round((standardCents * Number(discount.discount_value)) / 100)
      : Math.min(Math.round(Number(discount.discount_value) * 100), standardCents);
    ctx.json({
      standardPrice: standard.toFixed(2),
      memberPrice: ((standardCents - discountCents) / 100).toFixed(2),
      savings: (discountCents / 100).toFixed(2),
      clubName: discount.name,
    });
  });

  // ---- availability watches -----------------------------------------------
  router.post('/api/v1/domain-services/watches', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({ domainName: domainName() }));
    const existing = await store.table('domain_watches').findOne({ user_id: auth.id, domain: input.domainName.toLowerCase() });
    if (existing) return ctx.code(201).json({ watch: { id: existing.id, domainName: existing.domain, status: existing.status } });
    const id = uuidv7();
    await store.table('domain_watches').insert({ id, user_id: auth.id, domain: input.domainName.toLowerCase(), domain_name: input.domainName.toLowerCase(), status: 'active' });
    ctx.code(201).json({ watch: { id, domainName: input.domainName.toLowerCase(), status: 'active' } });
  });

  router.get('/api/v1/domain-services/watches', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_watches').all()).filter((w) => w.user_id === auth.id);
    ctx.json({ watches: rows.map((w) => ({ id: w.id, domainName: w.domain, status: w.status, createdAt: w.created_at })) });
  });

  router.delete('/api/v1/domain-services/watches/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const row = await store.table('domain_watches').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!row) throw new NotFoundError('No watch was found with that id');
    await store.table('domain_watches').deleteById(row.id);
    ctx.noContent();
  });

  // ---- transactions (read-only) -------------------------------------------
  router.get('/api/v1/domain-services/transactions', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const rows = (await store.table('domain_transactions').all()).filter((t) => t.user_id === auth.id);
    ctx.json({ transactions: rows.map((t) => ({ id: t.id, type: t.transaction_type, status: t.status, amount: t.amount, currency: t.currency, orderId: t.order_id, createdAt: t.created_at })) });
  });
}

module.exports = { name, register };
