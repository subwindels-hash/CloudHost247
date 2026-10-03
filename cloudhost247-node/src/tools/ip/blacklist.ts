/**
 * Tools Center — IP blacklist checker (spec §21).
 *
 * The provider list is data, not code: each row in `tool_provider_configs` with kind DNSBL is a real
 * DNS-based blocklist an operator has enabled. Results are strictly three-valued per provider:
 *
 *   LISTED      — the zone answered with an address in 127.0.0.0/8 (the DNSBL convention), plus any
 *                 reason text the zone publishes.
 *   NOT_LISTED  — the zone authoritatively answered NXDOMAIN for the query name.
 *   ERROR       — the zone refused, timed out or answered SERVFAIL. This is *not* "clean": several
 *                 large blocklists refuse queries from public recursive resolvers, and reporting
 *                 that as "not listed" would be a fabricated reassurance.
 *
 * There is no built-in list to fall back on, and no synthetic provider is ever created.
 */
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { invalidInput } from '../core/errors';
import { parseIp, blockedReason } from '../core/ssrf';
import { queryResolver } from '../core/dns-client';
import { recordProviderOutcome, usableProviders, type ProviderView } from '../core/providers';
import { listResolvers, toResolverTarget, type ResolverRow } from '../core/resolvers';

export type BlacklistStatus = 'LISTED' | 'NOT_LISTED' | 'ERROR' | 'SKIPPED';

export interface BlacklistProviderResult {
  provider: string;
  slug: string;
  zone: string;
  status: BlacklistStatus;
  /** 127.0.0.x return code when listed. */
  returnCode: string | null;
  reason: string | null;
  /** Delisting/removal guidance published by the provider, when configured. */
  removal: { url: string | null; note: string | null };
  responseTimeMs: number | null;
  detail: string;
  checkedAt: string;
}

export interface BlacklistResult {
  address: string;
  version: 4 | 6;
  listedOn: string[];
  results: BlacklistProviderResult[];
  summary: {
    providersChecked: number;
    listed: number;
    notListed: number;
    errors: number;
    skipped: number;
  };
  resolver: { name: string; ip: string; protocol: string } | null;
  warnings: string[];
  delistingGuidance: string[];
  checkedAt: string;
}

/** Builds the DNSBL query name for an address (RFC 5782 style; IPv6 uses nibble order). */
export function blacklistQueryName(address: string, zone: string): string | null {
  const parsed = parseIp(address);
  if (!parsed) return null;
  if (parsed.version === 4) return `${parsed.bytes.slice().reverse().join('.')}.${zone}`;
  const nibbles = parsed.bytes
    .flatMap((byte) => [byte & 0x0f, byte >> 4])
    .reverse()
    .map((nibble) => nibble.toString(16));
  return `${nibbles.join('.')}.${zone}`;
}

/** Interprets a DNSBL answer: an A record in 127.0.0.0/8 means "listed". */
export function interpretAnswer(addresses: string[]): { listed: boolean; code: string | null } {
  for (const address of addresses) {
    const parsed = parseIp(address);
    if (parsed?.version === 4 && parsed.bytes[0] === 127) {
      return { listed: true, code: address };
    }
  }
  return { listed: false, code: null };
}

function reasonFromCode(code: string | null, mapping: Record<string, string> | undefined): string | null {
  if (!code || !mapping) return null;
  const last = code.split('.').pop() ?? '';
  return mapping[last] ?? null;
}

export interface BlacklistInput {
  address: string;
  resolverId?: string;
  /** Limit to a subset of provider slugs (the UI's "quick check"). */
  providerSlugs?: string[];
  deadlineMs?: number;
}

