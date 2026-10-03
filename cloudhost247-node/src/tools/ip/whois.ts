/**
 * Tools Center — IP WHOIS over RDAP and ASN WHOIS (spec §18, §29).
 *
 * RDAP is used instead of port-43 WHOIS because it is structured, supports HTTPS (so it works from
 * cPanel shared hosting where outbound port 43 is frequently blocked) and has an official bootstrap
 * service. The endpoint is operator-configurable; the seeded default is the public RDAP bootstrap.
 *
 * Everything returned here is quoted from the registry response. When a registry returns little
 * (many do, especially for legacy allocations), the tool says the registry returned no value for
 * that field rather than filling it in.
 */
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError } from '../core/errors';
import { fetchWithGuard } from '../core/ssrf';
import { recordProviderOutcome, requireProvider, type ProviderView } from '../core/providers';
import { parseIp } from '../core/ssrf';

export interface RdapEvent {
  action: string;
  date: string | null;
  actor: string | null;
}

export interface RdapEntity {
  handle: string | null;
  roles: string[];
  name: string | null;
  emails: string[];
  url: string | null;
}

export interface RdapResult {
  query: string;
  kind: 'ip' | 'autnum';
  handle: string | null;
  name: string | null;
  type: string | null;
  country: string | null;
  startAddress: string | null;
  endAddress: string | null;
  ipVersion: string | null;
  parentHandle: string | null;
  status: string[];
  cidrBlocks: string[];
  entities: RdapEntity[];
  events: RdapEvent[];
  remarks: string[];
  notices: string[];
  links: string[];
  registry: string | null;
  source: { provider: string; endpoint: string; url: string };
  warnings: string[];
}

interface RdapJson {
  handle?: string;
  name?: string;
  type?: string;
  country?: string;
  startAddress?: string;
  endAddress?: string;
  ipVersion?: string;
  parentHandle?: string;
  status?: string[];
  cidr0_cidrs?: Array<{ v4prefix?: string; v6prefix?: string; length?: number }>;
  entities?: Array<{
    handle?: string;
    roles?: string[];
    vcardArray?: unknown;
    links?: Array<{ href?: string }>;
  }>;
  events?: Array<{ eventAction?: string; eventDate?: string; eventActor?: string }>;
  remarks?: Array<{ description?: string[] }>;
  notices?: Array<{ title?: string; description?: string[] }>;
  links?: Array<{ href?: string }>;
  port43?: string;
}

function vcardValue(vcardArray: unknown): { name: string | null; emails: string[] } {
  // vCard 4.0 JSON: [ "vcard", [ ["fn", {}, "text", "Name"], ["email", {}, "text", "a@b"] … ] ]
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return { name: null, emails: [] };
  const properties = vcardArray[1];
  if (!Array.isArray(properties)) return { name: null, emails: [] };
  let name: string | null = null;
  const emails: string[] = [];
  for (const property of properties) {
    if (!Array.isArray(property)) continue;
    const key = property[0];
    const value = property[3];
    if (typeof value !== 'string') continue;
    if (key === 'fn' && !name) name = value;
    if (key === 'email') emails.push(value);
  }
  return { name, emails };
}

function mapRdap(payload: RdapJson, source: RdapResult['source'], query: string, kind: 'ip' | 'autnum'): RdapResult {
  const entities: RdapEntity[] = (payload.entities ?? []).map((entity) => {
    const vcard = vcardValue(entity.vcardArray);
    return {
      handle: entity.handle ?? null,
      roles: entity.roles ?? [],
      name: vcard.name,
      emails: vcard.emails,
      url: entity.links?.[0]?.href ?? null,
    };
  });

  const warnings: string[] = [];
  if (entities.length === 0) warnings.push('This registry returned no entity (contact) records for the object.');
  if (!payload.handle && !payload.name) warnings.push('This registry returned neither a handle nor a name for the object.');
  if (payload.status?.includes('pending delete')) warnings.push('The object is marked "pending delete" by the registry.');

  return {
    query,
    kind,
    handle: payload.handle ?? null,
    name: payload.name ?? null,
    type: payload.type ?? null,
    country: payload.country ?? null,
    startAddress: payload.startAddress ?? null,
    endAddress: payload.endAddress ?? null,
    ipVersion: payload.ipVersion ?? null,
    parentHandle: payload.parentHandle ?? null,
    status: payload.status ?? [],
    cidrBlocks: (payload.cidr0_cidrs ?? []).map((block) => {
      const prefix = block.v4prefix ?? block.v6prefix ?? '';
      return prefix ? `${prefix}/${block.length ?? ''}` : '';
    }).filter(Boolean),
    entities,
    events: (payload.events ?? []).map((event) => ({
      action: event.eventAction ?? 'unknown',
      date: event.eventDate ?? null,
      actor: event.eventActor ?? null,
    })),
    remarks: (payload.remarks ?? []).flatMap((remark) => remark.description ?? []),
    notices: (payload.notices ?? []).flatMap((notice) => notice.description ?? []),
    links: (payload.links ?? []).map((link) => link.href ?? '').filter(Boolean),
    registry: payload.port43 ?? null,
    source,
    warnings,
  };
}

