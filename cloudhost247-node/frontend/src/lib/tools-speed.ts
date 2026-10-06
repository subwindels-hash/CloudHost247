import { getToken } from './auth';
import { toolsApiPath, toolsHost } from './tools-runtime';
interface Configuration {
  payload: { defaultBytes: number; maxBytes: number };
  limits: { maxUploadBytes: number; totalBudgetMs: number };
}
/** Actual browser→CloudHost247 transfers using the existing speed API. Not an ISP speed claim. */
export async function measureBrowserConnection(
  value: unknown,
  signal: AbortSignal
) {
  const config = value as Configuration;
  const bytes = Math.floor(
    Math.min(
      config.payload?.defaultBytes,
      config.payload?.maxBytes,
      config.limits?.maxUploadBytes,
      2 * 1024 * 1024
    )
  );
  const budget = Math.min(config.limits?.totalBudgetMs, 30000);
  if (
    !Number.isFinite(bytes) ||
    bytes <= 0 ||
    !Number.isFinite(budget) ||
    budget <= 0
  )
    throw new Error('The speed test configuration is invalid.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, budget);
  const token = toolsHost().embedded ? null : getToken();
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(
      toolsApiPath('/api/tools/speed-test/' + path),
      {
        ...init,
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'error',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      }
    );
    if (!response.ok)
      throw new Error(
        `Speed transfer failed (HTTP ${response.status}). No speed estimate was produced.`
      );
    return response;
  };
  try {
    const latencyMs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      await (await request('latency?sample=' + i)).json();
      latencyMs.push(performance.now() - start);
    }
    const start = performance.now();
    const downloaded = await (
      await request('download?bytes=' + bytes)
    ).arrayBuffer();
    const downloadMs = performance.now() - start;
    if (downloaded.byteLength !== bytes)
      throw new Error(
        'Incomplete speed-test download. No estimate was produced.'
      );
    const buffer = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i += 65536)
      crypto.getRandomValues(buffer.subarray(i, Math.min(i + 65536, bytes)));
    const uploadStart = performance.now();
    const received = await (
      await request('upload', {
        method: 'POST',
        body: buffer,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    ).json();
    const uploadMs = performance.now() - uploadStart;
    if (received.receivedBytes !== bytes || downloadMs <= 0 || uploadMs <= 0)
      throw new Error(
        'Incomplete speed-test upload. No estimate was produced.'
      );
    return {
      measuredAt: new Date().toISOString(),
      scope:
        'This browser to CloudHost247 only; indicative, not an ISP line-rate guarantee.',
      bytesDownloaded: bytes,
      bytesUploaded: bytes,
      downloadMbps: Number(((bytes * 8) / downloadMs / 1000).toFixed(2)),
      uploadMbps: Number(((bytes * 8) / uploadMs / 1000).toFixed(2)),
      downloadMs,
      uploadMs,
      latencyMs,
      meanLatencyMs: latencyMs.reduce((a, b) => a + b, 0) / latencyMs.length,
      jitterMs:
        (Math.abs(latencyMs[1]! - latencyMs[0]!) +
          Math.abs(latencyMs[2]! - latencyMs[1]!)) /
        2,
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
