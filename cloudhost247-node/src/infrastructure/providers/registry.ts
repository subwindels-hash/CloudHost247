import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { AwsProviderAdapter } from './aws-adapter';
import { ContaboProviderAdapter } from './contabo-adapter';
import { DigitalOceanProviderAdapter } from './digitalocean-adapter';
import { GenericHttpProviderAdapter } from './generic-http-adapter';
import { HetznerProviderAdapter } from './hetzner-adapter';
import { MockProviderAdapter } from './mock-adapter';
import { OpenStackProviderAdapter } from './openstack-adapter';
import { OvhProviderAdapter } from './ovh-adapter';
import { ProxmoxProviderAdapter } from './proxmox-adapter';
import { SolusvmProviderAdapter } from './solusvm-adapter';
import {
  ProviderError,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
  type ProviderHealthResult,
  type ProviderImage,
  type ProviderServer,
  type ReinstallProviderServerInput,
  type RescueRequest,
  type RescueSession,
} from './types';
import { VirtualizorProviderAdapter } from './virtualizor-adapter';
import { VultrProviderAdapter } from './vultr-adapter';

/**
 * Fallback adapter for unknown provider kinds. Always fails closed: an unrecognised adapter is
 * never quietly substituted with another provider's implementation or with the mock provider.
 */
class UnavailableNativeProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind: string;
  constructor(readonly provider: InfrastructureProviderRow) { this.kind = provider.adapter; }
  private unavailable(): ProviderError {
    return new ProviderError(
      'SERVICE_UNAVAILABLE',
      `The ${this.provider.adapter} native adapter is not enabled in this CloudHost247 build`,
      false
    );
  }
  validateConfiguration(): Promise<void> { return Promise.reject(this.unavailable()); }
  createServer(_input: CreateProviderServerInput): Promise<ProviderServer> { return Promise.reject(this.unavailable()); }
  provisionServer(_input: CreateProviderServerInput): Promise<ProviderServer> { return Promise.reject(this.unavailable()); }
  findServerByIdempotencyKey(_key: string): Promise<ProviderServer | null> { return Promise.reject(this.unavailable()); }
  deleteServer(_id: string): Promise<void> { return Promise.reject(this.unavailable()); }
  rebootServer(_id: string): Promise<void> { return Promise.reject(this.unavailable()); }
  shutdownServer(_id: string): Promise<void> { return Promise.reject(this.unavailable()); }
  startServer(_id: string): Promise<void> { return Promise.reject(this.unavailable()); }
  powerOnServer(_id: string): Promise<void> { return Promise.reject(this.unavailable()); }
  powerOffServer(_id: string): Promise<void> { return Promise.reject(this.unavailable()); }
  getServer(_id: string): Promise<ProviderServer> { return Promise.reject(this.unavailable()); }
  getServerStatus(_id: string): Promise<ProviderServer> { return Promise.reject(this.unavailable()); }
  getServerIP(_id: string): Promise<string | null> { return Promise.reject(this.unavailable()); }
  getAvailableImages(): Promise<ProviderImage[]> { return Promise.reject(this.unavailable()); }
  getImage(_image: ServerOsImageRow): Promise<ProviderImage | null> { return Promise.reject(this.unavailable()); }
  reinstallServer(_input: ReinstallProviderServerInput): Promise<ProviderServer> { return Promise.reject(this.unavailable()); }
  rebuildServer(_input: ReinstallProviderServerInput): Promise<ProviderServer> { return Promise.reject(this.unavailable()); }
  resizeServer(_id: string, _plan: Record<string, unknown>): Promise<ProviderServer> { return Promise.reject(this.unavailable()); }
  createSnapshot(_id: string, _desc: string): Promise<Record<string, unknown>> { return Promise.reject(this.unavailable()); }
  deleteSnapshot(_id: string, _snapId: string): Promise<void> { return Promise.reject(this.unavailable()); }
  restoreSnapshot(_id: string, _snapId: string): Promise<void> { return Promise.reject(this.unavailable()); }
  getConsole(_id: string): Promise<Record<string, unknown>> { return Promise.reject(this.unavailable()); }
  enableRescue(_id: string, _input: RescueRequest): Promise<RescueSession> { return Promise.reject(this.unavailable()); }
  disableRescue(_id: string): Promise<void> { return Promise.reject(this.unavailable()); }
  getServerMetrics(_id: string): Promise<Record<string, unknown>> { return Promise.reject(this.unavailable()); }
  healthCheck(_id: string, _image: ServerOsImageRow): Promise<ProviderHealthResult> { return Promise.reject(this.unavailable()); }
}

/**
 * Resolves the adapter for one provider row.
 *
 * Every provider kind maps to its own implementation: one provider's client is never reused for
 * a different platform, and the development mock is only ever returned for a provider that an
 * administrator explicitly registered with the `mock` adapter (it additionally refuses to run
 * in production — see mock-adapter.ts).
 */
export function createInfrastructureProviderAdapter(
  provider: InfrastructureProviderRow,
  source: NodeJS.ProcessEnv = process.env
): InfrastructureProviderAdapter {
  switch (provider.adapter) {
    case 'hetzner':
      return new HetznerProviderAdapter(provider, source);
    case 'digitalocean':
      return new DigitalOceanProviderAdapter(provider, source);
    case 'vultr':
      return new VultrProviderAdapter(provider, source);
    case 'aws':
      return new AwsProviderAdapter(provider, source);
    case 'ovh':
      return new OvhProviderAdapter(provider, source);
    case 'contabo':
      return new ContaboProviderAdapter(provider, source);
    case 'proxmox':
      return new ProxmoxProviderAdapter(provider, source);
    case 'virtualizor':
      return new VirtualizorProviderAdapter(provider, source);
    case 'solusvm':
      return new SolusvmProviderAdapter(provider, source);
    case 'openstack':
      return new OpenStackProviderAdapter(provider, source);
    case 'generic_http':
      return new GenericHttpProviderAdapter(provider, source);
    case 'mock':
      return new MockProviderAdapter(provider, source);
    default:
      return new UnavailableNativeProviderAdapter(provider);
  }
}
