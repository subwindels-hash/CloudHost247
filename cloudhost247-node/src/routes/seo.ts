/**
 * CLOUDHOST247 — public SEO surface.
 *
 * `GET /sitemap.xml` and `GET /robots.txt` are served by the API process itself (not by a static
 * file) so the sitemap always matches the live navigation definition and the content customers
 * actually published. Nothing here is hand-maintained: the static entries come from
 * `allNavLinks()` — the same single source of truth the mega menu, the mobile drawer and the
 * navigation validation test read — and the dynamic entries are SELECTed from the tables that own
 * them, so a page appears in the sitemap only when it is genuinely reachable:
 *
 *   - builder sites appear once `status = 'published'` (a draft has no public URL at all),
 *   - online stores appear once `status = 'active'` (a draft storefront answers 404).
 *
 * Absolute URLs are built from the request's own scheme/host (honouring `X-Forwarded-*`), falling
 * back to the configured `APP_URL`, so the deployed domain is always the one the crawler sees.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { allNavLinks } from '../navigation/mega-menu';

/** Longest sitemap we will emit per dynamic collection; a guard, not a paging mechanism. */
const MAX_DYNAMIC_URLS = 5_000;

/** Wrapped in a try/catch per collection: a database blip must never break the whole sitemap. */
async function safeRows<T>(run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run();
  } catch {
    return [];
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Escapes a path segment for use inside a URL (slugs are already URL-safe, this is belt and braces). */
function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function baseUrl(request: FastifyRequest, env: Env): string {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const forwardedHost = request.headers['x-forwarded-host'];
  const host = (typeof forwardedHost === 'string' && forwardedHost) || request.headers.host;
  if (host && !/^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(host)) {
    const proto = (typeof forwardedProto === 'string' && forwardedProto.split(',')[0]?.trim()) || 'https';
    return `${proto}://${host}`;
  }
  return (env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

interface SitemapEntry {
  path: string;
  lastModified?: string | null;
}

/**
 * Entries a crawler may index. Private areas (dashboard, cart, checkout, admin, inbox) are
 * deliberately absent: they require a session, so publishing them would only produce soft-404s.
 */
async function collectEntries(pool: Queryable | undefined): Promise<SitemapEntry[]> {
  const staticEntries: SitemapEntry[] = [{ path: '/' }];
  for (const link of allNavLinks()) {
    staticEntries.push({ path: link.to });
  }

  const sites = pool ? await safeRows(() =>
    pool.query<{ slug: string; updated_at: Date | string | null }>(
      `SELECT slug, updated_at FROM builder_sites
        WHERE status = 'published'
        ORDER BY updated_at DESC NULLS LAST
        LIMIT ${MAX_DYNAMIC_URLS}`
    ).then((result) => result.rows)
  ) : [];
  const stores = pool ? await safeRows(() =>
    pool.query<{ slug: string; updated_at: Date | string | null }>(
      `SELECT slug, updated_at FROM store_stores
        WHERE status = 'active'
        ORDER BY updated_at DESC NULLS LAST
        LIMIT ${MAX_DYNAMIC_URLS}`
    ).then((result) => result.rows)
  ) : [];

  return [
    ...staticEntries,
    ...sites.map((row) => ({ path: `/sites/${encodeSegment(row.slug)}`, lastModified: asIso(row.updated_at) })),
    ...stores.map((row) => ({ path: `/store/${encodeSegment(row.slug)}`, lastModified: asIso(row.updated_at) })),
  ];
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function renderSitemap(origin: string, entries: SitemapEntry[]): string {
  const seen = new Set<string>();
  const body = entries
    .filter((entry) => {
      if (seen.has(entry.path)) return false;
      seen.add(entry.path);
      return true;
    })
    .map((entry) => {
      const lastmod = entry.lastModified ? `\n    <lastmod>${escapeXml(entry.lastModified)}</lastmod>` : '';
      return `  <url>\n    <loc>${escapeXml(`${origin}${entry.path}`)}</loc>${lastmod}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * Private paths, by prefix. These are the routes that either require a session (and therefore
 * answer a redirect or 401 to an anonymous crawler) or exist only as authenticated APIs.
 */
const DISALLOWED_PREFIXES = [
  '/api/',
  '/admin',
  '/dashboard',
  '/cart',
  '/checkout',
  '/billing',
  '/invoices',
  '/account',
  '/inbox',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify',
  '/auth/',
];

function renderRobots(origin: string): string {
  const lines = ['User-agent: *', 'Allow: /'];
  for (const prefix of DISALLOWED_PREFIXES) lines.push(`Disallow: ${prefix}`);
  lines.push('', '# Absolute URLs, generated from the live navigation and published content');
  lines.push(`Sitemap: ${origin}/sitemap.xml`, '');
  return lines.join('\n');
}

export async function registerSeoRoutes(app: FastifyInstance, env: Env, pool?: Queryable): Promise<void> {
  app.get('/sitemap.xml', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply: FastifyReply) => {
    const origin = baseUrl(request, env);
    const entries = await collectEntries(pool);
    reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=600')
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(renderSitemap(origin, entries));
  });

  app.get('/robots.txt', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply: FastifyReply) => {
    const origin = baseUrl(request, env);
    reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(renderRobots(origin));
  });
}
