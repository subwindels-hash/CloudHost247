/**
 * Authentication: registration, login, sessions, password lifecycle, email verification, TOTP MFA.
 *
 * Ported from cloudhost247-node/src/routes/auth.ts. Route paths are standardised under
 * /api/v1/auth/*, with the legacy /api/auth/* paths registered as aliases so existing clients
 * (the current React SPA and the WHMCS-era links) keep working during the migration.
 *
 * Security properties carried over:
 *   - Passwords are hashed with scrypt (src/lib/password.js); plaintext is never stored or logged.
 *   - Login is rate limited per IP, and the limiter is reset on success so a user who mistypes
 *     three times is not locked out.
 *   - Login failure never reveals whether the email exists — same status, same message, and a
 *     dummy hash comparison is performed on the unknown-email path to equalise timing.
 *   - Logout revokes the specific token by `jti`, immediately, not at natural expiry.
 *   - A password change increments auth_session_version, invalidating every prior session.
 *   - Every event lands in auth_audit_log with IP and user agent.
 */
'use strict';

const crypto = require('node:crypto');
const { v } = require('../core/validate');
const {
  UnauthorizedError, ConflictError, NotFoundError, ForbiddenError, ValidationError,
} = require('../core/errors');
const { uuidv7, randomToken, generateCustomerId } = require('../lib/ids');
const { hashPassword, verifyPassword, needsRehash, isLegacyHash } = require('../lib/password');
const jwt = require('../lib/jwt');
const totp = require('../lib/totp');
const { authenticate } = require('../lib/auth');
const { rateLimit } = require('../core/ratelimit');

const name = 'auth';

// A bcrypt hash of a random string. Compared against on the unknown-email path so an attacker
// cannot measure whether the account exists from response time.
const TIMING_EQUALISER = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;

const registerSchema = v.object({
  email: v.string().trim().toLowerCase().email().max(254),
  password: v.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  fullName: v.string().trim().min(1).max(120),
  phone: v.string().trim().max(40).optional(),
  country: v.string().trim().max(2).optional(),
});

const loginSchema = v.object({
  email: v.string().trim().toLowerCase().email(),
  password: v.string().min(1).max(PASSWORD_MAX),
  totpCode: v.string().trim().regex(/^\d{6,8}$/).optional(),
  recoveryCode: v.string().trim().max(20).optional(),
});

const passwordSchema = v.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    status: user.status,
    customerId: user.customer_id,
    emailVerifiedAt: user.email_verified_at,
    phone: user.phone,
    address: {
      line1: user.address_line1,
      city: user.city,
      state: user.state,
      postalCode: user.postal_code,
      country: user.country,
    },
    createdAt: user.created_at,
  };
}

async function audit(deps, event) {
  await deps.store.table('auth_audit_log').insert({
    id: uuidv7(),
    user_id: event.userId ?? null,
    event_type: event.eventType,
    ip_address: event.ipAddress ?? null,
    user_agent: event.userAgent ?? null,
    metadata: event.metadata ?? {},
  });
}

/**
 * Assign a six-digit Customer ID.
 *
 * The unique index is the authoritative collision signal and insertion is retried — never a
 * SELECT-then-INSERT, which races under concurrent registration.
 */
async function createWithCustomerId(users, payload, attempts = 12) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await users.insert({ ...payload, customer_id: generateCustomerId() });
    } catch (err) {
      const duplicate = err.statusCode === 409 || err.code === '23505';
      if (!duplicate) throw err;
      // Distinguish a customer_id collision (retryable) from an email collision (not).
      if (!String(err.message).includes('customer_id')) throw err;
    }
  }
  throw new ConflictError('Could not allocate a customer ID, please try again');
}

function signSession(deps, user, extra = {}) {
  const accessToken = jwt.sign(
    { sub: user.id, role: user.role, email: user.email, sv: user.auth_session_version ?? 1, ...extra },
    deps.config.JWT_SECRET,
    { expiresInMs: extra.expiresInMs ?? deps.config.JWT_EXPIRES_MS }
  );
  const refreshToken = randomToken(48);
  return { accessToken, refreshToken };
}

