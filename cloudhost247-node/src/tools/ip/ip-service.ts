/**
 * Tools Center — IP lookup, ISP lookup, ASN enrichment and "what is my IP" (spec §16, §17, §29, §51).
 *
 * The base facts come from the free, keyless Team Cymru DNS origin service — a real registry-fed
 * source that needs no credentials, which is exactly what spec §62 asks for. City/region/timezone
 * enrichment is only added when a geolocation provider is configured; without one those fields are
 * reported as NOT_CONFIGURED rather than guessed.
 *
 * `blockedReason()` from the SSRF layer doubles as the address classifier here, so the "public vs
 * private/reserved" label shown to the user is the same logic that protects outbound requests.
 */
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { blockedReason, parseIp, fetchWithGuard } from '../core/ssrf';
import { invalidInput } from '../core/errors';
import { hasUsableProvider, providerSecret, recordProviderOutcome, usableProviders } from '../core/providers';
import type { ProviderView } from '../core/providers';
import { queryType, normalizeDomain, pickResolver } from '../dns/common';
import { reverseDnsLookup, domainToIp } from '../dns/lookup';

export interface AsnOriginRecord {
  asn: number;
  prefix: string;
  countryCode: string | null;
  registry: string | null;
  allocatedAt: string | null;
  asName: string | null;
  source: 'Team Cymru DNS';
}

export interface GeoEnrichment {
  source: string;
  city: string | null;
  region: string | null;
  country: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  isp: string | null;
  organization: string | null;
  asn: string | null;
}

export interface IpLookupResult {
  ip: string;
  version: 4 | 6;
  normalized: string;
  addressClass: {
    scope: 'public' | 'private-or-reserved';
    reason: string | null;
    isPrivate: boolean;
  };
  asn: AsnOriginRecord | null;
  reverseDns: { hostnames: string[]; forwardConfirmed: boolean; warnings: string[] };
  network: { prefix: string | null; registry: string | null } | null;
  organization: string | null;
  isp: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  coordinates: { latitude: number | null; longitude: number | null };
  geoProvider: { configured: boolean; used: boolean; source: string | null; detail: string };
  resolver: { name: string; ip: string; protocol: string } | null;
  warnings: string[];
  facts: string[];
}

function cymruName(address: string, parsedVersion: 4 | 6): string {
  const parsed = parseIp(address);
  if (!parsed) throw invalidInput(`"${address}" is not a valid IP address.`);
  if (parsedVersion === 4) return `${parsed.bytes.slice().reverse().join('.')}.origin.asn.cymru.com`;
  const nibbles = parsed.bytes
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .reverse()
    .map((nibble) => nibble.toString(16));
  return `${nibbles.join('.')}.origin6.asn.cymru.com`;
}

/** Parses the Team Cymru answer: "ASN | prefix | country | registry | allocated". */
export function parseCymruOrigin(value: string): Omit<AsnOriginRecord, 'asName'> | null {
  const parts = value.split('|').map((part) => part.trim());
  if (parts.length < 5) return null;
  const asn = Number.parseInt(parts[0] ?? '', 10);
  if (!Number.isInteger(asn)) return null;
  return {
    asn,
    prefix: parts[1] ?? '',
    countryCode: parts[2] && parts[2].length > 0 ? parts[2] : null,
    registry: parts[3] && parts[3].length > 0 ? parts[3] : null,
    allocatedAt: parts[4] && parts[4].length > 0 ? parts[4] : null,
    source: 'Team Cymru DNS',
  };
}

/** Parses the ASN name answer: "ASN | country | registry | allocated | name, country". */
export function parseCymruAsName(value: string): string | null {
  const parts = value.split('|').map((part) => part.trim());
  const name = parts[4];
  return name && name.length > 0 ? name : null;
}

