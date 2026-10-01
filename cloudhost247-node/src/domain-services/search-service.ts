/**
 * Domain search — single and bulk, provider-confirmed only.
 *
 * Invariants enforced here:
 *   - A domain is only reported `available` when the connected registrar's adapter actually said
 *     so for that exact name. Provider failures surface as `provider_error`, never as a
 *     registration answer.
 *   - Prices shown come from the provider response (premium quotes) or the synced provider
 *     offering catalogue — never from the client, never invented.
 *   - Bulk search is bounded, batched and user-throttled; it can never fan out an unbounded
 *     number of registrar API calls.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { DomainProviderError, safeDomainProviderMessage, type DomainAvailability } from './providers/types';
import { resolveConnectedDomainProvider } from './provider-service';
import {
  BULK_SEARCH_BATCH_SIZE,
  BULK_SEARCH_MAX_DOMAINS,
  BULK_SEARCH_MAX_PER_HOUR,
  BULK_SEARCH_USER_COOLDOWN_SECONDS,
  SINGLE_SEARCH_MAX_RESULTS,
} from './config';
import { isValidDomainName, normalizeDomainName, parseDomainQuery, parseBulkDomainInput } from './domain-name';
import { ValidationError } from '../lib/errors';

export interface SearchResultRow {
  domainName: string;
  availabilityStatus: 'available' | 'registered' | 'premium' | 'unavailable' | 'unsupported' | 'provider_error';
  isPremium: boolean;
  registrationPrice: string | null;
  renewalPrice: string | null;
  transferPrice: string | null;
  currency: string | null;
}

export interface DomainSearchOutcome {
  searchId: string;
  queryLabel: string;
  status: 'completed' | 'provider_not_configured' | 'provider_error' | 'rate_limited';
  message: string | null;
  results: SearchResultRow[];
}

interface OfferingRow {
  extension: string;
  registration_price: string | null;
  renewal_price: string | null;
  transfer_price: string | null;
  currency: string;
  premium_supported: boolean;
}

/**
 * Enabled extensions from the connected registrar's synced offerings (newest first per extension).
 * This is the authoritative source of "supported extensions" — if nothing is synced, the platform
 * cannot search anything and says so.
 */
export async function enabledExtensions(db: Queryable): Promise<OfferingRow[]> {
  const { rows } = await db.query<OfferingRow>(
    `SELECT e.extension, o.registration_price, o.renewal_price, o.transfer_price, o.currency, o.premium_supported
       FROM domain_provider_extension_offerings o
       JOIN domain_extensions e ON e.id = o.extension_id
       JOIN domain_service_providers p ON p.id = o.provider_id
      WHERE o.status = 'enabled'
        AND e.status = 'active'
        AND p.status = 'connected'
      ORDER BY e.extension ASC`
  );
  return rows;
}

function offeringFor(offerings: OfferingRow[], domainName: string): OfferingRow | null {
  const normalized = normalizeDomainName(domainName);
  const tld = normalized.slice(normalized.lastIndexOf('.'));
  return offerings.find((offering) => offering.extension.toLowerCase() === tld) ?? null;
}

function priceFromAvailability(availability: DomainAvailability): {
  registrationPrice: string | null;
  renewalPrice: string | null;
  transferPrice: string | null;
  currency: string | null;
} {
  if (!availability.pricing) return { registrationPrice: null, renewalPrice: null, transferPrice: null, currency: null };
  return {
    registrationPrice: availability.pricing.registration?.amount ?? null,
    renewalPrice: availability.pricing.renewal?.amount ?? null,
    transferPrice: availability.pricing.transfer?.amount ?? null,
    currency: availability.pricing.registration?.currency ?? availability.pricing.renewal?.currency ?? null,
  };
}

/** Fills missing per-domain prices from the synced offering catalogue (base, non-premium prices). */
function mergeWithOffering(availability: DomainAvailability, offering: OfferingRow | null): SearchResultRow {
  const fromProvider = priceFromAvailability(availability);
  const registrationPrice = fromProvider.registrationPrice ?? offering?.registration_price ?? null;
  const renewalPrice = fromProvider.renewalPrice ?? offering?.renewal_price ?? null;
  const transferPrice = fromProvider.transferPrice ?? offering?.transfer_price ?? null;
  const currency = fromProvider.currency ?? offering?.currency ?? null;
  return {
    domainName: availability.domainName,
    availabilityStatus: availability.status,
    isPremium: availability.status === 'premium' || Boolean(availability.pricing?.premium),
    registrationPrice,
    renewalPrice,
    transferPrice,
    currency,
  };
}

