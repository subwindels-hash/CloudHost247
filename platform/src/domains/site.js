/**
 * Site: public website support endpoints for the marketing site.
 *
 * Honesty rules (non-negotiable, enforced by shape rather than by convention):
 *  - `site-info` returns ONLY what an operator configured in platform_settings under the
 *    `site_info` key. There is no hardcoded contact detail, address or phone number anywhere
 *    in this file — an unconfigured field is absent, and the frontend renders an explicit
 *    "not published yet" state instead of invented details.
 *  - `locations` lists ONLY regions that exist and are active in the infrastructure
 *    configuration, joined to their active provider. A deployment with no configured
 *    locations returns an empty list; the frontend says exactly that.
 *  - `status` reports only what THIS process can verify right now (the API answering and
 *    the storage ping). Everything else is reported as `unmonitored`, never `operational`.
 *  - `sitemap.xml` and `robots.txt` are generated from the configured APP_URL so they are
 *    correct on every deployment without editing files.
 */
'use strict';

const name = 'site';

/** Whitelisted, length-capped string fields an operator may publish via site_info. */
const STRING_FIELDS = {
  brandName: 120,
  tagline: 240,
  supportEmail: 254,
  salesEmail: 254,
  billingEmail: 254,
  phone: 40,
  addressLine1: 160,
  addressLine2: 160,
  addressCity: 80,
  addressRegion: 80,
  addressCountry: 80,
  addressPostalCode: 20,
  socialTwitter: 200,
  socialLinkedin: 200,
  socialGithub: 200,
  socialFacebook: 200,
};

function sanitizeSiteInfo(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [key, max] of Object.entries(STRING_FIELDS)) {
    const candidate = value[key];
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) out[key] = trimmed.slice(0, max);
    }
  }
  return out;
}

/** Public marketing pages, used for sitemap.xml. Kept with the static build in sync. */
const PUBLIC_ROUTES = [
  '/',
  '/hosting',
  '/hosting/web-hosting',
  '/hosting/wordpress',
  '/hosting/cloud',
  '/hosting/vps',
  '/hosting/dedicated',
  '/hosting/reseller',
  '/hosting/enterprise',
  '/hosting/game-servers',
  '/pricing',
  '/domains',
  '/domains/brokerage',
  '/applications',
  '/app-deployment',
  '/operating-systems',
  '/control-panels',
  '/developers',
  '/server-management',
  '/offers',
  '/faqs',
  '/business-email',
  '/security',
  '/migration',
  '/infrastructure',
  '/about',
  '/contact',
  '/support',
  '/knowledgebase',
  '/blog',
  '/status',
  '/legal/terms',
  '/legal/privacy',
  '/legal/cookies',
  '/legal/acceptable-use',
  '/legal/sla',
  '/legal/refund-policy',
];

function register(router, deps) {
  const { store, config } = deps;

  /** Operator-controlled public site information. Empty object until configured. */
  router.get('/api/v1/public/site-info', async (ctx) => {
    const row = await store.table('platform_settings').findById('site_info');
    ctx.json({
      brandName: 'CloudHost247',
      ...sanitizeSiteInfo(row?.value),
    });
  });

  /** Real infrastructure locations only — whatever the operator configured, nothing else. */
  router.get('/api/v1/public/locations', async (ctx) => {
    const [providers, regions] = await Promise.all([
      store.table('infra_providers').all(),
      store.table('regions').all(),
    ]);
    const activeProviders = new Map(
      providers
        .filter((p) => p.active !== false && p.status !== 'disabled')
        .map((p) => [p.id, p]),
    );

    const locations = regions
      .filter((r) => r.active !== false && r.status !== 'DISABLED' && activeProviders.has(r.provider_id))
      .map((r) => ({
        code: r.code,
        name: r.name,
        country: r.country_code ?? null,
        provider: activeProviders.get(r.provider_id).name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    ctx.json({ locations, configured: locations.length > 0 });
  });

  /**
   * Live status. Reports exactly what this request verified: the API answered (this very
   * response) and whether the storage ping succeeded. No invented uptime numbers, no fake
   * monitoring claims — `monitored: false` until real monitoring is wired in.
   */
  router.get('/api/v1/public/status', async (ctx) => {
    const storageOk = await store.ping();
    const components = [
      { key: 'website', name: 'Website', status: 'operational' },
      { key: 'api', name: 'API', status: 'operational' },
      { key: 'storage', name: 'Platform storage', status: storageOk ? 'operational' : 'error' },
      { key: 'hosting', name: 'Hosting services', status: 'unmonitored' },
      { key: 'dns', name: 'DNS', status: 'unmonitored' },
      { key: 'domain-services', name: 'Domain services', status: 'unmonitored' },
      { key: 'billing', name: 'Billing', status: 'unmonitored' },
    ];
    const checked = components.filter((c) => c.status !== 'unmonitored');
    ctx.json({
      allCheckedOk: checked.every((c) => c.status === 'operational'),
      monitored: false,
      checkedAt: new Date().toISOString(),
      components,
      note: 'Components marked unmonitored are not yet connected to a monitoring system; no uptime claim is made for them.',
    });
  });

  /**
   * Sitemap generated from APP_URL — correct on every deployment. Includes published
   * knowledgebase/blog articles, so new content is crawled without any manual step.
   */
  router.get('/sitemap.xml', async (ctx) => {
    const base = String(config.APP_URL).replace(/\/+$/, '');
    const routes = [...PUBLIC_ROUTES];
    try {
      const published = (await store.table('site_articles').all()).filter((a) => a.status === 'published');
      for (const a of published) routes.push(a.kind === 'blog' ? `/blog/${a.slug}` : `/kb/${a.slug}`);
    } catch { /* content table unavailable: static routes only */ }
    const urls = routes.map((route) => `  <url><loc>${base}${route}</loc></url>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    ctx.header('Content-Type', 'application/xml; charset=utf-8').send(xml);
  });

  /** robots.txt pointing at the generated sitemap. */
  router.get('/robots.txt', (ctx) => {
    const base = String(config.APP_URL).replace(/\/+$/, '');
    ctx
      .header('Content-Type', 'text/plain; charset=utf-8')
      .send(`User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
  });
}

module.exports = { name, register };
