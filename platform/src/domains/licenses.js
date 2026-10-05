/**
 * Software licenses.
 *
 * Ported from cloudhost247-node/src/routes/licenses.ts. License keys are generated
 * cryptographically and stored once; reads return a masked key after creation.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const { NotFoundError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { authenticate, asAdmin } = require('../lib/auth');

const name = 'licenses';

function issueKey() {
  const groups = [];
  for (let i = 0; i < 4; i += 1) groups.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  return groups.join('-');
}

function mask(key) {
  const parts = String(key).split('-');
  return parts.map((p, i) => (i === parts.length - 1 ? p : '****')).join('-');
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/licenses', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('licenses').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({ licenses: rows.map((l) => ({ id: l.id, product: l.product, status: l.status, expiresAt: l.expires_at, licenseKey: mask(l.license_key) })), total });
  });

  router.post('/api/v1/licenses', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ product: v.string().trim().min(1).max(120) }));

    const license = await store.table('licenses').insert({
      id: uuidv7(),
      user_id: auth.id,
      product: body.product,
      license_key: issueKey(),
      status: 'active',
    });
    // The full key is returned exactly once, at creation.
    ctx.code(201).json({ license: { id: license.id, product: license.product, licenseKey: license.license_key } });
  });

  router.get('/api/v1/admin/licenses', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('licenses').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ licenses: rows.map((l) => ({ id: l.id, userId: l.user_id, product: l.product, status: l.status, licenseKey: mask(l.license_key) })), total });
  });
}

module.exports = { name, register };
