import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { buildDisplayCurrencyStatus, loadLatestDisplaySnapshot } from '../services/fx-service';

/**
 * Public display-currency status: which currencies may be shown next to USD prices, the rate
 * timestamp, and why none are offered when that is the case. Read-only and unauthenticated, because
 * it contains only public exchange-rate data. Billing is never affected by anything served here.
 */
export async function registerCurrencyRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);
  const maxAgeMs = env.FX_MAX_AGE_HOURS * 60 * 60 * 1000;

  app.get('/api/v1/currency/rates', async (_request, reply) => {
    const snapshot = await loadLatestDisplaySnapshot(pool);
    reply.header('Cache-Control', 'public, max-age=300');
    return buildDisplayCurrencyStatus(snapshot, new Date(), maxAgeMs);
  });
}
