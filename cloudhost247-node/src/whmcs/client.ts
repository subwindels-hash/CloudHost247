/**
 * WHMCS API client: authentication, response semantics, bounded retries, circuit breaking and
 * redacted logging — the five things that turn "call an endpoint" into an integration that fails
 * safely.
 *
 * Deliberate behaviours, each with a reason:
 *
 *  - **Retries are limited to reads.** A timeout on `GetProducts` is safe to repeat; a timeout on an
 *    order or payment action is not, because the first attempt may have succeeded inside WHMCS. Write
 *    actions therefore never retry here; they must go through the idempotency ledger
 *    (`idempotency.ts`), which reconciles before it repeats.
 *  - **A circuit breaker, not infinite patience.** After `CIRCUIT_FAILURE_THRESHOLD` consecutive
 *    transport failures the client refuses requests for `CIRCUIT_COOLDOWN_MS` and answers with a
 *    typed error, so a WHMCS outage costs one timeout per window instead of one per page view.
 *  - **Nothing about the request is logged except the action, a request id, timing and the outcome.**
 *    The body carries the identifier and secret; it is never passed to a logger, an error message or
 *    a thrown object.
 *  - **WHMCS's own error text is not shown to customers.** `WhmcsApiError` keeps it for operators and
 *    `safeCustomerMessage()` phrases the customer-facing alternative.
 */

import { assertWriteAllowed, type WhmcsConfig } from './config';
import {
  WhmcsApiError,
  WhmcsCircuitOpenError,
  WhmcsHttpError,
  WhmcsMalformedResponseError,
  WhmcsSchemaError,
  WhmcsError,
  WhmcsTimeoutError,
  WhmcsUnreachableError,
} from './errors';
import { errorEnvelopeSchema } from './schemas';
import { defaultTransport, type Transport } from './transport';
import type { z } from 'zod';

export interface WhmcsLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

export const silentLogger: WhmcsLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Logger that writes structured lines through `console`. Safe: callers pass redacted fields only. */
export const consoleLogger: WhmcsLogger = {
  info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: 'warn', event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: 'error', event, ...fields })),
};

export interface WhmcsClientDeps {
  config: WhmcsConfig;
  transport?: Transport;
  logger?: WhmcsLogger;
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so backoff jitter is deterministic under test. */
  random?: () => number;
  now?: () => number;
}

