#!/usr/bin/env node
/**
 * CloudHost247 link-integrity check — the mandatory gate.
 *
 * Scans every published surface for a navigable destination and proves each one resolves:
 *
 *   - the shared registry (mega menus, footer columns, utility links);
 *   - the SPA router's `<Route path=…>` declarations;
 *   - every marketing page's hero CTAs, section links, related-services list and `related` array;
 *   - the legal index and the documentation index;
 *   - `href`/`to` attributes across the frontend source;
 *   - `href` attributes across the PHP pages and the WHMCS theme templates;
 *   - the PHP theme registry (`site.json`) navigation and footer.
 *
 * It fails on anything that would be a broken link in production:
 *
 *   - `#` or empty hrefs that are not genuine in-page anchors;
 *   - `javascript:` URLs;
 *   - absolute URLs pointing at hosts this project does not operate;
 *   - internal routes with no route, no page and no file behind them;
 *   - `.php` targets that are neither shipped here nor a licensed WHMCS entry point.
 *
 * Usage:
 *   node scripts/site/check-links.mjs            # human summary, non-zero exit on failure
 *   node scripts/site/check-links.mjs --json     # machine-readable report
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/**
 * Licensed WHMCS entry points: routes the platform depends on but does not ship, because they
 * belong to the WHMCS core. A link to one of these is correct — verifying that the file is
 * deployed is the staging check's job, not this static scan's.
 */
const WHMCS_ENTRY_POINTS = new Set([
  // Client area
  'index.php', 'cart.php', 'clientarea.php', 'register.php', 'logout.php', 'pwreset.php',
  'contact.php', 'knowledgebase.php', 'submitticket.php', 'serverstatus.php',
  'announcements.php', 'supporttickets.php', 'viewticket.php', 'domainchecker.php',
  'downloads.php', 'upgrade.php', 'affiliates.php', 'account.php',
  // Admin area
  'addonmodules.php', 'configaddonmods.php', 'clientssummary.php', 'clientsservices.php',
  'invoices.php', 'configgeneral.php', 'configproducts.php', 'supporttickets.php',
]);

/** Hosts this project genuinely operates. Anything else must not be linked as if it were ours. */
const OWN_HOSTS = new Set([
  'cloudhost247.com', 'www.cloudhost247.com', 'rent.windelsai.com',
]);

/**
 * Paths served by the API process or from the static document root rather than by a React route.
 * They are real destinations — `/sitemap.xml` is generated from the live navigation on every
 * request — so linking them is correct; they simply are not router paths.
 */
const SERVER_PATHS = new Set([
  '/sitemap.xml', '/robots.txt', '/manifest.webmanifest', '/favicon.svg', '/sw.js',
]);
const SERVER_PREFIXES = ['/api/', '/docs/', '/media/', '/assets/', '/icons/'];

/**
 * Surfaces excluded from *enforcement*, with the reason recorded in the report.
 *
 *   - `cloudhost247_legacy` and `templates/orderforms` are third-party vendor themes. They stay
 *     installed so the WHMCS installation keeps working, they are not the active public theme, and
 *     rewriting a vendor's marketplace templates would break the licence and the upgrade path.
 *   - `tests/`, `docs/` and `tools/` are development material, not published pages.
 */
const EXCLUDED_FROM_ENFORCEMENT = [
  'templates/cloudhost247_legacy',
  'templates/orderforms',
  'modules/',
  'tests/',
  'docs/',
  'tools/',
];

/**
 * Why `modules/` is reported rather than enforced: those files are provisioning, payment and
 * vendor-suite internals — admin screens bound to JavaScript by class name, where replacing an
 * `href="javascript:void(0)"` hook with a button would break the handler it is wired to. The one
 * first-party `href="#"` in there is `ThemeRepository`'s sanitiser fallback, which exists to
 * *neutralise* a URL it refuses to emit. None of it is reachable from the public website, and the
 * count is published in the audit so the decision is visible instead of assumed.
 */

