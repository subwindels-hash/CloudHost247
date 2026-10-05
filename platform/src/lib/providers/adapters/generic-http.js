/**
 * Adapter for an operator-owned provider bridge implementing the documented CloudHost247 provider
 * contract.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/generic-http-adapter.ts. This is not a
 * mock: every success comes from the configured remote endpoint. If the URL or bearer token is
 * absent it fails closed with PROVIDER_NOT_CONFIGURED.
 *
 * An unconfigured base URL (`provider.api_base_url` null) and an unparsable one are both refused by
 * requireSecureBaseUrl, so a bridge can never be reached over plaintext by accident.
 */
'use strict';

const { providerRequest } = require('../http');
const { asRecord, ProviderError } = require('../types');
const { imageIdentifier, requireSecureBaseUrl } = require('../common');

class GenericHttpProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = provider.adapter;
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || String(provider.slug ?? '').replace(/-/g, '_').toUpperCase();
    this.token = source[`${prefix}_API_TOKEN`];
    this.baseUrl = provider.api_base_url ? String(provider.api_base_url).replace(/\/$/, '') : null;
  }

  async request(path, init = {}) {
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', `${this.provider.name} API token is not configured`, false);
    }
    const baseUrl = requireSecureBaseUrl(this.provider.name, this.baseUrl);
    return providerRequest(`${baseUrl}${path}`, init, {
      headers: { Authorization: `Bearer ${this.token}` },
      transport: this.transport,
    });
  }

  validateConfiguration() { return this.request('/v1/health'); }

  async createServer(input) {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    return this.request('/v1/servers', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: input.idempotencyKey,
        name: input.name,
        hostname: input.hostname,
        architecture: input.architecture,
        imageId: imageIdentifier(input.image),
        region: input.regionCode,
        datacenter: input.datacenterCode,
        plan: input.planMetadata,
        sshPublicKeys: input.sshPublicKeys,
        userData: input.userData,
      }),
    });
  }

  provisionServer(input) { return this.createServer(input); }

  async findServerByIdempotencyKey(key) {
    try {
      return await this.request(`/v1/servers/by-idempotency/${encodeURIComponent(key)}`);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async deleteServer(id) { await this.request(`/v1/servers/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  async action(id, action, body) {
    await this.request(`/v1/servers/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });
  }

  rebootServer(id) { return this.action(id, 'reboot'); }
  shutdownServer(id) { return this.action(id, 'shutdown'); }
  startServer(id) { return this.action(id, 'start'); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  getServer(id) { return this.getServerStatus(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(id, planMetadata) {
    await this.action(id, 'resize', { plan: planMetadata });
    return this.getServerStatus(id);
  }

  async createSnapshot(id, description) {
    return asRecord(await this.request(`/v1/servers/${encodeURIComponent(id)}/snapshots`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }));
  }

  async deleteSnapshot(id, snapshotId) {
    await this.request(`/v1/servers/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}`, {
      method: 'DELETE',
    });
  }

  async restoreSnapshot(id, snapshotId) { await this.action(id, 'restore-snapshot', { snapshotId }); }

  getServerStatus(id) { return this.request(`/v1/servers/${encodeURIComponent(id)}`); }

  async getServerIP(id) { return (await this.getServerStatus(id)).ipAddress; }

  getAvailableImages() { return this.request('/v1/images'); }

  async getImage(image) {
    const id = imageIdentifier(image);
    if (!id) return null;
    try {
      return await this.request(`/v1/images/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input) {
    await this.action(input.providerServerId, 'reinstall', {
      idempotencyKey: input.idempotencyKey,
      isRetry: input.isRetry,
      imageId: imageIdentifier(input.image),
      architecture: input.architecture,
      hostname: input.hostname,
      sshPublicKeys: input.sshPublicKeys,
      userData: input.userData,
    });
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * Enters rescue mode through the operator's bridge, on the same `POST /v1/servers/{id}/{action}`
   * contract the bridge already implements for reboot/shutdown/start/resize/reinstall.
   *
   * The session is taken from the bridge's response rather than assembled here, because the rescue
   * system's name, login and one-time password are the provider's to state. `rebooted` defaults to
   * false: claiming a reboot the bridge did not report would be a lie about the server's state.
   */
  async enableRescue(id, input) {
    const result = asRecord(await this.request(`/v1/servers/${encodeURIComponent(id)}/rescue`, {
      method: 'POST',
      body: JSON.stringify({
        architecture: input.architecture,
        providerSshKeyIds: input.providerSshKeyIds,
      }),
    }));
    const type = typeof result.type === 'string' ? result.type : null;
    const username = typeof result.username === 'string' ? result.username : null;
    if (!type || !username) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        `${this.provider.name} accepted the rescue request but returned no rescue system or login user`,
        false,
      );
    }
    const password = typeof result.password === 'string' && result.password.length > 0 ? result.password : undefined;
    return {
      type,
      username,
      password,
      rebooted: result.rebooted === true,
      notes: typeof result.notes === 'string' ? result.notes : undefined,
    };
  }

  /** Leaves rescue mode through the bridge. */
  async disableRescue(id) { await this.action(id, 'unrescue'); }

  async getConsole(id) { return asRecord(await this.request(`/v1/servers/${encodeURIComponent(id)}/console`)); }

  async getServerMetrics(id) { return asRecord(await this.request(`/v1/servers/${encodeURIComponent(id)}/metrics`)); }

  healthCheck(id, image) {
    const expectedImageId = imageIdentifier(image);
    return this.request(
      `/v1/servers/${encodeURIComponent(id)}/health?expectedImageId=${encodeURIComponent(expectedImageId ?? '')}`,
    );
  }
}

module.exports = { GenericHttpProviderAdapter };