async function persistSearch(
  db: Queryable,
  input: {
    userId: string | null;
    providerId: string | null;
    searchType: 'single' | 'bulk';
    queryLabel: string;
    status: DomainSearchOutcome['status'];
    errorCode: string | null;
    errorMessage: string | null;
    results: SearchResultRow[];
    providerMetadata?: Record<string, unknown>;
  }
): Promise<string> {
  const searchId = randomUUID();
  await db.query(
    `INSERT INTO domain_searches
       (id, user_id, provider_id, search_type, query_label, status, error_code, error_message, request_metadata, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      searchId,
      input.userId,
      input.providerId,
      input.searchType,
      input.queryLabel.slice(0, 253),
      input.status,
      input.errorCode,
      input.errorMessage,
      JSON.stringify(input.providerMetadata ?? {}),
      // Computed in JS rather than reusing the status parameter in SQL — reusing $6 in both a
      // varchar column and a text comparison makes Postgres fail with "inconsistent types
      // deduced for parameter" (SQLSTATE 42P08).
      input.status === 'completed' ? new Date() : null,
    ]
  );

  for (const result of input.results) {
    await db.query(
      `INSERT INTO domain_search_results
         (id, search_id, domain_name, availability_status, is_premium,
          registration_price, renewal_price, transfer_price, currency, provider_metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        searchId,
        result.domainName,
        result.availabilityStatus,
        result.isPremium,
        result.registrationPrice,
        result.renewalPrice,
        result.transferPrice,
        result.currency,
        JSON.stringify({}),
      ]
    );
  }
  return searchId;
}

/**
 * Single domain search. Accepts `example` (term → searched against every enabled extension) or
 * `example.com` (exact). Anonymous searches are allowed (userId null) — the caller is responsible
 * for the route-level rate limit.
 */
export async function searchDomains(
  db: Queryable,
  userId: string | null,
  rawQuery: string
): Promise<DomainSearchOutcome> {
  const parsed = parseDomainQuery(rawQuery);
  if (parsed.error) throw new ValidationError(parsed.error);

  let provider;
  try {
    provider = await resolveConnectedDomainProvider(db, 'registrar');
  } catch (error) {
    if (error instanceof DomainProviderError && error.code === 'PROVIDER_NOT_CONFIGURED') {
      return {
        searchId: await persistSearch(db, {
          userId,
          providerId: null,
          searchType: 'single',
          queryLabel: parsed.domainName ?? parsed.term ?? '',
          status: 'provider_not_configured',
          errorCode: 'PROVIDER_NOT_CONFIGURED',
          errorMessage: null,
          results: [],
        }),
        queryLabel: parsed.domainName ?? parsed.term ?? '',
        status: 'provider_not_configured',
        message: 'Service Provider Not Configured',
        results: [],
      };
    }
    throw error;
  }

  const offerings = await enabledExtensions(db);
  const candidates: string[] = [];
  if (parsed.domainName) {
    candidates.push(parsed.domainName);
  } else if (parsed.term) {
    const extensions = offerings.slice(0, SINGLE_SEARCH_MAX_RESULTS).map((offering) => offering.extension);
    if (extensions.length === 0) {
      // Registrar connected but catalogue not synced: the platform honestly cannot enumerate
      // which extensions to search. Admin must sync the catalogue first.
      return {
        searchId: await persistSearch(db, {
          userId,
          providerId: provider.provider.id,
          searchType: 'single',
          queryLabel: parsed.term,
          status: 'provider_error',
          errorCode: 'CATALOG_NOT_SYNCED',
          errorMessage: 'Extension catalogue has not been synchronized from the registrar',
          results: [],
        }),
        queryLabel: parsed.term,
        status: 'provider_error',
        message: 'Domain search is not ready yet — the extension catalogue has not been synchronized.',
        results: [],
      };
    }
    for (const extension of extensions) {
      candidates.push(`${parsed.term}${extension.startsWith('.') ? extension : `.${extension}`}`);
    }
  }

  const queryLabel = parsed.domainName ?? `${parsed.term} (across ${candidates.length} extensions)`;

  let availability: DomainAvailability[];
  try {
    availability = await provider.adapter.checkAvailability(candidates);
  } catch (error) {
    const code = error instanceof DomainProviderError && error.code === 'RATE_LIMITED' ? 'rate_limited' : 'provider_error';
    const searchId = await persistSearch(db, {
      userId,
      providerId: provider.provider.id,
      searchType: 'single',
      queryLabel,
      status: code,
      errorCode: error instanceof DomainProviderError ? error.code : 'PROVIDER_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error),
      results: [],
    });
    return {
      searchId,
      queryLabel,
      status: code,
      message: safeDomainProviderMessage(error),
      results: [],
    };
  }

  const results = availability.map((entry) => mergeWithOffering(entry, offeringFor(offerings, entry.domainName)));
  const searchId = await persistSearch(db, {
    userId,
    providerId: provider.provider.id,
    searchType: 'single',
    queryLabel,
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    results,
  });

  return { searchId, queryLabel, status: 'completed', message: null, results };
}

