/**
 * Tools Center — connection speed test (spec §29).
 *
 * The honest architecture matters here. A server-side download measures the SERVER's link, not the
 * visitor's. So the real measurement always happens in the browser: it fetches a no-store payload
 * from CloudHost247 and uploads a buffer back, timing both, while the server only provides the
 * endpoints and the caps.
 *
 * This module therefore does two things:
 *   1. Publishes the test configuration (payload sizes, endpoints, rules) to the page.
 *   2. Runs a server-egress measurement against an operator-configured SPEED_TEST provider. That
 *      number is labelled as the SERVER's egress, never as the visitor's speed.
 */
import { performance } from 'node:perf_hooks';
import type { Queryable } from '../../db/types';
import { usableProviders } from '../core/providers';
import { fetchWithGuard } from '../core/ssrf';
import { getSetting } from '../../db/ops-tables';

export interface SpeedTestConfig {
  endpoints: { download: string; upload: string; latency: string };
  payload: { minBytes: number; maxBytes: number; defaultBytes: number; measuredBytes: number };
  limits: { maxUploadBytes: number; totalBudgetMs: number };
  rules: string[];
  serverEgress: {
    configured: boolean;
    provider: string | null;
    downloadUrl: string | null;
    status: 'MEASURED' | 'NOT_CONFIGURED' | 'ERROR';
    bitsPerSecond: number | null;
    megabytesPerSecond: number | null;
    megabytesDownloaded: number | null;
    durationMs: number | null;
    detail: string;
  };
}

const MEASURED_BYTES = 8 * 1024 * 1024;
/** Absolute hard cap. The admin setting (tools.speed_test_max_bytes) may only lower it, never raise it. */
const SPEED_TEST_ABSOLUTE_MAX_BYTES = 32 * 1024 * 1024;
const SPEED_TEST_ABSOLUTE_MAX_MS = 60_000;

/** Reads the operator-set cap, clamped to the hard limit so a bad setting cannot DoS the server. */
export async function speedTestCaps(db: Queryable): Promise<{ maxBytes: number; maxMs: number }> {
  const configuredBytes = await getSetting<number>(db, 'tools.speed_test_max_bytes', 20 * 1024 * 1024);
  const configuredMs = await getSetting<number>(db, 'tools.speed_test_max_ms', 15_000);
  const maxBytes = Number.isFinite(configuredBytes) && configuredBytes > 0
    ? Math.min(Math.floor(configuredBytes), SPEED_TEST_ABSOLUTE_MAX_BYTES)
    : SPEED_TEST_ABSOLUTE_MAX_BYTES;
  const maxMs = Number.isFinite(configuredMs) && configuredMs > 0
    ? Math.min(Math.floor(configuredMs), SPEED_TEST_ABSOLUTE_MAX_MS)
    : SPEED_TEST_ABSOLUTE_MAX_MS;
  return { maxBytes, maxMs };
}

/**
 * Fetches a configured test file and reports the throughput of THIS SERVER's connection.
 * The label in the response is deliberately blunt about what that does and does not mean.
 */
