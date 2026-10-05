/**
 * Domain aftermarket: registration, transfers, auctions, bids, watchlists.
 *
 * Ported from cloudhost247-node/src/routes/domain-services.ts. Registration/transfer are queued
 * jobs (registrar connector deferred). Auctions are a self-contained bidding market.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'domain-services';

function publicAuction(row) {
  return {
    id: row.id, domainName: row.domain_name, status: row.status,
    startingBidCents: row.starting_bid_cents, currentBidCents: row.current_bid_cents,
    endsAt: row.ends_at, createdAt: row.created_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  // ---- registration -------------------------------------------------------
  router.post('/api/v1/domains/register', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ domainName: v.string().trim().min(3).max(253), years: v.coerce.number().int().min(1).max(10).default(1) }));

    const jobId = uuidv7();
    await store.transaction(async (tx) => {
      await tx.table('domain_registrations').insert({ id: jobId, user_id: auth.id, domain_name: body.domainName, years: body.years, status: 'pending' });
      await tx.table('provisioning_jobs').insert({ id: uuidv7(), kind: 'register_domain', resource_type: 'domain_registrations', resource_id: jobId, user_id: auth.id, status: 'queued', payload: body });
    });
    ctx.code(201).json({ registration: { id: jobId, status: 'pending' } });
  });

  router.get('/api/v1/domains/registrations', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('domain_registrations').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ registrations: rows.map((r) => ({ id: r.id, domainName: r.domain_name, status: r.status, years: r.years })), total });
  });

  // ---- transfers ----------------------------------------------------------
  router.post('/api/v1/domains/transfer', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ domainName: v.string().trim().min(3).max(253), authCode: v.string().trim().min(1).max(255) }));
    const jobId = uuidv7();
    await store.transaction(async (tx) => {
      await tx.table('domain_transfers').insert({ id: jobId, user_id: auth.id, domain_name: body.domainName, auth_code: body.authCode, status: 'pending' });
      await tx.table('provisioning_jobs').insert({ id: uuidv7(), kind: 'transfer_domain', resource_type: 'domain_transfers', resource_id: jobId, user_id: auth.id, status: 'queued', payload: { domainName: body.domainName } });
    });
    ctx.code(201).json({ transfer: { id: jobId, status: 'pending' } });
  });

  // ---- auctions -----------------------------------------------------------
  router.get('/api/v1/domains/auctions', async (ctx) => {
    await authenticate(ctx, deps);
    const { rows, total } = await store.table('domain_auctions').find({}, { orderBy: '-created_at' });
    ctx.json({ auctions: rows.map(publicAuction), total });
  });

  router.post('/api/v1/domains/auction-listings', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      domainName: v.string().trim().min(3).max(253),
      startingBidCents: v.coerce.number().int().min(0),
      endsAt: v.string().min(1),
    }));
    const auction = await store.table('domain_auctions').insert({
      id: uuidv7(), user_id: auth.id, domain_name: body.domainName,
      starting_bid_cents: body.startingBidCents, current_bid_cents: body.startingBidCents,
      ends_at: body.endsAt, status: 'active',
    });
    ctx.code(201).json({ auction: publicAuction(auction) });
  });

  router.get('/api/v1/domains/auctions/:id', async (ctx) => {
    await authenticate(ctx, deps);
    const auction = await store.table('domain_auctions').findById(ctx.params.id);
    if (!auction) throw new NotFoundError('Auction not found');
    const { rows } = await store.table('domain_auction_bids').find({ auction_id: auction.id }, { orderBy: '-created_at' });
    ctx.json({ auction: publicAuction(auction), bids: rows.map((b) => ({ id: b.id, amountCents: b.amount_cents, createdAt: b.created_at })) });
  });

  router.post('/api/v1/domains/auctions/:id/bids', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const auction = await store.table('domain_auctions').findById(ctx.params.id);
    if (!auction) throw new NotFoundError('Auction not found');
    if (auction.status !== 'active') throw new ValidationError('Auction is not active');
    if (new Date(auction.ends_at).getTime() < Date.now()) throw new ValidationError('Auction has ended');

    const body = await ctx.validate(v.object({ amountCents: v.coerce.number().int().min(1) }));
    if (body.amountCents <= auction.current_bid_cents) throw new ValidationError('Bid must exceed the current bid');
    if (auction.user_id === auth.id) throw new ValidationError('You cannot bid on your own auction');

    await store.transaction(async (tx) => {
      await tx.table('domain_auction_bids').insert({ id: uuidv7(), auction_id: auction.id, user_id: auth.id, amount_cents: body.amountCents });
      await tx.table('domain_auctions').updateById(auction.id, { current_bid_cents: body.amountCents });
    });
    ctx.code(201).json({ ok: true, currentBidCents: body.amountCents });
  });

  // ---- watchlist ----------------------------------------------------------
  router.get('/api/v1/domains/watches', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('domain_watches').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ watches: rows.map((w) => ({ id: w.id, domainName: w.domain_name })) });
  });

  router.post('/api/v1/domains/watches', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ domainName: v.string().trim().min(3).max(253) }));
    const existing = await store.table('domain_watches').findOne({ user_id: auth.id, domain_name: body.domainName });
    if (existing) return ctx.json({ idempotent: true, watch: { id: existing.id, domainName: existing.domain_name } });
    const watch = await store.table('domain_watches').insert({ id: uuidv7(), user_id: auth.id, domain_name: body.domainName });
    ctx.code(201).json({ watch: { id: watch.id, domainName: watch.domain_name } });
  });

  router.delete('/api/v1/domains/watches/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const watch = await store.table('domain_watches').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!watch) throw new NotFoundError('Watch not found');
    await store.table('domain_watches').deleteById(watch.id);
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
