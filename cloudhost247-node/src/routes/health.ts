import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';
import { isDatabaseReachable, isSchemaPresent } from '../db/pool';
import type { Queryable } from '../db/types';
import { listIncidents } from '../db/incidents';

/**
 * /health — liveness. Confirms the Node process is up and answering HTTP requests. Must stay
 * dependency-free (no DB calls) so uptime monitors and the systemd/Nginx healthcheck get a fast,
 * reliable signal even if the database is temporarily unreachable.
 *
 * /ready — readiness. Confirms the dependencies required to actually serve traffic are usable:
 * PostgreSQL accepts connections AND the migration ledger is present. Reachability alone is not
 * enough — an empty schema accepts connections and answers `SELECT 1` perfectly, while every real
 * query fails. Never returns credentials, connection strings, or stack traces.
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
export async function registerHealthRoutes(app: FastifyInstance, env: Env, pool?: Queryable) {
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/ready', async (_request, reply) => {
    const dbOk = await isDatabaseReachable(env, 3000, pool);
    if (!dbOk) {
      reply.code(503);
      return { status: 'error', checks: { database: 'error' } };
    }
    // A reachable database with no migration ledger means migrations never ran (or refused —
    // see the quarantine gate). Say so, instead of reporting ready over an empty schema.
    const schemaOk = await isSchemaPresent(env, 3000, pool);
    if (!schemaOk) {
      reply.code(503);
      return { status: 'error', checks: { database: 'ok', schema: 'missing' } };
    }
    return { status: 'ok', checks: { database: 'ok', schema: 'ok' } };
  });

  app.get('/api/v1/public/status', async () => {
    const started = Date.now();
    let website = 'operational';
    try {
      const dbOk = await isDatabaseReachable(env, 3000, pool);
      if (!dbOk) website = 'degraded';
    } catch {
      website = 'degraded';
    }
    // Active incidents declared by an operator. The list is honest: empty when none are declared,
    // and never auto-detected — `monitored: false` stays permanent.
    let incidents: { incident_number: string; title: string; status: string; severity: string; started_at: Date }[] = [];
    if (pool) {
      try {
        const all = await listIncidents(pool);
        incidents = all
          .filter((i) => i.status !== 'resolved')
          .map((i) => ({
            incident_number: i.incident_number,
            title: i.title,
            status: i.status,
            severity: i.severity,
            started_at: i.started_at,
          }));
      } catch {
        // Incidents are additive to the status page: if the incidents table is missing (e.g. a
        // database that predates this migration), report no incidents rather than failing the
        // whole status endpoint.
        incidents = [];
      }
    }
    return {
      // `monitored: false` is permanent until an independent monitoring system exists. It is the
      // honest answer, and the UI renders it as "not monitored" rather than as "operational".
      monitored: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      incidents,
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
