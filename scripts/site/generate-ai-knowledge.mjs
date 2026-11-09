#!/usr/bin/env node
/**
 * Website knowledge projection for the AI assistant.
 *
 * The AI has to know everything the public website publishes — every marketing page, tool,
 * documentation page, legal policy, announcement, product and service — and it has to learn about a
 * new one the moment it is published, with no manual prompt editing.
 *
 * Rather than crawling the live site (which on cPanel shares a domain with the Node application,
 * would re-render 300+ pages on every sync and would need network access from the worker), this
 * script projects the *same generated artefacts the website itself is built from* into one
 * deterministic JSON document read by `src/ai-website/website-discovery.ts`.
 *
 * Why that is the honest design:
 *
 *   • `shared/site/registry.json` is the single source of truth for navigation, footer, marketing
 *     routes, tool routes and legal routes — both the SPA and the PHP site are generated from it.
 *   • `frontend/src/content/pages.generated.json`, `tools.generated.json`, `docs.generated.json` and
 *     `legal.generated.json` are written by `scripts/site/generate.mjs`, which validates every route
 *     and every internal link before it writes anything.
 *   • `modules/addons/cloudhost247_theme/resources/site.json` is the PHP/WHMCS page registry,
 *     including pages that exist in PHP but not in the SPA.
 *
 * So "a page was published" and "the AI can see it" are the same event as "the site generator ran",
 * which is a build step that already exists in this repository. No new scheduler, no crawl loop.
 *
 * The one thing this script must never do is invent content. It copies text it finds and records
 * where it came from; a page with no extractable text becomes a title + description entry marked
 * `thin`, which the indexer refuses to retrieve from (a title alone is not an answer).
 *
 * Usage:
 *   node scripts/site/generate-ai-knowledge.mjs          # write the projection
 *   node scripts/site/generate-ai-knowledge.mjs --check  # fail if the committed copy is stale
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './generate.mjs';

const OUT = join(ROOT, 'cloudhost247-node', 'src', 'ai-website', 'content', 'website-knowledge.generated.json');
const REGISTRY = join(ROOT, 'shared', 'site', 'registry.json');
const CONTENT_DIR = join(ROOT, 'shared', 'site', 'content');
const PAGES = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'pages.generated.json');
const TOOLS = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'tools.generated.json');
const DOCS = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'docs.generated.json');
const LEGAL = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'legal.generated.json');
const PHP_SITE = join(ROOT, 'modules', 'addons', 'cloudhost247_theme', 'resources', 'site.json');
const DOCS_DIR = join(ROOT, 'docs');
const ANNOUNCEMENTS = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'content', 'announcements.ts');
const APP_TSX = join(ROOT, 'cloudhost247-node', 'frontend', 'src', 'App.tsx');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const read = (path) => readFileSync(path, 'utf8');

/* ---------------------------------------------------------------------------------------------- */
/* Text helpers — deliberately the same rules the indexer applies, so the projection is readable  */
/* by a human reviewer rather than a wall of markup.                                              */
/* ---------------------------------------------------------------------------------------------- */

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”' };

function decode(value) {
  return String(value).replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo);/g, (m) => ENTITIES[m] ?? m);
}

