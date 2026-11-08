import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { findUserByEmail, findUserById, findUserByLoginIdentifier, recordAuthEvent } from '../db/users';
import { confirmEmailVerification, completePasswordReset, issueAuthAction } from '../services/auth-recovery-service';
import {
  beginTotpEnrollment,
  completeMfaLogin,
  confirmTotpEnrollment,
  disableTotpMfa,
  getMfaStatus,
  issueMfaLoginChallenge,
} from '../services/totp-mfa-service';
import { createUserWithIdentity } from '../services/customer-identity-service';
import {
  deriveUsernameCandidate,
  isUsernameTaken,
  suggestUsernames,
  validateUsernameFormat,
} from '../services/username-service';
import {
  expiryFromNow as pinExpiryFromNow,
  generatePinSalt,
  generateSecurityPin,
  getSecurityPinPolicy,
  hashSecurityPin,
  sealSecurityPin,
} from '../services/security-pin-service';
import { pinKeyOrNull } from '../lib/pin-key';
import { beginPasskeyRegistration, finishPasskeyRegistration, listPasskeys, removePasskey, renamePasskey } from '../services/passkey-service';
import { beginPasskeyAuthentication, finishPasskeyAuthentication } from '../services/passkey-authentication-service';
import {
  expiryFromNow,
  generateSecurityNumber,
  getSecurityNumberPolicy,
  hashSecurityNumber,
} from '../services/security-number-service';
import { recordAuditBestEffort, requestAuditContext } from '../lib/audit';
import { revokeToken } from '../db/revoked-tokens';
import { hashPassword, verifyPassword } from '../lib/password';
import { signAuthToken } from '../lib/jwt';
import { authenticate } from '../lib/require-auth';
import { guardSupportMode } from '../lib/support-mode';
import { MissingEncryptionKeyError } from '../lib/crypto';
import { ConflictError, ServiceUnavailableError, UnauthorizedError, ValidationError } from '../lib/errors';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  fullName: z.string().min(1).max(255),
  /**
   * The customer's chosen handle. The web registration form requires it; the API accepts its
   * absence so that an existing API client (or an administrator-driven import) keeps working — in
   * that case a unique name is derived from the email local-part and de-duplicated. Either way every
   * account leaves registration with exactly one unique username.
   *
   * Format/reservation rules live in src/services/username-service.ts rather than in this schema so
   * registration, account settings and admin creation cannot drift apart.
   */
  username: z.string().min(3).max(32).optional(),
});

/**
 * Login accepts an email address *or* a username in the same field (plus the legacy `email` key so
 * older clients keep working). Whichever is supplied is resolved to exactly one account; the
 * failure message is identical either way, so the form is not an enumeration oracle.
 */
const loginSchema = z
  .object({
    email: z.string().min(3).max(320).optional(),
    username: z.string().min(3).max(32).optional(),
    identifier: z.string().min(3).max(320).optional(),
    password: z.string().min(1),
  })
  .refine((value) => Boolean(value.identifier ?? value.username ?? value.email), {
    message: 'Enter your email address or username',
  });

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

const actionTokenSchema = z.object({
  // HMAC-SHA256 base64url output is 43 characters. Keeping a bounded format prevents oversized
  // garbage from reaching the hashing/query path while not leaking anything about validity.
  token: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Invalid action token'),
});

const passwordResetConfirmSchema = actionTokenSchema.extend({
  password: z.string().min(10, 'Password must be at least 10 characters'),
});

const mfaCodeSchema = z.object({
  // Accept six-digit TOTP values or a formatted 80-bit recovery code. The service normalizes
  // whitespace/hyphens and determines which kind it is without telling an attacker.
  code: z.string().min(6).max(64),
});

const mfaLoginVerifySchema = mfaCodeSchema.extend({
  mfaToken: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Invalid MFA challenge'),
});

const mfaEnrollSchema = z.object({ password: z.string().min(1) });
const mfaDisableSchema = mfaCodeSchema.extend({ password: z.string().min(1) });
const passkeyStartSchema = z.object({ password: z.string().min(1) });
const passkeyFinishSchema = z.object({
  challengeId: z.string().uuid(), name: z.string().trim().min(1).max(80), response: z.record(z.string(), z.unknown()),
});
const passkeyRenameSchema = z.object({ name: z.string().trim().min(1).max(80) });
const passkeyRemoveSchema = z.object({ password: z.string().min(1) });
const passkeyLoginOptionsSchema = z.object({ email: z.string().email() });
const passkeyLoginVerifySchema = z.object({ challengeId: z.string().uuid(), response: z.record(z.string(), z.unknown()) });

