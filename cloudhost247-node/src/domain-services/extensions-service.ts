/**
 * gTLD extension catalogue — provider-sourced offerings, admin-curated presentation.
 *
 * Prices and premium support come exclusively from the connected registrar's extension catalogue
 * (synced by Super Admin). Descriptions/restrictions/requirements are editable by Super Admin to
 * reflect the platform's own onboarding copy, and the trending flag is an explicit Super Admin
 * decision — never provider-sourced, never hard-coded for any TLD.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import { DomainProviderError } from './providers/types';
import { resolveConnectedDomainProvider } from './provider-service';
import { normalizeExtension } from './domain-name';
import { NotFoundError, ValidationError } from '../lib/errors';

export interface ExtensionDirectoryEntry {
  id: string;
  extension: string;
  description: string | null;
  restrictions: string | null;
  registrationRequirements: string | null;
  isTrending: boolean;
  status: string;
  registrationPrice: string | null;
  renewalPrice: string | null;
  transferPrice: string | null;
  currency: string | null;
  premiumSupported: boolean;
  offeringStatus: string | null;
  providerName: string | null;
  sourcedAt: string | null;
}

/** Public directory: every extension that has an enabled offering from a connected provider. */
export async function listExtensionDirectory(db: Queryable, search?: string): Promise<ExtensionDirectoryEntry[]> {
  const params: unknown[] = [];
  let where = `WHERE o.status = 'enabled' AND p.status = 'connected'`;
  if (search && search.trim()) {
    params.push(`%${normalizeExtension(search.trim()).slice(1)}%`);
    where += ` AND e.extension LIKE $1`;
  }
  const { rows } = await db.query<{
    id: string; extension: string; description: string | null; restrictions: string | null;
    registration_requirements: string | null; is_trending: boolean; status: string;
    registration_price: string | null; renewal_price: string | null; transfer_price: string | null;
    currency: string; premium_supported: boolean; offering_status: string;
    provider_name: string | null; sourced_at: string | null;
  }>(
    `SELECT e.id, e.extension, e.description, e.restrictions, e.registration_requirements,
            e.is_trending, e.status,
            o.registration_price, o.renewal_price, o.transfer_price, o.currency,
            o.premium_supported, o.status AS offering_status, o.sourced_at,
            p.name AS provider_name
       FROM domain_extensions e
       JOIN domain_provider_extension_offerings o ON o.extension_id = e.id
       JOIN domain_service_providers p ON p.id = o.provider_id
       ${where}
      ORDER BY e.is_trending DESC, e.extension ASC`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    extension: row.extension.startsWith('.') ? row.extension : `.${row.extension}`,
    description: row.description,
    restrictions: row.restrictions,
    registrationRequirements: row.registration_requirements,
    isTrending: row.is_trending === true,
    status: row.status,
    registrationPrice: row.registration_price,
    renewalPrice: row.renewal_price,
    transferPrice: row.transfer_price,
    currency: row.currency,
    premiumSupported: row.premium_supported === true,
    offeringStatus: row.offering_status,
    providerName: row.provider_name,
    sourcedAt: row.sourced_at,
  }));
}

export interface ExtensionSyncReport {
  synced: number;
  created: number;
  updated: number;
  providerName: string;
}

/**
 * Pulls the registrar's real TLD catalogue and upserts both `domain_extensions` and the
 * provider's `domain_provider_extension_offerings`. Existing rows keep their admin-curated
 * fields (description, restrictions, requirements, trending flag) — only provider facts
 * (prices, premium support, provider TLD key) are refreshed.
 */