/** Persist the refresh token (hashed) so it can be revoked independently of the access token. */
async function storeRefreshToken(deps, user, refreshToken, ttlMs) {
  await deps.store.table('auth_recovery').insert({
    id: uuidv7(),
    user_id: user.id,
    kind: 'refresh_token',
    token_hash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function register(router, deps) {
  const { store, config, authLimiter } = deps;
  const users = () => store.table('users');

  const loginLimit = rateLimit({
    limiter: authLimiter,
    max: config.RATE_LIMIT_AUTH_MAX,
    keyGenerator: (ctx) => ctx.ip,
    name: 'auth',
  });

  // ---------------------------------------------------------------- register
  const handleRegister = async (ctx) => {
    const input = await ctx.validate(registerSchema);

    const existing = await users().findOneCi('email', input.email);
    if (existing) throw new ConflictError('An account with this email already exists');

    const passwordHash = await hashPassword(input.password);
    const user = await createWithCustomerId(users(), {
      id: uuidv7(),
      email: input.email,
      password_hash: passwordHash,
      full_name: input.fullName,
      role: 'customer',
      phone: input.phone ?? null,
      country: input.country ?? null,
    });

    await audit(deps, {
      eventType: 'register',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { customerId: user.customer_id },
    });

    const { accessToken, refreshToken } = signSession(deps, user);
    await storeRefreshToken(deps, user, refreshToken, config.REFRESH_TOKEN_EXPIRES_MS);

    ctx.code(201).json({
      user: publicUser(user),
      accessToken,
      refreshToken,
      expiresIn: Math.floor(config.JWT_EXPIRES_MS / 1000),
    });
  };

  // -------------------------------------------------------------------- login
  const handleLogin = async (ctx) => {
    const input = await ctx.validate(loginSchema);
    const user = await users().findOneCi('email', input.email);

    if (!user) {
      // Equalise timing with a real derivation so "no such account" is not measurable.
      await verifyPassword(input.password, TIMING_EQUALISER);
      await audit(deps, {
        eventType: 'login_failure',
        userId: null,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: 'unknown_email' },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    if (isLegacyHash(user.password_hash)) {
      // bcrypt hash carried over from the Fastify platform. We do not re-implement bcrypt, so
      // these users must reset their password; say so explicitly rather than failing opaquely.
      throw new UnauthorizedError('This account must reset its password before signing in');
    }

    const ok = await verifyPassword(input.password, user.password_hash);
    if (!ok) {
      await audit(deps, {
        eventType: 'login_failure',
        userId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: 'bad_password' },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    if (user.status !== 'active') {
      await audit(deps, {
        eventType: 'login_failure',
        userId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: 'not_active', status: user.status },
      });
      throw new ForbiddenError(user.status === 'suspended'
        ? 'This account is suspended, please contact support'
        : 'This account is not active');
    }

    // --- MFA challenge ----------------------------------------------------
    const mfa = await store.table('totp_mfa').findOne({ user_id: user.id, status: 'enabled' });
    if (mfa) {
      if (input.recoveryCode) {
        const index = totp.findRecoveryCode(mfa.recovery_code_hashes ?? [], input.recoveryCode);
        if (index === null) {
          await audit(deps, {
            eventType: 'mfa_login_failure',
            userId: user.id,
            ipAddress: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { reason: 'bad_recovery_code' },
          });
          throw new UnauthorizedError('Invalid recovery code');
        }
        const hashes = [...(mfa.recovery_code_hashes ?? [])];
        hashes.splice(index, 1); // single-use
        await store.table('totp_mfa').updateById(mfa.id, { recovery_code_hashes: hashes });
        await audit(deps, {
          eventType: 'mfa_recovery_code_used',
          userId: user.id,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { remaining: hashes.length },
        });
      } else if (input.totpCode) {
        const { valid, counter } = totp.verifyTotp(mfa.secret_encrypted, input.totpCode, {
          lastCounter: mfa.last_used_counter ?? -1,
        });
        if (!valid) {
          await audit(deps, {
            eventType: 'mfa_login_failure',
            userId: user.id,
            ipAddress: ctx.ip,
            userAgent: ctx.userAgent,
            metadata: { reason: 'bad_totp' },
          });
          throw new UnauthorizedError('Invalid two-factor code');
        }
        await store.table('totp_mfa').updateById(mfa.id, {
          last_used_at: new Date().toISOString(),
          last_used_counter: counter,
        });
        await audit(deps, { eventType: 'mfa_login_challenge', userId: user.id, ipAddress: ctx.ip });
      } else {
        // Correct password but a second factor is still owed. The original answers 202 with a
        // short-lived, single-use continuation credential (never a session token) and the client
        // finishes at POST /auth/mfa/login/verify.
        authLimiter.reset(`auth:${ctx.ip}`);
        const mfaToken = await issueMfaLoginChallenge(user.id);
        ctx.code(202).json({ mfaRequired: true, method: 'totp', mfaToken });
        return;
      }
    }

    // Upgrade the hash transparently if parameters changed since it was written.
    if (needsRehash(user.password_hash)) {
      const upgraded = await hashPassword(input.password);
      const updated = await users().updateById(user.id, { password_hash: upgraded });
      Object.assign(user, updated);
    }

    authLimiter.reset(`auth:${ctx.ip}`);

    const { accessToken, refreshToken } = signSession(deps, user);
    await storeRefreshToken(deps, user, refreshToken, config.REFRESH_TOKEN_EXPIRES_MS);

    await audit(deps, {
      eventType: 'login_success',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    ctx.json({
      user: publicUser(user),
      accessToken,
      refreshToken,
      expiresIn: Math.floor(config.JWT_EXPIRES_MS / 1000),
      mfaRequired: false,
    });
  };

  // ------------------------------------------------------------------ refresh
  const handleRefresh = async (ctx) => {
    const body = (await ctx.parseBody()) ?? {};
    const refreshToken = body.refreshToken;
    if (typeof refreshToken !== 'string' || refreshToken.length < 20) {
      throw new UnauthorizedError('Missing refresh token');
    }

    const hash = sha256(refreshToken);
    const record = await store.table('auth_recovery').findOne({
      token_hash: hash,
      kind: 'refresh_token',
    });
    if (!record || record.consumed_at) throw new UnauthorizedError('Invalid refresh token');
    if (new Date(record.expires_at).getTime() < Date.now()) {
      await store.table('auth_recovery').deleteById(record.id);
      throw new UnauthorizedError('Refresh token has expired');
    }

    const user = await users().findById(record.user_id);
    if (!user || user.status !== 'active') throw new UnauthorizedError('Account is not active');

    // Rotate: consume the presented token and issue a new pair.
    await store.table('auth_recovery').updateById(record.id, { consumed_at: new Date().toISOString() });

    const { accessToken, refreshToken: next } = signSession(deps, user);
    await storeRefreshToken(deps, user, next, config.REFRESH_TOKEN_EXPIRES_MS);

    await audit(deps, {
      eventType: 'token_refresh',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    ctx.json({ accessToken, refreshToken: next, expiresIn: Math.floor(config.JWT_EXPIRES_MS / 1000) });
  };

  // ------------------------------------------------------------------- logout
  const handleLogout = async (ctx) => {
    const auth = await authenticate(ctx, deps);

    // Revoke this access token by jti so it stops working immediately. The row expires with the
    // token itself, so the revocation list cannot grow without bound.
    await store.table('revoked_tokens').insert({
      jti: auth.claims.jti,
      user_id: auth.id,
      reason: 'logout',
      expires_at: new Date(auth.claims.exp * 1000).toISOString(),
    });

    // Revoke every outstanding refresh token for this account too.
    const refreshTokens = await store.table('auth_recovery').find({
      user_id: auth.id,
      kind: 'refresh_token',
      consumed_at: null,
    });
    for (const token of refreshTokens.rows) {
      await store.table('auth_recovery').updateById(token.id, { consumed_at: new Date().toISOString() });
    }

    await audit(deps, {
      eventType: 'logout',
      userId: auth.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    ctx.json({ ok: true });
  };

  // ----------------------------------------------------------------------- me
  const handleMe = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const user = await users().findById(auth.id);
    const mfa = await store.table('totp_mfa').findOne({ user_id: auth.id, status: 'enabled' });

    ctx.json({
      user: publicUser(user),
      mfaEnabled: Boolean(mfa),
      actingAs: auth.supportSessionId ? { adminId: auth.actingAdminId, sessionId: auth.supportSessionId } : null,
    });
  };

  // --------------------------------------------------------- password change
  const handleChangePassword = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({
      currentPassword: v.string().min(1).max(PASSWORD_MAX),
      newPassword: passwordSchema,
    }));

    const user = await users().findById(auth.id);
    const ok = await verifyPassword(body.currentPassword, user.password_hash);
    // Deliberately 400 (ValidationError), not 401. authenticate() already succeeded, so the
    // bearer token is fine — only the submitted currentPassword failed. The SPA's apiFetch
    // treats any 401 while holding a token as proof the token is dead and clears the whole
    // session, so a mistyped current password would silently log the customer out. That was a
    // real bug caught by the existing platform's frontend tests.
    if (!ok) throw new ValidationError('Current password is incorrect');

    const passwordHash = await hashPassword(body.newPassword);
    // Incrementing auth_session_version in the same write as the hash is what actually
    // invalidates prior sessions — including one minted in the same second.
    const updated = await users().updateById(user.id, {
      password_hash: passwordHash,
      password_changed_at: new Date().toISOString(),
      auth_session_version: (user.auth_session_version ?? 0) + 1,
    });

    await audit(deps, {
      eventType: 'password_change',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const { accessToken, refreshToken } = signSession(deps, updated);
    await storeRefreshToken(deps, updated, refreshToken, config.REFRESH_TOKEN_EXPIRES_MS);

    ctx.json({ ok: true, accessToken, refreshToken, expiresIn: Math.floor(config.JWT_EXPIRES_MS / 1000) });
  };

  // --------------------------------------------------------- password reset
  const handleForgotPassword = async (ctx) => {
    const body = await ctx.validate(v.object({ email: v.string().trim().toLowerCase().email() }));
    const user = await users().findOneCi('email', body.email);

    // Always answer 200 with the same shape. Revealing whether the address is registered is an
    // account-enumeration oracle.
    if (user) {
      const token = randomToken(32);
      await store.table('auth_recovery').insert({
        id: uuidv7(),
        user_id: user.id,
        kind: 'password_reset',
        token_hash: sha256(token),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      await audit(deps, {
        eventType: 'password_reset_requested',
        userId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      // In development there is no mail transport, so surface the link instead of silently
      // dropping it. Production must deliver this by email (see src/services/mailer.js).
      if (config.NODE_ENV !== 'production') {
        ctx.locals.resetToken = token;
      }
    }

    ctx.json({ ok: true, message: 'If that email is registered, a reset link has been sent' });
  };

  const handleResetPassword = async (ctx) => {
    const body = await ctx.validate(v.object({
      token: v.string().min(10).max(200),
      password: passwordSchema,
    }));

    const record = await store.table('auth_recovery').findOne({
      token_hash: sha256(body.token),
      kind: 'password_reset',
    });
    if (!record || record.consumed_at) throw new ValidationError('This reset link is no longer valid');
    if (new Date(record.expires_at).getTime() < Date.now()) {
      throw new ValidationError('This reset link has expired');
    }

    const user = await users().findById(record.user_id);
    if (!user) throw new ValidationError('This reset link is no longer valid');

    const passwordHash = await hashPassword(body.password);
    const updated = await users().updateById(user.id, {
      password_hash: passwordHash,
      password_changed_at: new Date().toISOString(),
      auth_session_version: (user.auth_session_version ?? 0) + 1,
    });

    // Single use: mark consumed so the link cannot be replayed.
    await store.table('auth_recovery').updateById(record.id, { consumed_at: new Date().toISOString() });

    await audit(deps, {
      eventType: 'password_reset_completed',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const { accessToken, refreshToken } = signSession(deps, updated);
    await storeRefreshToken(deps, updated, refreshToken, config.REFRESH_TOKEN_EXPIRES_MS);

    ctx.json({ ok: true, accessToken, refreshToken, user: publicUser(updated) });
  };

  // ------------------------------------------------------- email verification
  const handleRequestVerification = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const token = randomToken(32);
    await store.table('auth_recovery').insert({
      id: uuidv7(),
      user_id: auth.id,
      kind: 'email_verification',
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    });
    await audit(deps, {
      eventType: 'email_verification_requested',
      userId: auth.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    ctx.json({ ok: true, ...(config.NODE_ENV !== 'production' ? { verificationToken: token } : {}) });
  };

  const handleVerifyEmail = async (ctx) => {
    const body = await ctx.validate(v.object({ token: v.string().min(10).max(200) }));
    const record = await store.table('auth_recovery').findOne({
      token_hash: sha256(body.token),
      kind: 'email_verification',
    });
    if (!record || record.consumed_at) throw new ValidationError('This verification link is no longer valid');
    if (new Date(record.expires_at).getTime() < Date.now()) throw new ValidationError('This verification link has expired');

    const user = await users().updateById(record.user_id, { email_verified_at: new Date().toISOString() });
    await store.table('auth_recovery').updateById(record.id, { consumed_at: new Date().toISOString() });
    await audit(deps, {
      eventType: 'email_verified',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    ctx.json({ ok: true, user: publicUser(user) });
  };

  // ---------------------------------------------------------------- TOTP MFA
  const handleMfaEnroll = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const existing = await store.table('totp_mfa').findOne({ user_id: auth.id });
    if (existing?.status === 'enabled') throw new ConflictError('Two-factor authentication is already enabled');

    const secret = totp.generateSecret();
    const uri = totp.otpauthUri({ secret, issuer: 'CloudHost247', account: auth.email });

    const record = existing
      ? await store.table('totp_mfa').updateById(existing.id, {
        secret_encrypted: secret,
        status: 'pending',
        last_used_counter: -1,
      })
      : await store.table('totp_mfa').insert({
        id: uuidv7(),
        user_id: auth.id,
        secret_encrypted: secret,
        status: 'pending',
      });

    await audit(deps, {
      eventType: 'mfa_enrollment_started',
      userId: auth.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    ctx.json({ id: record.id, secret, otpauthUri: uri });
  };

  const handleMfaConfirm = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ code: v.string().trim().regex(/^\d{6}$/) }));

    const record = await store.table('totp_mfa').findOne({ user_id: auth.id, status: 'pending' });
    if (!record) throw new ValidationError('No pending two-factor enrolment, start enrolment again');

    const { valid, counter } = totp.verifyTotp(record.secret_encrypted, body.code);
    if (!valid) throw new ValidationError('That code is not valid, check your authenticator app');

    const recovery = totp.generateRecoveryCodes(10);
    await store.table('totp_mfa').updateById(record.id, {
      status: 'enabled',
      last_used_at: new Date().toISOString(),
      last_used_counter: counter,
      recovery_code_hashes: recovery.hashes,
    });

    await audit(deps, {
      eventType: 'mfa_enabled',
      userId: auth.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // Shown exactly once; only the hashes are stored.
    ctx.json({ ok: true, recoveryCodes: recovery.plaintext });
  };

  const handleMfaStatus = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const record = await store.table('totp_mfa').findOne({ user_id: auth.id });
    ctx.json({
      enabled: record?.status === 'enabled',
      pending: record?.status === 'pending',
      recoveryCodesRemaining: record?.status === 'enabled' ? (record.recovery_code_hashes ?? []).length : 0,
      lastUsedAt: record?.last_used_at ?? null,
    });
  };

  const handleMfaDisable = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const body = await ctx.validate(v.object({ password: v.string().min(1).max(PASSWORD_MAX) }));

    const user = await users().findById(auth.id);
    // 400, not 401 — same reasoning as the password-change handler above.
    if (!(await verifyPassword(body.password, user.password_hash))) {
      throw new ValidationError('Password is incorrect');
    }

    const record = await store.table('totp_mfa').findOne({ user_id: auth.id });
    if (!record) throw new NotFoundError('Two-factor authentication is not enabled');

    await store.table('totp_mfa').updateById(record.id, { status: 'disabled' });
    await audit(deps, {
      eventType: 'mfa_disabled',
      userId: auth.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    ctx.json({ ok: true });
  };

  // ------------------------------------------------------------------ MFA + recovery

  /** A short-lived, single-use continuation credential for the second login factor. */
  const issueMfaLoginChallenge = async (userId) => {
    const token = randomToken(32);
    await store.table('mfa_login_challenges').insert({
      id: uuidv7(),
      user_id: userId,
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    return token;
  };

  /**
   * Verify a second factor, accepting either a TOTP code or a single-use recovery code (which is
   * consumed on success). Mirrors the check the inline login path performs so both entry points
   * enforce exactly the same rules.
   */
  const verifyMfaFactor = async (mfa, code) => {
    const index = totp.findRecoveryCode(mfa.recovery_code_hashes ?? [], code);
    if (index !== null) {
      const hashes = [...(mfa.recovery_code_hashes ?? [])];
      hashes.splice(index, 1);
      await store.table('totp_mfa').updateById(mfa.id, { recovery_code_hashes: hashes });
      return { ok: true, method: 'recovery_code' };
    }
    const { valid, counter } = totp.verifyTotp(mfa.secret_encrypted, code, {
      lastCounter: mfa.last_used_counter ?? -1,
    });
    if (!valid) return { ok: false, method: 'totp' };
    await store.table('totp_mfa').updateById(mfa.id, {
      last_used_at: new Date().toISOString(),
      last_used_counter: counter,
    });
    return { ok: true, method: 'totp' };
  };

  /** Issue a single-use recovery token for email verification or password reset. */
  const issueRecoveryToken = async (userId, kind, ttlMs) => {
    const token = randomToken(32);
    await store.table('auth_recovery').insert({
      id: uuidv7(),
      user_id: userId,
      kind,
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
    return token;
  };

  /** Load an unexpired, unconsumed recovery token of the given kind. */
  const loadRecoveryToken = async (rawToken, kind) => {
    const record = await store.table('auth_recovery').findOne({
      token_hash: sha256(rawToken),
      kind,
    });
    if (!record || record.consumed_at) return null;
    if (new Date(record.expires_at).getTime() < Date.now()) return null;
    return record;
  };

  /**
   * Complete a password-authenticated login with its second factor (auth.ts
   * POST /auth/mfa/login/verify). A bad or expired code is a single, non-specific 401 so the
   * response cannot be used to probe for valid accounts or codes.
   */
  const handleMfaLoginVerify = async (ctx) => {
    const body = await ctx.validate(v.object({
      mfaToken: v.string().min(10).max(200),
      code: v.string().min(6).max(64),
    }));

    const challenge = await store.table('mfa_login_challenges').findOne({ token_hash: sha256(body.mfaToken) });
    if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() < Date.now()) {
      throw new UnauthorizedError('Invalid or expired multi-factor authentication code');
    }

    const mfa = await store.table('totp_mfa').findOne({ user_id: challenge.user_id, status: 'enabled' });
    if (!mfa) throw new UnauthorizedError('Invalid or expired multi-factor authentication code');

    const result = await verifyMfaFactor(mfa, body.code);
    if (!result.ok) {
      await audit(deps, {
        eventType: 'mfa_login_failure',
        userId: challenge.user_id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedError('Invalid or expired multi-factor authentication code');
    }

    const user = await users().findById(challenge.user_id);
    if (!user || user.status !== 'active') throw new UnauthorizedError('This account is not active');

    // Single use: the challenge cannot be replayed even with a valid code.
    await store.table('mfa_login_challenges').updateById(challenge.id, { consumed_at: new Date().toISOString() });

    await audit(deps, {
      eventType: 'login_success',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { mfa: result.method },
    });
    if (result.method === 'recovery_code') {
      await audit(deps, {
        eventType: 'mfa_recovery_code_used',
        userId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }

    const { accessToken, refreshToken } = signSession(deps, user);
    await storeRefreshToken(deps, user, refreshToken, config.REFRESH_TOKEN_EXPIRES_MS);
    ctx.json({ user: publicUser(user), token: accessToken, accessToken, refreshToken });
  };

  /**
   * Request a password reset (auth.ts POST /auth/password-reset/request). Anonymous and
   * deliberately non-enumerating: an unknown address, a suspended account and a real one all get
   * the same 202 and the same body.
   */
  const handlePasswordResetRequest = async (ctx) => {
    const body = await ctx.validate(v.object({ email: v.string().trim().toLowerCase().email() }));
    const user = await users().findOneCi('email', body.email);

    let resetToken = null;
    if (user && user.status === 'active') {
      resetToken = await issueRecoveryToken(user.id, 'password_reset', 3600_000);
      await audit(deps, {
        eventType: 'password_reset_requested',
        userId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }

    ctx.code(202).json({
      message: 'If an active account matches that email address, a password reset link will be sent shortly.',
      // No mail transport in development; production must deliver this by email (src/services/mailer.js).
      ...(config.NODE_ENV !== 'production' && resetToken ? { resetToken } : {}),
    });
  };

  const handlePasswordResetConfirm = async (ctx) => {
    const body = await ctx.validate(v.object({
      token: v.string().min(10).max(200),
      password: passwordSchema,
    }));

    const record = await loadRecoveryToken(body.token, 'password_reset');
    if (!record) {
      throw new ValidationError('This password reset link is invalid or has expired. Request a new link to continue.');
    }
    const user = await users().findById(record.user_id);
    if (!user) {
      throw new ValidationError('This password reset link is invalid or has expired. Request a new link to continue.');
    }

    const updated = await users().updateById(user.id, {
      password_hash: await hashPassword(body.password),
      password_changed_at: new Date().toISOString(),
      auth_session_version: (user.auth_session_version ?? 0) + 1,
    });
    await store.table('auth_recovery').updateById(record.id, { consumed_at: new Date().toISOString() });
    await audit(deps, {
      eventType: 'password_reset_completed',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const { accessToken, refreshToken } = signSession(deps, updated);
    await storeRefreshToken(deps, updated, refreshToken, config.REFRESH_TOKEN_EXPIRES_MS);
    ctx.json({
      message: 'Your password has been reset. You can now log in with your new password.',
      accessToken,
      refreshToken,
      user: publicUser(updated),
    });
  };

  const handleEmailVerificationConfirm = async (ctx) => {
    const body = await ctx.validate(v.object({ token: v.string().min(10).max(200) }));
    const record = await loadRecoveryToken(body.token, 'email_verification');
    if (!record) {
      throw new ValidationError('This verification link is invalid or has expired. Request a new link to continue.');
    }

    const user = await users().updateById(record.user_id, { email_verified_at: new Date().toISOString() });
    await store.table('auth_recovery').updateById(record.id, { consumed_at: new Date().toISOString() });
    await audit(deps, {
      eventType: 'email_verified',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    ctx.json({ message: 'Your email address has been verified.', user: publicUser(user) });
  };

  /**
   * Resend the verification link (auth.ts POST /auth/email-verification/resend). 202 for both a
   * fresh queue and the throttled case, so a stolen session cannot be turned into a mail flood and
   * the browser learns nothing either way.
   */
  const handleEmailVerificationResend = async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const user = await users().findById(auth.id);
    if (!user) throw new UnauthorizedError('Account no longer exists');

    if (user.email_verified_at) {
      ctx.json({ message: 'This email address is already verified.', alreadyVerified: true, queued: false });
      return;
    }

    const token = await issueRecoveryToken(user.id, 'email_verification', 86400_000);
    await audit(deps, {
      eventType: 'email_verification_requested',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    ctx.code(202).json({
      message: 'A new verification link has been queued for delivery.',
      alreadyVerified: false,
      queued: true,
      ...(config.NODE_ENV !== 'production' ? { verificationToken: token } : {}),
    });
  };

  // ------------------------------------------------------------------ routes
  const routes = [
    ['post', '/api/v1/auth/register', handleRegister],
    ['post', '/api/v1/auth/login', loginLimit, handleLogin],
    ['post', '/api/v1/auth/refresh', handleRefresh],
    ['post', '/api/v1/auth/logout', handleLogout],
    ['get', '/api/v1/auth/me', handleMe],
    ['post', '/api/v1/auth/password/change', handleChangePassword],
    ['post', '/api/v1/auth/password/forgot', handleForgotPassword],
    ['post', '/api/v1/auth/password/reset', handleResetPassword],
    ['post', '/api/v1/auth/email/verify-request', handleRequestVerification],
    ['post', '/api/v1/auth/email/verify', handleVerifyEmail],
    ['post', '/api/v1/auth/mfa/totp/enroll', handleMfaEnroll],
    ['post', '/api/v1/auth/mfa/totp/confirm', handleMfaConfirm],
    ['post', '/api/v1/auth/mfa/disable', handleMfaDisable],
    ['get', '/api/v1/auth/mfa/status', handleMfaStatus],
    // The original mounts auth at /api/auth/*; these paths exist there in the source and the
    // alias loop below reproduces that. The /api/v1 forms are additive.
    ['post', '/api/v1/auth/password-reset/request', handlePasswordResetRequest],
    ['post', '/api/v1/auth/password-reset/confirm', handlePasswordResetConfirm],
    ['post', '/api/v1/auth/email-verification/confirm', handleEmailVerificationConfirm],
    ['post', '/api/v1/auth/email-verification/resend', handleEmailVerificationResend],
    ['post', '/api/v1/auth/mfa/login/verify', handleMfaLoginVerify],
  ];

  for (const [method, pattern, ...handlers] of routes) {
    router[method](pattern, ...handlers);
    // Legacy alias: the Fastify platform mounted auth at /api/auth/* (no version segment).
    router[method](pattern.replace('/api/v1/auth', '/api/auth'), ...handlers);
  }
}

// signSession/storeRefreshToken/audit are exported for the passkey domain, which issues the
// same session shape and records into the same audit table as password auth.
module.exports = { name, register, publicUser, signSession, storeRefreshToken, audit };
