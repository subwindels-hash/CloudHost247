/**
 * Transfer state, from the registrar's answer — ported from the refresh half of
 * `cloudhost247-node/src/domain-services/transfer-service.ts`.
 *
 * A transfer is not finished when the platform submits it. It is finished when the registry and the
 * losing registrar say so, which arrives as a status string from the gaining registrar that must be
 * polled. This module is that poll, and it keeps three rules:
 *
 *  1. **A provider string is mapped, or it is not.** `mapProviderTransferStatus` recognises the
 *     wording the documented APIs use and returns `'unknown'` otherwise. An unrecognised string
 *     leaves the local status alone rather than advancing it: guessing that "some new registrar
 *     phrase" means "in progress" would eventually mark a failed transfer complete.
 *  2. **Completion is one-way and transactional.** Marking a transfer complete and linking the
 *     domain to the customer happen together, guarded by `status <> 'completed'`, so two concurrent
 *     refreshes cannot both perform the completion.
 *  3. **A poll that cannot run says why.** No connected registrar, or a transfer bound to a provider
 *     that no longer exists, is refused by name instead of being reported as "still in progress".
 *
 * The plan quote and payment side of transfers lives in the billing paths; this module only ever
 * reads provider state and writes transfer state.
 */
'use strict';

const { ValidationError } = require('../core/errors');
const { uuidv7 } = require('./ids');
const { normalizeDomainName, isValidDomainName } = require('./domain-name');
const { DomainProviderError, safeDomainProviderMessage } = require('./domain-providers/types');
const {
  resolveConnectedDomainProvider, assertCapabilitySupported, createAdapterForProvider,
  domainProviderErrorToHttpError,
} = require('./domain-provider-service');

/** The local transfer states, in the order a transfer moves through them. */
const TRANSFER_STATUSES = Object.freeze([
  'pending', 'authorization_required', 'transfer_initiated', 'transfer_in_progress',
  'pending_registry', 'completed', 'failed', 'cancelled',
]);

const TRANSFER_LABELS = Object.freeze({
  pending: 'Pending',
  authorization_required: 'Awaiting authorization',
  transfer_initiated: 'Transfer initiated',
  transfer_in_progress: 'In progress',
  pending_registry: 'Pending registry',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
});

/**
 * The registrar's own words → a local status.
 *
 * Returns `'unknown'` when the phrase is not recognised. Callers must treat that as "leave the
 * record as it is", never as a state to write.
 */
function mapProviderTransferStatus(providerStatus) {
  if (!providerStatus) return null;
  const status = String(providerStatus).toLowerCase();
  if (/complete|transferred|succeeded/.test(status)) return 'completed';
  if (/fail|cancel|reject|declined|error|declined/.test(status)) return 'failed';
  if (/awaiting|admin approval|authorization|auth code/.test(status)) return 'authorization_required';
  // `in progress` is how registrars write it; `in_progress` is how this build's adapters normalise
  // it. Both have to land on the same local status, or an adapter's own answer would read as unknown.
  if (/in[ _-]?progress|processing|verif/.test(status)) return 'transfer_in_progress';
  if (/pending registry|registry/.test(status)) return 'pending_registry';
  // `initiated` covers both the raw registrar wording and this build's normalised vocabulary.
  if (/initiat|submitted|requested/.test(status)) return 'transfer_initiated';
  return 'unknown';
}

/**
 * Which registrar row owns this transfer's poll.
 *
 * A transfer records the provider it was created under. If it has none — it was requested while the
 * deployment had only an RDAP provider — the connected registrar is **adopted**, written onto the
 * row and reported back, so the decision is visible in the response and the audit trail rather than
 * being an invisible guess repeated on every poll.
 */
async function resolveTransferProvider(store, transfer, options = {}) {
  const secret = options.secret ?? 'ephemeral';
  if (transfer.provider_id) {
    const row = await store.table('domain_service_providers').findById(transfer.provider_id);
    if (!row) {
      throw new ValidationError(
        'The registrar recorded for this transfer no longer exists — re-link it from Admin → Domain Services before refreshing',
      );
    }
    return { provider: row, adopted: false };
  }

  const resolved = await resolveConnectedDomainProvider(store, 'registrar', { secret });
  await store.table('domain_transfers').updateById(transfer.id, { provider_id: resolved.provider.id });
  return { provider: resolved.provider, adapter: resolved.adapter, adopted: true };
}

