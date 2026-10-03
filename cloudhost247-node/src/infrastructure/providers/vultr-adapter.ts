import type { InfrastructureProviderRow, ServerOsImageRow } from '../../db/infrastructure-providers';
import { unsupportedRescue } from './common';
import { providerRequest } from './http';
import {
  ProviderError,
  asRecord,
  asString,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
  type ProviderHealthResult,
  type ProviderImage,
  type ProviderServer,
  type ReinstallProviderServerInput,
} from './types';

interface VultrInstancePayload {
  id: string;
  label?: string;
  status?: string;
  power_status?: string;
  main_ip?: string;
  os?: string;
  image_id?: string;
  tag?: string;
  /**
   * "The server's current KVM URL. This URL will change periodically. It is not advised to cache
   * this value." — the API v2 instance schema, which is where Vultr's console actually lives
   * (bare metal has a separate `/v2/bare-metals/{id}/vnc` operation).
   */
  kvm?: string;
}

function toServer(instance: VultrInstancePayload): ProviderServer {
  return {
    id: instance.id,
    status: instance.status ?? 'unknown',
    name: instance.label ?? null,
    ipAddress: instance.main_ip ?? null,
    imageId: instance.image_id ?? instance.os ?? null,
    metadata: { tag: instance.tag, powerStatus: instance.power_status },
  };
}

/** Days of bandwidth history to read; Vultr accepts 1-180 and defaults to 30. */
const VULTR_BANDWIDTH_DAYS = 30;

/** Vultr has no host-telemetry endpoint at all — monitoring graphs are a portal feature. */
const VULTR_NO_TELEMETRY = 'Vultr API v2 exposes no endpoint for this metric';

export class VultrProviderAdapter implements InfrastructureProviderAdapter {
  readonly kind = 'vultr';
  private readonly token: string | undefined;
  private readonly baseUrl: string;

