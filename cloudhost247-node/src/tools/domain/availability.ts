/**
 * Tools Center — domain availability (spec §46).
 *
 * The platform already has a domain-availability path: `src/domain-services/search-service.ts` is
 * what the purchase flow uses, backed by the connected registrar/DNS provider, with throttling and
 * an audit trail. This file does NOT re-implement it. It reuses `lookupDomainInfo` (the same WHOIS/
 * RDAP provider resolution the domain pages use) for a definitive registry answer, and falls back to
 * two independent, clearly-labelled signals when no provider is connected:
 *
 *   1. DNS: a name with NS (or SOA) records is registered. NXDOMAIN is a hint, not proof.
 *   2. The public IANA RDAP bootstrap: registry RDAP returning 404 is strong evidence of "not
 *      registered" for the TLDs that publish RDAP.
 *
 * "Available" is never stated as a fact unless a registry said so. A DNS-only signal is reported as
 * LIKELY_AVAILABLE with the evidence attached, because reserved names, premium names and registry
 * holds all exist and none of them are visible over DNS.
 */
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError } from '../core/errors';
import { fetchWithGuard } from '../core/ssrf';
import { pickResolver, queryType } from '../dns/common';
import { normalizeDomain } from '../dns/common';
import { lookupDomainInfo } from '../../domain-services/whois-service';

export type AvailabilityStatus = 'AVAILABLE' | 'REGISTERED' | 'LIKELY_AVAILABLE' | 'UNKNOWN';

export interface AvailabilityEvidence {
  source: 'registrar/provider' | 'registry RDAP' | 'DNS';
  observed: string;
  conclusion: string;
  weight: 'definitive' | 'strong' | 'hint';
}

export interface DomainAvailabilityResult {
  domain: string;
  tld: string;
  status: AvailabilityStatus;
  summary: string;
  evidence: AvailabilityEvidence[];
  registry: {
    whoisStatus: string | null;
    registrar: string | null;
    createdAt: string | null;
    expiresAt: string | null;
    nameservers: string[];
  } | null;
  dns: { hasNs: boolean; hasSoa: boolean; soaSerial: string | null; resolver: string | null };
  durationMs: number;
  warnings: string[];
  notes: string[];
}

interface BootstrapCache {
  services: Array<{ tlds: string[]; urls: string[] }>;
  loadedAt: number;
}

let bootstrapCache: BootstrapCache | null = null;
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;

async function loadRdapBootstrap(): Promise<BootstrapCache> {
  if (bootstrapCache && Date.now() - bootstrapCache.loadedAt < BOOTSTRAP_TTL_MS) return bootstrapCache;
  const response = await fetchWithGuard('https://data.iana.org/rdap/dns.json', {
    timeoutMs: 8000,
    maxBytes: 512 * 1024,
    userAgent: 'CloudHost247-ToolsCenter/1.0 (IANA RDAP bootstrap)',
  });
  if (response.status !== 200) throw new ToolError('SERVICE_UNAVAILABLE', `The IANA RDAP bootstrap answered HTTP ${response.status}.`);
  const payload = JSON.parse(response.bodyText) as { services?: Array<[string[], string[]]> };
  const services = (payload.services ?? []).map(([tlds, urls]) => ({ tlds: tlds.map((tld) => tld.toLowerCase()), urls }));
  if (services.length === 0) throw new ToolError('SERVICE_UNAVAILABLE', 'The IANA RDAP bootstrap contained no services.');
  bootstrapCache = { services, loadedAt: Date.now() };
  return bootstrapCache;
}

/** Test hook: clears the cached bootstrap. */
export function resetRdapBootstrapCache(): void {
  bootstrapCache = null;
}

export interface RegistryProbe {
  reachable: boolean;
  registered: boolean | null;
  detail: string;
  status: number | null;
}