/**
 * Poll one transfer and write what the registrar said.
 *
 * @returns {Promise<object>} `{ status, providerStatus, providerReference, completed, adopted, providerKey }`
 */
async function refreshTransfer(store, transfer, deps = {}, options = {}) {
  const secret = deps?.config?.JWT_SECRET || 'ephemeral';
  const { provider, adapter: adoptedAdapter, adopted } = await resolveTransferProvider(store, transfer, { secret });

  // A transfer bound to provider A is polled through A even if B was connected more recently: the
  // registrar holding the transfer is the only one whose answer means anything.
  const adapter = adoptedAdapter ?? await createAdapterForProvider(store, provider, { secret });

  assertCapabilitySupported(adapter, 'domainStatus');

  let status;
  try {
    status = await adapter.getDomainStatus(transfer.provider_reference ?? '', normalizeDomainName(transfer.domain_name ?? transfer.domain));
  } catch (error) {
    const code = error instanceof DomainProviderError ? error.code : 'PROVIDER_ERROR';
    const message = error instanceof DomainProviderError ? safeDomainProviderMessage(error) : 'The registrar could not be reached.';
    deps?.logger?.warn?.({ transferId: transfer.id, providerKey: provider.provider_key, failureCode: code }, 'transfer refresh failed');
    // The failure is written onto the row as evidence, but the status is left where it was: a poll
    // that could not run tells us nothing about the transfer's progress.
    await store.table('domain_transfers').updateById(transfer.id, {
      error_code: code,
      error_message: message,
      provider_metadata: { ...(transfer.provider_metadata ?? {}), lastRefreshFailure: { code, at: new Date().toISOString() } },
    });
    // The same translation the customer-facing routes use: a registrar outage is a 503 and a rate
    // limit a 429, rather than every provider fault collapsing into a 400 that reads as "your
    // request was wrong" — which would send an operator looking in the wrong place.
    throw domainProviderErrorToHttpError(error);
  }

  const providerStatus = status.providerStatus ?? null;
  const now = new Date().toISOString();

  /**
   * What the registrar said about the *transfer*, kept apart from what it said about the domain.
   *
   * Three cases, and the platform answers each differently:
   *
   *   1. The adapter mapped a transfer status. That is the answer — it drives the local status, and
   *      `completed` from it settles the transfer outright.
   *   2. The response mentioned the transfer but in wording nothing recognises. The raw text is still
   *      available, so this is **not** "no transfer information" — it is "information we cannot read",
   *      which advances nothing and completes nothing.
   *   3. The response said nothing about a transfer at all (Namecheap's documented domain record has
   *      no transfer element). Then the registrar's account-level word — and, for a domain now active
   *      on the gaining account, the fact that it is registered there — is the only signal there is.
   *      It is accepted as completion **and labelled** `registration_status`, rather than being
   *      dressed up as a transfer-completion notice.
   *
   * Case 2 falls out of the simplest rule: the account-level word is only consulted when the
   * registrar stayed silent about the transfer. A transfer in flight leaves the domain registered at
   * the losing registrar for its whole duration, so "the domain is registered" is never evidence that
   * a transfer finished.
   */
  const rawTransferText = typeof status.metadata?.transferStatus === 'string' && status.metadata.transferStatus.trim()
    ? status.metadata.transferStatus.trim() : null;
  const spokeAboutTransfer = (status.transferStatus !== undefined && status.transferStatus !== null) || rawTransferText !== null;
  const mappedTransfer = status.transferStatus
    ? mapProviderTransferStatus(status.transferStatus)
    : rawTransferText ? mapProviderTransferStatus(rawTransferText) : null;
  const mapped = spokeAboutTransfer ? (mappedTransfer ?? 'unknown') : mapProviderTransferStatus(providerStatus);

  const completedBy = mapped === 'completed' ? 'transfer_status'
    : !spokeAboutTransfer && status.registrationStatus === 'registered' ? 'registration_status'
      : null;

  if (completedBy) {
    const applied = await completeTransfer(store, transfer, { providerStatus, status, now, providerName: provider.name });
    return {
      status: 'completed',
      providerStatus,
      providerReference: transfer.provider_reference ?? null,
      completed: applied,
      completedBy,
      adopted,
      providerKey: provider.provider_key,
      alreadyCompleted: !applied,
      providerRegistrationStatus: status.registrationStatus ?? null,
      expiresAt: status.expiresAt ?? null,
    };
  }

  if (mapped === 'failed') {
    await store.table('domain_transfers').updateById(transfer.id, {
      status: 'failed', provider_status: providerStatus, error_code: 'TRANSFER_FAILED',
      error_message: 'The registrar reported the transfer as failed', updated_at: now,
    });
    return {
      status: 'failed', providerStatus, providerReference: transfer.provider_reference ?? null,
      completed: false, completedBy: null, adopted, providerKey: provider.provider_key,
      providerRegistrationStatus: status.registrationStatus ?? null,
    };
  }

  // Everything else: advance only if the phrase was recognised. `unknown` leaves the status alone.
  const nextStatus = mapped && mapped !== 'unknown' ? mapped : transfer.status;
  const patch = {
    provider_status: providerStatus,
    status: nextStatus,
    error_code: null,
    error_message: null,
    updated_at: now,
    provider_metadata: {
      ...(transfer.provider_metadata ?? {}),
      lastRefreshAt: now,
      providerRegistrationStatus: status.registrationStatus ?? null,
      expiresAt: status.expiresAt ?? null,
    },
  };
  if (nextStatus === 'transfer_initiated' && !transfer.initiated_at) patch.initiated_at = now;
  await store.table('domain_transfers').updateById(transfer.id, patch);

  return {
    status: nextStatus,
    statusLabel: TRANSFER_LABELS[nextStatus] ?? nextStatus,
    providerStatus,
    providerReference: transfer.provider_reference ?? null,
    completed: false,
    adopted,
    providerKey: provider.provider_key,
    statusRecognised: mapped !== 'unknown',
    providerRegistrationStatus: status.registrationStatus ?? null,
    expiresAt: status.expiresAt ?? null,
  };
}

