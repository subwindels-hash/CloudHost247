/**
 * Passkeys / WebAuthn (FIDO2) — enrolment, management and passkey sign-in.
 *
 * Ported from cloudhost247-node/src/services/passkey-service.ts and
 * passkey-authentication-service.ts, but with the WebAuthn verification written against the spec
 * here (src/lib/webauthn/) instead of `@simplewebauthn/server`, because this platform has no
 * dependencies. The protocol semantics are the Fastify platform's:
 *
 *   - enrolment requires an authenticated session **and the current password**, and is refused
 *     inside a support session (support staff must not be able to add a credential they control to
 *     a customer's account)
 *   - a challenge is single-use, expires in five minutes, and belongs to one user and one ceremony
 *   - passkey sign-in returns the same session shape as password sign-in (access + refresh token),
 *     so the SPA needs no special case
 *   - a verified assertion with user verification satisfies authentication on its own; TOTP is not
 *     additionally demanded, because possession of the credential plus user verification is
 *     already two factors and the platform requests `userVerification: 'required'`
 *
 * Tables (already in the schema registry): `webauthn_passkeys`,
 * `webauthn_authentication_challenges`.
 */
'use strict';

const { v } = require('../core/validate');
const {
  UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, ValidationError,
} = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { verifyPassword, isLegacyHash } = require('../lib/password');
const { authenticate } = require('../lib/auth');
const { rateLimit } = require('../core/ratelimit');
const {
  relyingParty, newChallenge, buildRegistrationOptions, buildAuthenticationOptions, CHALLENGE_TTL_MS,
} = require('../lib/webauthn/options');
const { verifyRegistration, verifyAssertion } = require('../lib/webauthn/verify');
// Session issuance and auditing are shared with password auth so both paths produce identical
// sessions and land in the same audit table.
const { signSession, storeRefreshToken, audit, publicUser } = require('./auth');

const name = 'passkeys';

const PASSWORD_MAX = 200;

const registerOptionsSchema = v.object({
  password: v.string().min(1).max(PASSWORD_MAX),
});

const registerVerifySchema = v.object({
  challengeId: v.string().uuid(),
  response: v.record(v.any()),
  name: v.string().trim().min(1).max(80).optional(),
});

const renameSchema = v.object({ name: v.string().trim().min(1).max(80) });

const removeSchema = v.object({ password: v.string().min(1).max(PASSWORD_MAX) });

// `email` is optional: with it the ceremony is scoped to that account's credentials, without it
// the authenticator picks a discoverable credential and the account is learned from the assertion.
const loginOptionsSchema = v.object({
  email: v.string().trim().toLowerCase().email().max(254).optional(),
});

const loginVerifySchema = v.object({
  challengeId: v.string().uuid(),
  response: v.record(v.any()),
});

function passkeyDto(row) {
  return {
    id: row.id,
    name: row.name ?? 'Passkey',
    credentialId: row.credential_id,
    transports: row.transports ?? [],
    aaguid: row.aaguid ?? null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
  };
}

