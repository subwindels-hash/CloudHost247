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
   * suggest a suitable display currency. The result is advisory only - the customer can always
   * override via the switcher.
   *
   * Trusted proxies are those configured in the reverse proxy (e.g. Cloudflare, NGINX) in front
   * of this application. The app should NOT trust X-Forwarded-For or similar headers from untrusted
   * sources. When no trusted proxy is configured, the visitor's direct IP is used.
   *
   * NOTE: This is a stub endpoint. In production, when a trusted reverse proxy is configured
   * (e.g. Cloudflare, NGINX), the proxy should set the real client IP and the app should validate
   * it against the trusted proxy list. Until then, this returns null to indicate geolocation is
   * not configured, and the frontend falls back to the default currency.
   */
  app.get('/api/v1/currency/geo-country', async (_request, reply) => {
    // When running behind a trusted reverse proxy, the proxy should set the real IP via
    // X-Forwarded-For or similar headers. We trust these only when the proxy is trusted.
    // For now, we use the direct connection IP and return null to indicate geolocation is
    // not configured.
    // TODO: When a trusted proxy is configured, parse X-Forwarded-For and validate the first
    // IP against the trusted proxy list.
    const visitorIp = _request.ip ?? 'unknown';
    reply.header('Cache-Control', 'public, max-age=60');
    return { country: null, ip: visitorIp, note: 'IP geolocation is advisory; configure a trusted proxy or geolocation service for currency detection.' };
  });
}