/**
 * Finish a transfer: mark it complete and hand the domain to the customer, in one step.
 *
 * The `status <> 'completed'` guard is the whole point — two concurrent refreshes (an operator
 * clicking twice, a sweep racing a click) must produce one completion, not two linked domains.
 */
async function completeTransfer(store, transfer, context) {
  const { providerStatus, status, now, providerName } = context;
  let applied = false;

  await store.transaction(async (tx) => {
    const current = await tx.table('domain_transfers').findById(transfer.id);
    if (!current || current.status === 'completed') return;
    await tx.table('domain_transfers').updateById(transfer.id, {
      status: 'completed',
      provider_status: providerStatus,
      completed_at: now,
      updated_at: now,
      error_code: null,
      error_message: null,
    });
    applied = true;
    await linkTransferredDomain(tx, transfer, { providerName, status });
  });

  return applied;
}

/**
 * Record the transferred domain against the customer, so it appears in their domain list.
 *
 * Written through `customer_domains` — the platform's canonical record of a domain a customer can
 * manage — and idempotent on (user, name) so a re-run cannot create a duplicate.
 */
async function linkTransferredDomain(tx, transfer, context) {
  const domainName = normalizeDomainName(transfer.domain_name ?? transfer.domain);
  if (!domainName || !isValidDomainName(domainName)) return null;

  const existing = (await tx.table('customer_domains').all())
    .find((row) => row.user_id === transfer.user_id && normalizeDomainName(row.domain ?? row.domain_name) === domainName);
  if (existing) return existing.id;

  const row = await tx.table('customer_domains').insert({
    id: uuidv7(),
    user_id: transfer.user_id,
    // `domain` is the platform's canonical column for a customer's domain name (schema.js:537).
    domain: domainName,
    status: 'active',
    registrar: context.providerName ?? null,
    // It arrived by transfer: registrar-held rather than a customer-added DNS pointer, so it starts
    // verified — asking a customer to prove control of a domain they just transferred in is absurd.
    domain_type: 'registered',
    verification_status: 'verified',
    registered_at: context.now ?? new Date().toISOString(),
    expires_at: context.status?.expiresAt ?? null,
    auto_renew: false,
  });
  return row.id;
}

module.exports = {
  TRANSFER_STATUSES,
  TRANSFER_LABELS,
  mapProviderTransferStatus,
  resolveTransferProvider,
  refreshTransfer,
  linkTransferredDomain,
};
