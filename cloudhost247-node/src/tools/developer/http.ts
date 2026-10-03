/**
 * Tools Center — HTTP header checker and server/technology detection (spec §30, §31).
 *
 * Both tools fetch the URL through the SSRF-safe client and report exactly what came back:
 * status, redirect chain, headers the server sent, and the security-relevant ones it omitted.
 * Technology detection is header-signature based; when the signatures are inconclusive the result
 * says UNKNOWN rather than guessing, and OS detection is deliberately limited — a "Server: nginx"
 * header says nothing reliable about the underlying operating system.
 */
import { invalidInput, ToolError } from '../core/errors';
import { fetchWithGuard, type FetchRedirect, type FetchResult } from '../core/ssrf';

export interface HeaderFinding {
  name: string;
  value: string | null;
  judgement: 'good' | 'warning' | 'missing' | 'info';
  detail: string;
  recommendation: string | null;
}

export interface HttpHeadersResult {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  redirects: FetchRedirect[];
  redirectAssessment: { hops: number; loopSuspected: boolean; httpsUpgrade: boolean; detail: string };
  headers: Record<string, string>;
  headerCount: number;
  findings: HeaderFinding[];
  cache: { cacheControl: string | null; age: string | null; etag: string | null; lastModified: string | null; judgement: string };
  content: { contentType: string | null; contentLength: number | null; truncated: boolean; encoding: string | null };
  timing: { durationMs: number; serverHeader: string | null; via: string | null };
  score: { passed: number; warnings: number; missing: number; summary: string };
  notes: string[];
}

const EXPECTED_HEADERS: Array<{ name: string; required: boolean; detail: string; recommendation: string; recommendedValue: string }> = [
  {
    name: 'strict-transport-security',
    required: true,
    detail: 'HSTS tells browsers to use HTTPS for this host for the stated max-age and prevents protocol-downgrade attacks.',
    recommendation: 'Send Strict-Transport-Security with a long max-age (for example max-age=31536000; includeSubDomains) once you are sure every subdomain supports HTTPS.',
    recommendedValue: 'max-age=31536000; includeSubDomains',
  },
  {
    name: 'content-security-policy',
    required: false,
    detail: 'CSP restricts which scripts, styles and frames a page may load; it is the strongest defence against cross-site scripting.',
    recommendation: 'Start with Content-Security-Policy-Report-Only, collect violations, then enforce a policy.',
    recommendedValue: "default-src 'self'",
  },
  {
    name: 'x-content-type-options',
    required: true,
    detail: 'nosniff stops browsers from MIME-sniffing a response into an executable type.',
    recommendation: 'Send X-Content-Type-Options: nosniff.',
    recommendedValue: 'nosniff',
  },
  {
    name: 'referrer-policy',
    required: false,
    detail: 'Controls how much of the URL is leaked in the Referer header to other origins.',
    recommendation: 'Send Referrer-Policy: strict-origin-when-cross-origin (or stricter).',
    recommendedValue: 'strict-origin-when-cross-origin',
  },
  {
    name: 'permissions-policy',
    required: false,
    detail: 'Limits which browser features (camera, geolocation, …) the page may use.',
    recommendation: 'Send a Permissions-Policy that denies features you do not use.',
    recommendedValue: 'geolocation=(), microphone=(), camera=()',
  },
];

