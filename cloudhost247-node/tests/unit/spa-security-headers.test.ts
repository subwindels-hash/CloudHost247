import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';

/**
 * Regression: the static frontend and SPA fallback used to be registered on the root Fastify
 * instance, outside the encapsulated context where registerSecurityPlugins adds helmet / CORS /
 * rate-limit hooks — so every HTML/JS/CSS response shipped without CSP, HSTS, X-Frame-Options or
 * nosniff. These must apply to the frontend exactly as they do to the API.
 */
describe('security headers on frontend responses', () => {
  let publicDir: string;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'h'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(() => {
    publicDir = mkdtempSync(path.join(tmpdir(), 'ch247-public-'));
    writeFileSync(path.join(publicDir, 'index.html'), '<html><body>SPA shell</body></html>');
    writeFileSync(path.join(publicDir, 'app.js'), 'console.log("built asset");');
  });

  afterEach(() => {
    rmSync(publicDir, { recursive: true, force: true });
  });

  const expectHardened = (headers: Record<string, unknown>) => {
    expect(headers['content-security-policy']).toEqual(expect.stringContaining("default-src 'self'"));
    const policy = String(headers['content-security-policy']);
    const script = policy.split(';').find(d => d.trim().startsWith('script-src '))!;
    const connect = policy.split(';').find(d => d.trim().startsWith('connect-src '))!;
    expect(script).toContain('https://www.googletagmanager.com');
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain('*');
    // WebAssembly may be compiled, which the Barcode Scanner's decoder needs. Text may still not
    // be run as code: the keyword that allows eval() and new Function() is a different one.
    const sources = script.trim().split(/\s+/).slice(1);
    expect(sources).toContain("'wasm-unsafe-eval'");
    expect(sources).not.toContain("'unsafe-eval'");
    expect(connect).toContain('https://www.google-analytics.com');
    expect(connect).not.toContain('*');
    expect(headers['content-security-policy']).toEqual(expect.stringContaining('https://www.googleadservices.com'));
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['strict-transport-security']).toEqual(expect.stringContaining('max-age='));
    expect(headers['x-ratelimit-limit']).toBeDefined();
  };

  it.each(['/', '/login', '/dashboard', '/legal/privacy-policy'])('SPA route %s is hardened', async (route) => {
    const app = buildApp(env, { serveFrontend: true, publicDir });
    const res = await app.inject({ method: 'GET', url: route });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('SPA shell');
    expectHardened(res.headers);
    await app.close();
  });

  it('static assets are hardened', async () => {
    const app = buildApp(env, { serveFrontend: true, publicDir });
    const res = await app.inject({ method: 'GET', url: '/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('built asset');
    expectHardened(res.headers);
    await app.close();
  });

  it('API 404s keep JSON shape and headers', async () => {
    const app = buildApp(env, { serveFrontend: true, publicDir });
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'NOT_FOUND', message: 'Resource not found' });
    expectHardened(res.headers);
    await app.close();
  });
});
