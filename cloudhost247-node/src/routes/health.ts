import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';
import { isDatabaseReachable } from '../db/pool';

/**
 * /health — liveness. Confirms the Node process is up and answering HTTP requests. Must stay
 * dependency-free (no DB calls) so cPanel/uptime monitors get a fast, reliable signal even if
 * the database is temporarily unreachable.
 *
 * /ready — readiness. Confirms dependencies required to actually serve traffic (currently:
 * PostgreSQL) are reachable. Never returns credentials, connection strings, or stack traces.
 */
export async function registerHealthRoutes(app: FastifyInstance, env: Env) {
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/ready', async (_request, reply) => {
    const dbOk = await isDatabaseReachable(env);
    if (!dbOk) {
      reply.code(503);
      return { status: 'error', checks: { database: 'error' } };
    }
    return { status: 'ok', checks: { database: 'ok' } };
  });
}