const SIGNATURES: Array<{ pattern: RegExp; category: 'web-server' | 'framework' | 'language' | 'cdn' | 'proxy'; name: string }> = [
  { pattern: /(?:^|[^a-z])nginx(?:\/([\d.]+))?/i, category: 'web-server', name: 'nginx' },
  { pattern: /apache(?:\/([\d.]+))?/i, category: 'web-server', name: 'Apache HTTP Server' },
  { pattern: /litespeed/i, category: 'web-server', name: 'LiteSpeed' },
  { pattern: /openresty/i, category: 'web-server', name: 'OpenResty (nginx + Lua)' },
  { pattern: /microsoft-iis\/([\d.]+)/i, category: 'web-server', name: 'Microsoft IIS' },
  { pattern: /cloudflare/i, category: 'cdn', name: 'Cloudflare' },
  { pattern: /cloudfront/i, category: 'cdn', name: 'Amazon CloudFront' },
  { pattern: /^gunicorn/i, category: 'framework', name: 'Gunicorn (Python WSGI)' },
  { pattern: /php\/([\d.]+)/i, category: 'language', name: 'PHP' },
  { pattern: /asp\.net/i, category: 'framework', name: 'ASP.NET' },
  { pattern: /express/i, category: 'framework', name: 'Express (Node.js)' },
  { pattern: /caddy/i, category: 'web-server', name: 'Caddy' },
  { pattern: /varnish/i, category: 'proxy', name: 'Varnish cache' },
];

export interface HttpHeadersInput {
  url: string;
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}

