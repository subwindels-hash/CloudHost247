/**
 * Hetzner Cloud adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/hetzner-adapter.ts. Native API:
 * idempotency uses the `cloudhost247_idempotency` label plus a lookup before create, and the
 * rescue password Hetzner returns exactly once is handed straight back to the caller — never
 * stored, logged or audited.
 */
'use strict';

const { providerRequest } = require('../http');
const { asRecord, asString, ProviderError } = require('../types');
const { imageIdentifier } = require('../common');

function normalizeArchitecture(value) {
  if (value === 'x86') return 'x86_64';
  if (value === 'arm') return 'arm64';
  return value ?? null;
}

function toServer(server) {
  return {
    id: String(server.id),
    status: server.status ?? 'unknown',
    name: server.name ?? null,
    ipAddress: server.public_net?.ipv4?.ip ?? server.public_net?.ipv6?.ip ?? null,
    imageId: server.image?.id ? String(server.image.id) : (server.image?.name ?? null),
    metadata: { labels: server.labels ?? {}, imageName: server.image?.name ?? null },
  };
}

class HetznerProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'hetzner';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || 'HETZNER';
    this.token = source[`${prefix}_API_TOKEN`] ?? source.HETZNER_API_TOKEN;
    this.baseUrl = String(provider.api_base_url ?? source.HETZNER_API_URL ?? 'https://api.hetzner.cloud/v1').replace(/\/$/, '');
  }

  headers() {
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Hetzner API token is not configured', false);
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  request(path, init = {}) {
    return providerRequest(`${this.baseUrl}${path}`, init, { headers: this.headers(), transport: this.transport });
  }

  async validateConfiguration() {
    await this.request('/servers?per_page=1');
  }

  async createServer(input) {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const serverType = asString(input.planMetadata.providerServerType)
      ?? asString(input.planMetadata.serverType)
      ?? asString(input.planMetadata.hetznerServerType);
    if (!serverType) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Product configuration is missing providerServerType', false);
    }
    const image = imageIdentifier(input.image);
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Hetzner image identifier', false);
    const body = {
      name: input.name,
      server_type: serverType,
      image,
      user_data: input.userData,
      labels: { cloudhost247_idempotency: input.idempotencyKey },
      start_after_create: true,
    };
    if (input.datacenterCode) body.datacenter = input.datacenterCode;
    else body.location = input.regionCode;
    const providerSshKeys = Array.isArray(input.planMetadata.providerSshKeyIds) ? input.planMetadata.providerSshKeyIds : [];
    if (providerSshKeys.length > 0) body.ssh_keys = providerSshKeys;
    const result = await this.request('/servers', { method: 'POST', body: JSON.stringify(body) });
    return toServer(result.server);
  }

  provisionServer(input) {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(idempotencyKey) {
    const query = encodeURIComponent(`cloudhost247_idempotency=${idempotencyKey}`);
    const result = await this.request(`/servers?label_selector=${query}&per_page=1`);
    const server = result.servers?.[0];
    return server ? toServer(server) : null;
  }

  async deleteServer(providerServerId) {
    await this.request(`/servers/${encodeURIComponent(providerServerId)}`, { method: 'DELETE' });
  }

  async action(providerServerId, action, body) {
    await this.request(`/servers/${encodeURIComponent(providerServerId)}/actions/${action}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  rebootServer(id) { return this.action(id, 'reboot'); }
  shutdownServer(id) { return this.action(id, 'shutdown'); }
  startServer(id) { return this.action(id, 'poweron'); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  getServer(id) { return this.getServerStatus(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId, planMetadata) {
    const serverType = asString(planMetadata.providerServerType)
      ?? asString(planMetadata.serverType)
      ?? asString(planMetadata.hetznerServerType);
    if (!serverType) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Target plan is missing providerServerType for resize', false);
    }
    await this.action(providerServerId, 'change_type', { server_type: serverType, upgrade_disk: true });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId, description) {
    const result = await this.request(
      `/servers/${encodeURIComponent(providerServerId)}/actions/create_image`,
      { method: 'POST', body: JSON.stringify({ type: 'snapshot', description }) },
    );
    return asRecord(result.image ?? result.action);
  }

  async deleteSnapshot(_providerServerId, snapshotId) {
    await this.request(`/images/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  async restoreSnapshot(providerServerId, snapshotId) {
    await this.action(providerServerId, 'rebuild', { image: snapshotId });
  }

  async getServerStatus(providerServerId) {
    try {
      const result = await this.request(`/servers/${encodeURIComponent(providerServerId)}`);
      return toServer(result.server);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        throw new ProviderError('RESOURCE_NOT_FOUND', 'Provider server no longer exists', false);
      }
      throw error;
    }
  }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages() {
    const result = await this.request('/images?type=system&per_page=50');
    return (result.images ?? []).map((image) => ({
      id: String(image.id),
      name: image.name ?? null,
      architecture: normalizeArchitecture(image.architecture),
      available: image.status === 'available' && !image.deprecated,
      metadata: {},
    }));
  }

  async getImage(image) {
    const identifier = imageIdentifier(image);
    if (!identifier) return null;
    try {
      if (/^\d+$/.test(identifier)) {
        const result = await this.request(`/images/${identifier}`);
        return {
          id: String(result.image.id),
          name: result.image.name ?? null,
          architecture: normalizeArchitecture(result.image.architecture),
          available: result.image.status === 'available' && !result.image.deprecated,
          metadata: {},
        };
      }
      const result = await this.request(`/images?name=${encodeURIComponent(identifier)}&per_page=1`);
      const found = result.images?.[0];
      return found ? {
        id: String(found.id),
        name: found.name ?? null,
        architecture: normalizeArchitecture(found.architecture),
        available: found.status === 'available' && !found.deprecated,
        metadata: {},
      } : null;
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input) {
    const image = imageIdentifier(input.image);
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Hetzner image identifier', false);
    const current = await this.getServerStatus(input.providerServerId);
    const alreadyTarget = current.imageId === String(image) || current.metadata.imageName === image;
    if (input.isRetry && (alreadyTarget || ['rebuilding', 'initializing', 'starting'].includes(current.status))) return current;
    try {
      await this.action(input.providerServerId, 'rebuild', { image });
    } catch (error) {
      const status = error instanceof ProviderError && error.providerResponse && typeof error.providerResponse === 'object'
        ? error.providerResponse.status
        : undefined;
      if (status !== 409) throw error;
    }
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * Hetzner boots a separate rescue image that replaces the running system until the next reset.
   * The API returns a root password exactly once; it is handed straight back to the caller and
   * never persisted here. Project SSH keys from the template are injected as well, so an operator
   * who configured them does not depend on the password at all.
   */
  async enableRescue(providerServerId, input) {
    const body = { type: 'linux64' };
    if (input.providerSshKeyIds?.length) body.ssh_keys = input.providerSshKeyIds;
    const result = await this.request(
      `/servers/${encodeURIComponent(providerServerId)}/actions/enable_rescue`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    await this.action(providerServerId, 'reset');
    return {
      type: 'linux64',
      username: 'root',
      password: typeof result.root_password === 'string' && result.root_password.length > 0 ? result.root_password : undefined,
      rebooted: true,
    };
  }

  async disableRescue(providerServerId) {
    await this.action(providerServerId, 'disable_rescue');
    await this.action(providerServerId, 'reset');
  }

  async getConsole(providerServerId) {
    const result = await this.request(
      `/servers/${encodeURIComponent(providerServerId)}/actions/request_console`,
      { method: 'POST' },
    );
    return asRecord(result);
  }

  async getServerMetrics(providerServerId) {
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60_000);
    return asRecord(await this.request(
      `/servers/${encodeURIComponent(providerServerId)}/metrics?type=cpu,disk,network`
      + `&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
    ));
  }

  async healthCheck(providerServerId, expectedImage) {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = imageIdentifier(expectedImage);
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

module.exports = { HetznerProviderAdapter };
