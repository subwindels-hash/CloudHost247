/**
 * OVHcloud Public Cloud adapter.
 *
 * Maps the CloudHost247 provider interface onto the OVH `/cloud/project/{id}/instance` API.
 * Required server-side configuration (never exposed to the browser):
 *
 *   <PREFIX>_API_ENDPOINT        e.g. https://eu.api.ovh.com/1.0   (or the provider api_base_url)
 *   <PREFIX>_APPLICATION_KEY
 *   <PREFIX>_APPLICATION_SECRET
 *   <PREFIX>_CONSUMER_KEY
 *   <PREFIX>_CLOUD_PROJECT_ID    Public Cloud project (service name) that owns the instances
 *
 * <PREFIX> defaults to OVH and is set per provider row via credential_env_prefix, so one
 * deployment can hold several OVH accounts without sharing credentials.
 *
 * Product configuration metadata must supply `providerFlavorId` (an operator-verified OVH
 * flavor). OVH has no request idempotency key, so the adapter names each instance after the
 * job idempotency key and always looks that name up before creating anything.
 */
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import {
  encodeUserData,
  firstPublicIpv4,
  idempotentResourceName,
  planMetadataString,
  requirePlanMetadataString,
  requireSecureBaseUrl,
} from './common';
import { OvhClient, type OvhImage, type OvhInstance } from './ovh-client';
import {
  ProviderError,
  asRecord,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
  type ProviderHealthResult,
  type ProviderImage,
  type ProviderServer,
  type ReinstallProviderServerInput,
  type RescueRequest,
  type RescueSession,
} from './types';

const RUNNING_STATUSES = new Set(['ACTIVE', 'RESCUE', 'VERIFY_RESIZE']);

function toServer(instance: OvhInstance): ProviderServer {
  const imageId = instance.imageId ?? instance.image?.id ?? null;
  return {
    id: String(instance.id),
    status: instance.status ?? 'unknown',
    name: instance.name ?? null,
    ipAddress: firstPublicIpv4((instance.ipAddresses ?? []).filter((entry) => entry.version !== 6).map((entry) => entry.ip)),
    imageId: imageId ? String(imageId) : null,
    metadata: {
      region: instance.region ?? null,
      flavorId: instance.flavorId ?? null,
      imageName: instance.image?.name ?? null,
    },
  };
}

function normalizeArchitecture(image: OvhImage): string | null {
  const raw = image.propertiesArchitecture ?? (image.tags ?? []).find((tag) => /arm64|aarch64|x86_64|amd64/i.test(tag));
  if (!raw) return null;
  if (/arm64|aarch64/i.test(raw)) return 'arm64';
  if (/x86_64|amd64/i.test(raw)) return 'x86_64';
  return null;
}