export async function httpHeaders(input: HttpHeadersInput): Promise<HttpHeadersResult> {
  const url = (input.url ?? '').trim();
  if (url.length === 0) throw invalidInput('Enter a URL including the scheme, for example https://example.com/.');
  const response = await fetchWithGuard(url, {
    method: input.method ?? 'GET',
    timeoutMs: Math.min(Math.max(input.timeoutMs ?? 12_000, 2000), 25_000),
    maxBytes: Math.min(Math.max(input.maxBytes ?? 256 * 1024, 4096), 2 * 1024 * 1024),
    headers: input.headers,
    allowHttp: true,
  });

  const findings: HeaderFinding[] = [];
  for (const expected of EXPECTED_HEADERS) {
    const value = response.headers[expected.name] ?? null;
    if (value) {
      findings.push({ name: expected.name, value, judgement: 'good', detail: expected.detail, recommendation: null });
    } else {
      findings.push({
        name: expected.name,
        value: null,
        judgement: expected.required ? 'missing' : 'warning',
        detail: `${expected.detail} It was not present in this response.`,
        recommendation: expected.recommendation,
      });
    }
  }

  // Clickjacking: either X-Frame-Options or a CSP frame-ancestors directive counts.
  const csp = response.headers['content-security-policy'] ?? '';
  const frameAncestors = /frame-ancestors/i.test(csp);
  const xfo = response.headers['x-frame-options'] ?? null;
  findings.push({
    name: 'clickjacking-protection (x-frame-options / frame-ancestors)',
    value: frameAncestors ? 'CSP frame-ancestors' : xfo,
    judgement: frameAncestors || xfo ? 'good' : 'warning',
    detail: frameAncestors || xfo ? 'The response restricts framing.' : 'Neither X-Frame-Options nor a CSP frame-ancestors directive was present, so this page can be framed by another site and used for clickjacking.',
    recommendation: frameAncestors || xfo ? null : 'Send X-Frame-Options: DENY (or SAMEORIGIN) and/or add frame-ancestors to the CSP.',
  });

  const server = response.headers.server ?? null;
  const via = response.headers.via ?? null;
  const poweredBy = response.headers['x-powered-by'] ?? null;
  const aspNet = response.headers['x-aspnet-version'] ?? null;
  if (server && /\d/.test(server)) {
    findings.push({ name: 'server', value: server, judgement: 'warning', detail: 'The Server header discloses version information, which helps an attacker match known vulnerabilities.', recommendation: 'Hide or reduce the version detail in the web server configuration.' });
  }
  if (poweredBy) findings.push({ name: 'x-powered-by', value: poweredBy, judgement: 'warning', detail: 'X-Powered-By advertises the language/framework, including version numbers in many setups.', recommendation: 'Remove the X-Powered-By header (php.ini expose_php=Off for PHP).' });
  if (aspNet) findings.push({ name: 'x-aspnet-version', value: aspNet, judgement: 'warning', detail: 'The ASP.NET version is disclosed.', recommendation: 'Remove X-AspNet-Version in web.config (httpRuntime enableVersionHeader="false").' });

  if (/set-cookie/i.test(Object.keys(response.headers).join(','))) {
    findings.push({
      name: 'set-cookie',
      value: response.headers['set-cookie'] ?? null,
      judgement: 'info',
      detail: 'This response sets a cookie. Check the attributes: Secure, HttpOnly and SameSite are required for a cookie that carries a session.',
      recommendation: null,
    });
  }

  const redirectUrls = response.redirects.flatMap((redirect) => [redirect.url, redirect.location]);
  const loopSuspected = new Set(redirectUrls).size !== redirectUrls.length;
  const httpsUpgrade = response.redirects.length > 0 && response.redirects[0]?.url.startsWith('http://') === true && response.redirects[0]?.location.startsWith('https://') === true;

  return {
    url,
    finalUrl: response.finalUrl,
    status: response.status,
    statusText: response.statusText,
    redirects: response.redirects,
    redirectAssessment: {
      hops: response.redirects.length,
      loopSuspected,
      httpsUpgrade,
      detail: loopSuspected ? 'A URL appears twice in the redirect chain; check for a redirect loop.' : httpsUpgrade ? 'The first hop upgrades HTTP to HTTPS.' : 'No redirect loop detected.',
    },
    headers: response.headers,
    headerCount: Object.keys(response.headers).length,
    findings,
    cache: {
      cacheControl: response.headers['cache-control'] ?? null,
      age: response.headers.age ?? null,
      etag: response.headers.etag ?? null,
      lastModified: response.headers['last-modified'] ?? null,
      judgement: /no-store/i.test(response.headers['cache-control'] ?? '')
        ? 'no-store: suitable for pages that must never be cached (account, basket, dashboard).'
        : /max-age=([0-9]+)/i.exec(response.headers['cache-control'] ?? '')?.[1] === '0'
          ? 'max-age=0: the client revalidates every time.'
          : response.headers.etag || response.headers['last-modified']
            ? 'A validator (ETag/Last-Modified) is present, so caches can revalidate instead of re-downloading.'
            : 'No cache validator was present.',
    },
    content: {
      contentType: response.headers['content-type'] ?? null,
      contentLength: Number.parseInt(response.headers['content-length'] ?? String(response.body.length), 10) || null,
      truncated: response.truncated,
      encoding: response.headers['content-encoding'] ?? null,
    },
    timing: { durationMs: response.durationMs, serverHeader: server, via },
    score: (() => {
      const passed = findings.filter((finding) => finding.judgement === 'good').length;
      const warnings = findings.filter((finding) => finding.judgement === 'warning').length;
      const missing = findings.filter((finding) => finding.judgement === 'missing').length;
      return { passed, warnings, missing, summary: `${passed} good, ${warnings} warning(s), ${missing} missing header(s)` };
    })(),
    notes: [
      'This reports the headers on one response, not a security score. A missing header is a hardening opportunity, not proof of a vulnerability — exploitability depends on how the application behaves.',
      'Header values are shown exactly as received. They can be set by a CDN or reverse proxy in front of the application, so a fix may not belong in application code.',
      response.truncated ? 'The response body was truncated at the configured limit; header analysis is unaffected.' : 'Headers were read from the response body stream; nothing was executed or rendered.',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// §31 Server / technology detection
// ---------------------------------------------------------------------------------------------

export interface TechnologyDetection {
  category: 'web-server' | 'framework' | 'language' | 'cdn' | 'proxy' | 'ecommerce' | 'analytics' | 'javascript';
  name: string;
  version: string | null;
  evidence: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ServerOsResult {
  url: string;
  status: number;
  technologies: TechnologyDetection[];
  operatingSystem: { guess: string | null; confidence: 'LOW' | 'UNKNOWN'; detail: string };
  headers: Record<string, string>;
  notes: string[];
}

export async function serverOsCheck(input: { url: string; timeoutMs?: number }): Promise<ServerOsResult> {
  const url = (input.url ?? '').trim();
  if (url.length === 0) throw invalidInput('Enter a URL to inspect.');
  const response = await fetchWithGuard(url, {
    timeoutMs: Math.min(Math.max(input.timeoutMs ?? 12_000, 2000), 20_000),
    maxBytes: 512 * 1024,
    allowHttp: true,
  });

  const technologies: TechnologyDetection[] = [];
  const headerText = Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\n');
  for (const signature of SIGNATURES) {
    const match = signature.pattern.exec(headerText);
    if (!match) continue;
    technologies.push({
      category: signature.category,
      name: signature.name,
      version: match[1] ?? null,
      evidence: `Header match: ${signature.pattern.source.slice(0, 60)}`,
      confidence: 'HIGH',
    });
  }

  const metaGenerator = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i.exec(response.bodyText);
  if (metaGenerator?.[1]) technologies.push({ category: 'javascript', name: metaGenerator[1], version: null, evidence: 'meta generator tag', confidence: 'HIGH' });
  const scripts = [...response.bodyText.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1] ?? '');
  const jsSignatures: Array<{ pattern: RegExp; name: string; category: TechnologyDetection['category'] }> = [
    { pattern: /wp-content|wp-includes/i, name: 'WordPress', category: 'javascript' },
    { pattern: /\/sites\/all\/(?:modules|themes)\//i, name: 'Drupal', category: 'javascript' },
    { pattern: /shopify/i, name: 'Shopify', category: 'ecommerce' },
    { pattern: /googletagmanager|gtag\//i, name: 'Google Tag Manager', category: 'analytics' },
    { pattern: /googletagservices|pagead/i, name: 'Google AdSense', category: 'analytics' },
    { pattern: /react(?:\.production\.min)?\.js|_next\/static/i, name: 'React', category: 'javascript' },
    { pattern: /vue(?:\.runtime)?(?:\.min)?\.js/i, name: 'Vue.js', category: 'javascript' },
  ];
  for (const script of scripts) {
    for (const signature of jsSignatures) {
      if (!signature.pattern.test(script)) continue;
      if (technologies.some((technology) => technology.name === signature.name)) continue;
      technologies.push({ category: signature.category, name: signature.name, version: null, evidence: `Script: ${script.slice(0, 120)}`, confidence: 'MEDIUM' });
    }
  }
  if (scripts.length === 0 && response.bodyText.includes('<html')) {
    technologies.push({ category: 'javascript', name: 'No external JavaScript detected in the initial HTML', version: null, evidence: 'no <script src> tags in the first 512 KB of HTML', confidence: 'LOW' });
  }

  const server = response.headers.server ?? '';
  const osGuess = /ubuntu/i.test(server) ? 'Ubuntu Linux (claimed in Server header)' : /centos/i.test(server) ? 'CentOS/RHEL (claimed in Server header)' : null;

  return {
    url,
    status: response.status,
    technologies,
    operatingSystem: {
      guess: osGuess,
      confidence: osGuess ? 'LOW' : 'UNKNOWN',
      detail:
        'HTTP headers do not reliably reveal the operating system, and this tool does not guess from indirect signals: a wrong OS guess is worse than none. A server-header claim is reported as LOW confidence because it is configured by hand. Use the deployment inventory (Servers) for the operating system CloudHost247 actually provisioned.',
    },
    headers: response.headers,
    notes: [
      'Detection is based on request/response evidence only: headers, HTML meta tags and script URLs. There is no port scanning, no path brute-forcing and no probing of administrative endpoints — that would be an audit, not a lookup, and this tool does not do it.',
      'A reverse proxy or CDN in front of the site can hide or replace these headers, so absence of a signature is not evidence that a technology is absent.',
    ],
  };
}

export { ToolError as httpToolError };
