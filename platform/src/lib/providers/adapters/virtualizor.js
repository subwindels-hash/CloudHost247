/**
 * Virtualizor (Admin API) adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/virtualizor-adapter.ts.
 *
 * Required configuration: `<PREFIX>_API_URL` (https URL of the admin panel, or the provider
 * api_base_url), `<PREFIX>_API_KEY`, `<PREFIX>_API_SECRET`. Product metadata supplies the
 * virtualization type, resources, and either providerNode or providerNodeGroup; the OS image
 * mapping carries the Virtualizor `osid` in provider_template_id (or provider_image_id).
 *
 * Virtualizor has no idempotency header, so each VPS is created with a deterministic name derived
 * from the job idempotency key and the panel is always searched for that name before `addvs`.
 * Credentials are sent as POST form fields so they never appear in a URL, proxy log or error
 * message.
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
  unsupportedRescue,
} = require('../common');

function toRecordList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function ipList(vps) {
  if (Array.isArray(vps.ips)) return vps.ips;
  if (vps.ips && typeof vps.ips === 'object') return Object.values(vps.ips);
  return [];
}

function toServer(vps) {
  const status = String(vps.status ?? '');
  return {
    id: String(vps.vpsid ?? ''),
    status: status === '1' ? 'running' : status === '0' ? 'stopped' : (status || 'unknown'),
    name: vps.vps_name ?? vps.hostname ?? null,
    ipAddress: firstPublicIpv4(ipList(vps)),
    imageId: vps.osid !== undefined ? String(vps.osid) : null,
    metadata: { hostname: vps.hostname ?? null, osName: vps.os_name ?? null },
  };
}

class VirtualizorProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'virtualizor';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || 'VIRTUALIZOR';
    this.apiKey = source[`${prefix}_API_KEY`] ?? source.VIRTUALIZOR_API_KEY;
    this.apiSecret = source[`${prefix}_API_SECRET`] ?? source.VIRTUALIZOR_API_SECRET;
    this.baseUrl = provider.api_base_url ?? source[`${prefix}_API_URL`] ?? source.VIRTUALIZOR_API_URL ?? null;
  }

  credentials() {
    if (!this.apiKey || !this.apiSecret) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Virtualizor API key and API password are not configured', false);
    }
    return { key: this.apiKey, secret: this.apiSecret, base: requireSecureBaseUrl('Virtualizor', this.baseUrl) };
  }

  /** Every Virtualizor call is `index.php?act=<action>&api=json` plus the admin credentials. */
  async call(act, params = {}, body = {}) {
    const { key, secret, base } = this.credentials();
    const query = new URLSearchParams({ act, api: 'json' });
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(name, String(value));
    }
    const form = new URLSearchParams({ apikey: key, apipass: secret });
    for (const [name, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) form.set(name, String(value));
    }
    const response = await providerRequest(
      `${base}/index.php?${query.toString()}`,
      { method: 'POST', body: form.toString() },
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        transport: this.transport,
      },
    );
    const error = response?.error;
    if (error && (typeof error !== 'object' || Object.keys(error).length > 0)) {
      const message = typeof error === 'string' ? error : JSON.stringify(error).slice(0, 400);
      const authFailure = /login|auth|api key|apikey|password/i.test(message);
      throw new ProviderError(
        authFailure ? 'AUTHENTICATION_FAILED' : 'PROVIDER_ERROR',
        `Virtualizor rejected the request: ${message}`,
        false,
        { error },
      );
    }
    return response;
  }

  async validateConfiguration() {
    await this.call('listvs', { page: 1, reslen: 1 });
  }

  async searchByName(name) {
    const result = await this.call('listvs', { vpsname: name, reslen: 50 });
    const matches = toRecordList(result?.vs);
    return matches.find((vps) => vps.vps_name === name || vps.hostname === name) ?? null;
  }

  async findServerByIdempotencyKey(idempotencyKey) {
    const expected = idempotentResourceName(idempotencyKey, 48);
    const match = await this.searchByName(expected);
    return match ? toServer(match) : null;
  }

  async createServer(input) {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const osid = imageIdentifier(input.image);
    if (!osid) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no Virtualizor osid', false);
    const virtType = requirePlanMetadataString(
      input.planMetadata,
      ['providerVirtType', 'virtualizorVirtType', 'virt'],
      'the Virtualizor virtualization type',
    );
    const name = idempotentResourceName(input.idempotencyKey, 48);
    const serverId = planMetadataString(input.planMetadata, ['providerNode', 'virtualizorServerId', 'serverid']);
    const nodeGroup = planMetadataString(input.planMetadata, ['providerNodeGroup', 'virtualizorNodeGroup']);
    if (!serverId && !nodeGroup) {
      throw new ProviderError(
        'INVALID_CONFIGURATION',
        'Product configuration metadata is missing providerNode or providerNodeGroup',
        false,
      );
    }
    const storageMb = planMetadataNumber(input.planMetadata, ['storageMb']);
    const response = await this.call('addvs', {}, {
      addvps: 1,
      virt: virtType,
      ...(serverId ? { serid: serverId } : {}),
      ...(nodeGroup ? { server_group: nodeGroup } : {}),
      node_select: serverId ? 0 : 1,
      hostname: name,
      vps_name: name,
      osid,
      uid: planMetadataString(input.planMetadata, ['providerUserId', 'virtualizorUserId']) ?? undefined,
      plid: planMetadataString(input.planMetadata, ['providerPlanId', 'virtualizorPlanId']) ?? undefined,
      space: Math.max(1, Math.round((storageMb ?? 20480) / 1024)),
      ram: planMetadataNumber(input.planMetadata, ['memoryMb', 'ram']) ?? 1024,
      cores: planMetadataNumber(input.planMetadata, ['cpuCores', 'cores']) ?? 1,
      bandwidth: planMetadataNumber(input.planMetadata, ['bandwidthGb', 'bandwidth']) ?? 0,
      ips: 1,
      cloudinit: 1,
      sshkey: input.sshPublicKeys.join('\n'),
      user_data: input.userData,
    });
    const vpsId = response.vpsid ?? asRecord(response.vs).vpsid;
    if (!vpsId) {
      const created = await this.searchByName(name);
      if (created) return toServer(created);
      throw new ProviderError('PROVIDER_ERROR', 'Virtualizor did not return a VPS id for the created server', true, response);
    }
    const created = await this.searchByName(name);
    return created
      ? toServer(created)
      : { id: String(vpsId), status: 'unknown', name, ipAddress: null, imageId: String(osid), metadata: {} };
  }

  provisionServer(input) { return this.createServer(input); }

  async getServerStatus(providerServerId) {
    const result = await this.call('listvs', { vpsid: providerServerId });
    const match = toRecordList(result?.vs).find((vps) => String(vps.vpsid) === String(providerServerId));
    if (!match) throw new ProviderError('RESOURCE_NOT_FOUND', 'Virtualizor VPS no longer exists', false);
    return toServer(match);
  }

  getServer(id) { return this.getServerStatus(id); }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async deleteServer(providerServerId) { await this.call('vs', { delete: providerServerId }); }
  async startServer(providerServerId) { await this.call('start', { vpsid: providerServerId }); }
  async shutdownServer(providerServerId) { await this.call('stop', { vpsid: providerServerId }); }
  async rebootServer(providerServerId) { await this.call('restart', { vpsid: providerServerId }); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId, planMetadata) {
    const storageMb = planMetadataNumber(planMetadata, ['storageMb']);
    await this.call('managevps', { vpsid: providerServerId }, {
      editvps: 1,
      vpsid: providerServerId,
      ram: planMetadataNumber(planMetadata, ['memoryMb', 'ram']) ?? undefined,
      cores: planMetadataNumber(planMetadata, ['cpuCores', 'cores']) ?? undefined,
      space: storageMb ? Math.max(1, Math.round(storageMb / 1024)) : undefined,
    });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId, description) {
    return asRecord(await this.call('vpsbackups', { vpsid: providerServerId }, { createbackup: 1, description }));
  }

  async deleteSnapshot(providerServerId, snapshotId) {
    await this.call('vpsbackups', { vpsid: providerServerId }, { delete: snapshotId });
  }

  async restoreSnapshot(providerServerId, snapshotId) {
    await this.call('vpsbackups', { vpsid: providerServerId }, { restore: snapshotId });
  }

  async getAvailableImages() {
    const result = await this.call('ostemplates');
    const images = [];
    for (const group of Object.values(result?.oslist ?? {})) {
      for (const [osid, entry] of Object.entries(group)) {
        images.push({
          id: String(entry.osid ?? osid),
          name: entry.name ?? null,
          architecture: entry.arch === '64' || entry.arch === 'x86_64'
            ? 'x86_64'
            : (entry.arch === 'arm64' ? 'arm64' : null),
          available: entry.active === undefined || Number(entry.active) === 1,
          metadata: {},
        });
      }
    }
    return images;
  }

  async getImage(image) {
    const identifier = imageIdentifier(image);
    if (!identifier) return null;
    const images = await this.getAvailableImages();
    return images.find((entry) => entry.id === String(identifier)) ?? null;
  }

  async reinstallServer(input) {
    const osid = imageIdentifier(input.image);
    if (!osid) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no Virtualizor osid', false);
    const current = await this.getServerStatus(input.providerServerId);
    if (input.isRetry && current.imageId === String(osid)) return current;
    await this.call('rebuild', { vpsid: input.providerServerId }, {
      vpsid: input.providerServerId,
      osid,
      reinstall: 1,
      sshkey: input.sshPublicKeys.join('\n'),
      user_data: input.userData,
    });
    return this.getServerStatus(input.providerServerId);
  }

  async enableRescue() { return unsupportedRescue('virtualizor'); }
  async disableRescue() { return unsupportedRescue('virtualizor'); }

  async getConsole(providerServerId) {
    return asRecord(await this.call('vnc', { novnc: providerServerId }));
  }

  async getServerMetrics(providerServerId) {
    return asRecord(await this.call('vpsstat', { vpsid: providerServerId }));
  }

  async healthCheck(providerServerId, expectedImage) {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = imageIdentifier(expectedImage);
      return {
        exists: true,
        poweredOn: server.status === 'running',
        ipAddress: server.ipAddress,
        imageMatches: !expected || !server.imageId || server.imageId === String(expected),
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

module.exports = { VirtualizorProviderAdapter };
