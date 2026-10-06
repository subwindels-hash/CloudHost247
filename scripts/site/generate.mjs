#!/usr/bin/env node
/**
 * CloudHost247 website generator — one registry in, every surface out.
 *
 * Reads `shared/site/registry.json` (the single source of truth for brand, mega menus,
 * footer columns, legal index, tool categories and sitemap policy) and:
 *
 *   1. validates every destination against the routes that actually exist — SPA routes
 *      parsed from App.tsx, root PHP pages on disk, licensed WHMCS entry points, tool
 *      catalogue paths, and legal slugs;
 *   2. writes `cloudhost247-node/frontend/src/navigation/registry.generated.ts`;
 *   3. merges the navigation + footer into the PHP theme registry
 *      `modules/addons/cloudhost247_theme/resources/site.json` (its `pages` content map is
 *      preserved untouched);
 *   4. writes `shared/site/generated/route-report.json`, which the audit and the final
 *      report read instead of re-deriving the numbers.
 *
 * A destination that cannot be resolved is a hard failure: the build refuses to emit a
 * navigation that points at a page nobody serves. That is the whole point of the file.
 *
 * Usage:
 *   node scripts/site/generate.mjs           # validate + write
 *   node scripts/site/generate.mjs --check   # validate only, write nothing (CI)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');

const REGISTRY = join(ROOT, 'shared', 'site', 'registry.json');
const CONTENT_DIR = join(ROOT, 'shared', 'site', 'content');
const APP_TSX = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'App.tsx');
const TOOLS_CATALOG = join(ROOT, 'cloudhost247-node', 'src', 'tools', 'catalog.ts');
const PHP_SITE_JSON = join(ROOT, 'modules', 'addons', 'cloudhost247_theme', 'resources', 'site.json');
/**
 * The registry is emitted twice on purpose: the SPA compiles under its own tsconfig with no
 * rootDir, and the API compiles with `rootDir: "."` and `frontend/` excluded. Both copies come
 * from this one generator run, so they cannot drift — but neither tree has to reach into the
 * other's source to compile.
 */
const TS_OUT = [
  join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'navigation', 'registry.generated.ts'),
  join(ROOT, 'cloudhost247-node', 'src', 'navigation', 'registry.generated.ts'),
];
const PAGES_OUT = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'pages.generated.json');
const DOCS_OUT = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'docs.generated.json');
const DOCS_PUBLIC = join(ROOT, 'cloudhost247-node', 'frontend', 'public', 'docs');
const TOOLS_OUT = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'tools.generated.json');
const LEGAL_GENERATED = join(ROOT, 'shared', 'site', 'content', 'legal.generated.json');
const LEGAL_OUT = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'legal.generated.json');
const ASSET_SOURCE = join(ROOT, 'assets', 'images', 'cloudhost247');
const ASSET_PUBLIC = join(ROOT, 'cloudhost247-node', 'frontend', 'public', 'media', 'cloudhost247');
const DESIGN_SYSTEM = join(ROOT, 'shared', 'site', 'design-system.css');
const DESIGN_SYSTEM_COPY = join(ROOT, 'templates', 'cloudhost247', 'css', 'design-system.css');
const REPORT_OUT = join(ROOT, 'shared', 'site', 'generated', 'route-report.json');

/**
 * Documents published to the website reader. Only documents that describe the platform as a
 * product — its APIs, its services and how to operate them — are exposed; internal audits, scope
 * proposals, incomplete-work registers and runbooks stay in the repository.
 */