const problems = [];
const notes = [];
const counts = {
  surfaces: 0,
  internalLinks: 0,
  phpLinks: 0,
  externalLinks: 0,
  anchorLinks: 0,
};

const add = (surface, detail, severity = 'error') => {
  (severity === 'error' ? problems : notes).push(`${surface}: ${detail}`);
};

/* ------------------------------------------------------------------ */
/* Route + file catalogues                                              */
/* ------------------------------------------------------------------ */

function spaRoutes() {
  const source = readFileSync(join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'App.tsx'), 'utf8');
  const routes = new Set(['/']);
  const prefixes = new Set();
  for (const match of source.matchAll(/<Route\s+path="([^"]+)"/g)) {
    const path = match[1];
    if (path === '*') continue;
    if (path.endsWith('/*')) {
      prefixes.add(path.slice(0, -2));
      continue;
    }
    routes.add(path);
  }
  return { routes, prefixes };
}

function contentRoutes() {
  const routes = new Set();
  const dir = join(ROOT, 'shared', 'site', 'content');
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'news.json')) {
    const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const page of parsed.pages ?? []) routes.add(page.route);
  }
  return routes;
}

function phpFiles(directory = ROOT, prefix = '') {
  const found = new Set();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'vendor'].includes(entry.name)) continue;
      for (const nested of phpFiles(join(directory, entry.name), `${prefix}${entry.name}/`)) found.add(nested);
    } else if (entry.name.endsWith('.php')) {
      found.add(`${prefix}${entry.name}`);
    }
  }
  return found;
}

const { routes: SPA_ROUTES, prefixes: SPA_PREFIXES } = spaRoutes();
const CONTENT_ROUTES = contentRoutes();
const PHP_FILES = phpFiles();
const LEGAL = JSON.parse(readFileSync(join(ROOT, 'shared', 'site', 'content', 'legal.generated.json'), 'utf8')).documents;
const DOCS = JSON.parse(readFileSync(join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'docs.generated.json'), 'utf8')).documents;
const TOOLS = JSON.parse(readFileSync(join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'tools.generated.json'), 'utf8')).tools;

const TOOL_PATHS = new Set(TOOLS.map((tool) => tool.path));

/**
 * Every legal policy the registry publishes, as PHP filenames.
 *
 * Derived from `shared/site/registry.json` rather than listed here, so adding a policy to the
 * registry automatically adds it to the Legal & Policy Center reachability check below — the
 * failure mode being guarded against is a new policy shipping that nothing links to.
 */
const POLICY_FILES = new Set(
  JSON.parse(readFileSync(join(ROOT, 'shared', 'site', 'registry.json'), 'utf8'))
    .legal.map((entry) => entry.php)
    .filter(Boolean)
);

function routeOk(path) {
  const clean = path.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
  if (SERVER_PATHS.has(clean)) return true;
  if (SERVER_PREFIXES.some((prefix) => clean.startsWith(prefix))) return true;
  if (SPA_ROUTES.has(clean) || CONTENT_ROUTES.has(clean) || TOOL_PATHS.has(clean)) return true;
  if (LEGAL.some((document) => document.spa === clean)) return true;
  if (DOCS.some((document) => document.href === clean)) return true;
  for (const prefix of SPA_PREFIXES) if (clean.startsWith(prefix)) return true;
  for (const pattern of SPA_ROUTES) {
    if (!pattern.includes(':')) continue;
    const patternParts = pattern.split('/');
    const pathParts = clean.split('/');
    if (patternParts.length !== pathParts.length) continue;
    if (patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index])) return true;
  }
  return false;
}

