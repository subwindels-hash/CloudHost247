/**
 * Tools Center — Open Graph / social preview checker (spec §38).
 *
 * Fetches a page, reads the real `og:`/`twitter:`/standard meta tags and reports exactly what a
 * scraper would see, plus the fallbacks it would use when a tag is missing. The share image is
 * downloaded (bounded to 256 KB) so its real pixel dimensions can be measured from the file header
 * instead of being taken from the site's word.
 *
 * No social network API is called: crawlers apply their own rules and caches, so the result states
 * what is present in the HTML and flags what is likely to render badly — it never claims to know
 * what Facebook or X will show.
 */
import { fetchWithGuard } from '../core/ssrf';
import { invalidInput } from '../core/errors';
import { parseUrlInput, sanitizeUntrustedText } from '../core/validation';

export interface MetaTag {
  property: string;
  content: string;
  source: 'open-graph' | 'twitter' | 'standard' | 'other';
}

export interface ImageMeasurement {
  url: string;
  fetched: boolean;
  httpStatus: number | null;
  contentType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  detail: string;
}

export interface OpenGraphIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  detail: string;
}

export interface OpenGraphResult {
  page: { url: string; finalUrl: string; httpStatus: number; title: string | null; canonical: string | null; description: string | null; robotsNoindex: boolean };
  tags: MetaTag[];
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  preview: {
    title: { value: string | null; source: 'og:title' | 'twitter:title' | '<title>' | 'none' };
    description: { value: string | null; source: 'og:description' | 'twitter:description' | 'meta description' | 'none' };
    image: ImageMeasurement | null;
    url: string | null;
    siteName: string | null;
    type: string | null;
    card: string | null;
  };
  issues: OpenGraphIssue[];
  recommendations: string[];
  notes: string[];
  durationMs: number;
}

