/**
 * WHOIS/RDAP owner lookup — privacy-preserving by design.
 *
 * RDAP-first: the connected RDAP provider (IANA bootstrap) is queried; classic WHOIS is the
 * fallback transport inside that provider. Only the public projection is persisted — registrar,
 * dates, statuses, nameservers — never raw registrant records. Privacy-protected registrations
 * are reported exactly as protected; no bypass is attempted anywhere.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { DomainProviderError, safeDomainProviderMessage } from './providers/types';
import { resolveConnectedDomainProvider } from './provider-service';
import { isValidDomainName, normalizeDomainName } from './domain-name';
import { ValidationError } from '../lib/errors';
import { WHOIS_LOOKUP_MAX_PER_HOUR } from './config';

export interface WhoisLookupOutcome {
  lookupId: string | null;
  status: 'completed' | 'provider_not_configured' | 'not_found' | 'rate_limited' | 'provider_error';
  message: string | null;
  result: {
    domainName: string;
    registrar: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    expiresAt: string | null;
    statuses: string[];
    nameservers: string[];
    registry: string | null;
    source: string;
    privacyProtected: boolean;
    registrant: string;
  } | null;
}

export async function lookupDomainInfo(
  db: Queryable,
  userId: string | null,
  domainName: string
): Promise<WhoisLookupOutcome> {
  const normalized = normalizeDomainName(domainName);
  if (!isValidDomainName(normalized)) {
    throw new ValidationError('Enter a valid domain name, e.g. example.com');
  }

  // Per-user hourly throttle (authenticated lookups only; anonymous calls carry the stricter
  // route-level IP limit instead).
  if (userId) {
    const { rows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM domain_whois_lookups
        WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [userId]
    );
    if (Number(rows[0]?.count ?? 0) >= WHOIS_LOOKUP_MAX_PER_HOUR) {
      return {
        lookupId: null,
        status: 'rate_limited',
        message: `You can perform ${WHOIS_LOOKUP_MAX_PER_HOUR} lookups per hour. Please try again later.`,
        result: null,
      };
    }
  }

  let provider;
  try {
    provider = await resolveConnectedDomainProvider(db, 'rdap');
  } catch (error) {
    if (error instanceof DomainProviderError && error.code === 'PROVIDER_NOT_CONFIGURED') {
      return {
        lookupId: null,
        status: 'provider_not_configured',
        message: 'Service Provider Not Configured',
        result: null,
      };
    }
    throw error;
  }

  try {
    const info = await provider.adapter.getDomainInfo(normalized);
    const lookupId = randomUUID();
    await db.query(
      `INSERT INTO domain_whois_lookups
         (id, user_id, provider_id, domain_name, source, status, public_result, privacy_protected,
          provider_reference, completed_at)
       VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8,now())`,
      [
        lookupId,
        userId,
        provider.provider.id,
        normalized,
        info.source,
        JSON.stringify({
          registrar: info.registrar,
          createdAt: info.createdAt,
          updatedAt: info.updatedAt,
          expiresAt: info.expiresAt,
          statuses: info.statuses,
          nameservers: info.nameservers,
          registry: info.registry,
        }),
        info.privacyProtected,
        info.providerReference,
      ]
    );

    return {
      lookupId,
      status: 'completed',
      message: null,
      result: {
        domainName: info.domainName,
        registrar: info.registrar,
        createdAt: info.createdAt,
        updatedAt: info.updatedAt,
        expiresAt: info.expiresAt,
        statuses: info.statuses,
        nameservers: info.nameservers,
        registry: info.registry,
        source: info.source,
        privacyProtected: info.privacyProtected,
        registrant: info.privacyProtected
          ? 'Registrant information is privacy protected or unavailable.'
          : 'Registrant details are not published by this registry.',
      },
    };
  } catch (error) {
    // A registry 404 is a real answer: the domain has no record.
    if (error instanceof DomainProviderError && /No registry record found/.test(error.message)) {
      const lookupId = randomUUID();
      await db.query(
        `INSERT INTO domain_whois_lookups (id, user_id, provider_id, domain_name, source, status, public_result)
         VALUES ($1,$2,$3,$4,'rdap','not_found','{}'::jsonb)`,
        [lookupId, userId, provider.provider.id, normalized]
      );
      return {
        lookupId,
        status: 'not_found',
        message: `No registration record was found for ${normalized}.`,
        result: null,
      };
    }

    const lookupId = randomUUID();
    await db.query(
      `INSERT INTO domain_whois_lookups (id, user_id, provider_id, domain_name, source, status, public_result, error_code, error_message)
       VALUES ($1,$2,$3,$4,'rdap','failed','{}'::jsonb,$5,$6)`,
      [
        lookupId,
        userId,
        provider.provider.id,
        normalized,
        error instanceof DomainProviderError ? error.code : 'PROVIDER_ERROR',
        error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      ]
    );
    return {
      lookupId,
      status: 'provider_error',
      message: safeDomainProviderMessage(error),
      result: null,
    };
  }
}

export async function listMyWhoisLookups(db: Queryable, userId: string, limit = 25) {
  const { rows } = await db.query(
    `SELECT id, domain_name, source, status, privacy_protected, public_result, created_at, completed_at
       FROM domain_whois_lookups
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
