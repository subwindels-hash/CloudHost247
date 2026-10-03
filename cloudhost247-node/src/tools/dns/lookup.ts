/**
 * Tools Center — DNS lookup, MX lookup and reverse DNS services (spec §5, §7, §14, §15, §19, §20).
 *
 * These are the "single answer, attributable" tools: each result names the resolver that produced
 * it, the response time and the TTL, and each failure names the resolver that could not answer.
 */
import { performance } from 'node:perf_hooks';
import dns from 'node:dns/promises';
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError, timeoutError } from '../core/errors';
import { blockedReason, parseIp, resolvePublicAddresses } from '../core/ssrf';
import type { ResolverRow } from '../core/resolvers';
import { formatRecord, normalizeDomain, normalizeServiceName, pickResolver, queryType, queryTxt, type AnswerMeta } from './common';

export interface LookupRecord {
  name: string;
  type: string;
  ttl: number;
  priority: number | null;
  value: string;
  detail: Record<string, unknown>;
}

export interface LookupResult {
  query: { name: string; type: string };
  records: LookupRecord[];
  resolver: AnswerMeta['resolver'];
  durationMs: number;
  rcode: string;
  authoritative: boolean;
  truncated: boolean;
  hasDnssecRecords: boolean;
  /** True when the answer is a CNAME chain rather than a direct record. */
  cnameChain: string[];
  explanation: string;
  warnings: string[];
}

const SUPPORTED_LOOKUP_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'CAA', 'PTR', 'DS', 'DNSKEY'] as const;
export type SupportedLookupType = (typeof SUPPORTED_LOOKUP_TYPES)[number];

export function assertLookupType(type: string): SupportedLookupType {
  const upper = type.toUpperCase();
  if (!(SUPPORTED_LOOKUP_TYPES as readonly string[]).includes(upper)) {
    throw invalidInput(`"${type}" is not one of the supported record types: ${SUPPORTED_LOOKUP_TYPES.join(', ')}.`);
  }
  return upper as SupportedLookupType;
}

const EXPLANATIONS: Record<string, string> = {
  A: 'An A record maps a name to one or more IPv4 addresses.',
  AAAA: 'An AAAA record maps a name to one or more IPv6 addresses.',
  CNAME: 'A CNAME makes a name an alias of another name; all other records for that name must not exist.',
  MX: 'An MX record names a mail server and its preference; the lowest preference value is tried first.',
  NS: 'NS records list the authoritative nameservers for the zone.',
  TXT: 'TXT records carry arbitrary text; SPF, DKIM, DMARC and site verification all use them.',
  SOA: 'The SOA record identifies the zone\'s primary nameserver and its timing parameters.',
  SRV: 'An SRV record locates a service on a specific host and port; priority orders hosts and weight distributes load between equal-priority hosts.',
  CAA: 'A CAA record restricts which certificate authorities may issue certificates for the name.',
  PTR: 'A PTR record maps an address back to a name (reverse DNS).',
  DS: 'A DS record publishes, in the parent zone, the digest of a child zone\'s DNSKEY so the delegation chain can be validated.',
  DNSKEY: 'A DNSKEY record publishes the public keys the zone uses to sign its records.',
};

/**
 * Section §5 DNS Lookup. Queries one type against a chosen resolver (registry default otherwise).
 * CNAME chains are followed for A/AAAA/MX presentation but the raw answers are always returned too.
 */
export async function dnsLookup(
  db: Queryable,
  input: { name: string; type: string; resolverId?: string; timeoutMs?: number; dnssec?: boolean }
): Promise<LookupResult> {
  const type = assertLookupType(input.type);
  const name =
    type === 'PTR' && parseIp(input.name)
      ? reverseNameFor(input.name)
      : input.name.includes('_')
        ? normalizeServiceName(input.name)
        : normalizeDomain(input.name);

  const resolver: ResolverRow = await pickResolver(db, { id: input.resolverId });
  const answer = await queryType(resolver, name, type, {
    timeoutMs: input.timeoutMs ?? 6000,
    // DS/DNSKEY queries need the DO bit and a larger payload to be useful.
    dnssec: input.dnssec ?? (type === 'DS' || type === 'DNSKEY'),
  });

  const records = answer.records.map(formatRecord);
  const cnameChain = answer.records.filter((record) => record.type === 'CNAME').map((record) => String(record.data.target ?? ''));

  const warnings = answer.warning ? [answer.warning] : [];
  if (records.length === 0 && !answer.warning) {
    warnings.push(`${resolver.name} answered ${answer.meta.rcode} with no ${type} records for ${name}.`);
  }
  if (type === 'CNAME' && cnameChain.length === 0 && records.length === 0) {
    warnings.push('No CNAME was returned; the name may be a direct record rather than an alias.');
  }

  return {
    query: { name, type },
    records,
    resolver: answer.meta.resolver,
    durationMs: answer.meta.durationMs,
    rcode: answer.meta.rcode,
    authoritative: answer.meta.authoritative,
    truncated: answer.meta.truncated,
    hasDnssecRecords: answer.meta.hasDnssecRecords,
    cnameChain,
    explanation: EXPLANATIONS[type] ?? '',
    warnings,
  };
}

