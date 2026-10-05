/**
 * Vultr adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/vultr-adapter.ts. Native instance API.
 *
 * Three provider facts drive the shape of this file, each documented by Vultr:
 *  - the console URL is the `kvm` field *on the instance object* ("this URL will change
 *    periodically... not advised to cache"), so it is read fresh on every call and never logged or
 *    stored;
 *  - rescue for cloud compute is the ISO-library path (attach SystemRescue from the public ISO
 *    library, reboot), not an API operation called "rescue";
 *  - the only metrics surface is daily bandwidth byte counters, which Vultr's own documentation
 *    warns are not real-time. Everything else is named in `missing` rather than implied measured.
 */
'use strict';

const { providerRequest } = require('../http');
const { asRecord, asString, ProviderError } = require('../types');
const { imageIdentifier } = require('../common');

function toServer(instance) {
  return {
    id: instance.id,
    status: instance.status ?? 'unknown',
    name: instance.label ?? null,
    ipAddress: instance.main_ip ?? null,
    imageId: instance.image_id ?? instance.os ?? null,
    metadata: { tag: instance.tag, powerStatus: instance.power_status },
  };
}

function idempotencyTag(idempotencyKey) {
  return `ch247_${String(idempotencyKey).slice(0, 30)}`;
}

/** An ISO entry that names arm64/aarch64 anywhere in its own metadata is not an x86 image. */
function namesArmArchitecture(iso) {
  return /(aarch64|arm64|arm)/i.test(`${iso.name ?? ''} ${iso.description ?? ''}`);
}

/**
 * Vultr publishes no operation called "rescue", and its documentation says rescue mode is a **bare
 * metal** portal feature; for cloud compute the documented way to repair a server that will not
 * boot is to boot the SystemRescue image from the public ISO library — the customer portal's
 * "Attach ISO and Reboot", and the API's `POST /instances/{id}/iso/attach` plus
 * `POST /instances/{id}/reboot`.
 *
 * The image is resolved from Vultr's live public ISO list at call time rather than hardcoded,
 * because the ids change as SystemRescue is updated. An entry that names no architecture is Vultr's
 * x86_64 image; an arm64 request needs an entry that names arm64/aarch64, because booting an x86
 * kernel on an ARM instance would produce a machine that cannot come up.
 */
function findSystemRescueIso(isos, architecture) {
  const candidates = isos.filter((iso) => /systemrescue/i.test(`${iso.name ?? ''} ${iso.description ?? ''}`));
  return {
    candidates,
    match: candidates.find((iso) => (architecture === 'arm64' ? namesArmArchitecture(iso) : !namesArmArchitecture(iso))),
  };
}

/** Days of bandwidth history to read; Vultr accepts 1-180 and defaults to 30. */
const VULTR_BANDWIDTH_DAYS = 30;
/** Vultr has no host-telemetry endpoint at all — monitoring graphs are a portal feature. */
const VULTR_NO_TELEMETRY = 'Vultr API v2 exposes no endpoint for this metric';

class VultrProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'vultr';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || 'VULTR';
    this.token = source[`${prefix}_API_TOKEN`] ?? source.VULTR_API_KEY;
    this.baseUrl = String(provider.api_base_url ?? source.VULTR_API_URL ?? 'https://api.vultr.com/v2').replace(/\/$/, '');
  }

  headers() {
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'Vultr API token is not configured', false);
    }
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  request(path, init = {}) {
    return providerRequest(`${this.baseUrl}${path}`, init, { headers: this.headers(), transport: this.transport });
  }

  async validateConfiguration() {
    await this.request('/account');
  }

  async createServer(input) {
    const existing = await this.findServerByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const plan = asString(input.planMetadata.providerServerType)
      ?? asString(input.planMetadata.plan)
      ?? asString(input.planMetadata.vultrPlan);
    if (!plan) throw new ProviderError('INVALID_CONFIGURATION', 'Product configuration is missing provider plan', false);
    const image = imageIdentifier(input.image);
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Vultr image identifier', false);
    const body = {
      region: input.regionCode,
      plan,
      label: input.name,
      hostname: input.hostname,
      user_data: Buffer.from(input.userData).toString('base64'),
      tags: [idempotencyTag(input.idempotencyKey)],
    };
    if (/^\d+$/.test(image)) body.os_id = Number(image);
    else body.image_id = image;
    if (input.sshPublicKeys.length > 0) body.sshkey_id = input.sshPublicKeys;
    const result = await this.request('/instances', { method: 'POST', body: JSON.stringify(body) });
    return toServer(result.instance);
  }

  provisionServer(input) { return this.createServer(input); }

  async findServerByIdempotencyKey(idempotencyKey) {
    const tag = idempotencyTag(idempotencyKey);
    const result = await this.request(`/instances?tag=${encodeURIComponent(tag)}&per_page=1`);
    const instance = result.instances?.[0];
    return instance ? toServer(instance) : null;
  }

  async deleteServer(providerServerId) {
    await this.request(`/instances/${encodeURIComponent(providerServerId)}`, { method: 'DELETE' });
  }

  rebootServer(id) { return this.request(`/instances/${encodeURIComponent(id)}/reboot`, { method: 'POST' }); }
  shutdownServer(id) { return this.request(`/instances/${encodeURIComponent(id)}/halt`, { method: 'POST' }); }
  startServer(id) { return this.request(`/instances/${encodeURIComponent(id)}/start`, { method: 'POST' }); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  getServer(id) { return this.getServerStatus(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId, planMetadata) {
    const plan = asString(planMetadata.providerServerType) ?? asString(planMetadata.plan);
    if (!plan) throw new ProviderError('INVALID_CONFIGURATION', 'Target plan missing for resize', false);
    await this.request(`/instances/${encodeURIComponent(providerServerId)}/change-plan`, {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId, description) {
    const result = await this.request('/snapshots', {
      method: 'POST',
      body: JSON.stringify({ instance_id: providerServerId, description }),
    });
    return asRecord(result.snapshot);
  }

  async deleteSnapshot(_providerServerId, snapshotId) {
    await this.request(`/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  async restoreSnapshot(providerServerId, snapshotId) {
    await this.request(`/instances/${encodeURIComponent(providerServerId)}/restore`, {
      method: 'POST',
      body: JSON.stringify({ snapshot_id: snapshotId }),
    });
  }

  async getServerStatus(providerServerId) {
    const result = await this.request(`/instances/${encodeURIComponent(providerServerId)}`);
    return toServer(result.instance);
  }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages() {
    const result = await this.request('/os');
    return (result.os ?? []).map((o) => ({
      id: String(o.id),
      name: o.name ?? null,
      architecture: o.arch === 'arm64' ? 'arm64' : 'x86_64',
      available: true,
      metadata: {},
    }));
  }

  async getImage(image) {
    const identifier = imageIdentifier(image);
    if (!identifier) return null;
    const images = await this.getAvailableImages();
    return images.find((img) => img.id === identifier || img.name === identifier) ?? null;
  }

  async reinstallServer(input) {
    const image = imageIdentifier(input.image);
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no Vultr image identifier', false);
    const body = {};
    if (/^\d+$/.test(image)) body.os_id = Number(image);
    else body.image_id = image;
    await this.request(`/instances/${encodeURIComponent(input.providerServerId)}/reinstall`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return this.getServerStatus(input.providerServerId);
  }

  /**
   * Rescue for a Vultr cloud instance is the ISO-library recovery path Vultr documents: attach the
   * SystemRescue image from the public ISO library, reboot, and use the serial console — the image
   * signs the operator in as root with no password, so there is no credential to hand back and
   * nothing that could be stored.
   */
  async enableRescue(providerServerId, input) {
    const library = await this.request('/iso-public');
    const { candidates, match } = findSystemRescueIso(library.public_isos ?? [], input.architecture);
    if (candidates.length === 0) {
      throw new ProviderError(
        'PROVIDER_ERROR',
        "Vultr's public ISO library listed no SystemRescue image, so this instance cannot be booted into rescue",
        false,
      );
    }
    if (!match?.id) {
      throw new ProviderError(
        'UNSUPPORTED_OPERATION',
        `Vultr's public ISO library offers no SystemRescue image for ${input.architecture}`,
        false,
      );
    }
    await this.request(`/instances/${encodeURIComponent(providerServerId)}/iso/attach`, {
      method: 'POST',
      body: JSON.stringify({ iso_id: match.id }),
    });
    await this.rebootServer(providerServerId);
    return {
      type: 'systemrescue-iso',
      username: 'root',
      rebooted: true,
      notes: `Vultr attached the public SystemRescue image (${match.name ?? match.id}) and rebooted the instance. Open the server console and press Enter to boot the rescue kernel; SystemRescue signs you in as root with no password. Leaving rescue mode detaches the ISO and reboots back into the installed system.`,
    };
  }

  /**
   * Detaching is the documented way out: "Vultr detaches the ISO and reboots the instance
   * automatically", which is exactly what leaving rescue means.
   */
  async disableRescue(providerServerId) {
    await this.request(`/instances/${encodeURIComponent(providerServerId)}/iso/detach`, { method: 'POST' });
  }

  /**
   * The URL is read fresh on every call and never written to a log, a job payload or an audit row —
   * it is a link to a root console.
   */
  async getConsole(providerServerId) {
    const result = await this.request(`/instances/${encodeURIComponent(providerServerId)}`);
    const url = asString(result.instance?.kvm);
    if (!url) {
      const state = asString(result.instance?.power_status) ?? asString(result.instance?.status) ?? 'unknown';
      throw new ProviderError(
        'SERVICE_UNAVAILABLE',
        `Vultr returned no KVM console URL for instance ${providerServerId} (power_status=${state})`,
        true,
      );
    }
    return { url, type: 'novnc' };
  }

  async getServerMetrics(providerServerId) {
    const payload = await this.request(
      `/instances/${encodeURIComponent(providerServerId)}/bandwidth?date_range=${VULTR_BANDWIDTH_DAYS}`,
    );
    const days = [];
    const bandwidth = payload?.bandwidth;
    if (bandwidth && typeof bandwidth === 'object') {
      for (const [date, entry] of Object.entries(bandwidth)) {
        if (!entry || typeof entry !== 'object') continue;
        const incoming = Number(entry.incoming_bytes);
        const outgoing = Number(entry.outgoing_bytes);
        if (!Number.isFinite(incoming) || !Number.isFinite(outgoing)) continue;
        days.push({ date, incomingBytes: incoming, outgoingBytes: outgoing });
      }
    }
    days.sort((a, b) => a.date.localeCompare(b.date));
    return {
      provider: 'vultr',
      instanceId: providerServerId,
      source: '/v2/instances/{instance-id}/bandwidth',
      dateRangeDays: VULTR_BANDWIDTH_DAYS,
      metrics: {
        bandwidth: {
          daysReported: days.length,
          days,
          totalIncomingBytes: days.length > 0 ? days.reduce((sum, day) => sum + day.incomingBytes, 0) : null,
          totalOutgoingBytes: days.length > 0 ? days.reduce((sum, day) => sum + day.outgoingBytes, 0) : null,
        },
      },
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

  async healthCheck(providerServerId, expectedImage) {
    try {
      const server = await this.getServerStatus(providerServerId);
      const expected = imageIdentifier(expectedImage);
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

module.exports = { VultrProviderAdapter, findSystemRescueIso };