export async function syncExtensionsFromProvider(db: Queryable, actorId: string): Promise<ExtensionSyncReport> {
  const provider = await resolveConnectedDomainProvider(db, 'registrar');

  let offerings;
  try {
    offerings = await provider.adapter.getExtensions();
  } catch (error) {
    if (error instanceof DomainProviderError && error.code === 'UNSUPPORTED_OPERATION') {
      throw new ValidationError(
        `The connected registrar (${provider.provider.name}) does not expose an extension catalogue through this integration.`
      );
    }
    throw error;
  }
  if (offerings.length === 0) {
    throw new ValidationError('The registrar returned an empty extension catalogue.');
  }

  let created = 0;
  let updated = 0;

  for (const offering of offerings) {
    const extension = normalizeExtension(offering.extension);
    // Upsert the canonical extension row (admin-curated columns preserved on conflict).
    const { rows: extensionRows } = await db.query<{ id: string }>(
      `INSERT INTO domain_extensions (id, extension, description, restrictions, registration_requirements, is_trending, status, created_by)
       VALUES ($1, $2, $3, $4, $5, false, CASE WHEN $6 THEN 'active' ELSE 'unavailable' END, $7)
       ON CONFLICT (lower(extension)) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [
        randomUUID(),
        extension,
        offering.description ?? null,
        offering.restrictions ?? null,
        offering.registrationRequirements ?? null,
        offering.status === 'enabled',
        actorId,
      ]
    );
    const extensionId = extensionRows[0]?.id;
    if (!extensionId) continue;

    const { rows: offeringRows } = await db.query(
      `INSERT INTO domain_provider_extension_offerings
         (id, provider_id, extension_id, provider_tld, registration_price, renewal_price, transfer_price,
          currency, premium_supported, status, provider_metadata, sourced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (provider_id, extension_id) DO UPDATE SET
         provider_tld = EXCLUDED.provider_tld,
         registration_price = EXCLUDED.registration_price,
         renewal_price = EXCLUDED.renewal_price,
         transfer_price = EXCLUDED.transfer_price,
         currency = EXCLUDED.currency,
         premium_supported = EXCLUDED.premium_supported,
         status = EXCLUDED.status,
         provider_metadata = EXCLUDED.provider_metadata,
         sourced_at = now(),
         updated_at = now()`,
      [
        randomUUID(),
        provider.provider.id,
        extensionId,
        offering.providerTld,
        offering.pricing.registration?.amount ?? null,
        offering.pricing.renewal?.amount ?? null,
        offering.pricing.transfer?.amount ?? null,
        (offering.pricing.registration?.currency ?? offering.pricing.renewal?.currency ?? 'USD').toUpperCase(),
        offering.premiumSupported,
        offering.status,
        JSON.stringify(offering.metadata ?? {}),
      ]
    );
    if (offeringRows.length === 1) created += 1;
    else updated += 1;
  }

  return { synced: offerings.length, created, updated, providerName: provider.provider.name };
}

/** Super Admin: mark (or unmark) an extension as trending — the AI TRENDING badge source. */
export async function setExtensionTrending(db: Queryable, extensionId: string, trending: boolean): Promise<void> {
  const { rows: trendingRows } = await db.query(
    `UPDATE domain_extensions SET is_trending = $2, updated_at = now() WHERE id = $1 RETURNING id`,
    [extensionId, trending]
  );
  if (trendingRows.length === 0) throw new NotFoundError('No extension was found with that id');
}

export async function updateExtensionDetails(
  db: Queryable,
  extensionId: string,
  patch: { description?: string | null; restrictions?: string | null; registrationRequirements?: string | null; status?: 'active' | 'disabled' | 'unavailable' }
): Promise<void> {
  const { rows: updatedRows } = await db.query(
    `UPDATE domain_extensions SET
       description = COALESCE($2, description),
       restrictions = COALESCE($3, restrictions),
       registration_requirements = COALESCE($4, registration_requirements),
       status = COALESCE($5, status),
       updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [extensionId, patch.description ?? null, patch.restrictions ?? null, patch.registrationRequirements ?? null, patch.status ?? null]
  );
  if (updatedRows.length === 0) throw new NotFoundError('No extension was found with that id');
}

/**
 * Server-side price resolution for one domain: premium quotes from a fresh provider check win;
 * otherwise the synced base offering price applies. Returns null when no price is knowable.
 */
export async function baseOfferingPriceFor(
  db: Queryable,
  domainName: string
): Promise<{ registration: string; renewal: string | null; transfer: string | null; currency: string; premium: false } | null> {
  const tld = domainName.slice(domainName.lastIndexOf('.'));
  const { rows } = await db.query<{
    registration_price: string | null;
    renewal_price: string | null;
    transfer_price: string | null;
    currency: string;
  }>(
    `SELECT o.registration_price, o.renewal_price, o.transfer_price, o.currency
       FROM domain_provider_extension_offerings o
       JOIN domain_extensions e ON e.id = o.extension_id
       JOIN domain_service_providers p ON p.id = o.provider_id
      WHERE lower(e.extension) = $1 AND o.status = 'enabled' AND p.status = 'connected'
      LIMIT 1`,
    [tld.toLowerCase()]
  );
  const offering = rows[0];
  if (!offering || !offering.registration_price) return null;
  return {
    registration: offering.registration_price,
    renewal: offering.renewal_price,
    transfer: offering.transfer_price,
    currency: offering.currency,
    premium: false,
  };
}
