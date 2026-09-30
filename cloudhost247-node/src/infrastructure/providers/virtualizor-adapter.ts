/**
 * Virtualizor (Admin API) adapter.
 *
 * Required server-side configuration:
 *   <PREFIX>_API_URL     https URL of the Virtualizor admin panel, e.g. https://vz.example.net:4085
 *                        (or the provider api_base_url)
 *   <PREFIX>_API_KEY     Admin API key
 *   <PREFIX>_API_SECRET  Admin API password
 *
 * Product configuration metadata must supply the virtualization type and resources:
 *   providerVirtType (kvm|openvz|lxc|proxk|proxl), providerNode (serverid) or providerNodeGroup,
 *   cpuCores, memoryMb, storageMb, optional bandwidthGb, providerPlanId, providerUserId.
 *
 * The OS image mapping carries the Virtualizor `osid` in provider_template_id (or
 * provider_image_id).
 *
 * Virtualizor has no idempotency header. Each VPS is therefore created with a deterministic
 * name derived from the job idempotency key and the panel is always searched for that name
 * before `addvs` is called. The customer hostname is applied inside the guest by cloud-init and
 * independently attested by the CloudHost247 agent before a server can become READY.
 */
import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import {
  firstPublicIpv4,
  idempotentResourceName,
  planMetadataNumber,
  planMetadataString,
  requirePlanMetadataString,
  requireSecureBaseUrl,
} from './common';
import { providerRequest } from './http';
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

interface VirtualizorVps {
  vpsid?: string | number;
  vps_name?: string;
  hostname?: string;
  status?: string | number;
  osid?: string | number;
  os_name?: string;
  ips?: Record<string, string> | string[];
  cores?: string | number;
  ram?: string | number;
}

function toRecordList(value: unknown): VirtualizorVps[] {
  if (Array.isArray(value)) return value as VirtualizorVps[];
  if (value && typeof value === 'object') return Object.values(value as Record<string, VirtualizorVps>);
  return [];
}

function ipList(vps: VirtualizorVps): string[] {
  if (Array.isArray(vps.ips)) return vps.ips;
  if (vps.ips && typeof vps.ips === 'object') return Object.values(vps.ips);
  return [];
}

function toServer(vps: VirtualizorVps): ProviderServer {
  const status = String(vps.status ?? '');
  return {
    id: String(vps.vpsid ?? ''),
    // Virtualizor reports 1 for a running VPS and 0 for a stopped one.
    status: status === '1' ? 'running' : status === '0' ? 'stopped' : status || 'unknown',
    name: vps.vps_name ?? vps.hostname ?? null,
    ipAddress: firstPublicIpv4(ipList(vps)),
    imageId: vps.osid !== undefined ? String(vps.osid) : null,
    metadata: { hostname: vps.hostname ?? null, osName: vps.os_name ?? null },
  };
}

