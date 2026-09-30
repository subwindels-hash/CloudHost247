import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { unsupportedRescue } from './common';
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

export class ContaboProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'contabo';
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly apiUser: string | undefined;
  private readonly apiPassword: string | undefined;
  private readonly endpoint: string;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'CONTABO';
    this.clientId = source[`${prefix}_CLIENT_ID`] ?? source.CONTABO_CLIENT_ID;
    this.clientSecret = source[`${prefix}_CLIENT_SECRET`] ?? source.CONTABO_CLIENT_SECRET;
    this.apiUser = source[`${prefix}_API_USER`] ?? source.CONTABO_API_USER;
    this.apiPassword = source[`${prefix}_API_PASSWORD`] ?? source.CONTABO_API_PASSWORD;
    this.endpoint = provider.api_base_url ?? source.CONTABO_API_URL ?? 'https://api.contabo.com/v1';
  }

  private ensureConfigured(): void {
    if (!this.clientId || !this.clientSecret || !this.apiUser || !this.apiPassword) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Contabo OAuth2/API credentials are not configured', false);
    }
  }

  async validateConfiguration(): Promise<void> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo direct API token exchange not active; use generic_http bridge', false);
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    this.ensureConfigured();
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo VPS provisioning requires active provider bridge', false);
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
    throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo instance deletion requires active provider bridge', false);
  }

  rebootServer(_id: string): Promise<void> { this.ensureConfigured(); throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo action not configured', false); }
  shutdownServer(_id: string): Promise<void> { this.ensureConfigured(); throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo action not configured', false); }
  startServer(_id: string): Promise<void> { this.ensureConfigured(); throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo action not configured', false); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(_providerServerId: string, _planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo resize requires active provider bridge', false);
  }

  async createSnapshot(_providerServerId: string, _description: string): Promise<Record<string, unknown>> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo snapshot creation requires active provider bridge', false);
  }

  async deleteSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo snapshot deletion requires active provider bridge', false);
  }

  async restoreSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo snapshot restore requires active provider bridge', false);
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
    throw new ProviderError('SERVICE_UNAVAILABLE', 'Contabo VPS reinstall requires active provider bridge', false);
  }

  async enableRescue(): Promise<never> { return unsupportedRescue('contabo'); }
  async disableRescue(): Promise<never> { return unsupportedRescue('contabo'); }

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
