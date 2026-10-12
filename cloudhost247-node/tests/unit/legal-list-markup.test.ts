import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { textToHtml } from '../../../scripts/site/extract-legal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

/**
 * Policy text is rendered from `shared/site/content/legal/*.txt`. Bullets there are "- " list lines,
 * and they must come out as real lists, not as characters in a paragraph. These tests pin that
 * conversion and check the published JSON, which the SPA and the PHP theme both read.
 */
describe('legal text to HTML', () => {
  it('turns consecutive list lines into one <ul> with an <li> per item', () => {
    const html = textToHtml('Lead-in sentence:\n- First item\n- Second item\n- Third item', 'Title');
    expect(html).toContain('<p>Lead-in sentence:</p>');
    expect(html.match(/<ul>/g)).toHaveLength(1);
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain('<li>Second item</li>');
    expect(html.indexOf('</ul>')).toBeGreaterThan(html.indexOf('<li>Third item</li>'));
  });

  it('starts a new list after a paragraph and closes the list at the end of a block', () => {
    const html = textToHtml('- A\n- B\n\nA paragraph.\n\n- C', 'Title');
    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(html.match(/<\/ul>/g)).toHaveLength(2);
  });

  it('renders a short label directly above a list as a sub-heading', () => {
    const html = textToHtml('Restoration Policy\n- Full restoration is available', 'Title');
    expect(html).toContain('<h3>Restoration Policy</h3>');
  });

  it('does not turn a sentence that introduces a list into a heading', () => {
    const html = textToHtml('Users may restore backups as follows:\n- Use the panel', 'Title');
    expect(html).toContain('<p>Users may restore backups as follows:</p>');
  });

  it('escapes HTML in list items', () => {
    const html = textToHtml('- <script>alert(1)</script> & more', 'Title');
    expect(html).toContain('<li>&lt;script&gt;alert(1)&lt;/script&gt; &amp; more</li>');
    expect(html).not.toContain('<script>');
  });

  it('leaves plain paragraphs and headings exactly as before', () => {
    const html = textToHtml('1. Scope These standards apply to everyone.\n\nA plain sentence.', 'Title');
    expect(html).toBe('<h3>1. Scope These standards apply to everyone.</h3>\n<p>A plain sentence.</p>');
  });
});

describe('published legal JSON', () => {
  const shared = JSON.parse(readFileSync(resolve(REPO_ROOT, 'shared/site/content/legal.generated.json'), 'utf8')) as {
    documents: Array<{ slug: string; html: string }>;
  };
  const frontendRaw = readFileSync(resolve(REPO_ROOT, 'cloudhost247-node/frontend/src/content/legal.generated.json'), 'utf8');

  it('contains no U+F0B7 bullet characters', () => {
    expect(readFileSync(resolve(REPO_ROOT, 'shared/site/content/legal.generated.json'), 'utf8')).not.toContain('\uF0B7');
    expect(frontendRaw).not.toContain('\uF0B7');
  });

  it('keeps the frontend copy identical to the shared source', () => {
    expect(frontendRaw).toBe(readFileSync(resolve(REPO_ROOT, 'shared/site/content/legal.generated.json'), 'utf8'));
  });

  it('renders the refund policy bullets as real list items', () => {
    const refund = shared.documents.find((document) => document.slug === 'refund-policy');
    expect(refund).toBeDefined();
    expect(refund?.html).toContain('<ul>');
    expect(refund?.html).toContain('<li>Domain name registrations, renewals, or transfers.</li>');
  });
});