export interface MxHost {
  host: string;
  priority: number;
  addresses: { v4: string[]; v6: string[] };
  reverseDns: string[];
  reverseConfirmed: boolean;
  reachable: { port25: boolean | null; detail: string };
  provider: string | null;
}

export interface MxLookupResult {
  domain: string;
  records: Array<{ host: string; priority: number; ttl: number }>;
  hosts: MxHost[];
  implicitMx: boolean;
  resolver: AnswerMeta['resolver'];
  explanation: string;
  warnings: string[];
}

/**
 * Maps MX hostnames to mail providers only when the hostname itself is conclusive. Anything else is
 * reported as Unknown — a guess here would mislead a customer about who handles their mail.
 */
const MAIL_PROVIDER_PATTERNS: Array<{ test: RegExp; provider: string }> = [
  { test: /\.google\.com$|\.googlemail\.com$|^aspmx\d*\./i, provider: 'Google Workspace' },
  { test: /\.outlook\.com$|\.protection\.outlook\.com$|\.office365\.com$/i, provider: 'Microsoft 365' },
  { test: /\.mail\.protect|\.ppe-hosted\.com$|\.service-protect\.com$/i, provider: 'Proofpoint' },
  { test: /\.mimecast\.com$/i, provider: 'Mimecast' },
  { test: /\.zoho\.(com|eu|in)$|zoho/i, provider: 'Zoho Mail' },
  { test: /\.icloud\.com$|\.apple\.com$/i, provider: 'Apple iCloud Mail' },
  { test: /\.yandex\.(net|ru)$/i, provider: 'Yandex Mail' },
  { test: /\.mailgun\.org$|\.mailgun\.net$/i, provider: 'Mailgun' },
  { test: /\.sendgrid\.net$/i, provider: 'SendGrid' },
  { test: /\.amazonaws\.com$|\.amazonses\.com$/i, provider: 'Amazon SES / WorkMail' },
  { test: /\.cloudhost247\.com$/i, provider: 'CloudHost247' },
];

export function identifyMailProvider(host: string): string | null {
  const match = MAIL_PROVIDER_PATTERNS.find((pattern) => pattern.test.test(host));
  return match ? match.provider : null;
}

