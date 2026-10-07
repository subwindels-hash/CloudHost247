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
 *
 * /api/v1/public/status — the website's status page. It reports ONLY what this process can verify
 * about itself right now, and marks everything else `unmonitored`.
 *
 *   Why it works that way: an uptime percentage published on a marketing page is either the
 *   output of continuous independent measurement, or it is fiction. This deployment has no
 *   independent monitor, so it publishes no percentage, and it says outright which components it
 *   cannot check — a status page that shows a green tick it never earned is worse than no status
 *   page at all.
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

  app.get('/api/v1/public/status', async () => {
    const started = Date.now();
    let website = 'operational';
    try {
      await isDatabaseReachable(env);
    } catch {
      website = 'degraded';
    }
    return {
      // `monitored: false` is permanent until an independent monitoring system exists. It is the
      // honest answer, and the UI renders it as "not monitored" rather than as "operational".
      monitored: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      components: [
        {
          id: 'api',
          name: 'CloudHost247 API',
          state: 'operational',
          detail: 'This response was produced by the API itself, so the API is answering.',
        },
        {
          id: 'database',
          name: 'Data store',
          state: website === 'operational' ? 'operational' : 'degraded',
          detail: website === 'operational'
            ? 'The application database answered a connection check.'
            : 'The application database did not answer its connection check.',
        },
        {
          id: 'website',
          name: 'Public website',
          state: 'operational',
          detail: 'You are reading this page, which the website served.',
        },
        { id: 'compute', name: 'Compute & servers', state: 'unmonitored', detail: 'Server telemetry lives in your account; this page does not aggregate it.' },
        { id: 'dns', name: 'DNS resolution', state: 'unmonitored', detail: 'Authoritative DNS is operated per zone; the Tools Center can query it on demand.' },
        { id: 'mail', name: 'Mail delivery', state: 'unmonitored', detail: 'Mail queues are per mailbox and are reported in your account.' },
        { id: 'storage', name: 'Backup storage', state: 'unmonitored', detail: 'Backup job results are reported against each service that has a backup job.' },
      ],
    };
  });
}
