import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';

/**
 * Verifies the requirement in docs/CPANEL_DEPLOYMENT.md / spec section 17: React routes such as
 * /dashboard, /billing, etc. must not 404 on direct navigation or browser refresh, while actual
 * static assets and unknown API routes still behave correctly.
 */
describe('SPA fallback routing (Apache/cPanel refresh safety)', () => {
  let publicDir: string;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'e'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(() => {
    publicDir = mkdtempSync(path.join(tmpdir(), 'ch247-public-'));
    writeFileSync(path.join(publicDir, 'index.html'), '<html><body>SPA shell</body></html>');
    writeFileSync(path.join(publicDir, 'app.js'), 'console.log("built asset");');
  });

  afterEach(() => {
    rmSync(publicDir, { recursive: true, force: true });
  });

  const routes = ['/', '/login', '/register', '/dashboard', '/services', '/domains', '/billing', '/invoices', '/support', '/admin'];

  it.each(routes)('GET %s resolves to the SPA shell (not a 404)', async (route) => {
    const app = buildApp(env, { serveFrontend: true, publicDir });
    const res = await app.inject({ method: 'GET', url: route });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('SPA shell');
    await app.close();
  });

  it('serves real static assets from public/', async () => {
    const app = buildApp(env, { serveFrontend: true, publicDir });
    const res = await app.inject({ method: 'GET', url: '/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('built asset');
    await app.close();
  });

  it('still returns JSON 404 for unknown API routes, never the SPA shell', async () => {
    const app = buildApp(env, { serveFrontend: true, publicDir });
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    await app.close();
  });
});
