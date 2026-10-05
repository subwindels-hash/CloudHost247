/**
 * OVHcloud Public Cloud adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/ovh-adapter.ts. Native Public Cloud API
 * signed with the OVH consumer-key scheme (see ovh-client.js). Idempotency is the deterministic
 * instance name plus a lookup before create, because the API has no idempotency key.
 */
'use strict';

const { asRecord, ProviderError } = require('../types');
const {
  firstPublicIpv4,
  idempotentResourceName,
  imageIdentifier,
  planMetadataString,
  requirePlanMetadataString,
  requireSecureBaseUrl,
} = require('../common');
const { OvhClient } = require('./ovh-client');

const RUNNING_STATUSES = new Set(['ACTIVE', 'RESCUE', 'VERIFY_RESIZE']);

function toServer(instance) {
  const imageId = instance.imageId ?? instance.image?.id ?? null;
  return {
    id: String(instance.id),
    status: instance.status ?? 'unknown',
    name: instance.name ?? null,
    ipAddress: firstPublicIpv4(
      (instance.ipAddresses ?? []).filter((entry) => entry.version !== 6).map((entry) => entry.ip),
    ),
    imageId: imageId ? String(imageId) : null,
    metadata: {
      region: instance.region ?? null,
      flavorId: instance.flavorId ?? null,
      imageName: instance.image?.name ?? null,
    },
  };
}

function normalizeArchitecture(image) {
  const raw = image.propertiesArchitecture
    ?? (image.tags ?? []).find((tag) => /arm64|aarch64|x86_64|amd64/i.test(tag));
  if (!raw) return null;
  if (/arm64|aarch64/i.test(raw)) return 'arm64';
  if (/x86_64|amd64/i.test(raw)) return 'x86_64';
  return null;
}

class OvhProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'ovh';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || 'OVH';
    this.applicationKey = source[`${prefix}_APPLICATION_KEY`] ?? source.OVH_APPLICATION_KEY;
    this.applicationSecret = source[`${prefix}_APPLICATION_SECRET`] ?? source.OVH_APPLICATION_SECRET;
    this.consumerKey = source[`${prefix}_CONSUMER_KEY`] ?? source.OVH_CONSUMER_KEY;
    this.cloudProjectId = source[`${prefix}_CLOUD_PROJECT_ID`] ?? source.OVH_CLOUD_PROJECT_ID
      ?? (typeof provider.metadata?.cloudProjectId === 'string' ? provider.metadata.cloudProjectId : undefined);
    this.endpoint = provider.api_base_url ?? source[`${prefix}_API_ENDPOINT`] ?? source.OVH_API_ENDPOINT ?? null;
    this.client = null;
  }

  api() {
    if (this.client) return this.client;
    if (!this.applicationKey || !this.applicationSecret || !this.consumerKey) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'OVH application key, application secret and consumer key must be configured server-side',
        false,
      );
    }
    if (!this.cloudProjectId) {
      throw new ProviderError(
        'PROVIDER_NOT_CONFIGURED',
        'OVH Public Cloud project id (<PREFIX>_CLOUD_PROJECT_ID) is not configured',
        false,
      );
    }
    this.client = new OvhClient({
      endpoint: requireSecureBaseUrl('OVH', this.endpoint ?? 'https://eu.api.ovh.com/1.0'),
      applicationKey: this.applicationKey,
      applicationSecret: this.applicationSecret,
      consumerKey: this.consumerKey,
      cloudProjectId: this.cloudProjectId,
    }, { transport: this.transport });
    return this.client;
  }

  project() {
    return this.api().projectPath;
  }

  async validateConfiguration() {
    await this.api().request('GET', `${this.project()}/region`);
  }

  async createServer(input) {
    const client = this.api();
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const flavorId = requirePlanMetadataString(
      input.planMetadata,
      ['providerFlavorId', 'ovhFlavorId', 'flavorId'],
      'the OVH flavor identifier',
    );
    const imageId = imageIdentifier(input.image);
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no OVH image identifier', false);
    const body = {
      name: idempotentResourceName(input.idempotencyKey),
      flavorId,
      imageId,
      region: input.datacenterCode ?? input.regionCode,
      monthlyBilling: input.planMetadata.monthlyBilling === true,
      userData: input.userData,
    };
    const providerSshKeyId = planMetadataString(input.planMetadata, ['providerSshKeyId', 'ovhSshKeyId']);
    if (providerSshKeyId) body.sshKeyId = providerSshKeyId;
    return toServer(await client.request('POST', `${this.project()}/instance`, body));
  }

  provisionServer(input) { return this.createServer(input); }

  async findServerByIdempotencyKey(idempotencyKey) {
    const expected = idempotentResourceName(idempotencyKey);
    const instances = await this.api().request('GET', `${this.project()}/instance`);
    const match = (instances ?? []).find((instance) => instance.name === expected);
    return match ? toServer(match) : null;
  }

  async deleteServer(providerServerId) {
    await this.api().request('DELETE', `${this.project()}/instance/${encodeURIComponent(providerServerId)}`);
  }

  action(providerServerId, action, body) {
    return this.api().request(
      'POST',
      `${this.project()}/instance/${encodeURIComponent(providerServerId)}/${action}`,
      body,
    );
  }

  async rebootServer(providerServerId) { await this.action(providerServerId, 'reboot', { type: 'soft' }); }
  async shutdownServer(providerServerId) { await this.action(providerServerId, 'stop'); }
  async startServer(providerServerId) { await this.action(providerServerId, 'start'); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  getServer(id) { return this.getServerStatus(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId, planMetadata) {
    const flavorId = requirePlanMetadataString(
      planMetadata,
      ['providerFlavorId', 'ovhFlavorId', 'flavorId'],
      'the target OVH flavor identifier',
    );
    await this.action(providerServerId, 'resize', { flavorId });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId, description) {
    return asRecord(await this.action(providerServerId, 'snapshot', { snapshotName: description }));
  }

  async deleteSnapshot(_providerServerId, snapshotId) {
    await this.api().request('DELETE', `${this.project()}/snapshot/${encodeURIComponent(snapshotId)}`);
  }

  async restoreSnapshot(providerServerId, snapshotId) {
    await this.action(providerServerId, 'reinstall', { imageId: snapshotId });
  }

  async getServerStatus(providerServerId) {
    try {
      return toServer(
        await this.api().request('GET', `${this.project()}/instance/${encodeURIComponent(providerServerId)}`),
      );
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        throw new ProviderError('RESOURCE_NOT_FOUND', 'OVH instance no longer exists', false);
      }
      throw error;
    }
  }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages() {
    const images = await this.api().request('GET', `${this.project()}/image`);
    return (images ?? []).map((image) => ({
      id: String(image.id),
      name: image.name ?? null,
      architecture: normalizeArchitecture(image),
      available: (image.status ?? '').toLowerCase() === 'active',
      metadata: { region: image.region ?? null, visibility: image.visibility ?? null },
    }));
  }

  async getImage(image) {
    const identifier = imageIdentifier(image);
    if (!identifier) return null;
    try {
      const remote = await this.api().request('GET', `${this.project()}/image/${encodeURIComponent(identifier)}`);
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

  async reinstallServer(input) {
    const imageId = imageIdentifier(input.image);
    if (!imageId) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no OVH image identifier', false);
    const current = await this.getServerStatus(input.providerServerId);
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
  async enableRescue(providerServerId) {
    const instancePath = `${this.project()}/instance/${encodeURIComponent(providerServerId)}`;
    await this.api().request('POST', `${instancePath}/rescueMode`, { rescue: true });
    const instance = await this.api().request('GET', instancePath);
    const password = typeof instance.rescuePassword === 'string' && instance.rescuePassword.length > 0
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

  async disableRescue(providerServerId) {
    await this.api().request(
      'POST',
      `${this.project()}/instance/${encodeURIComponent(providerServerId)}/rescueMode`,
      { rescue: false },
    );
  }

  async getConsole(providerServerId) {
    return asRecord(await this.action(providerServerId, 'vnc'));
  }

  async getServerMetrics(providerServerId) {
    return asRecord(await this.api().request(
      'GET',
      `${this.project()}/instance/${encodeURIComponent(providerServerId)}/monitoring?period=lastday&type=cpu%3Aused`,
    ));
  }

  async healthCheck(providerServerId, expectedImage) {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = imageIdentifier(expectedImage);
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

module.exports = { OvhProviderAdapter, RUNNING_STATUSES };
