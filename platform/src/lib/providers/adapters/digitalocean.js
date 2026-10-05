/**
 * DigitalOcean adapter.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/digitalocean-adapter.ts. Native droplet
 * API with user-data, rebuild, resize and snapshots. There is no console: the Droplet Console and
 * the out-of-band Recovery Console are Control Panel features, and API v2 exposes no operation that
 * issues a console URL or credential — so console and rescue are refused rather than faked.
 *
 * Monitoring reads `GET /v2/monitoring/metrics/droplet/{metric}` (documented `host_id`, `start`,
 * `end` in UNIX seconds). Metrics come from the droplet's monitoring agent, so a droplet created
 * without monitoring returns `data.result: []`; every such metric is reported in `missing`, never
 * zero-filled.
 */
'use strict';

const { providerRequest } = require('../http');
const { asRecord, asString, ProviderError } = require('../types');
const { imageIdentifier, unsupportedConsole, unsupportedRescue } = require('../common');

function toServer(droplet) {
  const publicV4 = droplet.networks?.v4?.find((net) => net.type === 'public')?.ip_address ?? null;
  return {
    id: String(droplet.id),
    status: droplet.status ?? 'unknown',
    name: droplet.name ?? null,
    ipAddress: publicV4,
    imageId: droplet.image?.id ? String(droplet.image.id) : (droplet.image?.slug ?? droplet.image?.name ?? null),
    metadata: { tags: droplet.tags ?? [] },
  };
}

