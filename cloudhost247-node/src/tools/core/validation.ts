/**
 * Tools Center — shared input parsing and normalisation (spec §73, §85).
 *
 * Two jobs, both boring on purpose:
 *
 *  1. Turn user input into a canonical form ONCE, so every tool downstream (service, cache key,
 *     history target, audit log) sees exactly the same value. A tool that normalises differently
 *     from its neighbours is how a cache key and a history row end up disagreeing.
 *  2. Sanitise untrusted text before it reaches a human-readable explanation. Tool explanations are
 *     built from remote data — a TLS subject, an HTTP header, a WHOIS field — and that data can
 *     contain control characters, bidirectional overrides or zero-width joiners whose entire
 *     purpose is to make displayed text differ from the bytes. None of it is instruction, and none
 *     of it is allowed to survive into a prompt or a rendered string.
 */
import { invalidInput } from './errors';
import { blockedReason, formatIpv4, formatIpv6, parseIp as parseIpLiteral } from './ssrf';
import { DOMAIN_PATTERN, normalizeDomain } from '../dns/common';

export { DOMAIN_PATTERN, normalizeDomain, parseIpLiteral };

// ---------------------------------------------------------------------------------------------
// Domains and hostnames
// ---------------------------------------------------------------------------------------------

const MAX_DOMAIN_LENGTH = 253;

export interface DomainInspection {
  domain: string;
  ascii: string;
  labels: string[];
  tld: string;
  sld: string;
  subdomain: string | null;
  labelCount: number;
  isPunycode: boolean;
  notes: string[];
}

/**
 * Checks the syntax rules that a single label must satisfy, plus the ones that are easy to get
 * wrong: label length, leading/trailing hyphen, a numeric-only TLD and the 253-character total.
 */
export function inspectDomain(input: string): DomainInspection {
  const domain = normalizeDomain(input);
  const labels = domain.split('.');
  const notes: string[] = [];

  if (domain.length > MAX_DOMAIN_LENGTH) throw invalidInput(`A domain name may not exceed ${MAX_DOMAIN_LENGTH} characters.`);
  if (labels.length < 2) throw invalidInput('A domain name needs at least one dot (a second-level domain and a TLD).');
  if (!DOMAIN_PATTERN.test(domain)) {
    notes.push('The name does not match the classic hostname grammar; it is still queryable, but check for stray characters.');
  }
  for (const label of labels) {
    if (label.length > 63) throw invalidInput(`The label "${label.slice(0, 20)}…" exceeds the 63-character DNS limit.`);
  }
  const tld = labels[labels.length - 1] ?? '';
  if (/^\d+$/.test(tld)) throw invalidInput(`"${tld}" is an all-numeric top-level label, which cannot be a real TLD.`);

  const subdomain = labels.length > 2 ? labels.slice(0, labels.length - 2).join('.') : null;
  return {
    domain,
    ascii: domain,
    labels,
    tld,
    sld: labels[labels.length - 2] ?? '',
    subdomain,
    labelCount: labels.length,
    isPunycode: labels.some((label) => label.startsWith('xn--')),
    notes,
  };
}

