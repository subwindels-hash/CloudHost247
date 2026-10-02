/**
 * SolusVM 1 (Admin API) adapter.
 *
 * Required server-side configuration:
 *   <PREFIX>_API_URL     https URL of the SolusVM master, e.g. https://solus.example.net:5656
 *                        (or the provider api_base_url)
 *   <PREFIX>_API_ID      Admin API id
 *   <PREFIX>_API_KEY     Admin API key
 *
 * Product configuration metadata must supply:
 *   providerVirtType (openvz|xen|xen hvm|kvm), providerNode (node name) or providerNodeGroup,
 *   providerPlanId (SolusVM plan), providerClientId (SolusVM username that owns the server),
 *   optional ipv4Count.
 *
 * The OS image mapping carries the SolusVM template filename in provider_template_id.
 *
 * SolusVM has no idempotency key. Each server is created with a deterministic hostname derived
 * from the job idempotency key, and `vserver-infoall` is searched for it before create. The
 * customer hostname is applied inside the guest and attested by the CloudHost247 agent.
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
  type RescueRequest,
  type RescueSession,
} from './types';

interface SolusResponse extends Record<string, unknown> {
  status?: string;
  statusmsg?: string;
  vserverid?: string;
  vmstat?: string;
  state?: string;
  hostname?: string;
  ipaddress?: string;
  ipaddresses?: string;
  template?: string;
  templates?: string;
  vmlist?: string;
}

export class SolusvmProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'solusvm';
  private readonly apiId: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string | null;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'SOLUSVM';
    this.apiId = source[`${prefix}_API_ID`] ?? source.SOLUSVM_API_ID;
    this.apiKey = source[`${prefix}_API_KEY`] ?? source[`${prefix}_API_TOKEN`] ?? source.SOLUSVM_API_KEY ?? source.SOLUSVM_API_TOKEN;
    this.baseUrl = provider.api_base_url ?? source[`${prefix}_API_URL`] ?? source.SOLUSVM_API_URL ?? null;
  }

  private credentials(): { id: string; key: string; base: string } {
    if (!this.apiId || !this.apiKey) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'SolusVM admin API id and key are not configured', false);
    }
    return { id: this.apiId, key: this.apiKey, base: requireSecureBaseUrl('SolusVM', this.baseUrl) };
  }

  /** SolusVM accepts one POST form endpoint; credentials are form fields, never query strings. */
  private async call(action: string, params: Record<string, unknown> = {}): Promise<SolusResponse> {
    const { id, key, base } = this.credentials();
    const form = new URLSearchParams({ id, key, action, rdtype: 'json' });
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) form.set(name, String(value));
    }
    const response = await providerRequest<SolusResponse>(
      `${base}/api/admin/command.php`,
      { method: 'POST', body: form.toString() },
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    if (response?.status === 'error') {
      const message = String(response.statusmsg ?? 'SolusVM returned an error');
      const authFailure = /api|access|key|id/i.test(message) && /invalid|denied|not allowed/i.test(message);
      const missing = /does not exist|not found|no such/i.test(message);
      throw new ProviderError(
        authFailure ? 'AUTHENTICATION_FAILED' : missing ? 'RESOURCE_NOT_FOUND' : 'PROVIDER_ERROR',
        `SolusVM: ${message}`,
        false,
        { statusmsg: message }
      );
    }
    return response ?? {};
  }

  private toServer(response: SolusResponse, fallbackId?: string): ProviderServer {
    const addresses = String(response.ipaddresses ?? response.ipaddress ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const state = String(response.vmstat ?? response.state ?? '').toLowerCase();
    return {
      id: String(response.vserverid ?? fallbackId ?? ''),
      status: state === 'online' ? 'running' : state === 'offline' ? 'stopped' : state || 'unknown',
      name: response.hostname ? String(response.hostname) : null,
      ipAddress: firstPublicIpv4(addresses),
      imageId: response.template ? String(response.template) : null,
      metadata: { node: response.node ?? null, type: response.type ?? null },
    };
  }

  async validateConfiguration(): Promise<void> {
    await this.call('node-idlist', { type: this.defaultVirtType() });
  }

  private defaultVirtType(): string {
    const configured = this.provider.metadata.virtType;
    return typeof configured === 'string' && configured.length > 0 ? configured : 'kvm';
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
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

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const template = input.image.provider_template_id ?? input.image.provider_image_id;
    if (!template) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no SolusVM template', false);
    const hostname = idempotentResourceName(input.idempotencyKey, 48);
    const virtType = requirePlanMetadataString(
      input.planMetadata,
      ['providerVirtType', 'solusvmVirtType', 'virtType'],
      'the SolusVM virtualization type'
    );
    const username = requirePlanMetadataString(
      input.planMetadata,
      ['providerClientId', 'solusvmUsername', 'username'],
      'the SolusVM account that must own the server'
    );
    const plan = requirePlanMetadataString(
      input.planMetadata,
      ['providerPlanId', 'solusvmPlan', 'plan'],
      'the SolusVM plan'
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
      // SolusVM passes custom cloud-init user data to KVM templates that support it.
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

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    const response = await this.call('vserver-infoall', { vserverid: providerServerId });
    if (!response.vserverid && !response.hostname) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'SolusVM server no longer exists', false);
    }
    return this.toServer(response, providerServerId);
  }

  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async deleteServer(providerServerId: string): Promise<void> {
    await this.call('vserver-terminate', { vserverid: providerServerId, deleteclient: 'false' });
  }

  async startServer(providerServerId: string): Promise<void> { await this.call('vserver-boot', { vserverid: providerServerId }); }
  async shutdownServer(providerServerId: string): Promise<void> { await this.call('vserver-shutdown', { vserverid: providerServerId }); }
  async rebootServer(providerServerId: string): Promise<void> { await this.call('vserver-reboot', { vserverid: providerServerId }); }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    const plan = planMetadataString(planMetadata, ['providerPlanId', 'solusvmPlan', 'plan']);
    if (!plan) throw new ProviderError('INVALID_CONFIGURATION', 'Target plan metadata has no SolusVM plan for resize', false);
    await this.call('vserver-change', { vserverid: providerServerId, plan });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(_providerServerId: string, _description: string): Promise<Record<string, unknown>> {
    throw new ProviderError('UNSUPPORTED_OPERATION', 'SolusVM 1 does not expose snapshots through the admin API', false);
  }

  async deleteSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    throw new ProviderError('UNSUPPORTED_OPERATION', 'SolusVM 1 does not expose snapshots through the admin API', false);
  }

  async restoreSnapshot(_providerServerId: string, _snapshotId: string): Promise<void> {
    throw new ProviderError('UNSUPPORTED_OPERATION', 'SolusVM 1 does not expose snapshots through the admin API', false);
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const response = await this.call('listtemplates', { type: this.defaultVirtType() });
    const raw = String(response.templates ?? '');
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((template) => ({
        id: template,
        name: template,
        architecture: /x86_64|amd64|64/.test(template) ? 'x86_64' : /arm64|aarch64/.test(template) ? 'arm64' : null,
        available: true,
        metadata: {},
      }));
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_template_id ?? image.provider_image_id;
    if (!identifier) return null;
    const images = await this.getAvailableImages();
    return images.find((entry) => entry.id === identifier) ?? null;
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const template = input.image.provider_template_id ?? input.image.provider_image_id;
    if (!template) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image mapping has no SolusVM template', false);
    const current = await this.getServerStatus(input.providerServerId);
    if (input.isRetry && current.imageId === template) return current;
    await this.call('vserver-rebuild', { vserverid: input.providerServerId, template });
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * Enters SolusVM's rescue system via the documented Admin API v1 `vserver-rescue` action
   * (docs.solusvm.com/v1/api/admin/virtual-server-functions/Rescue+Mode.html).
   *
   * `rescueenable` selects the rescue kernel: 1 = 4.x 64-bit, 2 = 3.x 64-bit, 3 = 3.x 32-bit. Those
   * are the only kernels SolusVM offers, and all of them are x86 — an arm64 server therefore has no
   * rescue system to boot into, and this refuses rather than booting the wrong architecture.
   *
   * Enabling rescue reboots the virtual server (SolusVM states this explicitly for the same
   * operation in the admin panel), so `rebooted: true` is a fact about the call, not an assumption.
   * The returned password is a one-time credential: it is handed to the requester and never stored.
   */
  async enableRescue(providerServerId: string, input: RescueRequest): Promise<RescueSession> {
    if (input.architecture !== 'x86_64') {
      throw new ProviderError(
        'UNSUPPORTED_OPERATION',
        'SolusVM offers only x86 rescue kernels (4.x 64-bit, 3.x 64-bit, 3.x 32-bit); there is no arm64 rescue system to boot',
        false
      );
    }
    const response = await this.call('vserver-rescue', { vserverid: providerServerId, rescueenable: 1 });
    const user = typeof response.user === 'string' && response.user.length > 0 ? response.user : null;
    if (!user) {
      // SolusVM answers success with the access details; without a login user there is nothing
      // usable to hand back, and inventing one would send the customer to a locked rescue system.
      throw new ProviderError(
        'PROVIDER_ERROR',
        'SolusVM accepted the rescue request but returned no rescue login user',
        false
      );
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

  /**
   * Leaves the rescue system. SolusVM's `rescuedisable` clears rescue; the installed operating
   * system comes back on the next restart, which is SolusVM's documented way out of rescue.
   */
  async disableRescue(providerServerId: string): Promise<void> {
    await this.call('vserver-rescue', { vserverid: providerServerId, rescuedisable: 'true' });
  }

  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.call('vserver-console', { vserverid: providerServerId, access: 'enable', time: 2 }));
  }

  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    return asRecord(await this.call('vserver-status', { vserverid: providerServerId }));
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage.provider_template_id ?? expectedImage.provider_image_id;
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