function register(router, deps) {
  const { store, config, authLimiter } = deps;

  const loginLimit = rateLimit({
    limiter: authLimiter,
    max: config.RATE_LIMIT_AUTH_MAX,
    keyGenerator: (ctx) => ctx.ip,
    name: 'auth',
  });

  // ------------------------------------------------------------------ helpers

  async function loadUser(ctx) {
    const auth = await authenticate(ctx, deps);
    const user = await store.table('users').findById(auth.id);
    if (!user) throw new NotFoundError('Account no longer exists');
    return { auth, user };
  }

  function assertNotSupportSession(ctx) {
    if (ctx.user?.supportSessionId) {
      throw new ForbiddenError('Passkey management is not allowed during a support session');
    }
  }

  async function assertPassword(user, password) {
    if (isLegacyHash(user.password_hash)) {
      throw new UnauthorizedError('This account must reset its password before managing passkeys');
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw new UnauthorizedError('Password is incorrect');
  }

  /**
   * Issues the single outstanding challenge for a ceremony. Any earlier unconsumed challenge of the
   * same kind is consumed first, so only the ceremony the user just started can complete.
   */
  async function issueChallenge(userId, kind, challenge) {
    const existing = await store.table('webauthn_authentication_challenges').find({ user_id: userId, kind });
    for (const row of existing.rows ?? []) {
      if (!row.consumed_at) {
        await store.table('webauthn_authentication_challenges')
          .updateById(row.id, { consumed_at: new Date().toISOString() });
      }
    }
    return store.table('webauthn_authentication_challenges').insert({
      id: uuidv7(),
      user_id: userId,
      challenge,
      kind,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    });
  }

  /**
   * Loads and consumes a challenge. Consumption happens before verification on purpose: a failed
   * attempt must burn the challenge, otherwise an attacker could grind signatures against one
   * challenge.
   */
  async function consumeChallenge(challengeId, kind, userId = null) {
    const row = await store.table('webauthn_authentication_challenges').findById(challengeId);
    if (!row || row.kind !== kind || row.consumed_at) return null;
    if (userId && row.user_id !== userId) return null;
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    await store.table('webauthn_authentication_challenges')
      .updateById(row.id, { consumed_at: new Date().toISOString() });
    return row;
  }

  // ------------------------------------------------------------------- routes

  /** List the caller's passkeys. */
  const handleList = async (ctx) => {
    const { user } = await loadUser(ctx);
    const { rows } = await store.table('webauthn_passkeys').find({ user_id: user.id }, { orderBy: '-created_at' });
    ctx.json({ passkeys: rows.map(passkeyDto) });
  };

  /** Begin enrolment: returns `navigator.credentials.create()` options. */
  const handleRegisterOptions = async (ctx) => {
    const { user } = await loadUser(ctx);
    assertNotSupportSession(ctx);

    const input = await ctx.validate(registerOptionsSchema);
    await assertPassword(user, input.password);

    const rp = relyingParty(config);
    const { rows: existing } = await store.table('webauthn_passkeys').find({ user_id: user.id });
    const challenge = newChallenge();
    const record = await issueChallenge(user.id, 'registration', challenge);

    ctx.json({
      challengeId: record.id,
      options: buildRegistrationOptions({
        rpId: rp.rpId,
        rpName: rp.rpName,
        user,
        challenge,
        excludeCredentials: existing,
      }),
    });
  };

  /** Finish enrolment: verifies the attestation and stores the credential. */
  const handleRegisterVerify = async (ctx) => {
    const { user } = await loadUser(ctx);
    assertNotSupportSession(ctx);

    const input = await ctx.validate(registerVerifySchema);
    const challenge = await consumeChallenge(input.challengeId, 'registration', user.id);
    if (!challenge) throw new UnauthorizedError('This registration ceremony has expired or was already used');

    const rp = relyingParty(config);
    const verdict = verifyRegistration({
      response: input.response,
      expectedChallenge: challenge.challenge,
      rpId: rp.rpId,
      origins: rp.origins,
      requireUserVerification: true,
    });
    if (!verdict.verified) {
      await audit(deps, {
        eventType: 'passkey_registration_failure',
        userId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: verdict.reason },
      });
      throw new ValidationError(`Passkey registration was refused: ${verdict.reason}`);
    }

    const info = verdict.registration;
    let passkey;
    try {
      passkey = await store.table('webauthn_passkeys').insert({
        id: uuidv7(),
        user_id: user.id,
        credential_id: info.credentialId,
        // The COSE key is stored as issued: `verifyAssertion` parses it back per ceremony, so a
        // credential that cannot be parsed fails loudly at sign-in rather than being silently
        // re-encoded into something else.
        public_key: info.publicKeyCose.toString('base64url'),
        counter: info.counter,
        transports: info.transports,
        name: input.name ?? 'Passkey',
        aaguid: info.aaguid,
      });
    } catch (err) {
      if (err.statusCode === 409 || err.code === '23505') {
        throw new ConflictError('This passkey is already registered on the account');
      }
      throw err;
    }

    await audit(deps, {
      eventType: 'passkey_registered',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        credentialId: info.credentialId,
        algorithm: info.algorithm,
        deviceType: info.deviceType,
        backedUp: info.backedUp,
        name: passkey.name,
      },
    });

    ctx.code(201).json({ passkey: passkeyDto(passkey) });
  };

  /** Rename one of the caller's passkeys. */
  const handleRename = async (ctx) => {
    const { user } = await loadUser(ctx);
    assertNotSupportSession(ctx);

    const input = await ctx.validate(renameSchema);
    const passkey = await store.table('webauthn_passkeys').findOne({
      id: ctx.params.id,
      user_id: user.id,
    });
    // A passkey belonging to someone else is indistinguishable from one that does not exist.
    if (!passkey) throw new NotFoundError('No passkey was found with that id');

    const updated = await store.table('webauthn_passkeys').updateById(passkey.id, { name: input.name });
    await audit(deps, {
      eventType: 'passkey_renamed',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { credentialId: passkey.credential_id, name: input.name },
    });
    ctx.json({ passkey: passkeyDto(updated) });
  };

  /** Remove one of the caller's passkeys (password required). */
  const handleRemove = async (ctx) => {
    const { user } = await loadUser(ctx);
    assertNotSupportSession(ctx);

    const input = await ctx.validate(removeSchema);
    await assertPassword(user, input.password);

    const passkey = await store.table('webauthn_passkeys').findOne({
      id: ctx.params.id,
      user_id: user.id,
    });
    if (!passkey) throw new NotFoundError('No passkey was found with that id');

    await store.table('webauthn_passkeys').deleteById(passkey.id);
    await audit(deps, {
      eventType: 'passkey_removed',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { credentialId: passkey.credential_id },
    });
    ctx.json({ removed: true });
  };

  /** Begin sign-in: returns `navigator.credentials.get()` options for the account's passkeys. */
  const handleLoginOptions = async (ctx) => {
    const input = await ctx.validate(loginOptionsSchema);
    const rp = relyingParty(config);

    // No email: a discoverable ("usernameless") ceremony. There is no account to probe, so this
    // path cannot enumerate anything, and the challenge is stored with a null user_id — the
    // anonymous bucket the schema provides. Abuse is bounded by the per-IP auth rate limit.
    if (!input.email) {
      const challenge = newChallenge();
      const anonymous = await issueChallenge(null, 'authentication', challenge);
      ctx.json({
        challengeId: anonymous.id,
        options: buildAuthenticationOptions({ rpId: rp.rpId, challenge, allowCredentials: [] }),
      });
      return;
    }

    const user = await store.table('users').findOneCi('email', input.email);

    // One identical answer for "no such account", "account not active" and "no passkey enrolled":
    // the caller learns nothing about which accounts exist or which of them use passkeys.
    if (!user || user.status !== 'active') {
      await audit(deps, {
        eventType: 'login_failure',
        userId: user?.id ?? null,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: 'passkey_unavailable' },
      });
      throw new UnauthorizedError('No passkey is available for this account');
    }

    const { rows: credentials } = await store.table('webauthn_passkeys').find({ user_id: user.id });
    if (credentials.length === 0) {
      await audit(deps, {
        eventType: 'login_failure',
        userId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: 'passkey_unavailable' },
      });
      throw new UnauthorizedError('No passkey is available for this account');
    }

    const challenge = newChallenge();
    const record = await issueChallenge(user.id, 'authentication', challenge);

    ctx.json({
      challengeId: record.id,
      options: buildAuthenticationOptions({ rpId: rp.rpId, challenge, allowCredentials: credentials }),
    });
  };

  /** Finish sign-in: verifies the assertion and issues the same session as password login. */
  const handleLoginVerify = async (ctx) => {
    const input = await ctx.validate(loginVerifySchema);
    const challenge = await consumeChallenge(input.challengeId, 'authentication');
    if (!challenge) throw new UnauthorizedError('This sign-in ceremony has expired or was already used');

    // `response.id` is the credential the authenticator used. Refuse early on a missing id rather
    // than letting an undefined lookup fall through as "no filter" and matching an arbitrary row.
    if (!input.response?.id) throw new UnauthorizedError('Invalid or expired passkey assertion');

    // Two ceremony shapes reach here: email-first, where the challenge names the account, and
    // discoverable, where it does not and the credential identifies the account.
    const credential = challenge.user_id
      ? (await store.table('webauthn_passkeys').find({
        user_id: challenge.user_id, credential_id: input.response.id,
      })).rows[0]
      : await store.table('webauthn_passkeys').findOne({ credential_id: input.response.id });
    if (!credential) throw new UnauthorizedError('Invalid or expired passkey assertion');

    const user = await store.table('users').findById(credential.user_id);
    if (!user) throw new UnauthorizedError('Invalid or expired passkey assertion');

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

    // The handle we gave the authenticator at registration must still name this account. A
    // mismatch means the client mixed up credentials, which we refuse rather than paper over.
    const userHandle = input.response.response?.userHandle;
    if (userHandle
      && Buffer.from(String(userHandle), 'base64url').toString('utf8') !== String(user.id)) {
      throw new UnauthorizedError('Invalid or expired passkey assertion');
    }

    const rp = relyingParty(config);
    const verdict = verifyAssertion({
      response: input.response,
      expectedChallenge: challenge.challenge,
      rpId: rp.rpId,
      origins: rp.origins,
      storedCredential: credential,
      requireUserVerification: true,
    });
    if (!verdict.verified) {
      await audit(deps, {
        eventType: 'login_failure',
        userId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: 'passkey_assertion_failed', detail: verdict.reason },
      });
      throw new UnauthorizedError('Passkey verification failed');
    }

    await store.table('webauthn_passkeys').updateById(credential.id, {
      counter: verdict.newCounter,
      last_used_at: new Date().toISOString(),
    });

    authLimiter.reset(`auth:${ctx.ip}`);

    const { accessToken, refreshToken } = signSession(deps, user);
    await storeRefreshToken(deps, user, refreshToken, config.REFRESH_TOKEN_EXPIRES_MS);

    await audit(deps, {
      eventType: 'login_success',
      userId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { passkey: true, credentialId: credential.credential_id },
    });

    ctx.json({
      user: publicUser(user),
      accessToken,
      refreshToken,
      expiresIn: Math.floor(config.JWT_EXPIRES_MS / 1000),
      passkey: true,
    });
  };

  // ------------------------------------------------------------------ routing

  const routes = [
    ['get', '/api/v1/auth/passkeys', handleList],
    ['post', '/api/v1/auth/passkeys/register/options', loginLimit, handleRegisterOptions],
    ['post', '/api/v1/auth/passkeys/register/verify', handleRegisterVerify],
    ['patch', '/api/v1/auth/passkeys/:id', handleRename],
    ['delete', '/api/v1/auth/passkeys/:id', handleRemove],
    ['post', '/api/v1/auth/passkeys/login/options', loginLimit, handleLoginOptions],
    ['post', '/api/v1/auth/passkeys/login/verify', loginLimit, handleLoginVerify],
  ];

  for (const [method, pattern, ...handlers] of routes) {
    router[method](pattern, ...handlers);
    // Same legacy alias rule as auth.js: the Fastify platform mounts auth at /api/auth/*.
    router[method](pattern.replace('/api/v1/auth', '/api/auth'), ...handlers);
  }
}

module.exports = { name, register };
