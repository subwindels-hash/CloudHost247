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

  /**
   * IP geolocation hint. Returns the ISO 3166-1 alpha-2 country code for the visitor's IP
   * address, respecting trusted proxy headers when configured. This is used by the frontend to
   * suggest a suitable display currency — the third of four signals, after an explicit choice and
   * the authenticated account's preference. The result is advisory only: the customer can always
   * override it, and it never affects billing.
   *
   * Two properties are deliberate and must survive any real geolocation being wired in:
   *
   *   1. The response is per-visitor, so it is marked `private` and never `public`. A public cache
   *      directive on a response that varies by caller is how one visitor's country ends up served
   *      to everyone else for a minute — which would turn an advisory hint into an authoritative
   *      (and wrong) inference. `Vary` names the headers a trusted proxy would vary on.
   *   2. The visitor's address is not echoed back. The caller is not the only reader of this
   *      response — it passes through caches and logs — and nothing consumes the value; the
   *      frontend reads `country` only.
   *
   * NOTE: geolocation is not configured in this deployment, so `country` is always null and the
   * frontend keeps its default currency. When a trusted reverse proxy (Cloudflare, NGINX) is
   * configured, the proxy sets the real client IP and this handler must validate it against the
   * trusted proxy list before resolving a country.
   */
  app.get('/api/v1/currency/geo-country', async (_request, reply) => {
    reply.header('Cache-Control', 'private, max-age=60');
    reply.header('Vary', 'CF-Connecting-IP, X-Forwarded-For');
    return {
      country: null,
      note: 'IP geolocation is advisory; configure a trusted proxy or geolocation service for currency detection.',
    };
  });
}
