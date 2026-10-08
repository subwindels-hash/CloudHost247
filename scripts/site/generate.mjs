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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
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

/**
 * 3D raster illustrations sit next to the SVG diagrams (`family/name-3d.jpg`). A page prefers
 * an exact match, then a family fallback, then the homepage infrastructure scene. Missing files
 * are never published: `resolveVisual3d` returns an empty string and the template falls back to SVG.
 */
const FAMILY_3D = {
  hosting: 'hosting/web-hosting-3d',
  cloud: 'cloud/vps-3d',
  servers: 'servers/dedicated-servers-3d',
  domains: 'domains/domain-network-3d',
  applications: 'applications/application-stack-3d',
  deployment: 'deployment/deployment-pipeline-3d',
  tools: 'tools/hero-3d',
  security: 'hero/infrastructure-3d',
  management: 'servers/dedicated-servers-3d',
  'operating-systems': 'cloud/vps-3d',
  blog: 'hero/infrastructure-3d',
  hero: 'hero/infrastructure-3d',
};

function has3dAsset(key) {
  return ['.jpg', '.jpeg', '.webp', '.png'].some((ext) => existsSync(join(ASSET_SOURCE, `${key}${ext}`)));
}

export function resolveVisual3d(visual) {
  if (!visual || typeof visual !== 'string') return '';
  const exact = `${visual}-3d`;
  if (has3dAsset(exact)) return exact;
  const family = visual.split('/')[0];
  const fallback = FAMILY_3D[family];
  if (fallback && has3dAsset(fallback)) return fallback;
  if (has3dAsset('hero/infrastructure-3d')) return 'hero/infrastructure-3d';
  return '';
}

function attachVisual3d(pages) {
  for (const page of pages) {
    const visual3d = resolveVisual3d(page.visual);
    if (visual3d) page.visual3d = visual3d;
    for (const section of page.sections ?? []) {
      if (!section.visual) continue;
      const section3d = resolveVisual3d(section.visual);
      if (section3d) section.visual3d = section3d;
    }
  }
}
const DESIGN_SYSTEM = join(ROOT, 'shared', 'site', 'design-system.css');
const DESIGN_SYSTEM_COPY = join(ROOT, 'templates', 'cloudhost247', 'css', 'design-system.css');
const REPORT_OUT = join(ROOT, 'shared', 'site', 'generated', 'route-report.json');
/**
 * The PHP/WHMCS document root's crawl guidance. Generated from the same registry policy as the
 * Node platform's `/robots.txt` so the two surfaces cannot give a crawler contradictory advice —
 * and so a path added to the policy appears in both without anybody remembering to edit a file.
 */
const ROBOTS_TXT = join(ROOT, 'robots.txt');

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
  // docs/NODE_PLATFORM_STATUS.md is deliberately NOT published: it is the internal phase-acceptance
  // ledger and references branch names, pull requests, commit hashes and unexecuted migrations.
  // It stays in the repository for engineers; a public reader has no use for it and a customer
  // cannot act on it.
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
/**
 * Paths a licensed WHMCS installation always has, but this repository does not track: the admin
 * directory is renamed during installation, so it cannot be probed on disk. They stay excludable by
 * name, and the release gate re-checks that they are still excluded.
 */
const WHMCS_MANAGED_PATHS = new Set(['admin/']);

/** The PHP theme's projection of the app catalogue; the tools taxonomy is checked against both. */
const PHP_TOOLS_JSON = join(ROOT, 'modules', 'addons', 'cloudhost247_theme', 'resources', 'tools.json');

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

