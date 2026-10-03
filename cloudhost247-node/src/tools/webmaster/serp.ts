/**
 * Tools Center — SERP simulator (spec §38).
 *
 * Estimates how a title, description and URL would appear in a search result, using a documented
 * pixel-width model rather than "Google truncates at 60 characters" folklore. Search engines
 * truncate by rendered width, which is why "width" and "count" tools disagree with each other.
 *
 * The model is an approximation of a common result layout, stated as such in every response. It is
 * not a Google API, does not predict ranking, and does not know Google's current layout.
 */
import { invalidInput } from '../core/errors';
import { normalizeDomain } from '../dns/common';
import { sanitizeUntrustedText } from '../core/validation';

export interface SerpSimulatorInput {
  title?: string;
  description?: string;
  url: string;
  breadcrumb?: string;
  siteName?: string;
  /** 'desktop' (600 px title / 960 px description) or 'mobile' (920 px title / 680 px description). */
  device?: 'desktop' | 'mobile';
}

export interface SerpField {
  value: string;
  characters: number;
  pixelWidth: number;
  limit: number;
  truncated: string;
  truncatedPixels: number;
  overLimit: boolean;
  note: string;
}

export interface SerpSimulatorResult {
  device: 'desktop' | 'mobile';
  fields: { title: SerpField; description: SerpField; breadcrumb: SerpField };
  url: { display: string; domain: string; warnings: string[] };
  warnings: string[];
  writtenTitle: string | null;
  notes: string[];
}

/**
 * Per-character widths in CSS pixels for the system UI font at 20px (a close approximation of the
 * font used for titles). Latin text only: anything outside the table uses the average width, and
 * the response says so when it happens.
 */
const WIDTHS_20PX: Record<string, number> = {};
const NARROW = 'ijl.,;:\'|![]()';
const WIDE = 'mwMW@%&';
const VERY_WIDE = '“”';

function buildWidthTable(): void {
  const base = 10.6;
  for (const character of 'abcdefghijklmnopqrstuvwxyz') WIDTHS_20PX[character] = NARROW.includes(character) ? 4.4 : WIDE.includes(character) ? 16.6 : base;
  for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') WIDTHS_20PX[character] = NARROW.includes(character) ? 4.6 : WIDE.includes(character) ? 17.8 : 11.8;
  for (const character of '0123456789') WIDTHS_20PX[character] = 11.1;
  WIDTHS_20PX[' '] = 5.4;
  for (const character of VERY_WIDE) WIDTHS_20PX[character] = 12;
}
buildWidthTable();

export type SerpFontPx = 20 | 16 | 14;

export function measureText(text: string, fontPx: SerpFontPx): number {
  const scale = fontPx / 20;
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 0x2fff) {
      // CJK and emoji are roughly one em wide. Flagged by the caller as an approximation.
      width += 18 * scale;
      continue;
    }
    width += (WIDTHS_20PX[character] ?? WIDTHS_20PX[character.toLowerCase()] ?? 10.6) * scale;
  }
  return Math.round(width * 10) / 10;
}

function truncateToWidth(text: string, limit: number, fontPx: SerpFontPx): { truncated: string; pixels: number } {
  if (measureText(text, fontPx) <= limit) return { truncated: text, pixels: measureText(text, fontPx) };
  const ellipsis = '…';
  let current = '';
  for (const character of text) {
    const candidate = current + character;
    if (measureText(candidate + ellipsis, fontPx) > limit) break;
    current = candidate;
  }
  // Trim to a word boundary when one is close, because that is what the engines effectively do.
  const lastSpace = current.lastIndexOf(' ');
  if (lastSpace > current.length * 0.6) current = current.slice(0, lastSpace);
  const truncated = `${current.trimEnd()}${ellipsis}`;
  return { truncated, pixels: measureText(truncated, fontPx) };
}

