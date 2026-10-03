/**
 * Tools Center — outbound target validation and the SSRF-safe HTTP client (spec §30, §34, §69).
 *
 * This is the single chokepoint through which every tool that fetches a user-supplied URL must
 * pass. It is deliberately paranoid:
 *
 *  1. Only http/https are allowed; URLs carrying credentials are rejected.
 *  2. The hostname is resolved to ALL of its addresses; every address must be public. A single
 *     private/reserved answer blocks the request (DNS round-robin cannot smuggle one in).
 *  3. The connection is PINNED to the validated address (`lookup` override on the socket), so the
 *     address that was validated is the address that is dialled. A hostname that re-resolves
 *     between validation and connection — classic DNS rebinding — has no window to do so.
 *  4. Redirects are followed manually, never by the HTTP client, so every hop goes through the
 *     same validation, with a hard hop limit.
 *  5. Response size and total duration are bounded by the caller's limits.
 *  6. Hostnames without a dot (`localhost`, `intranet`, …) and well-known metadata hostnames are
 *     rejected outright, before any DNS traffic.
 *
 * Blocked ranges (spec §69, plus the equivalents that spec's list omits):
 *   IPv4  0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24,
 *         192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4
 *   IPv6  ::, ::1, ::ffff:0:0/96 (IPv4-mapped → validated as IPv4), 64:ff9b::/96 (NAT64 →
 *         validated as the embedded IPv4), 100::/64, 2001::/32 (Teredo), 2002::/16 (6to4 →
 *         validated as the embedded IPv4), fc00::/7, fe80::/10, ff00::/8
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import net from 'node:net';
import { targetBlocked, invalidInput, timeoutError, ToolError } from './errors';

export const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata.azure.internal',
]);

export interface ParsedIp {
  version: 4 | 6;
  /** Canonical lowercase text form (IPv6 compressed). */
  normalized: string;
  bytes: number[];
}

/** Parses IPv4 or IPv6 text into bytes. Returns null when the input is not a valid address. */
export function parseIp(input: string): ParsedIp | null {
  const value = input.trim();
  if (value.length === 0) return null;
  if (value.includes(':')) {
    const bytes = parseIpv6(value);
    if (!bytes) return null;
    return { version: 6, normalized: formatIpv6(bytes), bytes };
  }
  const bytes = parseIpv4(value);
  if (!bytes) return null;
  return { version: 4, normalized: formatIpv4(bytes), bytes };
}

export function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

