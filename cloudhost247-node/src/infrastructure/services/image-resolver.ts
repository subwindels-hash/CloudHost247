/**
 * OS image resolution (spec §7, §8).
 *
 * Translates a customer-visible selection — plan, region/datacenter, OS version, architecture —
 * into the provider-specific image identifier, and refuses anything that is not backed by an
 * active, live-verified mapping. Customers never send, see, or influence a provider image id:
 * they send catalog ids and the server resolves the mapping.
 */
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { findOsImageById } from '../../db/infrastructure-providers';
import { resolveAvailableConfiguration, type AvailableConfigurationRow } from '../../db/operating-systems';
import type { Queryable } from '../../db/types';
import { ProviderError } from '../providers/types';

export interface ReinstallTargetInput {
  planId: string;
  providerId: string;
  regionId: string;
  datacenterId: string | null;
  serverType: string;
  operatingSystemVersionId: string;
  architecture: 'x86_64' | 'arm64';
}

export class ImageResolutionError extends Error {
  constructor(message: string, public readonly code: 'UNAVAILABLE' | 'NOT_REINSTALLABLE') {
    super(message);
    this.name = 'ImageResolutionError';
  }
}

/**
 * Loads the image a queued job must deploy and re-validates it at execution time: the mapping
 * may have been disabled, re-pointed, or failed re-verification between queueing and execution.
 */
export async function resolveVerifiedProviderImage(
  db: Queryable,
  input: { osImageId: string | null; provider: InfrastructureProviderRow; architecture: string | null }
): Promise<ServerOsImageRow> {
  const image = input.osImageId ? await findOsImageById(db, input.osImageId) : null;
  if (!image || image.status !== 'ACTIVE' || !image.verified_at) {
    throw new ProviderError('IMAGE_UNAVAILABLE', 'Provider OS image is not verified and active', false);
  }
  if (image.provider_id !== input.provider.id || image.architecture !== input.architecture) {
    throw new ProviderError(
      'INVALID_CONFIGURATION',
      'Provider image does not match the selected provider/architecture',
      false
    );
  }
  return image;
}

/**
 * Resolves the target image for an OS reinstall. The combination must still be a purchasable
 * configuration for the server's own plan/provider/location, the OS family must allow
 * reinstall, and the mapping must be verified — an EOL or retired version cannot be selected
 * for a new deployment even though existing servers keep displaying it.
 */
export async function resolveReinstallTarget(
  db: Queryable,
  input: ReinstallTargetInput
): Promise<AvailableConfigurationRow> {
  const configuration = await resolveAvailableConfiguration(db, {
    planId: input.planId,
    providerId: input.providerId,
    regionId: input.regionId,
    datacenterId: input.datacenterId,
    operatingSystemVersionId: input.operatingSystemVersionId,
    architecture: input.architecture,
    serverType: input.serverType,
  });
  if (!configuration) {
    throw new ImageResolutionError('The selected operating system is unavailable for this server', 'UNAVAILABLE');
  }
  const allowed = await db.query(
    `SELECT 1 FROM operating_system_versions v
     JOIN operating_systems os ON os.id = v.operating_system_id
     WHERE v.id = $1 AND os.is_reinstall_supported = true`,
    [input.operatingSystemVersionId]
  );
  if (!allowed.rows[0]) {
    throw new ImageResolutionError('The selected operating system is not enabled for reinstall', 'NOT_REINSTALLABLE');
  }
  return configuration;
}