function idempotencyTag(idempotencyKey) {
  return `ch247_idempotency_${String(idempotencyKey).slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** One hour, the same window the Hetzner and AWS metric reads use. */
const METRIC_WINDOW_SECONDS = 60 * 60;

/**
 * The droplet metrics this adapter reads, each a documented
 * `GET /v2/monitoring/metrics/droplet/{metric}` operation. Bandwidth is deliberately not included:
 * it needs `interface` + `direction` (four combinations) and reports a billing counter rather than
 * host telemetry.
 */
const DIGITALOCEAN_METRICS = [
  'cpu', 'load_1', 'load_5', 'load_15',
  'memory_total', 'memory_available', 'filesystem_size', 'filesystem_free',
];

const MONITORING_ABSENT = 'DigitalOcean returned no datapoints for this metric (monitoring agent not enabled or not reporting)';

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Parses the documented `{ status, data: { resultType, result: [{ metric, values }] } }` envelope. */
function parseMonitoringSeries(payload) {
  const result = Array.isArray(payload?.data?.result) ? payload.data.result : [];
  const series = [];
  for (const entry of result) {
    if (!entry || typeof entry !== 'object') continue;
    const labels = {};
    if (entry.metric && typeof entry.metric === 'object') {
      for (const [key, value] of Object.entries(entry.metric)) {
        labels[key] = typeof value === 'string' ? value : String(value);
      }
    }
    const values = [];
    if (Array.isArray(entry.values)) {
      for (const point of entry.values) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const timestamp = Number(point[0]);
        const value = Number(point[1]);
        if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
        values.push({ timestamp, value });
      }
    }
    if (values.length > 0) series.push({ labels, values: values.sort((a, b) => a.timestamp - b.timestamp) });
  }
  return series;
}

/** Reduces gauge series (load, memory, filesystem) to latest/average/maximum over the window. */
function summarizeGauge(rows) {
  const points = rows.flatMap((row) => row.values);
  if (points.length === 0) return null;
  const values = points.map((point) => point.value);
  const latest = points.reduce((newest, point) => (point.timestamp >= newest.timestamp ? point : newest)).value;
  return {
    latest: roundTo(latest),
    average: roundTo(values.reduce((sum, value) => sum + value, 0) / values.length),
    maximum: roundTo(Math.max(...values)),
    samples: values.length,
  };
}

/**
 * DigitalOcean reports CPU as cumulative per-mode counters (`idle`, `user`, `system`, `iowait`,
 * `steal`, ...), not as a percentage. Utilisation over the window is therefore
 * `(Δtotal − Δidle) / Δtotal`, computed from each mode's first and last sample.
 *
 * A mode whose counter went *backwards* means the droplet rebooted inside the window, so the delta
 * is meaningless: the whole metric is reported missing rather than clamped to something plausible.
 */
function cpuUtilizationFromCounters(rows) {
  const deltas = new Map();
  for (const row of rows) {
    const mode = row.labels.mode;
    const first = row.values[0];
    const last = row.values[row.values.length - 1];
    if (!mode || row.values.length < 2 || !first || !last) continue;
    const delta = last.value - first.value;
    if (!Number.isFinite(delta) || delta < 0) return null;
    deltas.set(mode, roundTo(delta));
  }
  const idle = deltas.get('idle');
  if (deltas.size === 0 || idle === undefined) return null;
  let total = 0;
  for (const delta of deltas.values()) total += delta;
  if (total <= 0) return null;
  return { percent: roundTo(((total - idle) / total) * 100), deltas: Object.fromEntries(deltas) };
}

/**
 * Merges the `filesystem_size` and `filesystem_free` series per mountpoint. The provider labels each
 * series (device / fstype / mountpoint) and those labels are passed through untouched rather than
 * guessed at, so a droplet with several disks reports several entries.
 */
function mergeFilesystems(sizeRows, freeRows) {
  const labelKey = (labels) => JSON.stringify(
    Object.entries(labels).filter(([key]) => key !== 'host_id').sort(([a], [b]) => a.localeCompare(b)),
  );
  const merged = new Map();
  for (const [rows, field] of [[sizeRows, 'sizeBytes'], [freeRows, 'freeBytes']]) {
    for (const row of rows) {
      const key = labelKey(row.labels);
      const summary = summarizeGauge([row]);
      const entry = merged.get(key) ?? { labels: row.labels, sizeBytes: null, freeBytes: null };
      entry[field] = summary ? summary.latest : null;
      merged.set(key, entry);
    }
  }
  return [...merged.values()].map((entry) => ({
    labels: entry.labels,
    sizeBytes: entry.sizeBytes,
    freeBytes: entry.freeBytes,
    usedPercent: entry.sizeBytes !== null && entry.freeBytes !== null && entry.sizeBytes > 0
      ? roundTo(((entry.sizeBytes - entry.freeBytes) / entry.sizeBytes) * 100)
      : null,
  }));
}

class DigitalOceanProviderAdapter {
  constructor(provider, options = {}) {
    this.kind = 'digitalocean';
    this.provider = provider;
    const source = options.source ?? process.env;
    this.transport = options.transport;
    const prefix = provider.credential_env_prefix || 'DIGITALOCEAN';
    this.token = source[`${prefix}_API_TOKEN`] ?? source.DIGITALOCEAN_API_TOKEN;
    this.baseUrl = String(provider.api_base_url ?? source.DIGITALOCEAN_API_URL ?? 'https://api.digitalocean.com/v2').replace(/\/$/, '');
  }

  headers() {
    if (!this.token) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'DigitalOcean API token is not configured', false);
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
    const size = asString(input.planMetadata.providerServerType)
      ?? asString(input.planMetadata.size)
      ?? asString(input.planMetadata.digitalOceanSize);
    if (!size) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Product configuration is missing provider size', false);
    }
    const image = imageIdentifier(input.image);
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no DigitalOcean image identifier', false);
    const body = {
      name: input.name,
      region: input.regionCode,
      size,
      image,
      user_data: input.userData,
      tags: [idempotencyTag(input.idempotencyKey)],
      ipv6: true,
    };
    if (input.sshPublicKeys.length > 0) body.ssh_keys = input.sshPublicKeys;
    const result = await this.request('/droplets', { method: 'POST', body: JSON.stringify(body) });
    return toServer(result.droplet);
  }

  provisionServer(input) { return this.createServer(input); }

  async findServerByIdempotencyKey(idempotencyKey) {
    const tag = idempotencyTag(idempotencyKey);
    const result = await this.request(`/droplets?tag_name=${encodeURIComponent(tag)}&per_page=1`);
    const droplet = result.droplets?.[0];
    return droplet ? toServer(droplet) : null;
  }

  async deleteServer(providerServerId) {
    await this.request(`/droplets/${encodeURIComponent(providerServerId)}`, { method: 'DELETE' });
  }

  async action(providerServerId, type, params) {
    await this.request(`/droplets/${encodeURIComponent(providerServerId)}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type, ...params }),
    });
  }

  rebootServer(id) { return this.action(id, 'reboot'); }
  shutdownServer(id) { return this.action(id, 'shutdown'); }
  startServer(id) { return this.action(id, 'power_on'); }
  powerOnServer(id) { return this.startServer(id); }
  powerOffServer(id) { return this.shutdownServer(id); }
  getServer(id) { return this.getServerStatus(id); }
  rebuildServer(input) { return this.reinstallServer(input); }

  async resizeServer(providerServerId, planMetadata) {
    const size = asString(planMetadata.providerServerType) ?? asString(planMetadata.size);
    if (!size) throw new ProviderError('INVALID_CONFIGURATION', 'Target size missing for resize', false);
    await this.action(providerServerId, 'resize', { size, disk: true });
    return this.getServerStatus(providerServerId);
  }

  async createSnapshot(providerServerId, description) {
    const result = await this.request(`/droplets/${encodeURIComponent(providerServerId)}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type: 'snapshot', name: description }),
    });
    return asRecord(result.action);
  }

  async deleteSnapshot(_providerServerId, snapshotId) {
    await this.request(`/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  }

  async restoreSnapshot(providerServerId, snapshotId) {
    await this.action(providerServerId, 'restore', { image: snapshotId });
  }

  async getServerStatus(providerServerId) {
    const result = await this.request(`/droplets/${encodeURIComponent(providerServerId)}`);
    return toServer(result.droplet);
  }

  async getServerIP(providerServerId) {
    return (await this.getServerStatus(providerServerId)).ipAddress;
  }

  async getAvailableImages() {
    const result = await this.request('/images?type=distribution&per_page=50');
    return (result.images ?? []).map((img) => ({
      id: img.slug ?? String(img.id),
      name: img.name ?? null,
      architecture: 'x86_64',
      available: img.status === 'available',
      metadata: {},
    }));
  }

  async getImage(image) {
    const identifier = imageIdentifier(image);
    if (!identifier) return null;
    try {
      const result = await this.request(`/images/${encodeURIComponent(identifier)}`);
      return {
        id: result.image.slug ?? String(result.image.id),
        name: result.image.name ?? null,
        architecture: 'x86_64',
        available: result.image.status === 'available',
        metadata: {},
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  async reinstallServer(input) {
    const image = imageIdentifier(input.image);
    if (!image) throw new ProviderError('IMAGE_UNAVAILABLE', 'OS image has no DigitalOcean image identifier', false);
    await this.action(input.providerServerId, 'rebuild', { image });
    return this.getServerStatus(input.providerServerId);
  }

  async enableRescue() { return unsupportedRescue('digitalocean'); }
  async disableRescue() { return unsupportedRescue('digitalocean'); }

  /**
   * DigitalOcean has no console endpoint. This used to return `/droplets/{id}/actions` — the
   * droplet's *action history* — which the customer UI rendered inside a panel titled "Serial
   * console session" while the platform audited `SERVER_CONSOLE_OPENED` for a console never opened.
   */
  async getConsole() {
    return unsupportedConsole(
      'digitalocean',
      'the Droplet Console and Recovery Console are Control Panel features and API v2 has no console operation',
    );
  }

  /**
   * The read used to be `/droplets/{id}/neighbors`, which is not a metrics endpoint at all: it
   * lists *other customers' droplets sharing the same physical host*.
   */
  async getServerMetrics(providerServerId) {
    const to = Math.floor(Date.now() / 1000);
    const from = to - METRIC_WINDOW_SECONDS;
    const query = `host_id=${encodeURIComponent(providerServerId)}&start=${from}&end=${to}`;
    const collected = new Map();
    for (const metric of DIGITALOCEAN_METRICS) {
      collected.set(metric, parseMonitoringSeries(await this.request(`/monitoring/metrics/droplet/${metric}?${query}`)));
    }
    const missing = [];
    const missingReasons = {};
    const metrics = {};

    const cpu = cpuUtilizationFromCounters(collected.get('cpu') ?? []);
    if (cpu) {
      metrics.cpuPercent = cpu.percent;
      metrics.cpuCounterDeltas = cpu.deltas;
    } else {
      metrics.cpuPercent = null;
      missing.push('cpu');
      missingReasons.cpu = MONITORING_ABSENT;
    }

    for (const load of ['load_1', 'load_5', 'load_15']) {
      const summary = summarizeGauge(collected.get(load) ?? []);
      metrics[load] = summary;
      if (!summary) {
        missing.push(load);
        missingReasons[load] = MONITORING_ABSENT;
      }
    }

    const memoryTotal = summarizeGauge(collected.get('memory_total') ?? []);
    const memoryAvailable = summarizeGauge(collected.get('memory_available') ?? []);
    metrics.memoryTotalBytes = memoryTotal;
    metrics.memoryAvailableBytes = memoryAvailable;
    metrics.memoryUsedPercent = memoryTotal && memoryAvailable && memoryTotal.latest > 0
      ? roundTo(((memoryTotal.latest - memoryAvailable.latest) / memoryTotal.latest) * 100)
      : null;
    if (!memoryTotal || !memoryAvailable) {
      missing.push('memory');
      missingReasons.memory = MONITORING_ABSENT;
    }

    const filesystems = mergeFilesystems(collected.get('filesystem_size') ?? [], collected.get('filesystem_free') ?? []);
    metrics.filesystems = filesystems;
    if (filesystems.length === 0) {
      missing.push('filesystem');
      missingReasons.filesystem = MONITORING_ABSENT;
    }

    return {
      provider: 'digitalocean',
      dropletId: providerServerId,
      source: '/v2/monitoring/metrics/droplet',
      window: { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() },
      metrics,
      missing,
      missingReasons,
      note: 'Requires the DigitalOcean monitoring agent on the droplet. CPU is derived from the documented per-mode counters (delta of total minus delta of idle over the window); load and memory are read as gauges; filesystems are reported per mountpoint label exactly as the provider labels them.',
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

module.exports = { DigitalOceanProviderAdapter, DIGITALOCEAN_METRICS, parseMonitoringSeries, cpuUtilizationFromCounters };