export function parseIpv6(value: string): number[] | null {
  let text = value.trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  // Zone index (fe80::1%eth0) is not a routable address form we accept.
  if (text.includes('%')) return null;
  if (text.length === 0) return null;

  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  if (lastColon >= 0 && text.slice(lastColon + 1).includes('.')) {
    // Embedded IPv4 (e.g. ::ffff:192.0.2.1)
    const embedded = parseIpv4(text.slice(lastColon + 1));
    if (!embedded) return null;
    tail = [(embedded[0]! << 8) | embedded[1]!, (embedded[2]! << 8) | embedded[3]!];
    text = text.slice(0, lastColon + 1) + '0:0';
  }

  const doubleColon = text.indexOf('::');
  if (doubleColon !== -1 && text.indexOf('::', doubleColon + 1) !== -1) return null;

  const parseGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups: number[] = [];
    for (const group of segment.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  let headGroups: number[];
  let tailGroups: number[];
  if (doubleColon === -1) {
    const groups = parseGroups(text);
    if (!groups) return null;
    if (groups.length !== 8) return null;
    headGroups = groups;
    tailGroups = [];
  } else {
    const head = parseGroups(text.slice(0, doubleColon));
    const rest = parseGroups(text.slice(doubleColon + 2));
    if (!head || !rest) return null;
    if (head.length + rest.length > 7) return null;
    headGroups = head;
    tailGroups = rest;
  }

  const words = [...headGroups, ...tailGroups, ...tail];
  if (words.length > 8) return null;
  const bytes: number[] = [];
  for (const word of words) {
    bytes.push((word >> 8) & 0xff, word & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

export function formatIpv4(bytes: number[]): string {
  return bytes.join('.');
}

export function formatIpv6(bytes: number[]): string {
  const words: number[] = [];
  for (let i = 0; i < 16; i += 2) words.push(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));

  // Longest run of zero words (length >= 2) is compressed, per RFC 5952 §4.2.1.
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  for (let i = 0; i <= words.length; i += 1) {
    const isZero = i < words.length && words[i] === 0;
    if (isZero && start === -1) start = i;
    if (!isZero && start !== -1) {
      const length = i - start;
      if (length > bestLength) {
        bestLength = length;
        bestStart = start;
      }
      start = -1;
    }
  }
  if (bestLength < 2) {
    bestStart = -1;
    bestLength = 0;
  }

  const parts: string[] = [];
  let i = 0;
  while (i < words.length) {
    if (i === bestStart) {
      parts.push('');
      i += bestLength;
      if (i === words.length) parts.push('');
      continue;
    }
    parts.push((words[i] ?? 0).toString(16));
    i += 1;
  }
  const joined = parts.join(':');
  return joined === '' ? '::' : joined;
}

/** True for IPv4-mapped IPv6 (`::ffff:a.b.c.d`). */
export function isIpv4Mapped(bytes: number[]): boolean {
  return (
    bytes.length === 16 &&
    bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  );
}

/** Extracts the embedded IPv4 bytes from an IPv4-mapped, 6to4 or NAT64 address. */
export function embeddedIpv4(bytes: number[]): number[] | null {
  if (bytes.length !== 16) return null;
  if (isIpv4Mapped(bytes)) return bytes.slice(12, 16);
  // 2002::/16 — 6to4 embeds the IPv4 address in bytes 2..6
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6);
  // 64:ff9b::/96 — NAT64 embeds the IPv4 address in the last 4 bytes
  const nat64Prefix = [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0];
  if (nat64Prefix.every((b, i) => bytes[i] === b)) return bytes.slice(12, 16);
  // 2001::/32 — Teredo embeds the client IPv4 in the last 4 bytes (obfuscated)
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return bytes.slice(12, 16).map((b) => b ^ 0xff);
  }
  return null;
}

function inIpv4Range(bytes: number[], network: number[], bits: number): boolean {
  const full = Math.floor(bits / 8);
  for (let i = 0; i < full; i += 1) {
    if (bytes[i] !== network[i]) return false;
  }
  const remainder = bits % 8;
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (((bytes[full] ?? 0) ^ (network[full] ?? 0)) & mask) === 0;
}

const IPV4_BLOCKED_RANGES: Array<{ network: number[]; bits: number; label: string }> = [
  { network: [0, 0, 0, 0], bits: 8, label: '0.0.0.0/8 (this network)' },
  { network: [10, 0, 0, 0], bits: 8, label: '10.0.0.0/8 (private)' },
  { network: [100, 64, 0, 0], bits: 10, label: '100.64.0.0/10 (carrier-grade NAT)' },
  { network: [127, 0, 0, 0], bits: 8, label: '127.0.0.0/8 (loopback)' },
  { network: [169, 254, 0, 0], bits: 16, label: '169.254.0.0/16 (link-local / cloud metadata)' },
  { network: [172, 16, 0, 0], bits: 12, label: '172.16.0.0/12 (private)' },
  { network: [192, 0, 0, 0], bits: 24, label: '192.0.0.0/24 (IETF protocol assignments)' },
  { network: [192, 0, 2, 0], bits: 24, label: '192.0.2.0/24 (TEST-NET-1)' },
  { network: [192, 88, 99, 0], bits: 24, label: '192.88.99.0/24 (6to4 relay anycast)' },
  { network: [192, 168, 0, 0], bits: 16, label: '192.168.0.0/16 (private)' },
  { network: [198, 18, 0, 0], bits: 15, label: '198.18.0.0/15 (benchmarking)' },
  { network: [198, 51, 100, 0], bits: 24, label: '198.51.100.0/24 (TEST-NET-2)' },
  { network: [203, 0, 113, 0], bits: 24, label: '203.0.113.0/24 (TEST-NET-3)' },
  { network: [224, 0, 0, 0], bits: 4, label: '224.0.0.0/4 (multicast)' },
  { network: [240, 0, 0, 0], bits: 4, label: '240.0.0.0/4 (reserved)' },
];

/**
 * Classifies an address. Returns the blocking reason, or null when the address is a normal
 * globally-routable public address that a tool may contact.
 */
export function blockedReason(input: string): string | null {
  const parsed = parseIp(input);
  if (!parsed) return 'Not a valid IP address';
  if (parsed.version === 4) {
    const hit = IPV4_BLOCKED_RANGES.find((range) => inIpv4Range(parsed.bytes, range.network, range.bits));
    if (hit) return hit.label;
    if (parsed.bytes.every((b) => b === 255)) return '255.255.255.255 (broadcast)';
    return null;
  }

  const bytes = parsed.bytes;
  const embedded = embeddedIpv4(bytes);
  if (embedded) {
    const hit = IPV4_BLOCKED_RANGES.find((range) => inIpv4Range(embedded, range.network, range.bits));
    if (hit) return `Encapsulated IPv4 address in blocked range: ${hit.label}`;
  }
  const isZero = bytes.every((b) => b === 0);
  if (isZero) return ':: (unspecified)';
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return '::1 (loopback)';
  if (inIpv4Range(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], 96)) return '64:ff9b::/96 (NAT64)';
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && bytes[2] === 0 && bytes[3] === 0 && bytes.slice(4, 8).every((b) => b === 0)) {
    return '100::/64 (discard-only)';
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return '2001::/32 (Teredo)';
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return '2002::/16 (6to4)';
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return '2001:db8::/32 (documentation)';
  }
  if ((bytes[0]! & 0xfe) === 0xfc) return 'fc00::/7 (unique local)';
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return 'fe80::/10 (link-local)';
  if (bytes[0] === 0xff) return 'ff00::/8 (multicast)';
  return null;
}

