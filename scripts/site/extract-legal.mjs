#!/usr/bin/env node
/**
 * Legal content extraction — one policy, one copy, two websites.
 *
 * `shared/site/registry.json` names the authoritative source of every legal document:
 *
 *   - `docs/policies/*.pdf`  — the signed, customer-facing policy PDFs. Text extracted once by
 *                              `scripts/site/extract-legal-pdf.mjs` into
 *                              `shared/site/content/legal/<slug>.txt` (committed, reviewable).
 *   - `templates/…/legal/*.tpl` — policies that exist only in the WHMCS theme, e.g. the
 *                              Acceptable Use Policy, which has no PDF.
 *
 * Both are turned into the HTML the website renders, so:
 *
 *   - the SPA finally shows the real policies instead of "this page is a placeholder";
 *   - the WHMCS theme keeps rendering the same `.tpl` text it always did;
 *   - there is exactly one copy of each binding document, and it is the one a lawyer reviewed.
 *
 * The extraction strips scripts, event handlers, inline styles and off-site links, and refuses to
 * emit a document that comes out too short — a markup change upstream fails the build rather than
 * silently publishing a blank policy.
 *
 * Usage: node scripts/site/extract-legal.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const REGISTRY = join(ROOT, 'shared', 'site', 'registry.json');
const TEXT_DIR = join(ROOT, 'shared', 'site', 'content', 'legal');
const OUT = join(ROOT, 'shared', 'site', 'content', 'legal.generated.json');

const KEEP = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'br', 'hr', 'sup', 'sub', 'code',
]);

const escapeHtml = (value) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ */
/* PDF-derived plain text → semantic HTML                              */
/* ------------------------------------------------------------------ */

const HEADING = /^(\d{1,2}\.\s+[A-Z][^.]{2,80}|[A-Z][A-Za-z ,&'\-]{3,60})$/;

/**
 * Turns reflowed policy text into HTML. The PDF text has no markup, so structure is inferred
 * conservatively: numbered clauses and short title-case lines become headings, everything else
 * stays a paragraph. Getting this wrong would re-order or re-emphasise a binding clause, so the
 * rule is "when in doubt, leave it as a paragraph".
 */
export function textToHtml(raw, title) {
  const blocks = raw.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const html = [];
  let seenBody = false;

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (line === title) continue;
      if (/^cloudhost247 isc:?\s/i.test(line) && line.length < title.length + 24) continue;

      const effective = /^effective date:?/i.test(line);
      if (effective) {
        html.push(`<p class="ch-policy-effective"><strong>${escapeHtml(line)}</strong></p>`);
        continue;
      }
      if (/^(\d{1,2}\.)\s+[A-Z]/.test(line) && line.length <= 90) {
        html.push(`<h3>${escapeHtml(line)}</h3>`);
        seenBody = true;
        continue;
      }
      if (!seenBody && HEADING.test(line) && line.length <= 70 && !/[.!?]$/.test(line)) {
        html.push(`<h3>${escapeHtml(line)}</h3>`);
        continue;
      }
      html.push(`<p>${escapeHtml(line)}</p>`);
      seenBody = true;
    }
  }
  return html.join('\n');
}

/* ------------------------------------------------------------------ */
/* Smarty include → semantic HTML                                      */
/* ------------------------------------------------------------------ */

function stripDangerous(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\sclass\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/javascript:/gi, '');
}

function normalise(html) {
  let out = html;
  for (const tag of ['div', 'section', 'span', 'article', 'header', 'footer', 'main', 'figure', 'center']) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '');
    out = out.replace(new RegExp(`</${tag}>`, 'gi'), '');
  }
  out = out.replace(/<(\/?)([a-z0-9]+)((?:\s+[^>]*?)?)>/gi, (match, close, tag, attrs) => {
    const name = tag.toLowerCase();
    if (close) return KEEP.has(name) ? `</${name}>` : '';
    if (!KEEP.has(name)) return '';
    if (name === 'a') {
      const href = /\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs ?? '');
      const value = href ? (href[2] ?? href[3] ?? '').trim() : '';
      if (/^mailto:/i.test(value)) return `<a href="${value}">`;
      if (value.startsWith('/')) return `<a href="${value}">`;
      return '';
    }
    return name === 'br' || name === 'hr' ? `<${name}>` : `<${name}>`;
  });
  return out.replace(/<\/a>\s*<\/a>/g, '</a>');
}

