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

interface VultrInstancePayload {
  id: string;
  label?: string;
  status?: string;
  power_status?: string;
  main_ip?: string;
  os?: string;
  image_id?: string;
  tag?: string;
}

function toServer(instance: VultrInstancePayload): ProviderServer {
  return {
    id: instance.id,
    status: instance.status ?? 'unknown',
    name: instance.label ?? null,
    ipAddress: instance.main_ip ?? null,
    imageId: instance.image_id ?? instance.os ?? null,
    metadata: { tag: instance.tag, powerStatus: instance.power_status },
  };
}

export class VultrProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'vultr';
  private readonly token: string | undefined;
  private readonly baseUrl: string;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'VULTR';
    this.token = source[`${prefix}_API_TOKEN`] ?? source.VULTR_API_KEY;
    this.baseUrl = (provider.api_base_url ?? source.VULTR_API_URL ?? 'https://api.vultr.com/v2').replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Vultr API token is not configured', false);
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
    const plan = asString(input.planMetadata.providerServerType)
      ?? asString(input.planMetadata.plan)
      ?? asString(input.planMetadata.vultrPlan);
    if (!plan) throw new ProviderError('INVALID_CONFIGURATION', 'Product configuration is missing provider plan', false);
    const image = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Vultr image identifier', false);

    const body: Record<string, unknown> = {
      region: input.regionCode,
      plan,
      label: input.name,
      hostname: input.hostname,
      user_data: Buffer.from(input.userData).toString('base64'),
      tags: [`ch247_${input.idempotencyKey.slice(0, 30)}`],
    };
    if (/^\d+$/.test(image)) body.os_id = Number(image);
    else body.image_id = image;
    if (input.sshPublicKeys.length > 0) body.sshkey_id = input.sshPublicKeys;

    const result = await this.request<{ instance: VultrInstancePayload }>('/instances', {
      method: 'POST', body: JSON.stringify(body),
    });
    return toServer(result.instance);
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const tag = `ch247_${idempotencyKey.slice(0, 30)}`;
    const result = await this.request<{ instances?: VultrInstancePayload[] }>(`/instances?tag=${encodeURIComponent(tag)}&per_page=1`);
    const instance = result.instances?.[0];
    return instance ? toServer(instance) : null;
  }

  async deleteServer(providerServerId: string): Promise<void> {
    await this.request(`/instances/${encodeURIComponent(providerServerId)}`, { method: 'DELETE' });
  }

  rebootServer(id: string): Promise<void> {
    return this.request(`/instances/${encodeURIComponent(id)}/reboot`, { method: 'POST' });
  }
  shutdownServer(id: string): Promise<void> {
    return this.request(`/instances/${encodeURIComponent(id)}/halt`, { method: 'POST' });
  }
  startServer(id: string): Promise<void> {
    return this.request(`/instances/${encodeURIComponent(id)}/start`, { method: 'POST' });
  }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    const plan = asString(planMetadata.providerServerType) ?? asString(planMetadata.plan);
    if (!plan) throw new ProviderError('INVALID_CONFIGURATION', 'Target plan missing for resize', false);
    await this.request(`/instances/${encodeURIComponent(providerServerId)}/change-plan`, {
      method: 'POST', body: JSON.stringify({ plan }),
    });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    const result = await this.request<{ snapshot: Record<string, unknown> }>('/snapshots', {
      method: 'POST', body: JSON.stringify({ instance_id: providerServerId, description }),
    });
    return asRecord(result.snapshot);
  }

  async deleteSnapshot(_providerServerId: string, snapshotId: string): Promise<void> {
    await this.request(`/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    await this.request(`/instances/${encodeURIComponent(providerServerId)}/restore`, {
      method: 'POST', body: JSON.stringify({ snapshot_id: snapshotId }),
    });
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    const result = await this.request<{ instance: VultrInstancePayload }>(`/instances/${encodeURIComponent(providerServerId)}`);
    return toServer(result.instance);
  }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const result = await this.request<{ os?: Array<{ id: number; name?: string; arch?: string }> }>('/os');
    return (result.os ?? []).map((o) => ({
      id: String(o.id),
      name: o.name ?? null,
      architecture: o.arch === 'arm64' ? 'arm64' : 'x86_64',
      available: true,
      metadata: {},
    }));
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_image_id ?? image.provider_template_id;
    if (!identifier) return null;
    const images = await this.getAvailableImages();
    return images.find((img) => img.id === identifier || img.name === identifier) ?? null;
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const image = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Vultr image identifier', false);
    const body: Record<string, unknown> = {};
    if (/^\d+$/.test(image)) body.os_id = Number(image);
    else body.image_id = image;
    await this.request(`/instances/${encodeURIComponent(input.providerServerId)}/reinstall`, {
      method: 'POST', body: JSON.stringify(body),
    });
    return this.getServerStatus(input.providerServerId);
  }

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.request(`/instances/${encodeURIComponent(providerServerId)}/actions`));
  }

  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.request(`/instances/${encodeURIComponent(providerServerId)}/bandwidth`));
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
