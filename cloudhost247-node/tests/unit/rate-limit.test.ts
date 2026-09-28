import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';

/**
 * Regression test for a real bug found during manual verification: security plugins
 * (helmet/cors/rate-limit) and routes were registered as separate sibling Fastify plugin
 * contexts. @fastify/rate-limit attaches its hook to its immediate parent context (it uses
 * fastify-plugin internally), so routes declared in a *different* sibling context silently
 * received no rate limiting at all — this test would have caught that.
 */
describe('rate limiting is actually applied to routes', () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'f'.repeat(32),
  } as NodeJS.ProcessEnv);

  it('adds rate-limit headers to a plain route (global default)', async () => {
    const app = buildApp(env, { serveFrontend: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    await app.close();
  });

  it('returns 429 (not a 500) once the stricter per-route login limit is exceeded', async () => {
    const app = buildApp(env, { serveFrontend: false });
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'wrong-password' },
      });
      lastStatus = res.statusCode;
      if (lastStatus === 429) {
        expect(res.json()).toHaveProperty('message');
        break;
      }
    }
    expect(lastStatus).toBe(429);
    await app.close();
  });
});