export class VirtualizorProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'virtualizor';
  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;
  private readonly baseUrl: string | null;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'VIRTUALIZOR';
    this.apiKey = source[`${prefix}_API_KEY`] ?? source.VIRTUALIZOR_API_KEY;
    this.apiSecret = source[`${prefix}_API_SECRET`] ?? source.VIRTUALIZOR_API_SECRET;
    this.baseUrl = provider.api_base_url ?? source[`${prefix}_API_URL`] ?? source.VIRTUALIZOR_API_URL ?? null;
  }

  private credentials(): { key: string; secret: string; base: string } {
    if (!this.apiKey || !this.apiSecret) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Virtualizor API key and API password are not configured', false);
    }
    return { key: this.apiKey, secret: this.apiSecret, base: requireSecureBaseUrl('Virtualizor', this.baseUrl) };
  }

  /**
   * Every Virtualizor call is `index.php?act=<action>&api=json` plus the admin credentials.
   * Credentials are sent as POST form fields so they never appear in a URL, proxy log, or
   * error message.
   */
  private async call<T>(act: string, params: Record<string, unknown> = {}, body: Record<string, unknown> = {}): Promise<T> {
    const { key, secret, base } = this.credentials();
    const query = new URLSearchParams({ act, api: 'json' });
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(name, String(value));
    }
    const form = new URLSearchParams({ apikey: key, apipass: secret });
    for (const [name, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) form.set(name, String(value));
    }
    const response = await providerRequest<Record<string, unknown>>(
      `${base}/index.php?${query.toString()}`,
      { method: 'POST', body: form.toString() },
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const error = response?.error;
    if (error && (typeof error !== 'object' || Object.keys(error as object).length > 0)) {
      const message = typeof error === 'string' ? error : JSON.stringify(error).slice(0, 400);
      const authFailure = /login|auth|api key|apikey|password/i.test(message);
      throw new ProviderError(
        authFailure ? 'AUTHENTICATION_FAILED' : 'PROVIDER_ERROR',
        `Virtualizor rejected the request: ${message}`,
        false,
        { error }
      );
    }
    return response as T;
  }

  async validateConfiguration(): Promise<void> {
    await this.call('listvs', { page: 1, reslen: 1 });
  }

  private async searchByName(name: string): Promise<VirtualizorVps | null> {
    const result = await this.call<{ vs?: unknown }>('listvs', { vpsname: name, reslen: 50 });
    const matches = toRecordList(result?.vs);
    return matches.find((vps) => vps.vps_name === name || vps.hostname === name) ?? null;
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const expected = idempotentResourceName(idempotencyKey, 48);
    const match = await this.searchByName(expected);
    return match ? toServer(match) : null;
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const osid = input.image.provider_template_id ?? input.image.provider_image_id;
    if (!osid) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no Virtualizor osid', false);
    const virtType = requirePlanMetadataString(
      input.planMetadata,
      ['providerVirtType', 'virtualizorVirtType', 'virt'],
      'the Virtualizor virtualization type'
    );
    const name = idempotentResourceName(input.idempotencyKey, 48);
    const serverId = planMetadataString(input.planMetadata, ['providerNode', 'virtualizorServerId', 'serverid']);
    const nodeGroup = planMetadataString(input.planMetadata, ['providerNodeGroup', 'virtualizorNodeGroup']);
    if (!serverId && !nodeGroup) {
      throw new ProviderError(
        'INVALID_CONFIGURATION',
        'Product configuration metadata is missing providerNode or providerNodeGroup',
        false
      );
    }
    const response = await this.call<Record<string, unknown>>('addvs', {}, {
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
      space: Math.max(1, Math.round((planMetadataNumber(input.planMetadata, ['storageMb']) ?? 20480) / 1024)),
      ram: planMetadataNumber(input.planMetadata, ['memoryMb', 'ram']) ?? 1024,
      cores: planMetadataNumber(input.planMetadata, ['cpuCores', 'cores']) ?? 1,
      bandwidth: planMetadataNumber(input.planMetadata, ['bandwidthGb', 'bandwidth']) ?? 0,
      ips: 1,
      // cloud-init delivers the CloudHost247 agent, SSH keys, and the customer hostname. The
      // Virtualizor template selected by the mapping must have cloud-init support enabled.
      cloudinit: 1,
      sshkey: input.sshPublicKeys.join('\n'),
      user_data: input.userData,
    });
    const vpsId = response.vpsid ?? asRecord(response.vs).vpsid;
    if (!vpsId) {
      // The panel may have created the VPS without echoing an id; re-read before concluding.
      const created = await this.searchByName(name);
      if (created) return toServer(created);
      throw new ProviderError('PROVIDER_ERROR', 'Virtualizor did not return a VPS id for the created server', true, response);
    }
    const created = await this.searchByName(name);
    return created ? toServer(created) : { id: String(vpsId), status: 'unknown', name, ipAddress: null, imageId: String(osid), metadata: {} };
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    const result = await this.call<{ vs?: unknown }>('listvs', { vpsid: providerServerId });
    const match = toRecordList(result?.vs).find((vps) => String(vps.vpsid) === String(providerServerId));
    if (!match) throw new ProviderError('RESOURCE_NOT_FOUND', 'Virtualizor VPS no longer exists', false);
    return toServer(match);
  }

  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async deleteServer(providerServerId: string): Promise<void> {
    await this.call('vs', { delete: providerServerId });
  }

  async startServer(providerServerId: string): Promise<void> { await this.call('start', { vpsid: providerServerId }); }
  async shutdownServer(providerServerId: string): Promise<void> { await this.call('stop', { vpsid: providerServerId }); }
  async rebootServer(providerServerId: string): Promise<void> { await this.call('restart', { vpsid: providerServerId }); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    await this.call('managevps', { vpsid: providerServerId }, {
      editvps: 1,
      vpsid: providerServerId,
      ram: planMetadataNumber(planMetadata, ['memoryMb', 'ram']) ?? undefined,
      cores: planMetadataNumber(planMetadata, ['cpuCores', 'cores']) ?? undefined,
      space: planMetadataNumber(planMetadata, ['storageMb'])
        ? Math.max(1, Math.round((planMetadataNumber(planMetadata, ['storageMb']) as number) / 1024))
        : undefined,
    });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    return asRecord(await this.call('vpsbackups', { vpsid: providerServerId }, { createbackup: 1, description }));
  }

  async deleteSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    await this.call('vpsbackups', { vpsid: providerServerId }, { delete: snapshotId });
  }

  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    await this.call('vpsbackups', { vpsid: providerServerId }, { restore: snapshotId });
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const result = await this.call<{ oslist?: Record<string, Record<string, { name?: string; osid?: string | number; arch?: string; active?: number }>> }>('ostemplates');
    const images: ProviderImage[] = [];
    for (const group of Object.values(result?.oslist ?? {})) {
      for (const [osid, entry] of Object.entries(group)) {
        images.push({
          id: String(entry.osid ?? osid),
          name: entry.name ?? null,
          architecture: entry.arch === '64' || entry.arch === 'x86_64' ? 'x86_64' : entry.arch === 'arm64' ? 'arm64' : null,
          available: entry.active === undefined || Number(entry.active) === 1,
          metadata: {},
        });
      }
    }
    return images;
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_template_id ?? image.provider_image_id;
    if (!identifier) return null;
    const images = await this.getAvailableImages();
    return images.find((entry) => entry.id === String(identifier)) ?? null;
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const osid = input.image.provider_template_id ?? input.image.provider_image_id;
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

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.call('vnc', { novnc: providerServerId }));
  }

  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.call('vpsstat', { vpsid: providerServerId }));
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage.provider_template_id ?? expectedImage.provider_image_id;
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
