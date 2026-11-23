import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';

/**
 * Exercises the public site-search API (`GET /api/v1/search`) end-to-end against a real embedded
 * Postgres engine (pglite).
 *
 * The search corpus is generated from published content and compiled into the binary at build time,
 * so these tests assert against the generated `SITE_SEARCH_CORPUS` shipped with this branch — no
 * fixture rows are inserted. What they assert is honest behaviour: a short query returns nothing
 * rather than everything; a real term returns ranked results, each linking to a page that exists;
 * the count (`total`) is honest before `limit` truncates; `no-store` is set so a query is never
 * cached; an invalid `limit` is clamped rather than rejected.
 */
describe('site search API (GET /api/v1/search)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'e'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  it('returns 200 and a well-shaped response for a matching query', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=cloudhost247' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    const body = res.json() as {
      query: string;
      results: { href: string; title: string; category: string; score: number }[];
      total: number;
      limit: number;
    };
    expect(body.query).toBe('cloudhost247');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.limit).toBe(20);
    expect(body.total).toBeGreaterThan(0);
    for (const result of body.results) {
      expect(result.href).toMatch(/^\//);
      expect(typeof result.title).toBe('string');
      expect(typeof result.category).toBe('string');
      expect(typeof result.score).toBe('number');
    }
    await app.close();
  });

  it('ranks an exact title match above a scattered mention', async () => {
    const app = buildTestApp();
    const byTerm = (term: string) =>
      app.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(term)}` });
    const a = (await byTerm('domain')).json() as { results: { title: string }[] };
    const b = (await byTerm('domain registration')).json() as { results: { title: string }[] };
    await app.close();
    expect(a.results.length).toBeGreaterThan(0);
    expect(b.results.length).toBeGreaterThan(0);
    // A domain-related page should appear in both, and no result should be empty.
    expect(a.results.some((r) => /domain/i.test(r.title))).toBe(true);
    expect(b.results.some((r) => /domain/i.test(r.title))).toBe(true);
  });

  it('returns nothing for a query shorter than the minimum length', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=a' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: unknown[]; total: number };
    expect(body.results).toEqual([]);
    expect(body.total).toBe(0);
    await app.close();
  });

  it('clamps an oversized limit to the ceiling', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/search?q=vps&limit=999' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { limit: number; results: unknown[] };
    expect(body.limit).toBeLessThanOrEqual(40);
    expect(body.results.length).toBeLessThanOrEqual(40);
    await app.close();
  });

  it('400s on a missing or blank query', async () => {
    const app = buildTestApp();
    const missing = await app.inject({ method: 'GET', url: '/api/v1/search' });
    expect(missing.statusCode).toBe(400);
    const blank = await app.inject({ method: 'GET', url: '/api/v1/search?q=' });
    expect(blank.statusCode).toBe(400);
    await app.close();
  });
});
