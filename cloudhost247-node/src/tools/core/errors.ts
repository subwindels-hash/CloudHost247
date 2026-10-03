/**
 * Tools Center — error vocabulary (spec §73) and the response envelope every tool API returns.
 *
 * The rest of the platform already has an HttpError hierarchy (src/lib/errors.ts) and a global
 * error handler that renders `{ error, message }`. Tools additionally need a machine-readable
 * *tool* code, an explicit `retryable` flag and a stable envelope, because the SPA has to render
 * honest unavailable/configuration states (spec §72/§89) rather than a generic failure banner.
 *
 * ToolError extends HttpError so it still travels through the existing error handler for any
 * route that does not catch it; tool routes catch it first and emit the envelope below.
 */
import { HttpError } from '../../lib/errors';

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'DOMAIN_NOT_FOUND'
  | 'DNS_LOOKUP_FAILED'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'CONFIGURATION_REQUIRED'
  | 'PROVIDER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'CAPABILITY_UNAVAILABLE'
  | 'ACCESS_DENIED'
  | 'TARGET_BLOCKED'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

/** HTTP status per tool code. Kept in one place so every route maps identically. */
const STATUS_BY_CODE: Record<ToolErrorCode, number> = {
  INVALID_INPUT: 400,
  TARGET_BLOCKED: 400,
  ACCESS_DENIED: 403,
  DOMAIN_NOT_FOUND: 404,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFIGURATION_REQUIRED: 503,
  SERVICE_UNAVAILABLE: 503,
  CAPABILITY_UNAVAILABLE: 503,
  PROVIDER_ERROR: 502,
  DNS_LOOKUP_FAILED: 502,
  TIMEOUT: 504,
  INTERNAL_ERROR: 500,
};

/** Whether retrying the same request later could plausibly succeed. */
const RETRYABLE_BY_CODE: Record<ToolErrorCode, boolean> = {
  INVALID_INPUT: false,
  TARGET_BLOCKED: false,
  ACCESS_DENIED: false,
  DOMAIN_NOT_FOUND: false,
  NOT_FOUND: false,
  RATE_LIMITED: true,
  CONFIGURATION_REQUIRED: false,
  SERVICE_UNAVAILABLE: true,
  CAPABILITY_UNAVAILABLE: false,
  PROVIDER_ERROR: true,
  DNS_LOOKUP_FAILED: true,
  TIMEOUT: true,
  INTERNAL_ERROR: true,
};

export class ToolError extends HttpError {
  readonly code: ToolErrorCode;
  readonly retryable: boolean;
  /** Optional non-sensitive extra context (e.g. which provider slug is missing). */
  readonly detail: Record<string, unknown>;

  constructor(code: ToolErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(STATUS_BY_CODE[code], message, code);
    this.name = 'ToolError';
    this.code = code;
    this.retryable = RETRYABLE_BY_CODE[code];
    this.detail = detail;
  }
}

export const invalidInput = (message: string, detail: Record<string, unknown> = {}): ToolError =>
  new ToolError('INVALID_INPUT', message, detail);

export const targetBlocked = (message = 'This target is not permitted'): ToolError =>
  new ToolError('TARGET_BLOCKED', message);

export const configurationRequired = (what: string, detail: Record<string, unknown> = {}): ToolError =>
  new ToolError(
    'CONFIGURATION_REQUIRED',
    `${what} is not configured on this platform. A Super Admin can configure it under Admin → Tools → Providers.`,
    detail
  );

export const serviceUnavailable = (message = 'This diagnostic service is temporarily unavailable.'): ToolError =>
  new ToolError('SERVICE_UNAVAILABLE', message);

export const capabilityUnavailable = (capability: string, detail: string): ToolError =>
  new ToolError(
    'CAPABILITY_UNAVAILABLE',
    `${capability} is not available in this deployment environment. ${detail}`,
    { capability }
  );

export const timeoutError = (what: string): ToolError => new ToolError('TIMEOUT', `${what} timed out.`);

export const domainNotFound = (domain: string): ToolError =>
  new ToolError('DOMAIN_NOT_FOUND', `No DNS records could be found for "${domain}".`);

/** Success envelope shared by every tool endpoint. */
export interface ToolSuccessEnvelope<T> {
  success: true;
  tool: string;
  status: 'ACTIVE';
  generatedAt: string;
  data: T;
  meta: {
    durationMs: number;
    cached: boolean;
    /** Provider slugs / resolver names that actually produced this result (never invented). */
    sources: string[];
    /** Honest caveats: partial coverage, approximate values, environment limits. */
    warnings: string[];
    reportId?: string;
    historyId?: string;
  };
}

export interface ToolErrorEnvelope {
  success: false;
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  tool?: string;
  detail?: Record<string, unknown>;
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}

export function toErrorEnvelope(error: unknown, tool?: string): ToolErrorEnvelope {
  if (error instanceof ToolError) {
    return {
      success: false,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(tool ? { tool } : {}),
      ...(Object.keys(error.detail).length > 0 ? { detail: error.detail } : {}),
    };
  }
  return {
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred while running this tool.',
    retryable: true,
    ...(tool ? { tool } : {}),
  };
}