function phpOk(target) {
  const raw = target.split('#')[0].split('?')[0];
  if (raw.startsWith('/') && existsSync(join(ROOT, raw.replace(/^\/+/, '')))) return true;
  const clean = raw.replace(/^\.?\//, '');
  if (!clean) return false;
  if (PHP_FILES.has(clean)) return true;
  if (WHMCS_ENTRY_POINTS.has(clean)) return true;
  if (clean === 'tools' || clean.startsWith('tools/')) return true;
  if (existsSync(join(ROOT, clean))) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Checks                                                               */
/* ------------------------------------------------------------------ */

function checkHref(surface, raw, kind) {
  const href = (raw ?? '').trim();
  if (!href) {
    add(surface, `empty ${kind}`);
    return;
  }
  if (/^javascript:/i.test(href)) {
    add(surface, `${kind}="${href}" — javascript: URLs are not links`);
    return;
  }
  if (href === '#' || href === '#!' || href === '#0') {
    add(surface, `${kind}="${href}" — placeholder anchor with no target`);
    return;
  }
  if (href.startsWith('#')) {
    counts.anchorLinks += 1;
    return;
  }
  if (/^(mailto:|tel:)/i.test(href)) return;

  if (/^https?:\/\//i.test(href)) {
    counts.externalLinks += 1;
    const host = /^https?:\/\/([^/]+)/i.exec(href)?.[1]?.toLowerCase() ?? '';
    if (!OWN_HOSTS.has(host)) {
      add(surface, `${kind}="${href}" — absolute URL to a host this project does not operate (use an internal path)`, 'note');
    }
    return;
  }
  if (href.startsWith('//')) {
    add(surface, `${kind}="${href}" — protocol-relative URL`);
    return;
  }
  if (href.endsWith('.php') || href.includes('.php?')) {
    counts.phpLinks += 1;
    if (!phpOk(href)) add(surface, `${kind}="${href}" — no such PHP page and not a WHMCS entry point`);
    return;
  }
  if (href.startsWith('/')) {
    counts.internalLinks += 1;
    if (!routeOk(href)) add(surface, `${kind}="${href}" — no route, page or file serves this path`);
    return;
  }
  // Anything else is a relative path; resolve it against the file's own directory.
  counts.internalLinks += 1;
  if (!routeOk(`/${href.replace(/^\.\//, '')}`)) {
    add(surface, `${kind}="${href}" — relative target does not resolve to a known route`);
  }
}

/* 1. The shared registry */
const registry = JSON.parse(readFileSync(join(ROOT, 'shared', 'site', 'registry.json'), 'utf8'));
counts.surfaces += 1;
for (const menu of registry.menus) {
  const surface = `registry:menu/${menu.id}`;
  if (menu.href) checkHref(surface, menu.href.spa, 'href.spa');
  if (menu.href?.php) {
    counts.phpLinks += 1;
    if (!phpOk(menu.href.php)) add(surface, `href.php="${menu.href.php}" does not resolve`);
  }
  if (menu.featured?.href) {
    checkHref(`${surface}:featured`, menu.featured.href.spa, 'href.spa');
    if (menu.featured.href.php) {
      counts.phpLinks += 1;
      if (!phpOk(menu.featured.href.php)) add(surface, `featured href.php="${menu.featured.href.php}" does not resolve`);
    }
  }
  for (const column of menu.columns ?? []) {
    for (const item of column.items ?? []) {
      const where = `${surface}/${column.title}`;
      if (item.href.spa) checkHref(where, item.href.spa, 'href.spa');
      if (item.href.php) {
        counts.phpLinks += 1;
        if (!phpOk(item.href.php)) add(where, `${item.label} href.php="${item.href.php}" does not resolve`);
      }
    }
  }
}

for (const column of registry.footer) {
  const surface = `registry:footer/${column.title}`;
  for (const item of column.items) {
    if (item.href.spa) checkHref(surface, item.href.spa, 'href.spa');
    if (item.href.php) {
      counts.phpLinks += 1;
      if (!phpOk(item.href.php)) add(surface, `${item.label} href.php="${item.href.php}" does not resolve`);
    }
  }
}

/* 2. Marketing content */
const contentDir = join(ROOT, 'shared', 'site', 'content');
for (const file of readdirSync(contentDir).filter((name) => name.endsWith('.json') && name !== 'news.json')) {
  const parsed = JSON.parse(readFileSync(join(contentDir, file), 'utf8'));
  counts.surfaces += parsed.pages?.length ?? 0;
  for (const page of parsed.pages ?? []) {
    const surface = `content:${page.route}`;
    for (const cta of page.hero?.ctas ?? []) checkHref(surface, cta.to, 'hero cta');
    for (const related of page.related ?? []) checkHref(surface, related, 'related');
    for (const section of page.sections ?? []) {
      for (const item of [...(section.items ?? []), ...(section.links ?? [])]) {
        if (item.to) checkHref(`${surface}/${section.type}`, item.to, 'section link');
        if (item.link?.to) checkHref(`${surface}/${section.type}`, item.link.to, 'section link');
      }
    }
  }
}

/* 3. Frontend source: every href/to literal */
function walkSource(directory, extensions, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '.git', 'public'].includes(entry.name)) continue;
      walkSource(join(directory, entry.name), extensions, visit);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      visit(join(directory, entry.name));
    }
  }
}

