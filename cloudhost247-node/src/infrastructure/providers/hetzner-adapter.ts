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
  type RescueRequest,
  type RescueSession,
} from './types';

interface HetznerServerPayload {
  id: number;
  name?: string;
  status?: string;
  image?: { id?: number; name?: string } | null;
  public_net?: { ipv4?: { ip?: string | null }; ipv6?: { ip?: string | null } };
  labels?: Record<string, string>;
}

function normalizeArchitecture(value: string | undefined): string | null {
  if (value === 'x86') return 'x86_64';
  if (value === 'arm') return 'arm64';
  return value ?? null;
}

function toServer(server: HetznerServerPayload): ProviderServer {
  return {
    id: String(server.id),
    status: server.status ?? 'unknown',
    name: server.name ?? null,
    ipAddress: server.public_net?.ipv4?.ip ?? server.public_net?.ipv6?.ip ?? null,
    imageId: server.image?.id ? String(server.image.id) : server.image?.name ?? null,
    metadata: { labels: server.labels ?? {},imageName: server.image?.name ?? null },
  };
}

export class HetznerProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'hetzner';
  private readonly token: string | undefined;
  private readonly baseUrl: string;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'HETZNER';
    this.token = source[`${prefix}_API_TOKEN`] ?? source.HETZNER_API_TOKEN;
    this.baseUrl = (provider.api_base_url ?? source.HETZNER_API_URL ?? 'https://api.hetzner.cloud/v1').replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Hetzner API token is not configured', false);
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return providerRequest<T>(`${this.baseUrl}${path}`, init, { headers: this.headers() });
  }

  async validateConfiguration(): Promise<void> {
    await this.request('/servers?per_page=1');
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const serverType = asString(input.planMetadata.providerServerType)
      ?? asString(input.planMetadata.serverType)
      ?? asString(input.planMetadata.hetznerServerType);
    if (!serverType) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Product configuration is missing providerServerType', false);
    }
    const image = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Hetzner image identifier', false);
    const body: Record<string, unknown> = {
      name: input.name,
      server_type: serverType,
      image,
      user_data: input.userData,
      labels: { cloudhost247_idempotency: input.idempotencyKey },
      start_after_create: true,
    };
    if (input.datacenterCode) body.datacenter = input.datacenterCode;
    else body.location = input.regionCode;
    const providerSshKeys = Array.isArray(input.planMetadata.providerSshKeyIds)
      ? input.planMetadata.providerSshKeyIds
      : [];
    if (providerSshKeys.length > 0) body.ssh_keys = providerSshKeys;
    const result = await this.request<{ server: HetznerServerPayload }>('/servers', {
      method: 'POST', body: JSON.stringify(body),
    });
    return toServer(result.server);
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const query = encodeURIComponent(`cloudhost247_idempotency=${idempotencyKey}`);
    const result = await this.request<{ servers?: HetznerServerPayload[] }>(`/servers?label_selector=${query}&per_page=1`);
    const server = result.servers?.[0];
    return server ? toServer(server) : null;
  }

  async deleteServer(providerServerId: string): Promise<void> {
    await this.request(`/servers/${encodeURIComponent(providerServerId)}`, { method: 'DELETE' });
  }

  async action(providerServerId: string, action: string, body?: Record<string, unknown>): Promise<void> {
    await this.request(`/servers/${encodeURIComponent(providerServerId)}/actions/${action}`, {
      method: 'POST', body: body ? JSON.stringify(body) : undefined,
    });
  }

  rebootServer(id: string): Promise<void> { return this.action(id, 'reboot'); }
  shutdownServer(id: string): Promise<void> { return this.action(id, 'shutdown'); }
  startServer(id: string): Promise<void> { return this.action(id, 'poweron'); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    const serverType = asString(planMetadata.providerServerType)
      ?? asString(planMetadata.serverType)
      ?? asString(planMetadata.hetznerServerType);
    if (!serverType) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Target plan is missing providerServerType for resize', false);
    }
    await this.action(providerServerId, 'change_type', { server_type: serverType, upgrade_disk: true });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    const result = await this.request<{ action: Record<string, unknown>; image?: Record<string, unknown> }>(
      `/servers/${encodeURIComponent(providerServerId)}/actions/create_image`,
      { method: 'POST', body: JSON.stringify({ type: 'snapshot', description }) }
    );
    return asRecord(result.image ?? result.action);
  }

  async deleteSnapshot(_providerServerId: string, snapshotId: string): Promise<void> {
    await this.request(`/images/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    await this.action(providerServerId, 'rebuild', { image: snapshotId });
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    try {
      const result = await this.request<{ server: HetznerServerPayload }>(`/servers/${encodeURIComponent(providerServerId)}`);
      return toServer(result.server);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        throw new ProviderError('RESOURCE_NOT_FOUND', 'Provider server no longer exists', false);
      }
      throw error;
    }
  }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const result = await this.request<{ images?: Array<{ id: number; name?: string; architecture?: string; status?: string; deprecated?: string | null }> }>('/images?type=system&per_page=50');
    return (result.images ?? []).map((image) => ({
      id: String(image.id), name: image.name ?? null, architecture: normalizeArchitecture(image.architecture),
      available: image.status === 'available' && !image.deprecated, metadata: {},
    }));
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_image_id ?? image.provider_template_id;
    if (!identifier) return null;
    try {
      if (/^\d+$/.test(identifier)) {
        const result = await this.request<{ image: { id: number; name?: string; architecture?: string; status?: string; deprecated?: string | null } }>(`/images/${identifier}`);
        return { id: String(result.image.id), name: result.image.name ?? null, architecture: normalizeArchitecture(result.image.architecture), available: result.image.status === 'available' && !result.image.deprecated, metadata: {} };
      }
      const result = await this.request<{ images?: Array<{ id: number; name?: string; architecture?: string; status?: string; deprecated?: string | null }> }>(`/images?name=${encodeURIComponent(identifier)}&per_page=1`);
      const found = result.images?.[0];
      return found ? { id: String(found.id), name: found.name ?? null, architecture: normalizeArchitecture(found.architecture), available: found.status === 'available' && !found.deprecated, metadata: {} } : null;
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const image = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Hetzner image identifier', false);
    const current=await this.getServerStatus(input.providerServerId);
    const alreadyTarget=current.imageId===String(image)||current.metadata.imageName===image;
    // Rebuild is not natively keyed by the Hetzner API. A retry first observes provider state:
    // an already-target or in-progress server is never rebuilt a second time.
    if(input.isRetry&&(alreadyTarget||['rebuilding','initializing','starting'].includes(current.status)))return current;
    try{await this.action(input.providerServerId, 'rebuild', { image });}
    catch(error){
      const status=error instanceof ProviderError&&error.providerResponse&&typeof error.providerResponse==='object'
        ? (error.providerResponse as {status?:number}).status:undefined;
      if(status!==409)throw error;
      // A duplicate worker delivery may race the accepted rebuild. Treat provider conflict as
      // in-progress and let the attested health gate decide the terminal outcome.
    }
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * Hetzner boots a separate rescue image that replaces the running system until the next reset.
   * The API returns a root password exactly once; it is handed straight back to the caller and
   * never persisted here. Project SSH keys from the template are injected as well, so an operator
   * who configured them does not depend on the password at all.
   */
  async enableRescue(providerServerId: string, input: RescueRequest): Promise<RescueSession> {
    // Hetzner serves one 64-bit rescue system for both x86 and Arm servers.
    const body: Record<string, unknown> = { type: 'linux64' };
    if (input.providerSshKeyIds?.length) body.ssh_keys = input.providerSshKeyIds;
    const result = await this.request<{ root_password?: string | null; action?: Record<string, unknown> }>(
      `/servers/${encodeURIComponent(providerServerId)}/actions/enable_rescue`,
      { method: 'POST', body: JSON.stringify(body) }
    );
    // Rescue only takes effect on the next boot, so the reset is part of entering it.
    await this.action(providerServerId, 'reset');
    return {
      type: 'linux64',
      username: 'root',
      password: typeof result.root_password === 'string' && result.root_password.length > 0 ? result.root_password : undefined,
      rebooted: true,
    };
  }

  async disableRescue(providerServerId: string): Promise<void> {
    await this.action(providerServerId, 'disable_rescue');
    await this.action(providerServerId, 'reset');
  }

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    const result = await this.request<Record<string, unknown>>(`/servers/${encodeURIComponent(providerServerId)}/actions/request_console`, { method: 'POST' });
    return asRecord(result);
  }

  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60_000);
    return asRecord(await this.request(`/servers/${encodeURIComponent(providerServerId)}/metrics?type=cpu,disk,network&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`));
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage.provider_image_id ?? expectedImage.provider_template_id;
      const imageMatches = !expected || server.imageId === String(expected) || server.metadata.imageName === expected;
      return {
        exists: true,
        poweredOn: server.status === 'running',
        ipAddress: server.ipAddress,
        imageMatches,
        providerStatus: server.status,
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        return { exists: false, poweredOn: false, ipAddress: null, imageMatches: false, providerStatus: 'missing' };
      }
      throw error;
    }
  }
}
