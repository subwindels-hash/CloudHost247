/**
 * Registers the compiled domain-provider adapters exactly once per process — the JS port of
 * `register-builtins.ts`.
 *
 * An adapter that is not in this file does not exist, no matter what a `domain_service_providers`
 * row says. This build compiles five keys across four adapters:
 *
 *   - `rdap`             the public registry lookup (RFC 9082/9083 + port-43 WHOIS fallback). No
 *                        credentials: the only availability/owner evidence obtainable without a
 *                        registrar account, and the source of the `available: null` refusal when
 *                        there is nothing better.
 *   - `namecheap`        a real registrar: availability with prices, the TLD catalogue, transfer
 *                        submission and live domain status.
 *   - `godaddy`          a real registrar: availability with prices, transfer submission and live
 *                        domain status. Publishes no TLD catalogue through this integration.
 *   - `govalue`          GoDaddy's GoValue appraisal API (alias `godaddy-govalue`).
 *
 * The registry's answer is the only honest source for "which providers can this build talk to?", so
 * the admin API returns exactly this list rather than a hand-kept menu.
 */
'use strict';

const { registerDomainProviderAdapter, registeredDomainProviderAdapters } = require('./registry');
const { RdapAdapter } = require('./adapters/rdap');
const { GoValueAppraisalAdapter } = require('./adapters/govalue');
const { NamecheapAdapter } = require('./adapters/namecheap');
const { GoDaddyAdapter } = require('./adapters/godaddy');

let registered = false;

function registerBuiltInDomainProviderAdapters() {
  if (registered) return registeredDomainProviderAdapters();
  registerDomainProviderAdapter('rdap', (config, options) => new RdapAdapter(config, options));
  registerDomainProviderAdapter('namecheap', (config, options) => new NamecheapAdapter(config, options));
  registerDomainProviderAdapter('godaddy', (config, options) => new GoDaddyAdapter(config, options));
  registerDomainProviderAdapter('govalue', (config, options) => new GoValueAppraisalAdapter(config, options));
  // Alias: the audited Node build registers this adapter as `godaddy-govalue`, and a provider row
  // carried over from it should keep working rather than reading as "not installed".
  registerDomainProviderAdapter('godaddy-govalue', (config, options) => new GoValueAppraisalAdapter(config, options));
  registered = true;
  return registeredDomainProviderAdapters();
}

module.exports = { registerBuiltInDomainProviderAdapters };
