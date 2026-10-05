/**
 * Account identity: full account view, the six-digit Security Number, and profile image.
 *
 * Ported from cloudhost247-node/src/routes/account-identity.ts. The Security Number's plaintext is
 * never stored — only a bcrypt/scrypt hash — and status reports only whether one is set and
 * unexpired. Profile images are size-capped and stored base64 in the store.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError, UnauthorizedError, ForbiddenError, PayloadTooLargeError } = require('../core/errors');
const { hashPassword, verifyPassword } = require('../lib/password');
const { authenticate } = require('../lib/auth');
const { publicUser } = require('./auth');
const { uuidv7 } = require('../lib/ids');
const crypto = require('node:crypto');

const name = 'account-identity';

const MAX_IMAGE_BYTES = 512 * 1024;
const REVEAL_TTL_SECONDS = 60;
const SECURITY_NUMBER_TTL_MS = 365 * 86400_000;

/** A random four-digit security number (plaintext, returned exactly once). */
function generateSecurityNumber() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

/** Best-effort audit insert; never lets logging break the request. */
async function writeAudit(store, ctx, auth, action, entityId, metadata) {
  try {
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role, action,
      entity_type: 'user', entity_id: entityId,
      ip_address: ctx.ip, user_agent: ctx.userAgent, after: metadata ?? null,
    });
  } catch { /* audit is best-effort */ }
}

/** Rotate (or set) the security number, storing only a hash. Returns the plaintext once. */
async function rotateSecurityNumber(store, user, plain) {
  const value = plain ?? generateSecurityNumber();
  const version = (user.security_number_version ?? 0) + 1;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SECURITY_NUMBER_TTL_MS).toISOString();
  await store.table('users').updateById(user.id, {
    security_number_hash: await hashPassword(value),
    security_number_created_at: createdAt,
    security_number_expires_at: expiresAt,
    security_number_version: version,
    security_number_initialized: true,
  });
  return { value, version, createdAt, expiresAt };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/account', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const user = await store.table('users').findById(auth.id);
    if (!user) throw new NotFoundError('Account no longer exists');
    ctx.json({ user: publicUser(user) });
  });

  router.patch('/api/v1/account', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const input = await ctx.validate(v.object({
      fullName: v.string().trim().min(1).max(160).optional(),
      phone: v.string().trim().max(40).optional(),
      addressLine1: v.string().trim().max(200).optional(),
      city: v.string().trim().max(120).optional(),
      state: v.string().trim().max(120).optional(),
      postalCode: v.string().trim().max(20).optional(),
      country: v.string().trim().max(80).optional(),
    }));

    // Only safe, user-owned fields. email/role/status/customer_id/security_number_* are never
    // reachable here, so a crafted body cannot escalate privilege or rewrite identity.
    const patch = {};
    if (input.fullName !== undefined) patch.full_name = input.fullName;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.addressLine1 !== undefined) patch.address_line1 = input.addressLine1;
    if (input.city !== undefined) patch.city = input.city;
    if (input.state !== undefined) patch.state = input.state;
    if (input.postalCode !== undefined) patch.postal_code = input.postalCode;
    if (input.country !== undefined) patch.country = input.country;

    const user = await store.table('users').updateById(auth.id, patch);
    if (!user) throw new NotFoundError('Account no longer exists');
    await writeAudit(store, ctx, auth, 'account_profile_updated', user.id, { fields: Object.keys(patch) });
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
    await rotateSecurityNumber(store, user, body.securityNumber);
    ctx.json({ ok: true });
  });

  /**
   * Reveal: only a hash is stored, so "revealing" necessarily means issuing a NEW value — the old
   * one cannot be recovered by anyone, including us. Step-up authenticated with the password and
   * refused inside a support session. The response carries a short display TTL.
   */
  router.post('/api/v1/account/security-number/reveal', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    if (ctx.user?.supportSessionId) throw new ForbiddenError('Security Number reveal is not allowed during a support session');
    const body = await ctx.validate(v.object({ password: v.string().min(1) }));

    const user = await store.table('users').findById(auth.id);
    if (!user) throw new NotFoundError('Account no longer exists');

    const ok = await verifyPassword(body.password, user.password_hash);
    await writeAudit(store, ctx, auth, ok ? 'security_number_revealed' : 'security_number_reveal_failed', user.id, { succeeded: ok });
    if (!ok) throw new UnauthorizedError('Password is incorrect');

    const rotation = await rotateSecurityNumber(store, user);
    ctx.json({
      securityNumber: {
        value: rotation.value,
        version: rotation.version,
        expiresAt: rotation.expiresAt,
        displayTtlSeconds: REVEAL_TTL_SECONDS,
      },
    });
  });

  /**
   * Change: requires the current value (proving the caller holds it), enforces the four-digit
   * format, and starts a fresh rotation window from now.
   */
  router.post('/api/v1/account/security-number/change', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    if (ctx.user?.supportSessionId) throw new ForbiddenError('Security Number change is not allowed during a support session');
    const body = await ctx.validate(v.object({
      currentSecurityNumber: v.string().regex(/^\d{4}$/, 'Must be four digits'),
      newSecurityNumber: v.string().regex(/^\d{4}$/, 'The new Security Number must be exactly four digits'),
    }));

    const user = await store.table('users').findById(auth.id);
    if (!user) throw new NotFoundError('Account no longer exists');
    if (!user.security_number_initialized || !user.security_number_hash) {
      throw new ValidationError('This account has no Security Number yet. Request one from the security number status endpoint first.');
    }

    const matches = await verifyPassword(body.currentSecurityNumber, user.security_number_hash);
    await writeAudit(store, ctx, auth, matches ? 'security_number_changed' : 'security_number_verification_failed', user.id, { succeeded: matches });
    if (!matches) throw new UnauthorizedError('The current Security Number is incorrect');

    const rotation = await rotateSecurityNumber(store, user, body.newSecurityNumber);
    ctx.json({ securityNumber: { version: rotation.version, expiresAt: rotation.expiresAt, createdAt: rotation.createdAt } });
  });

  router.get('/api/v1/account/profile-image', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const image = await store.table('profile_images').findOne({ user_id: auth.id });
    if (!image) throw new NotFoundError('No profile image');
    ctx.json({ contentType: image.content_type, sizeBytes: image.size_bytes, dataBase64: image.data_base64 });
  });

  const uploadProfileImage = async (ctx) => {
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
        id: uuidv7(),
        user_id: auth.id,
        content_type: body.contentType,
        data_base64: body.dataBase64,
        size_bytes: raw.length,
      });
    }
    ctx.json({ ok: true, sizeBytes: raw.length });
  };
  router.post('/api/v1/account/profile-image', uploadProfileImage);
  router.put('/api/v1/account/profile-image', uploadProfileImage);

  router.delete('/api/v1/account/profile-image', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    await store.table('profile_images').deleteMany({ user_id: auth.id });
    ctx.json({ ok: true });
  });
}

module.exports = { name, register };
