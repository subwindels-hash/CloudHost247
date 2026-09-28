import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import * as pool from '../../src/db/pool';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
  JWT_SECRET: 'd'.repeat(32),
} as NodeJS.ProcessEnv);

describe('/health and /ready', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /health always returns ok without touching the database', async () => {
    const spy = vi.spyOn(pool, 'isDatabaseReachable');
    const app = buildApp(env, { serveFrontend: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(spy).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /ready returns 200 ok when the database is reachable', async () => {
    vi.spyOn(pool, 'isDatabaseReachable').mockResolvedValue(true);
    const app = buildApp(env, { serveFrontend: false });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
    await app.close();
  });

  it('GET /ready returns 503 and no sensitive details when the database is unreachable', async () => {
    vi.spyOn(pool, 'isDatabaseReachable').mockResolvedValue(false);
    const app = buildApp(env, { serveFrontend: false });
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body).toEqual({ status: 'error', checks: { database: 'error' } });
    expect(JSON.stringify(body)).not.toMatch(/postgres|password|user:pass/i);
    await app.close();
  });

  it('unknown API routes return JSON 404, not the SPA shell', async () => {
    const app = buildApp(env, { serveFrontend: false });
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'NOT_FOUND', message: 'Resource not found' });
    await app.close();
  });
});
