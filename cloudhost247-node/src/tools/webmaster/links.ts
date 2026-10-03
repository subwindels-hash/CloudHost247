/**
 * Tools Center — broken link checker (spec §37).
 *
 * Crawls one page (no site-wide spidering), extracts its references and issues a real HTTP request
 * for each of them through the SSRF-guarded client. Nothing is guessed: a link is only "broken" if
 * the server answered with a 4xx/5xx or the connection could not be made, and every non-OK result
 * keeps the status, the final URL and the error text as evidence.
 *
 * Two honest caveats that the result always carries:
 *   - Many sites rate-limit or block automated clients. A 403/429 is reported as "blocked", not
 *     "broken", because that is what the evidence supports.
 *   - External links are checked with HEAD first; servers that refuse HEAD (405/501) are retried
 *     with GET, so a "broken" verdict always comes from a real response to a real request.
 */
import { fetchWithGuard } from '../core/ssrf';
import { invalidInput, isToolError } from '../core/errors';
import { parseUrlInput } from '../core/validation';

export type LinkStatus = 'OK' | 'REDIRECT' | 'BROKEN' | 'SERVER_ERROR' | 'BLOCKED' | 'TIMEOUT' | 'UNREACHABLE' | 'SKIPPED';

export interface CheckedLink {
  url: string;
  text: string | null;
  kind: 'a' | 'img' | 'script' | 'link' | 'iframe' | 'source' | 'other';
  internal: boolean;
  status: LinkStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  redirects: number;
  contentType: string | null;
  durationMs: number;
  detail: string;
}

export interface BrokenLinksResult {
  page: { url: string; httpStatus: number; finalUrl: string; title: string | null; contentType: string | null; bytes: number; durationMs: number };
  counts: { total: number; checked: number; ok: number; redirects: number; broken: number; serverErrors: number; blocked: number; timeouts: number; unreachable: number; skipped: number };
  links: CheckedLink[];
  broken: CheckedLink[];
  internalBroken: CheckedLink[];
  summary: string;
  recommendations: string[];
  notes: string[];
  durationMs: number;
}

interface RawLink {
  url: string;
  text: string | null;
  kind: CheckedLink['kind'];
}

const NON_HTTP_SCHEME = /^(?:mailto|tel|sms|javascript|data|ftp|file|about|blob|chrome|ws|wss):/i;

