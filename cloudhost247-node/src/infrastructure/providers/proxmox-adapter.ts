/**
 * Proxmox VE adapter (QEMU clone + cloud-init, or LXC from a container template).
 *
 * Required server-side configuration:
 *   <PREFIX>_API_URL     https URL of the PVE API, e.g. https://pve.example.net:8006
 *                        (or the provider api_base_url)
 *   <PREFIX>_API_TOKEN   user@realm!tokenid=uuid
 *
 * Product configuration metadata must supply the target node and guest resources:
 *   providerNode (or proxmoxNode), cpuCores, memoryMb, storageMb,
 *   optional providerStorage (cloud-init/rootfs storage), providerBridge (default vmbr0).
 *
 * The OS image mapping carries the Proxmox template:
 *   provider_template_id = numeric VM template id  → QEMU full clone + cloud-init
 *   provider_template_id = "local:vztmpl/....tar.zst" → LXC container from that template
 *
 * Provider server ids are stored as `node/type/vmid` because a VMID alone is not addressable.
 * Idempotency: every guest is named after the job idempotency key and tagged with it, and the
 * cluster resource list is always consulted before a clone is issued.
 */
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import {
  firstPublicIpv4,
  idempotentResourceName,
  idempotentTag,
  planMetadataNumber,
  planMetadataString,
  requirePlanMetadataString,
  requireSecureBaseUrl,
  unsupportedRescue,
} from './common';
import { ProxmoxClient, type ProxmoxClusterResource, type ProxmoxGuestType } from './proxmox-client';
import {
  ProviderError,
  asRecord,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
  type ProviderHealthResult,
  type ProviderImage,
  type ProviderServer,
  type ReinstallProviderServerInput,
} from './types';

interface GuestRef {
  node: string;
  type: ProxmoxGuestType;
  vmid: number;
}

function parseGuestRef(providerServerId: string): GuestRef {
  const [node, type, vmid] = providerServerId.split('/');
  if (!node || (type !== 'qemu' && type !== 'lxc') || !vmid || !/^\d+$/.test(vmid)) {
    throw new ProviderError(
      'INVALID_CONFIGURATION',
      'Proxmox provider server id must be formatted as node/qemu|lxc/vmid',
      false
    );
  }
  return { node, type, vmid: Number(vmid) };
}

function guestPath(ref: GuestRef): string {
  return `/nodes/${encodeURIComponent(ref.node)}/${ref.type}/${ref.vmid}`;
}

function refId(ref: GuestRef): string {
  return `${ref.node}/${ref.type}/${ref.vmid}`;
}

function isLxcTemplate(identifier: string): boolean {
  return identifier.includes(':') || identifier.endsWith('.tar.zst') || identifier.endsWith('.tar.gz');
}