export async function lookupAsn(db: Queryable, address: string): Promise<{ record: AsnOriginRecord | null; resolver: string | null; warnings: string[] }> {
  const parsed = parseIp(address);
  if (!parsed) throw invalidInput(`"${address}" is not a valid IP address.`);
  const warnings: string[] = [];
  const resolver = await pickResolver(db);
  const queryName = cymruName(parsed.normalized, parsed.version);

  try {
    // Team Cymru answers on a TXT record; the registry resolver is a normal recursive resolver and
    // can resolve cymru's zones, so no special access is required.
    const answer = await queryType(resolver, queryName, 'TXT', { timeoutMs: 6000 });
    const values = answer.records.filter((record) => record.type === 'TXT').map((record) => String(record.data.value ?? ''));
    const origin = values.map(parseCymruOrigin).find((entry): entry is Omit<AsnOriginRecord, 'asName'> => entry !== null) ?? null;
    if (!origin) {
      warnings.push('Team Cymru returned no origin entry for this address (it may be unallocated or, for IPv6, not covered by the origin service).');
      return { record: null, resolver: resolver.name, warnings };
    }

    let asName: string | null = null;
    try {
      const nameAnswer = await queryType(resolver, `AS${origin.asn}.asn.cymru.com`, 'TXT', { timeoutMs: 5000 });
      const nameValues = nameAnswer.records.filter((record) => record.type === 'TXT').map((record) => String(record.data.value ?? ''));
      asName = nameValues.map(parseCymruAsName).find((entry): entry is string => Boolean(entry)) ?? null;
    } catch {
      warnings.push('The AS name lookup failed; the ASN and prefix are still shown.');
    }

    return { record: { ...origin, asName }, resolver: resolver.name, warnings };
  } catch (error) {
    warnings.push(`The Team Cymru lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    return { record: null, resolver: null, warnings };
  } finally {
    void performance.now();
  }
}

const DEFAULT_GEO_MAPPING: Record<string, string> = {
  city: 'city',
  region: 'region',
  country: 'country',
  timezone: 'timezone',
  latitude: 'latitude',
  longitude: 'longitude',
  isp: 'isp',
  organization: 'org',
  asn: 'asn',
};

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Calls the configured geolocation provider with the address appended per its configuration.
 * `configuration.pathTemplate` may contain `{ip}`; otherwise the address is appended with `/`.
 */
async function geoLookup(provider: ProviderView, address: string, secret: { apiKey: string | null }): Promise<GeoEnrichment> {
  const template = typeof provider.configuration.pathTemplate === 'string' ? provider.configuration.pathTemplate : null;
  const base = provider.endpoint ?? '';
  if (!base) throw invalidInput('The geolocation provider has no endpoint configured.');
  const url = template ? `${base}${template.replace('{ip}', encodeURIComponent(address))}` : `${base.replace(/\/$/, '')}/${encodeURIComponent(address)}`;
  const mapping = { ...DEFAULT_GEO_MAPPING, ...((provider.configuration.jsonPaths as Record<string, string>) ?? {}) };
  const headerName = typeof provider.configuration.apiKeyHeader === 'string' ? provider.configuration.apiKeyHeader : null;

  const response = await fetchWithGuard(url, {
    timeoutMs: provider.timeoutMs,
    maxBytes: 128 * 1024,
    headers: {
      accept: 'application/json',
      ...(secret.apiKey && headerName ? { [headerName]: secret.apiKey } : {}),
      ...(secret.apiKey && !headerName ? { authorization: `Bearer ${secret.apiKey}` } : {}),
    },
  });
  if (response.status !== 200) {
    throw new Error(`The geolocation provider answered HTTP ${response.status}.`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(response.bodyText);
  } catch {
    throw new Error('The geolocation provider did not return JSON.');
  }

  const isp = asString(readPath(payload, mapping.isp ?? 'isp'));
  return {
    source: provider.name,
    city: asString(readPath(payload, mapping.city ?? 'city')),
    region: asString(readPath(payload, mapping.region ?? 'region')),
    country: asString(readPath(payload, mapping.country ?? 'country')),
    timezone: asString(readPath(payload, mapping.timezone ?? 'timezone')),
    latitude: asNumber(readPath(payload, mapping.latitude ?? 'latitude')),
    longitude: asNumber(readPath(payload, mapping.longitude ?? 'longitude')),
    isp,
    organization: asString(readPath(payload, mapping.organization ?? 'org')),
    asn: asString(readPath(payload, mapping.asn ?? 'asn')),
  };
}

export async function ipLookup(db: Queryable, input: { address: string; includeReverse?: boolean; resolverId?: string }): Promise<IpLookupResult> {
  const parsed = parseIp(input.address);
  if (!parsed) throw invalidInput(`"${input.address}" is not a valid IPv4 or IPv6 address.`);
  const reason = blockedReason(parsed.normalized);
  const warnings: string[] = [];
  const facts: string[] = [];

  const asnResult = await lookupAsn(db, parsed.normalized);
  warnings.push(...asnResult.warnings);
  if (asnResult.record) {
    facts.push(`Origin ASN: AS${asnResult.record.asn}${asnResult.record.asName ? ` (${asnResult.record.asName})` : ''}`);
    facts.push(`Announced prefix: ${asnResult.record.prefix}`);
    facts.push(`Registry: ${asnResult.record.registry ?? 'unknown'}`);
  }

  let reverseDns: IpLookupResult['reverseDns'] = { hostnames: [], forwardConfirmed: false, warnings: [] };
  let resolverLabel: IpLookupResult['resolver'] = null;
  if (input.includeReverse !== false) {
    const reverse = await reverseDnsLookup(db, { address: parsed.normalized, resolverId: input.resolverId }).catch((error: unknown) => {
      warnings.push(`Reverse DNS lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return null;
    });
    if (reverse) {
      reverseDns = { hostnames: reverse.hostnames, forwardConfirmed: reverse.forwardConfirmed, warnings: reverse.warnings };
      resolverLabel = { name: reverse.resolver.name, ip: reverse.resolver.ip, protocol: reverse.resolver.protocol };
      if (reverse.hostnames.length > 0) facts.push(`Reverse DNS: ${reverse.hostnames.join(', ')}`);
    }
  }

  // Geolocation enrichment — optional, provider-gated, never invented.
  let geo: GeoEnrichment | null = null;
  const geoProviders = await usableProviders(db, 'GEOLOCATION');
  let providerDetail: string;
  if (geoProviders.length === 0) {
    const configured = await hasUsableProvider(db, 'GEOLOCATION');
    providerDetail = configured
      ? 'A geolocation provider is configured but not usable right now (check its credentials under Admin → Tools → Providers).'
      : 'No IP geolocation provider is configured. City, region, timezone and coordinates are reported as NOT_CONFIGURED because CloudHost247 will not guess them from an ASN.';
    warnings.push(providerDetail);
  } else {
    const provider = geoProviders[0]!;
    try {
      const secret = await providerSecret(db, provider.slug);
      geo = await geoLookup(provider, parsed.normalized, secret);
      providerDetail = `City/region/timezone supplied by ${provider.name}.`;
      await recordProviderOutcome(db, provider.slug, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'geo lookup failed';
      providerDetail = `The geolocation provider (${provider.name}) could not answer: ${message}`;
      warnings.push(providerDetail);
      await recordProviderOutcome(db, provider.slug, { ok: false, error: message });
    }
  }

  const factsFinal = [...facts];
  if (geo) {
    factsFinal.push(`Geolocation (approximate, from ${geo.source}): ${[geo.city, geo.region, geo.country].filter(Boolean).join(', ') || 'no location fields returned'}`);
  }

  return {
    ip: parsed.normalized,
    version: parsed.version,
    normalized: parsed.normalized,
    addressClass: {
      scope: reason === null ? 'public' : 'private-or-reserved',
      reason,
      isPrivate: reason !== null,
    },
    asn: asnResult.record,
    reverseDns,
    network: asnResult.record ? { prefix: asnResult.record.prefix, registry: asnResult.record.registry } : null,
    organization: geo?.organization ?? asnResult.record?.asName ?? null,
    isp: geo?.isp ?? null,
    country: geo?.country ?? asnResult.record?.countryCode ?? null,
    region: geo?.region ?? null,
    city: geo?.city ?? null,
    timezone: geo?.timezone ?? null,
    coordinates: { latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null },
    geoProvider: { configured: geoProviders.length > 0, used: geo !== null, source: geo?.source ?? null, detail: providerDetail },
    resolver: resolverLabel,
    warnings,
    facts: factsFinal,
  };
}

