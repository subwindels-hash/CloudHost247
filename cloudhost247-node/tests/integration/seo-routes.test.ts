/**
 * CLOUDHOST247 — public SEO surface (sitemap.xml / robots.txt).
 *
 * These two files are generated at request time from the live navigation definition and from
 * content that is genuinely reachable, so this suite pins the parts a crawler (and a reviewer)
 * depends on: every menu link is listed exactly once, private areas are never advertised, drafts
 * never leak, absolute URLs follow the deployed host, and no page or response carries a brand name
 * other than CLOUDHOST247.
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { allNavLinks } from '../../src/navigation/mega-menu';
import { hashPassword } from '../../src/lib/password';

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
process.env.JWT_SECRET ??= 'p'.repeat(32);
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
} as NodeJS.ProcessEnv);

describe('CLOUDHOST247 public SEO surface', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  const buildTestApp = () => buildApp(env, { serveFrontend: false, pool: db });

  async function createOwner(email: string): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'customer')`,
      [id, email, await hashPassword('password123'), 'Site Owner']
    );
    return id;
  }

  it('serves a sitemap containing every public navigation target exactly once', async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/sitemap.xml' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');

    const body = response.body;
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    for (const link of allNavLinks()) {
      const loc = `<loc>https://shop.example.com${link.to}</loc>`;
      // The default APP_URL is used when no forwarded host is present.
      const defaultLoc = `<loc>http://localhost:3000${link.to}</loc>`;
      expect(body.includes(loc) || body.includes(defaultLoc)).toBe(true);
    }

    // One <loc> per path: a duplicated entry is a crawler signal we never want to emit.
    const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
    expect(new Set(locations).size).toBe(locations.length);

    // Private areas are not advertised.
    expect(body).not.toContain('/cart</loc>');
    expect(body).not.toContain('/checkout</loc>');
    expect(body).not.toContain('/admin</loc>');
  });

  it('follows the deployed host and lists published sites and active stores, but never drafts', async () => {
    const app = buildTestApp();
    const owner = await createOwner('owner@example.com');

    await db.query(
      `INSERT INTO builder_sites (id, user_id, name, slug, status) VALUES ($1, $2, $3, $4, 'published')`,
      [randomUUID(), owner, 'Live Site', 'live-site']
    );
    await db.query(
      `INSERT INTO builder_sites (id, user_id, name, slug, status) VALUES ($1, $2, $3, $4, 'draft')`,
      [randomUUID(), owner, 'Draft Site', 'draft-site']
    );
    await db.query(
      `INSERT INTO store_stores (id, user_id, name, slug, status) VALUES ($1, $2, $3, $4, 'active')`,
      [randomUUID(), owner, 'Live Store', 'live-store']
    );
    await db.query(
      `INSERT INTO store_stores (id, user_id, name, slug, status) VALUES ($1, $2, $3, $4, 'draft')`,
      [randomUUID(), owner, 'Draft Store', 'draft-store']
    );

    const response = await app.inject({
      method: 'GET',
      url: '/sitemap.xml',
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'shop.example.com' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<loc>https://shop.example.com/sites/live-site</loc>');
    expect(response.body).toContain('<loc>https://shop.example.com/store/live-store</loc>');
    expect(response.body).not.toContain('draft-site');
    expect(response.body).not.toContain('draft-store');
  });

  it('serves robots.txt that points at the sitemap and closes every private area', async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/robots.txt',
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'shop.example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('User-agent: *');
    expect(response.body).toContain('Disallow: /api/');
    expect(response.body).toContain('Disallow: /admin');
    expect(response.body).toContain('Disallow: /cart');
    expect(response.body).toContain('Sitemap: https://shop.example.com/sitemap.xml');
    expect(response.body).not.toMatch(/[Dd]isallow: \/$/m);
  });

  it('never publishes any brand name other than CLOUDHOST247', async () => {
    const app = buildTestApp();
    const [sitemap, robots] = await Promise.all([
      app.inject({ method: 'GET', url: '/sitemap.xml' }),
      app.inject({ method: 'GET', url: '/robots.txt' }),
    ]);
    for (const response of [sitemap, robots]) {
      expect(response.body.toLowerCase()).not.toContain('windels');
    }
  });
});
