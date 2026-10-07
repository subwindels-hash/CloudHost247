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
import {
  allFooterLinks,
  allNavLinks,
  LEGAL_INDEX,
  MARKETING_ROUTES,
  PUBLIC_DOC_ROUTES,
  routeExists,
  SITEMAP_POLICY,
} from '../../src/navigation/mega-menu';
import { isSitemapPathAllowed } from '../../src/routes/seo';
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

  it('serves registry-backed public sitemap routes exactly once and omits excluded destinations', async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/sitemap.xml' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/xml');

    const body = response.body;
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

    const candidates = [
      '/',
      ...MARKETING_ROUTES,
      ...LEGAL_INDEX.map((document) => document.spa),
      ...PUBLIC_DOC_ROUTES,
      ...allNavLinks().map((link) => link.to),
      ...allFooterLinks().map((link) => link.to),
    ];
    const publicPaths = [...new Set(candidates)]
      .filter((path) => isSitemapPathAllowed(path) && routeExists(path))
      .map((path) => path.split(/[?#]/, 1)[0]!.replace(/\/$/, '') || '/');
    for (const path of publicPaths) {
      const loc = `<loc>https://shop.example.com${path}</loc>`;
      // The configured APP_URL is used when no forwarded host is present.
      const defaultLoc = `<loc>http://localhost:3000${path}</loc>`;
      expect(body.includes(loc) || body.includes(defaultLoc), path).toBe(true);
    }

    // One <loc> per path: a duplicated entry is a crawler signal we never want to emit.
    const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
    expect(new Set(locations).size).toBe(locations.length);

    // The policy's exclusions apply to routes as well as dynamic descendants.
    const normalizedExclusions = SITEMAP_POLICY.exclude.map((path) => path.replace(/\/$/, ''));
    for (const location of locations) {
      const path = new URL(location).pathname.replace(/\/$/, '') || '/';
      expect(normalizedExclusions.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))).toBe(false);
    }
    expect(body).not.toContain('/cart</loc>');
    expect(body).not.toContain('/checkout</loc>');
    expect(body).not.toContain('/admin</loc>');
  });

  it('follows the deployed host and lists only published public detail records', async () => {
    const app = buildTestApp();
    const owner = await createOwner('owner@example.com');

    const siteId = randomUUID();
    const publicationId = randomUUID();
    await db.query(
      `INSERT INTO builder_sites (id, user_id, name, slug) VALUES ($1, $2, $3, $4)`,
      [siteId, owner, 'Live Site', 'live-site']
    );
    await db.query(
      `INSERT INTO builder_publications (id, site_id, version, snapshot) VALUES ($1, $2, 1, '{}'::jsonb)`,
      [publicationId, siteId]
    );
    await db.query(
      `UPDATE builder_sites SET status = 'published', published_publication_id = $2 WHERE id = $1`,
      [siteId, publicationId]
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

    const applicationId = randomUUID();
    await db.query(
      `INSERT INTO applications (id, name, slug, description, status) VALUES ($1, $2, $3, $4, 'published')`,
      [applicationId, 'Public App', 'public-app', 'A published app with a public version.']
    );
    await db.query(
      `INSERT INTO application_versions (id, application_id, version, manifest, status, is_stable)
       VALUES ($1, $2, '1.0.0', '{}'::jsonb, 'published', true)`,
      [randomUUID(), applicationId]
    );
    const appWithoutPublishedVersionId = randomUUID();
    await db.query(
      `INSERT INTO applications (id, name, slug, description, status) VALUES ($1, $2, $3, $4, 'published')`,
      [appWithoutPublishedVersionId, 'Unreleased App', 'unreleased-app', 'No published version exists.']
    );

    const liveAuctionId = randomUUID();
    await db.query(
      `INSERT INTO domain_auctions (id, seller_id, domain_name, status, currency, minimum_bid, bid_increment, starts_at, ends_at)
       VALUES ($1, $2, 'auction.example', 'ending_soon', 'USD', 10, 1, now() - interval '1 hour', now() + interval '1 hour')`,
      [liveAuctionId, owner]
    );
    const endedAuctionId = randomUUID();
    await db.query(
      `INSERT INTO domain_auctions (id, seller_id, domain_name, status, currency, minimum_bid, bid_increment, starts_at, ends_at)
       VALUES ($1, $2, 'ended.example', 'ended', 'USD', 10, 1, now() - interval '2 hours', now() - interval '1 hour')`,
      [endedAuctionId, owner]
    );

    const response = await app.inject({
      method: 'GET',
      url: '/sitemap.xml',
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'shop.example.com' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<loc>https://shop.example.com/sites/live-site</loc>');
    expect(response.body).toContain('<loc>https://shop.example.com/store/live-store</loc>');
    expect(response.body).toContain('<loc>https://shop.example.com/apps/public-app</loc>');
    expect(response.body).toContain(`<loc>https://shop.example.com/domains/auctions/${liveAuctionId}</loc>`);
    expect(response.body).not.toContain('draft-site');
    expect(response.body).not.toContain('draft-store');
    expect(response.body).not.toContain('unreleased-app');
    expect(response.body).not.toContain(endedAuctionId);
  });

  it('serves robots.txt using the registry exclusions and points at the sitemap', async () => {
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
    for (const exclusion of SITEMAP_POLICY.exclude) {
      expect(response.body).toContain(`Disallow: ${exclusion}`);
    }
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
