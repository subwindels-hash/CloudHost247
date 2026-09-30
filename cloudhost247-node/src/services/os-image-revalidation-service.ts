/**
 * Periodic re-verification of provider image mappings.
 *
 * An image was only ever proven once, when an operator pressed "Test" before enabling it. From
 * then on the catalog claimed it was deployable forever — even after the provider deleted the
 * snapshot, renamed the template, or rotated it out of a region. The failure surfaced at the
 * worst possible moment: a customer had already paid and the provisioning job failed.
 *
 * This sweep re-asks the provider. The rules mirror the rest of the platform:
 *
 *  - an image the provider no longer offers (or offers with a different architecture) is marked
 *    INVALID, which removes it from ordering and reinstall immediately, because those queries
 *    require ACTIVE + `verified_at`. Servers already running it are never touched;
 *  - a provider we could not reach is *not* evidence that the image is gone. A temporary outage
 *    or a missing credential must never silently empty the catalog, so the mapping keeps its
 *    status and only records that the attempt happened;
 *  - re-verification never marks anything deployable that an operator had not already enabled.
 */
import type { Queryable } from '../db/types';
import {
  findOsImageById,
  findProviderById,
  updateOsImage,
  type InfrastructureProviderRow,
  type ServerOsImageRow,
} from '../db/infrastructure-providers';
import { createInfrastructureProviderAdapter } from '../infrastructure/providers/registry';
import { ProviderError, type InfrastructureProviderAdapter } from '../infrastructure/providers/types';
import { recordAuditBestEffort } from '../lib/audit';

export type RevalidationOutcome = 'VERIFIED' | 'INVALIDATED' | 'PROVIDER_UNREACHABLE';

export interface ImageRevalidation {
  imageId: string;
  providerId: string;
  providerImageId: string | null;
  outcome: RevalidationOutcome;
  error?: string;
  /** Product configurations that can no longer be ordered because of an invalidation. */
  affectedConfigurations?: number;
}

export interface RevalidationOptions {
  limit?: number;
  /** How long a verification is trusted before it is checked again. Default 7 days. */
  staleAfterMs?: number;
  now?: Date;
  source?: NodeJS.ProcessEnv;
  adapterFactory?: (provider: InfrastructureProviderRow) => InfrastructureProviderAdapter;
}

const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Records that we tried, so a provider that is down does not sit at the head of the queue
 * forever and starve every other mapping. Stored in metadata to keep the sweep migration-free.
 */
async function recordAttempt(db: Queryable, image: ServerOsImageRow, now: Date): Promise<void> {
  await db.query(
    `UPDATE server_os_images
        SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('revalidationAttemptedAt',$2::text),updated_at=now()
      WHERE id=$1`,
    [image.id, now.toISOString()]
  );
}

