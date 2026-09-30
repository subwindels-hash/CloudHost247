/**
 * Centralized Cloudflare API client (spec §34, §60, §62).
 *
 * Responsibilities: auth headers, timeouts, retry with exponential backoff on retryable
 * failures (429/5xx/timeouts), rate-limit detection, response-envelope validation, error
 * normalization (errors.ts), structured API logging WITHOUT secrets, and per-request
 * correlation ids. The raw token lives only inside this object in memory — it is never logged,
 * never returned, and never serialized.
 *
 * `fetchImpl` is injectable so tests exercise the full client against a scripted HTTP layer —
 * mocks exist only in tests, never as production fallbacks (spec §66).
 */
import { randomUUID } from 'node:crypto';
import { normalizeCloudflareFailure, CloudflareError, type CloudflareApiErrorEntry } from './errors';

export interface CloudflareApiLogEntry {
  requestId: string;
  operation: string;
  method: string;
  path: string;
  statusCode: number | null;
  success: boolean;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export type ApiLogSink = (entry: CloudflareApiLogEntry) => Promise<void> | void;

export interface CloudflareClientOptions {
  baseUrl: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Structured log sink (writes cloudflare_api_logs rows). Never receives the token. */
  logSink?: ApiLogSink;
  /** Sleep injection for deterministic retry tests. */
  sleep?: (ms: number) => Promise<void>;
}

interface CfEnvelope<T> {
  success: boolean;
  errors?: CloudflareApiErrorEntry[];
  result?: T;
  result_info?: { page?: number; per_page?: number; total_count?: number };
}

const RETRY_DELAYS_MS = [500, 1500, 4000];

export class CloudflareClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly logSink: ApiLogSink | null;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: CloudflareClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.logSink = options.logSink ?? null;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<T>(
    operation: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<{ result: T; resultInfo?: CfEnvelope<T>['result_info'] }> {
    const requestId = randomUUID();
    let qs = '';
    if (query) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) sp.set(k, String(v));
      }
      const s = sp.toString();
      qs = s ? `?${s}` : '';
    }
    const url = `${this.baseUrl}${path}${qs}`;

    let lastError: CloudflareError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const startedAt = Date.now();
      let statusCode: number | null = null;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            method,
            headers: {
              Authorization: `Bearer ${this.apiToken}`,
              'Content-Type': 'application/json',
              'X-Request-Id': requestId,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        statusCode = response.status;
        const payload = (await response.json().catch(() => null)) as CfEnvelope<T> | null;

        if (response.ok && payload?.success) {
          await this.log({ requestId, operation, method, path, statusCode, success: true, durationMs: Date.now() - startedAt, errorCode: null, errorMessage: null });
          return { result: payload.result as T, resultInfo: payload.result_info };
        }

        const normalized = normalizeCloudflareFailure(response.status, payload?.errors ?? []);
        lastError = normalized;
        await this.log({
          requestId, operation, method, path, statusCode,
          success: false,
          durationMs: Date.now() - startedAt,
          errorCode: normalized.code,
          errorMessage: normalized.upstreamErrors.map((e) => `${e.code ?? ''} ${e.message ?? ''}`.trim()).join('; ') || normalized.safeMessage,
        });
        if (!normalized.retryable || attempt === this.maxRetries) throw normalized;
      } catch (error) {
        if (error instanceof CloudflareError) {
          if (!error.retryable || attempt === this.maxRetries) throw error;
          lastError = error;
        } else {
          const isAbort = error instanceof Error && error.name === 'AbortError';
          const normalized = new CloudflareError(
            isAbort ? 'CLOUDFLARE_TIMEOUT' : 'CLOUDFLARE_SERVICE_UNAVAILABLE',
            error instanceof Error ? error.message : 'network failure'
          );
          lastError = normalized;
          await this.log({
            requestId, operation, method, path, statusCode,
            success: false,
            durationMs: Date.now() - startedAt,
            errorCode: normalized.code,
            errorMessage: error instanceof Error ? error.message : 'network failure',
          });
          if (attempt === this.maxRetries) throw normalized;
        }
      }
      await this.sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 4000);
    }
    /* istanbul ignore next -- loop always returns or throws */
    throw lastError ?? new CloudflareError('CLOUDFLARE_API_ERROR');
  }

  private async log(entry: CloudflareApiLogEntry): Promise<void> {
    if (!this.logSink) return;
    try {
      await this.logSink(entry);
    } catch {
      // Observability must never break the operation itself.
    }
  }
}