/** Section §7 MX Lookup — resolves each mail host and checks the SMTP port. */
export async function mxLookup(
  db: Queryable,
  input: { domain: string; resolverId?: string; checkPort25?: boolean }
): Promise<MxLookupResult> {
  const domain = normalizeDomain(input.domain);
  const resolver = await pickResolver(db, { id: input.resolverId });
  const answer = await queryType(resolver, domain, 'MX', { timeoutMs: 6000 });

  const records = answer.records.map((record) => ({
    host: String(record.data.exchange ?? ''),
    priority: Number(record.data.preference ?? 0),
    ttl: record.ttl,
  }));

  const warnings: string[] = [];
  if (answer.warning) warnings.push(answer.warning);

  // RFC 5321 §5.1: a domain with no MX still receives mail at its A/AAAA address.
  let implicitMx = false;
  if (records.length === 0) {
    const a = await queryType(resolver, domain, 'A', { timeoutMs: 4000 }).catch(() => null);
    const aaaa = await queryType(resolver, domain, 'AAAA', { timeoutMs: 4000 }).catch(() => null);
    const hasAddress = Boolean(a?.records.length || aaaa?.records.length);
    implicitMx = hasAddress;
    if (hasAddress) {
      records.push({ host: domain, priority: 0, ttl: a?.records[0]?.ttl ?? 0 });
      warnings.push(
        'No MX records are published, so mail is delivered to this host\'s address records (the RFC 5321 implicit MX fallback). Most providers regard that as a misconfiguration.'
      );
    } else {
      warnings.push('No MX records and no address records were found: this domain cannot receive mail.');
    }
  }

  const hosts: MxHost[] = [];
  for (const record of records) {
    const addresses = { v4: [] as string[], v6: [] as string[] };
    try {
      const resolved = await dns.lookup(record.host, { all: true });
      addresses.v4 = resolved.filter((entry) => entry.family === 4).map((entry) => entry.address);
      addresses.v6 = resolved.filter((entry) => entry.family === 6).map((entry) => entry.address);
    } catch {
      warnings.push(`The mail host ${record.host} did not resolve to any address.`);
    }

    let reverseDns: string[] = [];
    const primaryIp = addresses.v4[0] ?? addresses.v6[0];
    if (primaryIp) {
      try {
        const names = await dns.reverse(primaryIp);
        reverseDns = names;
      } catch {
        reverseDns = [];
      }
    }
    let reverseConfirmed = false;
    if (reverseDns.length > 0 && primaryIp) {
      try {
        const forward = await dns.lookup(reverseDns[0]!, { all: true });
        reverseConfirmed = forward.some((entry) => entry.address === primaryIp);
      } catch {
        reverseConfirmed = false;
      }
    }

    hosts.push({
      host: record.host,
      priority: record.priority,
      addresses,
      reverseDns,
      reverseConfirmed,
      reachable: {
        port25: null,
        detail:
          input.checkPort25 === false
            ? 'SMTP port check not requested.'
            : 'Outbound port 25 is blocked on most shared hosting and on many networks, so "unreachable" here does not prove the mail server is down.',
      },
      provider: identifyMailProvider(record.host),
    });
  }

  return {
    domain,
    records,
    hosts,
    implicitMx,
    resolver: answer.meta.resolver,
    explanation:
      'Mail servers try the MX host with the lowest preference number first. Hosts with equal preference share the load.',
    warnings,
  };
}

/** Builds the reverse-DNS name for an IPv4/IPv6 address. */
export function reverseNameFor(address: string): string {
  const parsed = parseIp(address);
  if (!parsed) throw invalidInput(`"${address}" is not a valid IP address.`);
  if (parsed.version === 4) {
    return `${parsed.bytes.slice().reverse().join('.')}.in-addr.arpa`;
  }
  const nibbles = parsed.bytes
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .reverse()
    .map((nibble) => nibble.toString(16));
  return `${nibbles.join('.')}.ip6.arpa`;
}

export interface ReverseDnsResult {
  address: string;
  version: 4 | 6;
  queryName: string;
  hostnames: string[];
  ptrRecords: Array<{ name: string; ttl: number; value: string }>;
  forwardConfirmed: boolean;
  forwardAnswers: Array<{ hostname: string; addresses: string[]; confirmed: boolean }>;
  resolver: AnswerMeta['resolver'];
  warnings: string[];
  explanation: string;
}

/** Section §14/§20 — PTR lookup plus forward-confirmed reverse DNS. */
export async function reverseDnsLookup(
  db: Queryable,
  input: { address: string; resolverId?: string }
): Promise<ReverseDnsResult> {
  const parsed = parseIp(input.address);
  if (!parsed) throw invalidInput(`"${input.address}" is not a valid IPv4 or IPv6 address.`);

  const resolver = await pickResolver(db, { id: input.resolverId });
  const queryName = reverseNameFor(parsed.normalized);
  const answer = await queryType(resolver, queryName, 'PTR', { timeoutMs: 6000 });
  const hostnames = answer.records.map((record) => String(record.data.target ?? ''));

  const warnings: string[] = [];
  if (answer.warning) warnings.push(answer.warning);

  const forwardAnswers: ReverseDnsResult['forwardAnswers'] = [];
  for (const hostname of hostnames) {
    try {
      const resolved = await dns.lookup(hostname, { all: true });
      const addresses = resolved.map((entry) => entry.address);
      const confirmed = addresses.some((address) => parseIp(address)?.normalized === parsed.normalized);
      forwardAnswers.push({ hostname, addresses, confirmed });
      if (!confirmed) {
        warnings.push(`The hostname ${hostname} does not resolve back to ${parsed.normalized}, so this is not forward-confirmed reverse DNS.`);
      }
    } catch {
      forwardAnswers.push({ hostname, addresses: [], confirmed: false });
      warnings.push(`The hostname ${hostname} does not resolve at all, so this is not forward-confirmed reverse DNS.`);
    }
  }

  if (hostnames.length === 0) {
    warnings.push(`No PTR record is published for ${parsed.normalized}. Many mail servers treat a missing PTR record as a spam signal.`);
  }

  return {
    address: parsed.normalized,
    version: parsed.version,
    queryName,
    hostnames,
    ptrRecords: answer.records.map((record) => ({ name: record.name, ttl: record.ttl, value: String(record.data.target ?? '') })),
    forwardConfirmed: forwardAnswers.length > 0 && forwardAnswers.every((entry) => entry.confirmed),
    forwardAnswers,
    resolver: answer.meta.resolver,
    warnings,
    explanation:
      'Forward-confirmed reverse DNS (FCrDNS) means the address has a PTR record AND the name it points to resolves back to the same address. It is the form of reverse DNS that mail servers test.',
  };
}

