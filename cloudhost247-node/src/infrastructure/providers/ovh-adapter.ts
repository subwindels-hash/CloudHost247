import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { providerRequest } from './http';
import {
  ProviderError,
  asRecord,
  asString,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
  type ProviderHealthResult,
  type ProviderImage,
  type ProviderServer,
  type ReinstallProviderServerInput,
} from './types';

export class OvhProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'ovh';
  private readonly appKey: string | undefined;
  private readonly appSecret: string | undefined;
  private readonly consumerKey: string | undefined;
  private readonly endpoint: string;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'OVH';
    this.appKey = source[`${prefix}_APPLICATION_KEY`] ?? source.OVH_APPLICATION_KEY;
    this.appSecret = source[`${prefix}_APPLICATION_SECRET`] ?? source.OVH_APPLICATION_SECRET;
    this.consumerKey = source[`${prefix}_CONSUMER_KEY`] ?? source.OVH_CONSUMER_KEY;
    this.endpoint = provider.api_base_url ?? source.OVH_API_ENDPOINT ?? 'https://eu.api.ovh.com/1.0';
  }

  private ensureConfigured(): void {
    if (!this.appKey || !this.appSecret || !this.consumerKey) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'OVH API credentials (app key / app secret / consumer key) are not configured', false);
    }
  }

  async validateConfiguration(): Promise<void> {
    this.ensureConfigured();
    await providerRequest(`${this.endpoint}/auth/time`, { method: 'GET' });
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    this.ensureConfigured();
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    throw new ProviderError('SERVICE_UNAVAILABLE', 'Native OVH cloud provisioning is not configured for direct API access; use generic_http bridge', false);
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(_idempotencyKey: string): Promise<ProviderServer | null> {
    this.ensureConfigured();
    return null;
  }

  async deleteServer(_providerServerId: string): Promise<void> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'OVH server deletion requires active provider bridge', false);
  }

  rebootServer(_id: string): Promise<void> { this.ensureConfigured(); throw new ProviderError('SERVICE_UNAVAILABLE', 'OVH action not configured', false); }
  shutdownServer(_id: string): Promise<void> { this.ensureConfigured(); throw new ProviderError('SERVICE_UNAVAILABLE', 'OVH action not configured', false); }
  startServer(_id: string): Promise<void> { this.ensureConfigured(); throw new ProviderError('SERVICE_UNAVAILABLE', 'OVH action not configured', false); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(_providerServerId: string, _planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'OVH resize requires active provider bridge', false);
  }

  async createSnapshot(_providerServerId: string, _description: string): Promise<Record<string, unknown>> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'OVH snapshot creation requires active provider bridge', false);
  }

  async deleteSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'OVH snapshot deletion requires active provider bridge', false);
  }

  async restoreSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'OVH snapshot restore requires active provider bridge', false);
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    this.ensureConfigured();
    return { id: providerServerId, status: 'unknown', name: null, ipAddress: null, imageId: null, metadata: {} };
  }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    this.ensureConfigured();
    return [];
  }

  async getImage(_image: ServerOsImageRow): Promise<ProviderImage | null> {
    this.ensureConfigured();
    return null;
  }

  async reinstallServer(_input: ReinstallProviderServerInput): Promise<ProviderServer> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'OVH server reinstall requires active provider bridge', false);
  }

  async getConsole(_providerServerId: string): Promise<Record<string, unknown>> {
    this.ensureConfigured();
    return {};
  }

  async getServerMetrics(_providerServerId: string): Promise<Record<string, unknown>> {
    this.ensureConfigured();
    return {};
  }

  async healthCheck(providerServerId: string, _expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    this.ensureConfigured();
    return { exists: false, poweredOn: false, ipAddress: null, imageMatches: false, providerStatus: 'unknown' };
  }
}