function extractMetaTags(html: string): MetaTag[] {
  const tags: MetaTag[] = [];
  const metaPattern = /<meta\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaPattern.exec(html)) !== null) {
    const attributes = match[1] ?? '';
    const attribute = (name: string): string | null => {
      const found = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>=]+))`, 'i').exec(attributes);
      return found ? (found[1] ?? found[2] ?? found[3] ?? null) : null;
    };
    const property = (attribute('property') ?? attribute('name') ?? '').toLowerCase().trim();
    const content = attribute('content');
    if (!property || content === null) continue;
    const source: MetaTag['source'] = property.startsWith('og:') ? 'open-graph' : property.startsWith('twitter:') ? 'twitter' : /^(description|robots|canonical|title|viewport|theme-color)$/.test(property) ? 'standard' : 'other';
    tags.push({ property, content: sanitizeUntrustedText(content, { maxLength: 600 }), source });
  }
  return tags;
}

/** Reads real pixel dimensions from the image header for PNG, JPEG, GIF and WebP. */
export function measureImage(buffer: Buffer): { width: number; height: number; format: string } | null {
  if (buffer.length < 16) return null;
  // PNG
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'PNG' };
  }
  // GIF
  if (buffer.subarray(0, 3).toString('latin1') === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), format: 'GIF' };
  }
  // WebP (VP8 / VP8L / VP8X)
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    const chunk = buffer.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8X') {
      const width = 1 + ((buffer[24] ?? 0) | ((buffer[25] ?? 0) << 8) | ((buffer[26] ?? 0) << 16));
      const height = 1 + ((buffer[27] ?? 0) | ((buffer[28] ?? 0) << 8) | ((buffer[29] ?? 0) << 16));
      return { width, height, format: 'WebP (VP8X)' };
    }
    if (chunk === 'VP8 ') {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff, format: 'WebP (VP8)' };
    }
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), format: 'WebP (VP8L)' };
    }
    return null;
  }
  // JPEG: walk the marker segments looking for a Start-Of-Frame.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1] ?? 0;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), format: 'JPEG' };
      }
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

function firstTag(tags: MetaTag[], property: string): string | null {
  return tags.find((tag) => tag.property === property)?.content ?? null;
}

export async function openGraphCheck(input: { url: string }): Promise<OpenGraphResult> {
  const started = Date.now();
  const parsed = parseUrlInput(input.url, { allowHttp: true });
  const url = parsed.toString();

  const response = await fetchWithGuard(url, { method: 'GET', timeoutMs: 15_000, allowHttp: true, maxBytes: 2 * 1024 * 1024, userAgent: 'CloudHost247-SocialPreview/1.0 (+https://cloudhost247.com)' });
  const contentType = response.headers['content-type'] ?? '';
  if (!/html|xml/i.test(contentType) && !/<html|<meta|<head/i.test(response.bodyText.slice(0, 2000))) {
    throw invalidInput(`That URL returned "${contentType || 'no content type'}"; the social preview checker needs an HTML page.`);
  }
  const html = response.bodyText;
  const tags = extractMetaTags(html);

  const openGraph: Record<string, string> = {};
  for (const tag of tags.filter((tag) => tag.source === 'open-graph')) {
    if (openGraph[tag.property] === undefined) openGraph[tag.property] = tag.content;
  }
  const twitter: Record<string, string> = {};
  for (const tag of tags.filter((tag) => tag.source === 'twitter')) {
    if (twitter[tag.property] === undefined) twitter[tag.property] = tag.content;
  }

  const titleMatch = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  const pageTitle = titleMatch?.[1] ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;
  const canonicalMatch = /<link\b[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i.exec(html);
  const canonicalParts = canonicalMatch ? /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+))/i.exec(canonicalMatch[0]) : null;
  const canonical = canonicalParts?.[1] ?? canonicalParts?.[2] ?? canonicalParts?.[3] ?? null;
  const description = firstTag(tags, 'description');
  const robots = (firstTag(tags, 'robots') ?? '').toLowerCase();
  const robotsNoindex = /noindex/.test(robots);

  const ogTitle = openGraph['og:title'] ?? null;
  const twTitle = twitter['twitter:title'] ?? null;
  const ogDescription = openGraph['og:description'] ?? null;
  const twDescription = twitter['twitter:description'] ?? null;
  const imageUrl = openGraph['og:image'] ?? twitter['twitter:image'] ?? null;

  let image: ImageMeasurement | null = null;
  if (imageUrl) {
    let absoluteImage: string;
    try {
      absoluteImage = new URL(imageUrl, response.finalUrl).toString();
    } catch {
      absoluteImage = imageUrl;
    }
    try {
      const imageResponse = await fetchWithGuard(absoluteImage, { method: 'GET', timeoutMs: 10_000, allowHttp: true, maxBytes: 256 * 1024 });
      const measured = measureImage(imageResponse.body);
      const bytes = Buffer.isBuffer(imageResponse.body) ? imageResponse.body.length : Buffer.byteLength(imageResponse.body, 'utf8');
      if (measured) {
        image = { url: absoluteImage, fetched: true, httpStatus: imageResponse.status, contentType: imageResponse.headers['content-type'] ?? null, bytes, width: measured.width, height: measured.height, format: measured.format, detail: `Measured from the downloaded file: ${measured.width}×${measured.height} ${measured.format}.` };
      } else {
        image = { url: absoluteImage, fetched: true, httpStatus: imageResponse.status, contentType: imageResponse.headers['content-type'] ?? null, bytes, width: null, height: null, format: null, detail: 'The image was downloaded but its dimensions could not be read from the file header (the format is unrecognised or the file is truncated).' };
      }
    } catch (error) {
      image = { url: absoluteImage, fetched: false, httpStatus: null, contentType: null, bytes: null, width: null, height: null, format: null, detail: `The image could not be downloaded: ${error instanceof Error ? error.message : 'unknown error'}. Crawlers will show no image.` };
    }
  }

  const issues: OpenGraphIssue[] = [];
  if (!ogTitle) issues.push({ severity: 'error', code: 'NO_OG_TITLE', detail: 'og:title is missing. Crawlers fall back to the <title> tag, which is usually longer and less shareable.' });
  if (!openGraph['og:type']) issues.push({ severity: 'warning', code: 'NO_OG_TYPE', detail: 'og:type is missing. Without it most crawlers assume "website", which is fine for most pages but should be explicit.' });
  if (!imageUrl) issues.push({ severity: 'error', code: 'NO_OG_IMAGE', detail: 'No og:image or twitter:image is present, so share cards will have no picture.' });
  if (!ogDescription && !description) issues.push({ severity: 'warning', code: 'NO_DESCRIPTION', detail: 'Neither og:description nor a meta description is present; crawlers will invent a snippet from the page text.' });
  if (openGraph['og:url'] && canonical !== null && openGraph['og:url'] !== canonical) {
    issues.push({ severity: 'info', code: 'OGURL_CANONICAL_MISMATCH', detail: `og:url (${openGraph['og:url']}) differs from the canonical link (${canonical}). Make them agree so shares point at one URL.` });
  }
  if (!twitter['twitter:card']) issues.push({ severity: 'warning', code: 'NO_TWITTER_CARD', detail: 'twitter:card is missing, so X/Twitter will not render a large-image card reliably.' });
  if (image?.width && image.height) {
    const ratio = image.width / image.height;
    if (image.width < 200 || image.height < 200) {
      issues.push({ severity: 'error', code: 'IMAGE_TOO_SMALL', detail: `The share image is only ${image.width}×${image.height}. Most crawlers ignore images below 200×200.` });
    } else if (Math.abs(ratio - 1.91) > 0.35) {
      issues.push({ severity: 'warning', code: 'IMAGE_RATIO_OFF', detail: `The share image is ${image.width}×${image.height} (ratio ${ratio.toFixed(2)}), which will be cropped or letterboxed. 1200×630 (ratio 1.91) is the common safe size.` });
    } else if (image.width < 1200) {
      issues.push({ severity: 'info', code: 'IMAGE_BELOW_RECOMMENDED', detail: `The share image is ${image.width}×${image.height}. It will render, but 1200×630 is the recommended size.` });
    }
  }
  if (robotsNoindex) issues.push({ severity: 'error', code: 'NOINDEX', detail: 'The page sends robots: noindex, so it may not be indexed or previewed at all. Remove it if this page should be shareable.' });
  if (html.length < 500) issues.push({ severity: 'warning', code: 'THIN_HTML', detail: `Only ${html.length} bytes of HTML were returned. The page may be a JavaScript shell, in which case crawlers that do not execute JavaScript see nothing.` });
  if (/<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(html)) issues.push({ severity: 'warning', code: 'META_REFRESH', detail: 'The page uses a meta refresh redirect. Some crawlers do not follow it, so the shared URL may show the wrong content.' });

  const recommendations: string[] = [];
  if (!ogTitle) recommendations.push('Add <meta property="og:title" content="…"> (roughly 60 characters, readable on its own out of context).');
  if (!imageUrl) recommendations.push('Add <meta property="og:image" content="https://…"> with a 1200×630 image and an absolute URL.');
  else if (image && image.width) recommendations.push('Keep the image at 1200×630 or larger with an absolute URL; some crawlers cannot resolve relative paths.');
  if (!openGraph['og:url']) recommendations.push('Add <meta property="og:url"> with the canonical URL of the page (no tracking parameters).');
  if (!twitter['twitter:card']) recommendations.push('Add <meta name="twitter:card" content="summary_large_image"> for large card rendering.');
  recommendations.push('Social crawlers cache scraped data. After changing these tags, re-scrape with the platform debuggers (Facebook Sharing Debugger, X Card Validator) or the preview may stay stale for days.');

  return {
    page: { url, finalUrl: response.finalUrl, httpStatus: response.status, title: pageTitle, canonical, description, robotsNoindex },
    tags,
    openGraph,
    twitter,
    preview: {
      title: ogTitle ? { value: ogTitle, source: 'og:title' } : twTitle ? { value: twTitle, source: 'twitter:title' } : pageTitle ? { value: pageTitle, source: '<title>' } : { value: null, source: 'none' },
      description: ogDescription ? { value: ogDescription, source: 'og:description' } : twDescription ? { value: twDescription, source: 'twitter:description' } : description ? { value: description, source: 'meta description' } : { value: null, source: 'none' },
      image,
      url: openGraph['og:url'] ?? canonical ?? response.finalUrl,
      siteName: openGraph['og:site_name'] ?? null,
      type: openGraph['og:type'] ?? null,
      card: twitter['twitter:card'] ?? null,
    },
    issues,
    recommendations,
    notes: [
      'The tags are read from the HTML as served to this server. If the page injects meta tags with JavaScript, they are not visible here — and many crawlers do not execute JavaScript either.',
      'Crawler behaviour differs: each network applies its own fallbacks, size limits and cache. This tool shows what is present and what is likely to go wrong; it cannot guarantee what any given platform will render.',
      'Nothing is posted anywhere. The share image is fetched once, bounded to 256 KB, only to measure its real dimensions.',
    ],
    durationMs: Date.now() - started,
  };
}
