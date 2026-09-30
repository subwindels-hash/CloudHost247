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

interface DropletPayload {
  id: number;
  name?: string;
  status?: string;
  image?: { id?: number; slug?: string; name?: string } | null;
  networks?: { v4?: Array<{ ip_address?: string; type?: string }> };
  tags?: string[];
}

function toServer(droplet: DropletPayload): ProviderServer {
  const publicV4 = droplet.networks?.v4?.find((net) => net.type === 'public')?.ip_address ?? null;
  return {
    id: String(droplet.id),
    status: droplet.status ?? 'unknown',
    name: droplet.name ?? null,
    ipAddress: publicV4,
    imageId: droplet.image?.id ? String(droplet.image.id) : droplet.image?.slug ?? droplet.image?.name ?? null,
    metadata: { tags: droplet.tags ?? [] },
  };
}

export class DigitalOceanProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'digitalocean';
  private readonly token: string | undefined;
  private readonly baseUrl: string;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'DIGITALOCEAN';
    this.token = source[`${prefix}_API_TOKEN`] ?? source.DIGITALOCEAN_API_TOKEN;
    this.baseUrl = (provider.api_base_url ?? source.DIGITALOCEAN_API_URL ?? 'https://api.digitalocean.com/v2').replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'DigitalOcean API token is not configured', false);
    }
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return providerRequest<T>(`${this.baseUrl}${path}`, init, { headers: this.headers() });
  }

  async validateConfiguration(): Promise<void> {
    await this.request('/account');
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const size = asString(input.planMetadata.providerServerType)
      ?? asString(input.planMetadata.size)
      ?? asString(input.planMetadata.digitalOceanSize);
    if (!size) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Product configuration is missing provider size', false);
    }
    const image = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no DigitalOcean image identifier', false);

    const body: Record<string, unknown> = {
      name: input.name,
      region: input.regionCode,
      size,
      image,
      user_data: input.userData,
      tags: [`ch247_idempotency_${input.idempotencyKey.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_')}`],
      ipv6: true,
    };
    if (input.sshPublicKeys.length > 0) body.ssh_keys = input.sshPublicKeys;

    const result = await this.request<{ droplet: DropletPayload }>('/droplets', {
      method: 'POST', body: JSON.stringify(body),
    });
    return toServer(result.droplet);
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const tag = `ch247_idempotency_${idempotencyKey.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const result = await this.request<{ droplets?: DropletPayload[] }>(`/droplets?tag_name=${encodeURIComponent(tag)}&per_page=1`);
    const droplet = result.droplets?.[0];
    return droplet ? toServer(droplet) : null;
  }

  async deleteServer(providerServerId: string): Promise<void> {
    await this.request(`/droplets/${encodeURIComponent(providerServerId)}`, { method: 'DELETE' });
  }

  private async action(providerServerId: string, type: string, params?: Record<string, unknown>): Promise<void> {
    await this.request(`/droplets/${encodeURIComponent(providerServerId)}/actions`, {
      method: 'POST', body: JSON.stringify({ type, ...params }),
    });
  }

  rebootServer(id: string): Promise<void> { return this.action(id, 'reboot'); }
  shutdownServer(id: string): Promise<void> { return this.action(id, 'shutdown'); }
  startServer(id: string): Promise<void> { return this.action(id, 'power_on'); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    const size = asString(planMetadata.providerServerType) ?? asString(planMetadata.size);
    if (!size) throw new ProviderError('INVALID_CONFIGURATION', 'Target size missing for resize', false);
    await this.action(providerServerId, 'resize', { size, disk: true });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    const result = await this.request<{ action: Record<string, unknown> }>(`/droplets/${encodeURIComponent(providerServerId)}/actions`, {
      method: 'POST', body: JSON.stringify({ type: 'snapshot', name: description }),
    });
    return asRecord(result.action);
  }

  async deleteSnapshot(_providerServerId: string, snapshotId: string): Promise<void> {
    await this.request(`/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    await this.action(providerServerId, 'restore', { image: snapshotId });
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    const result = await this.request<{ droplet: DropletPayload }>(`/droplets/${encodeURIComponent(providerServerId)}`);
    return toServer(result.droplet);
  }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const result = await this.request<{ images?: Array<{ id: number; name?: string; slug?: string; status?: string }> }>('/images?type=distribution&per_page=50');
    return (result.images ?? []).map((img) => ({
      id: img.slug ?? String(img.id),
      name: img.name ?? null,
      architecture: 'x86_64',
      available: img.status === 'available',
      metadata: {},
    }));
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_image_id ?? image.provider_template_id;
    if (!identifier) return null;
    try {
      const result = await this.request<{ image: { id: number; name?: string; slug?: string; status?: string } }>(`/images/${encodeURIComponent(identifier)}`);
      return {
        id: result.image.slug ?? String(result.image.id),
        name: result.image.name ?? null,
        architecture: 'x86_64',
        available: result.image.status === 'available',
        metadata: {},
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const image = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no DigitalOcean image identifier', false);
    await this.action(input.providerServerId, 'rebuild', { image });
    return this.getServerStatus(input.providerServerId);
  }

  async enableRescue(): Promise<never> { return unsupportedRescue('digitalocean'); }
  async disableRescue(): Promise<never> { return unsupportedRescue('digitalocean'); }

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.request(`/droplets/${encodeURIComponent(providerServerId)}/actions`));
  }

  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.request(`/droplets/${encodeURIComponent(providerServerId)}/neighbors`));
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage.provider_image_id ?? expectedImage.provider_template_id;
      const imageMatches = !expected || server.imageId === String(expected);
      return {
        exists: true,
        poweredOn: server.status === 'active',
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
