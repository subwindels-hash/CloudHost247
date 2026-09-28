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
    // Mirrors the real build output (see frontend/public/) — favicon.svg and robots.txt are
    // top-level static files (not under /assets/), copied as-is by Vite's publicDir passthrough.
    writeFileSync(path.join(publicDir, 'favicon.svg'), '<svg>fake favicon</svg>');
    writeFileSync(path.join(publicDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  });

  afterEach(() => {
    rmSync(publicDir, { recursive: true, force: true });
  });

  const routes = [
    '/',
    '/login',
    '/register',
    '/dashboard',
    '/account',
    '/account/domains',
    '/services',
    '/billing',
    '/invoices',
    '/support',
    '/admin',
    // Phase 2 public marketing/legal routes — same generic fallback mechanism, no server changes
    // required to add them, which is the point of testing the fallback itself rather than a
    // hardcoded route list.
    '/about',
    '/hosting',
    '/hosting/cpanel',
    '/hosting/vps',
    '/domains',
    '/contact',
    '/faq',
    '/legal',
    '/legal/privacy-policy',
  ];

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

  it('serves top-level static files (favicon.svg, robots.txt) rather than the SPA shell', async () => {
    const app = buildApp(env, { serveFrontend: true, publicDir });

    const favicon = await app.inject({ method: 'GET', url: '/favicon.svg' });
    expect(favicon.statusCode).toBe(200);
    expect(favicon.body).toContain('fake favicon');

    const robots = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(robots.statusCode).toBe(200);
    expect(robots.body).toContain('User-agent');

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