export class OvhProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'ovh';
  private readonly endpoint: string | null;
  private readonly applicationKey: string | undefined;
  private readonly applicationSecret: string | undefined;
  private readonly consumerKey: string | undefined;
  private readonly cloudProjectId: string | undefined;
  private client: OvhClient | null = null;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'OVH';
    this.applicationKey = source[`${prefix}_APPLICATION_KEY`] ?? source.OVH_APPLICATION_KEY;
    this.applicationSecret = source[`${prefix}_APPLICATION_SECRET`] ?? source.OVH_APPLICATION_SECRET;
    this.consumerKey = source[`${prefix}_CONSUMER_KEY`] ?? source.OVH_CONSUMER_KEY;
    this.cloudProjectId =
      source[`${prefix}_CLOUD_PROJECT_ID`]
      ?? source.OVH_CLOUD_PROJECT_ID
      ?? (typeof provider.metadata.cloudProjectId === 'string' ? provider.metadata.cloudProjectId : undefined);
    this.endpoint = provider.api_base_url ?? source[`${prefix}_API_ENDPOINT`] ?? source.OVH_API_ENDPOINT ?? null;
  }

  private api(): OvhClient {
    if (this.client) return this.client;
    if (!this.applicationKey || !this.applicationSecret || !this.consumerKey) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'OVH application key, application secret and consumer key must be configured server-side',
        false
      );
    }
    if (!this.cloudProjectId) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'OVH Public Cloud project id (<PREFIX>_CLOUD_PROJECT_ID) is not configured',
        false
      );
    }
    this.client = new OvhClient({
      endpoint: requireSecureBaseUrl('OVH', this.endpoint ?? 'https://eu.api.ovh.com/1.0'),
      applicationKey: this.applicationKey,
      applicationSecret: this.applicationSecret,
      consumerKey: this.consumerKey,
      cloudProjectId: this.cloudProjectId,
    });
    return this.client;
  }

  private project(): string {
    return this.api().projectPath;
  }

  async validateConfiguration(): Promise<void> {
    const client = this.api();
    await client.request('GET', `${this.project()}/region`);
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const client = this.api();
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const flavorId = requirePlanMetadataString(
      input.planMetadata,
      ['providerFlavorId', 'ovhFlavorId', 'flavorId'],
      'the OVH flavor identifier'
    );
    const imageId = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no OVH image identifier', false);
    const body: Record<string, unknown> = {
      name: idempotentResourceName(input.idempotencyKey),
      flavorId,
      imageId,
      region: input.datacenterCode ?? input.regionCode,
      monthlyBilling: input.planMetadata.monthlyBilling === true,
      userData: input.userData,
    };
    const providerSshKeyId = planMetadataString(input.planMetadata, ['providerSshKeyId', 'ovhSshKeyId']);
    if (providerSshKeyId) body.sshKeyId = providerSshKeyId;
    const instance = await client.request<OvhInstance>('POST', `${this.project()}/instance`, body);
    return toServer(instance);
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const client = this.api();
    const expected = idempotentResourceName(idempotencyKey);
    const instances = await client.request<OvhInstance[]>('GET', `${this.project()}/instance`);
    const match = (instances ?? []).find((instance) => instance.name === expected);
    return match ? toServer(match) : null;
  }

  async deleteServer(providerServerId: string): Promise<void> {
    await this.api().request('DELETE', `${this.project()}/instance/${encodeURIComponent(providerServerId)}`);
  }

  private action(providerServerId: string, action: string, body?: unknown): Promise<unknown> {
    return this.api().request('POST', `${this.project()}/instance/${encodeURIComponent(providerServerId)}/${action}`, body);
  }

  async rebootServer(providerServerId: string): Promise<void> {
    await this.action(providerServerId, 'reboot', { type: 'soft' });
  }

  async shutdownServer(providerServerId: string): Promise<void> {
    await this.action(providerServerId, 'stop');
  }

  async startServer(providerServerId: string): Promise<void> {
    await this.action(providerServerId, 'start');
  }

  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    const flavorId = requirePlanMetadataString(
      planMetadata,
      ['providerFlavorId', 'ovhFlavorId', 'flavorId'],
      'the target OVH flavor identifier'
    );
    await this.action(providerServerId, 'resize', { flavorId });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    return asRecord(await this.action(providerServerId, 'snapshot', { snapshotName: description }));
  }

  async deleteSnapshot(_providerServerId: string, snapshotId: string): Promise<void> {
    await this.api().request('DELETE', `${this.project()}/snapshot/${encodeURIComponent(snapshotId)}`);
  }

  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    // OVH restores a snapshot by reinstalling the instance from the snapshot image.
    await this.action(providerServerId, 'reinstall', { imageId: snapshotId });
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    try {
      return toServer(
        await this.api().request<OvhInstance>('GET', `${this.project()}/instance/${encodeURIComponent(providerServerId)}`)
      );
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        throw new ProviderError('RESOURCE_NOT_FOUND', 'OVH instance no longer exists', false);
      }
      throw error;
    }
  }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const images = await this.api().request<OvhImage[]>('GET', `${this.project()}/image`);
    return (images ?? []).map((image) => ({
      id: String(image.id),
      name: image.name ?? null,
      architecture: normalizeArchitecture(image),
      available: (image.status ?? '').toLowerCase() === 'active',
      metadata: { region: image.region ?? null, visibility: image.visibility ?? null },
    }));
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_image_id ?? image.provider_template_id;
    if (!identifier) return null;
    try {
      const remote = await this.api().request<OvhImage>('GET', `${this.project()}/image/${encodeURIComponent(identifier)}`);
      return {
        id: String(remote.id),
        name: remote.name ?? null,
        architecture: normalizeArchitecture(remote),
        available: (remote.status ?? '').toLowerCase() === 'active',
        metadata: { region: remote.region ?? null, visibility: remote.visibility ?? null },
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const imageId = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no OVH image identifier', false);
    const current = await this.getServerStatus(input.providerServerId);
    // OVH reinstall is not keyed. A retry observes provider state first so an accepted,
    // still-running reinstall is never issued twice.
    if (input.isRetry && (current.imageId === String(imageId) || ['REBUILD', 'BUILD', 'REBUILD_SPAWNING'].includes(current.status))) {
      return current;
    }
    await this.action(input.providerServerId, 'reinstall', { imageId });
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * OVH Public Cloud rescue is an instance boot mode rather than a Nova action: the API flips it on
   * with `rescue: true` (OVH's own CLI posts the same body) and serves the one-time root password on
   * the instance resource as `rescuePassword`. That password is handed to the requesting customer
   * and is never stored, logged or audited.
   */
  async enableRescue(providerServerId: string, _input: RescueRequest): Promise<RescueSession> {
    const instancePath = `${this.project()}/instance/${encodeURIComponent(providerServerId)}`;
    await this.api().request('POST', `${instancePath}/rescueMode`, { rescue: true });
    const instance = await this.api().request<OvhInstance>('GET', instancePath);
    const password =
      typeof instance.rescuePassword === 'string' && instance.rescuePassword.length > 0
        ? instance.rescuePassword
        : undefined;
    return {
      type: 'ovh-rescue',
      username: 'root',
      password,
      rebooted: true,
      notes: 'OVH boots the instance in rescue mode. The rescue password is served by the instance resource while rescue mode is active.',
    };
  }

  async disableRescue(providerServerId: string): Promise<void> {
    await this.api().request('POST', `${this.project()}/instance/${encodeURIComponent(providerServerId)}/rescueMode`, { rescue: false });
  }

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.action(providerServerId, 'vnc'));
  }

  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    const metrics = await this.api().request<unknown>(
      'GET',
      `${this.project()}/instance/${encodeURIComponent(providerServerId)}/monitoring?period=lastday&type=cpu%3Aused`
    );
    return asRecord(metrics);
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage.provider_image_id ?? expectedImage.provider_template_id;
      return {
        exists: true,
        poweredOn: RUNNING_STATUSES.has(server.status.toUpperCase()),
        ipAddress: server.ipAddress,
        imageMatches: !expected || server.imageId === String(expected),
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
