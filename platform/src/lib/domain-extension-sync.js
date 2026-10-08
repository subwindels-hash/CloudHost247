/**
 * Extension catalogue sync — ported from `cloudhost247-node/src/domain-services/extensions-service.ts`.
 *
 * Pulls the connected registrar's **real** TLD catalogue and records two separate things:
 *
 *   1. `domain_extensions` gains the extension if it is new, and its *provider-independent* fields
 *      (status) are refreshed. Every admin-curated field — description, restrictions, registration
 *      requirements, the trending flag — is **preserved**, because an operator wrote those and a
 *      sync job has no business overwriting them.
 *   2. `domain_provider_extension_offerings` records what the provider quoted this account, with the
 *      currency, the premium flag and the source timestamp.
 *
 * **The sync never writes the platform's selling price.** `domain_extensions.register_price_cents`
 * is what the storefront charges; if a registrar ran a promotion and the sync wrote its quote into
 * that column, the platform's prices would change without anyone deciding they should. Provider
 * prices land in the offerings table, where an operator can see the difference and choose.
 *
 * Consequence, handled deliberately rather than accidentally: a newly synced extension has **no
 * selling price**. The quote route refuses to price it instead of quoting zero (see
 * `domains/domain-services.js`), so an extension cannot be discovered by sync and then sold for
 * nothing.
 */
'use strict';

const { ValidationError } = require('../core/errors');
const { uuidv7 } = require('./ids');
const { DomainProviderError } = require('./domain-providers/types');
const { assertCapabilitySupported } = require('./domain-provider-service');

/** `com` and `.com` both become `com`: the platform table stores the bare label. */
function bareExtension(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^\./, '');
}

/**
 * @param {object} store
 * @param {object} deps        `{ config, logger }`
 * @param {object} options     `{ provider, adapter }` — optional, as returned by the seam's resolver
 * @returns {Promise<object>}  the sync report
 */
async function syncExtensionsFromProvider(store, deps, options = {}) {
  const { resolveConnectedDomainProvider } = require('./domain-provider-service');
  const secret = deps?.config?.JWT_SECRET || 'ephemeral';

  const resolved = options.adapter
    ? { provider: options.provider, adapter: options.adapter }
    : await resolveConnectedDomainProvider(store, 'registrar', { secret });

  let offerings;
  try {
    // The capability assertion is inside the same catch on purpose: "this registrar cannot publish a
    // catalogue" and "this registrar's catalogue call failed" are both configuration answers, and an
    // operator needs the registrar's name in either one.
    assertCapabilitySupported(resolved.adapter, 'extensions');
    offerings = await resolved.adapter.getExtensions();
  } catch (error) {
    if (error instanceof DomainProviderError && error.code === 'UNSUPPORTED_OPERATION') {
      // A registrar that publishes no catalogue is a configuration mismatch, not an outage, and the
      // operator needs to know which registrar and why.
      throw new ValidationError(
        `The connected registrar (${resolved.provider.name ?? resolved.provider.provider_key}) does not expose an extension catalogue through this integration.`,
      );
    }
    throw error;
  }
  if (!Array.isArray(offerings) || offerings.length === 0) {
    throw new ValidationError('The registrar returned an empty extension catalogue.');
  }

  let created = 0;
  let updated = 0;
  let extensionsCreated = 0;
  let extensionsExisting = 0;
  const skipped = [];

  for (const offering of offerings) {
    const extension = bareExtension(offering.extension);
    if (!extension) {
      skipped.push({ reason: 'EMPTY_EXTENSION' });
      continue;
    }

    const existing = (await store.table('domain_extensions').all())
      .find((row) => bareExtension(row.tld ?? row.extension) === extension);

    let extensionRow = existing;
    if (!extensionRow) {
      extensionRow = await store.table('domain_extensions').insert({
        id: uuidv7(),
        tld: extension,
        // No selling price: the provider's quote is not this platform's price. The quote route
        // refuses to price an extension at 0 rather than giving it away.
        register_price_cents: 0,
        renew_price_cents: 0,
        is_trending: false,
        description: offering.description ?? null,
        restrictions: offering.restrictions ?? null,
        registration_requirements: offering.registrationRequirements ?? null,
        status: offering.status === 'enabled' ? 'active' : 'unavailable',
        active: offering.status === 'enabled',
      });
      extensionsCreated += 1;
    } else {
      extensionsExisting += 1;
      // Refresh only what the provider owns. Curated columns stay exactly as the operator left them.
      const patch = {};
      const nextStatus = offering.status === 'enabled' ? 'active' : 'unavailable';
      if (extensionRow.status !== nextStatus) {
        patch.status = nextStatus;
        patch.active = nextStatus === 'active';
      }
      // A brand-new row's descriptive fields are still empty; fill them once, then leave them alone.
      if (!extensionRow.description && offering.description) patch.description = offering.description;
      if (!extensionRow.restrictions && offering.restrictions) patch.restrictions = offering.restrictions;
      if (!extensionRow.registration_requirements && offering.registrationRequirements) {
        patch.registration_requirements = offering.registrationRequirements;
      }
      if (Object.keys(patch).length > 0) await store.table('domain_extensions').updateById(extensionRow.id, patch);
    }

    const offeringId = uuidv7();
    const row = {
      id: offeringId,
      provider_id: resolved.provider.id,
      extension_id: extensionRow.id,
      extension,
      provider_tld: offering.providerTld ?? extension,
      registration_price: priceAmount(offering.pricing?.registration),
      renewal_price: priceAmount(offering.pricing?.renewal),
      transfer_price: priceAmount(offering.pricing?.transfer),
      currency: String(offering.pricing?.registration?.currency ?? offering.pricing?.renewal?.currency ?? 'USD').toUpperCase(),
      premium_supported: offering.premiumSupported === true,
      status: offering.status ?? 'enabled',
      provider_metadata: offering.metadata ?? {},
      sourced_at: offering.sourcedAt ?? new Date().toISOString(),
    };

    const prior = await store.table('domain_provider_extension_offerings')
      .findOne({ provider_id: resolved.provider.id, extension });
    if (prior) {
      await store.table('domain_provider_extension_offerings').updateById(prior.id, row);
      updated += 1;
    } else {
      await store.table('domain_provider_extension_offerings').insert(row);
      created += 1;
    }
  }

  const report = {
    synced: offerings.length,
    created,
    updated,
    extensionsCreated,
    extensionsExisting,
    skipped: skipped.length,
    providerName: resolved.provider.name ?? null,
    providerKey: resolved.provider.provider_key ?? null,
    // Stated in the response so nobody has to infer it: the storefront's prices did not move.
    sellingPricesChanged: 0,
    note: 'Provider prices are recorded against the provider. Your selling prices are unchanged until an administrator sets them.',
  };
  deps?.logger?.info?.({ providerKey: report.providerKey, synced: report.synced, created, updated }, 'domain extensions synced');
  return report;
}

function priceAmount(price) {
  if (!price || price.amount === undefined || price.amount === null) return null;
  const value = Number(price.amount);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

module.exports = { syncExtensionsFromProvider, bareExtension };