function emitRegistryTs(registry, spaRoutePatterns, marketingRoutes, publicDocRoutes, publicToolRoutes) {
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
    // Mirror of the PHP projection below: an item declares the surfaces it exists on, so this
    // projection only ever emits destinations the SPA actually serves. Falling back to `href.php`
    // here would fabricate a router path out of a PHP script name — a nav link the SPA cannot
    // render. Columns left empty by that filter are dropped, which is also what keeps a
    // tools-driven menu free of static groups: the SPA fills that panel from the live catalogue.
    const columns = (menu.columns ?? [])
      .map((column) => ({
        title: column.title,
        links: (column.items ?? [])
          .filter((item) => item.href.spa)
          .map((item) => ({
            label: item.label,
            to: item.href.spa,
            description: item.desc ?? '',
            icon: item.icon ?? 'wrench',
            ...(item.badge ? { badge: item.badge } : {}),
          })),
      }))
      .filter((column) => column.links.length > 0);
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
    // Same rule as the menus: the SPA footer only carries destinations the SPA router serves.
    links: (column.items ?? [])
      .filter((item) => item.href.spa)
      .map((item) => ({
        label: item.label,
        to: item.href.spa,
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

/** Public documentation routes built from the same published-doc list as the Docs index. */
export const PUBLIC_DOC_ROUTES: string[] = ${json(publicDocRoutes)};

/** Public tool routes taken from the live tool catalogue; account-only tools are excluded. */
export const PUBLIC_TOOL_ROUTES: string[] = ${json(publicToolRoutes)};

/** Every route the registry publishes, in menu order — the sitemap and audits read this. */
export const REGISTRY_ROUTES: string[] = ${json([
    '/',
    ...registry.menus.map((menu) => menu.href?.spa).filter(Boolean),
    ...new Set(registry.menus.flatMap((menu) => (menu.columns ?? []).flatMap((column) => (column.items ?? []).map((item) => item.href.spa))).filter(Boolean)),
  ])};
`;
}

/** site.json keeps its rich page-content map; only navigation and footer are generated. */
/**
 * Route → PHP file, taken from the registry's own dual-destination links. A content page can
 * therefore inherit the rich copy written for the application on the PHP page that covers the same
 * product, without either surface maintaining a second copy of it.
 */
function phpRouteMap(registry) {
  const map = new Map();
  const visit = (href) => {
    if (href?.spa && href?.php && !href.php.includes('?')) {
      map.set(href.spa, href.php.replace(/^\.?\//, '').replace(/#.*$/, ''));
    }
  };
  for (const menu of registry.menus) {
    visit(menu.href);
    visit(menu.featured?.href);
    for (const column of menu.columns ?? []) for (const item of column.items ?? []) visit(item.href);
  }
  for (const column of registry.footer) for (const item of column.items) visit(item.href);
  return map;
}

/**
 * Fold the marketing page content into the PHP theme registry.
 *
 * The PHP pages render `$ch247Site.page.{headline,features,uses,related,faqs}`. Those keys were
 * previously authored separately (and thinly); now they are derived from the same content the
 * application renders, so a product page says the same thing on both sites and there is one place
 * to correct it.
 *
 * Only the PHP pages that exist are touched, and only additive keys plus the SEO description. The
 * page's own `visual`, `slug` and `category` stay as the theme registry defined them.
 */
/**
 * Section types the PHP surface renders statically. The others in the content model need live data
 * the PHP page does not have (a product catalogue, the documentation index, DNS status, news), so
 * they are deliberately not projected: publishing a heading with nothing under it would be worse
 * than omitting the section.
 */
const PHP_SECTION_TYPES = new Set(['features', 'cards', 'steps', 'checks', 'split', 'note']);

/** Icon assets a projected card may reference, keyed by the content model's icon name. */
function contentIconAssets() {
  if (contentIconAssets.cache) return contentIconAssets.cache;
  const families = readdirSync(ASSET_SOURCE).filter((entry) => existsSync(join(ASSET_SOURCE, entry, `${entry}.svg`)) === false);
  const index = new Map();
  for (const family of families) {
    const dir = join(ASSET_SOURCE, family);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.svg')) continue;
      const name = file.slice(0, -4);
      // `icons/cloud.svg` wins over `cloud/cloud.svg`: the icon family is the one drawn for cards.
      if (!index.has(name) || family === 'icons') index.set(name, `${family}/${name}.svg`);
    }
  }
  contentIconAssets.cache = index;
  return index;
}

/**
 * Every registry destination that pairs an app route with a PHP file, including the fragment the
 * PHP URL promises (`deployments.php#environments`). Menu order is preserved because it is also
 * the order the navigation presents the destinations in.
 */
function phpRoutePairs(registry) {
  const pairs = [];
  const seen = new Set();
  const visit = (href) => {
    if (!href?.spa || !href?.php) return;
    const [file, fragment = ''] = href.php.replace(/^\.?\//, '').split('#');
    if (!file || file.includes('?')) return;
    const key = `${href.spa}->${file}#${fragment}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ spa: href.spa, file, fragment });
  };
  for (const menu of registry.menus) {
    visit(menu.href);
    visit(menu.featured?.href);
    for (const column of menu.columns ?? []) for (const item of column.items ?? []) visit(item.href);
  }
  for (const column of registry.footer) for (const item of column.items) visit(item.href);
  for (const value of Object.values(registry.utility ?? {})) visit(value);
  return pairs;
}

/** `id="…"` values a template declares, following its one level of theme includes. */
function templateAnchors(name, seen = new Set()) {
  const anchors = new Set();
  if (seen.has(name)) return anchors;
  seen.add(name);
  const file = join(ROOT, 'templates', 'cloudhost247', `${name}.tpl`);
  if (!existsSync(file)) return anchors;
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/id="([A-Za-z][\w-]*)"/g)) anchors.add(match[1]);
  for (const match of source.matchAll(/\{include file="cloudhost247\/([^"]+)\.tpl"\}/g)) {
    for (const anchor of templateAnchors(match[1], seen)) anchors.add(anchor);
  }
  return anchors;
}

/** The Smarty template a root PHP page renders, read from its own `setTemplate()` call. */
function pageTemplate(file) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return '';
  const match = readFileSync(path, 'utf8').match(/setTemplate\(\s*'([^']+)'\s*\)/);
  return match ? match[1] : '';
}

/**
 * A fragment is a promise: `deployments.php#environments` says the page has an environments
 * section. Nothing verified those promises, and nine of them were empty — the visitor landed at
 * the top of the page. This check resolves the page's template (and the anchors its folded
 * registry sections declare) and fails on a fragment with no target.
 */
function validateFragments(pairs, pages) {
  const checked = new Map();
  for (const pair of pairs) {
    if (!pair.fragment) continue;
    const key = `${pair.file}#${pair.fragment}`;
    if (checked.has(key)) continue;
    let targets = new Set();
    const template = pageTemplate(pair.file);
    if (template) targets = templateAnchors(template);
    for (const section of pages[pair.file]?.sections ?? []) {
      if (section.anchor) targets.add(section.anchor);
    }
    if (!targets.has(pair.fragment)) {
      fail(`${key} is published by the navigation (via ${pair.spa}) but ${pair.file} has no "${pair.fragment}" anchor.`);
    }
    checked.set(key, true);
  }
}

/**
 * The ordered narrative of a content page, filtered to what a server-rendered page can show and
 * validated so a projection can never publish half a section.
 *
 * Types that need live data the PHP page does not have (a product catalogue, DNS status, the
 * documentation index, news) are deliberately absent: a heading with nothing under it is worse than
 * no section at all. Card links are resolved to the PHP surface or dropped, and card icons are
 * resolved to real asset files or dropped, so the rendered grid can contain neither a dead link nor
 * a broken image.
 */
function projectSections(content, file, routeMap) {
  const where = file;
  const phpTarget = (route) => {
    if (!route || typeof route !== 'string') return '';
    const mapped = routeMap.get(route);
    if (mapped) return mapped;
    const candidate = `${route.split('/').filter(Boolean).slice(-1)[0] ?? ''}.php`;
    return existsSync(join(ROOT, candidate)) ? candidate : '';
  };
  const sections = [];
  for (const section of content.sections ?? []) {
    if (!PHP_SECTION_TYPES.has(section.type)) continue;
    const heading = clean(section.heading);
    if (!heading) {
      fail(`${where}: a ${section.type} section has no heading.`);
      continue;
    }
    const projected = { type: section.type, heading };
    if (section.kicker) projected.kicker = clean(section.kicker);
    if (section.lede) projected.lede = clean(section.lede);

    if (section.type === 'split') {
      const paragraphs = (Array.isArray(section.body) ? section.body : [section.body]).map(clean).filter(Boolean);
      if (paragraphs.length === 0) {
        fail(`${where}: the split section "${heading}" has no body.`);
        continue;
      }
      projected.body = paragraphs;
      projected.points = (section.points ?? []).map(clean).filter(Boolean).slice(0, 5);
      if (section.visual) {
        if (!existsSync(join(ASSET_SOURCE, `${section.visual}.svg`))) {
          fail(`${where}: split section illustration assets/images/cloudhost247/${section.visual}.svg does not exist.`);
          continue;
        }
        projected.visual = section.visual;
        const visual3d = resolveVisual3d(section.visual);
        if (visual3d) projected.visual3d = visual3d;
      }
      const url = phpTarget(section.link?.to);
      if (url && section.link?.label) projected.link = { label: clean(section.link.label), url };
      else if (section.link?.to) warn(`${where}: the split link "${section.link.to}" has no PHP destination and was dropped.`);
    } else if (section.type === 'note') {
      const note = clean(section.body);
      if (!note) {
        fail(`${where}: the note section "${heading}" has no body.`);
        continue;
      }
      projected.body = [note];
    } else {
      const items = [];
      for (const item of section.items ?? []) {
        const title = clean(item.label ?? item.title);
        if (!title) continue;
        const entry = { title };
        const body = clean(item.body);
        if (body) entry.body = body;
        const url = phpTarget(item.to);
        if (url) entry.url = url;
        const icon = item.icon ? contentIconAssets().get(item.icon) : '';
        if (icon) entry.icon = icon;
        items.push(entry);
        if (section.type !== 'checks' && items.length >= 9) break;
      }
      if (items.length === 0) {
        warn(`${where}: the ${section.type} section "${heading}" projected no cards.`);
        continue;
      }
      projected.items = items;
    }
    sections.push(projected);
  }
  return sections;
}

function decoratePhpPages(previous, contentPages, registry) {
  const byRoute = new Map(contentPages.map((page) => [page.route, page]));
  const icons = contentIconAssets();
  const routeMap = phpRouteMap(registry);
  const matched = new Set();
  /** Primary content route -> the PHP file that renders it. See the guard in the loop below. */
  const primaryRouteOwners = new Map();

  /**
   * Several app routes can share one PHP page — `/domains/club` and `/domains/auctions` both land on
   * `domain.php`, `/developers/deployment` and `/developers/environments` both land on
   * `deployments.php`. The page therefore renders the union of their sections, in registry order,
   * and the destination's fragment becomes the anchor that group is reachable at.
   */
  const pairsByFile = new Map();
  for (const pair of phpRoutePairs(registry)) {
    if (!pairsByFile.has(pair.file)) pairsByFile.set(pair.file, []);
    pairsByFile.get(pair.file).push(pair);
  }

  const pages = {};
  for (const [file, existing] of Object.entries(previous.pages ?? {})) {
    // Find the content pages for this PHP file: through the registry's paired links first, then by
    // slug, because some PHP pages are named after the product rather than the route.
    let group = (pairsByFile.get(file) ?? [])
      .map((pair) => ({ pair, content: byRoute.get(pair.spa) }))
      .filter((entry) => entry.content);
    let content = group[0]?.content;
    if (!content) {
      content = contentPages.find((page) => {
        const last = page.route.split('/').filter(Boolean).slice(-1)[0] ?? '';
        return existing.slug === last
          || existing.slug === `${last}-hosting`
          || page.route === `/${existing.slug}`;
      });
      group = content ? [{ pair: { spa: content.route, file, fragment: '' }, content }] : [];
    }
    if (!content) {
      const visual3d = resolveVisual3d(existing.visual);
      pages[file] = visual3d ? { ...existing, visual3d } : existing;
      continue;
    }
    matched.add(file);

    /*
     * One content route may not be projected onto two PHP pages.
     *
     * The reverse is expected and supported: several app routes share one PHP page
     * (`/domains/club` and `/domains/auctions` both land on `domain.php`), because the page renders
     * the union of their sections. The other direction is never intentional. When it happens the two
     * PHP pages get the same title, the same `seo_description` and the same hero from one source —
     * so a visitor who reaches both sees one page twice, and a crawler sees duplicated metadata.
     * That is how `managed-services.php` came to publish the Server Management description: the
     * registry pointed its menu item at `/cloud/server-management` while naming `managed-services.php`
     * as its page, so both files were decorated from the same content page.
     */
    const primaryRoute = group[0]?.pair?.spa;
    if (primaryRoute) {
      if (primaryRouteOwners.has(primaryRoute)) {
        fail(
          `${file}: the content route ${primaryRoute} is already projected onto ${primaryRouteOwners.get(primaryRoute)}. ` +
          `Two PHP pages rendering one route duplicate its title, description and hero; ` +
          `give this page its own route in shared/site/content/ and point the registry at it.`
        );
      }
      primaryRouteOwners.set(primaryRoute, file);
    }

    const features = [];
    for (const section of content.sections) {
      if (section.type !== 'features' && section.type !== 'cards') continue;
      for (const item of section.items ?? []) {
        if (item.title && item.body && features.length < 9) features.push([item.title, item.body]);
      }
    }
    const uses = [];
    for (const section of content.sections) {
      if (section.type !== 'checks') continue;
      for (const item of section.items ?? []) {
        if ((item.label || item.title) && uses.length < 6) uses.push(item.label ?? item.title);
      }
    }
    /*
     * Related services, projected from SPA routes onto the PHP surface.
     *
     * Two routes can name the same PHP file — `/cloud/backups` and `/hosting/backups` both render
     * `backups.php` — so an honestly authored "related" list can still project onto the page
     * itself. That is not a self-link the author wrote, but it is one the visitor would see, so the
     * projection drops it here. `validatePages` fails on the authored form, which is the mistake a
     * person can actually make and fix.
     */
    const related = (content.related ?? [])
      .map((route) => routeMap.get(route) ?? `${route.split('/').filter(Boolean).slice(-1)[0]}.php`)
      .filter((php) => php && php !== file && Object.prototype.hasOwnProperty.call(previous.pages, php));

    // Internal destinations are resolved to the PHP surface or dropped: a card link that only
    // works inside the single-page app would be a dead link on the page that renders it.
    const phpTarget = (route) => {
      if (!route || typeof route !== 'string') return '';
      const mapped = routeMap.get(route);
      if (mapped) return mapped;
      const file = `${route.split('/').filter(Boolean).slice(-1)[0] ?? ''}.php`;
      return Object.prototype.hasOwnProperty.call(previous.pages, file) ? file : '';
    };

    const sections = [];
    const seenHeads = new Set();
    for (const { pair, content: source } of group) {
      let anchor = pair.fragment;
      for (const section of projectSections(source, file, routeMap)) {
        const key = `${section.type}|${section.heading}`;
        if (seenHeads.has(key)) continue;
        seenHeads.add(key);
        if (anchor) {
          // Exactly one element carries the id the navigation promises; it is the first section of
          // the group that the fragment belongs to.
          section.anchor = anchor;
          anchor = '';
        }
        sections.push(section);
      }
      if (anchor && pair.fragment) {
        warn(`${file}: the "${pair.fragment}" anchor has no content to attach to (${pair.spa}).`);
      }
    }

    pages[file] = {
      ...existing,
      visual3d: resolveVisual3d(existing.visual) || existing.visual3d,
      headline: content.hero.heading,
      seo_description: content.description,
      features: features.length ? features : existing.features,
      uses: uses.length ? uses.slice(0, 6) : existing.uses,
      faqs: (content.faqs ?? []).map((faq) => ({ q: faq.q, a: faq.a })),
      // The recorded fallback is filtered too: a previously stored self-reference must not survive
      // a regeneration, or the defect outlives the fix that removed it from the source.
      related: (related.length ? [...new Set(related)] : (existing.related ?? []))
        .filter((php) => php && php !== file),
      // The ordered narrative the application renders, filtered to what a server-rendered page can
      // show without live data. Legacy `features`/`uses` stay for compatibility and as the fallback
      // when a page has no sections.
      sections,
    };
  }
  /*
   * The policy documents are authored once, in the registry's legal index, because that index is
   * what both surfaces publish: the SPA renders its document list from `LEGAL_INDEX`, and the theme
   * serves one PHP page per document. Without this projection those pages had no description of
   * their own and fell back to their `summary`, which was the same formulaic sentence for nineteen
   * policies — nineteen near-identical meta descriptions, which is the case a search engine treats
   * as one page repeated. The description is now authored per document and unique.
   */
  for (const entry of registry.legal ?? []) {
    const page = pages[entry.php];
    if (page && entry.description) page.seo_description = entry.description;
  }

  /*
   * Duplicated metadata is invisible in a single page and obvious to a search engine, which is why
   * the acceptance criteria name it explicitly. Two pages sharing a title make a result list look
   * like the same page twice; two sharing a description make the CMS-worthless case worse. The
   * projection is the right place to check it: this is the last point before the text is written to
   * the theme registry, after title, description and summary have all been resolved.
   */
  const seenTitles = new Map();
  const seenDescriptions = new Map();
  for (const [file, page] of Object.entries(pages)) {
    for (const [field, seen] of [
      ['title', seenTitles],
      ['seo_description', seenDescriptions],
      ['summary', seenDescriptions],
    ]) {
      const value = page[field];
      if (!value || typeof value !== 'string') continue;
      if (seen.has(value)) {
        const previousFile = seen.get(value);
        if (previousFile !== file) {
          fail(
            `${file}: the ${field} is identical to ${previousFile}'s. Every published page needs its ` +
            `own metadata; if two pages describe the same thing, one of them is not a page.`
          );
        }
      } else {
        seen.set(value, file);
      }
    }
  }
  return { pages, matched: matched.size };
}

function emitPhpSiteJson(registry, previous, contentPages) {
  const navigation = registry.menus.map((menu) => ({
    // `id` is carried through so the PHP surface can assert the same published families the SPA
    // asserts, instead of guessing from a translated title.
    id: menu.id,
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

  const { pages, matched } = decoratePhpPages(previous, contentPages, registry);
  // Tool categories are generated too, so the PHP Tools mega menu has content before any script
  // runs. `site.js` still enriches it from the live catalogue when it can; this is the floor, not
  // the ceiling — a menu that is empty with JavaScript disabled is a broken menu.
  const toolCategories = registry.toolsCategories.map((category) => ({
    slug: category.slug,
    label: category.label,
    desc: category.desc,
    url: `tools/category/${category.slug}`,
  }));
  // The crawl policy is projected so the PHP sitemaps, robots.php and the tools shell all read
  // the same rules the Node platform reads, instead of each keeping its own list.
  return { payload: { ...previous, navigation, footer, pages, toolCategories, sitemap: registry.sitemap }, matched };
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
  // `plans` renders one product's live plans and prices from the catalogue, using the same
  // component and the same honest empty states the product pages have always used. It is separate
  // from `catalog` (which lists every product) because a product page must not show somebody
  // else's plans.
  'plans',
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
      /*
       * A page listing itself under "Related services" is a dead end dressed up as a suggestion:
       * the reader is already there and the card does nothing. The authored form is refused here.
       * The *projected* form — two SPA routes resolving to one PHP file — is dropped when the PHP
       * page is emitted instead, because that one is an artefact of the mapping rather than a
       * mistake anybody typed.
       */
      if (related === page.route) {
        fail(`${where}: related lists the page's own route (${related}); a page cannot be related to itself.`);
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
      if (section.type === 'plans' && !section.productSlug) {
        fail(`${where}/plans: a plans section needs a productSlug to know whose plans to show.`);
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
/* Crawl policy                                                         */
/* ------------------------------------------------------------------ */

/** Normalises a registry policy entry or destination to a comparable path. */
function policyPath(value) {
  const path = String(value ?? '').trim().split(/[?#]/, 1)[0];
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * The PHP-surface counterpart of the SPA exclusion policy. Both lists live in the registry
 * because they describe the same product decision — what a crawler should not index — even
 * though the two surfaces name different files for it.
 */
function phpExclusions(registry, pages) {
  const excluded = (registry.sitemap?.excludePhp ?? []).map((entry) => String(entry).replace(/^\.?\/+/, ''));
  if (excluded.length === 0) fail('sitemap.excludePhp is empty — the PHP surface would advertise every internal path.');

  for (const entry of excluded) {
    const probe = entry.replace(/\/$/, '');
    const isDirectory = entry.endsWith('/') && existsSync(join(ROOT, probe));
    const isFile = existsSync(join(ROOT, probe));
    const isWhmcs = WHMCS_ENTRY_POINTS.has(probe);
    const isManaged = WHMCS_MANAGED_PATHS.has(entry) || WHMCS_MANAGED_PATHS.has(probe);
    if (!isDirectory && !isFile && !isWhmcs && !isManaged) {
      fail(`sitemap.excludePhp lists "${entry}", which is neither a file, a directory, nor a licensed WHMCS path.`);
    }
  }
  return excluded;
}

/** A registry destination is private when the policy covers it, on either surface. */
function isPrivatePath(path, registry) {
  const candidate = policyPath(path);
  if (candidate === '') return false; // the homepage is never private
  if (!candidate) return true;
  const rules = [...(registry.sitemap?.exclude ?? []), ...(registry.sitemap?.excludePhp ?? []).map((entry) => `/${String(entry).replace(/^\.?\/+/, '')}`)];
  return rules.map(policyPath).some((rule) => {
    if (!rule) return false;
    const bare = rule.endsWith('/') ? rule.slice(0, -1) : rule;
    return candidate === bare || candidate === `${bare}/` || candidate.startsWith(`${bare}/`) || rule.endsWith('/') && candidate.startsWith(rule);
  });
}

/**
 * Every PHP URL the deployment publishes to a crawler: the homepage, every registered public page,
 * and every registry destination that lands on the PHP surface. Computed here so the generator can
 * prove that the policy and the sitemap agree instead of trusting that they do.
 */
function publicPhpPaths(registry, pages) {
  const paths = new Set(['', ...Object.keys(pages ?? {})]);
  const visit = (href) => {
    if (!href?.php) return;
    const path = href.php.replace(/^\.?\/+/, '');
    if (path) paths.add(path);
  };
  for (const menu of registry.menus) {
    visit(menu.href);
    visit(menu.featured?.href);
    for (const column of menu.columns ?? []) for (const item of column.items ?? []) visit(item.href);
  }
  for (const column of registry.footer) for (const item of column.items ?? []) visit(item.href);
  for (const [key, value] of Object.entries(registry.utility ?? {})) visit(value);
  return [...paths].filter((path) => !isPrivatePath(path, registry));
}

/**
 * `robots.txt` for a PHP/WHMCS deployment. It is a fallback: when the Node platform owns the
 * domain root it answers `/robots.txt` itself from `SITEMAP_POLICY.exclude`, and `robots.php`
 * generates an equivalent file with absolute sitemap URLs. All four sources read this one policy.
 */
function renderRobotsTxt(registry) {
  const disallow = [
    ...(registry.sitemap?.exclude ?? []),
    ...(registry.sitemap?.excludePhp ?? []).map((entry) => `/${String(entry).replace(/^\.?\/+/, '')}`),
  ];
  const lines = [
    '# CloudHost247 — generated crawl guidance. Do not edit by hand.',
    '# Source: shared/site/registry.json (sitemap.exclude / sitemap.excludePhp).',
    '# Regenerate: node scripts/site/generate.mjs',
    '#',
    '# This static file is the FALLBACK. When the CloudHost247 Node platform owns the domain root',
    '# it answers /robots.txt itself; otherwise route robots.txt to robots.php with one rewrite rule',
    '# (infrastructure/litespeed/webroot-hardening.htaccess) to get absolute Sitemap URLs. The',
    '# specification ignores a relative Sitemap directive, so this file states none rather than',
    '# publishing a line that does nothing.',
    '#',
    '# Crawl guidance only — never an authorization mechanism. Private areas are protected by',
    '# authentication, not by this file.',
    '',
    'User-agent: *',
    ...[...new Set(disallow)].sort().map((path) => `Disallow: ${path}`),
    '',
    '# Sitemap generators on this deployment (submit their absolute URLs in your search console,',
    '# or serve robots.php so they are advertised automatically):',
    '#   /sitemap.xml              — the Node platform, from this same navigation registry',
    '#   /cloudhost247-sitemap.php — published pages and articles',
    '#   /tools-sitemap.php        — published tools',
    '#   /builder-sitemap.php      — customer sites published through the website builder',
    '',
  ];
  return lines.join('\n');
}

/**
 * Sitemap endpoints must stay fetchable. A `Disallow` covering a sitemap silently voids the
 * `Sitemap:` directive, so the policy is checked against this list on every build; the endpoints
 * carry `X-Robots-Tag: noindex` instead of being blocked.
 */
/** Trims a content string to a single-line, non-empty value (or ''). */
function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

const SITEMAP_ENDPOINTS = ['sitemap.xml', 'cloudhost247-sitemap.php', 'tools-sitemap.php', 'builder-sitemap.php'];

/** The canonical discovery taxonomy, parsed from the app catalogue that publishes the tool pages. */
function discoveryTaxonomy() {
  const source = readFileSync(TOOLS_CATALOG, 'utf8');
  const match = source.match(/export const DISCOVERY_CATEGORIES[^=]*=\s*\{([\s\S]*?)\};/);
  if (!match) {
    fail('cloudhost247-node/src/tools/catalog.ts no longer exports DISCOVERY_CATEGORIES; the tools taxonomy cannot be verified.');
    return {};
  }
  const taxonomy = {};
  for (const entry of match[1].matchAll(/(?:'([^']+)'|([A-Za-z][\w-]*))\s*:\s*'([^']*)'/g)) {
    taxonomy[entry[1] ?? entry[2]] = entry[3];
  }
  return taxonomy;
}

/**
 * One taxonomy for tool discovery. The registry is what the mega menu, the footer, the PHP theme
 * and the sitemaps read; the app catalogue is what the tool pages group by; `tools.json` is the
 * projection the PHP theme renders. If any of the three drifts, a category link published by the
 * navigation stops matching the page it opens, so this fails the build instead.
 */
function validateToolsTaxonomy(registry) {
  const app = discoveryTaxonomy();
  const published = registry.toolsCategories ?? [];
  const themeCatalogue = JSON.parse(readFileSync(PHP_TOOLS_JSON, 'utf8'));
  const themeCategories = Object.keys(themeCatalogue.categories ?? {});

  const registrySlugs = published.map((category) => category.slug);
  const appSlugs = Object.keys(app);
  const missingFromApp = registrySlugs.filter((slug) => !appSlugs.includes(slug));
  const missingFromRegistry = appSlugs.filter((slug) => !registrySlugs.includes(slug));
  if (missingFromApp.length || missingFromRegistry.length) {
    fail(
      `tools category taxonomy drifted: registry ${missingFromApp.length ? `publishes ${missingFromApp.join(', ')} which the app catalogue does not define` : 'is complete'}; ` +
        `app catalogue defines ${missingFromRegistry.length ? `${missingFromRegistry.join(', ')} which the registry does not publish` : 'nothing extra'}.`
    );
  }
  for (const category of published) {
    if (app[category.slug] && app[category.slug] !== category.label) {
      fail(`tools category "${category.slug}" is labelled "${category.label}" in the registry and "${app[category.slug]}" in the app catalogue.`);
    }
  }
  for (const slug of themeCategories) {
    if (!registrySlugs.includes(slug)) fail(`tools.json publishes the category "${slug}", which the registry does not.`);
  }
  for (const slug of registrySlugs) {
    if (!themeCategories.includes(slug)) fail(`the registry publishes the category "${slug}", which tools.json cannot render.`);
  }

  // A published category with no tools behind it is a dead-end page for a visitor and a crawler.
  const counts = {};
  for (const tool of themeCatalogue.tools ?? []) {
    for (const slug of tool.discoveryCategories ?? []) counts[slug] = (counts[slug] ?? 0) + 1;
  }
  for (const slug of registrySlugs) {
    if (!counts[slug]) fail(`the registry publishes the tools category "${slug}", but no published tool belongs to it.`);
  }
  return counts;
}

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
  /**
   * The routes the PHP Tools surface actually resolves — which is the *native* catalogue, not the app
   * one. `config/tools.php` is what `tools/lib/Catalog.php` resolves against, and `tools-public.json`
   * is its export for the tooling here; `tools.json` is the projection of the app catalogue
   * (`cloudhost247-node/src/tools/catalog.ts`), which publishes its own paths for the same
   * capabilities and forwards the PHP slugs it does not own.
   *
   * Validating PHP destinations against `tools.json` is how the Domain menu published
   * `tools/dns-health` — a path only the app catalogue knew. The SPA answered it; the tools shell
   * answered 404, and the gate passed because it was reading the wrong catalogue.
   *
   * `tools.json` still contributes its categories and collections: both surfaces publish the same
   * discovery taxonomy (asserted in `validateToolsTaxonomy`) and the same collection hubs.
   */
  const phpToolCatalogs = [
    { file: join(ROOT, 'modules', 'addons', 'cloudhost247_theme', 'resources', 'tools-public.json'),
      toolPaths: true },
    { file: join(ROOT, 'modules', 'addons', 'cloudhost247_theme', 'resources', 'tools.json'),
      toolPaths: false },
  ];
  for (const { file, toolPaths } of phpToolCatalogs) {
    if (!existsSync(file)) continue;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (toolPaths) {
      for (const tool of data.tools ?? []) {
        const path = String(tool.path ?? '').replace(/^\//, '');
        if (path) phpToolRoutes.add(path);
      }
    }
    for (const slug of Object.keys(data.categories ?? {})) phpToolRoutes.add(`tools/category/${slug}`);
    // Curated collections (e.g. Compliance & Document Tools) are hub pages the PHP tools front
    // controller serves alongside the per-tool routes, so a menu may link them exactly as it links
    // a tool. They are generated into the catalogue by scripts/generate-global-platform.py.
    for (const collection of data.collections ?? []) {
      const path = String(collection.path ?? '').replace(/^\//, '');
      if (path) phpToolRoutes.add(path);
    }
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

  /*
   * Duplicate detection across the whole menu+footer surface.
   *
   * Three rules, each a hard failure, because each is what a navigation grown by accretion looks
   * like to a visitor:
   *
   *   1. The same label pointing at the same destination twice inside one menu. A panel that
   *      offers "Web Hosting" and then "Web Hosting" again is not offering two things.
   *   2. The same destination reached under two different labels inside one footer column. That is
   *      the same defect wearing a disguise, and it doubles the crawl surface for one page.
   *   3. The same label pointing at the same destination twice inside one footer column.
   *
   * Cross-menu repeats stay allowed (Developer Hosting is a hosting product *and* a platform
   * capability, and the brief asks for it in both places), as do cross-column repeats in the
   * footer (Network and Data Centers are asked for under both "Cloud & Servers" and "Resources").
   * The featured panel is a promotional block, not a list, so it is exempt from rule 1 — it exists
   * precisely to point at the section the column then enumerates.
   */
  const menuEntries = [];
  for (const menu of registry.menus) {
    if (menu.href) menuEntries.push({ menu: menu.id, where: `menu:${menu.id}`, href: menu.href, label: menu.label, list: false });
    for (const column of menu.columns ?? []) {
      for (const item of column.items ?? []) {
        menuEntries.push({ menu: menu.id, where: `menu:${menu.id}/${column.title}`, href: item.href, label: item.label, list: true });
      }
    }
  }
  const perMenu = new Map();
  for (const { menu, where, href, label } of menuEntries) {
    if (!href) continue;
    const destination = href.spa ?? href.php ?? '';
    if (!destination) continue;
    const key = `${menu}|${destination}|${label}`;
    if (perMenu.has(key)) {
      fail(`duplicate navigation link: "${label}" → ${destination} appears in ${perMenu.get(key)} and ${where}.`);
    } else {
      perMenu.set(key, where);
    }
  }

  const perFooterColumn = new Map();
  for (const column of registry.footer) {
    const seenDestination = new Map();
    for (const item of column.items ?? []) {
      const destination = item.href?.spa ?? item.href?.php ?? '';
      if (!destination) continue;
      const key = `${column.title}|${destination}`;
      if (seenDestination.has(key)) {
        fail(
          `footer column "${column.title}" links ${destination} twice: ` +
            `"${seenDestination.get(key)}" and "${item.label}" are the same page.`
        );
      } else {
        seenDestination.set(key, item.label);
      }
      const labelKey = `${column.title}|${destination}|${item.label}`;
      if (perFooterColumn.has(labelKey)) {
        fail(`duplicate footer link: "${item.label}" → ${destination} appears twice in "${column.title}".`);
      } else {
        perFooterColumn.set(labelKey, column.title);
      }
    }
  }

  /*
   * Placeholder and malformed destinations. `walkMenus`/`walkFooter` already reject a missing
   * `href`; these rules catch the destination that exists but goes nowhere a visitor can use —
   * the `#`, the empty string, the `javascript:` call, the scheme-relative URL, and the trailing
   * `/` that quietly makes a different URL out of the same page.
   */
  for (const { where, href, label } of [...walkMenus(registry), ...walkFooter(registry), ...walkUtility(registry)]) {
    for (const [surfaceName, value] of [['spa', href.spa], ['php', href.php]]) {
      if (value === undefined || value === null) continue;
      const destination = String(value);
      if (destination.trim() === '') {
        fail(`${where}: "${label}" has an empty ${surfaceName} destination.`);
      } else if (destination === '#') {
        fail(`${where}: "${label}" points at "#"; a destination must resolve to a page.`);
      } else if (/^javascript:/i.test(destination)) {
        fail(`${where}: "${label}" uses a javascript: destination.`);
      } else if (/^\/\//.test(destination)) {
        fail(`${where}: "${label}" uses a scheme-relative destination (${destination}); it inherits the request scheme and is not a first-party path.`);
      } else if (destination.length > 1 && destination.endsWith('/') && !destination.includes('?')) {
        fail(`${where}: "${label}" → ${destination} has a trailing slash; the canonical form drops it.`);
      }
    }
  }

  /*
   * Obsolete destinations. Each entry is a route that was superseded during the rebuild and still
   * resolves on some deployments, so a link to it would not 404 — it would quietly serve the old
   * page. The canonical replacement is named so the fix is unambiguous.
   */
  const OBSOLETE_DESTINATIONS = new Map([
    ['dedeicated-server.php', 'dedicated-server.php'],
    ['vps-private-cloud.php', 'vps-privatecloud.php'],
    ['vps-public-cloud.php', 'vps-publiccloud.php'],
  ]);
  for (const { where, href, label } of [...walkMenus(registry), ...walkFooter(registry), ...walkUtility(registry)]) {
    for (const value of [href.spa, href.php]) {
      if (typeof value !== 'string') continue;
      for (const [obsolete, replacement] of OBSOLETE_DESTINATIONS) {
        if (value.includes(obsolete)) {
          fail(`${where}: "${label}" uses the obsolete destination ${value}; use ${replacement}.`);
        }
      }
    }
  }

  /*
   * Casing. Paths are case-sensitive on the production filesystem, so a link whose casing differs
   * from the file it names works in development on macOS and 404s in production on Linux. Every
   * first-party PHP destination must match a real file's name exactly, and every SPA path must be
   * lower-case, which is what the router publishes.
   *
   * Licensed WHMCS entry points are skipped: the platform depends on those files but does not ship
   * them, so there is no local filename to compare against — the staging check owns that instead.
   */
  for (const { where, href, label } of [...walkMenus(registry), ...walkFooter(registry), ...walkUtility(registry)]) {
    if (typeof href.php === 'string') {
      const file = href.php.split('?')[0].split('#')[0];
      if (!file.includes('/') && /\.php$/.test(file) && !WHMCS_ENTRY_POINTS.has(file) && !pages.has(file)) {
        const suggestion = [...pages].find((name) => name.toLowerCase() === file.toLowerCase());
        fail(
          `${where}: "${label}" → ${file} does not match any file's casing` +
            (suggestion ? `; did you mean ${suggestion}?` : '.')
        );
      }
    }
    if (typeof href.spa === 'string' && href.spa !== '/' && !href.spa.startsWith('#')) {
      const path = href.spa.split(/[?#]/)[0].replace(/^\//, '');
      if (path && path !== path.toLowerCase()) {
        fail(`${where}: "${label}" → ${href.spa} is not lower-case; router paths are case-sensitive.`);
      }
    }
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
  attachVisual3d(contentPages);
  const docs = buildDocsIndex();

  /**
   * Crawl-policy validation. The PHP exclusion list is authored in the registry, so the two ways
   * it can be wrong are both checked here: an entry that matches nothing (a typo that silently
   * stops excluding something) and an entry that covers a page the deployment publishes as public
   * marketing content — the contradiction that produced a robots.txt forbidding a URL the sitemap
   * listed.
   */
  const previousSiteJson = JSON.parse(readFileSync(PHP_SITE_JSON, 'utf8'));
  const excludePhp = phpExclusions(registry, previousSiteJson.pages);
  // A destination may only promise a fragment the page it lands on actually renders. The anchors a
  // folded registry section declares count as targets, so this runs against the freshly projected
  // pages rather than the previous build's.
  validateFragments(phpRoutePairs(registry), previousSiteJson.pages ?? {});
  for (const page of Object.keys(previousSiteJson.pages ?? {})) {
    if (isPrivatePath(page, registry)) {
      fail(`sitemap policy excludes "${page}", but it is a registered public marketing page.`);
    }
  }
  const publishedPhpPaths = publicPhpPaths(registry, previousSiteJson.pages);
  for (const category of registry.toolsCategories ?? []) {
    const path = `tools/category/${category.slug}`;
    if (isPrivatePath(path, registry)) fail(`sitemap policy excludes the published tools category "${path}".`);
  }
  // Sitemaps must stay crawlable: the policy is not allowed to block its own discovery surface.
  for (const endpoint of SITEMAP_ENDPOINTS) {
    if (isPrivatePath(endpoint, registry)) {
      fail(`sitemap policy excludes "${endpoint}"; a blocked sitemap cannot be fetched and the Sitemap: directive would be ignored.`);
    }
  }
  const toolsPerCategory = validateToolsTaxonomy(registry);

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
    phpPagesEnriched: 0,
    phpSitemapPaths: publishedPhpPaths.length,
    phpCrawlExclusions: excludePhp.length,
    toolsCategoryToolCounts: toolsPerCategory,
    errors,
    warnings,
  };

  /*
   * The PHP projection runs *before* the error gate, not after it.
   *
   * This function is pure — it returns the payload that is written further down — but its
   * validation reports through `fail()`, which appends to `errors`. When it ran after the gate,
   * every check inside it was unreachable: a projection that duplicated a page, dropped an anchor
   * or emitted a heading-less section would report nothing and write the file anyway. Hoisting the
   * call is what makes those checks real; nothing is written until they pass.
   */
  const { payload: nextSiteJson, matched: phpPagesEnriched } = emitPhpSiteJson(registry, previousSiteJson, contentPages);
  report.phpPagesEnriched = phpPagesEnriched;

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
    contentPages.map((page) => page.route).sort(),
    docs.index.map((document) => document.href).sort(),
    publicTools().filter((tool) => tool.visibility === 'public').map((tool) => tool.path).sort()
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
  const publishedSlugs = new Set(docs.copied.map((doc) => `${doc.slug}.md`));
  for (const doc of docs.copied) {
    writeFileSync(join(DOCS_PUBLIC, `${doc.slug}.md`), doc.markdown);
  }
  // De-publishing a document must remove it from the build, not just from the index: a leftover
  // file is still served at /docs/<slug>.md and is still crawled.
  for (const stale of readdirSync(DOCS_PUBLIC)) {
    if (stale.endsWith('.md') && !publishedSlugs.has(stale)) {
      rmSync(join(DOCS_PUBLIC, stale));
      warn(`removed de-published documentation file frontend/public/docs/${stale}`);
    }
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
      else if (/\.(svg|webp|png|jpe?g|ico|webmanifest)$/i.test(entry.name)) {
        writeFileSync(target, readFileSync(source));
        assetCount += 1;
      }
    }
  };
  copyAssets(ASSET_SOURCE, ASSET_PUBLIC);
  report.assetsCopied = assetCount;

  writeFileSync(PHP_SITE_JSON, `${json(nextSiteJson)}\n`);

  mkdirSync(dirname(REPORT_OUT), { recursive: true });
  writeFileSync(REPORT_OUT, `${json(report)}\n`);

  // One policy, four crawl surfaces: the Node platform's dynamic /robots.txt, this static
  // fallback, robots.php and the sitemaps all derive from `registry.sitemap`.
  writeFileSync(ROBOTS_TXT, renderRobotsTxt(registry));

  process.stdout.write(
    `✓ registry v${registry.version} → ${registry.menus.length} mega menus, ${registry.footer.length} footer columns, `
    + `${linkCount} links validated (${spaLinks} app / ${phpLinks} PHP)\n`
  );
  process.stdout.write(
    `✓ content → ${contentPages.length} marketing pages, `
    + `${report.marketingSections} sections, ${report.faqs} FAQs, `
    + `${docs.index.length} published documents (${Math.round(report.documentationBytes / 1024)} KB)\n`
  );
  process.stdout.write(`✓ PHP theme → navigation, footer and ${phpPagesEnriched} product pages enriched from the shared content\n`);
  process.stdout.write(`✓ crawl policy → ${excludePhp.length} PHP exclusions, ${publishedPhpPaths.length} public PHP paths, robots.txt and site.json policy refreshed\n`);
  for (const warning of warnings) process.stderr.write(`  ! ${warning}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
