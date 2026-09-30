import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { unsupportedRescue } from './common';
import { providerRequest } from './http';
import {
  ProviderError,
  asRecord,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
  type ProviderHealthResult,
  type ProviderImage,
  type ProviderServer,
  type ReinstallProviderServerInput,
} from './types';

/**
 * Adapter for an operator-owned provider bridge implementing the documented CloudHost247 provider
 * contract. It is not a mock: every success comes from the configured remote endpoint. If the URL
 * or bearer token is absent it fails closed with PROVIDER_NOT_CONFIGURED.
 */
export class GenericHttpProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind: string;
  private readonly token: string | undefined;
  private readonly baseUrl: string | null;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    this.kind = provider.adapter;
    const prefix = provider.credential_env_prefix || provider.slug.replace(/-/g, '_').toUpperCase();
    this.token = source[`${prefix}_API_TOKEN`];
    this.baseUrl = provider.api_base_url?.replace(/\/$/, '') ?? null;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.baseUrl || !this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', `${this.provider.name} endpoint or API token is not configured`, false);
    }
    return providerRequest<T>(`${this.baseUrl}${path}`, init, { headers: { Authorization: `Bearer ${this.token}` } });
  }

  validateConfiguration(): Promise<void> { return this.request('/v1/health'); }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    return this.request('/v1/servers', { method: 'POST', body: JSON.stringify({
      idempotencyKey: input.idempotencyKey,
      name: input.name,
      hostname: input.hostname,
      architecture: input.architecture,
      imageId: input.image.provider_image_id,
      templateId: input.image.provider_template_id,
      region: input.regionCode,
      datacenter: input.datacenterCode,
      plan: input.planMetadata,
      sshPublicKeys: input.sshPublicKeys,
      userData: input.userData,
    }) });
  }
  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> { return this.createServer(input); }
  async findServerByIdempotencyKey(key: string): Promise<ProviderServer | null> {
    try { return await this.request(`/v1/servers/by-idempotency/${encodeURIComponent(key)}`); }
    catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }
  async deleteServer(id: string): Promise<void> { await this.request(`/v1/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async action(id: string, action: string, body?: unknown): Promise<void> {
    await this.request(`/v1/servers/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
  }
  rebootServer(id: string): Promise<void> { return this.action(id, 'reboot'); }
  shutdownServer(id: string): Promise<void> { return this.action(id, 'shutdown'); }
  startServer(id: string): Promise<void> { return this.action(id, 'start'); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(id: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    await this.action(id, 'resize', { plan: planMetadata });
    return this.getServerStatus(id);
  }

  async createSnapshot(id: string, description: string): Promise<Record<string, unknown>> {
    return asRecord(await this.request(`/v1/servers/${encodeURIComponent(id)}/snapshots`, {
      method: 'POST', body: JSON.stringify({ description }),
    }));
  }

  async deleteSnapshot(id: string, snapshotId: string): Promise<void> {
    await this.request(`/v1/servers/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}`, {
      method: 'DELETE',
    });
  }

  async restoreSnapshot(id: string, snapshotId: string): Promise<void> {
    await this.action(id, 'restore-snapshot', { snapshotId });
  }
  getServerStatus(id: string): Promise<ProviderServer> { return this.request(`/v1/servers/${encodeURIComponent(id)}`); }
  async getServerIP(id: string): Promise<string | null> { return (await this.getServerStatus(id)).ipAddress; }
  getAvailableImages(): Promise<ProviderImage[]> { return this.request('/v1/images'); }
  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const id = image.provider_image_id ?? image.provider_template_id;
    if (!id) return null;
    try { return await this.request(`/v1/images/${encodeURIComponent(id)}`); }
    catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }
  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    await this.action(input.providerServerId, 'reinstall', {
      idempotencyKey: input.idempotencyKey,
      isRetry: input.isRetry,
      imageId: input.image.provider_image_id,
      templateId: input.image.provider_template_id,
      architecture: input.architecture,
      hostname: input.hostname,
      sshPublicKeys: input.sshPublicKeys,
      userData: input.userData,
    });
    return this.getServerStatus(input.providerServerId);
  }
  async enableRescue(): Promise<never> { return unsupportedRescue('This provider'); }
  async disableRescue(): Promise<never> { return unsupportedRescue('This provider'); }

  async getConsole(id: string): Promise<Record<string, unknown>> { return asRecord(await this.request(`/v1/servers/${encodeURIComponent(id)}/console`)); }
  async getServerMetrics(id: string): Promise<Record<string, unknown>> { return asRecord(await this.request(`/v1/servers/${encodeURIComponent(id)}/metrics`)); }
  healthCheck(id: string, image: ServerOsImageRow): Promise<ProviderHealthResult> {
    const expectedImageId = image.provider_image_id ?? image.provider_template_id;
    return this.request(`/v1/servers/${encodeURIComponent(id)}/health?expectedImageId=${encodeURIComponent(expectedImageId ?? '')}`);
  }
}