async function rdapRequest(db: Queryable, providerKind: 'RDAP', toolName: string, path: string): Promise<RdapResult> {
  const provider = await requireProvider(db, providerKind, toolName);
  const endpoint = (provider.endpoint ?? '').replace(/\/$/, '');
  if (!endpoint) throw invalidInput('The RDAP provider has no endpoint configured.');
  const url = `${endpoint}/${path}`;

  try {
    const response = await fetchWithGuard(url, {
      timeoutMs: provider.timeoutMs,
      maxBytes: 512 * 1024,
      headers: { accept: 'application/rdap+json, application/json' },
      userAgent: 'CloudHost247-ToolsCenter/1.0 (RDAP lookup)',
    });
    if (response.status === 404) {
      throw new ToolError('NOT_FOUND', 'The registry returned no RDAP object for that query (it may be an unallocated or non-RDAP range).');
    }
    if (response.status === 429) {
      throw new ToolError('RATE_LIMITED', 'The RDAP service is rate limiting this platform. Try again shortly.');
    }
    if (response.status !== 200) {
      throw new ToolError('PROVIDER_ERROR', `The RDAP service answered HTTP ${response.status}.`);
    }
    const payload = JSON.parse(response.bodyText) as RdapJson;
    await recordProviderOutcome(db, provider.slug, { ok: true });
    return mapRdap(payload, { provider: provider.name, endpoint, url }, path, endpoint.includes('autnum') ? 'autnum' : 'ip');
  } catch (error) {
    const message = error instanceof ToolError ? error.message : `The RDAP request failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    await recordProviderOutcome(db, provider.slug, { ok: false, error: message });
    if (error instanceof ToolError) throw error;
    throw new ToolError('PROVIDER_ERROR', message);
  }
}

/** Section §18 — IP WHOIS (IPv4 and IPv6). */
export async function ipWhois(db: Queryable, address: string): Promise<RdapResult> {
  const parsed = parseIp(address);
  if (!parsed) throw invalidInput(`"${address}" is not a valid IPv4 or IPv6 address.`);
  return rdapRequest(db, 'RDAP', 'IP WHOIS', `ip/${encodeURIComponent(parsed.normalized)}`);
}

/** Section §29 — ASN WHOIS. */
export async function asnWhois(db: Queryable, asn: string): Promise<RdapResult> {
  const normalized = asn.trim().toUpperCase().replace(/^AS/, '');
  if (!/^\d{1,10}$/.test(normalized)) throw invalidInput('Enter an AS number such as 15169 or AS15169.');
  const value = Number.parseInt(normalized, 10);
  if (value < 1 || value > 4_294_967_295) throw invalidInput('An AS number must be between 1 and 4294967295.');
  return rdapRequest(db, 'RDAP', 'ASN WHOIS', `autnum/${value}`);
}

export interface AsnPrefixEvidence {
  prefix: string;
  evidence: string;
}

/** Formats ASN output for the UI, merging RDAP facts with DNS-based origin evidence. */
export function summarizeAsn(result: RdapResult, prefixes: AsnPrefixEvidence[]): {
  asn: string;
  organization: string | null;
  country: string | null;
  registry: string | null;
  handle: string | null;
  type: string | null;
  status: string[];
  prefixes: AsnPrefixEvidence[];
  contacts: RdapEntity[];
  events: RdapEvent[];
  notes: string[];
} {
  const notes: string[] = [];
  if (prefixes.length === 0) {
    notes.push(
      'No prefix could be attributed to this AS from the free DNS origin source. The authoritative prefix list lives in the registry\'s RDAP/routing data, which the configured RDAP endpoint returned above.'
    );
  }
  if (result.entities.length === 0) notes.push('The registry published no contact entities for this AS.');
  return {
    asn: result.query,
    organization: result.name,
    country: result.country,
    registry: result.source.provider,
    handle: result.handle,
    type: result.type,
    status: result.status,
    prefixes,
    contacts: result.entities,
    events: result.events,
    notes,
  };
}

export type { ProviderView };