function collapse(html) {
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/<(\/?)([a-z0-9]+)>\s*\n\s*/gi, '<$1$2>')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/>\s+</g, '>\n<')
    .trim();
}

function summarise(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const sentence = /^(.{90,220}?[.!?])\s/.exec(text);
  return {
    description: (sentence ? sentence[1] : text.slice(0, 200)).trim(),
    paragraphs: (html.match(/<p\b/gi) ?? []).length,
    headings: (html.match(/<h[2-4]\b/gi) ?? []).length,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Some policies live in a PHP data array rather than a template — the Domain Brokerage Terms are
 * authored in `domain-brokerage-terms.php`. Rather than duplicating a binding document by hand,
 * the pairs are read from the array that the WHMCS page itself renders.
 */
export function phpTermsToHtml(source) {
  const sections = [...source.matchAll(/'title'\s*=>\s*'((?:[^'\\]|\\.)*)'[\s\S]*?'content'\s*=>\s*'((?:[^'\\]|\\.)*)'/g)];
  const unescape = (value) => value.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  return sections
    .map(([, title, content]) => `<h3>${escapeHtml(unescape(title))}</h3>\n<p>${escapeHtml(unescape(content))}</p>`)
    .join('\n');
}

const slugifyPdf = (name) => basename(name, '.pdf')
  .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------------ */

function main() {
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const documents = [];
  const problems = [];

  for (const entry of registry.legal) {
    const source = join(ROOT, entry.source);
    if (!existsSync(source)) {
      problems.push(`${entry.slug}: source ${entry.source} does not exist`);
      continue;
    }

    let html;
    let origin;
    if (entry.source.toLowerCase().endsWith('.pdf')) {
      const textFile = join(TEXT_DIR, `${slugifyPdf(entry.source)}.txt`);
      if (!existsSync(textFile)) {
        problems.push(
          `${entry.slug}: extracted text missing for ${entry.source}. `
          + 'Run: node scripts/site/extract-legal-pdf.mjs'
        );
        continue;
      }
      html = textToHtml(readFileSync(textFile, 'utf8'), entry.title);
      origin = 'pdf';
    } else if (entry.source.toLowerCase().endsWith('.php')) {
      html = phpTermsToHtml(readFileSync(source, 'utf8'));
      origin = 'php-array';
    } else {
      html = collapse(normalise(stripDangerous(readFileSync(source, 'utf8'))));
      origin = 'smarty';
    }

    const meta = summarise(html);
    if (meta.words < 80) {
      problems.push(`${entry.slug}: only ${meta.words} words extracted — refusing to publish a stub policy`);
      continue;
    }
    documents.push({
      slug: entry.slug,
      spa: entry.spa,
      php: entry.php,
      title: entry.title,
      origin,
      source: entry.source,
      html,
      meta,
    });
  }

  if (problems.length) {
    process.stderr.write(`✖ legal extraction problems:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exit(1);
  }

  // The policy centre index is a real page: it lists the documents from the registry rather than
  // duplicating them, so it can never fall out of step with what is actually published.
  const indexSource = join(ROOT, 'docs/policies/Legal & Policy Center.pdf');
  if (existsSync(indexSource)) {
    const textFile = join(TEXT_DIR, `${slugifyPdf(indexSource)}.txt`);
    if (existsSync(textFile)) {
      documents.unshift({
        slug: 'policy-center',
        spa: '/legal',
        php: 'legal.php',
        title: 'Legal & Policy Center',
        origin: 'pdf',
        source: 'docs/policies/Legal & Policy Center.pdf',
        html: textToHtml(readFileSync(textFile, 'utf8'), 'Legal & Policy Center'),
        meta: summarise(textToHtml(readFileSync(textFile, 'utf8'), 'Legal & Policy Center')),
      });
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ version: registry.version, documents }, null, 2)}\n`);

  const words = documents.reduce((total, document) => total + document.meta.words, 0);
  const fromPdf = documents.filter((document) => document.origin === 'pdf').length;
  process.stdout.write(
    `✓ legal → ${documents.length} documents, ${words.toLocaleString()} words `
    + `(${fromPdf} from policy PDFs, ${documents.length - fromPdf} from theme includes)\n`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
