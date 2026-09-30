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

export class AwsProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'aws';
  private readonly accessKeyId: string | undefined;
  private readonly secretAccessKey: string | undefined;
  private readonly region: string;
  private readonly endpoint: string;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'AWS';
    this.accessKeyId = source[`${prefix}_ACCESS_KEY_ID`] ?? source.AWS_ACCESS_KEY_ID;
    this.secretAccessKey = source[`${prefix}_SECRET_ACCESS_KEY`] ?? source.AWS_SECRET_ACCESS_KEY;
    this.region = source[`${prefix}_REGION`] ?? source.AWS_REGION ?? 'us-east-1';
    this.endpoint = provider.api_base_url ?? `https://ec2.${this.region}.amazonaws.com`;
  }

  private ensureConfigured(): void {
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'AWS credentials (access key / secret) are not configured', false);
    }
  }

  async validateConfiguration(): Promise<void> {
    this.ensureConfigured();
    // Signature v4 request or bridge proxy request
    await providerRequest(`${this.endpoint}/`, { method: 'POST', body: 'Action=DescribeRegions&Version=2016-11-15' }, {
      headers: { Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}` },
    }).catch((err) => {
      if (err instanceof ProviderError && (err.code === 'PROVIDER_NOT_CONFIGURED' || err.code === 'AUTHENTICATION_FAILED')) throw err;
      // In dev or without mock AWS gateway, standard fail-closed
      throw new ProviderError('AUTHENTICATION_FAILED', 'AWS API authentication validation failed', false);
    });
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    this.ensureConfigured();
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS EC2 server creation requires active provider bridge or AWS SDK credentials', false);
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
    throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS EC2 server termination requires active provider bridge', false);
  }

  rebootServer(_id: string): Promise<void> { this.ensureConfigured(); throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS action not configured', false); }
  shutdownServer(_id: string): Promise<void> { this.ensureConfigured(); throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS action not configured', false); }
  startServer(_id: string): Promise<void> { this.ensureConfigured(); throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS action not configured', false); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(_providerServerId: string, _planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS resize requires active provider bridge', false);
  }

  async createSnapshot(_providerServerId: string, _description: string): Promise<Record<string, unknown>> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS snapshot creation requires active provider bridge', false);
  }

  async deleteSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS snapshot deletion requires active provider bridge', false);
  }

  async restoreSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    this.ensureConfigured();
    throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS snapshot restore requires active provider bridge', false);
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
    throw new ProviderError('SERVICE_UNAVAILABLE', 'AWS EC2 reinstall requires active provider bridge', false);
  }

  async enableRescue(): Promise<never> { return unsupportedRescue('aws'); }
  async disableRescue(): Promise<never> { return unsupportedRescue('aws'); }

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