export interface BulkSearchOutcome {
  searchId: string;
  status: 'completed' | 'provider_not_configured' | 'provider_error' | 'rate_limited';
  message: string | null;
  submittedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  results: SearchResultRow[];
}

/**
 * Bulk domain search. Per-user, DB-counted throttles (max per rolling hour + cooldown), a hard
 * cap on accepted candidates, and sequential provider batches of BULK_SEARCH_BATCH_SIZE so the
 * registrar API sees a controlled, ordered stream of calls.
 */
export async function bulkSearchDomains(
  db: Queryable,
  userId: string,
  rawInput: string,
  sourceType: 'text' | 'csv' | 'txt'
): Promise<BulkSearchOutcome> {
  const { rows: recent } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM domain_searches
      WHERE user_id = $1 AND search_type = 'bulk' AND created_at > now() - interval '1 hour'`,
    [userId]
  );
  if (Number(recent[0]?.count ?? 0) >= BULK_SEARCH_MAX_PER_HOUR) {
    throw new ValidationError(
      `You can run ${BULK_SEARCH_MAX_PER_HOUR} bulk searches per hour. Please try again later.`
    );
  }

  const { rows: cooldown } = await db.query<{ seconds: string | null }>(
    `SELECT EXTRACT(EPOCH FROM (now() - created_at))::text AS seconds
       FROM domain_searches
      WHERE user_id = $1 AND search_type = 'bulk'
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const sinceSeconds = cooldown[0]?.seconds ? Number(cooldown[0].seconds) : null;
  if (sinceSeconds !== null && sinceSeconds < BULK_SEARCH_USER_COOLDOWN_SECONDS) {
    const waitSeconds = Math.ceil(BULK_SEARCH_USER_COOLDOWN_SECONDS - sinceSeconds);
    throw new ValidationError(`Please wait ${waitSeconds} seconds before running another bulk search.`);
  }

  const parsedInput = parseBulkDomainInput(rawInput, BULK_SEARCH_MAX_DOMAINS);
  if (parsedInput.domains.length === 0) {
    throw new ValidationError('No valid domain names were found in the submitted list');
  }

  let provider;
  try {
    provider = await resolveConnectedDomainProvider(db, 'registrar');
  } catch (error) {
    if (error instanceof DomainProviderError && error.code === 'PROVIDER_NOT_CONFIGURED') {
      return {
        searchId: '',
        status: 'provider_not_configured',
        message: 'Service Provider Not Configured',
        submittedCount: parsedInput.domains.length + parsedInput.rejected,
        acceptedCount: 0,
        rejectedCount: parsedInput.rejected,
        results: [],
      };
    }
    throw error;
  }

  // Bare terms (no dot) are expanded against the enabled extension catalogue, bounded by the
  // same total cap so a term list can never explode the request count. The first five enabled
  // extensions (deterministic alphabetical order) are used per term.
  const offerings = await enabledExtensions(db);
  const candidates: string[] = [];
  const extensionList = offerings.map((offering) => offering.extension.replace(/^\./, '')).slice(0, 5);
  for (const entry of parsedInput.domains) {
    if (isValidDomainName(entry)) {
      if (candidates.length < BULK_SEARCH_MAX_DOMAINS) candidates.push(entry);
      continue;
    }
    for (const extension of extensionList) {
      if (candidates.length >= BULK_SEARCH_MAX_DOMAINS) break;
      candidates.push(`${entry}.${extension}`);
    }
  }

  const availability: DomainAvailability[] = [];
  if (candidates.length === 0) {
    throw new ValidationError(
      'No searchable domains could be built from this list — the extension catalogue has not been synchronized yet.'
    );
  }
  let providerError: DomainProviderError | null = null;
  try {
    for (let offset = 0; offset < candidates.length; offset += BULK_SEARCH_BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + BULK_SEARCH_BATCH_SIZE);
      const batchResults = await provider.adapter.checkAvailability(batch);
      availability.push(...batchResults);
    }
  } catch (error) {
    providerError = error instanceof DomainProviderError
      ? error
      : new DomainProviderError('PROVIDER_ERROR', error instanceof Error ? error.message : String(error), false);
  }

  if (providerError) {
    const status = providerError.code === 'RATE_LIMITED' ? 'rate_limited' : 'provider_error';
    const searchId = await persistSearch(db, {
      userId,
      providerId: provider.provider.id,
      searchType: 'bulk',
      queryLabel: `${candidates.length} domain(s)`,
      status,
      errorCode: providerError.code,
      errorMessage: providerError.message,
      results: [],
    });
    await db.query(
      `INSERT INTO domain_bulk_searches (id, search_id, source_type, submitted_count, accepted_count, rejected_count)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), searchId, sourceType, candidates.length, 0, parsedInput.rejected]
    );
    return {
      searchId,
      status,
      message: safeDomainProviderMessage(providerError),
      submittedCount: candidates.length + parsedInput.rejected,
      acceptedCount: 0,
      rejectedCount: parsedInput.rejected,
      results: [],
    };
  }

  const results = availability.map((entry) => mergeWithOffering(entry, offeringFor(offerings, entry.domainName)));
  const searchId = await persistSearch(db, {
    userId,
    providerId: provider.provider.id,
    searchType: 'bulk',
    queryLabel: `${candidates.length} domain(s)`,
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    results,
  });
  await db.query(
    `INSERT INTO domain_bulk_searches (id, search_id, source_type, submitted_count, accepted_count, rejected_count)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), searchId, sourceType, candidates.length, candidates.length, parsedInput.rejected]
  );

  return {
    searchId,
    status: 'completed',
    message: null,
    submittedCount: candidates.length + parsedInput.rejected,
    acceptedCount: candidates.length,
    rejectedCount: parsedInput.rejected,
    results,
  };
}

