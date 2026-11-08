import type { FastifyInstance } from 'fastify';
import geoip from 'geoip-lite';
import { whereAlpha2 } from 'iso-3166-1';
import { resolveVisitorIpFromRequest } from './visitor-ip';
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

  // Resolve only a verified client IP. Never trust arbitrary proxy headers or return the IP.
  // The bundled GeoLite database is local: visitor IPs are not sent to a third party.
  app.get('/api/v1/currency/geo-country', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store, max-age=0');
    reply.header('Vary', 'CF-Connecting-IP, X-Forwarded-For');
    const ip = resolveVisitorIpFromRequest(request, env).ip;
    let country: string | null = null;
    if (ip) {
      try {
        const code = geoip.lookup(ip)?.country?.toUpperCase();
        if (code && whereAlpha2(code)) country = code;
      } catch { /* A missing or unreadable database must not break the site. */ }
    }
    return country ? { country } : { country: null, note: 'IP geolocation is advisory and currently unavailable.' };
  });
}
