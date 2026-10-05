/**
 * Which operating-system versions can actually be ordered.
 *
 * The customer catalogue used to return every ACTIVE operating system and every non-retired
 * version, whatever the infrastructure behind them looked like. That is how a customer picks
 * "Ubuntu 24.04", pays, and then gets a provisioning job that fails with *"the image mapping has
 * not been verified against the provider"* — the refusal the worker raises because building from an
 * unverified mapping produces a machine that never boots. The catalogue was advertising something
 * the platform had already decided it could not deliver.
 *
 * One rule, in one place, shared by both customer routes that list operating systems. A version is
 * orderable when some *active* product configuration maps it to a region whose provider exists, and
 * a **verified** image mapping covers that region and architecture. When it is not, the reason is
 * named, because "this option disappeared" is not an answer an operator can act on.
 *
 * This deliberately does not touch the admin CRUD routes: an operator must still be able to see and
 * edit an OS whose mapping is not finished. Only what a customer is offered changes.
 */
'use strict';

const ARCHITECTURES = Object.freeze(['x86_64', 'arm64']);

/** Why a version is not orderable, in the order worth reporting. */
const UNAVAILABLE_REASONS = Object.freeze({
  NO_CONFIGURATION: 'No product configuration offers this version on any plan',
  CONFIGURATION_DISABLED: 'A product configuration exists for this version but none of them is active',
  ARCHITECTURE_UNSUPPORTED: 'The active configurations use an architecture this version does not support',
  NO_IMAGE: 'No image mapping covers the region and architecture of an active configuration',
  IMAGE_UNVERIFIED: 'An image mapping exists but has not been verified against the provider',
});

const isActiveRow = (row) => String(row.status ?? (row.active === false ? 'DISABLED' : 'ACTIVE')).toUpperCase() === 'ACTIVE';

/**
 * Evaluate one version against the configurations and image mappings that could serve it.
 * Every active configuration is tried, because a version can be verified in one region and not
 * another — the first one that fully checks out makes the version orderable.
 */
function evaluateVersion(version, configurations, imagesForOs, regionById, providerIds) {
  if (configurations.length === 0) {
    return { orderable: false, reason: UNAVAILABLE_REASONS.NO_CONFIGURATION };
  }
  const active = configurations.filter(isActiveRow);
  if (active.length === 0) {
    return { orderable: false, reason: UNAVAILABLE_REASONS.CONFIGURATION_DISABLED };
  }

  const supported = Array.isArray(version.architecture_support) && version.architecture_support.length > 0
    ? version.architecture_support
    : ARCHITECTURES;
  const matching = active.filter((config) => supported.includes(config.architecture ?? 'x86_64'));
  if (matching.length === 0) {
    return { orderable: false, reason: UNAVAILABLE_REASONS.ARCHITECTURE_UNSUPPORTED };
  }

  let sawUnverified = false;
  for (const config of matching) {
    const region = regionById.get(config.region_id);
    // A configuration pointing at a region whose provider row is gone cannot provision anything.
    if (!region || !providerIds.has(region.provider_id)) continue;
    const architecture = config.architecture ?? 'x86_64';
    const image = imagesForOs.find((candidate) => (candidate.region_id === config.region_id || !candidate.region_id)
      && candidate.provider_image_id
      && (candidate.arch ?? 'x86_64') === architecture
      // Images are mapped per OS *version*. Matching on the OS alone lets 22.04 borrow 24.04's
      // verified mapping, which is how a customer ends up with a machine running the wrong release.
      // A mapping with no version recorded is an OS-wide one and may serve any version.
      && (!candidate.version || candidate.version === version.version));
    if (!image) continue;
    if (!image.verified_at) {
      // Remember it but keep looking: another region may hold a verified mapping for the same OS.
      sawUnverified = true;
      continue;
    }
    return {
      orderable: true, reason: null,
      regionId: config.region_id, architecture, imageId: image.id,
    };
  }
  return {
    orderable: false,
    reason: sawUnverified ? UNAVAILABLE_REASONS.IMAGE_UNVERIFIED : UNAVAILABLE_REASONS.NO_IMAGE,
  };
}

/**
 * Availability for every operating-system version, as `versionId → verdict`.
 *
 * Four table reads regardless of catalogue size, then in-memory evaluation: these are customer
 * catalogue reads and a per-version query would make the list route quadratic.
 */
async function computeVersionAvailability(store) {
  const [configurations, images, regions, providers] = await Promise.all([
    store.table('server_product_configurations').all(),
    store.table('os_images').all(),
    store.table('regions').all(),
    store.table('infra_providers').all(),
  ]);
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const providerIds = new Set(providers.map((provider) => provider.id));

  const configsByVersion = new Map();
  for (const config of configurations) {
    const list = configsByVersion.get(config.operating_system_version_id) ?? [];
    list.push(config);
    configsByVersion.set(config.operating_system_version_id, list);
  }

  const verdicts = new Map();
  const versions = await store.table('operating_system_versions').all();
  for (const version of versions) {
    const imagesForOs = images.filter((image) => image.os_id === version.operating_system_id);
    verdicts.set(version.id, evaluateVersion(
      version, configsByVersion.get(version.id) ?? [], imagesForOs, regionById, providerIds,
    ));
  }
  return verdicts;
}

module.exports = { ARCHITECTURES, UNAVAILABLE_REASONS, isActiveRow, evaluateVersion, computeVersionAvailability };
