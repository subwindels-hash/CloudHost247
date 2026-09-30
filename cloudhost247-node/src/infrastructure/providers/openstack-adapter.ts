/**
 * OpenStack (Keystone v3 + Nova + Glance) adapter.
 *
 * Required server-side configuration — either a password/application credential login:
 *   <PREFIX>_AUTH_URL          https://keystone.example.net/v3
 *   <PREFIX>_USERNAME
 *   <PREFIX>_PASSWORD
 *   <PREFIX>_PROJECT_ID        (or <PREFIX>_PROJECT_NAME + <PREFIX>_PROJECT_DOMAIN_NAME)
 *   <PREFIX>_USER_DOMAIN_NAME  optional, defaults to Default
 * …or a pre-issued token for deployments that mint tokens elsewhere:
 *   <PREFIX>_API_URL           Nova compute endpoint
 *   <PREFIX>_API_TOKEN
 *
 * Product configuration metadata must supply `providerFlavorId` and `providerNetworkId`.
 * Nova supports server metadata, so idempotency uses both a deterministic name and a
 * `cloudhost247_idempotency` metadata key that is verified on lookup.
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
import { OpenStackSession } from './openstack-client';
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

interface NovaServer {
  id: string;
  name?: string;
  status?: string;
  image?: { id?: string } | string | null;
  metadata?: Record<string, string>;
  addresses?: Record<string, Array<{ addr?: string; version?: number; 'OS-EXT-IPS:type'?: string }>>;
}

const IDEMPOTENCY_METADATA_KEY = 'cloudhost247_idempotency';

function toServer(server: NovaServer): ProviderServer {
  const addresses = Object.values(server.addresses ?? {}).flat();
  const floating = addresses.filter((entry) => entry['OS-EXT-IPS:type'] === 'floating' && entry.version !== 6).map((entry) => entry.addr);
  const fixed = addresses.filter((entry) => entry.version !== 6).map((entry) => entry.addr);
  const image = typeof server.image === 'string' ? server.image : server.image?.id ?? null;
  return {
    id: server.id,
    status: (server.status ?? 'unknown').toLowerCase(),
    name: server.name ?? null,
    ipAddress: firstPublicIpv4([...floating, ...fixed]),
    imageId: image ? String(image) : null,
    metadata: { openstackMetadata: server.metadata ?? {} },
  };
}

export class OpenStackProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'openstack';
  private readonly settings: {
    authUrl?: string;
    username?: string;
    password?: string;
    projectId?: string;
    projectName?: string;
    userDomainName?: string;
    projectDomainName?: string;
    staticToken?: string;
    computeUrl?: string;
    imageUrl?: string;
    region?: string;
  };
  private session: OpenStackSession | null = null;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'OPENSTACK';
    this.settings = {
      authUrl: source[`${prefix}_AUTH_URL`] ?? source.OPENSTACK_AUTH_URL,
      username: source[`${prefix}_USERNAME`] ?? source.OPENSTACK_USERNAME,
      password: source[`${prefix}_PASSWORD`] ?? source.OPENSTACK_PASSWORD,
      projectId: source[`${prefix}_PROJECT_ID`] ?? source.OPENSTACK_PROJECT_ID,
      projectName: source[`${prefix}_PROJECT_NAME`] ?? source.OPENSTACK_PROJECT_NAME,
      userDomainName: source[`${prefix}_USER_DOMAIN_NAME`] ?? source.OPENSTACK_USER_DOMAIN_NAME,
      projectDomainName: source[`${prefix}_PROJECT_DOMAIN_NAME`] ?? source.OPENSTACK_PROJECT_DOMAIN_NAME,
      staticToken: source[`${prefix}_API_TOKEN`] ?? source.OPENSTACK_API_TOKEN,
      computeUrl: provider.api_base_url ?? source[`${prefix}_API_URL`] ?? source.OPENSTACK_API_URL,
      imageUrl: source[`${prefix}_IMAGE_URL`] ?? source.OPENSTACK_IMAGE_URL,
      region: source[`${prefix}_REGION`] ?? source.OPENSTACK_REGION,
    };
  }

  /**
   * Built lazily so a misconfigured provider row surfaces as a ProviderError from an awaited
   * adapter call (which callers classify and log) rather than as a constructor throw.
   */
  private api(): OpenStackSession {
    if (this.session) return this.session;
    const { authUrl, username, password, projectId, projectName, staticToken, computeUrl } = this.settings;
    const hasPasswordLogin = Boolean(authUrl && username && password && (projectId || projectName));
    const hasTokenLogin = Boolean(staticToken && computeUrl);
    if (!hasPasswordLogin && !hasTokenLogin) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'OpenStack credentials are not configured (auth URL + username/password + project, or compute URL + API token)',
        false
      );
    }
    this.session = new OpenStackSession({
      ...this.settings,
      authUrl: authUrl ? requireSecureBaseUrl('OpenStack', authUrl) : '',
      computeUrl: computeUrl ? requireSecureBaseUrl('OpenStack', computeUrl) : undefined,
    });
    return this.session;
  }

  private async compute<T>(path: string, init: RequestInit = {}): Promise<T> {
    const session = this.api();
    return session.request<T>(`${await session.computeUrl()}${path}`, init);
  }

  async validateConfiguration(): Promise<void> {
    await this.compute('/servers?limit=1');
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const expected = idempotentResourceName(idempotencyKey);
    const result = await this.compute<{ servers?: NovaServer[] }>(`/servers/detail?name=${encodeURIComponent(expected)}`);
    const match = (result.servers ?? []).find(
      (server) => server.name === expected && (server.metadata?.[IDEMPOTENCY_METADATA_KEY] ?? idempotencyKey) === idempotencyKey
    );
    return match ? toServer(match) : null;
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const imageRef = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!imageRef) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no OpenStack image id', false);
    const flavorRef = requirePlanMetadataString(
      input.planMetadata,
      ['providerFlavorId', 'openstackFlavorId', 'flavorId'],
      'the OpenStack flavor id'
    );
    const networkId = planMetadataString(input.planMetadata, ['providerNetworkId', 'openstackNetworkId', 'networkId']);
    const keyName = planMetadataString(input.planMetadata, ['providerKeypairName', 'openstackKeypair']);
    const body = {
      server: {
        name: idempotentResourceName(input.idempotencyKey),
        imageRef,
        flavorRef,
        user_data: encodeUserData(input.userData),
        metadata: { [IDEMPOTENCY_METADATA_KEY]: input.idempotencyKey },
        availability_zone: input.datacenterCode ?? undefined,
        ...(networkId ? { networks: [{ uuid: networkId }] } : {}),
        ...(keyName ? { key_name: keyName } : {}),
      },
    };
    const result = await this.compute<{ server: NovaServer }>('/servers', { method: 'POST', body: JSON.stringify(body) });
    return toServer({ ...result.server, name: body.server.name, image: imageRef });
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    try {
      const result = await this.compute<{ server: NovaServer }>(`/servers/${encodeURIComponent(providerServerId)}`);
      return toServer(result.server);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        throw new ProviderError('RESOURCE_NOT_FOUND', 'OpenStack server no longer exists', false);
      }
      throw error;
    }
  }

  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async deleteServer(providerServerId: string): Promise<void> {
    await this.compute(`/servers/${encodeURIComponent(providerServerId)}`, { method: 'DELETE' });
  }

  private async action(providerServerId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.compute(`/servers/${encodeURIComponent(providerServerId)}/action`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async startServer(providerServerId: string): Promise<void> { await this.action(providerServerId, { 'os-start': null }); }
  async shutdownServer(providerServerId: string): Promise<void> { await this.action(providerServerId, { 'os-stop': null }); }
  async rebootServer(providerServerId: string): Promise<void> { await this.action(providerServerId, { reboot: { type: 'SOFT' } }); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    const flavorRef = requirePlanMetadataString(
      planMetadata,
      ['providerFlavorId', 'openstackFlavorId', 'flavorId'],
      'the target OpenStack flavor id'
    );
    await this.action(providerServerId, { resize: { flavorRef } });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    await this.action(providerServerId, { createImage: { name: description, metadata: {} } });
    return { requested: true, name: description };
  }

  async deleteSnapshot(_providerServerId: string, snapshotId: string): Promise<void> {
    const session = this.api();
    await session.request(`${await session.imageUrl()}/v2/images/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    await this.action(providerServerId, { rebuild: { imageRef: snapshotId } });
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const session = this.api();
    const result = await session.request<{ images?: Array<{ id: string; name?: string; status?: string; architecture?: string }> }>(
      `${await session.imageUrl()}/v2/images?limit=100`
    );
    return (result.images ?? []).map((image) => ({
      id: image.id,
      name: image.name ?? null,
      architecture: image.architecture === 'aarch64' ? 'arm64' : image.architecture === 'x86_64' ? 'x86_64' : null,
      available: image.status === 'active',
      metadata: {},
    }));
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_image_id ?? image.provider_template_id;
    if (!identifier) return null;
    const session = this.api();
    try {
      const remote = await session.request<{ id: string; name?: string; status?: string; architecture?: string }>(
        `${await session.imageUrl()}/v2/images/${encodeURIComponent(identifier)}`
      );
      return {
        id: remote.id,
        name: remote.name ?? null,
        architecture: remote.architecture === 'aarch64' ? 'arm64' : remote.architecture === 'x86_64' ? 'x86_64' : null,
        available: remote.status === 'active',
        metadata: {},
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const imageRef = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!imageRef) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no OpenStack image id', false);
    const current = await this.getServerStatus(input.providerServerId);
    if (input.isRetry && (current.imageId === imageRef || ['rebuild', 'build'].includes(current.status))) return current;
    await this.action(input.providerServerId, {
      rebuild: { imageRef, user_data: encodeUserData(input.userData), metadata: { [IDEMPOTENCY_METADATA_KEY]: input.idempotencyKey } },
    });
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * Nova rescue reboots the instance from a rescue image with the original disk attached as a
   * secondary volume. The generated admin password is returned once and is never stored here.
   */
  async enableRescue(providerServerId: string, _input: RescueRequest): Promise<RescueSession> {
    const result = asRecord(await this.action(providerServerId, { rescue: {} }));
    const password = typeof result.adminPass === 'string' && result.adminPass.length > 0 ? result.adminPass : undefined;
    return { type: 'nova-rescue', username: 'root', password, rebooted: true };
  }

  async disableRescue(providerServerId: string): Promise<void> {
    await this.action(providerServerId, { unrescue: null });
  }

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    const result = await this.compute<{ remote_console?: Record<string, unknown> }>(
      `/servers/${encodeURIComponent(providerServerId)}/remote-consoles`,
      { method: 'POST', body: JSON.stringify({ remote_console: { protocol: 'vnc', type: 'novnc' } }) }
    );
    return asRecord(result.remote_console);
  }

  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    try {
      return asRecord(await this.compute(`/servers/${encodeURIComponent(providerServerId)}/diagnostics`));
    } catch (error) {
      // Nova diagnostics are admin-scoped on most clouds; report honestly instead of inventing.
      if (error instanceof ProviderError && ['AUTHENTICATION_FAILED', 'RESOURCE_NOT_FOUND'].includes(error.code)) {
        throw new ProviderError('UNSUPPORTED_OPERATION', 'This OpenStack project may not read Nova diagnostics', false);
      }
      throw error;
    }
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage.provider_image_id ?? expectedImage.provider_template_id;
      return {
        exists: true,
        poweredOn: server.status === 'active',
        ipAddress: server.ipAddress,
        imageMatches: !expected || !server.imageId || server.imageId === expected,
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