/** Validates an e-mail address to the degree that is useful for DNS-side checks (syntax only). */
export function parseEmailInput(input: string): { address: string; localPart: string; domain: string; notes: string[] } {
  const address = input.trim();
  if (address.length === 0) throw invalidInput('Enter an e-mail address.');
  if (address.length > 254) throw invalidInput('An e-mail address may not exceed 254 characters.');
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) throw invalidInput('Enter a complete e-mail address (name@example.com).');
  const localPart = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (localPart.length > 64) throw invalidInput('The part before "@" may not exceed 64 characters.');
  if (/[\s,]/.test(address)) throw invalidInput('An e-mail address may not contain spaces or commas.');

  const notes: string[] = [];
  if (/^".*"$/.test(localPart)) notes.push('The local part is quoted. Some mail systems handle quoted local parts inconsistently; a plain address is more portable.');
  const inspection = inspectDomain(domain);
  try {
    // A domain literal (user@[192.0.2.1]) is legal in RFC 5321 but almost never usable for the
    // checks in this Tools Center, so it is reported rather than silently treated as a name.
    if (domain.startsWith('[') && domain.endsWith(']')) {
      const literal = parseIpLiteral(domain.slice(1, -1));
      if (!literal) throw invalidInput('The bracketed domain literal is not a valid IP address.');
      notes.push('The address uses an IP literal. DNS-based checks (MX, SPF, DMARC) cannot apply to an IP literal.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('IP literal')) throw error;
  }
  return { address, localPart, domain: inspection.domain, notes };
}

// ---------------------------------------------------------------------------------------------
// IPs and CIDR
// ---------------------------------------------------------------------------------------------

export interface ParsedCidr {
  input: string;
  address: string;
  version: 4 | 6;
  prefix: number;
  network: string;
  firstAddress: string;
  lastAddress: string;
  addressCount: bigint;
  isPublic: boolean;
  blockedReason: string | null;
  notes: string[];
}

export function parseCidrInput(input: string, options: { version?: 4 | 6 } = {}): ParsedCidr {
  const value = input.trim().replace(/[\/\s]+$/, '');
  if (value.length === 0) throw invalidInput('Enter a CIDR block such as 203.0.113.0/24 or 2001:db8::/32.');
  const slash = value.indexOf('/');
  const addressText = slash === -1 ? value : value.slice(0, slash);
  const prefixText = slash === -1 ? null : value.slice(slash + 1).trim();
  const literal = parseIpLiteral(addressText);
  if (!literal) throw invalidInput(`"${addressText}" is not a valid IPv4 or IPv6 address.`);
  if (options.version && literal.version !== options.version) {
    throw invalidInput(`Expected an IPv${options.version} address, received an IPv${literal.version} address.`);
  }

  const maxPrefix = literal.version === 4 ? 32 : 128;
  const prefix = prefixText === null ? maxPrefix : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    throw invalidInput(`For IPv${literal.version} the prefix length must be between 0 and ${maxPrefix}.`);
  }
  if (literal.version === 4 && prefix === 31 && !prefixText) {
    throw invalidInput('Enter the prefix length explicitly (a bare address is a /32 host route).');
  }

  const bits = BigInt(literal.version === 4 ? 32 : 128);
  const addressNumber = bytesToBigInt(literal.bytes);
  const hostBits = BigInt(maxPrefix - prefix);
  const mask = hostBits === 0n ? 0n : (1n << bits) - (1n << hostBits);
  const networkNumber = addressNumber & mask;
  const broadcastNumber = networkNumber | (((1n << hostBits) - 1n) & ((1n << bits) - 1n));
  const count = 1n << hostBits;

  const notes: string[] = [];
  const reason = blockedReason(literal.normalized);
  if (reason) notes.push(`This block is in a non-public range (${reason}); diagnostic tools will refuse to probe addresses inside it.`);
  if (literal.version === 4 && prefix === 31) notes.push('A /31 has exactly two addresses; RFC 3021 allows both to be used as host addresses on point-to-point links.');
  if (literal.version === 4 && prefix >= 30 && prefix !== 31) notes.push('A /30 is the smallest conventional subnet: two usable host addresses plus network and broadcast.');
  if (count > 65536n) notes.push(`This block contains ${count.toString()} addresses; subnet splitting is limited to reasonable sizes.`);

  return {
    input: value,
    address: literal.normalized,
    version: literal.version,
    prefix,
    network: bigIntToAddress(networkNumber, literal.version),
    firstAddress: bigIntToAddress(networkNumber, literal.version),
    lastAddress: bigIntToAddress(broadcastNumber, literal.version),
    addressCount: count,
    isPublic: reason === null,
    blockedReason: reason,
    notes,
  };
}

function bytesToBigInt(bytes: number[]): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToAddress(value: bigint, version: 4 | 6): string {
  const byteLength = version === 4 ? 4 : 16;
  const bytes: number[] = [];
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes.unshift(Number((value >> BigInt(index * 8)) & 0xffn));
  }
  return version === 4 ? formatIpv4(bytes) : formatIpv6(bytes);
}

// ---------------------------------------------------------------------------------------------
// URLs, ports and hashes
// ---------------------------------------------------------------------------------------------

export interface ParsedUrlInput {
  url: string;
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number | null;
  pathAndQuery: string;
  isIpLiteral: boolean;
  notes: string[];
}