/** Search history for the authenticated user (dashboard). */
export async function listMySearches(db: Queryable, userId: string, limit = 25) {
  const { rows } = await db.query(
    `SELECT s.id, s.search_type, s.query_label, s.status, s.error_code, s.created_at,
            (SELECT count(*)::int FROM domain_search_results r WHERE r.search_id = s.id) AS result_count,
            (SELECT count(*)::int FROM domain_search_results r
              WHERE r.search_id = s.id AND r.availability_status IN ('available','premium')) AS available_count
       FROM domain_searches s
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function listMyBulkSearches(db: Queryable, userId: string, limit = 25) {
  const { rows } = await db.query(
    `SELECT s.id, s.query_label, s.status, s.error_code, s.created_at, b.source_type,
            b.submitted_count, b.accepted_count, b.rejected_count
       FROM domain_searches s
       JOIN domain_bulk_searches b ON b.search_id = s.id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function getSearchResults(db: Queryable, userId: string, searchId: string) {
  const { rows } = await db.query<{ user_id: string | null }>(
    `SELECT user_id FROM domain_searches WHERE id = $1 LIMIT 1`,
    [searchId]
  );
  const search = rows[0];
  if (!search || search.user_id !== userId) return null;
  const results = await db.query(
    `SELECT domain_name, availability_status, is_premium, registration_price, renewal_price, transfer_price, currency, checked_at
       FROM domain_search_results WHERE search_id = $1 ORDER BY domain_name ASC`,
    [searchId]
  );
  return results.rows;
}
