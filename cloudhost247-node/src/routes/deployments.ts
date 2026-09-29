/**
 * Phase 6 — deployment API (spec §24): list/detail/logs/cancel + real-time event stream (SSE).
 *
 * Visibility rules: a customer sees deployments for their own installations (ownership joined
 * through the installation row); staff see everything. The SSE endpoint polls the append-only
 * deployment_events table server-side and pushes new events + step states to the browser — the
 * customer literally watches "✓ Pulling image … ● Configuring domain" (spec §24) with no
 * websocket infrastructure needed on cPanel (SSE is plain HTTP).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { isTokenRevoked } from '../db/revoked-tokens';
import { findUserById } from '../db/users';
import { UnauthorizedError } from '../lib/errors';
import { verifyAuthToken } from '../lib/jwt';
import { requireRole } from '../lib/require-role';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors';
import {
  cancelDeployment,
  findDeploymentById,
  listDeploymentEvents,
  listDeploymentSteps,
  listDeployments,
} from '../db/deployments';

const idSchema = z.string().uuid('id must be a valid UUID');

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => i.message).join(', '));
  }
  return parsed.data;
}

/** Customer may read a deployment only when it belongs to one of their installations. */
async function canCustomerSeeDeployment(
  pool: Queryable,
  userId: string,
  deploymentId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM deployments d
       LEFT JOIN application_installations i ON i.id = d.installation_id
       WHERE d.id = $1
         AND (d.requested_by = $2 OR i.customer_id = $2 OR d.installation_id IS NULL AND d.requested_by = $2)
     ) AS ok`,
    [deploymentId, userId]
  );
  return rows[0]?.ok === true;
}

export async function registerDeploymentRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/deployments', async (request) => {
    const auth = await authenticate(request, env, pool);
    const query = parseOrThrow(
      z.object({
        installationId: z.string().uuid().optional(),
        status: z.string().max(24).optional(),
        action: z.string().max(24).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
      request.query ?? {}
    );

    const user = (await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [auth.userId])).rows[0];
    const isStaff = user?.role === 'admin' || user?.role === 'super_admin';

    const deployments = isStaff
      ? await listDeployments(pool, {
          installationId: query.installationId,
          status: query.status,
          action: query.action,
          limit: query.limit,
        })
      : await listDeployments(pool, {
          customerId: auth.userId,
          installationId: query.installationId,
          status: query.status,
          action: query.action,
          limit: query.limit,
        });
    return { deployments };
  });

  app.get<{ Params: { id: string } }>('/api/v1/deployments/:id', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const deployment = await findDeploymentById(pool, id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');
    const allowed = await canCustomerSeeDeployment(pool, auth.userId, id);
    if (!allowed) throw new NotFoundError('No deployment was found with that id');
    return {
      deployment,
      steps: await listDeploymentSteps(pool, id),
      events: await listDeploymentEvents(pool, id),
    };
  });

  app.get<{ Params: { id: string } }>('/api/v1/deployments/:id/logs', async (request) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const deployment = await findDeploymentById(pool, id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');
    if (!(await canCustomerSeeDeployment(pool, auth.userId, id))) {
      throw new NotFoundError('No deployment was found with that id');
    }
    const since = parseOrThrow(z.object({ since: z.string().datetime().optional() }), request.query ?? {}).since;
    return {
      events: await listDeploymentEvents(pool, id, since),
      steps: await listDeploymentSteps(pool, id),
    };
  });

  app.post<{ Params: { id: string } }>('/api/v1/deployments/:id/cancel', async (request, reply) => {
    const auth = await authenticate(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const deployment = await findDeploymentById(pool, id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');
    if (!(await canCustomerSeeDeployment(pool, auth.userId, id))) {
      throw new NotFoundError('No deployment was found with that id');
    }
    if (deployment.requested_by && deployment.requested_by !== auth.userId) {
      const user = (await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [auth.userId])).rows[0];
      if (user?.role !== 'admin' && user?.role !== 'super_admin') {
        throw new NotFoundError('No deployment was found with that id');
      }
    }
    const cancelled = await cancelDeployment(pool, id);
    if (!cancelled) {
      throw new ConflictError('Only queued deployments can be cancelled');
    }
    return { deployment: cancelled };
  });

  // --- Real-time stream (spec §24) --------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/v1/deployments/:id/events', async (request, reply) => {
    const auth = await authenticateEventStream(request, env, pool);
    const id = parseOrThrow(idSchema, request.params.id);
    const deployment = await findDeploymentById(pool, id);
    if (!deployment) throw new NotFoundError('No deployment was found with that id');
    if (!(await canCustomerSeeDeployment(pool, auth.userId, id))) {
      throw new NotFoundError('No deployment was found with that id');
    }
    await streamDeploymentEvents(pool, reply, id);
  });
}

/**
 * EventSource (the browser's SSE client) cannot send an Authorization header, so this one
 * read-only endpoint accepts the same bearer token as a ?token= query parameter. Verification
 * is identical to authenticate(): signature, expiry, revocation list, and live user status —
 * the token is only transported differently, never trusted differently. The stream is strictly
 * read-only, so a leaked URL grants deployment *viewing* for at most the token's remaining
 * lifetime and nothing else.
 */
async function authenticateEventStream(request: FastifyRequest, env: Env, pool: Queryable) {
  const query = request.query as { token?: string };
  const token = query.token?.startsWith(' ') ? query.token.slice(1) : query.token;
  if (!token) throw new UnauthorizedError('Missing bearer token');
  let claims;
  try {
    claims = verifyAuthToken(env, token);
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
  if (await isTokenRevoked(pool, claims.jti)) throw new UnauthorizedError('This session has been logged out');
  const user = await findUserById(pool, claims.sub);
  if (!user || user.status !== 'active') throw new UnauthorizedError('Account is not active');
  return { userId: claims.sub, role: user.role };
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'rolled_back']);

/**
 * SSE loop: every second, new events since the cursor are pushed; step snapshots ride along so
 * the UI renders the ✓/●/○ pipeline; the stream closes when the deployment reaches a terminal
 * status (with a final flush) or after 10 minutes of client silence (heartbeat keepalive).
 */
async function streamDeploymentEvents(pool: Queryable, reply: FastifyReply, deploymentId: string): Promise<void> {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let cursor: string | undefined;
  let closed = false;
  reply.raw.on('close', () => {
    closed = true;
  });

  const started = Date.now();
  while (!closed && Date.now() - started < 10 * 60_000) {
    const deployment = await findDeploymentById(pool, deploymentId);
    if (!deployment) break;

    const events = await listDeploymentEvents(pool, deploymentId, cursor);
    if (events.length > 0) {
      cursor = events[events.length - 1]?.created_at;
      send('events', events);
    }
    const steps = await listDeploymentSteps(pool, deploymentId);
    send('state', {
      status: deployment.status,
      steps: steps.map((s) => ({ order: s.step_order, name: s.name, status: s.status, error: s.error })),
    });

    if (TERMINAL_STATUSES.has(deployment.status)) {
      send('done', { status: deployment.status, errorCode: deployment.error_code, errorMessage: deployment.error_message });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  reply.raw.end();
}