export interface IspLookupResult {
  ip: string;
  organization: string | null;
  asn: number | null;
  asName: string | null;
  isp: string | null;
  country: string | null;
  prefix: string | null;
  registry: string | null;
  reverseDns: string[];
  providerDetail: string;
  warnings: string[];
}

export async function ispLookup(db: Queryable, input: { address: string }): Promise<IspLookupResult> {
  const lookup = await ipLookup(db, { address: input.address });
  return {
    ip: lookup.ip,
    organization: lookup.organization,
    asn: lookup.asn?.asn ?? null,
    asName: lookup.asn?.asName ?? null,
    isp: lookup.isp,
    country: lookup.country,
    prefix: lookup.asn?.prefix ?? null,
    registry: lookup.asn?.registry ?? null,
    reverseDns: lookup.reverseDns.hostnames,
    providerDetail: lookup.geoProvider.detail,
    warnings: lookup.warnings,
  };
}

export interface MyIpResult {
  ipv4: string | null;
  ipv6: string | null;
  detectedAddress: string;
  forwardedFor: string[];
  userAgent: string;
  headers: Record<string, string>;
  connection: {
    protocol: string;
    tls: { protocol: string; cipher: string; authorized: boolean } | null;
  };
  note: string;
}

/**
 * "What is my IP" (spec §17). Reports only what the edge actually observed — no fingerprinting
 * beyond the headers the browser sent, and no attempt to reach back to the client.
 */
