/**
 * Cloudflare integration — customer side.
 *
 * Ported from cloudhost247-node/src/routes/cloudflare.ts. Customers connect a Cloudflare account
 * and manage services proxied through it. The live Cloudflare API client is deferred; this module
 * stores the integration state and queues jobs for the (deferred) worker.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'cloudflare';

function publicAccount(row) {
  return { id: row.id, accountName: row.account_name, status: row.status, createdAt: row.created_at };
}

function publicService(row) {
  return { id: row.id, zoneName: row.zone_name, status: row.status, planId: row.plan_id, createdAt: row.created_at };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/cloudflare/accounts', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('cloudflare_accounts').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ accounts: rows.map(publicAccount), total });
  });

  router.post('/api/v1/cloudflare/accounts', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ accountName: v.string().trim().min(1).max(120), apiToken: v.string().min(1).max(512) }));
    const account = await store.table('cloudflare_accounts').insert({
      id: uuidv7(), user_id: auth.id, account_name: body.accountName, api_token: body.apiToken, status: 'connected',
    });
    ctx.code(201).json({ account: publicAccount(account) });
  });

  router.get('/api/v1/cloudflare/services', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('cloudflare_services').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ services: rows.map(publicService), total });
  });

  router.post('/api/v1/cloudflare/services', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ accountId: v.string().min(1), zoneName: v.string().trim().min(3).max(253), planId: v.string().optional() }));

    const account = await store.table('cloudflare_accounts').findOne({ id: body.accountId, user_id: auth.id });
    if (!account) throw new NotFoundError('Cloudflare account not found');

    const serviceId = uuidv7();
    await store.transaction(async (tx) => {
      await tx.table('cloudflare_services').insert({ id: serviceId, user_id: auth.id, account_id: account.id, zone_name: body.zoneName, plan_id: body.planId ?? null, status: 'pending' });
      await tx.table('cloudflare_jobs').insert({ id: uuidv7(), account_id: account.id, service_id: serviceId, kind: 'create_service', status: 'queued', payload: { zoneName: body.zoneName } });
    });
    ctx.code(201).json({ service: { id: serviceId, status: 'pending' } });
  });

  router.get('/api/v1/cloudflare/logs', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const accounts = await store.table('cloudflare_accounts').all();
    const mine = new Set(accounts.filter((a) => a.user_id === auth.id).map((a) => a.id));
    const rows = await store.table('cloudflare_logs').all();
    ctx.json({ logs: rows.filter((l) => mine.has(l.account_id)).slice(-200) });
  });
}

module.exports = { name, register };