  constructor(readonly provider: InfrastructureProviderRow, source: NodeJS.ProcessEnv = process.env) {
    const prefix = provider.credential_env_prefix || 'VULTR';
    this.token = source[`${prefix}_API_TOKEN`] ?? source.VULTR_API_KEY;
    this.baseUrl = (provider.api_base_url ?? source.VULTR_API_URL ?? 'https://api.vultr.com/v2').replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Vultr API token is not configured', false);
    }
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return providerRequest<T>(`${this.baseUrl}${path}`, init, { headers: this.headers() });
  }

  async validateConfiguration(): Promise<void> {
    await this.request('/account');
  }

  async createServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const plan = asString(input.planMetadata.providerServerType)
      ?? asString(input.planMetadata.plan)
      ?? asString(input.planMetadata.vultrPlan);
    if (!plan) throw new ProviderError('INVALID_CONFIGURATION', 'Product configuration is missing provider plan', false);
    const image = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Vultr image identifier', false);

    const body: Record<string, unknown> = {
      region: input.regionCode,
      plan,
      label: input.name,
      hostname: input.hostname,
      user_data: Buffer.from(input.userData).toString('base64'),
      tags: [`ch247_${input.idempotencyKey.slice(0, 30)}`],
    };
    if (/^\d+$/.test(image)) body.os_id = Number(image);
    else body.image_id = image;
    if (input.sshPublicKeys.length > 0) body.sshkey_id = input.sshPublicKeys;

    const result = await this.request<{ instance: VultrInstancePayload }>('/instances', {
      method: 'POST', body: JSON.stringify(body),
    });
    return toServer(result.instance);
  }

  provisionServer(input: CreateProviderServerInput): Promise<ProviderServer> {
    return this.createServer(input);
  }

  async findServerByIdempotencyKey(idempotencyKey: string): Promise<ProviderServer | null> {
    const tag = `ch247_${idempotencyKey.slice(0, 30)}`;
    const result = await this.request<{ instances?: VultrInstancePayload[] }>(`/instances?tag=${encodeURIComponent(tag)}&per_page=1`);
    const instance = result.instances?.[0];
    return instance ? toServer(instance) : null;
  }

  async deleteServer(providerServerId: string): Promise<void> {
    await this.request(`/instances/${encodeURIComponent(providerServerId)}`, { method: 'DELETE' });
  }

  rebootServer(id: string): Promise<void> {
    return this.request(`/instances/${encodeURIComponent(id)}/reboot`, { method: 'POST' });
  }
  shutdownServer(id: string): Promise<void> {
    return this.request(`/instances/${encodeURIComponent(id)}/halt`, { method: 'POST' });
  }
  startServer(id: string): Promise<void> {
    return this.request(`/instances/${encodeURIComponent(id)}/start`, { method: 'POST' });
  }
  powerOnServer(id: string): Promise<void> { return this.startServer(id); }
  powerOffServer(id: string): Promise<void> { return this.shutdownServer(id); }
  getServer(id: string): Promise<ProviderServer> { return this.getServerStatus(id); }
  rebuildServer(input: ReinstallProviderServerInput): Promise<ProviderServer> { return this.reinstallServer(input); }

  async resizeServer(providerServerId: string, planMetadata: Record<string, unknown>): Promise<ProviderServer> {
    const plan = asString(planMetadata.providerServerType) ?? asString(planMetadata.plan);
    if (!plan) throw new ProviderError('INVALID_CONFIGURATION', 'Target plan missing for resize', false);
    await this.request(`/instances/${encodeURIComponent(providerServerId)}/change-plan`, {
      method: 'POST', body: JSON.stringify({ plan }),
    });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId: string, description: string): Promise<Record<string, unknown>> {
    const result = await this.request<{ snapshot: Record<string, unknown> }>('/snapshots', {
      method: 'POST', body: JSON.stringify({ instance_id: providerServerId, description }),
    });
    return asRecord(result.snapshot);
  }

  async deleteSnapshot(_providerServerId: string, snapshotId: string): Promise<void> {
    await this.request(`/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  async restoreSnapshot(providerServerId: string, snapshotId: string): Promise<void> {
    await this.request(`/instances/${encodeURIComponent(providerServerId)}/restore`, {
      method: 'POST', body: JSON.stringify({ snapshot_id: snapshotId }),
    });
  }

  async getServerStatus(providerServerId: string): Promise<ProviderServer> {
    const result = await this.request<{ instance: VultrInstancePayload }>(`/instances/${encodeURIComponent(providerServerId)}`);
    return toServer(result.instance);
  }

  async getServerIP(providerServerId: string): Promise<string | null> {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages(): Promise<ProviderImage[]> {
    const result = await this.request<{ os?: Array<{ id: number; name?: string; arch?: string }> }>('/os');
    return (result.os ?? []).map((o) => ({
      id: String(o.id),
      name: o.name ?? null,
      architecture: o.arch === 'arm64' ? 'arm64' : 'x86_64',
      available: true,
      metadata: {},
    }));
  }

  async getImage(image: ServerOsImageRow): Promise<ProviderImage | null> {
    const identifier = image.provider_image_id ?? image.provider_template_id;
    if (!identifier) return null;
    const images = await this.getAvailableImages();
    return images.find((img) => img.id === identifier || img.name === identifier) ?? null;
  }

  async reinstallServer(input: ReinstallProviderServerInput): Promise<ProviderServer> {
    const image = input.image.provider_image_id ?? input.image.provider_template_id;
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Vultr image identifier', false);
    const body: Record<string, unknown> = {};
    if (/^\d+$/.test(image)) body.os_id = Number(image);
    else body.image_id = image;
    await this.request(`/instances/${encodeURIComponent(input.providerServerId)}/reinstall`, {
      method: 'POST', body: JSON.stringify(body),
    });
    return this.getServerStatus(input.providerServerId);
  }

  async enableRescue(): Promise<never> { return unsupportedRescue('vultr'); }
  async disableRescue(): Promise<never> { return unsupportedRescue('vultr'); }

  /**
   * Vultr issues the console URL **on the instance object**, not through a console endpoint: every
   * instance carries `kvm`, documented in the API v2 instance schema as "the server's current KVM
   * URL. This URL will change periodically. It is not advised to cache this value." The URL is read
   * fresh on every call, which is what that sentence asks for, and it is never written to a log, a
   * job payload or an audit row — it is a link to a root console.
   *
   * This is what the adapter should always have done. It used to return `/instances/{id}/actions`,
   * the instance's *action history*, while the profile advertised `console: true`: the customer UI
   * rendered a list of past power events in a panel titled "Serial console session" and the platform
   * audited `SERVER_CONSOLE_OPENED` for a console that was never opened. That defect was corrected
   * *too far* — into a refusal whose stated reason ("the web console is a customer-portal feature")
   * is contradicted by the field Vultr documents on the instance it returns.
   */
  async getConsole(providerServerId: string): Promise<Record<string, unknown>> {
    const result = await this.request<{ instance?: VultrInstancePayload }>(
      `/instances/${encodeURIComponent(providerServerId)}`
    );
    const url = asString(result.instance?.kvm);
    if (!url) {
      // The capability is real, so this is a runtime refusal and not `UNSUPPORTED_OPERATION` (which
      // would mean the operation does not exist); the provider's own state is named so an operator
      // can tell a stopped instance from a product limitation.
      const state =
        asString(result.instance?.power_status) ?? asString(result.instance?.status) ?? 'unknown';
      throw new ProviderError(
        'SERVICE_UNAVAILABLE',
        `Vultr returned no KVM console URL for instance ${providerServerId} (power_status=${state})`,
        true
      );
    }
    return { url, type: 'novnc' };
  }

  /**
   * Vultr's only metrics surface is `GET /v2/instances/{instance-id}/bandwidth` (`date_range` in
   * days, default 30, max 180), which returns per-UTC-day byte counters. Vultr's own documentation
   * warns: "We do not recommend using this endpoint to gather real-time metrics."
   *
   * So this reports exactly what it is — daily bandwidth — and names every metric Vultr does not
   * expose (CPU, memory, filesystem, load) in `missing` instead of implying they were measured.
   */
  async getServerMetrics(providerServerId: string): Promise<Record<string, unknown>> {
    const payload = await this.request<{ bandwidth?: unknown }>(
      `/instances/${encodeURIComponent(providerServerId)}/bandwidth?date_range=${VULTR_BANDWIDTH_DAYS}`
    );

    const days: Array<{ date: string; incomingBytes: number; outgoingBytes: number }> = [];
    const bandwidth = payload?.bandwidth;
    if (bandwidth && typeof bandwidth === 'object') {
      for (const [date, entry] of Object.entries(bandwidth as Record<string, unknown>)) {
        if (!entry || typeof entry !== 'object') continue;
        const incoming = Number((entry as Record<string, unknown>).incoming_bytes);
        const outgoing = Number((entry as Record<string, unknown>).outgoing_bytes);
        if (!Number.isFinite(incoming) || !Number.isFinite(outgoing)) continue;
        days.push({ date, incomingBytes: incoming, outgoingBytes: outgoing });
      }
    }
    days.sort((a, b) => a.date.localeCompare(b.date));

    // No day entries means Vultr reported no bandwidth history at all. That is "no data", not
    // "zero traffic", so the totals stay null rather than claiming a measurement that never happened.
    const totalIncoming = days.length > 0 ? days.reduce((sum, day) => sum + day.incomingBytes, 0) : null;
    const totalOutgoing = days.length > 0 ? days.reduce((sum, day) => sum + day.outgoingBytes, 0) : null;

    return {
      provider: 'vultr',
      instanceId: providerServerId,
      source: '/v2/instances/{instance-id}/bandwidth',
      dateRangeDays: VULTR_BANDWIDTH_DAYS,
      metrics: {
        bandwidth: {
          daysReported: days.length,
          days,
          totalIncomingBytes: totalIncoming,
          totalOutgoingBytes: totalOutgoing,
        },
      },
      // Honest about what Vultr does not measure: these are never zero-filled or estimated.
      missing: ['cpu', 'memory', 'filesystem', 'load'],
      missingReasons: {
        cpu: VULTR_NO_TELEMETRY,
        memory: VULTR_NO_TELEMETRY,
        filesystem: VULTR_NO_TELEMETRY,
        load: VULTR_NO_TELEMETRY,
      },
      note: 'Vultr exposes daily bandwidth byte counters only, and its documentation advises against treating them as real-time metrics. Host telemetry (CPU, memory, disk, load) comes from the CloudHost247 server agent, not from Vultr.',
    };
  }

  async healthCheck(providerServerId: string, expectedImage: ServerOsImageRow): Promise<ProviderHealthResult> {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = expectedImage.provider_image_id ?? expectedImage.provider_template_id;
      const imageMatches = !expected || server.imageId === String(expected);
      return {
        exists: true,
        poweredOn: server.status === 'active',
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
