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

const isStaffRole = (role) => ['admin', 'super_admin', 'staff'].includes(role);

function issueKey() {
  const groups = [];
  for (let i = 0; i < 4; i += 1) groups.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  return groups.join('-');
}

function mask(key) {
  const parts = String(key).split('-');
  return parts.map((p, i) => (i === parts.length - 1 ? p : '****')).join('-');
}

// Staff see the full record; customers get a masked key.
function licenseDto(row, isStaff) {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    product: row.product,
    status: row.status,
    activatedAt: row.activated_at ?? null,
    expiresAt: row.expires_at ?? null,
    licenseKey: isStaff ? row.license_key : mask(row.license_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  async function audit(ctx, action, resourceId, metadata) {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: ctx.user.id, actor_role: ctx.user.role, action,
      entity_type: 'license', entity_id: resourceId ?? null,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  }

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

  // License detail — staff see any license (with the real key); customers only their own (masked).
  router.get('/api/v1/licenses/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const license = await store.table('licenses').findById(ctx.params.id);
    const staff = isStaffRole(auth.role);
    if (!license || (!staff && license.user_id !== auth.id)) throw new NotFoundError('License not found');
    ctx.json({ license: licenseDto(license, staff) });
  });

  // Activate a license (admin only): status -> active, stamp activated_at.
  router.post('/api/v1/licenses/:id/activate', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const license = await store.table('licenses').findById(ctx.params.id);
    if (!license) throw new NotFoundError('License not found');
    const activated = await store.table('licenses').updateById(license.id, { status: 'active', activated_at: new Date().toISOString() });
    await audit(ctx, 'LICENSE_ACTIVATED', license.id, null);
    ctx.json({ license: licenseDto(activated, true) });
  });

  // Renew a license (admin only): status -> active, set the new expiry.
  router.post('/api/v1/licenses/:id/renew', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const body = await ctx.validate(v.object({ expiresAt: v.string().datetime() }));
    const license = await store.table('licenses').findById(ctx.params.id);
    if (!license) throw new NotFoundError('License not found');
    const renewed = await store.table('licenses').updateById(license.id, { status: 'active', expires_at: body.expiresAt });
    await audit(ctx, 'LICENSE_RENEWED', license.id, { newExpiresAt: body.expiresAt });
    ctx.json({ license: licenseDto(renewed, true) });
  });

  // Cancel a license (admin only): status -> cancelled.
  router.post('/api/v1/licenses/:id/cancel', async (ctx) => {
    const auth = await asAdmin(ctx, deps);
    const license = await store.table('licenses').findById(ctx.params.id);
    if (!license) throw new NotFoundError('License not found');
    const cancelled = await store.table('licenses').updateById(license.id, { status: 'cancelled' });
    await audit(ctx, 'LICENSE_CANCELLED', license.id, null);
    ctx.json({ license: licenseDto(cancelled, true) });
  });

  router.get('/api/v1/admin/licenses', async (ctx) => {
    await asAdmin(ctx, deps);
    const { rows, total } = await store.table('licenses').find({}, { orderBy: '-created_at', limit: 200 });
    ctx.json({ licenses: rows.map((l) => ({ id: l.id, userId: l.user_id, product: l.product, status: l.status, licenseKey: mask(l.license_key) })), total });
  });
}

module.exports = { name, register };