function clean(value) {
  return decode(String(value ?? ''))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function headingsOf(html) {
  const out = [];
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const text = clean(match[2]);
    if (text) out.push(text);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* Section flattening                                                                             */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Renders one marketing section as readable text. Only fields that carry copy are used; a `plans`
 * or `catalog` section is rendered as a *statement of what it shows and where the live data comes
 * from*, because the numbers themselves are read at answer time from the catalogue — copying them
 * into an index would guarantee stale prices.
 */
function renderSection(section) {
  const lines = [];
  const push = (label, value) => {
    const text = clean(value);
    if (text) lines.push(label ? `${label}: ${text}` : text);
  };
  switch (section.type) {
    case 'plans':
      push('', `This section lists the published plans and live prices for the catalogue product "${section.productSlug ?? 'shown on the page'}". Prices are read from the CloudHost247 catalogue at the time you ask; this page is the place to compare plan resources.`);
      break;
    case 'catalog':
      push('', 'This section lists the products in the CloudHost247 catalogue with their published starting prices, read live from the catalogue.');
      break;
    case 'live-locations':
      push('', 'This section lists the data-centre regions this deployment is configured to deploy into, read live from the platform.');
      break;
    case 'live-status':
      push('', 'This section shows current service status for this deployment.');
      break;
    case 'site-search':
      push('', 'This section provides site search.');
      break;
    case 'doc-index':
      push('', 'This section indexes the developer documentation.');
      break;
    case 'news':
      push('', 'This section lists the platform release notes.');
      break;
    default:
      break;
  }
  if (section.kicker) push('', section.kicker);
  if (section.heading) push('', section.heading);
  if (section.lede) push('', section.lede);
  if (section.note) push('', section.note);
  if (section.body) push('', section.body);
  for (const item of [...(section.items ?? []), ...(section.links ?? [])]) {
    if (typeof item === 'string') {
      push('', `• ${item}`);
      continue;
    }
    const title = clean(item.title ?? item.label ?? '');
    const body = clean(item.body ?? '');
    if (title || body) push('', `• ${[title, body].filter(Boolean).join(' — ')}`);
  }
  for (const row of section.rows ?? []) {
    const cells = row.map((cell) => clean(cell)).filter(Boolean);
    if (cells.length) push('', `• ${cells.join(' | ')}`);
  }
  if (Array.isArray(section.columns) && section.columns.length && !(section.rows ?? []).length) {
    push('', `Table columns: ${section.columns.map((c) => clean(c)).filter(Boolean).join(', ')}`);
  }
  for (const check of section.checks ?? []) {
    if (typeof check === 'string') push('', `• ${check}`);
  }
  for (const step of section.steps ?? []) {
    if (step && typeof step === 'object') {
      const title = clean(step.title ?? '');
      const body = clean(step.body ?? step.description ?? '');
      if (title || body) push('', `• ${[title, body].filter(Boolean).join(' — ')}`);
    } else if (typeof step === 'string') push('', `• ${step}`);
  }
  return lines.filter(Boolean).join('\n');
}

function renderMarketingPage(page) {
  const hero = page.hero ?? {};
  const lines = [];
  if (hero.kicker) lines.push(clean(hero.kicker));
  if (hero.heading) lines.push(clean(hero.heading));
  if (hero.lede) lines.push(clean(hero.lede));
  for (const point of hero.points ?? []) lines.push(`• ${clean(point)}`);
  for (const cta of hero.ctas ?? []) if (cta?.label) lines.push(`Call to action: ${clean(cta.label)}${cta.to ? ` (${cta.to})` : ''}`);
  for (const section of page.sections ?? []) {
    const rendered = renderSection(section);
    if (rendered) lines.push('', rendered);
  }
  return lines.filter((line) => line !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------------------------------------------------------------------------------------------- */
/* Sources                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Maps a SPA route to the PHP page that renders the same content, using the registry's
 * `href: { spa, php }` pairs. The mapping is read from `shared/site/registry.json`, never guessed —
 * which is why the assistant can say "this page also exists on the PHP site" and be right.
 */
function phpSiblings(registry) {
  const map = new Map();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.href && typeof node.href === 'object') {
      if (typeof node.href.spa === 'string' && typeof node.href.php === 'string') {
        map.set(node.href.spa, node.href.php);
      }
    }
    if (typeof node.spa === 'string' && typeof node.php === 'string') {
      map.set(node.spa, node.php);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(registry);
  return map;
}

/**
 * Every navigable link in the menus and footer, with the path the *browser* uses (`href.spa`) and
 * the PHP sibling. A menu entry is a verified link: `scripts/site/generate.mjs` refuses to emit a
 * registry whose destination the router does not serve.
 */
function walkRegistryLinks(registry) {
  const links = [];
  const visit = (node, trail) => {
    if (!node || typeof node !== 'object') return;
    const spa = node.href && typeof node.href === 'object' ? node.href.spa : undefined;
    if (typeof spa === 'string' && spa.startsWith('/') && typeof node.label === 'string') {
      links.push({
        to: spa,
        php: node.href && typeof node.href === 'object' && typeof node.href.php === 'string' ? node.href.php : null,
        label: clean(node.label),
        // Menu sections carry `blurb`, sub-links carry `desc`; both are the registry's own copy.
        description: clean(node.desc ?? node.blurb ?? node.description ?? node.body ?? ''),
        section: trail,
      });
    }
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) value.forEach((item) => visit(item, key === 'columns' ? trail : trail || key));
      else if (value && typeof value === 'object') visit(value, trail || key);
    }
  };
  (registry.menus ?? []).forEach((menu) => visit(menu, clean(menu.label ?? 'menu')));
  (registry.footer ?? []).forEach((column) => visit(column, `Footer — ${clean(column.title ?? '')}`));
  return links;
}

function legalDocumentsByRoute() {
  if (!existsSync(LEGAL)) return new Map();
  const documents = readJson(LEGAL).documents ?? [];
  return new Map(documents.map((document) => [document.spa, document]));
}

function docsByRoute() {
  if (!existsSync(DOCS)) return new Map();
  const documents = readJson(DOCS).documents ?? [];
  return new Map(documents.map((document) => [document.href, document]));
}

/**
 * Documentation markdown is published to the site from `docs/`, and the generated index records the
 * source file. Reading the markdown itself (rather than only the 200-character summary) is what
 * makes the assistant able to answer a real developer question about the API.
 */
function docMarkdown(source) {
  const path = join(ROOT, source);
  if (!existsSync(path)) return null;
  const markdown = read(path);
  const body = markdown
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>*+-]\s+/gm, '• ')
    .replace(/`{1,3}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return body;
}

/**
 * The four long-form PHP policies that do not exist anywhere in the SPA or the generated registry.
 * Their text lives in PHP arrays shaped `'hero' => [...], 'sections' => [ [ 'title' => '…',
 * 'content' => '…', 'items' => [ '…' ] ] ]`.
 *
 * The extractor walks the literal structure — it never evaluates PHP — and is strict on purpose:
 * it keys off the `'title'` / `'content'` / `'items'` array keys, decodes the escaped single-quoted
 * literals PHP actually uses, and drops the `'id' => 'eligibility'` style machine keys. Anything it
 * cannot parse is reported, because indexing a policy page as two lines of boilerplate is worse
 * than admitting it was not indexed.
 */
const PHP_POLICY_PAGES = [
  { file: 'refund-policy.php', key: 'php:refund-policy.php', url: '/legal/refund-policy', title: 'Refund Policy' },
  { file: 'backup-policy.php', key: 'php:backup-policy.php', url: '/legal/backup-policy', title: 'Backup Policy' },
  { file: 'cybercrime-policy.php', key: 'php:cybercrime-policy.php', url: '/legal/cybercrime-policy', title: 'Cybercrime Policy' },
  { file: 'trademark-policy.php', key: 'php:trademark-policy.php', url: '/legal/trademark-policy', title: 'Trademark Policy' },
];

/** Unescapes one PHP single-quoted string body. */
function phpLiteral(raw) {
  return raw.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

/**
 * Pulls every `'key' => 'value'` pair whose key is in `wanted` out of a PHP source block, in order.
 * Values may contain escaped single quotes; apostrophes inside prose are the common case in these
 * files ("CloudHost247 Isc." style copy is quoted with \" instead).
 */
function phpStringValues(text, wanted) {
  const values = [];
  const keys = wanted.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp("['\"](?:" + keys + ")['\"]\\s*=>\\s*'((?:[^'\\\\]|\\\\.)*)'", 'g');
  let match;
  while ((match = pattern.exec(text)) !== null) values.push(phpLiteral(match[1]));
  return values;
}

/** Values of a `'items' => [ 'a', 'b' ]` list, in order. */
function phpItemValues(text) {
  const values = [];
  const listPattern = /'items'\s*=>\s*\[([\s\S]*?)\n\s*\]/g;
  let list;
  while ((list = listPattern.exec(text)) !== null) {
    const literalPattern = /'((?:[^'\\]|\\.)*)'/g;
    let item;
    while ((item = literalPattern.exec(list[1])) !== null) {
      const value = phpLiteral(item[1]);
      // Skip machine ids like 'eligibility'; real list items are sentences.
      if (value.length >= 12 && value.includes(' ')) values.push(value);
    }
  }
  return values;
}

function readPhpPolicy(entry) {
  const path = join(ROOT, entry.file);
  if (!existsSync(path)) return null;
  const source = read(path);
  const start = source.indexOf('= [');
  const block = start >= 0 ? source.slice(start) : source;
  const titles = phpStringValues(block, ['title', 'subtitle']);
  const contents = phpStringValues(block, ['content']);
  const items = phpItemValues(block);
  const sections = block.includes("'sections'")
    ? (block.split(/\[\s*\n\s*'id'\s*=>/).length - 1)
    : 0;
  const lines = [];
  for (const title of titles.slice(0, 40)) if (title.trim()) lines.push(clean(title));
  for (const content of contents) if (content.trim()) lines.push(clean(content));
  for (const item of items) if (item.trim()) lines.push(`• ${clean(item)}`);
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body.length < 200) return null;
  return {
    title: entry.title,
    description: clean(contents[0] ?? '').slice(0, 300),
    body,
    headings: titles.map(clean).filter(Boolean).filter((title) => title !== entry.title),
    sectionCount: sections,
    itemCount: items.length,
  };
}

/**
 * The SPA's own `<Route path="…">` declarations, read exactly the way `scripts/site/generate.mjs`
 * reads them. This is how the *verified destination* list stays complete: `/domains`, `/cart`,
 * `/account/services` and the rest are real pages the router serves, but they are client-rendered
 * and authenticated, so no server-side text exists to index. Recording them as verified routes (not
 * as content) is the honest split — the assistant may link to them and must never invent their
 * contents.
 */
function appRoutes() {
  if (!existsSync(APP_TSX)) return [];
  const routes = new Set();
  for (const match of read(APP_TSX).matchAll(/<Route\s+path="([^"]+)"/g)) {
    const path = match[1];
    if (path === '*' || path.includes(':') || path.includes('/*')) continue;
    routes.add(path);
  }
  return [...routes].sort();
}

function announcementText() {
  if (!existsSync(ANNOUNCEMENTS)) return [];
  const source = read(ANNOUNCEMENTS);
  const entries = [];
  const pattern = /\{\s*(?:badge:\s*'([^']*)',\s*)?text:\s*'((?:[^'\\]|\\.)*)'(?:,\s*url:\s*'([^']*)')?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    entries.push({ badge: match[1] ?? null, text: match[2].replace(/\\'/g, "'"), url: match[3] ?? null });
  }
  return entries;
}

function newsEntries() {
  const path = join(CONTENT_DIR, 'news.json');
  if (!existsSync(path)) return [];
  return (readJson(path).entries ?? []).map((entry) => ({
    id: entry.id,
    label: entry.label ?? '',
    title: entry.title ?? '',
    summary: entry.summary ?? '',
    body: Array.isArray(entry.body) ? entry.body.join('\n') : String(entry.body ?? ''),
  }));
}

/* ---------------------------------------------------------------------------------------------- */
/* Projection                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

function build() {
  const registry = readJson(REGISTRY);
  const phpByRoute = phpSiblings(registry);
  const legalByRoute = legalDocumentsByRoute();
  const docsByHref = docsByRoute();
  const contentPages = existsSync(PAGES) ? readJson(PAGES).pages ?? [] : [];
  const tools = existsSync(TOOLS) ? readJson(TOOLS).tools ?? [] : [];
  const phpSite = existsSync(PHP_SITE) ? readJson(PHP_SITE) : { pages: {} };
  const exclude = new Set(registry.sitemap?.exclude ?? []);
  const excludePhp = registry.sitemap?.excludePhp ?? [];

  const documents = [];
  const seenKeys = new Set();
  const report = { sources: {}, skipped: [] };

  const add = (document) => {
    if (seenKeys.has(document.sourceKey)) return false;
    seenKeys.add(document.sourceKey);
    documents.push(document);
    return true;
  };

  const isExcludedSpa = (route) =>
    exclude.has(route) || [...exclude].some((rule) => rule.endsWith('/') && route.startsWith(rule));

  /* 1 — Marketing pages (the rich content set). */
  for (const page of contentPages) {
    if (isExcludedSpa(page.route) || page.noindex) {
      report.skipped.push({ key: `spa:${page.route}`, reason: 'Excluded by the site registry crawl policy' });
      continue;
    }
    const hero = page.hero ?? {};
    const faqs = (page.faqs ?? []).map((faq) => ({ question: clean(faq.q), answer: clean(faq.a) }));
    add({
      sourceKey: `spa:${page.route}`,
      url: page.route,
      aliases: phpByRoute.has(page.route) ? [`/${phpByRoute.get(page.route)}`] : [],
      title: clean(page.title),
      description: clean(page.description ?? page.seoTitle ?? ''),
      kind: legalByRoute.has(page.route) ? 'legal_document' : 'website_page',
      surface: 'spa',
      section: clean(page.category ?? ''),
      category: clean(page.category ?? ''),
      related: (page.related ?? []).map((to) => ({ label: to, url: to })),
      faqs,
      body: renderMarketingPage(page),
      headings: [clean(hero.heading), ...(hero.points ?? []).map(clean)].filter(Boolean),
    });
  }

  /* 2 — Legal documents (18 published policies, full text). */
  for (const [route, document] of legalByRoute) {
    const html = String(document.html ?? '');
    const body = clean(html);
    add({
      sourceKey: `legal:${route}`,
      url: route,
      aliases: document.php ? [`/${document.php}`] : [],
      title: clean(document.title ?? route),
      description: body.slice(0, 300),
      kind: 'legal_document',
      surface: 'spa',
      section: 'Legal',
      category: 'Legal',
      related: [],
      faqs: [],
      body,
      headings: headingsOf(html),
    });
  }

  /* 3 — Documentation (full markdown, not just the 200-character summary). */
  for (const [href, document] of docsByHref) {
    const markdown = docMarkdown(document.source);
    add({
      sourceKey: `doc:${href}`,
      url: href,
      aliases: [`/${document.source}`],
      title: clean(document.title ?? href),
      description: clean(document.summary ?? ''),
      kind: 'website_doc',
      surface: 'spa',
      section: clean(document.section ?? 'Documentation'),
      category: 'Documentation',
      related: [],
      faqs: [],
      body: markdown ?? clean(document.summary ?? ''),
      headings: (markdown ?? '')
        .split('\n')
        .filter((line) => line.length > 0 && line.length < 90 && !line.startsWith('•'))
        .slice(0, 20),
    });
  }

  /* 4 — Free tools (public only; a tool's text is its name, summary and description). */
  for (const tool of tools) {
    if (tool.visibility !== 'public') {
      report.skipped.push({ key: `tool:${tool.path}`, reason: `Tool visibility is ${tool.visibility}` });
      continue;
    }
    add({
      sourceKey: `tool:${tool.path}`,
      url: tool.path,
      aliases: [],
      title: clean(tool.name),
      description: clean(tool.description ?? ''),
      kind: 'website_tool',
      surface: 'spa',
      section: `Tools — ${clean(tool.category ?? '')}`,
      category: 'Tools',
      related: [],
      faqs: [],
      body: [clean(tool.name), clean(tool.description ?? ''), clean(tool.summary ?? '')].filter(Boolean).join('\n'),
      headings: [clean(tool.name)],
    });
  }

  /* 5 — Navigation registry: pages that exist in the menu but have no generated content entry
        (dashboard destinations, status, help, contact …). A menu entry is a real, verified link. */
  const navLinks = walkRegistryLinks(registry);
  const extraRoutes = new Set(registry.sitemap ? [] : []);
  for (const link of navLinks) {
    if (link.to.startsWith('#') || link.to.includes('://')) continue;
    if (isExcludedSpa(link.to)) continue;
    extraRoutes.add(link.to);
  }
  for (const route of [...extraRoutes].sort()) {
    if (documents.some((document) => document.url === route)) continue;
    const link = navLinks.find((candidate) => candidate.to === route);
    add({
      sourceKey: `nav:${route}`,
      url: route,
      aliases: link?.php ? [`/${link.php}`] : phpByRoute.has(route) ? [`/${phpByRoute.get(route)}`] : [],
      title: link?.label ?? route,
      description: link?.description || `CloudHost247 ${link?.label ?? route} — navigation destination.`,
      kind: 'website_page',
      surface: 'registry',
      section: link?.section ? clean(link.section) : 'Navigation',
      category: 'Navigation',
      related: [],
      faqs: [],
      body: [link?.label, link?.description].filter(Boolean).map(clean).join('\n'),
      headings: link?.label ? [clean(link.label)] : [],
    });
  }

  /* 5b — Long-form PHP policies that exist only on the PHP surface. Processed BEFORE the generic PHP
        registry so the rich text wins over the theme's two-line summary for the same page. */
  for (const entry of PHP_POLICY_PAGES) {
    const extracted = readPhpPolicy(entry);
    if (!extracted) {
      report.skipped.push({ key: entry.key, reason: 'PHP policy text could not be extracted' });
      continue;
    }
    add({
      sourceKey: entry.key,
      url: entry.url,
      aliases: [`/${entry.file}`],
      title: extracted.title,
      description: extracted.description,
      kind: 'legal_document',
      surface: 'php',
      section: 'Legal',
      category: 'Legal',
      related: [],
      faqs: [],
      body: extracted.body,
      headings: [extracted.title, ...extracted.headings],
    });
  }

  /* 6 — PHP/WHMCS editorial pages registered in the theme content store. */
  const phpPages = phpSite.pages ?? {};
  const phpExcluded = (file) => excludePhp.some((rule) => (rule.endsWith('/') ? file.startsWith(rule) : file === rule));
  for (const [file, page] of Object.entries(phpPages)) {
    if (phpExcluded(file)) {
      report.skipped.push({ key: `php:${file}`, reason: 'Excluded by the site registry PHP crawl policy' });
      continue;
    }
    const features = Array.isArray(page.features) ? page.features : [];
    const faqs = Array.isArray(page.faqs) ? page.faqs : [];
    const body = [
      clean(page.headline ?? ''),
      clean(page.summary ?? ''),
      ...features.map((feature) => (Array.isArray(feature) ? feature.map(clean).filter(Boolean).join(' — ') : clean(feature))),
      ...faqs.map((faq) => `${clean(faq.q ?? faq.question ?? '')}\n${clean(faq.a ?? faq.answer ?? '')}`),
    ].filter(Boolean).join('\n');
    const spaRoute = [...phpByRoute.entries()].find(([, php]) => php === file)?.[0] ?? null;
    add({
      sourceKey: `php:${file}`,
      url: spaRoute ?? `/${file}`,
      aliases: spaRoute ? [`/${file}`] : [],
      title: clean(page.title ?? file),
      description: clean(page.summary ?? ''),
      kind: 'website_page',
      surface: 'php',
      section: clean(page.category ?? ''),
      category: clean(page.category ?? ''),
      related: (Array.isArray(page.related) ? page.related : []).map((target) => ({ label: String(target), url: `/${String(target)}` })),
      faqs: faqs.map((faq) => ({ question: clean(faq.q ?? faq.question ?? ''), answer: clean(faq.a ?? faq.answer ?? '') })),
      body,
      headings: [clean(page.headline ?? '')].filter(Boolean),
    });
  }

  /* 8 — FAQs as their own documents. A FAQ answer is a high-precision retrieval target: a customer
        typing the question verbatim should get the published answer, not a page summary. */
  for (const page of contentPages) {
    for (const [index, faq] of (page.faqs ?? []).entries()) {
      if (!faq?.q || !faq?.a) continue;
      add({
        sourceKey: `faq:${page.route}#${index}`,
        url: page.route,
        aliases: [],
        title: clean(faq.q),
        description: clean(faq.a).slice(0, 280),
        kind: 'faq',
        surface: 'spa',
        section: clean(page.category ?? ''),
        category: 'FAQ',
        related: [{ label: clean(page.title), url: page.route }],
        faqs: [{ question: clean(faq.q), answer: clean(faq.a) }],
        body: `${clean(faq.q)}\n${clean(faq.a)}`,
        headings: [],
      });
    }
  }

  /* 9 — Announcements: the bar and the published release notes. */
  const annBar = announcementText();
  if (annBar.length > 0) {
    add({
      sourceKey: 'ann:bar',
      url: '/',
      aliases: [],
      title: 'CloudHost247 announcements',
      description: annBar.map((entry) => entry.text).join(' · ').slice(0, 280),
      kind: 'announcement',
      surface: 'spa',
      section: 'Announcements',
      category: 'Announcements',
      related: annBar.filter((entry) => entry.url).map((entry) => ({ label: entry.text, url: entry.url })),
      faqs: [],
      body: annBar.map((entry) => `${entry.badge ? `[${entry.badge}] ` : ''}${entry.text}${entry.url ? ` (${entry.url})` : ''}`).join('\n'),
      headings: [],
    });
  }
  const news = newsEntries();
  if (news.length > 0) {
    add({
      sourceKey: 'ann:news',
      url: '/blog',
      aliases: [],
      title: 'CloudHost247 release notes',
      description: 'Platform releases and product notes — what shipped, what it replaces, and what it does not do yet.',
      kind: 'announcement',
      surface: 'spa',
      section: 'Announcements',
      category: 'Announcements',
      related: [],
      faqs: [],
      body: news.map((entry) => `${entry.label ? `[${entry.label}] ` : ''}${entry.title}\n${entry.summary}\n${entry.body}`).join('\n\n'),
      headings: news.map((entry) => entry.title),
    });
  }

  // Verified destinations: every route the SPA router declares plus every registry link plus every
  // PHP page the theme publishes. The assistant may only link to a path in this set — that is what
  // makes "the AI never invents a URL" a property of the data rather than a promise in a prompt.
  const routes = new Set(['/']);
  for (const route of appRoutes()) routes.add(route);
  for (const link of navLinks) if (link.to.startsWith('/')) routes.add(link.to);
  for (const document of documents) {
    routes.add(document.url);
    for (const alias of document.aliases) routes.add(alias);
  }
  for (const route of [...routes]) {
    // A query-string or fragment form is never a canonical destination.
    if (route.includes('?') || route.includes('#')) routes.delete(route);
  }

  report.sources = {
    marketingPages: contentPages.length,
    legalDocuments: legalByRoute.size,
    documentation: docsByHref.size,
    tools: tools.length,
    navigationRoutes: extraRoutes.size,
    phpPages: Object.keys(phpPages).length,
    phpPolicies: PHP_POLICY_PAGES.length,
    faqs: contentPages.reduce((total, page) => total + (page.faqs ?? []).length, 0),
    announcements: (annBar.length ? 1 : 0) + (news.length ? 1 : 0),
  };

  return {
    version: registry.version ?? '0',
    generatedFrom: [
      'shared/site/registry.json',
      'cloudhost247-node/frontend/src/content/*.generated.json',
      'modules/addons/cloudhost247_theme/resources/site.json',
      'docs/*.md',
      'cloudhost247-node/frontend/src/content/announcements.ts',
    ],
    documents,
    routes: [...routes].sort(),
    report,
  };
}

const projection = build();
const serialised = `${JSON.stringify(projection, null, 1)}\n`;

if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== serialised) {
    process.stderr.write('✖ AI website knowledge projection is stale. Run: node scripts/site/generate-ai-knowledge.mjs\n');
    process.exit(1);
  }
  process.stdout.write(`✓ AI website knowledge projection is up to date (${projection.documents.length} documents)\n`);
} else {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(OUT, '..'), { recursive: true });
  writeFileSync(OUT, serialised);
  const bytes = statSync(OUT).size;
  process.stdout.write(
    `✓ wrote ${projection.documents.length} knowledge documents (${(bytes / 1024).toFixed(0)} kB)\n`
    + `  ${Object.entries(projection.report.sources).map(([key, value]) => `${key}=${value}`).join(' ')}\n`
    + `  ${projection.report.skipped.length} source(s) skipped by crawl policy or extraction\n`
  );
}
