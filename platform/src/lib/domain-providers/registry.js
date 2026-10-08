/**
 * Domain-provider adapter registry — ported from
 * `cloudhost247-node/src/domain-services/providers/registry.ts`.
 *
 * Adapters are compiled code. A `domain_service_providers` row is a *configuration* of an adapter,
 * never a definition of one: a row whose `adapter_key` names something this build does not compile
 * is refused with `ADAPTER_NOT_INSTALLED`, naming the installed set. The registry deliberately has
 * no generic-HTTP fallback — guessing a registrar protocol would be worse than failing closed,
 * because it could misstate whether a domain is registered, what it costs, or whether a transfer
 * left the old registrar.
 *
 * Consequence worth stating plainly: `registeredDomainProviderAdapters()` is the only honest answer
 * to "which providers can this build talk to?", and the admin API returns exactly this list rather
 * than a hardcoded menu.
 */
'use strict';

const { DomainProviderError } = require('./types');

/** @type {Map<string, (config: object, options: object) => object>} */
const factories = new Map();

const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,78}$/;

function registerDomainProviderAdapter(adapterKey, factory) {
  const normalized = String(adapterKey ?? '').trim().toLowerCase();
  if (!KEY_RE.test(normalized)) {
    throw new Error('Domain provider adapter keys must be lowercase letters, numbers, underscores or hyphens');
  }
  if (typeof factory !== 'function') {
    throw new Error(`Domain provider adapter '${normalized}' must be registered with a factory function`);
  }
  if (factories.has(normalized)) {
    throw new Error(`Domain provider adapter '${normalized}' is already registered`);
  }
  factories.set(normalized, factory);
}

/** The compiled adapter keys, sorted. This is what the admin UI lists. */
function registeredDomainProviderAdapters() {
  return [...factories.keys()].sort();
}

function domainProviderAdapterInstalled(adapterKey) {
  return factories.has(String(adapterKey ?? '').trim().toLowerCase());
}

/**
 * Refuse an adapter key this build does not compile.
 *
 * Separate from construction so the check can run *before* credentials are resolved: "the adapter is
 * not installed" is a fault no credential can fix, and an operator should be told that rather than
 * sent to re-enter a token that was never the problem.
 */
function assertDomainProviderAdapterInstalled(adapterKey) {
  const key = String(adapterKey ?? '').trim().toLowerCase();
  if (factories.has(key)) return key;
  throw new DomainProviderError(
    'ADAPTER_NOT_INSTALLED',
    `The ${key || 'selected'} domain provider adapter is not installed in this CloudHost247 build. Installed adapters: ${registeredDomainProviderAdapters().join(', ') || 'none'}`,
    false,
    { adapterKey: key || null, installed: registeredDomainProviderAdapters() },
  );
}

/**
 * Resolve an installed adapter. Throws — never returns a null-ish adapter — when the key is unknown,
 * so a misconfigured row cannot produce an object that silently answers nothing.
 */
function createDomainProviderAdapter(config, options = {}) {
  assertDomainProviderAdapterInstalled(config?.adapterKey);
  const key = String(config.adapterKey).trim().toLowerCase();
  return factories.get(key)(config, options);
}

/** Test-only: start from an empty registry. Production code never removes an adapter at runtime. */
function resetDomainProviderAdaptersForTesting() {
  factories.clear();
}

module.exports = {
  registerDomainProviderAdapter,
  registeredDomainProviderAdapters,
  domainProviderAdapterInstalled,
  assertDomainProviderAdapterInstalled,
  createDomainProviderAdapter,
  resetDomainProviderAdaptersForTesting,
};