export const PUBLISHED_DOCS = [
  { file: 'API_CATALOG.md', section: 'APIs', title: 'Catalog API' },
  { file: 'API_COMMERCE.md', section: 'APIs', title: 'Commerce API' },
  { file: 'API_BILLING.md', section: 'APIs', title: 'Billing API' },
  { file: 'API_PAYMENTS.md', section: 'APIs', title: 'Payments API' },
  { file: 'API_CUSTOMER_APP.md', section: 'APIs', title: 'Customer application API' },
  { file: 'DOMAIN_SERVICES_ARCHITECTURE.md', section: 'Services', title: 'Domain services architecture' },
  { file: 'DOMAIN_BROKERAGE.md', section: 'Services', title: 'Domain brokerage' },
  { file: 'SERVER_PROVISIONING.md', section: 'Services', title: 'Server provisioning' },
  { file: 'SERVER_AGENT.md', section: 'Services', title: 'Server agent' },
  { file: 'PLATFORM_SERVICES_ARCHITECTURE.md', section: 'Services', title: 'Platform services architecture' },
  { file: 'PASSKEY.md', section: 'Accounts', title: 'Passkeys and WebAuthn' },
  { file: 'MRZ_DEVELOPER_TOOL.md', section: 'Accounts', title: 'Document tools (MRZ)' },
  { file: 'CPANEL_DEPLOYMENT.md', section: 'Operations', title: 'cPanel deployment' },
  { file: 'NODE_PLATFORM_STATUS.md', section: 'Operations', title: 'Platform status and known gaps' },
  { file: 'webhooks/README.md', section: 'Operations', title: 'Webhook pipeline', optional: true }
];

/** Icon names the SPA icon set actually implements; a typo must fail the build, not render blank. */
const KNOWN_ICONS = new Set([
  'activity', 'alert', 'api', 'app', 'book', 'book-open', 'box', 'briefcase', 'building', 'cart',
  'chart', 'clock', 'cloud', 'cloud-lock', 'code', 'control', 'cookie', 'cpu', 'database',
  'data-center', 'dns', 'docker', 'domain', 'eye', 'file-text', 'firewall', 'folder', 'gamepad',
  'gauge', 'git-branch', 'globe', 'grid', 'handshake', 'hard-drive', 'headset', 'help', 'invoice',
  'ip', 'key', 'laravel', 'layers', 'layout', 'life-buoy', 'list', 'lock', 'mail', 'megaphone',
  'network', 'news', 'nodejs', 'os', 'pen', 'php', 'pulse', 'python', 'puzzle', 'refresh',
  'rocket', 'scale', 'search', 'server', 'server-rack', 'settings', 'shield', 'sparkle', 'star',
  'tag', 'terminal', 'ticket', 'tools', 'transfer', 'user', 'users', 'windows', 'wordpress',
  'wrench', 'zap'
]);

/** WHMCS entry points that live in the licensed core, not in this repository. */
const WHMCS_ENTRY_POINTS = new Set([
  'index.php', 'cart.php', 'clientarea.php', 'register.php', 'logout.php', 'pwreset.php',
  'contact.php', 'knowledgebase.php', 'submitticket.php', 'serverstatus.php',
  'announcements.php', 'supporttickets.php', 'viewticket.php', 'domainchecker.php',
]);

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

/* ------------------------------------------------------------------ */
/* Route catalogues                                                     */
/* ------------------------------------------------------------------ */

/** Every `<Route path="…">` in the SPA router, expanded for `:param` and `*` segments. */
export function spaRoutes() {
  const source = readFileSync(APP_TSX, 'utf8');
  const routes = new Set();
  for (const match of source.matchAll(/<Route\s+path="([^"]+)"/g)) {
    const path = match[1];
    if (path === '*') continue;
    routes.add(path);
    // `/tools/*`, `/sites/:slug/*` and `/store/:slug` are shape patterns: record a prefix so an
    // arbitrary tool path (`/tools/dns/propagation`) validates against the real catalogue instead.
    if (path.endsWith('/*')) routes.add(`PREFIX:${path.slice(0, -2)}`);
    if (path.includes(':')) routes.add(`PATTERN:${path}`);
  }
  // `/` is declared in App.tsx as path="/" already; make sure it is present regardless.
  routes.add('/');
  return routes;
}

