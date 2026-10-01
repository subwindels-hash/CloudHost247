import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { findUserByEmail, findUserById, recordAuthEvent } from '../db/users';
import { confirmEmailVerification, completePasswordReset, issueAuthAction } from '../services/auth-recovery-service';
import { createUserWithIdentity } from '../services/customer-identity-service';
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
import { ConflictError, UnauthorizedError, ValidationError } from '../lib/errors';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  fullName: z.string().min(1).max(255),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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

function publicUser(user: {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: string;
  customer_id?: string | null;
  email_verified_at?: string | null;
}) {
  // Deliberately identical in shape to src/dto/account.ts#toPublicUser: identity only. The
  // Security Number (hash, plaintext, expiry, version) is never part of this payload — not on
  // register, not on login, and not on /api/auth/me (spec §11/§46). It has its own endpoint.
  return {
    id: user.id,
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
      const { email, password, fullName } = parsed.data;

      const existing = await findUserByEmail(pool, email);
      if (existing) {
        throw new ConflictError('An account with this email already exists');
      }

      const passwordHash = await hashPassword(password);

      // Identity is issued at creation time, atomically with the account itself: a permanent
      // six-digit Customer ID (unique by database constraint, retried on collision) and the
      // first four-digit Security Number, stored only as a bcrypt hash with a 24-hour window.
      const policy = await getSecurityNumberPolicy(pool);
      const securityNumber = generateSecurityNumber();
      const { user } = await createUserWithIdentity(pool, {
        email,
        passwordHash,
        fullName,
        securityNumberHash: await hashSecurityNumber(securityNumber),
        securityNumberExpiresAt: expiryFromNow(policy.rotationHours),
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
        emailVerification: { queued: verification.issued },
      };
    }
  );

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
    }
    const { email, password } = parsed.data;

    const user = await findUserByEmail(pool, email);
    const passwordOk = user ? await verifyPassword(password, user.password_hash) : false;

    if (!user || !passwordOk) {
      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: user?.id ?? null,
        eventType: 'login_failure',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        metadata: { email },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedError('This account is not active');
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
    return { user: publicUser(user), supportSession };
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
