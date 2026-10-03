/**
 * Tools Center — URL tools (spec §36).
 *
 * Breaks a URL into its components, explains each query parameter, resolves relative URLs, builds
 * and strips campaign parameters, and compares two URLs for equality after normalisation.
 *
 * The parser is the WHATWG URL implementation that ships with Node, not a regular expression: if
 * this tool and your browser disagree about a URL, that is a finding worth reporting, not something
 * to paper over with a hand-rolled regex.
 */
import { invalidInput } from '../core/errors';
import { parseUrlInput } from '../core/validation';

export interface UrlComponents {
  input: string;
  valid: boolean;
  href: string;
  protocol: string | null;
  username: string | null;
  password: string | null;
  host: string | null;
  hostname: string | null;
  port: string | null;
  defaultPort: boolean;
  pathname: string | null;
  search: string | null;
  hash: string | null;
  origin: string | null;
  isIpLiteral: boolean;
  isPunycode: boolean;
  warnings: string[];
}

export function urlComponents(input: { url: string }): UrlComponents {
  const raw = (input.url ?? '').trim();
  if (raw.length === 0) throw invalidInput('Enter a URL.');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalidInput('That is not a valid absolute URL. Include the scheme, for example https://example.com/path?q=1.');
  }

  const warnings: string[] = [];
  const defaultPort = (parsed.protocol === 'https:' && (parsed.port === '' || parsed.port === '443')) || (parsed.protocol === 'http:' && (parsed.port === '' || parsed.port === '80'));
  if (parsed.username || parsed.password) warnings.push('The URL embeds credentials. Browsers usually strip these, and they leak into logs and referrers.');
  if (parsed.protocol === 'http:') warnings.push('The URL uses plain HTTP; everything in the request and response can be read in transit.');
  if (/^xn--/i.test(parsed.hostname)) warnings.push('The hostname is punycode (an internationalised domain). Decode it with the Punycode tool before trusting it — homograph attacks rely on this.');
  if (parsed.port && !defaultPort && (parsed.port === '8080' || parsed.port === '8443')) warnings.push('A non-standard port is in use; make sure the destination really is the service you expect.');
  if (parsed.hash.length > 0) warnings.push('The fragment (#…) is never sent to the server; it is handled entirely by the browser.');

  const literal = /^\[?[0-9a-f:.]+\]?$/i.test(parsed.hostname) && /[:.]/.test(parsed.hostname) && !/[g-z]/i.test(parsed.hostname);

  return {
    input: raw,
    valid: true,
    href: parsed.href,
    protocol: parsed.protocol,
    username: parsed.username || null,
    password: parsed.password ? '(present, hidden)' : null,
    host: parsed.host,
    hostname: parsed.hostname,
    port: parsed.port || null,
    defaultPort,
    pathname: parsed.pathname,
    search: parsed.search || null,
    hash: parsed.hash || null,
    origin: parsed.origin === 'null' ? null : parsed.origin,
    isIpLiteral: literal,
    isPunycode: /(^|\.)xn--/i.test(parsed.hostname),
    warnings,
  };
}

export interface QueryParameter {
  index: number;
  key: string;
  value: string;
  decodedKey: string;
  decodedValue: string;
  suspicious: string[];
}

const SENSITIVE_PARAMS = ['token', 'access_token', 'apikey', 'api_key', 'key', 'secret', 'password', 'passwd', 'pwd', 'session', 'sessionid', 'auth', 'authorization', 'sig', 'signature', 'code'];
const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'igshid', '_ga', 'yclid', 'dclid'];

