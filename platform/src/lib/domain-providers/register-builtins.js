/**
 * Registers the compiled domain-provider adapters exactly once per process — the JS port of
 * `register-builtins.ts`.
 *
 * An adapter that is not in this file does not exist, no matter what a `domain_service_providers`
 * row says. This build compiles two:
 *
 *   - `rdap`     the public registry lookup (RFC 9082/9083 + port-43 WHOIS fallback). No
 *                credentials: it is the only availability/owner evidence obtainable without a
 *                registrar account.
 *   - `govalue`  GoDaddy's GoValue appraisal API (alias `godaddy-govalue`). Credentials required.
 *
 * The registrar adapters the audited Node build also compiles — `namecheap` and `godaddy` — are
 * **not** ported yet. They are registrar *mutations* (registration, transfer, extension pricing),
 * and they land with the admin transfer-refresh work rather than here. Until then a row configured
 * with one of those keys is refused with ADAPTER_NOT_INSTALLED naming the installed set, instead of
 * accepting a provider that could never complete a call.
 */
'use strict';

const { registerDomainProviderAdapter, registeredDomainProviderAdapters } = require('./registry');
const { RdapAdapter } = require('./adapters/rdap');
const { GoValueAppraisalAdapter } = require('./adapters/govalue');

let registered = false;

function registerBuiltInDomainProviderAdapters() {
  if (registered) return registeredDomainProviderAdapters();
  registerDomainProviderAdapter('rdap', (config, options) => new RdapAdapter(config, options));
  registerDomainProviderAdapter('govalue', (config, options) => new GoValueAppraisalAdapter(config, options));
  // Alias: the audited Node build registers this adapter as `godaddy-govalue`, and a provider row
  // carried over from it should keep working rather than reading as "not installed".
  registerDomainProviderAdapter('godaddy-govalue', (config, options) => new GoValueAppraisalAdapter(config, options));
  registered = true;
  return registeredDomainProviderAdapters();
}

module.exports = { registerBuiltInDomainProviderAdapters };