function publicUser(user: {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  username?: string | null;
  customer_id?: string | null;
  email_verified_at?: string | null;
}) {
  // Deliberately identical in shape to src/dto/account.ts#toPublicUser: identity only. Neither the
  // Security PIN (hash, salt, plaintext, expiry, version) nor the Security Number is ever part of
  // this payload — not on register, not on login, and not on /api/auth/me. Each has its own
  // endpoint, and the PIN additionally requires a fresh email verification to be read.
  return {
    id: user.id,
    username: user.username ?? null,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    status: user.status,
    customerId: user.customer_id ?? null,
    emailVerified: Boolean(user.email_verified_at),
  };
}

/**
 * Authentication foundation: registration, login, email verification and password recovery.
 * Every recovery action is a durable, single-use, expiring token; passkeys/MFA and SSO remain
 * separate identity modules because they need a dedicated step-up/WebAuthn design.
 */
export async function registerAuthRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  // `overridePool` lets tests substitute a real embedded Postgres engine (pglite) instead of a
  // live TCP connection — see tests/integration/auth-flow.test.ts. Production always uses the
  // real singleton pg Pool.
  const pool = overridePool ?? getPool(env);

  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const { email, password, fullName, username: rawUsername } = parsed.data;

      const existing = await findUserByEmail(pool, email);
      if (existing) {
        throw new ConflictError('An account with this email already exists');
      }

      // Reserve/uniqueness rules are applied before any write, so a customer never receives a
      // confusing "duplicate key" for a name they can simply change.
      const usernameCheck = validateUsernameFormat(rawUsername ?? deriveUsernameCandidate(email));
      if (!usernameCheck.ok) throw new ValidationError(usernameCheck.error ?? 'That username is not available');
      let username = usernameCheck.value;
      if (await isUsernameTaken(pool, username)) {
        if (rawUsername) {
          const suggestions = await suggestUsernames(pool, username);
          throw new ConflictError(
            suggestions.length > 0
              ? `That username is already taken. Try ${suggestions.map((s) => `"${s}"`).join(', ')}.`
              : 'That username is already taken.'
          );
        }
        // Derived name collided (two customers share an email local-part): append a suffix rather
        // than failing a registration the customer cannot reasonably resolve.
        let resolved = false;
        for (let suffix = 1; suffix <= 50 && !resolved; suffix += 1) {
          const candidate = `${username.slice(0, 28)}${suffix}`;
          if (!(await isUsernameTaken(pool, candidate))) {
            username = candidate;
            resolved = true;
          }
        }
        if (!resolved) throw new ConflictError('Could not derive a unique username. Please choose one.');
      }
      // A missing PIN key must not stop customers from signing up. The account is created now and
      // its PIN is issued lazily the first time the security card is opened (see
      // `/api/v1/account/security`, which calls `ensureCurrentPin`). Registration is the one path
      // that is dangerous to fail: refusing it takes the whole platform down over one missing
      // environment variable, whereas a deferred PIN degrades exactly one feature and self-heals
      // as soon as the key is configured.
      const pinKey = pinKeyOrNull();

      const passwordHash = await hashPassword(password);

      // Identity is issued at creation time, atomically with the account itself:
      //   - a unique username (database index on lower(username) is the authority),
      //   - a permanent nine-digit Customer ID (unique by constraint, retried on collision),
      //   - the first four-digit Security Number (bcrypt hash, 24-hour window), and
      //   - the first four-digit Security PIN (keyed HMAC + per-value salt, 24-hour window).
      //
      // The PIN plaintext is deliberately NOT returned to the registrant: reading the PIN always
      // requires a fresh six-digit email verification (see src/routes/account-security.ts), so a
      // stolen registration response or a shoulder-surfed signup cannot leak it.
      const policy = await getSecurityNumberPolicy(pool);
      const pinPolicy = await getSecurityPinPolicy(pool);
      const securityNumber = generateSecurityNumber();
      // When the key is absent these stay null, which `ensureCurrentPin` treats the same as an
      // expired PIN: it issues one the next time the customer opens their security settings.
      const pinSalt = pinKey ? generatePinSalt() : null;
      const securityPin = pinKey ? generateSecurityPin() : null;
      const { user } = await createUserWithIdentity(pool, {
        email,
        passwordHash,
        fullName,
        username,
        securityNumberHash: await hashSecurityNumber(securityNumber),
        securityNumberExpiresAt: expiryFromNow(policy.rotationHours),
        securityPinHash: pinKey && securityPin && pinSalt ? hashSecurityPin(securityPin, pinSalt, pinKey) : null,
        securityPinSalt: pinSalt,
        securityPinEncrypted: pinKey && securityPin ? sealSecurityPin(securityPin, pinKey) : null,
        securityPinExpiresAt: pinKey ? pinExpiryFromNow(pinPolicy.rotationHours) : null,
      });

      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: user.id,
        eventType: 'register',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      // The raw verification link is never stored in Postgres. This atomically writes only a
      // token hash plus a dedicated mail-outbox item; the worker derives the link at send time.
      const verification = await issueAuthAction(pool, env, user, 'email_verification', {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      // Audit records the *fact* of issuance and the Customer ID — never the Security Number.
      await recordAuditBestEffort(
        pool,
        {
          actorId: user.id,
          action: 'customer_identity_created',
          resourceType: 'user',
          resourceId: user.id,
          metadata: { customerId: user.customer_id, securityNumberVersion: user.security_number_version },
        },
        requestAuditContext(request)
      );

      const token = signAuthToken(env, { sub: user.id, role: user.role, email: user.email, sv: user.auth_session_version });
      reply.code(201);
      // The plaintext Security Number is returned exactly once, here, to the person who just
      // created the account — it is never stored in plaintext and cannot be recovered later
      // (only re-issued). It is intentionally NOT inside `user`, so no generic user payload,
      // cache, or client-side user store ever carries it.
      return {
        user: publicUser(user),
        token,
        securityNumber: { value: securityNumber, expiresAt: user.security_number_expires_at },
        // Shape only — no digits of the PIN. The account's first PIN is already in place (written
        // in the same INSERT as the account), and it can only be read after a fresh six-digit
        // email verification, so this response says when the first rotation is due and nothing else.
        securityPin: { set: Boolean(user.security_pin_hash), nextRotationAt: user.security_pin_expires_at },
        emailVerification: { queued: verification.issued },
      };
    }
  );

  app.post('/api/auth/passkeys/login/options', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request) => {
    const parsed=passkeyLoginOptionsSchema.safeParse(request.body); if(!parsed.success) throw new ValidationError(parsed.error.issues.map(i=>i.message).join(', '));
    const user=await findUserByEmail(pool,parsed.data.email); if(!user||user.status!=='active') throw new UnauthorizedError('No passkey is available for this account');
    const result=await beginPasskeyAuthentication(pool,env,{id:user.id,authSessionVersion:user.auth_session_version}); if(!result) throw new UnauthorizedError('No passkey is available for this account');
    return result;
  });
  app.post('/api/auth/passkeys/login/verify', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request,reply) => {
    const parsed=passkeyLoginVerifySchema.safeParse(request.body); if(!parsed.success) throw new ValidationError(parsed.error.issues.map(i=>i.message).join(', '));
    const assertion=await finishPasskeyAuthentication(pool,env,parsed.data.challengeId,parsed.data.response as never); if(!assertion) throw new UnauthorizedError('Invalid or expired passkey assertion');
    const user=await findUserById(pool,assertion.userId); if(!user||user.status!=='active') throw new UnauthorizedError('This account is not active');
    const mfa=await getMfaStatus(pool,user.id); if(mfa.enabled){const mfaToken=await issueMfaLoginChallenge(pool,env.JWT_SECRET,user.id,user.auth_session_version);reply.code(202);return {mfaRequired:true,mfaToken};}
    await recordAuthEvent(pool,{id:randomUUID(),userId:user.id,eventType:'login_success',ipAddress:request.ip,userAgent:request.headers['user-agent']??null,metadata:{passkey:true}});
    return {user:publicUser(user),token:signAuthToken(env,{sub:user.id,role:user.role,email:user.email,sv:assertion.sessionVersion})};
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    // One field accepts either an email address or a username; `identifier` is the preferred key
    // for new clients, `email`/`username` keep older clients (and the login form's field name)
    // working unchanged.
    const identifier = (parsed.data.identifier ?? parsed.data.username ?? parsed.data.email ?? '').trim();
    const { password } = parsed.data;

    const user = await findUserByLoginIdentifier(pool, identifier);
    const passwordOk = user ? await verifyPassword(password, user.password_hash) : false;

    if (!user || !passwordOk) {
      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: user?.id ?? null,
        eventType: 'login_failure',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        // Only the fact that an identifier was attempted, plus the identifier itself when it
        // looks like an email (matching the pre-existing behaviour support tooling relies on).
        // A username is recorded too, since it is not secret by design.
        metadata: { identifier },
      });
      // Identical message whether the identifier is unknown or the password is wrong — the login
      // form must not become an account-enumeration oracle.
      throw new UnauthorizedError('Invalid email/username or password');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedError('This account is not active');
    }

    const mfa = await getMfaStatus(pool, user.id);
    if (mfa.enabled) {
      const mfaToken = await issueMfaLoginChallenge(pool, env.JWT_SECRET, user.id, user.auth_session_version);
      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: user.id,
        eventType: 'mfa_login_challenge',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
      reply.code(202);
      // This is only a short-lived, single-use continuation credential. It is deliberately not a
      // JWT and the browser must keep it in component memory, never localStorage/cookies.
      return { mfaRequired: true, mfaToken };
    }

    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: user.id,
      eventType: 'login_success',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    const token = signAuthToken(env, { sub: user.id, role: user.role, email: user.email, sv: user.auth_session_version });
    reply.code(200);
    return { user: publicUser(user), token };
  });

  /** Complete the second factor of a password-authenticated login. */
  app.post(
    '/api/auth/mfa/login/verify',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = mfaLoginVerifySchema.safeParse(request.body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));

      let result;
      try {
        result = await completeMfaLogin(pool, env, parsed.data.mfaToken, parsed.data.code);
      } catch (error) {
        if (error instanceof MissingEncryptionKeyError) {
          throw new ServiceUnavailableError('Multi-factor authentication is temporarily unavailable. Contact support.');
        }
        throw error;
      }
      if (!result.success || !result.userId || result.sessionVersion === null) {
        if (result.userId) {
          await recordAuthEvent(pool, {
            id: randomUUID(),
            userId: result.userId,
            eventType: 'mfa_login_failure',
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'] ?? null,
          });
        }
        throw new UnauthorizedError('Invalid or expired multi-factor authentication code');
      }

      const user = await findUserById(pool, result.userId);
      if (!user || user.status !== 'active') throw new UnauthorizedError('This account is not active');
      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: user.id,
        eventType: 'login_success',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        metadata: { mfa: result.method },
      });
      if (result.method === 'recovery_code') {
        await recordAuthEvent(pool, {
          id: randomUUID(),
          userId: user.id,
          eventType: 'mfa_recovery_code_used',
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
      }
      return {
        user: publicUser(user),
        token: signAuthToken(env, { sub: user.id, role: user.role, email: user.email, sv: result.sessionVersion }),
      };
    }
  );

  /** Begins TOTP enrollment after a password step-up; no plaintext secret is stored server-side. */
  app.post('/api/auth/mfa/totp/enroll', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'mfa.enroll');
    const parsed = mfaEnrollSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    const user = await findUserById(pool, auth.userId);
    if (!user) throw new UnauthorizedError('Account no longer exists');
    if (!(await verifyPassword(parsed.data.password, user.password_hash))) {
      throw new ValidationError('Current password is incorrect');
    }

    let enrollment;
    try {
      enrollment = await beginTotpEnrollment(pool, env, user);
    } catch (error) {
      if (error instanceof MissingEncryptionKeyError) {
        throw new ServiceUnavailableError('Multi-factor enrollment requires credential encryption to be configured.');
      }
      throw error;
    }
    if (enrollment.alreadyEnabled) throw new ConflictError('Multi-factor authentication is already enabled. Disable it before enrolling a new authenticator.');
    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: user.id,
      eventType: 'mfa_enrollment_started',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return { secret: enrollment.secret, otpauthUrl: enrollment.otpauthUrl };
  });

  /** Confirms a pending TOTP authenticator and returns one-time recovery codes once. */
  app.post('/api/auth/mfa/totp/confirm', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'mfa.enroll');
    const parsed = mfaCodeSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    let confirmed;
    try {
      confirmed = await confirmTotpEnrollment(pool, env, auth.userId, parsed.data.code);
    } catch (error) {
      if (error instanceof MissingEncryptionKeyError) {
        throw new ServiceUnavailableError('Multi-factor authentication is temporarily unavailable.');
      }
      throw error;
    }
    if (!confirmed.confirmed) throw new ValidationError('Invalid authenticator code or no enrollment is pending.');
    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: auth.userId,
      eventType: 'mfa_enabled',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return { recoveryCodes: confirmed.recoveryCodes };
  });

  app.get('/api/auth/mfa/status', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { mfa: await getMfaStatus(pool, auth.userId) };
  });

  app.get('/api/auth/passkeys', async (request) => {
    const auth = await authenticate(request, env, pool);
    return { passkeys: await listPasskeys(pool, auth.userId) };
  });

  app.post('/api/auth/passkeys/register/options', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'passkey.enroll');
    const parsed = passkeyStartSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    const user = await findUserById(pool, auth.userId);
    if (!user) throw new UnauthorizedError('Account no longer exists');
    if (!(await verifyPassword(parsed.data.password, user.password_hash))) throw new ValidationError('Current password is incorrect');
    const registration = await beginPasskeyRegistration(pool, env, { id:user.id,email:user.email,fullName:user.full_name,authSessionVersion:user.auth_session_version });
    await recordAuthEvent(pool, { id: randomUUID(), userId:user.id, eventType:'passkey_enrollment_started', ipAddress:request.ip, userAgent:request.headers['user-agent'] ?? null });
    return registration;
  });

  app.post('/api/auth/passkeys/register/verify', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'passkey.enroll');
    const parsed = passkeyFinishSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    const passkey = await finishPasskeyRegistration(pool, env, { userId:auth.userId, sessionVersion:auth.sv ?? 0, challengeId:parsed.data.challengeId, response:parsed.data.response as never, name:parsed.data.name });
    if (!passkey) throw new ValidationError('Passkey registration could not be verified. Start setup again.');
    await recordAuthEvent(pool, { id:randomUUID(),userId:auth.userId,eventType:'passkey_added',ipAddress:request.ip,userAgent:request.headers['user-agent'] ?? null,metadata:{ passkeyId:passkey.id } });
    return { passkey };
  });

  app.patch('/api/auth/passkeys/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'passkey.manage');
    const parsed = passkeyRenameSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    const passkey = await renamePasskey(pool, auth.userId, String((request.params as { id?: string }).id ?? ''), parsed.data.name);
    if (!passkey) throw new ValidationError('Passkey not found');
    await recordAuthEvent(pool,{id:randomUUID(),userId:auth.userId,eventType:'passkey_renamed',ipAddress:request.ip,userAgent:request.headers['user-agent'] ?? null,metadata:{passkeyId:passkey.id}});
    return { passkey };
  });

  app.delete('/api/auth/passkeys/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'passkey.manage');
    const parsed = passkeyRemoveSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    const user = await findUserById(pool, auth.userId);
    if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) throw new ValidationError('Current password is incorrect');
    const removed = await removePasskey(pool, auth.userId, String((request.params as { id?: string }).id ?? ''));
    if (!removed) throw new ValidationError('Passkey not found');
    await recordAuthEvent(pool,{id:randomUUID(),userId:auth.userId,eventType:'passkey_removed',ipAddress:request.ip,userAgent:request.headers['user-agent'] ?? null});
    return { message:'Passkey removed.' };
  });

  app.post('/api/auth/mfa/disable', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'mfa.disable');
    const parsed = mfaDisableSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    const user = await findUserById(pool, auth.userId);
    if (!user) throw new UnauthorizedError('Account no longer exists');
    if (!(await verifyPassword(parsed.data.password, user.password_hash))) {
      throw new ValidationError('Current password is incorrect');
    }
    let method;
    try {
      method = await disableTotpMfa(pool, env, user.id, parsed.data.code);
    } catch (error) {
      if (error instanceof MissingEncryptionKeyError) {
        throw new ServiceUnavailableError('Multi-factor authentication is temporarily unavailable.');
      }
      throw error;
    }
    if (!method) throw new ValidationError('Invalid authenticator or recovery code.');
    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: user.id,
      eventType: 'mfa_disabled',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { method },
    });
    return { message: 'Multi-factor authentication has been disabled.' };
  });

  /**
   * Anonymous by design and deliberately non-enumerating: matching, non-active, and unknown
   * addresses all receive the same 202 response. Per-IP Fastify rate limits plus the durable
   * per-account issue limit in issueAuthAction protect both the endpoint and a known inbox.
   */
  app.post(
    '/api/auth/password-reset/request',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = passwordResetRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const user = await findUserByEmail(pool, parsed.data.email);
      if (user?.status === 'active') {
        await issueAuthAction(pool, env, user, 'password_reset', {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
      }
      reply.code(202);
      return { message: 'If an active account matches that email address, a password reset link will be sent shortly.' };
    }
  );

  app.post(
    '/api/auth/password-reset/confirm',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request) => {
      const parsed = passwordResetConfirmSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const updated = await completePasswordReset(pool, parsed.data.token, await hashPassword(parsed.data.password), {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
      if (!updated) {
        throw new ValidationError('This password reset link is invalid or has expired. Request a new link to continue.');
      }
      return { message: 'Your password has been reset. You can now log in with your new password.' };
    }
  );

  app.post(
    '/api/auth/email-verification/confirm',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request) => {
      const parsed = actionTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
      }
      const verified = await confirmEmailVerification(pool, parsed.data.token, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
      if (!verified) {
        throw new ValidationError('This verification link is invalid or has expired. Request a new link to continue.');
      }
      return { message: 'Your email address has been verified.' };
    }
  );

  app.post(
    '/api/auth/email-verification/resend',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const user = await findUserById(pool, auth.userId);
      if (!user) throw new UnauthorizedError('Account no longer exists');
      if (user.email_verified_at) {
        return { message: 'This email address is already verified.', alreadyVerified: true, queued: false };
      }
      const result = await issueAuthAction(pool, env, user, 'email_verification', {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
      // 202 is intentional for both a fresh queue and the per-account throttling case. The
      // browser gets no token and an attacker who stole a session cannot turn this into a mail
      // flood; the account page can simply tell the customer to wait before trying again.
      reply.code(202);
      return {
        message: result.issued
          ? 'A new verification link has been queued for delivery.'
          : 'A verification link was requested recently. Please wait before requesting another.',
        alreadyVerified: false,
        queued: result.issued,
      };
    }
  );

  app.get('/api/auth/me', async (request) => {
    const auth = await authenticate(request, env, pool);

    const user = await findUserById(pool, auth.userId);
    if (!user) {
      throw new UnauthorizedError('Account no longer exists');
    }
    // When the caller is an administrator acting inside this account, say so explicitly: the UI
    // is required to show a persistent, unmistakable banner for the whole session (spec §37).
    const supportSession = auth.supportSessionId
      ? { id: auth.supportSessionId, originalAdminId: auth.actingAdminId, expiresAt: new Date(auth.exp * 1000).toISOString() }
      : null;
    const mfa = await getMfaStatus(pool, user.id);
    return { user: { ...publicUser(user), mfaEnabled: mfa.enabled }, supportSession };
  });

  /**
   * Actually invalidates the token that was used to call this endpoint (not just "the client
   * forgets it locally"): the token's jti is recorded in revoked_tokens, so any subsequent
   * request — from this browser tab, another tab, or anywhere else the token might have been
   * copied — is rejected by authenticate() even though the JWT signature/expiry are still valid.
   * See database/migrations/0003_create_revoked_tokens.sql for the full rationale.
   */
  app.post(
    '/api/auth/logout',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);

      await revokeToken(pool, {
        jti: auth.jti,
        userId: auth.userId,
        expiresAt: new Date(auth.exp * 1000),
      });

      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: auth.userId,
        eventType: 'logout',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      reply.code(204).send();
    }
  );
}