export function isPublicIp(input: string): boolean {
  return blockedReason(input) === null;
}

export interface ValidatedTarget {
  hostname: string;
  ips: string[];
  port: number;
  protocol: 'http:' | 'https:';
}

function assertHostnameSyntax(hostname: string): void {
  const lowered = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(lowered)) throw targetBlocked(`"${hostname}" is a local/metadata hostname and cannot be queried.`);
  if (parseIp(lowered)) return;
  if (!lowered.includes('.')) {
    throw targetBlocked(`"${hostname}" is not a public hostname (no dot-separated domain).`);
  }
  if (!/^[a-z0-9.-]+$/.test(lowered)) {
    throw invalidInput('The hostname contains characters that are not valid in a DNS name.');
  }
  for (const label of lowered.split('.')) {
    if (label.length === 0 || label.length > 63) throw invalidInput('The hostname contains an invalid label length.');
    if (label.startsWith('-') || label.endsWith('-')) throw invalidInput('The hostname contains an invalid label.');
  }
  if (lowered.endsWith('.local') || lowered.endsWith('.internal') || lowered.endsWith('.localhost')) {
    throw targetBlocked(`"${hostname}" resolves inside a private namespace.`);
  }
}

/**
 * Validates a user-supplied URL for outbound fetching: scheme, credentials, hostname syntax and
 * every resolved address. The returned `ips` are the addresses the caller must dial.
 */
export async function validateUrl(url: URL, options: { allowHttp?: boolean } = {}): Promise<ValidatedTarget> {
  const allowHttp = options.allowHttp ?? true;
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw invalidInput(`Only http and https URLs can be checked (received "${url.protocol}").`);
  }
  if (url.username || url.password) throw invalidInput('URLs containing credentials are not accepted.');
  if (url.hostname.length === 0) throw invalidInput('The URL has no hostname.');
  assertHostnameSyntax(url.hostname);

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalidInput('The URL has an invalid port.');

  const ips = await resolvePublicAddresses(url.hostname);
  return { hostname: url.hostname, ips, port, protocol: url.protocol === 'https:' ? 'https:' : 'http:' };
}

/**
 * Resolves a hostname and asserts every answer is public. A literal IP hostname is validated
 * directly without a lookup. DNS failures surface as INVALID_INPUT/DNS_LOOKUP_FAILED — never as
 * a silently empty result.
 */