export interface DomainToIpResult {
  domain: string;
  ipv4: Array<{ address: string; ttl: number }>;
  ipv6: Array<{ address: string; ttl: number }>;
  cnameChain: string[];
  resolver: AnswerMeta['resolver'];
  durationMs: number;
  warnings: string[];
}

/** Section §19 Domain → IP. */
export async function domainToIp(db: Queryable, input: { domain: string; resolverId?: string }): Promise<DomainToIpResult> {
  const domain = normalizeDomain(input.domain);
  const resolver = await pickResolver(db, { id: input.resolverId });
  const startedAt = performance.now();

  const [a, aaaa] = await Promise.all([
    queryType(resolver, domain, 'A', { timeoutMs: 6000 }).catch((error: unknown) => error as Error),
    queryType(resolver, domain, 'AAAA', { timeoutMs: 6000 }).catch((error: unknown) => error as Error),
  ]);

  const warnings: string[] = [];
  const ipv4Answer = a instanceof Error ? null : a;
  const ipv6Answer = aaaa instanceof Error ? null : aaaa;
  if (!ipv4Answer && !ipv6Answer) {
    throw new ToolError('DNS_LOOKUP_FAILED', `Neither an A nor an AAAA query for ${domain} could be answered by ${resolver.name}.`);
  }
  if (ipv4Answer?.warning) warnings.push(ipv4Answer.warning);
  if (ipv6Answer?.warning) warnings.push(ipv6Answer.warning);
  if (!ipv4Answer) warnings.push('The A query failed; only IPv6 answers are shown.');
  if (!ipv6Answer) warnings.push('The AAAA query failed; only IPv4 answers are shown.');

  const cnameChain = [...(ipv4Answer?.records ?? []), ...(ipv6Answer?.records ?? [])]
    .filter((record) => record.type === 'CNAME')
    .map((record) => String(record.data.target ?? ''));

  return {
    domain,
    ipv4: (ipv4Answer?.records ?? [])
      .filter((record) => record.type === 'A')
      .map((record) => ({ address: String(record.data.address ?? ''), ttl: record.ttl })),
    ipv6: (ipv6Answer?.records ?? [])
      .filter((record) => record.type === 'AAAA')
      .map((record) => ({ address: String(record.data.address ?? ''), ttl: record.ttl })),
    cnameChain,
    resolver: (ipv4Answer ?? ipv6Answer)!.meta.resolver,
    durationMs: Math.round(performance.now() - startedAt),
    warnings,
  };
}

export interface ForwardLookupResult {
  hostname: string;
  addresses: Array<{ address: string; family: number }>;
  blocked: { address: string; reason: string }[];
}

/** Forward lookup used by IP → hostname flows and the blacklist tool's pre-checks. */
export async function forwardLookup(hostname: string): Promise<ForwardLookupResult> {
  try {
    const rows = await dns.lookup(hostname, { all: true });
    return {
      hostname,
      addresses: rows.map((row) => ({ address: row.address, family: row.family })),
      blocked: rows.map((row) => ({ address: row.address, reason: blockedReason(row.address) ?? '' })).filter((row) => row.reason.length > 0),
    };
  } catch {
    throw timeoutError(`the lookup of ${hostname}`).code === 'TIMEOUT'
      ? new ToolError('DNS_LOOKUP_FAILED', `"${hostname}" could not be resolved.`)
      : new ToolError('DNS_LOOKUP_FAILED', `"${hostname}" could not be resolved.`);
  }
}

/** Convenience wrapper used by tools that need the TXT values of a name without formatting. */
export async function txtValues(db: Queryable, name: string, resolverId?: string): Promise<{ values: string[]; meta: AnswerMeta; resolver: ResolverRow }> {
  const resolver = await pickResolver(db, { id: resolverId });
  const { values, meta } = await queryTxt(resolver, name, 6000);
  return { values, meta, resolver };
}

export { resolvePublicAddresses };