async function countAffectedConfigurations(db: Queryable, image: ServerOsImageRow): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int count FROM server_product_configurations
      WHERE provider_id=$1 AND operating_system_version_id=$2 AND architecture=$3 AND status='ACTIVE'`,
    [image.provider_id, image.operating_system_version_id, image.architecture]
  );
  return rows[0]?.count ?? 0;
}

/**
 * Re-checks up to `limit` enabled image mappings whose verification has gone stale, oldest first.
 * Returns one entry per image checked.
 */
export async function revalidateProviderImages(
  db: Queryable,
  options: RevalidationOptions = {}
): Promise<ImageRevalidation[]> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 20;
  const cutoff = new Date(now.getTime() - (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)).toISOString();

  // Only images an operator actually enabled are re-checked: DRAFT and DISABLED mappings are not
  // deployable, and INVALID ones are already out of the catalog awaiting an operator.
  const { rows: due } = await db.query<{ id: string }>(
    `SELECT id FROM server_os_images
      WHERE status='ACTIVE'
        AND coalesce((metadata->>'revalidationAttemptedAt')::timestamptz, verified_at) < $1::timestamptz
      ORDER BY coalesce((metadata->>'revalidationAttemptedAt')::timestamptz, verified_at)
      LIMIT $2`,
    [cutoff, limit]
  );

  const results: ImageRevalidation[] = [];
  for (const { id } of due) {
    const image = await findOsImageById(db, id);
    if (!image) continue;
    const provider = await findProviderById(db, image.provider_id);
    if (!provider) continue;

    await recordAttempt(db, image, now);

    if (provider.status !== 'ACTIVE') {
      // A provider an operator has taken out of service is not evidence about the image.
      results.push({
        imageId: image.id, providerId: provider.id, providerImageId: image.provider_image_id,
        outcome: 'PROVIDER_UNREACHABLE', error: `Provider is ${provider.status}`,
      });
      continue;
    }

    try {
      const adapter = options.adapterFactory
        ? options.adapterFactory(provider)
        : createInfrastructureProviderAdapter(provider, options.source);
      const remote = await adapter.getImage(image);
      if (!remote?.available) {
        throw new ProviderError('IMAGE_UNAVAILABLE', 'Provider no longer offers this image', false);
      }
      if (remote.architecture && remote.architecture !== image.architecture) {
        throw new ProviderError('INVALID_CONFIGURATION', `Provider image architecture is ${remote.architecture}, mapping says ${image.architecture}`, false);
      }
      await updateOsImage(db, image.id, { verifiedAt: now.toISOString(), verificationError: null });
      results.push({
        imageId: image.id, providerId: provider.id, providerImageId: image.provider_image_id, outcome: 'VERIFIED',
      });
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : null;
      const permanent = providerError !== null
        && !providerError.retryable
        && ['IMAGE_UNAVAILABLE', 'INVALID_CONFIGURATION', 'RESOURCE_NOT_FOUND'].includes(providerError.code);
      const message = (error as Error).message.slice(0, 500);

      if (!permanent) {
        // Credentials missing, rate limited, timed out, provider 5xx: the catalog stays as it is.
        // Emptying a shop because the supplier's phone is engaged would be worse than useless.
        results.push({
          imageId: image.id, providerId: provider.id, providerImageId: image.provider_image_id,
          outcome: 'PROVIDER_UNREACHABLE', error: message,
        });
        continue;
      }

      const affectedConfigurations = await countAffectedConfigurations(db, image);
      await updateOsImage(db, image.id, { status: 'INVALID', verifiedAt: null, verificationError: message });
      await recordAuditBestEffort(db, {
        actorId: null, action: 'OS_IMAGE_INVALIDATED', resourceType: 'os_image', resourceId: image.id,
        metadata: {
          providerId: provider.id, providerImageId: image.provider_image_id, reason: message,
          affectedConfigurations, source: 'os-image-revalidation-sweep',
        },
      });
      results.push({
        imageId: image.id, providerId: provider.id, providerImageId: image.provider_image_id,
        outcome: 'INVALIDATED', error: message, affectedConfigurations,
      });
    }
  }
  return results;
}

/** Enabled mappings whose last successful verification is older than `staleAfterMs`. */
export async function listStaleImageVerifications(db: Queryable, staleAfterMs = DEFAULT_STALE_AFTER_MS, now = new Date()) {
  const cutoff = new Date(now.getTime() - staleAfterMs).toISOString();
  const { rows } = await db.query(
    `SELECT i.id,i.provider_image_id,i.provider_template_id,i.architecture,i.status,i.verified_at,i.verification_error,
            p.name provider_name,v.display_name os_display_name
       FROM server_os_images i
       JOIN infrastructure_providers p ON p.id=i.provider_id
       JOIN operating_system_versions v ON v.id=i.operating_system_version_id
      WHERE i.status IN ('ACTIVE','INVALID')
        AND (i.verified_at IS NULL OR i.verified_at < $1::timestamptz)
      ORDER BY i.verified_at NULLS FIRST
      LIMIT 200`,
    [cutoff]
  );
  return rows;
}