export function extractLinks(html: string, baseUrl: string): RawLink[] {
  const seen = new Set<string>();
  const links: RawLink[] = [];
  const attributePattern = /<(a|img|script|link|iframe|source|video|audio|form)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  const push = (rawHref: string | null, text: string | null, kind: CheckedLink['kind']): void => {
    if (!rawHref) return;
    const href = rawHref.trim();
    if (href.length === 0 || href.startsWith('#') || NON_HTTP_SCHEME.test(href)) return;
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const withoutFragment = absolute.split('#')[0] ?? absolute;
    if (seen.has(withoutFragment)) return;
    seen.add(withoutFragment);
    links.push({ url: withoutFragment, text, kind });
  };

  while ((match = attributePattern.exec(html)) !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    const attributes = match[2] ?? '';
    const attribute = (name: string): string | null => {
      const found = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>=]+))`, 'i').exec(attributes);
      return found ? (found[1] ?? found[2] ?? found[3] ?? null) : null;
    };
    const kind: CheckedLink['kind'] = tag === 'a' ? 'a' : tag === 'img' ? 'img' : tag === 'script' ? 'script' : tag === 'link' ? 'link' : tag === 'iframe' ? 'iframe' : tag === 'source' ? 'source' : 'other';
    if (tag === 'link') {
      const rel = (attribute('rel') ?? '').toLowerCase();
      // Only stylesheets/icons/feeds are resources worth checking; canonical/preconnect are metadata.
      if (!/(stylesheet|icon|shortcut icon|apple-touch-icon|manifest|alternate)/.test(rel)) continue;
    }
    push(attribute('href') ?? attribute('src'), null, kind);
  }

  // Anchor text for <a> elements, captured separately so the raw-attribute scan stays simple.
  const anchorPattern = /<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi;
  while ((match = anchorPattern.exec(html)) !== null) {
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+))/i.exec(match[1] ?? '');
    const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? null;
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(href.trim(), baseUrl).toString().split('#')[0] ?? '';
    } catch {
      continue;
    }
    const entry = links.find((link) => link.url === absolute);
    if (entry) {
      entry.text = (match[2] ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || null;
    }
  }
  return links;
}

function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  return match?.[1] ? match[1].replace(/\s+/g, ' ').trim().slice(0, 200) : null;
}

async function checkLink(link: RawLink, pageOrigin: string, internal: boolean, timeoutMs: number): Promise<CheckedLink> {
  const base: CheckedLink = {
    url: link.url,
    text: link.text,
    kind: link.kind,
    internal,
    status: 'SKIPPED',
    httpStatus: null,
    finalUrl: null,
    redirects: 0,
    contentType: null,
    durationMs: 0,
    detail: '',
  };
  const started = Date.now();
  const attempt = async (method: 'HEAD' | 'GET') =>
    fetchWithGuard(link.url, { method, timeoutMs, allowHttp: true, maxBytes: 32 * 1024, maxRedirects: 5, userAgent: 'CloudHost247-LinkChecker/1.0 (+https://cloudhost247.com)' });

  try {
    let response = await attempt('HEAD');
    let usedMethod: 'HEAD' | 'GET' = 'HEAD';
    if ([405, 501, 400].includes(response.status)) {
      response = await attempt('GET');
      usedMethod = 'GET';
    }
    const duration = Date.now() - started;
    const final = response.finalUrl;
    const redirects = response.redirects.length;
    const common = { httpStatus: response.status, finalUrl: final, redirects, contentType: response.headers['content-type'] ?? null, durationMs: duration };
    if (response.status >= 200 && response.status < 300) {
      return { ...base, ...common, status: redirects > 0 ? 'REDIRECT' : 'OK', detail: `${usedMethod} ${response.status}${redirects > 0 ? ` after ${redirects} redirect(s) to ${final}` : ''}${usedMethod === 'GET' ? ' (HEAD was refused, GET used)' : ''}.` };
    }
    if (response.status === 403 || response.status === 429) {
      return { ...base, ...common, status: 'BLOCKED', detail: `${usedMethod} ${response.status} — the site refused an automated request (bot protection or rate limiting). This is not proof that the link is broken; open it in a browser to confirm.` };
    }
    if (response.status >= 400 && response.status < 500) {
      return { ...base, ...common, status: 'BROKEN', detail: `${usedMethod} ${response.status} — the server says this resource does not exist.` };
    }
    if (response.status >= 500) {
      return { ...base, ...common, status: 'SERVER_ERROR', detail: `${usedMethod} ${response.status} — the server failed to serve the resource. This is a server-side problem, not necessarily a wrong URL.` };
    }
    return { ...base, ...common, status: 'REDIRECT', detail: `${usedMethod} ${response.status} (final ${final}).` };
  } catch (error) {
    const duration = Date.now() - started;
    const message = isToolError(error) ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'unknown error';
    const blocked = isToolError(error) && (error.code === 'TARGET_BLOCKED' || error.code === 'INVALID_INPUT');
    const timeout = isToolError(error) && error.code === 'TIMEOUT';
    return {
      ...base,
      status: blocked ? 'BLOCKED' : timeout ? 'TIMEOUT' : 'UNREACHABLE',
      durationMs: duration,
      detail: blocked
        ? `Refused by the SSRF guard: ${message}. Internal addresses are never contacted.`
        : timeout
          ? `No response within ${timeoutMs} ms.`
          : `The request could not be completed: ${message}`,
    };
  }
}

export async function brokenLinkCheck(input: { url: string; maxLinks?: number; timeoutMs?: number; includeExternal?: boolean; kindFilter?: CheckedLink['kind'][] }): Promise<BrokenLinksResult> {
  const started = Date.now();
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 8000, 2000), 20_000);
  const maxLinks = Math.min(Math.max(input.maxLinks ?? 40, 1), 100);
  const includeExternal = input.includeExternal !== false;

  const parsed = parseUrlInput(input.url, { allowHttp: true });
  const pageUrl = parsed.toString();

  const pageResponse = await fetchWithGuard(pageUrl, { method: 'GET', timeoutMs, allowHttp: true, maxBytes: 3 * 1024 * 1024, userAgent: 'CloudHost247-LinkChecker/1.0 (+https://cloudhost247.com)' });
  const contentType = pageResponse.headers['content-type'] ?? '';
  if (!/html|xml|text/i.test(contentType) && pageResponse.bodyText.trim().length === 0) {
    throw invalidInput(`That URL returned "${contentType || 'no content type'}", which is not an HTML page to check.`);
  }
  const html = pageResponse.bodyText;
  const origin = new URL(pageResponse.finalUrl).origin;

  let links = extractLinks(html, pageResponse.finalUrl);
  if (input.kindFilter && input.kindFilter.length > 0) {
    const allowed = new Set(input.kindFilter);
    links = links.filter((link) => allowed.has(link.kind));
  }

  const skippedByLimit: CheckedLink[] = [];
  const selected: RawLink[] = [];
  for (const link of links) {
    let internal: boolean;
    try {
      internal = new URL(link.url).origin === origin;
    } catch {
      internal = false;
    }
    if (!includeExternal && !internal) {
      skippedByLimit.push({
        url: link.url,
        text: link.text,
        kind: link.kind,
        internal,
        status: 'SKIPPED',
        httpStatus: null,
        finalUrl: null,
        redirects: 0,
        contentType: null,
        durationMs: 0,
        detail: 'External links were skipped because includeExternal is false.',
      });
      continue;
    }
    if (selected.length >= maxLinks) {
      skippedByLimit.push({
        url: link.url,
        text: link.text,
        kind: link.kind,
        internal,
        status: 'SKIPPED',
        httpStatus: null,
        finalUrl: null,
        redirects: 0,
        contentType: null,
        durationMs: 0,
        detail: `Beyond the ${maxLinks}-link limit for this run. Increase maxLinks to check it.`,
      });
      continue;
    }
    selected.push(link);
  }

  const results: CheckedLink[] = [];
  const queue = [...selected];
  const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
    for (;;) {
      const link = queue.shift();
      if (!link) return;
      let internal = false;
      try {
        internal = new URL(link.url).origin === origin;
      } catch {
        internal = false;
      }
      results.push(await checkLink(link, origin, internal, timeoutMs));
    }
  });
  await Promise.all(workers);

  // Keep catalogue order stable: internal links first, then by document order.
  const order = new Map(links.map((link, index) => [link.url, index]));
  const all = [...results, ...skippedByLimit].sort((a, b) => (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0));

  const broken = all.filter((link) => link.status === 'BROKEN' || link.status === 'SERVER_ERROR' || link.status === 'UNREACHABLE');
  const counts = {
    total: all.length,
    checked: all.filter((link) => link.status !== 'SKIPPED').length,
    ok: all.filter((link) => link.status === 'OK').length,
    redirects: all.filter((link) => link.status === 'REDIRECT').length,
    broken: all.filter((link) => link.status === 'BROKEN').length,
    serverErrors: all.filter((link) => link.status === 'SERVER_ERROR').length,
    blocked: all.filter((link) => link.status === 'BLOCKED').length,
    timeouts: all.filter((link) => link.status === 'TIMEOUT').length,
    unreachable: all.filter((link) => link.status === 'UNREACHABLE').length,
    skipped: all.filter((link) => link.status === 'SKIPPED').length,
  };

  const recommendations: string[] = [];
  if (counts.broken > 0) {
    recommendations.push(`${counts.broken} link(s) returned "not found". Fix or remove them: search engines follow these and visitors hit dead ends.`);
  }
  if (counts.serverErrors > 0) {
    recommendations.push(`${counts.serverErrors} link(s) returned a server error. Re-check them later — a 5xx can be a temporary outage rather than a wrong URL.`);
  }
  if (counts.blocked > 0) {
    recommendations.push(`${counts.blocked} link(s) were refused (403/429). The site is blocking automated requests; verify those in a browser before changing anything.`);
  }
  if (counts.redirects > 0) {
    recommendations.push(`${counts.redirects} link(s) redirect. Point them at the final URL to save visitors a round trip.`);
  }
  if (counts.skipped > 0) {
    recommendations.push(`${counts.skipped} link(s) were not checked (limit or filters). Raise the link limit if you need full coverage.`);
  }
  if (all.some((link) => link.url.startsWith('http://'))) {
    recommendations.push('Some links use plain HTTP. Serve everything over HTTPS and redirect http:// requests so visitors are never downgraded.');
  }

  return {
    page: {
      url: pageUrl,
      httpStatus: pageResponse.status,
      finalUrl: pageResponse.finalUrl,
      title: titleOf(html),
      contentType: contentType || null,
      bytes: Buffer.byteLength(pageResponse.bodyText, 'utf8'),
      durationMs: pageResponse.durationMs,
    },
    counts,
    links: all,
    broken,
    internalBroken: broken.filter((link) => link.internal),
    summary: `${counts.checked} link(s) checked on ${pageResponse.finalUrl}: ${counts.ok} OK, ${counts.redirects} redirecting, ${counts.broken} broken, ${counts.serverErrors} server error(s), ${counts.blocked} refused, ${counts.timeouts} timed out.`,
    recommendations,
    notes: [
      'Only the page you submitted is crawled; links found inside frames, JavaScript-generated markup or a sitemap are not followed unless they appear in the HTML.',
      'Requests are made by the platform server, which many sites rate-limit or block. A 403 or 429 is recorded as "refused", never as "broken".',
      'The SSRF guard refuses private, loopback and metadata addresses, so a link to an internal host is reported as blocked rather than contacted.',
    ],
    durationMs: Date.now() - started,
  };
}