export async function probeRegistryRdap(domain: string): Promise<RegistryProbe> {
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  let bootstrap: BootstrapCache;
  try {
    bootstrap = await loadRdapBootstrap();
  } catch (error) {
    return { reachable: false, registered: null, detail: error instanceof Error ? error.message : 'The RDAP bootstrap could not be loaded.', status: null };
  }
  const service = bootstrap.services.find((entry) => entry.tlds.includes(tld));
  if (!service || service.urls.length === 0) {
    return { reachable: false, registered: null, detail: `The IANA RDAP bootstrap has no RDAP service listed for .${tld}.`, status: null };
  }
  const base = service.urls[0]!.replace(/\/$/, '');
  try {
    const response = await fetchWithGuard(`${base}/domain/${encodeURIComponent(domain)}`, {
      timeoutMs: 10_000,
      maxBytes: 512 * 1024,
      headers: { accept: 'application/rdap+json, application/json' },
      userAgent: 'CloudHost247-ToolsCenter/1.0 (domain availability)',
    });
    if (response.status === 404) return { reachable: true, registered: false, detail: `${base} returned 404 for the domain object: the registry has no registration for it.`, status: 404 };
    if (response.status === 200) return { reachable: true, registered: true, detail: `${base} returned the domain object, so the registry has it registered.`, status: 200 };
    if (response.status === 429) return { reachable: true, registered: null, detail: `${base} is rate limiting this server (HTTP 429).`, status: 429 };
    return { reachable: true, registered: null, detail: `${base} answered HTTP ${response.status}.`, status: response.status };
  } catch (error) {
    return { reachable: false, registered: null, detail: `The registry RDAP query failed: ${error instanceof Error ? error.message : 'unknown error'}`, status: null };
  }
}

export interface AvailabilityInput {
  domain: string;
  userId?: string | null;
  /** Skip the platform provider path and use only the public signals (used by tests). */
  publicSignalsOnly?: boolean;
}

