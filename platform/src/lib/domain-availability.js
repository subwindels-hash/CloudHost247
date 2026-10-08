/**
 * Which provider answers "is this name taken?", and the answer it gave.
 *
 * Before the registrar adapters existed this question had exactly one answer — the RDAP registry,
 * reached through a provider row of type `rdap` — and the search routes were hardwired to it. That
 * is still the right answer when no registrar is connected: a registry record is public evidence and
 * needs no account. But a **registrar** answers the same question authoritatively, because a
 * registrar is who actually sells the name, and it can also say *what it costs* and whether the name
 * is premium — which no registry lookup can.
 *
 * So this module resolves the best available evidence, in order:
 *
 *   1. A connected provider of type `registrar` whose adapter claims the `availability` capability.
 *   2. A connected provider of type `rdap` (the module-2 path, unchanged, including its refusal to
 *      guess when there is no registry record).
 *
 * The source of every answer is carried onto the row (`source: 'registrar' | 'rdap'`), because the
 * two are not interchangeable: a registrar's "available" is a commercial offer, a registry's "no
 * record" is public evidence, and a UI that blurred them would be claiming more than either says.
 *
 * A registrar that is connected but fails does **not** sink the search: the RDAP path is tried, the
 * answer is labelled `rdap`, and the registrar failure is logged. A registrar that is connected and
 * answers has the last word — falling back to a registry because a registrar was slow would replace
 * a real price with a guess.
 */
'use strict';

const { DomainProviderError, domainFailure } = require('./domain-providers/types');
const { resolveConnectedDomainProvider } = require('./domain-provider-service');
const { registeredDomainProviderAdapters } = require('./domain-providers/registry');

/** Map one registrar `checkAvailability` entry onto the presence vocabulary the routes build rows from. */
function presenceFromRegistrarResult(result) {
  if (!result) return { status: 'unknown', reason: 'PROVIDER_ERROR', source: 'registrar' };
  const base = { source: 'registrar', definitive: result.metadata?.definitive !== false };
  if (result.status === 'registered') return { ...base, status: 'registered' };
  if (result.status === 'available' || result.status === 'premium') {
    return {
      ...base,
      status: 'available',
      premium: result.status === 'premium',
      // The registrar's own quote. It is *not* what this platform charges — the selling price is the
      // extension's `register_price_cents` — so it is reported as a provider quote, clearly labelled.
      providerQuote: result.pricing ?? null,
      checkedAt: result.checkedAt ?? null,
    };
  }
  // Including `unavailable`: a check the registrar declined to answer. Never `available`. The
  // registrar's own error detail stays server-side; the customer row carries the reason code only.
  return { ...base, status: 'unknown', reason: 'REGISTRAR_DID_NOT_ANSWER' };
}

function presenceFromRegistryResult(entry) {
  if (!entry) return { status: 'unknown', reason: 'PROVIDER_ERROR', source: 'rdap' };
  return { ...entry, source: 'rdap' };
}

/**
 * Look up availability for a batch of names.
 *
 * Never throws for a *provider* problem: it returns `failure` plus `unknown` presences, which is the
 * shape the search routes already store and report. Tenant/auth errors keep propagating, because
 * those are the caller's problem and no provider choice can fix them.
 *
 * @returns {Promise<{presences: object[], source: 'registrar'|'rdap'|null, provider: object|null, failure: object|null}>}
 */
async function lookupAvailability(store, options) {
  const secret = options.secret ?? 'ephemeral';
  const names = options.names ?? [];
  const logger = options.logger;
  // No source: nothing was asked, so nothing may be named as having answered.
  const unknown = (reason) => names.map(() => ({ status: 'unknown', reason, source: null }));

  const attempts = [];
  let registrar = null;
  try {
    registrar = await resolveConnectedDomainProvider(store, 'registrar', { secret });
  } catch (error) {
    if (!(error instanceof DomainProviderError)) throw error; // an unexpected fault is not a provider gap
    attempts.push(error);
  }

  if (registrar && registrar.adapter.capabilities?.availability === true) {
    try {
      const results = await registrar.adapter.checkAvailability(names);
      const byName = new Map((results ?? []).map((entry) => [String(entry.domainName).toLowerCase(), entry]));
      return {
        presences: names.map((domain) => presenceFromRegistrarResult(byName.get(String(domain).toLowerCase()))),
        source: 'registrar',
        provider: registrar.provider,
        failure: null,
      };
    } catch (error) {
      // A registrar that cannot answer is worth recording, and worth trying the registry for.
      attempts.push(error);
      logger?.warn?.(
        { providerKey: registrar.provider.provider_key, failureCode: error?.code ?? null },
        'registrar availability lookup failed; falling back to RDAP',
      );
    }
  } else if (registrar) {
    attempts.push(new DomainProviderError(
      'UNSUPPORTED_OPERATION',
      `The connected registrar (${registrar.provider.provider_key}) does not answer availability checks`,
      false,
      { capability: 'availability' },
    ));
  }

  let rdap = null;
  try {
    rdap = await resolveConnectedDomainProvider(store, 'rdap', { secret });
  } catch (error) {
    if (!(error instanceof DomainProviderError)) throw error;
    attempts.push(error);
  }

  if (rdap) {
    try {
      const presence = await rdap.adapter.lookupRegistryPresence(names);
      return {
        presences: names.map((domain, index) => presenceFromRegistryResult(presence[index])),
        source: 'rdap',
        provider: rdap.provider,
        failure: null,
      };
    } catch (error) {
      attempts.push(error);
    }
  }

  const error = domainFailureOf(attempts) ?? new DomainProviderError(
    'PROVIDER_NOT_CONFIGURED',
    `No connected registrar or RDAP domain provider is configured. Add one under Admin → Domain Services and run its connection test. Installed adapters: ${registeredDomainProviderAdapters().join(', ') || 'none'}`,
    false,
  );
  // The **public** projection, exactly as the routes reported provider failures before: the operator
  // sentence (which names the fix and the installed adapters) stays in the logs and in the admin UI,
  // and the customer gets the platform's neutral sentence plus the stable code.
  const failure = domainFailure(error);
  return { presences: unknown(failure.code), source: null, provider: null, failure };
}

/**
 * Which attempt is worth reporting to the customer.
 *
 * A configured-but-broken provider is the honest answer ("we could not reach the registrar"); a
 * "nothing is configured" refusal from one type is not, if the other type failed for a real reason.
 */
function domainFailureOf(attempts) {
  if (attempts.length === 0) return null;
  const notConfigured = attempts.filter((error) => error.code === 'PROVIDER_NOT_CONFIGURED');
  const real = attempts.filter((error) => error.code !== 'PROVIDER_NOT_CONFIGURED');
  if (real.length > 0) return real[0];
  return notConfigured[0] ?? attempts[0];
}

module.exports = { lookupAvailability, presenceFromRegistrarResult, presenceFromRegistryResult };
