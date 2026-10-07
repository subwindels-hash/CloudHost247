/**
 * CLOUDHOST247 — public SEO surface.
 *
 * `GET /sitemap.xml` and `GET /robots.txt` are served by the API process itself (not by a static
 * file). The sitemap is public-only: include pages reachable without authentication and exclude
 * private or session-gated destinations. Static route sources are the generated marketing, legal,
 * documentation, menu and footer registries, filtered by the registry's exclusion policy. Dynamic
 * route sources are their owning database tables, included only when the content is published:
 *
 *   - applications require a published app and published version;
 *   - builder sites have a published snapshot and `status = 'published'`;
 *   - online stores appear once `status = 'active'`;
 *   - auctions appear only while scheduled, live or ending soon.
 *
 * Absolute URLs are built from the request's own scheme/host (honouring `X-Forwarded-*`), falling
 * back to the configured `APP_URL`, so the deployed domain is always the one the crawler sees.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import {
  allFooterLinks,
  allNavLinks,
  LEGAL_INDEX,
  MARKETING_ROUTES,
  PUBLIC_DOC_ROUTES,
  PUBLIC_TOOL_ROUTES,
  routeExists,
  SITEMAP_POLICY,
} from '../navigation/mega-menu';

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
function normalizePath(value: string): string | null {
  const path = value.trim().split(/[?#]/, 1)[0] ?? '';
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return null;
  const segments = path.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  return segments.length ? `/${segments.join('/')}` : '/';
}

/** Paths denied indexing by the central site registry are never emitted in a sitemap. */
export function isSitemapPathAllowed(path: string): boolean {
  const candidate = normalizePath(path);
  if (!candidate) return false;
  return !SITEMAP_POLICY.exclude.some((rule) => {
    const prefix = normalizePath(rule);
    if (!prefix) return false;
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  });
}

function publicEntry(path: string, lastModified?: Date | string | null): SitemapEntry | null {
  const normalized = normalizePath(path);
  if (!normalized || !isSitemapPathAllowed(normalized) || !routeExists(normalized)) return null;
  return { path: normalized, lastModified: asIso(lastModified) };
}

/**
 * Entries a crawler may index. Static paths come only from generated public registries; dynamic
 * paths come only from records whose publication state makes their detail route public.
 */
async function collectEntries(pool: Queryable | undefined): Promise<SitemapEntry[]> {
  const staticPaths = [
    '/',
    ...MARKETING_ROUTES,
    ...LEGAL_INDEX.map((document) => document.spa),
    ...PUBLIC_DOC_ROUTES,
    ...PUBLIC_TOOL_ROUTES,
    ...allNavLinks().map((link) => link.to),
    ...allFooterLinks().map((link) => link.to),
  ];
  const staticEntries = staticPaths
    .map((path) => publicEntry(path))
    .filter((entry): entry is SitemapEntry => entry !== null);

  const applications = pool ? await safeRows(() =>
    pool.query<{ slug: string; updated_at: Date | string | null }>(
      `SELECT a.slug, a.updated_at
         FROM applications a
        WHERE a.status = 'published'
          AND a.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
          AND EXISTS (
            SELECT 1
              FROM application_versions v
             WHERE v.application_id = a.id AND v.status = 'published'
          )
        ORDER BY a.featured DESC, a.popularity DESC, a.name ASC
        LIMIT ${MAX_DYNAMIC_URLS}`
    ).then((result) => result.rows)
  ) : [];
  const sites = pool ? await safeRows(() =>
    pool.query<{ slug: string; updated_at: Date | string | null }>(
      `SELECT slug, updated_at FROM builder_sites
        WHERE status = 'published'
          AND published_publication_id IS NOT NULL
          AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        ORDER BY updated_at DESC NULLS LAST
        LIMIT ${MAX_DYNAMIC_URLS}`
    ).then((result) => result.rows)
  ) : [];
  const stores = pool ? await safeRows(() =>
    pool.query<{ slug: string; updated_at: Date | string | null }>(
      `SELECT slug, updated_at FROM store_stores
        WHERE status = 'active'
          AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        ORDER BY updated_at DESC NULLS LAST
        LIMIT ${MAX_DYNAMIC_URLS}`
    ).then((result) => result.rows)
  ) : [];
  const auctions = pool ? await safeRows(() =>
    pool.query<{ id: string; updated_at: Date | string | null }>(
      `SELECT id::text AS id, updated_at FROM domain_auctions
        WHERE status IN ('scheduled', 'live', 'ending_soon')
        ORDER BY ends_at ASC
        LIMIT ${MAX_DYNAMIC_URLS}`
    ).then((result) => result.rows)
  ) : [];

  const dynamicEntries = [
    ...applications.map((row) => publicEntry(`/apps/${encodeSegment(row.slug)}`, row.updated_at)),
    ...sites.map((row) => publicEntry(`/sites/${encodeSegment(row.slug)}`, row.updated_at)),
    ...stores.map((row) => publicEntry(`/store/${encodeSegment(row.slug)}`, row.updated_at)),
    ...auctions.map((row) => publicEntry(`/domains/auctions/${encodeSegment(row.id)}`, row.updated_at)),
  ].filter((entry): entry is SitemapEntry => entry !== null);

  return [...staticEntries, ...dynamicEntries];
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
 * robots.txt for whichever host answers `/robots.txt`.
 *
 * Both halves of the registry policy are published: the single-page-app exclusions and the
 * PHP/WHMCS ones. The platform is mounted under the same domain as the PHP deployment, so a rule
 * that names `cart.php` or `tools/api.php` is meaningful here too — and publishing only half the
 * policy is how a crawl rule ends up contradicting the surface that enforces it. Sitemap endpoints
 * are never disallowed: a blocked sitemap cannot be fetched, which voids the `Sitemap:` line below.
 */
function renderRobots(origin: string): string {
  // Root-relative, as the specification requires, but otherwise left exactly as authored: a
  // directory rule stays `admin/` so it cannot widen into a prefix match on `/administrators`.
  const rules = [
    ...new Set(
      [...SITEMAP_POLICY.exclude, ...SITEMAP_POLICY.excludePhp]
        .map((rule) => rule.trim().split(/[?#]/, 1)[0] ?? '')
        .filter((rule) => rule && !rule.startsWith('//') && !rule.includes('://'))
        .map((rule) => (rule.startsWith('/') ? rule : `/${rule.replace(/^\.?\/+/, '')}`))
    ),
  ].sort();
  const lines = ['User-agent: *', 'Allow: /', ...rules.map((rule) => `Disallow: ${rule}`)];
  lines.push('', '# Sitemap generated from the public site registries and published records');
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