export function myIp(input: {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
  socket: { encrypted?: boolean; getPeerCertificate?: (detailed?: boolean) => Record<string, unknown>; getProtocol?: () => string | null; getCipher?: () => { name?: string } | null } | null;
}): MyIpResult {
  const parseAddress = (value: string): { v4: string | null; v6: string | null } => {
    const first = value.split(',')[0]?.trim() ?? '';
    const withoutPort = first.startsWith('[') ? first.slice(1, first.indexOf(']')) : first;
    const parsed = parseIp(withoutPort);
    if (!parsed) return { v4: null, v6: null };
    return parsed.version === 4 ? { v4: parsed.normalized, v6: null } : { v4: null, v6: parsed.normalized };
  };

  const forwarded = String(input.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const detected = forwarded[forwarded.length - 1] ?? input.ip;
  const { v4, v6 } = parseAddress(detected);
  const altForwarded = forwarded.find((entry) => {
    const parsed = parseAddress(entry);
    return (v4 && parsed.v6) || (v6 && parsed.v4);
  });

  const tls =
    input.socket && input.socket.encrypted === true
      ? {
          protocol: input.socket.getProtocol?.() ?? 'unknown',
          cipher: input.socket.getCipher?.()?.name ?? 'unknown',
          authorized: Boolean(input.socket.getPeerCertificate?.(true)),
        }
      : null;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers)) {
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  return {
    ipv4: v4 ?? (altForwarded ? parseAddress(altForwarded).v4 : null),
    ipv6: v6 ?? (altForwarded ? parseAddress(altForwarded).v6 : null),
    detectedAddress: detected,
    forwardedFor: forwarded,
    userAgent: String(input.headers['user-agent'] ?? 'unknown'),
    headers,
    connection: { protocol: input.protocol, tls },
    note: 'CloudHost247 reports the address its edge observed. If you are behind a proxy or NAT, that may be the proxy\'s address rather than your device\'s.',
  };
}

export interface DomainToIpToolResult {
  domain: string;
  ipv4: Array<{ address: string; ttl: number }>;
  ipv6: Array<{ address: string; ttl: number }>;
  cnameChain: string[];
  resolver: { name: string; ip: string; protocol: string };
  durationMs: number;
  warnings: string[];
  /** CloudHost247 context when the caller owns this domain (spec §80). */
  hostingContext: { owned: boolean; domainId: string | null; serverName: string | null; serverIp: string | null; zoneId: string | null } | null;
}

export async function domainToIpTool(
  db: Queryable,
  input: { domain: string; resolverId?: string; userId?: string | null }
): Promise<DomainToIpToolResult> {
  const domain = normalizeDomain(input.domain);
  const result = await domainToIp(db, { domain, resolverId: input.resolverId });

  let hostingContext: DomainToIpToolResult['hostingContext'] = null;
  if (input.userId) {
    const { rows } = await db.query<{ id: string; zone_id: string | null; server_name: string | null; server_ip: string | null }>(
      `SELECT d.id,
              (SELECT z.id FROM dns_zones z WHERE lower(z.domain_name) = lower(d.domain_name) AND z.user_id = $2 LIMIT 1) AS zone_id,
              (SELECT s.name FROM servers s WHERE s.customer_id = $2 AND lower(COALESCE(s.hostname,'')) LIKE '%' || lower(d.domain_name) || '%' LIMIT 1) AS server_name,
              (SELECT s.ip_address FROM servers s WHERE s.customer_id = $2 AND lower(COALESCE(s.hostname,'')) LIKE '%' || lower(d.domain_name) || '%' LIMIT 1) AS server_ip
         FROM customer_domains d
        WHERE d.user_id = $2 AND lower(d.domain_name) = lower($1)
        LIMIT 1`,
      [domain, input.userId]
    ).catch(() => ({ rows: [] as Array<{ id: string; zone_id: string | null; server_name: string | null; server_ip: string | null }> }));
    const row = rows[0];
    hostingContext = {
      owned: Boolean(row),
      domainId: row?.id ?? null,
      serverName: row?.server_name ?? null,
      serverIp: row?.server_ip ?? null,
      zoneId: row?.zone_id ?? null,
    };
  }

  return {
    domain: result.domain,
    ipv4: result.ipv4,
    ipv6: result.ipv6,
    cnameChain: result.cnameChain,
    resolver: { name: result.resolver.name, ip: result.resolver.ip, protocol: result.resolver.protocol },
    durationMs: result.durationMs,
    warnings: result.warnings,
    hostingContext,
  };
}