export function urlParameters(input: { url: string }): { parameters: QueryParameter[]; tracking: string[]; sensitive: string[]; notes: string[] } {
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    throw invalidInput('That is not a valid absolute URL.');
  }
  const parameters: QueryParameter[] = [];
  let index = 0;
  for (const [key, value] of parsed.searchParams) {
    const suspicious: string[] = [];
    const lower = key.toLowerCase();
    if (SENSITIVE_PARAMS.includes(lower) || /token|secret|password|session/i.test(lower)) {
      suspicious.push('Looks like a credential or session identifier. URLs leak into logs, Referer headers and browser history — tokens belong in headers or cookies.');
    }
    if (TRACKING_PARAMS.includes(lower)) suspicious.push('Campaign/tracking parameter.');
    if (/^(?:\/\/|https?:|\/)/i.test(value)) suspicious.push('The value looks like a URL; check whether it is used to redirect the request (an open redirect).');
    if (/[<>"'`]/.test(value)) suspicious.push('The value contains HTML-significant characters, which is one step away from reflected XSS if the site echoes it unescaped.');
    parameters.push({
      index,
      key,
      value,
      decodedKey: safeDecode(key),
      decodedValue: safeDecode(value),
      suspicious,
    });
    index += 1;
  }

  return {
    parameters,
    tracking: parameters.filter((parameter) => TRACKING_PARAMS.includes(parameter.key.toLowerCase())).map((parameter) => parameter.key),
    sensitive: parameters.filter((parameter) => SENSITIVE_PARAMS.includes(parameter.key.toLowerCase())).map((parameter) => parameter.key),
    notes: [
      'Parameters are shown in the order the URL carries them. Duplicate keys are kept as separate entries because URLSearchParams preserves them.',
      'This is a reading tool: the URL is not requested and no parameter is interpreted.',
    ],
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveUrl(input: { base: string; relative: string }): { resolved: string | null; error: string | null; notes: string[] } {
  try {
    const base = new URL(input.base);
    return {
      resolved: new URL(input.relative, base).toString(),
      error: null,
      notes: ['Resolution follows the WHATWG URL rules — the same algorithm a browser uses for links and redirects.'],
    };
  } catch {
    return { resolved: null, error: 'Either the base URL or the relative reference is not parseable.', notes: [] };
  }
}

export interface CampaignUrlResult {
  base: string;
  url: string;
  added: Array<{ key: string; value: string }>;
  existing: Array<{ key: string; value: string }>;
  notes: string[];
}

export function buildCampaignUrl(input: { url: string; source: string; medium: string; campaign: string; term?: string; content?: string }): CampaignUrlResult {
  const parsed = new URL(input.url.trim());
  const additions: Array<{ key: string; value: string }> = [
    { key: 'utm_source', value: input.source },
    { key: 'utm_medium', value: input.medium },
    { key: 'utm_campaign', value: input.campaign },
  ];
  if (input.term) additions.push({ key: 'utm_term', value: input.term });
  if (input.content) additions.push({ key: 'utm_content', value: input.content });

  const existing: Array<{ key: string; value: string }> = [];
  for (const [key, value] of parsed.searchParams) {
    if (key.startsWith('utm_')) existing.push({ key, value });
  }
  for (const addition of additions) {
    if (addition.value.trim().length === 0) throw invalidInput(`The ${addition.key} value cannot be empty.`);
    parsed.searchParams.set(addition.key, addition.value.trim());
  }

  return {
    base: input.url,
    url: parsed.toString(),
    added: additions,
    existing,
    notes: [
      existing.length > 0 ? 'The URL already carried UTM parameters; the new values replaced those keys and left any other UTM keys untouched.' : 'No UTM parameters were present on the URL.',
      'Campaign values are case-sensitive to analytics platforms: "Email" and "email" are different traffic sources. CloudHost247 lower-cases nothing.',
    ],
  };
}

export function stripTracking(input: { url: string }): { url: string; removed: Array<{ key: string; value: string }>; notes: string[] } {
  const parsed = new URL(input.url.trim());
  const removed: Array<{ key: string; value: string }> = [];
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.includes(key.toLowerCase())) {
      removed.push({ key, value: parsed.searchParams.get(key) ?? '' });
      parsed.searchParams.delete(key);
    }
  }
  return {
    url: parsed.toString(),
    removed,
    notes: [
      removed.length > 0
        ? 'Only the well-known campaign/tracking keys listed in this tool were removed. A site may add its own parameters with the same effect.'
        : 'No known tracking parameter was found. This does not mean the link is free of tracking: the destination may set cookies instead.',
    ],
  };
}

export interface UrlComparison {
  equal: boolean;
  differences: Array<{ component: string; first: string | null; second: string | null; note: string }>;
  notes: string[];
}

export function compareUrls(input: { first: string; second: string }): UrlComparison {
  const first = new URL(input.first.trim());
  const second = new URL(input.second.trim());
  const differences: UrlComparison['differences'] = [];
  const compare = (component: string, a: string | null, b: string | null, note: string): void => {
    if (a !== b) differences.push({ component, first: a, second: b, note });
  };

  compare('protocol', first.protocol, second.protocol, 'A scheme change (http → https) is a different origin.');
  compare('hostname', first.hostname.toLowerCase(), second.hostname.toLowerCase(), 'Hostnames are compared case-insensitively.');
  compare('port', first.port || '(default)', second.port || '(default)', 'The default port for the scheme is treated as absent.');
  compare('pathname', first.pathname, second.pathname, 'Paths are compared exactly, including a trailing slash — servers frequently treat them differently.');
  const firstParams = [...first.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const secondParams = [...second.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  compare('query', JSON.stringify(firstParams), JSON.stringify(secondParams), 'Query parameters are compared as a sorted set, so ordering alone does not make URLs different.');
  compare('fragment', first.hash || null, second.hash || null, 'A fragment difference does not change what the server sends.');

  return {
    equal: differences.length === 0,
    differences,
    notes: [
      differences.length === 0 ? 'The two URLs are equivalent after normalisation (scheme/host case, default port, query order and fragment).' : 'The listed components differ. Some differences (fragment, query order) may not matter to the server; the path and host always do.',
      'This comparison does not follow redirects. Two different URLs can still reach the same page.',
    ],
  };
}

export { parseUrlInput as parseUrl, invalidInput as urlInvalidInput };