export async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  const literal = parseIp(hostname.replace(/^\[|\]$/g, ''));
  if (literal) {
    const reason = blockedReason(literal.normalized);
    if (reason) throw targetBlocked(`"${hostname}" is not a public address (${reason}).`);
    return [literal.normalized];
  }

  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ToolError('DNS_LOOKUP_FAILED', `The hostname "${hostname}" could not be resolved.`);
  }
  if (answers.length === 0) throw new ToolError('DNS_LOOKUP_FAILED', `The hostname "${hostname}" has no address records.`);

  for (const answer of answers) {
    const reason = blockedReason(answer.address);
    if (reason) {
      // Never dial a hostname that resolves (even partly) into private space: reporting which
      // address was blocked is useful, leaking the internal topology is not, so the range label
      // only names the well-known range.
      throw targetBlocked(`"${hostname}" resolves to a non-public address (${reason}).`);
    }
  }
  return answers.map((a) => a.address);
}

export interface FetchOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: Record<string, string>;
  body?: Buffer | string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowHttp?: boolean;
  userAgent?: string;
  /** When true, a self-signed/invalid certificate is reported to the caller instead of throwing. */
  tolerateTlsError?: boolean;
}

export interface FetchRedirect {
  url: string;
  status: number;
  location: string;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Lower-cased header names mapped to every value received (set-cookie repeats). */
  rawHeaders: Record<string, string[]>;
  body: Buffer;
  bodyText: string;
  truncated: boolean;
  redirects: FetchRedirect[];
  ip: string;
  tlsError?: string;
  durationMs: number;
}

const DEFAULT_USER_AGENT = 'CloudHost247-ToolsCenter/1.0 (+https://www.cloudhost247.com; diagnostics)';

function headerValue(headers: http.IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

function decompress(buffer: Buffer, encoding: string): Buffer {
  try {
    if (encoding.includes('br')) return brotliDecompressSync(buffer);
    if (encoding.includes('gzip')) return gunzipSync(buffer);
    if (encoding.includes('deflate')) return inflateSync(buffer);
  } catch {
    return buffer;
  }
  return buffer;
}

function singleRequest(
  url: URL,
  pinnedIp: string,
  options: FetchOptions
): Promise<{ status: number; statusText: string; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean; tlsError?: string }> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const timeoutMs = options.timeoutMs ?? 8000;
    const maxBytes = options.maxBytes ?? 512 * 1024;
    const family = parseIp(pinnedIp)?.version === 6 ? 6 : 4;

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : isHttps ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? 'GET',
        headers: {
          host: url.host,
          accept: '*/*',
          'accept-encoding': 'gzip, deflate, br',
          'user-agent': options.userAgent ?? DEFAULT_USER_AGENT,
          ...(options.headers ?? {}),
        },
        // Pin the TCP connection to the address that was validated. Node still uses
        // `url.hostname` for SNI and the Host header, so TLS verification is unaffected.
        lookup: (_hostname, _opts, callback) => {
          callback(null, pinnedIp, family);
        },
        ...(isHttps
          ? {
              rejectUnauthorized: !options.tolerateTlsError,
              servername: url.hostname,
            }
          : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        response.on('data', (chunk: Buffer) => {
          if (truncated) return;
          total += chunk.length;
          if (total > maxBytes) {
            const remaining = maxBytes - (total - chunk.length);
            chunks.push(chunk.subarray(0, Math.max(remaining, 0)));
            truncated = true;
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () => {
          const raw = Buffer.concat(chunks);
          const body = options.method === 'HEAD' ? Buffer.alloc(0) : decompress(raw, headerValue(response.headers, 'content-encoding'));
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: response.headers,
            body,
            truncated,
          });
        };
        response.on('end', finish);
        response.on('close', finish);
        response.on('error', finish);
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('TOOL_REQUEST_TIMEOUT'));
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      if (error.message === 'TOOL_REQUEST_TIMEOUT') {
        reject(timeoutError(`The request to ${url.hostname}`));
        return;
      }
      if (error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED' || String(error.code ?? '').startsWith('ERR_TLS')) {
        reject(new ToolError('PROVIDER_ERROR', `TLS error: ${error.code ?? error.message}`, { tlsCode: error.code ?? null }));
        return;
      }
      reject(new ToolError('PROVIDER_ERROR', `The request to ${url.hostname} failed: ${error.code ?? error.message}`));
    });

    if (options.body) request.write(options.body);
    request.end();
  });
}

