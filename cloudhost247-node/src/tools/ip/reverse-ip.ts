/**
 * Tools Center — reverse IP lookup (spec §13).
 *
 * The catalogue entry for this tool is explicit: there is no DNS mechanism that lists the domains
 * behind an IP address, so the domain list requires an administrator-configured REVERSE_IP provider
 * (a commercial dataset: SecurityTrails, ViewDNS, Shodan, and similar). Until one exists, the tool
 * returns the parts that ARE knowable for free — PTR records, the ASN that announces the address,
 * and whether the name pattern suggests shared hosting — and reports the domain list as
 * CONFIGURATION_REQUIRED instead of inventing it.
 *
 * Even with a provider, the result is labelled as "that provider's index", never "all domains".
 */
import type { Queryable } from '../../db/types';
import { invalidInput, ToolError } from '../core/errors';
import { fetchWithGuard } from '../core/ssrf';
import { parseIp } from '../core/ssrf';
import { reverseDnsLookup } from '../dns/lookup';
import { ipLookup } from './ip-service';
import { providerSecret, recordProviderOutcome, usableProviders } from '../core/providers';

export interface ReverseIpResult {
  address: string;
  reverseDns: string[];
  asn: { number: number | null; name: string | null; prefix: string | null; country: string | null; registry: string | null; allocatedAt: string | null } | null;
  provider: {
    configured: boolean;
    name: string | null;
    slug: string | null;
    status: 'OK' | 'NOT_CONFIGURED' | 'ERROR';
    detail: string;
    resultCount: number | null;
  };
  domains: Array<{ name: string; firstSeen: string | null; lastSeen: string | null; detail: string | null }>;
  hostingAssessment: { likelyShared: boolean; detail: string };
  notes: string[];
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export async function reverseIpLookup(db: Queryable, input: { address: string; resolverId?: string }): Promise<ReverseIpResult> {
  const parsed = parseIp((input.address ?? '').trim());
  if (!parsed) throw invalidInput('Enter a valid IPv4 or IPv6 address.');

  // Free, always-honest parts.
  const ptr = await reverseDnsLookup(db, { address: parsed.normalized, resolverId: input.resolverId }).catch(() => null);
  const lookup = await ipLookup(db, { address: parsed.normalized, includeReverse: false }).catch(() => null);

  const providers = await usableProviders(db, 'REVERSE_IP');
  const provider = providers[0] ?? null;
  const reverseDns = (ptr?.hostnames ?? []).filter((hostname): hostname is string => typeof hostname === 'string' && hostname.length > 0);

  const sharedHostingHints: string[] = [];
  if (reverseDns.length === 0) sharedHostingHints.push('There is no PTR record, which is common for addresses allocated to hosting ranges.');
  if (reverseDns.some((hostname) => /(?:shared|hosting|server|vps|cloud|static|dynamic|customer|dedicated)/i.test(hostname))) {
    sharedHostingHints.push('The PTR name contains a hosting-provider word (shared, hosting, server, cloud, …).');
  }
  if (lookup?.asn?.asName && /hosting|cloud|server|datacenter|data centre|vps|dedicated|colo/i.test(lookup.asn.asName)) {
    sharedHostingHints.push(`The address is announced by ${lookup.asn.asName}, which is a hosting/cloud network.`);
  }

  if (!provider) {
    return {
      address: parsed.normalized,
      reverseDns,
      asn: lookup?.asn ? { number: lookup.asn.asn, name: lookup.asn.asName, prefix: lookup.asn.prefix, country: lookup.asn.countryCode, registry: lookup.asn.registry, allocatedAt: lookup.asn.allocatedAt } : null,
      provider: {
        configured: false,
        name: null,
        slug: null,
        status: 'NOT_CONFIGURED',
        detail:
          'No REVERSE_IP provider is configured. A Super Admin can add one under Admin → Tools → Providers; the free signals above (PTR records and the announcing ASN) are shown regardless.',
        resultCount: null,
      },
      domains: [],
      hostingAssessment: {
        likelyShared: sharedHostingHints.length > 0,
        detail: sharedHostingHints.length > 0 ? sharedHostingHints.join(' ') : 'No strong signal either way. The absence of a signal says nothing about what is hosted on the address.',
      },
      notes: [
        'Domain lists for an IP come from a provider\'s crawl/index, not from DNS. They are incomplete by nature and can be out of date.',
        'IPv6 in particular is usually allocated in large blocks, so "domains on this address" is rarely a meaningful question for a /64 or larger.',
      ],
    };
  }

  const template = typeof provider.configuration.pathTemplate === 'string' ? provider.configuration.pathTemplate : '/{ip}';
  const jsonPath = typeof provider.configuration.jsonPaths === 'object' && provider.configuration.jsonPaths !== null
    ? String((provider.configuration.jsonPaths as Record<string, unknown>).domains ?? 'domains')
    : 'domains';
  const apiKeyHeader = typeof provider.configuration.apiKeyHeader === 'string' ? provider.configuration.apiKeyHeader : null;
  const url = `${(provider.endpoint ?? '').replace(/\/$/, '')}${template.replace('{ip}', encodeURIComponent(parsed.normalized))}`;

  try {
    const secret = await providerSecret(db, provider.slug);
    const response = await fetchWithGuard(url, {
      timeoutMs: provider.timeoutMs,
      maxBytes: 1024 * 1024,
      headers: {
        accept: 'application/json',
        ...(secret.apiKey && apiKeyHeader ? { [apiKeyHeader]: secret.apiKey } : {}),
        ...(secret.apiKey && !apiKeyHeader ? { authorization: `Bearer ${secret.apiKey}` } : {}),
      },
      userAgent: 'CloudHost247-ToolsCenter/1.0 (reverse IP)',
    });
    if (response.status === 429) throw new ToolError('RATE_LIMITED', 'The reverse-IP provider is rate limiting this platform.');
    if (response.status !== 200) throw new ToolError('PROVIDER_ERROR', `The reverse-IP provider answered HTTP ${response.status}.`);
    const payload = JSON.parse(response.bodyText) as Record<string, unknown>;
    const rawDomains = readPath(payload, jsonPath);
    const domains = (Array.isArray(rawDomains) ? rawDomains : []).slice(0, 500).map((entry) => {
      if (typeof entry === 'string') return { name: entry, firstSeen: null, lastSeen: null, detail: null };
      const record = (entry ?? {}) as Record<string, unknown>;
      return {
        name: String(record.name ?? record.domain ?? record.hostname ?? ''),
        firstSeen: typeof record.first_seen === 'string' ? record.first_seen : null,
        lastSeen: typeof record.last_seen === 'string' ? record.last_seen : null,
        detail: typeof record.detail === 'string' ? record.detail : null,
      };
    }).filter((entry) => entry.name.length > 0);

    await recordProviderOutcome(db, provider.slug, { ok: true });

    return {
      address: parsed.normalized,
      reverseDns,
      asn: lookup?.asn ? { number: lookup.asn.asn, name: lookup.asn.asName, prefix: lookup.asn.prefix, country: lookup.asn.countryCode, registry: lookup.asn.registry, allocatedAt: lookup.asn.allocatedAt } : null,
      provider: { configured: true, name: provider.name, slug: provider.slug, status: 'OK', detail: `${provider.name} returned ${domains.length} hostname(s).`, resultCount: domains.length },
      domains,
      hostingAssessment: {
        likelyShared: domains.length > 1 || sharedHostingHints.length > 0,
        detail: domains.length > 1
          ? `${domains.length} hostnames share this address, which is the definition of shared hosting — one address serving many sites.`
          : sharedHostingHints.length > 0
            ? sharedHostingHints.join(' ')
            : 'One or zero hostnames were found, so the address may be dedicated — but a provider index can also simply be incomplete.',
      },
      notes: [
        'These hostnames are what the provider has observed or indexed. The list is not authoritative and is not a substitute for a security assessment of the address.',
        'Sharing an IP address with other sites is normal on shared hosting and is not itself a problem. Use the blacklist checker to see whether the address appears on abuse lists.',
      ],
    };
  } catch (error) {
    const message = error instanceof ToolError ? error.message : `The reverse-IP lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    await recordProviderOutcome(db, provider.slug, { ok: false, error: message });
    if (error instanceof ToolError && error.code !== 'PROVIDER_ERROR') throw error;
    return {
      address: parsed.normalized,
      reverseDns,
      asn: lookup?.asn ? { number: lookup.asn.asn, name: lookup.asn.asName, prefix: lookup.asn.prefix, country: lookup.asn.countryCode, registry: lookup.asn.registry, allocatedAt: lookup.asn.allocatedAt } : null,
      provider: { configured: true, name: provider.name, slug: provider.slug, status: 'ERROR', detail: message, resultCount: null },
      domains: [],
      hostingAssessment: { likelyShared: sharedHostingHints.length > 0, detail: sharedHostingHints.join(' ') || 'The provider lookup failed, so no hosting assessment is possible.' },
      notes: ['The provider request failed; the free signals above are still real. Check the provider configuration under Admin → Tools → Providers.'],
    };
  }
}