export function parseUrlInput(input: string, options: { allowHttp?: boolean } = {}): ParsedUrlInput {
  const value = input.trim();
  if (value.length === 0) throw invalidInput('Enter a URL.');
  if (value.length > 2048) throw invalidInput('URLs longer than 2048 characters are not accepted.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidInput('That is not a valid URL. Include the scheme, for example https://example.com/path.');
  }
  if (url.username || url.password) throw invalidInput('URLs containing credentials are not accepted.');
  const allowHttp = options.allowHttp ?? true;
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw invalidInput(`Only http and https URLs are accepted (received "${url.protocol}").`);
  }
  if (url.hostname.length === 0) throw invalidInput('The URL has no hostname.');

  const notes: string[] = [];
  if (url.protocol === 'http:') notes.push('This is a plain-HTTP URL; the request and response are not encrypted in transit.');
  if (url.hash) notes.push('The fragment after "#" is never sent to the server and was ignored by the check.');
  const literal = parseIpLiteral(url.hostname.replace(/^\[|\]$/g, ''));
  if (literal) {
    const reason = blockedReason(literal.normalized);
    if (reason) throw invalidInput(`"${url.hostname}" is not a public address (${reason}).`);
    notes.push('The URL uses an IP literal rather than a hostname, so certificate hostname matching is limited to the address itself.');
  }

  return {
    url: url.toString(),
    protocol: url.protocol === 'https:' ? 'https:' : 'http:',
    hostname: url.hostname,
    port: url.port ? Number(url.port) : null,
    pathAndQuery: `${url.pathname}${url.search}`,
    isIpLiteral: literal !== null,
    notes,
  };
}

export function parsePortInput(input: string | number): number {
  const value = typeof input === 'number' ? input : Number(input.trim());
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw invalidInput('The port must be a whole number between 1 and 65535.');
  return value;
}

export function parseBoundedInteger(input: unknown, options: { min: number; max: number; name: string; defaultValue?: number }): number {
  if (input === undefined || input === null || input === '') {
    if (options.defaultValue !== undefined) return options.defaultValue;
    throw invalidInput(`Enter ${options.name}.`);
  }
  const value = typeof input === 'number' ? input : Number(String(input).trim());
  if (!Number.isInteger(value)) throw invalidInput(`${options.name} must be a whole number.`);
  if (value < options.min || value > options.max) throw invalidInput(`${options.name} must be between ${options.min} and ${options.max}.`);
  return value;
}

export type HashKind = 'md5' | 'sha1' | 'sha256' | 'sha512' | 'crc32' | 'bcrypt' | 'unknown';

export function detectHash(input: string): { kind: HashKind; length: number; looksLike: string; notes: string[] } {
  const value = input.trim();
  const notes: string[] = [];
  if (value.length === 0) throw invalidInput('Paste a hash to identify.');

  const lower = value.toLowerCase();
  if (/^\$2[abxy]\$\d{2}\$[./a-z0-9]{53}$/i.test(value)) {
    return { kind: 'bcrypt', length: value.length, looksLike: 'bcrypt', notes: ['This is a bcrypt hash.'].concat('It contains the cost factor and salt inline; verifying it is the only supported operation.') };
  }
  if (/^[a-f0-9]{32}$/i.test(value)) {
    notes.push('A 32-character hex digest is indistinguishable between MD5 and NTLM by length alone.');
    return { kind: 'md5', length: 32, looksLike: 'MD5 or NTLM (hex)', notes };
  }
  if (/^[a-f0-9]{40}$/i.test(value)) return { kind: 'sha1', length: 40, looksLike: 'SHA-1 (hex)', notes: ['SHA-1 is collision-broken; treat it as a legacy identifier, not a security control.'] };
  if (/^[a-f0-9]{64}$/i.test(value)) return { kind: 'sha256', length: 64, looksLike: 'SHA-256 (hex)', notes };
  if (/^[a-f0-9]{128}$/i.test(value)) return { kind: 'sha512', length: 128, looksLike: 'SHA-512 (hex)', notes };
  if (/^[a-f0-9]{8}$/i.test(value)) return { kind: 'crc32', length: 8, looksLike: 'CRC-32 or a short hex fragment', notes: ['CRC-32 detects accidental corruption only; it is not a cryptographic digest.'] };
  if (/^[A-Za-z0-9+/]{43}=?$/.test(value)) {
    if (lower.length === 44) notes.push('The length and alphabet suggest a Base64-encoded SHA-256 digest.');
    return { kind: 'unknown', length: value.length, looksLike: 'Base64-encoded digest (length suggests SHA-256)', notes };
  }
  if (/^[A-Za-z0-9+/]{27}=?$/.test(value)) {
    notes.push('The length and alphabet suggest a Base64-encoded SHA-1 digest.');
    return { kind: 'unknown', length: value.length, looksLike: 'Base64-encoded digest (length suggests SHA-1)', notes };
  }
  return { kind: 'unknown', length: value.length, looksLike: 'Unrecognised', notes: ['No common hash format matches this input length and alphabet.'] };
}

