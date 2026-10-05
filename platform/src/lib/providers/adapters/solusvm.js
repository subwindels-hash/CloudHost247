/**
 * SolusVM 1 (admin API) adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/solusvm-adapter.ts.
 *
 * Required configuration: `<PREFIX>_API_ID`, `<PREFIX>_API_KEY`, `<PREFIX>_API_URL` (or the provider
 * api_base_url). SolusVM accepts one POST form endpoint and credentials are form fields, never query
 * strings. Idempotency is the deterministic hostname plus a lookup before `vserver-create`, because
 * the API has no idempotency key.
 *
 * Two capabilities are refused by name rather than faked: snapshots (Admin API v1 exposes none) and
 * arm64 rescue (SolusVM offers only x86 rescue kernels: 4.x 64-bit, 3.x 64-bit, 3.x 32-bit).
 */
'use strict';

const { providerRequest } = require('../http');
const { asRecord, ProviderError } = require('../types');
const {
  firstPublicIpv4,
  idempotentResourceName,
  imageIdentifier,
  planMetadataNumber,
  planMetadataString,
  requirePlanMetadataString,
  requireSecureBaseUrl,
} = require('../common');

const NO_SNAPSHOTS = 'SolusVM 1 does not expose snapshots through the admin API';

class SolusvmProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'solusvm';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || 'SOLUSVM';
    this.apiId = source[`${prefix}_API_ID`] ?? source.SOLUSVM_API_ID;
    this.apiKey = source[`${prefix}_API_KEY`] ?? source[`${prefix}_API_TOKEN`]
      ?? source.SOLUSVM_API_KEY ?? source.SOLUSVM_API_TOKEN;
    this.baseUrl = provider.api_base_url ?? source[`${prefix}_API_URL`] ?? source.SOLUSVM_API_URL ?? null;
  }

  credentials() {
    if (!this.apiId || !this.apiKey) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'SolusVM admin API id and key are not configured', false);
    }
    return { id: this.apiId, key: this.apiKey, base: requireSecureBaseUrl('SolusVM', this.baseUrl) };
  }

  async call(action, params = {}) {
    const { id, key, base } = this.credentials();
    const form = new URLSearchParams({ id, key, action, rdtype: 'json' });
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) form.set(name, String(value));
    }
    const response = await providerRequest(`${base}/api/admin/command.php`, {
      method: 'POST',
      body: form.toString(),
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      transport: this.transport,
    });
    if (response?.status === 'error') {
      const message = String(response.statusmsg ?? 'SolusVM returned an error');
      const authFailure = /api|access|key|id/i.test(message) && /invalid|denied|not allowed/i.test(message);
      const missing = /does not exist|not found|no such/i.test(message);
      throw new ProviderError(
        authFailure ? 'AUTHENTICATION_FAILED' : (missing ? 'RESOURCE_NOT_FOUND' : 'PROVIDER_ERROR'),
        `SolusVM: ${message}`,
        false,
        { statusmsg: message },
      );
    }
    return response ?? {};
  }

  toServer(response, fallbackId) {
    const addresses = String(response.ipaddresses ?? response.ipaddress ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const state = String(response.vmstat ?? response.state ?? '').toLowerCase();
    return {
      id: String(response.vserverid ?? fallbackId ?? ''),
      status: state === 'online' ? 'running' : state === 'offline' ? 'stopped' : (state || 'unknown'),
      name: response.hostname ? String(response.hostname) : null,
      ipAddress: firstPublicIpv4(addresses),
      imageId: response.template ? String(response.template) : null,
      metadata: { node: response.node ?? null, type: response.type ?? null },
    };
  }

  defaultVirtType() {
    const configured = this.provider.metadata?.virtType;
    return typeof configured === 'string' && configured.length > 0 ? configured : 'kvm';
  }

  async validateConfiguration() {
    await this.call('node-idlist', { type: this.defaultVirtType() });
  }

  async findServerByIdempotencyKey(idempotencyKey) {
    const hostname = idempotentResourceName(idempotencyKey, 48);
    try {
      const response = await this.call('vserver-infoall', { hostname });
      if (!response.vserverid) return null;
      return this.toServer(response);
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async createServer(input) {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const template = imageIdentifier(input.image);
    if (!template) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no SolusVM template', false);
    const hostname = idempotentResourceName(input.idempotencyKey, 48);
    const virtType = requirePlanMetadataString(
      input.planMetadata,
      ['providerVirtType', 'solusvmVirtType', 'virtType'],
      'the SolusVM virtualization type',
    );
    const username = requirePlanMetadataString(
      input.planMetadata,
      ['providerClientId', 'solusvmUsername', 'username'],
      'the SolusVM account that must own the server',
    );
    const plan = requirePlanMetadataString(
      input.planMetadata,
      ['providerPlanId', 'solusvmPlan', 'plan'],
      'the SolusVM plan',
    );
    const node = planMetadataString(input.planMetadata, ['providerNode', 'solusvmNode', 'node']);
    const nodeGroup = planMetadataString(input.planMetadata, ['providerNodeGroup', 'solusvmNodeGroup']);
    const response = await this.call('vserver-create', {
      type: virtType,
      username,
      hostname,
      password: undefined,
      plan,
      template,
      ips: planMetadataNumber(input.planMetadata, ['ipv4Count']) ?? 1,
      ...(node ? { node } : {}),
      ...(nodeGroup ? { nodegroup: nodeGroup } : {}),
      custom_userdata: input.userData,
      sshkey: input.sshPublicKeys.join('\n'),
    });
    if (!response.vserverid) {
      const created = await this.findServerByIdempotencyKey(input.idempotencyKey);
      if (created) return created;
      throw new ProviderError('PROVIDER_ERROR', 'SolusVM did not return a vserverid for the created server', true, response);
    }
    return this.toServer(response);
  }

  provisionServer(input) { return this.createServer(input); }

  async getServerStatus(providerServerId) {
    const response = await this.call('vserver-infoall', { vserverid: providerServerId });
    if (!response.vserverid && !response.hostname) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'SolusVM server no longer exists', false);
    }
    return this.toServer(response, providerServerId);
  }

  getServer(id) { return this.getServerStatus(id); }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async deleteServer(providerServerId) {
    await this.call('vserver-terminate', { vserverid: providerServerId, deleteclient: 'false' });
  }

  async startServer(providerServerId) { await this.call('vserver-boot', { vserverid: providerServerId }); }
  async shutdownServer(providerServerId) { await this.call('vserver-shutdown', { vserverid: providerServerId }); }
  async rebootServer(providerServerId) { await this.call('vserver-reboot', { vserverid: providerServerId }); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId, planMetadata) {
    const plan = planMetadataString(planMetadata, ['providerPlanId', 'solusvmPlan', 'plan']);
    if (!plan) throw new ProviderError('INVALID_CONFIGURATION', 'Target plan metadata has no SolusVM plan for resize', false);
    await this.call('vserver-change', { vserverid: providerServerId, plan });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot() { throw new ProviderError('UNSUPPORTED_OPERATION', NO_SNAPSHOTS, false); }
  async deleteSnapshot() { throw new ProviderError('UNSUPPORTED_OPERATION', NO_SNAPSHOTS, false); }
  async restoreSnapshot() { throw new ProviderError('UNSUPPORTED_OPERATION', NO_SNAPSHOTS, false); }

  async getAvailableImages() {
    const response = await this.call('listtemplates', { type: this.defaultVirtType() });
    return String(response.templates ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((template) => ({
        id: template,
        name: template,
        architecture: /x86_64|amd64|64/.test(template) ? 'x86_64' : (/arm64|aarch64/.test(template) ? 'arm64' : null),
        available: true,
        metadata: {},
      }));
  }

  async getImage(image) {
    const identifier = imageIdentifier(image);
    if (!identifier) return null;
    const images = await this.getAvailableImages();
    return images.find((entry) => entry.id === identifier) ?? null;
  }

  async reinstallServer(input) {
    const template = imageIdentifier(input.image);
    if (!template) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no SolusVM template', false);
    const current = await this.getServerStatus(input.providerServerId);
    if (input.isRetry && current.imageId === template) return current;
    await this.call('vserver-rebuild', { vserverid: input.providerServerId, template });
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * SolusVM's `vserver-rescue` action (documented at docs.solusvm.com). `rescueenable` selects the
   * rescue kernel: 1 = 4.x 64-bit, 2 = 3.x 64-bit, 3 = 3.x 32-bit. All are x86, so an arm64 server
   * has no rescue system to boot into and this refuses instead of booting the wrong architecture.
   *
   * Enabling rescue reboots the virtual server (SolusVM states this for the same operation in the
   * admin panel), so `rebooted: true` is a fact about the call. The returned password is a one-time
   * credential: handed to the requester and never stored.
   */
  async enableRescue(providerServerId, input) {
    if (input.architecture !== 'x86_64') {
      throw new ProviderError(
        'UNSUPPORTED_OPERATION',
        'SolusVM offers only x86 rescue kernels (4.x 64-bit, 3.x 64-bit, 3.x 32-bit); there is no arm64 rescue system to boot',
        false,
      );
    }
    const response = await this.call('vserver-rescue', { vserverid: providerServerId, rescueenable: 1 });
    const user = typeof response.user === 'string' && response.user.length > 0 ? response.user : null;
    if (!user) {
      throw new ProviderError('PROVIDER_ERROR', 'SolusVM accepted the rescue request but returned no rescue login user', false);
    }
    const password = typeof response.password === 'string' && response.password.length > 0 ? response.password : undefined;
    const port = response.port !== undefined && response.port !== null ? String(response.port) : null;
    const ip = typeof response.ip === 'string' && response.ip.length > 0 ? response.ip : null;
    const access = [ip ? `ip ${ip}` : null, port ? `port ${port}` : null].filter(Boolean).join(', ');
    return {
      type: '4.x kernel 64bit',
      username: user,
      password,
      rebooted: true,
      notes: `SolusVM rebooted the server into its rescue system${access ? ` (${access})` : ''}. The next restart boots the installed operating system again.`,
    };
  }

  async disableRescue(providerServerId) {
    await this.call('vserver-rescue', { vserverid: providerServerId, rescuedisable: 'true' });
  }

  async getConsole(providerServerId) {
    return asRecord(await this.call('vserver-console', { vserverid: providerServerId, access: 'enable', time: 2 }));
  }

  async getServerMetrics(providerServerId) {
    return asRecord(await this.call('vserver-status', { vserverid: providerServerId }));
  }

  async healthCheck(providerServerId, expectedImage) {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = imageIdentifier(expectedImage);
      return {
        exists: true,
        poweredOn: server.status === 'running',
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

module.exports = { SolusvmProviderAdapter };