export async function checkDomainAvailability(db: Queryable, input: AvailabilityInput): Promise<DomainAvailabilityResult> {
  const started = performance.now();
  const domain = normalizeDomain(input.domain ?? '');
  if (!domain.includes('.')) throw invalidInput('Enter a complete domain name including the TLD, for example example.com.');
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  const evidence: AvailabilityEvidence[] = [];
  const warnings: string[] = [];

  let registry: DomainAvailabilityResult['registry'] = null;
  let providerAnswer: 'completed' | 'not_found' | 'provider_not_configured' | 'rate_limited' | 'provider_error' | null = null;

  if (!input.publicSignalsOnly) {
    try {
      const outcome = await lookupDomainInfo(db, input.userId ?? null, domain);
      providerAnswer = outcome.status;
      if (outcome.status === 'completed' && outcome.result) {
        registry = {
          whoisStatus: outcome.result.statuses.join(', ') || null,
          registrar: outcome.result.registrar,
          createdAt: outcome.result.createdAt,
          expiresAt: outcome.result.expiresAt,
          nameservers: outcome.result.nameservers,
        };
        evidence.push({ source: 'registrar/provider', observed: `Registrar: ${outcome.result.registrar ?? 'not stated'}`, conclusion: 'The connected registrar/RDAP provider returned a registration record, so the domain is registered.', weight: 'definitive' });
      } else if (outcome.status === 'not_found') {
        evidence.push({ source: 'registrar/provider', observed: 'The provider had no record for this domain.', conclusion: 'No registration record was found by the connected provider.', weight: 'strong' });
      } else if (outcome.status === 'rate_limited') {
        warnings.push('The platform provider is rate limiting lookups, so the availability result below relies on public signals only.');
      } else if (outcome.status === 'provider_error') {
        warnings.push(`The platform provider returned an error: ${outcome.message ?? 'no detail'}. Falling back to public signals.`);
      }
    } catch (error) {
      warnings.push(`The platform provider path was unavailable: ${error instanceof Error ? error.message : 'unknown error'}. Falling back to public signals.`);
    }
  }

  // DNS signal — always collected, cheap, and independently useful.
  const resolver = await pickResolver(db);
  let hasNs = false;
  let hasSoa = false;
  let soaSerial: string | null = null;
  let resolverName: string | null = null;
  try {
    const ns = await queryType(resolver, domain, 'NS');
    hasNs = ns.records.some((record) => record.type === 'NS');
    resolverName = ns.meta.resolver.name;
    if (!hasNs) {
      const soa = await queryType(resolver, domain, 'SOA');
      hasSoa = soa.records.some((record) => record.type === 'SOA');
      soaSerial = String(soa.records[0]?.data.serial ?? '') || null;
    }
  } catch (error) {
    warnings.push(`The DNS check failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (hasNs || hasSoa) {
    evidence.push({
      source: 'DNS',
      observed: hasNs ? `NS records exist (queried via ${resolverName ?? 'the configured resolver'})` : `An SOA record exists (serial ${soaSerial ?? 'unknown'})`,
      conclusion: 'The name exists in the DNS, which means it is registered and delegated (or at least held by a registry with a zone).',
      weight: 'strong',
    });
  } else {
    evidence.push({ source: 'DNS', observed: 'No NS or SOA records were returned.', conclusion: 'The name has no delegation, which is the expected state for an unregistered domain — but NXDOMAIN alone is not proof.', weight: 'hint' });
  }

  // Registry RDAP signal, when the provider did not already answer definitively.
  if (providerAnswer !== 'completed' && providerAnswer !== 'not_found') {
    const probe = await probeRegistryRdap(domain);
    if (probe.registered === true) {
      evidence.push({ source: 'registry RDAP', observed: probe.detail, conclusion: 'The registry that operates this TLD has the domain registered.', weight: 'definitive' });
    } else if (probe.registered === false) {
      evidence.push({ source: 'registry RDAP', observed: probe.detail, conclusion: 'The registry published no object for this domain.', weight: 'strong' });
    } else {
      evidence.push({ source: 'registry RDAP', observed: probe.detail, conclusion: 'The registry query was inconclusive.', weight: 'hint' });
    }
  }

  const registeredEvidence = evidence.some((entry) => entry.conclusion.includes('registered') && entry.weight !== 'hint');
  const unregisteredStrong = evidence.some((entry) => entry.source === 'registry RDAP' && entry.weight === 'strong') || evidence.some((entry) => entry.source === 'registrar/provider' && entry.weight === 'strong' && entry.conclusion.includes('No registration record'));
  const blockedByDns = hasNs || hasSoa;

  let status: AvailabilityStatus;
  let summary: string;
  if (registeredEvidence || blockedByDns) {
    status = 'REGISTERED';
    summary = `${domain} appears to be REGISTERED.`;
  } else if (unregisteredStrong) {
    status = 'AVAILABLE';
    summary = `${domain} appears to be AVAILABLE (no registration record and no DNS delegation).`;
    warnings.push('Availability is not the same as price or eligibility: a registry may hold the name as reserved or premium, and some TLDs restrict who may register. The final answer comes from the registrar checkout.');
  } else {
    status = 'LIKELY_AVAILABLE';
    summary = `${domain} looks available, but the evidence is indirect (no delegation and no conclusive registry answer).`;
    warnings.push('No conclusive registry answer was available for this TLD, so this is a hint rather than a fact. Confirm with a registrar before relying on it.');
  }

  return {
    domain,
    tld,
    status,
    summary,
    evidence,
    registry,
    dns: { hasNs, hasSoa, soaSerial, resolver: resolverName },
    durationMs: Math.round(performance.now() - started),
    warnings,
    notes: [
      'Signals used: the platform registrar/RDAP provider (definitive when it answers), the registry RDAP endpoint published in the IANA bootstrap (strong), and live DNS delegation (strong evidence of registration, weak evidence of the opposite).',
      'A registered domain can still be for sale by its owner; an unregistered name can still be reserved, premium-priced or restricted to certain registrant types.',
      'This tool checks one name at a time and is rate limited. It is not a bulk availability service and must not be used to scrape registries.',
    ],
  };
}