// ---------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------

export function parseSelectorList(input: string | string[] | undefined): string[] {
  if (!input) return [];
  const values = Array.isArray(input) ? input : input.split(/[,\s]+/);
  const selectors = values
    .map((value) => value.trim().toLowerCase().replace(/\.$/, ''))
    .filter((value) => value.length > 0);
  const unique = [...new Set(selectors)];
  for (const selector of unique) {
    // A DKIM selector becomes a DNS label: validate it as one, which also stops a selector being
    // used to walk up to a parent zone or inject extra labels.
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(selector)) {
      throw invalidInput(`"${selector}" is not a valid DKIM selector (DNS labels allow letters, digits and hyphens).`);
    }
  }
  return unique;
}

export function parseIpList(input: string | string[] | undefined, options: { max?: number; allowPrivate?: boolean } = {}): string[] {
  if (!input) return [];
  const values = (Array.isArray(input) ? input : input.split(/[,\s]+/)).map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return [];
  const max = options.max ?? 64;
  if (values.length > max) throw invalidInput(`At most ${max} addresses can be supplied at once.`);
  const addresses: string[] = [];
  for (const value of values) {
    const literal = parseIpLiteral(value);
    if (!literal) throw invalidInput(`"${value}" is not a valid IP address.`);
    if (!options.allowPrivate) {
      const reason = blockedReason(literal.normalized);
      if (reason) throw invalidInput(`"${value}" is not a public address (${reason}).`);
    }
    addresses.push(literal.normalized);
  }
  return [...new Set(addresses)];
}

export function parseDomainList(input: string | string[] | undefined, options: { max?: number } = {}): string[] {
  if (!input) return [];
  const values = (Array.isArray(input) ? input : input.split(/[,\s]+/)).map((value) => value.trim()).filter(Boolean);
  const max = options.max ?? 25;
  if (values.length > max) throw invalidInput(`At most ${max} domains can be supplied at once.`);
  return [...new Set(values.map((value) => normalizeDomain(value)))];
}

// ---------------------------------------------------------------------------------------------
// Untrusted text
// ---------------------------------------------------------------------------------------------

/**
 * Removes everything that can make rendered text differ from its bytes, then truncates. Use this
 * for any remote string that is echoed into an explanation, a preview, a CSV export or a log line.
 */
export function sanitizeUntrustedText(value: unknown, options: { maxLength?: number; collapseWhitespace?: boolean; allowNewlines?: boolean } = {}): string {
  const maxLength = options.maxLength ?? 500;
  const collapse = options.collapseWhitespace ?? true;
  let text = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);

  text = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
  text = text.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  if (!options.allowNewlines) text = text.replace(/[\r\n]+/g, ' ');
  if (collapse) text = text.replace(/[ \t]+/g, ' ').trim();
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1)}…`;
  return text;
}

/** Convenience for values that must occupy one line in a table or a log field. */
export function singleLine(value: unknown, maxLength = 200): string {
  return sanitizeUntrustedText(value, { maxLength, collapseWhitespace: true, allowNewlines: false });
}

/**
 * Wraps untrusted text as clearly-delimited data for any explanation that is assembled into a
 * prompt-like string. Tool results are data; a header value that reads "ignore previous
 * instructions" remains a header value.
 */
export function asDataBlock(label: string, value: unknown, maxLength = 400): string {
  const safeLabel = singleLine(label, 60);
  const safeValue = sanitizeUntrustedText(value, { maxLength, allowNewlines: false });
  return `<<${safeLabel}: ${safeValue}>>`;
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
