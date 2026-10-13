import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env';
import type { Queryable } from '../../src/db/types';
import { registerCurrencyRoutes } from '../../src/routes/currency';

/**
 * `/api/v1/currency/geo-country` is the third of four currency signals — after an explicit choice,
 * the authenticated account's preference, and before the USD default — so it is the one place where
 * a visitor's address could become an authority it must never be. It had no test at all, which is
 * how it came to answer a per-visitor request with `Cache-Control: public, max-age=60` and echo the
 * client's address back in the body.
 *
 * These tests pin the contract for the deployment that exists today (geolocation not configured)
 * and the two properties that must hold after a real resolver is wired in, because both are
 * invisible to a caller and would otherwise only be found by reading the handler:
 *
 *   - the response is never publicly cacheable, and names the headers it varies on;
 *   - the caller's address is never part of the body, so nothing downstream (shared cache, access
 *     log, error reporter) can leak it or attribute it to a different visitor.
 *
 * The routes are registered on a bare instance with a pool that throws on any query, so the hint
 * is held to its own promise that it needs no rate snapshot and no database.
 */
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'e'.repeat(32),
} as NodeJS.ProcessEnv);

const forbiddenPool = new Proxy({} as Queryable, {
  get() {
    throw new Error('the currency hint must not touch the database');
  },
});

function buildInstance() {
  const app = Fastify();
  registerCurrencyRoutes(app, env, forbiddenPool);
  return app;
}

describe('GET /api/v1/currency/geo-country', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('answers a country hint without a public cache directive', async () => {
    const app = buildInstance();
    const res = await app.inject({ method: 'GET', url: '/api/v1/currency/geo-country' });

    expect(res.statusCode).toBe(200);
    const cacheControl = String(res.headers['cache-control']);
    expect(cacheControl).toContain('private');
    expect(cacheControl).not.toContain('public');
    await app.close();
  });

  it('is never cacheable by a shared cache, which could hand one visitor another’s country', async () => {
    const app = buildInstance();
    const res = await app.inject({ method: 'GET', url: '/api/v1/currency/geo-country' });

    // `public` and `s-maxage` are the directives that authorise a shared cache to store a response
    // and replay it to other callers.
    const cacheControl = String(res.headers['cache-control'] ?? '');
    expect(cacheControl).not.toMatch(/s-maxage/i);
    expect(cacheControl).not.toMatch(/\bpublic\b/i);
    await app.close();
  });

  it('varies on the proxy headers a real resolver would depend on', async () => {
    const app = buildInstance();
    const res = await app.inject({ method: 'GET', url: '/api/v1/currency/geo-country' });

    const vary = String(res.headers['vary'] ?? '');
    expect(vary).toContain('CF-Connecting-IP');
    expect(vary).toContain('X-Forwarded-For');
    await app.close();
  });

  it('never echoes the caller address, even when forwarding headers are supplied', async () => {
    const app = buildInstance();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/currency/geo-country',
      // The deployment ships without a trusted proxy, so a spoofed forwarding header must not be
      // treated as a client address — nor reflected back.
      headers: { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9' },
      remoteAddress: '198.51.100.7',
    });

    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('ip');
    expect(JSON.stringify(body)).not.toContain('198.51.100.7');
    expect(JSON.stringify(body)).not.toContain('203.0.113.9');
    await app.close();
  });

  it('states that geolocation is not configured instead of implying a country', async () => {
    const app = buildInstance();
    const res = await app.inject({ method: 'GET', url: '/api/v1/currency/geo-country' });

    const body = res.json() as { country: string | null; note?: string };
    // Null is the honest answer while no resolver is configured; the frontend then keeps USD.
    expect(body.country).toBeNull();
    expect(typeof body.note).toBe('string');
    expect(body.note).toMatch(/advisory/i);
    await app.close();
  });

  it('needs no rate snapshot and no database to serve the hint', async () => {
    const app = buildInstance();
    const res = await app.inject({ method: 'GET', url: '/api/v1/currency/geo-country' });

    // The throwing pool above proves it: reaching for it would have failed the request.
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