export function serpSimulator(input: SerpSimulatorInput): SerpSimulatorResult {
  const device = input.device ?? 'desktop';
  const limits = device === 'desktop' ? { title: 600, description: 960, breadcrumb: 600 } : { title: 920, description: 680, breadcrumb: 600 };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.url) ? input.url : `https://${input.url}`);
  } catch {
    throw invalidInput('Enter the page URL or domain.');
  }
  const domain = normalizeDomain(url.hostname);
  const breadcrumb = input.breadcrumb?.trim() || url.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/[/-]/g, ' › ');
  const title = input.title ?? '';
  const description = input.description ?? '';
  const warnings: string[] = [];

  const buildField = (value: string, limit: number, fontPx: SerpFontPx, label: string): SerpField => {
    const pixels = measureText(value, fontPx);
    const { truncated, pixels: truncatedPixels } = truncateToWidth(value, limit, fontPx);
    return {
      value,
      characters: [...value].length,
      pixelWidth: pixels,
      limit,
      truncated,
      truncatedPixels,
      overLimit: pixels > limit,
      note: pixels > limit ? `${label} exceeds the ~${limit}px ${device} container and would be cut to "${truncated}".` : `${label} fits (${pixels}px of ~${limit}px).`,
    };
  };

  const titleField = buildField(title, limits.title, 20, 'The title');
  const descriptionField = buildField(description, limits.description, 14, 'The description');
  const breadcrumbField = buildField(breadcrumb.toUpperCase(), limits.breadcrumb, 16, 'The breadcrumb');

  if (title.length === 0) warnings.push('No title was provided. Search engines generate one from the page, which is rarely as good as a written one.');
  if (description.length === 0) warnings.push('No description was provided. The engine will quote text from the page instead, which may not be the sentence you want.');
  if (title.length > 0 && titleField.overLimit) warnings.push(`The title is ${titleField.characters} characters and ${titleField.pixelWidth}px; it would be truncated on ${device}. Shorten the visible part of the message — the leading words carry the click.`);
  if (description.length > 0 && descriptionField.overLimit) warnings.push('The description exceeds the container width. Keep the call to action early so it survives truncation.');
  if (/\b(?:click here|read more|welcome to our website)\b/i.test(`${title} ${description}`)) {
    warnings.push('The title or description contains filler phrases ("click here", "read more", "welcome to our website") that consume space without adding information.');
  }
  if (title !== title.trim() || / {2,}/.test(title)) warnings.push('The title contains extra whitespace; engines collapse it, so the rendered result will differ from what you see here.');
  const emojiCount = [...title].filter((character) => (character.codePointAt(0) ?? 0) > 0x2100).length;
  if (emojiCount > 0) warnings.push('The title contains emoji or non-Latin symbols. Some of these render at a very different width (and some not at all) in the search layout, so treat this pixel estimate as rough.');

  const urlWarnings: string[] = [];
  if (url.pathname !== '/' && url.pathname.length > 0 && /[_]{1}/.test(url.pathname)) {
    urlWarnings.push('The URL path contains underscores. Hyphens are the conventional word separator in URLs and read better in a breadcrumb.');
  }
  if (/\?/.test(url.search)) urlWarnings.push('The URL has query parameters. Some parameters (session IDs, tracking) create duplicate URLs for the same page.');
  if (url.hostname.startsWith('www.')) urlWarnings.push('The hostname includes "www.". That is fine, but be consistent: www and non-www are different origins and need a canonical redirect either way.');
  if (url.protocol === 'http:') urlWarnings.push('The URL is plain HTTP. Browsers mark it "Not secure" and it is a ranking-relevant hygiene problem.');

  return {
    device,
    fields: { title: titleField, description: descriptionField, breadcrumb: breadcrumbField },
    url: {
      display: `${domain.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`,
      domain,
      warnings: urlWarnings,
    },
    warnings,
    writtenTitle: title.length > 0 ? sanitizeUntrustedText(title, { maxLength: 200 }) : null,
    notes: [
      `Pixel widths are computed with a fixed per-character width table for a system UI font (title ${20}px, description 14px) against container widths of ${limits.title}px/${limits.description}px on ${device}. Real search engines use their own fonts, bidi handling and responsive containers, so the cut-off may differ by a few characters.`,
      'This is a formatting checkpoint for your metadata, not a preview of live search results and not a ranking tool. Search engines rewrite titles and descriptions whenever they think they have a better option.',
      'Non-Latin characters are estimated at one em each. If your title is largely CJK or emoji, verify the rendering in the search engine itself.',
    ],
  };
}

export interface MetaTagAudit {
  findings: Array<{ tag: string; present: boolean; value: string | null; note: string }>;
  notes: string[];
}

/** Audits the tags that belong with a page's search appearance. */
export function metaTagAudit(input: { html: string }): MetaTagAudit {
  const html = input.html ?? '';
  if (html.trim().length === 0) throw invalidInput('Paste the <head> HTML to audit.');
  const tag = (pattern: RegExp): { present: boolean; value: string | null } => {
    const match = pattern.exec(html);
    return { present: Boolean(match), value: match?.[1] ? sanitizeUntrustedText(match[1], { maxLength: 300 }) : null };
  };

  const title = tag(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = tag(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const descriptionAlt = description.present ? description : tag(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const robots = tag(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i);
  const canonical = tag(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);
  const viewport = tag(/<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']*)["']/i);
  const ogTitle = tag(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  const twitterCard = tag(/<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']*)["']/i);
  const favicon = tag(/<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]+href=["']([^"']*)["']/i);

  return {
    findings: [
      { tag: '<title>', present: title.present, value: title.value, note: 'Every page needs a unique, descriptive title. It is the strongest on-page signal and the first line of the result.' },
      { tag: 'meta description', present: descriptionAlt.present, value: descriptionAlt.value, note: 'Not a ranking factor, but it is the snippet most often used. Write it as an invitation, not a summary.' },
      { tag: 'meta robots', present: robots.present, value: robots.value, note: robots.value?.includes('noindex') ? 'This page declares noindex: it will be kept out of search results.' : 'Absent means "index, follow" by default. Use noindex deliberately, never by accident.' },
      { tag: 'link rel=canonical', present: canonical.present, value: canonical.value, note: 'Tells engines which URL is the preferred one when the same content is reachable at several URLs.' },
      { tag: 'meta viewport', present: viewport.present, value: viewport.value, note: 'Required for a usable mobile layout; mobile-first indexing means the mobile rendering is what gets evaluated.' },
      { tag: 'og:title', present: ogTitle.present, value: ogTitle.value, note: 'Controls the link preview on social platforms. Run the Open Graph checker for the full set.' },
      { tag: 'twitter:card', present: twitterCard.present, value: twitterCard.value, note: 'Without it X uses its own heuristics for the preview layout.' },
      { tag: 'favicon link', present: favicon.present, value: favicon.value, note: 'Shown in browser tabs and next to mobile search results.' },
    ],
    notes: [
      'This is a static read of the HTML you pasted. It does not fetch the page, does not run JavaScript, and cannot see tags injected at runtime.',
      'Duplicated or conflicting tags (two canonicals, two robots meta tags) are a common cause of unpredictable indexing; review the source rather than trusting a checklist.',
    ],
  };
}
