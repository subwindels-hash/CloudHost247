/**
 * OpenStack (Nova + Glance) adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/openstack-adapter.ts.
 *
 * Required configuration: either a static token plus a compute URL
 * (`<PREFIX>_API_TOKEN` + `<PREFIX>_API_URL`/provider api_base_url) or a password login
 * (`<PREFIX>_AUTH_URL` + `<PREFIX>_USERNAME` + `<PREFIX>_PASSWORD` + a project id or name).
 * Optional: `<PREFIX>_USER_DOMAIN_NAME`, `<PREFIX>_PROJECT_DOMAIN_NAME`, `<PREFIX>_IMAGE_URL`,
 * `<PREFIX>_REGION`.
 *
 * Idempotency: Nova has no idempotency key, so the server is created under a deterministic
 * `ch247-…` name carrying the job key in server metadata, and the project is searched for that name
 * before anything is created.
 */
'use strict';

const { asRecord, ProviderError } = require('../types');
const {
  encodeUserData,
  firstPublicIpv4,
  idempotentResourceName,
  planMetadataString,
  requirePlanMetadataString,
  requireSecureBaseUrl,
} = require('../common');
const { OpenStackSession } = require('./openstack-client');

const IDEMPOTENCY_METADATA_KEY = 'cloudhost247_idempotency';

function imageRefOf(image) {
  return image?.providerImageId ?? image?.provider_image_id
    ?? image?.providerTemplateId ?? image?.provider_template_id ?? null;
}

function normalizeArchitecture(value) {
  if (value === 'aarch64') return 'arm64';
  if (value === 'x86_64') return 'x86_64';
  return null;
}

function toServer(server) {
  const addresses = Object.values(server.addresses ?? {}).flat();
  const floating = addresses
    .filter((entry) => entry['OS-EXT-IPS:type'] === 'floating' && entry.version !== 6)
    .map((entry) => entry.addr);
  const fixed = addresses.filter((entry) => entry.version !== 6).map((entry) => entry.addr);
  const image = typeof server.image === 'string' ? server.image : server.image?.id ?? null;
  return {
    id: server.id,
    status: String(server.status ?? 'unknown').toLowerCase(),
    name: server.name ?? null,
    ipAddress: firstPublicIpv4([...floating, ...fixed]),
    imageId: image ? String(image) : null,
    metadata: { openstackMetadata: server.metadata ?? {} },
  };
}

function toImage(image) {
  return {
    id: image.id,
    name: image.name ?? null,
    architecture: normalizeArchitecture(image.architecture),
    available: image.status === 'active',
    metadata: {},
  };
}

class OpenStackProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'openstack';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
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
    this.session = null;
  }

  api() {
    if (this.session) return this.session;
    const { authUrl, username, password, projectId, projectName, staticToken, computeUrl, imageUrl } = this.settings;
    const hasPasswordLogin = Boolean(authUrl && username && password && (projectId || projectName));
    const hasTokenLogin = Boolean(staticToken && computeUrl);
    if (!hasPasswordLogin && !hasTokenLogin) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'OpenStack credentials are not configured (auth URL + username/password + project, or compute URL + API token)',
        false,
      );
    }
    this.session = new OpenStackSession({
      ...this.settings,
      authUrl: authUrl ? requireSecureBaseUrl('OpenStack', authUrl) : '',
      computeUrl: computeUrl ? requireSecureBaseUrl('OpenStack', computeUrl) : undefined,
      imageUrl: imageUrl ? requireSecureBaseUrl('OpenStack', imageUrl) : undefined,
    }, { transport: this.transport });
    return this.session;
  }

  async compute(path, init = {}) {
    const session = this.api();
    return session.request(`${await session.computeUrl()}${path}`, init);
  }

  async validateConfiguration() {
    await this.compute('/servers?limit=1');
  }

  async findServerByIdempotencyKey(idempotencyKey) {
    const expected = idempotentResourceName(idempotencyKey);
    const result = await this.compute(`/servers/detail?name=${encodeURIComponent(expected)}`);
    const match = (result?.servers ?? []).find(
      (server) => server.name === expected
        && (server.metadata?.[IDEMPOTENCY_METADATA_KEY] ?? idempotencyKey) === idempotencyKey,
    );
    return match ? toServer(match) : null;
  }

  async createServer(input) {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const imageRef = imageRefOf(input.image);
    if (!imageRef) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no OpenStack image id', false);
    const flavorRef = requirePlanMetadataString(
      input.planMetadata,
      ['providerFlavorId', 'openstackFlavorId', 'flavorId'],
      'the OpenStack flavor id',
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
    const result = await this.compute('/servers', { method: 'POST', body: JSON.stringify(body) });
    return toServer({ ...result.server, name: body.server.name, image: imageRef });
  }

  provisionServer(input) { return this.createServer(input); }

  async getServerStatus(providerServerId) {
    try {
      const result = await this.compute(`/servers/${encodeURIComponent(providerServerId)}`);
      return toServer(result.server);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        throw new ProviderError('RESOURCE_NOT_FOUND', 'OpenStack server no longer exists', false);
      }
      throw error;
    }
  }

  getServer(id) { return this.getServerStatus(id); }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async deleteServer(providerServerId) {
    await this.compute(`/servers/${encodeURIComponent(providerServerId)}`, { method: 'DELETE' });
  }

  async action(providerServerId, body) {
    return this.compute(`/servers/${encodeURIComponent(providerServerId)}/action`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async startServer(id) { await this.action(id, { 'os-start': null }); }
  async shutdownServer(id) { await this.action(id, { 'os-stop': null }); }
  async rebootServer(id) { await this.action(id, { reboot: { type: 'SOFT' } }); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId, planMetadata) {
    const flavorRef = requirePlanMetadataString(
      planMetadata,
      ['providerFlavorId', 'openstackFlavorId', 'flavorId'],
      'the target OpenStack flavor id',
    );
    await this.action(providerServerId, { resize: { flavorRef } });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId, description) {
    await this.action(providerServerId, { createImage: { name: description, metadata: {} } });
    return { requested: true, name: description };
  }

  async deleteSnapshot(_providerServerId, snapshotId) {
    const session = this.api();
    await session.request(`${await session.imageUrl()}/v2/images/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  async restoreSnapshot(providerServerId, snapshotId) {
    await this.action(providerServerId, { rebuild: { imageRef: snapshotId } });
  }

  async getAvailableImages() {
    const session = this.api();
    const result = await session.request(`${await session.imageUrl()}/v2/images?limit=100`);
    return (result?.images ?? []).map(toImage);
  }

  async getImage(image) {
    const identifier = imageRefOf(image);
    if (!identifier) return null;
    const session = this.api();
    try {
      return toImage(await session.request(`${await session.imageUrl()}/v2/images/${encodeURIComponent(identifier)}`));
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input) {
    const imageRef = imageRefOf(input.image);
    if (!imageRef) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no OpenStack image id', false);
    const current = await this.getServerStatus(input.providerServerId);
    if (input.isRetry && (current.imageId === imageRef || ['rebuild', 'build'].includes(current.status))) return current;
    await this.action(input.providerServerId, {
      rebuild: {
        imageRef,
        user_data: encodeUserData(input.userData),
        metadata: { [IDEMPOTENCY_METADATA_KEY]: input.idempotencyKey },
      },
    });
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * Nova's rescue action boots the server into the rescue image; the API may answer with the
   * one-time `adminPass` for the rescue instance. No rescue image id is required here — Nova uses
   * the project's configured rescue image.
   */
  async enableRescue(providerServerId) {
    const result = asRecord(await this.action(providerServerId, { rescue: {} }));
    const password = typeof result.adminPass === 'string' && result.adminPass.length > 0 ? result.adminPass : undefined;
    return { type: 'nova-rescue', username: 'root', password, rebooted: true };
  }

  async disableRescue(providerServerId) {
    await this.action(providerServerId, { unrescue: null });
  }

  async getConsole(providerServerId) {
    const result = await this.compute(
      `/servers/${encodeURIComponent(providerServerId)}/remote-consoles`,
      { method: 'POST', body: JSON.stringify({ remote_console: { protocol: 'vnc', type: 'novnc' } }) },
    );
    return asRecord(result.remote_console);
  }

  /**
   * Nova diagnostics are policy-gated: a project that may not read them answers 403/404 rather than
   * an empty document, so the adapter reports the capability as unsupported instead of pretending
   * the instance has no metrics.
   */
  async getServerMetrics(providerServerId) {
    try {
      return asRecord(await this.compute(`/servers/${encodeURIComponent(providerServerId)}/diagnostics`));
    } catch (error) {
      if (error instanceof ProviderError && ['AUTHENTICATION_FAILED', 'RESOURCE_NOT_FOUND'].includes(error.code)) {
        throw new ProviderError('UNSUPPORTED_OPERATION', 'This OpenStack project may not read Nova diagnostics', false);
      }
      throw error;
    }
  }

  async healthCheck(providerServerId, expectedImage) {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = imageRefOf(expectedImage);
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

module.exports = { OpenStackProviderAdapter, IDEMPOTENCY_METADATA_KEY };
