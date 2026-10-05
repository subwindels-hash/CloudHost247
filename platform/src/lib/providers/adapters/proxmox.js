/**
 * Proxmox VE adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/proxmox-adapter.ts. Self-hosted: the
 * provider row must carry an explicit https api_base_url.
 *
 * Provider server ids are stored as `node/qemu|lxc/vmid` because a VMID alone is not addressable.
 * Idempotency: every guest is named after the job idempotency key and tagged with it, and the
 * cluster resource list is always consulted before a clone is issued.
 */
'use strict';

const { asRecord, ProviderError } = require('../types');
const {
  firstPublicIpv4,
  idempotentResourceName,
  idempotentTag,
  imageIdentifier,
  planMetadataNumber,
  planMetadataString,
  requireSecureBaseUrl,
  unsupportedRescue,
} = require('../common');
const { ProxmoxClient } = require('./proxmox-client');

function parseGuestRef(providerServerId) {
  const [node, type, vmid] = String(providerServerId).split('/');
  if (!node || (type !== 'qemu' && type !== 'lxc') || !vmid || !/^\d+$/.test(vmid)) {
    throw new ProviderError(
      'INVALID_CONFIGURATION',
      'Proxmox provider server id must be formatted as node/qemu|lxc/vmid',
      false,
    );
  }
  return { node, type, vmid: Number(vmid) };
}

function guestPath(ref) {
  return `/nodes/${encodeURIComponent(ref.node)}/${ref.type}/${ref.vmid}`;
}

function refId(ref) {
  return `${ref.node}/${ref.type}/${ref.vmid}`;
}

function isLxcTemplate(identifier) {
  return identifier.includes(':') || identifier.endsWith('.tar.zst') || identifier.endsWith('.tar.gz');
}

class ProxmoxProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'proxmox';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || 'PROXMOX';
    this.token = source[`${prefix}_API_TOKEN`] ?? source.PROXMOX_API_TOKEN;
    this.baseUrl = provider.api_base_url ?? source[`${prefix}_API_URL`] ?? source.PROXMOX_API_URL ?? null;
    this.client = null;
  }

  api() {
    if (this.client) return this.client;
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Proxmox API token is not configured', false);
    }
    if (!this.baseUrl) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Proxmox API URL is not configured', false);
    }
    this.client = new ProxmoxClient(requireSecureBaseUrl('Proxmox', this.baseUrl), this.token, {
      transport: this.transport,
    });
    return this.client;
  }

  defaultNode() {
    const configured = this.provider.metadata?.defaultNode;
    return typeof configured === 'string' && configured.length > 0 ? configured : null;
  }

  async validateConfiguration() {
    await this.api().version();
  }

  async findResource(predicate) {
    const resources = await this.api().clusterResources();
    return (resources ?? []).find(predicate) ?? null;
  }

  toServer(ref, status, ip, imageId) {
    return {
      id: refId(ref),
      status: status?.status ?? 'unknown',
      name: status?.name ?? null,
      ipAddress: ip,
      imageId,
      metadata: { node: ref.node, guestType: ref.type, vmid: ref.vmid },
    };
  }

  async createServer(input) {
    const client = this.api();
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const node = planMetadataString(input.planMetadata, ['providerNode', 'proxmoxNode', 'node']) ?? this.defaultNode();
    if (!node) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Product configuration metadata is missing providerNode', false);
    }
    const template = imageIdentifier(input.image);
    if (!template) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no Proxmox template', false);
    const name = idempotentResourceName(input.idempotencyKey, 48);
    const tag = idempotentTag(input.idempotencyKey);
    const cores = planMetadataNumber(input.planMetadata, ['cpuCores', 'cores']) ?? 1;
    const memoryMb = planMetadataNumber(input.planMetadata, ['memoryMb', 'memory']) ?? 1024;
    const storageGb = Math.max(1, Math.round((planMetadataNumber(input.planMetadata, ['storageMb', 'disk']) ?? 20480) / 1024));
    const storage = planMetadataString(input.planMetadata, ['providerStorage', 'proxmoxStorage']) ?? 'local-lvm';
    const bridge = planMetadataString(input.planMetadata, ['providerBridge', 'proxmoxBridge']) ?? 'vmbr0';
    const sshKeys = encodeURIComponent(input.sshPublicKeys.join('\n'));
    const vmid = await client.nextId();

    if (isLxcTemplate(template)) {
      const upid = await client.post(`/nodes/${encodeURIComponent(node)}/lxc`, {
        vmid,
        hostname: input.hostname,
        ostemplate: template,
        storage,
        rootfs: `${storage}:${storageGb}`,
        cores,
        memory: memoryMb,
        net0: `name=eth0,bridge=${bridge},ip=dhcp`,
        'ssh-public-keys': input.sshPublicKeys.join('\n'),
        tags: tag,
        description: name,
        start: 1,
        unprivileged: 1,
      });
      await client.waitForTask(node, upid);
      const ref = { node, type: 'lxc', vmid };
      return this.toServer(ref, { status: 'running', name }, await this.resolveIp(ref), template);
    }

    if (!/^\d+$/.test(template)) {
      throw new ProviderError(
        'IMAGE_UNAVAILABLE',
        'Proxmox QEMU template must be a numeric template VMID, or an LXC template volume id',
        false,
      );
    }
    const templateVmid = Number(template);
    const templateResource = await this.findResource((resource) => resource.vmid === templateVmid);
    const templateNode = templateResource?.node ?? node;
    const cloneUpid = await client.post(`/nodes/${encodeURIComponent(templateNode)}/qemu/${templateVmid}/clone`, {
      newid: vmid,
      name,
      target: node,
      full: 1,
      storage,
    });
    await client.waitForTask(templateNode, cloneUpid);
    const ref = { node, type: 'qemu', vmid };
    await client.post(`${guestPath(ref)}/config`, {
      cores,
      memory: memoryMb,
      ciuser: 'root',
      sshkeys: sshKeys,
      ipconfig0: 'ip=dhcp',
      tags: tag,
      net0: `virtio,bridge=${bridge}`,
      agent: 'enabled=1',
      description: `CloudHost247 ${input.hostname}`,
    });
    const snippetStorage = planMetadataString(input.planMetadata, ['providerSnippetStorage', 'proxmoxSnippetStorage']);
    if (snippetStorage) {
      await client.post(`${guestPath(ref)}/config`, { cicustom: `user=${snippetStorage}:snippets/${name}.yml` });
    }
    const startUpid = await client.post(`${guestPath(ref)}/status/start`);
    await client.waitForTask(node, startUpid);
    return this.toServer(ref, { status: 'running', name }, await this.resolveIp(ref), template);
  }

  provisionServer(input) { return this.createServer(input); }

  async findServerByIdempotencyKey(idempotencyKey) {
    const expectedName = idempotentResourceName(idempotencyKey, 48);
    const resource = await this.findResource(
      (item) => item.name === expectedName && item.template !== 1 && (item.type === 'qemu' || item.type === 'lxc'),
    );
    if (!resource || !resource.node || !resource.vmid) return null;
    const ref = { node: resource.node, type: resource.type === 'lxc' ? 'lxc' : 'qemu', vmid: resource.vmid };
    return this.toServer(
      ref,
      { status: resource.status, name: resource.name },
      await this.resolveIp(ref),
      await this.currentTemplate(ref),
    );
  }

  async currentTemplate(ref) {
    const config = await this.api().get(`${guestPath(ref)}/config`);
    const marker = config?.ch247_image ?? config?.ostemplate ?? null;
    return typeof marker === 'string' ? marker : null;
  }

  async resolveIp(ref) {
    try {
      const config = await this.api().get(`${guestPath(ref)}/config`);
      const ipconfig = typeof config?.ipconfig0 === 'string' ? config.ipconfig0 : '';
      const staticIp = /ip=([0-9.]+)/.exec(ipconfig)?.[1];
      if (staticIp) return staticIp;
      if (ref.type === 'lxc') {
        const interfaces = await this.api().get(`${guestPath(ref)}/interfaces`);
        return firstPublicIpv4((interfaces ?? []).map((entry) => entry.inet?.split('/')[0]));
      }
      const agent = await this.api().get(`${guestPath(ref)}/agent/network-get-interfaces`);
      const addresses = (agent?.result ?? []).flatMap((entry) => (entry['ip-addresses'] ?? [])
        .filter((address) => address['ip-address-type'] === 'ipv4')
        .map((address) => address['ip-address']));
      return firstPublicIpv4(addresses);
    } catch (error) {
      if (error instanceof ProviderError && ['RESOURCE_NOT_FOUND', 'PROVIDER_ERROR', 'INVALID_CONFIGURATION'].includes(error.code)) {
        return null;
      }
      throw error;
    }
  }

  async deleteServer(providerServerId) {
    const ref = parseGuestRef(providerServerId);
    const client = this.api();
    try {
      const stopUpid = await client.post(`${guestPath(ref)}/status/stop`);
      await client.waitForTask(ref.node, stopUpid);
    } catch (error) {
      if (!(error instanceof ProviderError) || error.code !== 'RESOURCE_NOT_FOUND') throw error;
    }
    const upid = await client.delete(guestPath(ref), { purge: 1, 'destroy-unreferenced-disks': 1 });
    await client.waitForTask(ref.node, upid);
  }

  async status(ref, action) {
    const upid = await this.api().post(`${guestPath(ref)}/status/${action}`);
    await this.api().waitForTask(ref.node, upid);
  }

  async rebootServer(providerServerId) { await this.status(parseGuestRef(providerServerId), 'reboot'); }
  async shutdownServer(providerServerId) { await this.status(parseGuestRef(providerServerId), 'shutdown'); }
  async startServer(providerServerId) { await this.status(parseGuestRef(providerServerId), 'start'); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  getServer(id) { return this.getServerStatus(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId, planMetadata) {
    const ref = parseGuestRef(providerServerId);
    const cores = planMetadataNumber(planMetadata, ['cpuCores', 'cores']);
    const memoryMb = planMetadataNumber(planMetadata, ['memoryMb', 'memory']);
    if (!cores && !memoryMb) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Target plan metadata has no cpuCores/memoryMb for resize', false);
    }
    await this.api().put(`${guestPath(ref)}/config`, {
      ...(cores ? { cores } : {}),
      ...(memoryMb ? { memory: memoryMb } : {}),
    });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId, description) {
    const ref = parseGuestRef(providerServerId);
    const snapname = `ch247${Date.now()}`;
    const upid = await this.api().post(`${guestPath(ref)}/snapshot`, { snapname, description });
    await this.api().waitForTask(ref.node, upid);
    return { snapshotId: snapname, description };
  }

  async deleteSnapshot(providerServerId, snapshotId) {
    const ref = parseGuestRef(providerServerId);
    const upid = await this.api().delete(`${guestPath(ref)}/snapshot/${encodeURIComponent(snapshotId)}`);
    await this.api().waitForTask(ref.node, upid);
  }

  async restoreSnapshot(providerServerId, snapshotId) {
    const ref = parseGuestRef(providerServerId);
    const upid = await this.api().post(`${guestPath(ref)}/snapshot/${encodeURIComponent(snapshotId)}/rollback`);
    await this.api().waitForTask(ref.node, upid);
  }

  async getServerStatus(providerServerId) {
    const ref = parseGuestRef(providerServerId);
    try {
      const status = await this.api().get(`${guestPath(ref)}/status/current`);
      return this.toServer(ref, status, await this.resolveIp(ref), await this.currentTemplate(ref));
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        throw new ProviderError('RESOURCE_NOT_FOUND', 'Proxmox guest no longer exists', false);
      }
      throw error;
    }
  }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages() {
    const resources = await this.api().clusterResources();
    return (resources ?? []).filter((resource) => resource.template === 1).map((template) => ({
      id: String(template.vmid ?? ''),
      name: template.name ?? null,
      architecture: null,
      available: true,
      metadata: { node: template.node ?? null },
    }));
  }

  async getImage(image) {
    const identifier = imageIdentifier(image);
    if (!identifier) return null;
    if (isLxcTemplate(identifier)) {
      const [storage, volume] = identifier.split(':');
      if (!storage || !volume) return null;
      const node = this.defaultNode();
      if (!node) {
        throw new ProviderError(
          'INVALID_CONFIGURATION',
          'Set the provider metadata defaultNode before verifying Proxmox container templates',
          false,
        );
      }
      const contents = await this.api().get(
        `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content?content=vztmpl`,
      );
      const found = (contents ?? []).find((entry) => entry.volid === identifier);
      return found
        ? { id: identifier, name: identifier, architecture: null, available: true, metadata: { size: found.size ?? null } }
        : null;
    }
    if (!/^\d+$/.test(identifier)) return null;
    const template = await this.findResource((resource) => resource.vmid === Number(identifier));
    if (!template) return null;
    return {
      id: identifier,
      name: template.name ?? null,
      architecture: null,
      available: template.template === 1,
      metadata: { node: template.node ?? null, isTemplate: template.template === 1 },
    };
  }

  /**
   * Proxmox has no in-place "rebuild". A reinstall therefore destroys the guest and re-creates it
   * from the target template under the same VMID and name. The name/tag pair is the idempotency
   * record: a retry that finds the guest already carrying the target reinstall tag does not destroy
   * anything a second time.
   */
  async reinstallServer(input) {
    const ref = parseGuestRef(input.providerServerId);
    const client = this.api();
    const template = imageIdentifier(input.image);
    if (!template) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no Proxmox template', false);
    const reinstallTag = idempotentTag(input.idempotencyKey, 'ch247reinstall');
    const config = await client.get(`${guestPath(ref)}/config`);
    const existingTags = typeof config?.tags === 'string' ? config.tags.split(/[;,\s]+/) : [];
    if (existingTags.includes(reinstallTag)) return this.getServerStatus(input.providerServerId);
    const name = typeof config?.name === 'string' ? config.name : idempotentResourceName(input.idempotencyKey, 48);
    const cores = typeof config?.cores === 'number' ? config.cores : 1;
    const memory = typeof config?.memory === 'number' ? config.memory : 1024;
    const previousTags = existingTags.filter((tag) => tag.length > 0 && !tag.startsWith('ch247reinstall-')).join(';');
    await this.deleteServer(input.providerServerId);

    if (isLxcTemplate(template)) {
      const upid = await client.post(`/nodes/${encodeURIComponent(ref.node)}/lxc`, {
        vmid: ref.vmid,
        hostname: input.hostname,
        ostemplate: template,
        cores,
        memory,
        'ssh-public-keys': input.sshPublicKeys.join('\n'),
        tags: [previousTags, reinstallTag].filter(Boolean).join(';'),
        start: 1,
        unprivileged: 1,
      });
      await client.waitForTask(ref.node, upid);
      return this.toServer(ref, { status: 'running', name }, await this.resolveIp(ref), template);
    }

    const templateVmid = Number(template);
    if (!Number.isInteger(templateVmid)) {
      throw new ProviderError('IMAGE_UNAVAILABLE', 'Proxmox QEMU template must be a numeric template VMID', false);
    }
    const templateResource = await this.findResource((resource) => resource.vmid === templateVmid);
    const templateNode = templateResource?.node ?? ref.node;
    const cloneUpid = await client.post(`/nodes/${encodeURIComponent(templateNode)}/qemu/${templateVmid}/clone`, {
      newid: ref.vmid,
      name,
      target: ref.node,
      full: 1,
    });
    await client.waitForTask(templateNode, cloneUpid);
    await client.post(`${guestPath(ref)}/config`, {
      cores,
      memory,
      ciuser: 'root',
      sshkeys: encodeURIComponent(input.sshPublicKeys.join('\n')),
      ipconfig0: 'ip=dhcp',
      agent: 'enabled=1',
      tags: [previousTags, reinstallTag].filter(Boolean).join(';'),
    });
    const startUpid = await client.post(`${guestPath(ref)}/status/start`);
    await client.waitForTask(ref.node, startUpid);
    return this.toServer(ref, { status: 'running', name }, await this.resolveIp(ref), template);
  }

  async enableRescue() { return unsupportedRescue('proxmox'); }
  async disableRescue() { return unsupportedRescue('proxmox'); }

  async getConsole(providerServerId) {
    const ref = parseGuestRef(providerServerId);
    return asRecord(await this.api().post(`${guestPath(ref)}/vncproxy`, { websocket: 1 }));
  }

  async getServerMetrics(providerServerId) {
    const ref = parseGuestRef(providerServerId);
    const series = await this.api().get(`${guestPath(ref)}/rrddata?timeframe=hour`);
    return { series: series ?? [] };
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

module.exports = { ProxmoxProviderAdapter, parseGuestRef, isLxcTemplate };