/**
 * Public tool entries for the website search index: name, path, category and summary, straight
 * from the catalogue the server executes. `visibility: 'public'` is honoured, so a tool that
 * requires an account is indexed by name but never presented as something a visitor can run
 * anonymously — the Tools Center enforces the same rule server-side.
 */
export function publicTools() {
  const source = readFileSync(TOOLS_CATALOG, 'utf8');
  const entries = [];
  const blocks = source.split(/\n  \{\n/).slice(1);
  for (const block of blocks) {
    const slug = /^\s*slug:\s*'([^']+)'/m.exec(block);
    const name = /^\s*name:\s*'([^']+)'/m.exec(block);
    const path = /^\s*path:\s*'(\/tools\/[^']+)'/m.exec(block);
    const category = /^\s*category:\s*'([^']+)'/m.exec(block);
    const summary = /^\s*summary:\s*'([^']+)'/m.exec(block);
    const visibility = /^\s*visibility:\s*'([^']+)'/m.exec(block);
    if (!slug || !name || !path) continue;
    entries.push({
      slug: slug[1],
      name: name[1],
      path: path[1],
      category: category ? category[1] : 'general',
      description: summary ? summary[1] : '',
      visibility: visibility ? visibility[1] : 'public',
    });
  }
  return entries;
}

/** Tool paths straight from the tool catalogue the server and the SPA Tools Center both use. */
export function toolPaths() {
  const source = readFileSync(TOOLS_CATALOG, 'utf8');
  const paths = new Set(['/tools']);
  for (const match of source.matchAll(/path:\s*'(\/tools\/[^']+)'/g)) paths.add(match[1]);
  return paths;
}

/** Root-level PHP pages shipped by this repository. */
function phpPages() {
  const files = new Set();
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.php')) files.add(entry.name);
  }
  return files;
}