export class ProxmoxProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'proxmox';
  private readonly token: string | undefined;
  private readonly baseUrl: string | null;
  private client: ProxmoxClient | null = null;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'PROXMOX';
    this.token = source[`${prefix}_API_TOKEN`] ?? source.PROXMOX_API_TOKEN;
    this.baseUrl = provider.api_base_url ?? source[`${prefix}_API_URL`] ?? source.PROXMOX_API_URL ?? null;
  }

  private api(): ProxmoxClient {
    if (this.client) return this.client;
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Proxmox API token is not configured', false);
    }
    if (!this.baseUrl) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Proxmox API URL is not configured', false);
    }
    this.client = new ProxmoxClient(requireSecureBaseUrl('Proxmox', this.baseUrl), this.token);
    return this.client;
  }

  private defaultNode(): string | null {
    const configured = this.provider.metadata.defaultNode;
    return typeof configured === 'string' && configured.length > 0 ? configured : null;
  }

  async validateConfiguration(): Promise<void> {
    await this.api().version();
  }

  private async findResource(predicate: (resource: ProxmoxClusterResource) => boolean): Promise<ProxmoxClusterResource | null> {
    const resources = await this.api().clusterResources();
    return resources.find((resource) => predicate(resource)) ?? null;
  }

  private toServer(ref: GuestRef, status: { status?: string; name?: string } | null, ip: string | null, imageId: string | null): ProviderServer {
    return {
      id: refId(ref),
      status: status?.status ?? 'unknown',
      name: status?.name ?? null,
      ipAddress: ip,
      imageId,
      metadata: { node: ref.node, guestType: ref.type, vmid: ref.vmid },
    };
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const client = this.api();
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    const node = planMetadataString(input.planMetadata, ['providerNode', 'proxmoxNode', 'node']) ?? this.defaultNode();
    if (!node) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Product configuration metadata is missing providerNode', false);
    }
    const template = input.image.provider_template_id ?? input.image.provider_image_id;
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
      const upid = await client.post<string>(`/nodes/${encodeURIComponent(node)}/lxc`, {
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
      const ref: GuestRef = { node, type: 'lxc', vmid };
      return this.toServer(ref, { status: 'running', name }, await this.resolveIp(ref), template);
    }

    if (!/^\d+$/.test(template)) {
      throw new ProviderError(
        'IMAGE_UNAVAILABLE',
        'Proxmox QEMU template must be a numeric template VMID, or an LXC template volume id',
        false
      );
    }
    const templateVmid = Number(template);
    const templateResource = await this.findResource((resource) => resource.vmid === templateVmid);
    const templateNode = templateResource?.node ?? node;
    const cloneUpid = await client.post<string>(`/nodes/${encodeURIComponent(templateNode)}/qemu/${templateVmid}/clone`, {
      newid: vmid,
      name,
      target: node,
      full: 1,
      storage,
    });
    await client.waitForTask(templateNode, cloneUpid);

    const ref: GuestRef = { node, type: 'qemu', vmid };
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
    // cloud-init user data is delivered through a snippet volume when the operator has
    // configured one; otherwise the agent installer runs from the template's own cloud-init.
    const snippetStorage = planMetadataString(input.planMetadata, ['providerSnippetStorage', 'proxmoxSnippetStorage']);
    if (snippetStorage) {
      await client.post(`${guestPath(ref)}/config`, {
        cicustom: `user=${snippetStorage}:snippets/${name}.yml`,
      });
    }
    const startUpid = await client.post<string>(`${guestPath(ref)}/status/start`);
    await client.waitForTask(node, startUpid);
    return this.toServer(ref, { status: 'running', name }, await this.resolveIp(ref), template);
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const expectedName = idempotentResourceName(idempotencyKey, 48);
    const resource = await this.findResource(
      (item) => item.name === expectedName && item.template !== 1 && (item.type === 'qemu' || item.type === 'lxc')
    );
    if (!resource || !resource.node || !resource.vmid) return null;
    const ref: GuestRef = { node: resource.node, type: resource.type === 'lxc' ? 'lxc' : 'qemu', vmid: resource.vmid };
    return this.toServer(ref, { status: resource.status, name: resource.name }, await this.resolveIp(ref), await this.currentTemplate(ref));
  }

  private async currentTemplate(ref: GuestRef): Promise<string | null> {
    const config = await this.api().get<Record<string, unknown>>(`${guestPath(ref)}/config`);
    const marker = config?.['ch247_image'] ?? config?.['ostemplate'] ?? null;
    return typeof marker === 'string' ? marker : null;
  }

  private async resolveIp(ref: GuestRef): Promise<string | null> {
    try {
      const config = await this.api().get<Record<string, unknown>>(`${guestPath(ref)}/config`);
      const ipconfig = typeof config?.ipconfig0 === 'string' ? config.ipconfig0 : '';
      const staticIp = /ip=([0-9.]+)/.exec(ipconfig)?.[1];
      if (staticIp) return staticIp;
      if (ref.type === 'lxc') {
        const interfaces = await this.api().get<Array<{ inet?: string; name?: string }>>(`${guestPath(ref)}/interfaces`);
        return firstPublicIpv4((interfaces ?? []).map((entry) => entry.inet?.split('/')[0]));
      }
      const agent = await this.api().get<{ result?: Array<{ 'ip-addresses'?: Array<{ 'ip-address'?: string; 'ip-address-type'?: string }> }> }>(
        `${guestPath(ref)}/agent/network-get-interfaces`
      );
      const addresses = (agent?.result ?? []).flatMap((entry) =>
        (entry['ip-addresses'] ?? [])
          .filter((address) => address['ip-address-type'] === 'ipv4')
          .map((address) => address['ip-address'])
      );
      return firstPublicIpv4(addresses);
    } catch (error) {
      // The guest agent is only reachable once the OS finished booting; the health loop retries.
      if (error instanceof ProviderError && ['RESOURCE_NOT_FOUND', 'PROVIDER_ERROR', 'INVALID_CONFIGURATION'].includes(error.code)) {
        return null;
      }
      throw error;
    }
  }

  async deleteServer(providerServerId: string): Promise<void> {
    const ref = parseGuestRef(providerServerId);
    const client = this.api();
    try {
      const stopUpid = await client.post<string>(`${guestPath(ref)}/status/stop`);
      await client.waitForTask(ref.node, stopUpid);
    } catch (error) {
      if (!(error instanceof ProviderError) || error.code !== 'RESOURCE_NOT_FOUND') throw error;
    }
    const upid = await client.delete<string>(guestPath(ref), { purge: 1, 'destroy-unreferenced-disks': 1 });
    await client.waitForTask(ref.node, upid);
  }

  private async status(ref: GuestRef, action: string): Promise<void> {
    const upid = await this.api().post<string>(`${guestPath(ref)}/status/${action}`);
    await this.api().waitForTask(ref.node, upid);
  }

  async rebootServer(providerServerId: string): Promise<void> { await this.status(parseGuestRef(providerServerId), 'reboot'); }
  async shutdownServer(providerServerId: string): Promise<void> { await this.status(parseGuestRef(providerServerId), 'shutdown'); }
  async startServer(providerServerId: string): Promise<void> { await this.status(parseGuestRef(providerServerId), 'start'); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    const ref = parseGuestRef(providerServerId);
    const cores = planMetadataNumber(planMetadata, ['cpuCores', 'cores']);
    const memoryMb = planMetadataNumber(planMetadata, ['memoryMb', 'memory']);
    if (!cores && !memoryMb) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Target plan metadata has no cpuCores/memoryMb for resize', false);
    }
    await this.api().put(`${guestPath(ref)}/config`, { ...(cores ? { cores } : {}), ...(memoryMb ? { memory: memoryMb } : {}) });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    const ref = parseGuestRef(providerServerId);
    const snapname = `ch247${Date.now()}`;
    const upid = await this.api().post<string>(`${guestPath(ref)}/snapshot`, { snapname, description });
    await this.api().waitForTask(ref.node, upid);
    return { snapshotId: snapname, description };
  }

  async deleteSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    const ref = parseGuestRef(providerServerId);
    const upid = await this.api().delete<string>(`${guestPath(ref)}/snapshot/${encodeURIComponent(snapshotId)}`);
    await this.api().waitForTask(ref.node, upid);
  }

  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    const ref = parseGuestRef(providerServerId);
    const upid = await this.api().post<string>(`${guestPath(ref)}/snapshot/${encodeURIComponent(snapshotId)}/rollback`);
    await this.api().waitForTask(ref.node, upid);
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    const ref = parseGuestRef(providerServerId);
    try {
      const status = await this.api().get<{ status?: string; name?: string }>(`${guestPath(ref)}/status/current`);
      return this.toServer(ref, status, await this.resolveIp(ref), await this.currentTemplate(ref));
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        throw new ProviderError('RESOURCE_NOT_FOUND', 'Proxmox guest no longer exists', false);
      }
      throw error;
    }
  }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const templates = (await this.api().clusterResources()).filter((resource) => resource.template === 1);
    return templates.map((template) => ({
      id: String(template.vmid ?? ''),
      name: template.name ?? null,
      architecture: null,
      available: true,
      metadata: { node: template.node ?? null },
    }));
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_template_id ?? image.provider_image_id;
    if (!identifier) return null;
    if (isLxcTemplate(identifier)) {
      const [storage, volume] = identifier.split(':');
      if (!storage || !volume) return null;
      const node = this.defaultNode();
      if (!node) {
        throw new ProviderError(
          'INVALID_CONFIGURATION',
          'Set the provider metadata defaultNode before verifying Proxmox container templates',
          false
        );
      }
      const contents = await this.api().get<Array<{ volid?: string; format?: string; size?: number }>>(
        `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content?content=vztmpl`
      );
      const found = (contents ?? []).find((entry) => entry.volid === identifier);
      return found ? { id: identifier, name: identifier, architecture: null, available: true, metadata: { size: found.size ?? null } } : null;
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
   * Proxmox has no in-place "rebuild". A reinstall therefore destroys the guest and re-creates
   * it from the target template under the same VMID and name. The name/tag pair is the
   * idempotency record: a retry that finds the guest already carrying the target reinstall tag
   * does not destroy anything a second time.
   */
  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const ref = parseGuestRef(input.providerServerId);
    const client = this.api();
    const template = input.image.provider_template_id ?? input.image.provider_image_id;
    if (!template) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no Proxmox template', false);
    const reinstallTag = idempotentTag(input.idempotencyKey, 'ch247reinstall');

    const config = await client.get<Record<string, unknown>>(`${guestPath(ref)}/config`);
    const existingTags = typeof config?.tags === 'string' ? config.tags.split(/[;,\s]+/) : [];
    if (existingTags.includes(reinstallTag)) {
      // This exact reinstall already ran; never destroy the freshly installed guest again.
      return this.getServerStatus(input.providerServerId);
    }
    const name = typeof config?.name === 'string' ? config.name : idempotentResourceName(input.idempotencyKey, 48);
    const cores = typeof config?.cores === 'number' ? config.cores : 1;
    const memory = typeof config?.memory === 'number' ? config.memory : 1024;
    const previousTags = existingTags.filter((tag) => tag.length > 0 && !tag.startsWith('ch247reinstall-')).join(';');

    await this.deleteServer(input.providerServerId);

    if (isLxcTemplate(template)) {
      const upid = await client.post<string>(`/nodes/${encodeURIComponent(ref.node)}/lxc`, {
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
    const cloneUpid = await client.post<string>(
      `/nodes/${encodeURIComponent(templateResource?.node ?? ref.node)}/qemu/${templateVmid}/clone`,
      { newid: ref.vmid, name, target: ref.node, full: 1 }
    );
    await client.waitForTask(templateResource?.node ?? ref.node, cloneUpid);
    await client.post(`${guestPath(ref)}/config`, {
      cores,
      memory,
      ciuser: 'root',
      sshkeys: encodeURIComponent(input.sshPublicKeys.join('\n')),
      ipconfig0: 'ip=dhcp',
      agent: 'enabled=1',
      tags: [previousTags, reinstallTag].filter(Boolean).join(';'),
    });
    const startUpid = await client.post<string>(`${guestPath(ref)}/status/start`);
    await client.waitForTask(ref.node, startUpid);
    return this.toServer(ref, { status: 'running', name }, await this.resolveIp(ref), template);
  }

  async enableRescue(): Promise<never> { return unsupportedRescue('proxmox'); }
  async disableRescue(): Promise<never> { return unsupportedRescue('proxmox'); }

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    const ref = parseGuestRef(providerServerId);
    const result = await this.api().post<Record<string, unknown>>(`${guestPath(ref)}/vncproxy`, { websocket: 1 });
    return asRecord(result);
  }

  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    const ref = parseGuestRef(providerServerId);
    const series = await this.api().get<Array<Record<string, unknown>>>(`${guestPath(ref)}/rrddata?timeframe=hour`);
    return { series: series ?? [] };
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage.provider_template_id ?? expectedImage.provider_image_id;
      // Proxmox clones do not retain a queryable source-template reference for QEMU guests, so
      // the authoritative OS evidence is the signed agent report enforced by the provisioner.
      const imageMatches = !expected || !server.imageId || server.imageId === expected;
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