export interface CallOptions {
  /** Marks a state-changing action. Refused unless `WHMCS_MODE=full`; never retried. */
  write?: boolean;
  /**
   * Marks an action that mints a *session*, not data — today only `CreateSsoToken`.
   *
   * It is allowed in `read-only` mode on purpose: read-only exists to guarantee that a staging
   * exercise cannot create an order, an invoice or a charge, and minting a 60-second single-use
   * login token for a client that is already linked does none of that. Like a write it is never
   * retried: a replayed token request would mint a second live token for no reason.
   */
  sessionAction?: boolean;
}

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_COOLDOWN_MS = 30_000;
const BASE_BACKOFF_MS = 150;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class WhmcsClient {
  private readonly transport: Transport;
  private readonly logger: WhmcsLogger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private requestCounter = 0;

  constructor(private readonly deps: WhmcsClientDeps) {
    this.transport = deps.transport ?? defaultTransport;
    this.logger = deps.logger ?? silentLogger;
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.now = deps.now ?? Date.now;
  }

  get config(): WhmcsConfig {
    return this.deps.config;
  }

  /**
   * Calls one WHMCS API action and validates the result.
   *
   * @param action   WHMCS action name, e.g. `GetProducts`
   * @param params   action parameters; values are stringified into the form body
   * @param schema   zod schema the successful payload must satisfy
   * @param options  `write: true` for state-changing actions
   */
  async call<T>(
    action: string,
    params: Record<string, string | number | boolean | undefined>,
    schema: z.ZodType<T>,
    options: CallOptions = {},
  ): Promise<T> {
    if (options.write) assertWriteAllowed(this.deps.config, action);

    // A session action changes server-side state (it mints a token), so it is never retried even
    // though it is permitted while the deployment is in read-only mode. See `CallOptions`.
    const singleShot = Boolean(options.write || options.sessionAction);

    const nowMs = this.now();
    if (nowMs < this.circuitOpenUntil) {
      throw new WhmcsCircuitOpenError(this.circuitOpenUntil - nowMs);
    }

    const requestId = this.nextRequestId();
    const maxAttempts = singleShot ? 1 : Math.max(1, this.deps.config.maxAttempts);
    let lastError: WhmcsError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = this.now();
      try {
        const payload = await this.attempt(action, params, requestId);
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          throw new WhmcsSchemaError(
            action,
            parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
          );
        }
        this.consecutiveFailures = 0;
        this.circuitOpenUntil = 0;
        this.logger.info('whmcs.call.succeeded', {
          action,
          requestId,
          attempt,
          durationMs: this.now() - startedAt,
        });
        return parsed.data as T;
      } catch (error) {
        const typed = this.asWhmcsError(action, error);
        lastError = typed;
        const willRetry = typed.retryable && !singleShot && attempt < maxAttempts;
        this.logger.warn('whmcs.call.failed', {
          action,
          requestId,
          attempt,
          durationMs: this.now() - startedAt,
          code: typed.code,
          retry: willRetry,
        });
        if (!willRetry) break;
        await this.sleep(this.backoffMs(attempt));
      }
    }

    this.recordFailure();
    throw lastError ?? new WhmcsMalformedResponseError(action, 'no attempt was made');
  }

  /** Visible for tests: whether the breaker is currently holding requests. */
  isCircuitOpen(): boolean {
    return this.now() < this.circuitOpenUntil;
  }

  private async attempt(
    action: string,
    params: Record<string, string | number | boolean | undefined>,
    requestId: string,
  ): Promise<unknown> {
    const body = new URLSearchParams();
    body.set('identifier', this.deps.config.identifier);
    body.set('secret', this.deps.config.secret);
    body.set('action', action);
    body.set('responsetype', 'json');
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      body.set(key, String(value));
    }

    const response = await this.transport.send({
      url: this.deps.config.apiUrl,
      body: body.toString(),
      timeoutMs: this.deps.config.timeoutMs,
      headers: { 'x-cloudhost247-request-id': requestId },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new WhmcsHttpError(action, response.status);
    }

    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      throw new WhmcsMalformedResponseError(action, 'response was not JSON');
    }
    if (!json || typeof json !== 'object') {
      throw new WhmcsMalformedResponseError(action, 'response was not a JSON object');
    }

    const envelope = errorEnvelopeSchema.safeParse(json);
    if (envelope.success) {
      throw new WhmcsApiError(action, envelope.data.message);
    }
    return json;
  }

  /** Maps transport/runtime failures onto the layer's taxonomy without leaking request data. */
  private asWhmcsError(action: string, error: unknown): WhmcsError {
    if (error instanceof WhmcsError) return error;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new WhmcsTimeoutError(action, this.deps.config.timeoutMs);
    }
    if (error instanceof Error) {
      return new WhmcsUnreachableError(action, error.message.slice(0, 200));
    }
    return new WhmcsUnreachableError(action, 'unknown failure');
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitOpenUntil = this.now() + CIRCUIT_COOLDOWN_MS;
      this.logger.error('whmcs.circuit.open', {
        failures: this.consecutiveFailures,
        retryAfterMs: CIRCUIT_COOLDOWN_MS,
      });
    }
  }

  private backoffMs(attempt: number): number {
    const exponential = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    const jitter = Math.floor(this.random() * BASE_BACKOFF_MS);
    return exponential + jitter;
  }

  private nextRequestId(): string {
    this.requestCounter += 1;
    return `whmcs-${this.now().toString(36)}-${this.requestCounter.toString(36)}`;
  }
}