/** Resolve a PHP destination: the file before any query/fragment, then the WHMCS/Tools specials. */
function phpTargetExists(url, pages, toolRoutes) {
  const path = url.split('#')[0].split('?')[0].replace(/^\.?\//, '');
  if (!path) return false;
  if (pages.has(path)) return true;
  if (WHMCS_ENTRY_POINTS.has(path)) return true;
  if (path === 'tools' || toolRoutes.has(path)) return true;
  return false;
}

/** Resolve an SPA destination against the router, the tool catalogue and the legal index. */
function spaTargetExists(route, routes, tools, legalSlugs, extraRoutes) {
  if (route.startsWith('#')) return true;
  const path = route.split('#')[0].split('?')[0] || '/';
  if (extraRoutes.has(path)) return true;
  if (routes.has(path)) return true;
  if (tools.has(path)) return true;
  if (legalSlugs.has(path)) return true;
  if (path.startsWith('/tools/')) {
    if (routes.has('PREFIX:/tools')) return true;
  }
  if (path.startsWith('/legal/')) {
    if (routes.has('PREFIX:/legal')) return true;
    if (extraRoutes.has(path)) return true;
  }
  for (const pattern of routes) {
    if (!pattern.startsWith('PATTERN:')) continue;
    const segments = pattern.slice('PATTERN:'.length).split('/');
    const candidate = path.split('/');
    if (segments.length !== candidate.length) continue;
    if (segments.every((segment, index) => segment.startsWith(':') || segment === candidate[index])) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Registry walk                                                        */
/* ------------------------------------------------------------------ */

function* walkMenus(registry) {
  for (const menu of registry.menus) {
    if (menu.href) yield { where: `menu:${menu.id}`, href: menu.href, label: menu.label };
    if (menu.featured?.href) {
      yield { where: `menu:${menu.id}:featured`, href: menu.featured.href, label: menu.featured.title };
    }
    for (const column of menu.columns ?? []) {
      for (const item of column.items ?? []) {
        yield { where: `menu:${menu.id}/${column.title}`, href: item.href, label: item.label };
      }
    }
  }
}

function* walkFooter(registry) {
  for (const column of registry.footer) {
    for (const item of column.items) {
      yield { where: `footer:${column.title}`, href: item.href, label: item.label };
    }
  }
}

function* walkUtility(registry) {
  for (const [key, value] of Object.entries(registry.utility)) {
    yield { where: `utility:${key}`, href: value, label: value.label };
  }
}

/* ------------------------------------------------------------------ */
/* Emitters                                                             */
/* ------------------------------------------------------------------ */

const json = (value) => JSON.stringify(value, null, 2);

function tsString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function emitRegistryTs(registry, spaRoutePatterns, marketingRoutes) {
  const banner = `/**
 * GENERATED FILE — do not edit.
 *
 * Source: shared/site/registry.json
 * Regenerate: node scripts/site/generate.mjs
 *
 * The desktop mega menus, the mobile drawer, the footer, the sitemap and the link-integrity
 * test all read this one definition, so no two navigation surfaces can disagree and no menu
 * entry can point at a route the app does not serve.
 */
/* eslint-disable */
`;

  const sections = registry.menus.map((menu) => {
    const columns = (menu.columns ?? []).map((column) => ({
      title: column.title,
      links: (column.items ?? []).map((item) => ({
        label: item.label,
        to: item.href.spa ?? item.href.php ?? '#',
        description: item.desc ?? '',
        icon: item.icon ?? 'wrench',
        ...(item.badge ? { badge: item.badge } : {}),
      })),
    }));
    return {
      id: menu.id,
      label: menu.label,
      blurb: menu.blurb,
      to: menu.href?.spa ?? '/',
      toolsDriven: Boolean(menu.toolsDriven),
      ...(menu.featured
        ? {
            featured: {
              title: menu.featured.title,
              body: menu.featured.body,
              to: menu.featured.href.spa ?? '/',
              ctaLabel: menu.featured.cta,
            },
          }
        : {}),
      groups: columns,
    };
  });

  const footer = registry.footer.map((column) => ({
    title: column.title,
    toolsDriven: Boolean(column.toolsDriven),
    links: (column.items ?? []).map((item) => ({
      label: item.label,
      to: item.href.spa ?? item.href.php ?? '#',
    })),
  }));

  const utility = Object.fromEntries(
    Object.entries(registry.utility).map(([key, value]) => [key, { label: value.label, to: value.spa ?? '/' }])
  );

  return `${banner}
export interface RegistryLink {
  label: string;
  to: string;
  description: string;
  icon: string;
  badge?: 'NEW' | 'POPULAR' | 'TRENDING' | 'INCLUDED' | 'SALE';
}

export interface RegistryGroup {
  title: string;
  links: RegistryLink[];
}

export interface RegistrySection {
  id: string;
  label: string;
  blurb: string;
  to: string;
  toolsDriven: boolean;
  featured?: { title: string; body: string; to: string; ctaLabel: string };
  groups: RegistryGroup[];
}

export interface RegistryFooterColumn {
  title: string;
  toolsDriven: boolean;
  links: Array<{ label: string; to: string }>;
}

export const REGISTRY_VERSION = ${tsString(registry.version)};

export const BRAND = ${json(registry.brand).replace(/^/gm, '').replace(/\n/g, '\n')} as const;

export const UTILITY = ${json(utility)} as const;

export const NAV_SECTIONS: RegistrySection[] = ${json(sections)};

export const FOOTER_COLUMNS: RegistryFooterColumn[] = ${json(footer)};

export const TOOLS_CATEGORIES = ${json(registry.toolsCategories)};

export const LEGAL_INDEX = ${json(registry.legal)};

export const SITEMAP_POLICY = ${json(registry.sitemap)};

/** Every route pattern the SPA router declares, parsed from App.tsx at generation time. */
export const SPA_ROUTE_PATTERNS: string[] = ${json(spaRoutePatterns)};

/**
 * Every marketing route this build publishes. The router maps these to one page component; the
 * page content itself is imported lazily by that component, so the application shell does not
 * carry a quarter of a megabyte of product copy on a cold start.
 */
export const MARKETING_ROUTES: string[] = ${json(marketingRoutes)};

/** Every route the registry publishes, in menu order — the sitemap and audits read this. */
export const REGISTRY_ROUTES: string[] = ${json([
    '/',
    ...registry.menus.map((menu) => menu.href?.spa).filter(Boolean),
    ...new Set(registry.menus.flatMap((menu) => (menu.columns ?? []).flatMap((column) => (column.items ?? []).map((item) => item.href.spa))).filter(Boolean)),
  ])};
`;
}

/** site.json keeps its rich page-content map; only navigation and footer are generated. */
function emitPhpSiteJson(registry, previous) {
  const navigation = registry.menus.map((menu) => ({
    title: menu.label,
    description: menu.blurb,
    groups: (menu.columns ?? []).map((column) => ({
      title: column.title,
      links: (column.items ?? [])
        .filter((item) => item.href.php)
        .map((item) => ({ label: item.label, url: item.href.php.replace(/^\.?\//, '') })),
    })).filter((group) => group.links.length > 0),
  }));

  const footer = registry.footer
    .map((column) => ({
      title: column.title,
      links: (column.items ?? [])
        .filter((item) => item.href.php)
        .map((item) => ({ label: item.label, url: item.href.php.replace(/^\.?\//, '') })),
    }))
    .filter((column) => column.links.length > 0);

  return { ...previous, navigation, footer };
}

/* ------------------------------------------------------------------ */
/* Page content                                                         */
/* ------------------------------------------------------------------ */

/** Every `shared/site/content/*.json` (other than news) merged into one page list. */
export function loadContentPages() {
  const pages = [];
  const seen = new Set();
  for (const file of readdirSync(CONTENT_DIR).filter((name) => name.endsWith('.json') && name !== 'news.json').sort()) {
    const parsed = JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'));
    for (const page of parsed.pages ?? []) {
      if (seen.has(page.route)) {
        fail(`duplicate content route ${page.route} (in ${file}).`);
        continue;
      }
      seen.add(page.route);
      pages.push(page);
    }
  }
  return pages;
}

const ALLOWED_SECTIONS = new Set([
  'features', 'cards', 'steps', 'split', 'checks', 'note', 'table',
  'live-locations', 'live-status', 'catalog', 'site-search', 'doc-index', 'news',
]);

function validatePages(pages, spaRouteSet, tools, registryRoutes, legalSlugs) {
  const relatedTargets = new Set([...pages.map((page) => page.route), ...legalSlugs]);
  for (const page of pages) {
    const where = `page ${page.route}`;
    if (!page.title) fail(`${where}: no title.`);
    if (!page.seoTitle || page.seoTitle.length > 75) {
      fail(`${where}: seoTitle is missing or longer than 75 characters (${page.seoTitle?.length ?? 0}).`);
    }
    if (!page.description || page.description.length < 70 || page.description.length > 165) {
      fail(`${where}: description must be 70–165 characters (is ${page.description?.length ?? 0}).`);
    }
    if (!page.hero?.heading || !page.hero?.lede) fail(`${where}: hero heading/lede missing.`);
    if (!page.visual) fail(`${where}: no visual asset key.`);

    for (const cta of page.hero?.ctas ?? []) {
      if (!spaTargetExists(cta.to, spaRouteSet, tools, legalSlugs, relatedTargets)) {
        fail(`${where}: hero CTA "${cta.label}" → ${cta.to} is not a route this app serves.`);
      }
    }
    for (const related of page.related ?? []) {
      if (!spaTargetExists(related, spaRouteSet, tools, legalSlugs, relatedTargets)) {
        fail(`${where}: related "${related}" is not a route this app serves.`);
      }
    }
    if (page.visual && !existsSync(join(ASSET_SOURCE, `${page.visual}.svg`))) {
      fail(`${where}: visual asset assets/images/cloudhost247/${page.visual}.svg does not exist.`);
    }
    for (const section of page.sections ?? []) {
      if (!ALLOWED_SECTIONS.has(section.type)) {
        fail(`${where}: unknown section type "${section.type}".`);
      }
      if (section.visual && !existsSync(join(ASSET_SOURCE, `${section.visual}.svg`))) {
        fail(`${where}/${section.type}: visual asset assets/images/cloudhost247/${section.visual}.svg does not exist.`);
      }
      const items = [...(section.items ?? []), ...(section.links ?? [])];
      for (const item of items) {
        if (item.icon && !KNOWN_ICONS.has(item.icon)) {
          fail(`${where}/${section.type}: unknown icon "${item.icon}".`);
        }
        if (item.to && !spaTargetExists(item.to, spaRouteSet, tools, legalSlugs, relatedTargets)) {
          fail(`${where}/${section.type}: link "${item.title ?? item.label}" → ${item.to} is not a route this app serves.`);
        }
        if (item.link?.to && !spaTargetExists(item.link.to, spaRouteSet, tools, legalSlugs, relatedTargets)) {
          fail(`${where}/${section.type}: link → ${item.link.to} is not a route this app serves.`);
        }
      }
      if (section.type !== 'news' && section.type !== 'site-search' && !section.heading && !section.items?.length) {
        fail(`${where}/${section.type}: section has neither heading nor items.`);
      }
    }
    for (const faq of page.faqs ?? []) {
      if (!faq.q || !faq.a) fail(`${where}: an FAQ entry is missing a question or an answer.`);
    }
  }

  // Every route the navigation publishes must have a page, or the menu is advertising nothing.
  const covered = new Set(pages.map((page) => page.route));
  for (const route of registryRoutes) {
    if (route === '/' || route.startsWith('/tools') || route.startsWith('/legal/')) continue;
    if (!covered.has(route) && !spaRouteSet.has(route)) {
      fail(`navigation publishes ${route} but no marketing page and no app route serves it.`);
    }
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* Documentation index                                                  */
/* ------------------------------------------------------------------ */

function firstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].replace(/[*`]/g, '').trim() : '';
}

function firstParagraph(markdown) {
  const body = markdown.replace(/^#[^\n]*\n+/, '');
  for (const block of body.split(/\n{2,}/)) {
    const text = block.trim();
    if (!text || text.startsWith('#') || text.startsWith('|') || text.startsWith('```') || text.startsWith('-')) continue;
    return text.replace(/[*`>]/g, '').replace(/\s+/g, ' ').slice(0, 240);
  }
  return '';
}

function buildDocsIndex() {
  const index = [];
  const copied = [];
  for (const entry of PUBLISHED_DOCS) {
    const source = join(ROOT, 'docs', entry.file);
    if (!existsSync(source)) {
      if (!entry.optional) warn(`documentation file docs/${entry.file} is listed for publication but does not exist.`);
      continue;
    }
    const markdown = readFileSync(source, 'utf8');
    const slug = entry.file.replace(/\.md$/, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    index.push({
      slug,
      href: `/docs/${slug}`,
      section: entry.section,
      title: entry.title || firstHeading(markdown) || entry.file,
      summary: firstParagraph(markdown).slice(0, 200),
      source: `docs/${entry.file}`,
      bytes: markdown.length,
    });
    copied.push({ slug, file: entry.file, markdown });
  }
  return { index, copied };
}

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

function main() {
  const checkOnly = process.argv.includes('--check');
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));

  const routes = spaRoutes();
  const tools = toolPaths();
  const pages = phpPages();
  const phpToolRoutes = new Set(['tools']);
  const toolsPublic = join(ROOT, 'modules', 'addons', 'cloudhost247_theme', 'resources', 'tools-public.json');
  if (existsSync(toolsPublic)) {
    const data = JSON.parse(readFileSync(toolsPublic, 'utf8'));
    for (const tool of data.tools ?? []) phpToolRoutes.add(String(tool.path).replace(/^\//, ''));
    for (const slug of Object.keys(data.categories ?? {})) phpToolRoutes.add(`tools/category/${slug}`);
  }

  // Content is loaded first: a navigation link is allowed to point at a marketing page that the
  // generator itself is about to emit, and at the legal index. Nothing else gets a pass.
  const rawPages = loadContentPages();
  const legalSlugs = new Set(registry.legal.map((entry) => entry.spa));
  const extraSpaRoutes = new Set([
    ...rawPages.map((page) => page.route),
    ...registry.legal.map((entry) => entry.spa),
  ]);

  let linkCount = 0;
  let spaLinks = 0;
  let phpLinks = 0;

  for (const { where, href, label } of [...walkMenus(registry), ...walkFooter(registry), ...walkUtility(registry)]) {
    linkCount++;
    if (!href || (!href.spa && !href.php)) {
      fail(`${where}: "${label}" has no destination on any surface.`);
      continue;
    }
    if (href.spa) {
      spaLinks++;
      if (!spaTargetExists(href.spa, routes, tools, legalSlugs, extraSpaRoutes)) {
        fail(`${where}: "${label}" → ${href.spa} is not a route this app serves.`);
      }
    }
    if (href.php) {
      phpLinks++;
      if (!phpTargetExists(href.php, pages, phpToolRoutes)) {
        fail(`${where}: "${label}" → ${href.php} does not exist and is not a WHMCS entry point.`);
      }
    }
  }

  // A menu without links is a menu that lies about having content.
  for (const menu of registry.menus) {
    const links = (menu.columns ?? []).reduce((total, column) => total + (column.items ?? []).length, 0);
    if (!menu.toolsDriven && links === 0) fail(`menu:${menu.id} has no links.`);
    if (!menu.blurb) warn(`menu:${menu.id} has no blurb; the mega panel will look empty.`);
  }

  for (const column of registry.footer) {
    if (!column.items?.length) fail(`footer:${column.title} has no links.`);
  }

  // Duplicate detection across the whole menu+footer surface: the same label pointing at the same
  // route twice is a menu that has grown by accretion, which is exactly what this rebuild removes.
  const occurrences = new Map();
  for (const { href, label } of [...walkMenus(registry), ...walkFooter(registry)]) {
    const key = `${href.spa ?? ''}|${label}`;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }

  const registryRoutes = [
    ...new Set(
      registry.menus.flatMap((menu) => [
        menu.href?.spa,
        ...(menu.columns ?? []).flatMap((column) => (column.items ?? []).map((item) => item.href.spa)),
      ])
    ),
  ].filter(Boolean);

  const contentPages = validatePages(rawPages, routes, tools, registryRoutes, legalSlugs);
  const docs = buildDocsIndex();

  const report = {
    registryVersion: registry.version,
    generatedAtSource: 'shared/site/registry.json',
    menus: registry.menus.length,
    footerColumns: registry.footer.length,
    linksChecked: linkCount,
    spaLinks,
    phpLinks,
    spaRoutesKnown: [...routes].filter((route) => !route.includes(':')).length,
    toolPathsKnown: tools.size,
    phpPagesKnown: pages.size,
    legalDocuments: registry.legal.length,
    toolsCategories: registry.toolsCategories.length,
    marketingPages: contentPages.length,
    marketingSections: contentPages.reduce((total, page) => total + (page.sections?.length ?? 0), 0),
    faqs: contentPages.reduce((total, page) => total + (page.faqs?.length ?? 0), 0),
    toolsIndexed: null,
    documentationFiles: docs.index.length,
    documentationBytes: docs.copied.reduce((total, doc) => total + doc.markdown.length, 0),
    assetsCopied: 0, // filled in by the write phase, once the illustration copy has run
    errors,
    warnings,
  };

  if (errors.length) {
    process.stderr.write(`\n✖ registry validation failed (${errors.length}):\n`);
    for (const error of errors) process.stderr.write(`  - ${error}\n`);
    process.exit(1);
  }

  if (checkOnly) {
    process.stdout.write(`✓ registry valid — ${linkCount} links (${spaLinks} app, ${phpLinks} PHP)\n`);
    return;
  }

  const emitted = emitRegistryTs(
    registry,
    [...routes].filter((route) => !route.startsWith('PREFIX:') && !route.startsWith('PATTERN:')).sort(),
    contentPages.map((page) => page.route).sort()
  );
  for (const target of TS_OUT) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, emitted);
  }

  // SPA page content, documentation index and the published markdown itself.
  mkdirSync(dirname(PAGES_OUT), { recursive: true });
  writeFileSync(PAGES_OUT, `${json({ version: registry.version, pages: contentPages })}\n`);
  writeFileSync(TOOLS_OUT, `${json({ version: registry.version, tools: publicTools() })}\n`);
  writeFileSync(DOCS_OUT, `${json({ version: registry.version, documents: docs.index })}\n`);
  // The legal extractor writes to shared/; the application imports it from its own tree.
  if (!existsSync(LEGAL_GENERATED)) {
    fail('legal.generated.json is missing — run: node scripts/site/extract-legal.mjs');
  } else {
    copyFileSync(LEGAL_GENERATED, LEGAL_OUT);
  }

  mkdirSync(DOCS_PUBLIC, { recursive: true });
  for (const doc of docs.copied) {
    writeFileSync(join(DOCS_PUBLIC, `${doc.slug}.md`), doc.markdown);
  }

  // One design system, two delivery surfaces. The WHMCS theme gets a copy so its document root
  // never reaches outside itself; the banner in the copy says where the source lives.
  const designSystem = readFileSync(DESIGN_SYSTEM, 'utf8');
  writeFileSync(
    DESIGN_SYSTEM_COPY,
    `/* GENERATED COPY of shared/site/design-system.css — edit the source, then run:\n`
    + `   node scripts/site/generate.mjs\n`
    + `   Do not edit this file; the next generation run overwrites it. */\n`
    + designSystem
  );

  // The illustration library is served by both surfaces from one directory. The SPA gets a copy
  // under /media/ so its document root stays self-contained; the copy is generated, never edited.
  let assetCount = 0;
  const copyAssets = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      const target = join(to, entry.name);
      if (entry.isDirectory()) copyAssets(source, target);
      else if (/\.(svg|webp|png|ico|webmanifest)$/i.test(entry.name)) {
        writeFileSync(target, readFileSync(source));
        assetCount += 1;
      }
    }
  };
  copyAssets(ASSET_SOURCE, ASSET_PUBLIC);
  report.assetsCopied = assetCount;

  const previousSiteJson = JSON.parse(readFileSync(PHP_SITE_JSON, 'utf8'));
  const nextSiteJson = emitPhpSiteJson(registry, previousSiteJson);
  writeFileSync(PHP_SITE_JSON, `${json(nextSiteJson)}\n`);

  mkdirSync(dirname(REPORT_OUT), { recursive: true });
  writeFileSync(REPORT_OUT, `${json(report)}\n`);

  process.stdout.write(
    `✓ registry v${registry.version} → ${registry.menus.length} mega menus, ${registry.footer.length} footer columns, `
    + `${linkCount} links validated (${spaLinks} app / ${phpLinks} PHP)\n`
  );
  process.stdout.write(
    `✓ content → ${contentPages.length} marketing pages, `
    + `${report.marketingSections} sections, ${report.faqs} FAQs, `
    + `${docs.index.length} published documents (${Math.round(report.documentationBytes / 1024)} KB)\n`
  );
  for (const warning of warnings) process.stderr.write(`  ! ${warning}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
