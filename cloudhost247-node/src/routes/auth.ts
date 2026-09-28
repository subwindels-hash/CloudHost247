import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { createUser, findUserByEmail, findUserById, recordAuthEvent } from '../db/users';
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

function publicUser(user: { id: string; email: string; full_name: string; role: string; status: string }) {
  return { id: user.id, email: user.email, fullName: user.full_name, role: user.role, status: user.status };
}

/**
 * Authentication foundation: register, login, and "who am I" (token verification).
 * Deeper flows (password reset, email verification, 2FA, SSO) are explicitly out of scope for
 * Phase 1 and will be added once the independent billing/customer platform needs them.
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
      const user = await createUser(pool, { id: randomUUID(), email, passwordHash, fullName });

      await recordAuthEvent(pool, {
        id: randomUUID(),
        userId: user.id,
        eventType: 'register',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      const token = signAuthToken(env, { sub: user.id, role: user.role, email: user.email });
      reply.code(201);
      return { user: publicUser(user), token };
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

    const token = signAuthToken(env, { sub: user.id, role: user.role, email: user.email });
    reply.code(200);
    return { user: publicUser(user), token };
  });

  app.get('/api/auth/me', async (request) => {
    const auth = await authenticate(request, env, pool);

    const user = await findUserById(pool, auth.userId);
    if (!user) {
      throw new UnauthorizedError('Account no longer exists');
    }
    return { user: publicUser(user) };
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