export async function blacklistCheck(db: Queryable, input: BlacklistInput): Promise<BlacklistResult> {
  const parsed = parseIp(input.address);
  if (!parsed) throw invalidInput(`"${input.address}" is not a valid IPv4 or IPv6 address.`);
  if (blockedReason(parsed.normalized) !== null) {
    throw invalidInput(
      `"${parsed.normalized}" is a private or reserved address. Blocklists only cover public addresses, so a result here would be meaningless.`
    );
  }

  const warnings: string[] = [];
  let providers: ProviderView[] = await usableProviders(db, 'DNSBL');
  if (input.providerSlugs && input.providerSlugs.length > 0) {
    const wanted = new Set(input.providerSlugs.map((slug) => slug.toLowerCase()));
    providers = providers.filter((provider) => wanted.has(provider.slug));
  }

  if (providers.length === 0) {
    warnings.push(
      'No DNS blocklist provider is enabled, so nothing was checked. A Super Admin can enable providers under Admin → Tools → Providers.'
    );
    return {
      address: parsed.normalized,
      version: parsed.version,
      listedOn: [],
      results: [],
      summary: { providersChecked: 0, listed: 0, notListed: 0, errors: 0, skipped: 0 },
      resolver: null,
      warnings,
      delistingGuidance: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const resolvers = await listResolvers(db, { enabledOnly: true, limit: 20 });
  const resolver: ResolverRow | undefined = input.resolverId
    ? resolvers.find((row) => row.id === input.resolverId) ?? resolvers[0]
    : resolvers[0];
  if (!resolver) {
    warnings.push('No DNS resolver is enabled, so blocklist queries could not be sent.');
    return {
      address: parsed.normalized,
      version: parsed.version,
      listedOn: [],
      results: providers.map((provider) => ({
        provider: provider.name,
        slug: provider.slug,
        zone: String(provider.configuration.zone ?? provider.endpoint ?? ''),
        status: 'ERROR' as const,
        returnCode: null,
        reason: null,
        removal: { url: (provider.configuration.removalUrl as string) ?? null, note: null },
        responseTimeMs: null,
        detail: 'No resolver available.',
        checkedAt: new Date().toISOString(),
      })),
      summary: { providersChecked: providers.length, listed: 0, notListed: 0, errors: providers.length, skipped: 0 },
      resolver: null,
      warnings,
      delistingGuidance: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const deadline = performance.now() + (input.deadlineMs ?? 20_000);
  const results: BlacklistProviderResult[] = [];

  for (const provider of providers) {
    const zone = String(provider.configuration.zone ?? provider.endpoint ?? '');
    const checkedAt = new Date().toISOString();
    const removal = {
      url: typeof provider.configuration.removalUrl === 'string' ? provider.configuration.removalUrl : null,
      note: typeof provider.configuration.removalNote === 'string' ? provider.configuration.removalNote : null,
    };

    if (!zone) {
      results.push({
        provider: provider.name,
        slug: provider.slug,
        zone: '',
        status: 'ERROR',
        returnCode: null,
        reason: null,
        removal,
        responseTimeMs: null,
        detail: 'This provider has no zone name configured.',
        checkedAt,
      });
      continue;
    }

    if (parsed.version === 6 && provider.configuration.supportsIpv6 !== true) {
      results.push({
        provider: provider.name,
        slug: provider.slug,
        zone,
        status: 'SKIPPED',
        returnCode: null,
        reason: null,
        removal,
        responseTimeMs: null,
        detail: 'This provider does not publish an IPv6 zone, so it cannot be queried for an IPv6 address.',
        checkedAt,
      });
      continue;
    }

    if (performance.now() > deadline) {
      results.push({
        provider: provider.name,
        slug: provider.slug,
        zone,
        status: 'ERROR',
        returnCode: null,
        reason: null,
        removal,
        responseTimeMs: null,
        detail: 'The overall time limit for this check was reached before this provider was queried.',
        checkedAt,
      });
      continue;
    }

    const queryName = blacklistQueryName(parsed.normalized, zone);
    const startedAt = performance.now();
    const outcome = await queryResolver(toResolverTarget(resolver), queryName!, 'A', { timeoutMs: 4000 });
    const responseTimeMs = Math.round(performance.now() - startedAt);

    if (!outcome.ok) {
      const refused = outcome.code === 'REFUSED' || outcome.code === 'SERVFAIL';
      results.push({
        provider: provider.name,
        slug: provider.slug,
        zone,
        status: 'ERROR',
        returnCode: null,
        reason: null,
        removal,
        responseTimeMs,
        detail: refused
          ? `${resolver.name} was refused by this zone (${outcome.rcodeText ?? outcome.code}). Several blocklists refuse queries from public resolvers by policy, so this is an inconclusive result rather than a clean one.`
          : `${resolver.name} could not get an answer: ${outcome.message}`,
        checkedAt,
      });
      await recordProviderOutcome(db, provider.slug, { ok: false, error: outcome.message });
      continue;
    }

    const addresses = outcome.message.answers.filter((record) => record.type === 'A').map((record) => String(record.data.address ?? ''));
    const interpretation = interpretAnswer(addresses);

    if (!interpretation.listed && outcome.message.rcode === 3) {
      results.push({
        provider: provider.name,
        slug: provider.slug,
        zone,
        status: 'NOT_LISTED',
        returnCode: null,
        reason: null,
        removal,
        responseTimeMs,
        detail: 'The zone authoritatively answered NXDOMAIN, which is the "not listed" answer.',
        checkedAt,
      });
      await recordProviderOutcome(db, provider.slug, { ok: true, latencyMs: responseTimeMs });
    } else if (!interpretation.listed) {
      results.push({
        provider: provider.name,
        slug: provider.slug,
        zone,
        status: 'ERROR',
        returnCode: null,
        reason: null,
        removal,
        responseTimeMs,
        detail: `The zone answered ${outcome.message.rcodeText} with ${addresses.length} record(s) outside 127.0.0.0/8, which is not a valid DNSBL answer.`,
        checkedAt,
      });
      await recordProviderOutcome(db, provider.slug, { ok: false, error: 'Unrecognised DNSBL answer' });
    } else {
      // Listed. Query TXT for the reason where the zone supports it.
      let reason: string | null = reasonFromCode(interpretation.code, provider.configuration.listingReasonCodes as Record<string, string> | undefined);
      try {
        const txt = await queryResolver(toResolverTarget(resolver), queryName!, 'TXT', { timeoutMs: 3000 });
        if (txt.ok) {
          const texts = txt.message.answers.filter((record) => record.type === 'TXT').map((record) => String(record.data.value ?? ''));
          if (texts.length > 0) reason = texts.join(' ');
        }
      } catch {
        // Reason text is a bonus; the listing itself is already established.
      }
      results.push({
        provider: provider.name,
        slug: provider.slug,
        zone,
        status: 'LISTED',
        returnCode: interpretation.code,
        reason,
        removal,
        responseTimeMs,
        detail: `${resolver.name} received ${interpretation.code} for this address from ${zone}.`,
        checkedAt,
      });
      await recordProviderOutcome(db, provider.slug, { ok: true, latencyMs: responseTimeMs });
    }
  }

  const listedOn = results.filter((result) => result.status === 'LISTED').map((result) => result.provider);
  const delistingGuidance = results
    .filter((result) => result.status === 'LISTED')
    .map((result) => result.removal.url ?? `Contact ${result.provider}'s delisting page (no removal URL is configured in CloudHost247).`);

  if (results.some((result) => result.status === 'NOT_LISTED')) {
    warnings.push(
      'A "not listed" result means only that this provider\'s zone did not list the address when queried. It is not a statement about the address\'s overall reputation.'
    );
  }
  if (results.some((result) => result.status === 'ERROR')) {
    warnings.push('Providers that returned an error were not checked successfully; treat those entries as unknown, not clean.');
  }

  return {
    address: parsed.normalized,
    version: parsed.version,
    listedOn,
    results,
    summary: {
      providersChecked: results.length,
      listed: results.filter((result) => result.status === 'LISTED').length,
      notListed: results.filter((result) => result.status === 'NOT_LISTED').length,
      errors: results.filter((result) => result.status === 'ERROR').length,
      skipped: results.filter((result) => result.status === 'SKIPPED').length,
    },
    resolver: { name: resolver.name, ip: resolver.ip_address, protocol: resolver.protocol },
    warnings,
    delistingGuidance,
    checkedAt: new Date().toISOString(),
  };
}

/** Provider list for the tool UI (includes disabled providers so the UI can explain the gap). */
export async function blacklistProviders(db: Queryable): Promise<Array<{ slug: string; name: string; zone: string; enabled: boolean; usable: boolean; removalUrl: string | null; supportsIpv6: boolean }>> {
  const { listProviders, toProviderView } = await import('../core/providers');
  const rows = await listProviders(db, { kind: 'DNSBL' });
  return rows.map((row) => {
    const view = toProviderView(row);
    return {
      slug: row.slug,
      name: row.name,
      zone: String(row.configuration.zone ?? row.endpoint ?? ''),
      enabled: row.enabled,
      usable: view.usable,
      removalUrl: typeof row.configuration.removalUrl === 'string' ? row.configuration.removalUrl : null,
      supportsIpv6: row.configuration.supportsIpv6 === true,
    };
  });
}