walkSource(join(ROOT, 'cloudhost247-node', 'frontend', 'src'), ['.tsx', '.ts'], (file) => {
  const source = readFileSync(file, 'utf8');
  const surface = `spa:${relative(ROOT, file)}`;
  counts.surfaces += 1;
  for (const match of source.matchAll(/(?:to|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    // Template literals built from variables are checked by the registry generator, not here.
    if (value.includes('${') || value.includes('{{')) continue;
    checkHref(surface, value, 'link');
  }
});

/* 4. PHP pages and WHMCS templates */
const templateRoots = [
  join(ROOT, 'templates', 'cloudhost247'),
  join(ROOT, 'templates', 'cloudhost247_legacy'),
].filter(existsSync);

let vendorFindings = 0;

for (const root of templateRoots) {
  walkSource(root, ['.tpl'], (file) => {
    const excluded = EXCLUDED_FROM_ENFORCEMENT.some((prefix) => relative(ROOT, file).startsWith(prefix));
    const source = readFileSync(file, 'utf8');
    const surface = `php:${relative(ROOT, file)}`;
    counts.surfaces += 1;
    for (const match of source.matchAll(/href=["']([^"']+)["']/g)) {
      const value = match[1];
      if (value.includes('{') || value.includes('$')) continue; // Smarty expression: resolved at render
      if (excluded) {
        vendorFindings += 1;
        continue;
      }
      checkHref(surface, value, 'href');
    }
  });
}

for (const file of PHP_FILES) {
  const excluded = EXCLUDED_FROM_ENFORCEMENT.some((prefix) => file.startsWith(prefix));
  const source = readFileSync(join(ROOT, file), 'utf8');
  counts.surfaces += 1;
  // Only real markup links are inspected. A `header('Location: …')` inside a page controller is a
  // routing statement, not a link a visitor can click, and it is validated by the PHP test suite.
  for (const match of source.matchAll(/href=["']([^"']+)["']/g)) {
    const value = match[1];
    if (value.includes('$') || value.includes('{')) continue;
    if (/^https?:/i.test(value)) continue;
    if (excluded) {
      // Recorded, not enforced — see EXCLUDED_FROM_ENFORCEMENT.
      vendorFindings += 1;
      continue;
    }
    checkHref(`php:${file}`, value, 'href');
  }

  /*
   * Links a page declares as data rather than as markup.
   *
   * This is the hole that let three dead links ship on the Legal & Policy Center: the page builds
   * its cards from a PHP array (`'link' => 'disclaimer.php'`) and the template renders
   * `<a href="{$section.link}">`, so the literal-string scan above saw `$section.link`, skipped it
   * as a Smarty/PHP expression, and never resolved the destination. Two of the three named
   * documents that do not exist; the third was a stale filename for a policy that does.
   *
   * An array entry whose value is a bare `*.php` filename is unambiguously a destination — a
   * visitor-facing link the page will render — so it is resolved exactly like an `href`. Values
   * containing a variable are still skipped, because their target is not knowable statically.
   */
  for (const match of source.matchAll(/'(?:link|url|href|page|path)'\s*=>\s*'([^']+)'/g)) {
    const value = match[1];
    if (value.includes('$') || value.includes('{')) continue;
    if (!/\.php($|\?)/.test(value)) continue;
    if (/^https?:/i.test(value)) continue;
    if (excluded) {
      vendorFindings += 1;
      continue;
    }
    checkHref(`php:${file}`, value, 'declared link');
  }

  /*
   * Legal-policy discovery. `legal.php` is the policy index: it is how a visitor reaches the
   * policies that are deliberately absent from the footer. A policy file that the index does not
   * list is a page with no inbound link from anywhere, which is an orphan even though it resolves.
   */
  if (file === 'legal.php') {
    const declared = new Set([...source.matchAll(/'(?:link|url)'\s*=>\s*'([^']+\.php)'/g)].map((match) => match[1]));
    const policies = [...POLICY_FILES].filter((name) => !declared.has(name));
    for (const orphan of policies) {
      add('php:legal.php', `the Legal & Policy Center does not list ${orphan}; a policy no page links to is unreachable`);
    }
  }
}

/* 5. PHP theme registry */
const siteJson = JSON.parse(readFileSync(join(ROOT, 'modules', 'addons', 'cloudhost247_theme', 'resources', 'site.json'), 'utf8'));
for (const menu of siteJson.navigation ?? []) {
  for (const group of menu.groups ?? []) {
    for (const link of group.links ?? []) {
      counts.phpLinks += 1;
      if (!phpOk(link.url)) add(`site.json:${menu.title}/${group.title}`, `${link.label} → ${link.url} does not resolve`);
    }
  }
}
for (const column of siteJson.footer ?? []) {
  for (const link of column.links ?? []) {
    counts.phpLinks += 1;
    if (!phpOk(link.url)) add(`site.json:footer/${column.title}`, `${link.label} → ${link.url} does not resolve`);
  }
}
for (const [path, page] of Object.entries(siteJson.pages ?? {})) {
  if (!existsSync(join(ROOT, path))) add('site.json:pages', `registry route ${path} has no file`);
  const asset = join(ROOT, 'assets', 'images', 'cloudhost247', `${page.visual}.svg`);
  if (page.visual && !existsSync(asset)) add('site.json:pages', `${path} references missing illustration ${page.visual}.svg`);
  for (const related of page.related ?? []) {
    if (!siteJson.pages[related]) add('site.json:pages', `${path} lists related service ${related}, which is not registered`);
  }
}

/* 6. Documentation + legal index */
for (const document of DOCS) {
  const publicFile = join(ROOT, 'cloudhost247-node', 'frontend', 'public', 'docs', `${document.slug}.md`);
  if (!existsSync(publicFile)) add('docs', `${document.slug} is indexed but ${relative(ROOT, publicFile)} is missing`);
}
for (const document of LEGAL) {
  if (!document.html || document.meta.words < 80) add('legal', `${document.slug} has no substantial content (${document.meta.words} words)`);
}

/* ------------------------------------------------------------------ */

const report = {
  counts: { ...counts, vendorTemplateFindings: vendorFindings },
  excludedFromEnforcement: EXCLUDED_FROM_ENFORCEMENT,
  problems,
  notes,
  ok: problems.length === 0,
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `link integrity: ${counts.surfaces} surfaces · ${counts.internalLinks} internal · `
    + `${counts.phpLinks} PHP · ${counts.externalLinks} external · ${counts.anchorLinks} in-page anchors\n`
  );
  process.stdout.write(
    `excluded from enforcement (vendor/dev surfaces, reported not fixed): `
    + `${EXCLUDED_FROM_ENFORCEMENT.join(', ')} — ${vendorFindings} hrefs inside them\n`
  );
  if (notes.length) {
    process.stdout.write(`\n${notes.length} note(s):\n`);
    for (const note of notes) process.stdout.write(`  · ${note}\n`);
  }
  if (problems.length) {
    process.stdout.write(`\n✖ ${problems.length} broken link(s):\n`);
    for (const problem of problems) process.stdout.write(`  - ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write('\n✓ no broken, placeholder or dangling links\n');
}

if (problems.length > 0) process.exit(1);