async function measureServerEgress(db: Queryable): Promise<SpeedTestConfig['serverEgress']> {
  const providers = await usableProviders(db, 'SPEED_TEST');
  const provider = providers[0] ?? null;
  if (!provider) {
    return {
      configured: false,
      provider: null,
      downloadUrl: null,
      status: 'NOT_CONFIGURED',
      bitsPerSecond: null,
      megabytesPerSecond: null,
      megabytesDownloaded: null,
      durationMs: null,
      detail: 'No SPEED_TEST provider is configured. The browser-side test works without one; this row only appears when a Super Admin wants the server\'s own egress measured (Admin → Tools → Providers).',
    };
  }
  const url = typeof provider.configuration.downloadUrl === 'string' ? provider.configuration.downloadUrl : provider.endpoint;
  if (!url) {
    return { configured: true, provider: provider.name, downloadUrl: null, status: 'ERROR', bitsPerSecond: null, megabytesPerSecond: null, megabytesDownloaded: null, durationMs: null, detail: 'The provider has no downloadUrl configured.' };
  }
  const maxBytes = typeof provider.configuration.maxBytes === 'number' ? Math.min(Math.max(provider.configuration.maxBytes, 256 * 1024), 64 * 1024 * 1024) : MEASURED_BYTES;
  const started = performance.now();
  try {
    const response = await fetchWithGuard(url, { timeoutMs: 20_000, maxBytes, userAgent: 'CloudHost247-ToolsCenter/1.0 (server egress test)' });
    const durationMs = Math.max(performance.now() - started, 1);
    const bytes = response.body.length;
    if (response.status !== 200 || bytes === 0) {
      return { configured: true, provider: provider.name, downloadUrl: url, status: 'ERROR', bitsPerSecond: null, megabytesPerSecond: null, megabytesDownloaded: bytes, durationMs: Math.round(durationMs), detail: `The provider download answered HTTP ${response.status} with ${bytes} bytes.` };
    }
    const bitsPerSecond = (bytes * 8) / (durationMs / 1000);
    return {
      configured: true,
      provider: provider.name,
      downloadUrl: url,
      status: 'MEASURED',
      bitsPerSecond: Math.round(bitsPerSecond),
      megabytesPerSecond: Math.round((bitsPerSecond / 8 / 1_000_000) * 100) / 100,
      megabytesDownloaded: Math.round((bytes / 1024 / 1024) * 100) / 100,
      durationMs: Math.round(durationMs),
      detail: 'This is the download speed of the CloudHost247 SERVER to the configured test endpoint. It has nothing to do with the speed between your browser and CloudHost247, which is what the browser-side test measures.',
    };
  } catch (error) {
    return { configured: true, provider: provider.name, downloadUrl: url, status: 'ERROR', bitsPerSecond: null, megabytesPerSecond: null, megabytesDownloaded: null, durationMs: Math.round(performance.now() - started), detail: `The server egress test failed: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
}

export async function speedTestConfig(db: Queryable, options: { measureServerEgress?: boolean } = {}): Promise<SpeedTestConfig> {
  const caps = await speedTestCaps(db);
  const serverEgress = options.measureServerEgress ? await measureServerEgress(db) : {
    configured: false,
    provider: null,
    downloadUrl: null,
    status: 'NOT_CONFIGURED' as const,
    bitsPerSecond: null,
    megabytesPerSecond: null,
    megabytesDownloaded: null,
    durationMs: null,
    detail: 'Server egress measurement was not requested for this run. It is an optional, separate measurement of the server link.',
  };

  return {
    endpoints: {
      download: '/api/tools/speed-test/download',
      upload: '/api/tools/speed-test/upload',
      latency: '/api/tools/speed-test/latency',
    },
    payload: {
      minBytes: 64 * 1024,
      maxBytes: caps.maxBytes,
      // Never ask a browser for more than the cap allows, even when the nominal measurement size is larger.
      defaultBytes: Math.min(MEASURED_BYTES, caps.maxBytes),
      measuredBytes: Math.min(MEASURED_BYTES, caps.maxBytes),
    },
    limits: { maxUploadBytes: caps.maxBytes, totalBudgetMs: caps.maxMs },
    rules: [
      'Download speed is measured by your browser fetching an uncached payload from CloudHost247 and timing the transfer; the server never stores the payload.',
      'Upload speed is measured by your browser sending a buffer to CloudHost247, which measures the request duration and discards the body immediately.',
      'Latency is the round-trip time of a tiny request, repeated; jitter is the variation between those samples.',
      'A single measurement is noise. Run it a few times, and treat the result as indicative of your connection to CloudHost247\'s network at that moment.',
    ],
    serverEgress,
  };
}

export { usableProviders as speedTestProviders };
