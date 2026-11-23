/**
 * Account security routes — the customer's own session inventory and security event history.
 *
 *   GET    /api/v1/account/security/sessions            — sessions recorded for this account
 *   DELETE /api/v1/account/security/sessions/:id        — revoke one session (this device or another)
 *   POST   /api/v1/account/security/sessions/revoke-others — revoke every other session
 *   GET    /api/v1/account/security/events              — recent authentication/security events
 *
 * Invariants that hold on every route in this file:
 *
 *  1. **No `:userId` anywhere.** Every lookup is scoped by the authenticated `auth.userId`, so a
 *     crafted request cannot read or revoke another customer's sessions. A session id that belongs
 *     to someone else is indistinguishable from one that does not exist (both 404).
 *  2. **Revocation is real, not cosmetic.** Revoking writes the token's `jti` to `revoked_tokens`,
 *     which `src/lib/require-auth.ts` checks on every request, so the session stops working
 *     immediately — not at some later sweep. The `revoked_at` stamp only makes the row legible.
 *  3. **Support mode is refused.** An administrator switched into a customer's account can neither
 *     enumerate nor revoke that customer's sessions (`guardSupportMode`); the attempt is audited.
 *  4. **The list is not claimed to be exhaustive.** Only sessions this build recorded (login after
 *     migration 0119) appear. Nothing here says "these are all the sessions that exist".
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import {
  listAuthSessions,
  revokeAuthSession,
  revokeOtherAuthSessions,
  type AuthSessionRow,
} from '../db/auth-sessions';
import { recordAuthEvent } from '../db/users';
import { recordAuditBestEffort, requestAuditContext } from '../lib/audit';
import { NotFoundError, ValidationError } from '../lib/errors';
import { authenticate } from '../lib/require-auth';
import { guardSupportMode } from '../lib/support-mode';

const idParamSchema = z.string().uuid('id must be a valid UUID');

const listQuerySchema = z.object({
  includeRevoked: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/**
 * A session as the customer sees it. `current` is computed by comparing the row's `jti` with the
 * caller's own token, so the UI can label the session you are looking at right now. `jti` itself is
 * never returned: it is a token identifier, and a client has no legitimate use for it.
 */
function toSessionView(row: AuthSessionRow, currentJti: string) {
  return {
    id: row.id,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    current: row.jti === currentJti,
  };
}

export async function registerSecurityRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/account/security/sessions', async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'session.enumerate');
    const query = parseOrThrow(listQuerySchema, request.query);

    const rows = await listAuthSessions(pool, auth.userId, {
      includeRevoked: query.includeRevoked === 'true',
      limit: query.limit,
    });

    // `last_seen_at` is refreshed by authenticate() on the way in, throttled, so this read adds no
    // write of its own.
    return {
      sessions: rows.map((row) => toSessionView(row, auth.jti)),
      // Said out loud rather than left for the customer to assume: tokens issued before this build
      // recorded sessions (or by a path that does not) have no row and cannot appear here.
      recordedOnly: true,
    };
  });

  app.delete('/api/v1/account/security/sessions/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'session.revoke');
    const { id } = parseOrThrow(z.object({ id: idParamSchema }), request.params);

    const result = await revokeAuthSession(pool, {
      userId: auth.userId,
      sessionId: id,
      reason: 'customer_revoked',
    });
    if (!result.revoked) {
      // Same answer for "no such session" and "belongs to another account": a guessed id must not
      // become an existence oracle.
      throw new NotFoundError('Session not found');
    }

    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: auth.userId,
      eventType: 'auth_session_revoked',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { sessionId: id, revokedCurrentSession: result.jti === auth.jti },
    });

    await recordAuditBestEffort(
      pool,
      {
        actorId: auth.userId,
        action: 'auth_session_revoked',
        resourceType: 'auth_session',
        resourceId: id,
        metadata: { customerId: auth.customerId ?? null, revokedCurrentSession: result.jti === auth.jti },
      },
      requestAuditContext(request)
    );

    return { revoked: true, sessionId: id, current: result.jti === auth.jti };
  });

  app.post('/api/v1/account/security/sessions/revoke-others', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'session.revoke');

    const revoked = await revokeOtherAuthSessions(pool, {
      userId: auth.userId,
      keepJti: auth.jti,
      reason: 'customer_revoked_others',
    });

    await recordAuthEvent(pool, {
      id: randomUUID(),
      userId: auth.userId,
      eventType: 'auth_sessions_revoked',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      metadata: { count: revoked, keptCurrentSession: true },
    });

    await recordAuditBestEffort(
      pool,
      {
        actorId: auth.userId,
        action: 'auth_sessions_revoked',
        resourceType: 'user',
        resourceId: auth.userId,
        metadata: { customerId: auth.customerId ?? null, count: revoked, keptCurrentSession: true },
      },
      requestAuditContext(request)
    );

    reply.code(200);
    return { revoked, keptCurrentSession: true };
  });

  app.get('/api/v1/account/security/events', async (request) => {
    const auth = await authenticate(request, env, pool);
    await guardSupportMode(pool, request, auth, 'session.enumerate');
    const query = parseOrThrow(eventsQuerySchema, request.query);
    const limit = query.limit ?? 50;

    const { rows } = await pool.query<{
      id: string;
      event_type: string;
      ip_address: string | null;
      user_agent: string | null;
      metadata: unknown;
      created_at: Date;
    }>(
      `SELECT id, event_type, ip_address, user_agent, metadata, created_at
         FROM auth_audit_log
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [auth.userId, limit]
    );

    return {
      events: rows.map((row) => ({
        id: row.id,
        type: row.event_type,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        metadata: row.metadata,
        createdAt: row.created_at,
      })),
      limit,
    };
  });
}
