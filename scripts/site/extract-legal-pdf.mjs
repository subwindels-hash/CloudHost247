#!/usr/bin/env node
/**
 * One-off extractor: CloudHost247 policy PDFs → committed plain-text sources.
 *
 * `docs/policies/*.pdf` holds the authoritative, customer-facing policy documents. `website/`
 * ships them as downloads, but the website was unable to *show* them — so its legal routes were
 * placeholders, which is worse than having no legal routes at all.
 *
 * This script turns each PDF into `shared/site/content/legal/<slug>.txt`, which
 * `scripts/site/extract-legal.mjs` then turns into the JSON the website renders. The text files
 * are committed, so the website build has no PDF dependency and the output is reviewable in a
 * diff — which matters when the content is a binding policy.
 *
 * This is a maintainer tool, not part of the build. It needs `pdfjs-dist`, which is deliberately
 * NOT a dependency of either application:
 *
 *     mkdir -p /tmp/pdfx && cd /tmp/pdfx && npm init -y && npm i pdfjs-dist@4
 *     PDFJS_DIR=/tmp/pdfx/node_modules/pdfjs-dist node scripts/site/extract-legal-pdf.mjs
 *
 * Re-run it only when a policy PDF changes, then re-run `node scripts/site/generate.mjs`.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PDF_DIR = join(ROOT, 'docs', 'policies');
const OUT_DIR = join(ROOT, 'shared', 'site', 'content', 'legal');

const PDFJS_DIR = process.env.PDFJS_DIR
  ?? '/tmp/pdfx/node_modules/pdfjs-dist';

const pdfjs = await import(join(PDFJS_DIR, 'legacy', 'build', 'pdf.mjs')).catch(() => null);
if (!pdfjs) {
  process.stderr.write(
    'pdfjs-dist not found. Install it outside the repository first:\n'
    + '  mkdir -p /tmp/pdfx && cd /tmp/pdfx && npm init -y && npm i pdfjs-dist@4\n'
    + '  PDFJS_DIR=/tmp/pdfx/node_modules/pdfjs-dist node scripts/site/extract-legal-pdf.mjs\n'
  );
  process.exit(1);
}

/** PDF line breaks are layout, not language: rejoin them, keeping blank lines as paragraphs. */
function reflow(pageTexts) {
  const paragraphs = [];
  let current = [];
  for (const page of pageTexts) {
    for (const rawLine of page.split('\n')) {
      const line = rawLine.replace(/\s+$/g, '');
      if (!line.trim()) {
        if (current.length) paragraphs.push(current.join(' '));
        current = [];
        continue;
      }
      // A line ending in a hyphen is a word split across lines.
      if (/-$/.test(line) && !/\s-$/.test(line)) {
        current.push(line.slice(0, -1));
      } else {
        current.push(line.trim());
      }
    }
    if (current.length) paragraphs.push(current.join(' '));
    current = [];
  }
  return paragraphs
    .join('\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, ' - ')
    .replace(/\u00a0/g, ' ')
    // Symbol-font glyphs that pdf.js maps to the wrong code point (bullet characters arrive as
    // pictographs from these documents). They carry no meaning in the text, so they are dropped
    // rather than published as mojibake in a binding policy.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\uFFFD]/gu, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function slugify(name) {
  return basename(name, '.pdf')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(PDF_DIR).filter((name) => name.toLowerCase().endsWith('.pdf')).sort();
  let written = 0;

  for (const file of files) {
    const data = new Uint8Array(readFileSync(join(PDF_DIR, file)));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
    const pages = [];
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      // pdf.js returns positioned runs; joining them by their own line breaks keeps paragraphs
      // intact and lets `reflow` decide where a sentence actually continues.
      let text = '';
      let lastY = null;
      for (const item of content.items) {
        const y = item.transform?.[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
        text += item.str;
        lastY = y;
      }
      pages.push(text);
    }
    const body = reflow(pages);
    const slug = slugify(file);
    writeFileSync(join(OUT_DIR, `${slug}.txt`), `${body}\n`);
    const words = body.split(/\s+/).filter(Boolean).length;
    process.stdout.write(`  ${file} → legal/${slug}.txt (${doc.numPages} pages, ${words} words)\n`);
    written += 1;
  }

  process.stdout.write(`✓ extracted ${written} policy documents into shared/site/content/legal/\n`);
}

await main();
