/**
 * Resolves the adapter for one provider row.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/registry.ts. Every provider kind maps to
 * its own implementation: one provider's client is never reused for a different platform, and the
 * development mock is only ever returned for a provider that an administrator explicitly registered
 * with the `mock` adapter (it additionally refuses to run in production — see adapters/mock.js).
 *
 * An unrecognised adapter — and any kind this build has not ported yet — gets a fallback that fails
 * closed with UNSUPPORTED_OPERATION rather than SERVICE_UNAVAILABLE: nothing about that condition
 * changes by retrying, and SERVICE_UNAVAILABLE is rendered to the customer as "temporarily
 * unavailable, please try again shortly", which would send an operator into a retry loop that cannot
 * succeed.
 */
'use strict';

const { ADAPTER_METHODS, ProviderError } = require('./types');
const { HetznerProviderAdapter } = require('./adapters/hetzner');
const { AwsProviderAdapter } = require('./adapters/aws');
const { ContaboProviderAdapter } = require('./adapters/contabo');
const { OpenStackProviderAdapter } = require('./adapters/openstack');
const { DigitalOceanProviderAdapter } = require('./adapters/digitalocean');
const { VultrProviderAdapter } = require('./adapters/vultr');
const { VirtualizorProviderAdapter } = require('./adapters/virtualizor');
const { SolusvmProviderAdapter } = require('./adapters/solusvm');
const { OvhProviderAdapter } = require('./adapters/ovh');
const { ProxmoxProviderAdapter } = require('./adapters/proxmox');
const { GenericHttpProviderAdapter } = require('./adapters/generic-http');
const { MockProviderAdapter } = require('./adapters/mock');

/** Adapter kinds with a real implementation in this build. */
const IMPLEMENTED_ADAPTERS = Object.freeze([
  'hetzner', 'digitalocean', 'vultr', 'aws', 'contabo', 'ovh', 'proxmox', 'virtualizor', 'solusvm',
  'openstack', 'generic_http', 'mock',
]);

/**
 * Adapter kinds the audited original implements but this build has not ported yet. Every kind is
 * ported now, so this list is empty — it is kept (and still reported by the admin adapter list and
 * the readiness check) because the next kind the original learns about must land here and be
 * refused by name rather than looking like a typo in a provider row.
 */
const PENDING_ADAPTERS = Object.freeze([]);

class UnavailableProviderAdapter {
  constructor(provider, reason) {
    this.kind = provider.adapter;
    this.provider = provider;
    this.reason = reason;
    for (const method of ADAPTER_METHODS) {
      this[method] = () => Promise.reject(new ProviderError('UNSUPPORTED_OPERATION', this.reason, false));
    }
  }
}

function createInfrastructureProviderAdapter(provider, options = {}) {
  const adapterOptions = { source: options.source, transport: options.transport };
  switch (provider.adapter) {
    case 'hetzner': return new HetznerProviderAdapter(provider, adapterOptions);
    case 'aws': return new AwsProviderAdapter(provider, adapterOptions);
    case 'digitalocean': return new DigitalOceanProviderAdapter(provider, adapterOptions);
    case 'vultr': return new VultrProviderAdapter(provider, adapterOptions);
    case 'ovh': return new OvhProviderAdapter(provider, adapterOptions);
    case 'proxmox': return new ProxmoxProviderAdapter(provider, adapterOptions);
    case 'contabo': return new ContaboProviderAdapter(provider, adapterOptions);
    case 'openstack': return new OpenStackProviderAdapter(provider, adapterOptions);
    case 'virtualizor': return new VirtualizorProviderAdapter(provider, adapterOptions);
    case 'solusvm': return new SolusvmProviderAdapter(provider, adapterOptions);
    case 'generic_http': return new GenericHttpProviderAdapter(provider, adapterOptions);
    case 'mock': return new MockProviderAdapter(provider, adapterOptions);
    default:
      return new UnavailableProviderAdapter(
        provider,
        PENDING_ADAPTERS.includes(provider.adapter)
          ? `The ${provider.adapter} adapter is not ported into this CloudHost247 build yet, so no provider call can be made for this server`
          : `No native adapter is implemented for the ${provider.adapter} provider kind in this CloudHost247 build`,
      );
  }
}

module.exports = {
  createInfrastructureProviderAdapter,
  UnavailableProviderAdapter,
  IMPLEMENTED_ADAPTERS,
  PENDING_ADAPTERS,
};