/**
 * Bounded, SSRF-safe HTTP request with manual redirect following and address pinning.
 * Every redirect target is re-validated (including its DNS answers) before being dialled.
 */
export async function fetchWithGuard(input: string, options: FetchOptions = {}): Promise<FetchResult> {
  const startedAt = Date.now();
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalidInput('That is not a valid URL. Include the scheme, e.g. https://example.com/');
  }

  const redirects: FetchRedirect[] = [];
  const maxRedirects = Math.min(Math.max(options.maxRedirects ?? 5, 0), 10);
  let current = url;
  let tlsError: string | undefined;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const target = await validateUrl(current, { allowHttp: options.allowHttp ?? true });
    const ip = target.ips[0];
    if (!ip) throw new ToolError('DNS_LOOKUP_FAILED', `No usable address for ${current.hostname}.`);

    let response: Awaited<ReturnType<typeof singleRequest>>;
    try {
      response = await singleRequest(current, ip, options);
      tlsError = undefined;
    } catch (error) {
      if (options.tolerateTlsError && error instanceof ToolError && error.code === 'PROVIDER_ERROR' && error.message.startsWith('TLS error')) {
        tlsError = error.message;
        response = { status: 0, statusText: '', headers: {}, body: Buffer.alloc(0), truncated: false };
      } else {
        throw error;
      }
    }

    const location = headerValue(response.headers, 'location');
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop === maxRedirects) {
        throw new ToolError('PROVIDER_ERROR', `The request exceeded the ${maxRedirects}-redirect limit.`);
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new ToolError('PROVIDER_ERROR', 'The server returned an unparseable redirect target.');
      }
      redirects.push({ url: current.toString(), status: response.status, location: next.toString() });
      current = next;
      continue;
    }

    const rawHeaders: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      const lowered = key.toLowerCase();
      if (value === undefined) continue;
      rawHeaders[lowered] = Array.isArray(value) ? value : [String(value)];
    }

    return {
      url: url.toString(),
      finalUrl: current.toString(),
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(Object.entries(rawHeaders).map(([k, v]) => [k, v.join(', ')])),
      rawHeaders,
      body: response.body,
      bodyText: response.body.toString('utf8'),
      truncated: response.truncated,
      redirects,
      ip,
      ...(tlsError ? { tlsError } : {}),
      durationMs: Date.now() - startedAt,
    };
  }

  throw new ToolError('PROVIDER_ERROR', 'Too many redirects.');
}

/** TCP reachability probe used by tooling that must not assume ICMP is available. */
export async function tcpConnect(
  host: string,
  port: number,
  timeoutMs: number,
  options: { requirePublic?: boolean } = {}
): Promise<{ ok: true; latencyMs: number; ip: string } | { ok: false; latencyMs: number; ip: string | null; error: string }> {
  const requirePublic = options.requirePublic ?? true;
  const startedAt = Date.now();

  let ip: string | null = null;
  if (parseIp(host.replace(/^\[|\]$/g, ''))) {
    ip = parseIp(host.replace(/^\[|\]$/g, ''))!.normalized;
    if (requirePublic) {
      const reason = blockedReason(ip);
      if (reason) throw targetBlocked(`"${host}" is not a public address (${reason}).`);
    }
  } else {
    assertHostnameSyntax(host);
    const ips = await resolvePublicAddresses(host);
    ip = ips[0] ?? null;
    if (!ip) throw new ToolError('DNS_LOOKUP_FAILED', `"${host}" did not resolve.`);
  }

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result: { ok: true; latencyMs: number; ip: string } | { ok: false; latencyMs: number; ip: string | null; error: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, latencyMs: Date.now() - startedAt, ip: ip! }));
    socket.once('timeout', () => finish({ ok: false, latencyMs: Date.now() - startedAt, ip, error: 'TIMEOUT' }));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish({ ok: false, latencyMs: Date.now() - startedAt, ip, error: error.code ?? error.message })
    );
    socket.connect(port, ip);
  });
}
