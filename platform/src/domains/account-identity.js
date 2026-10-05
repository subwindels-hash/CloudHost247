/**
 * Account identity: full account view, the six-digit Security Number, and profile image.
 *
 * Ported from cloudhost247-node/src/routes/account-identity.ts. The Security Number's plaintext is
 * never stored — only a bcrypt/scrypt hash — and status reports only whether one is set and
 * unexpired. Profile images are size-capped and stored base64 in the store.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError, PayloadTooLargeError } = require('../core/errors');
const { hashPassword, verifyPassword } = require('../lib/password');
const { authenticate } = require('../lib/auth');
const { publicUser } = require('./auth');

const name = 'account-identity';

const MAX_IMAGE_BYTES = 512 * 1024;

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/account', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const user = await store.table('users').findById(auth.id);
    if (!user) throw new NotFoundError('Account no longer exists');
    ctx.json({ user: publicUser(user) });
  });

  router.get('/api/v1/account/security-number/status', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const user = await store.table('users').findById(auth.id);

    const has = Boolean(user.security_number_hash);
    const expired = user.security_number_expires_at
      ? new Date(user.security_number_expires_at).getTime() < Date.now()
      : false;

    ctx.json({
      initialized: user.security_number_initialized,
      set: has && !expired,
      expired,
      version: user.security_number_version,
      expiresAt: user.security_number_expires_at,
    });
  });

  router.post('/api/v1/account/security-number', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ securityNumber: v.string().regex(/^\d{4}$/, 'Security number must be four digits') }));

    const user = await store.table('users').findById(auth.id);
    await store.table('users').updateById(user.id, {
      security_number_hash: await hashPassword(body.securityNumber),
      security_number_created_at: new Date().toISOString(),
      security_number_expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
      security_number_version: (user.security_number_version ?? 0) + 1,
      security_number_initialized: true,
    });
    ctx.json({ ok: true });
  });

  router.get('/api/v1/account/profile-image', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const image = await store.table('profile_images').findOne({ user_id: auth.id });
    if (!image) throw new NotFoundError('No profile image');
    ctx.json({ contentType: image.content_type, sizeBytes: image.size_bytes, dataBase64: image.data_base64 });
  });

  router.post('/api/v1/account/profile-image', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      contentType: v.enum(['image/png', 'image/jpeg', 'image/webp']),
      dataBase64: v.string().min(1),
    }));

    const raw = Buffer.from(body.dataBase64, 'base64');
    if (raw.length > MAX_IMAGE_BYTES) throw new PayloadTooLargeError('Profile image exceeds 512 KB');

    const existing = await store.table('profile_images').findOne({ user_id: auth.id });
    if (existing) {
      await store.table('profile_images').updateById(existing.id, {
        content_type: body.contentType, data_base64: body.dataBase64, size_bytes: raw.length,
      });
    } else {
      await store.table('profile_images').insert({
        id: require('../lib/ids').uuidv7(),
        user_id: auth.id,
        content_type: body.contentType,
        data_base64: body.dataBase64,
        size_bytes: raw.length,
      });
    }
    ctx.json({ ok: true, sizeBytes: raw.length });
  });

  router.delete('/api/v1/account/profile-image', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    await store.table('profile_images').deleteMany({ user_id: auth.id });
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
