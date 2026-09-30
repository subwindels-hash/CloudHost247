/**
 * Cloudflare error normalization (spec §35, §67).
 *
 * Every Cloudflare API failure is converted into a CloudflareError with a stable CloudHost247
 * code and a client-safe message. Raw Cloudflare error payloads are preserved on the error for
 * server-side logging only — routes map CloudflareError to sanitized HTTP responses and never
 * leak tokens, internal stack traces, or upstream URLs to the browser.
 */

export type CloudflareErrorCode =
  | 'CLOUDFLARE_AUTH_FAILED'
  | 'CLOUDFLARE_PERMISSION_DENIED'
  | 'CLOUDFLARE_ZONE_NOT_FOUND'
  | 'CLOUDFLARE_RECORD_NOT_FOUND'
  | 'CLOUDFLARE_RATE_LIMITED'
  | 'CLOUDFLARE_API_ERROR'
  | 'CLOUDFLARE_TIMEOUT'
  | 'CLOUDFLARE_CONFIGURATION_REQUIRED'
  | 'CLOUDFLARE_SERVICE_UNAVAILABLE'
  | 'CLOUDFLARE_FEATURE_NOT_SUPPORTED'
  | 'CLOUDFLARE_VALIDATION_ERROR';

const HTTP_STATUS: Record<CloudflareErrorCode, number> = {
  CLOUDFLARE_AUTH_FAILED: 502,
  CLOUDFLARE_PERMISSION_DENIED: 502,
  CLOUDFLARE_ZONE_NOT_FOUND: 404,
  CLOUDFLARE_RECORD_NOT_FOUND: 404,
  CLOUDFLARE_RATE_LIMITED: 429,
  CLOUDFLARE_API_ERROR: 502,
  CLOUDFLARE_TIMEOUT: 504,
  CLOUDFLARE_CONFIGURATION_REQUIRED: 503,
  CLOUDFLARE_SERVICE_UNAVAILABLE: 503,
  CLOUDFLARE_FEATURE_NOT_SUPPORTED: 400,
  CLOUDFLARE_VALIDATION_ERROR: 400,
};

const SAFE_MESSAGES: Record<CloudflareErrorCode, string> = {
  CLOUDFLARE_AUTH_FAILED: 'The Cloudflare integration credentials were rejected. An administrator must review the configuration.',
  CLOUDFLARE_PERMISSION_DENIED: 'The Cloudflare integration token lacks permission for this operation.',
  CLOUDFLARE_ZONE_NOT_FOUND: 'The Cloudflare zone for this service could not be found.',
  CLOUDFLARE_RECORD_NOT_FOUND: 'That DNS record no longer exists at Cloudflare.',
  CLOUDFLARE_RATE_LIMITED: 'Cloudflare is rate-limiting requests. Please try again shortly.',
  CLOUDFLARE_API_ERROR: 'Cloudflare reported an error processing this request.',
  CLOUDFLARE_TIMEOUT: 'Cloudflare did not respond in time. Please try again.',
  CLOUDFLARE_CONFIGURATION_REQUIRED: 'CONFIGURATION_REQUIRED',
  CLOUDFLARE_SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  CLOUDFLARE_FEATURE_NOT_SUPPORTED: 'FEATURE_NOT_SUPPORTED',
  CLOUDFLARE_VALIDATION_ERROR: 'Cloudflare rejected the submitted values.',
};

export interface CloudflareApiErrorEntry {
  code?: number;
  message?: string;
}

export class CloudflareError extends Error {
  readonly code: CloudflareErrorCode;
  readonly statusCode: number;
  /** Upstream detail for server logs only — never sent to clients verbatim by routes. */
  readonly upstreamErrors: CloudflareApiErrorEntry[];
  readonly retryable: boolean;

  constructor(code: CloudflareErrorCode, detail?: string, upstreamErrors: CloudflareApiErrorEntry[] = []) {
    super(detail ? `${SAFE_MESSAGES[code]} (${detail})` : SAFE_MESSAGES[code]);
    this.name = 'CloudflareError';
    this.code = code;
    this.statusCode = HTTP_STATUS[code];
    this.upstreamErrors = upstreamErrors;
    this.retryable = code === 'CLOUDFLARE_RATE_LIMITED' || code === 'CLOUDFLARE_TIMEOUT' || code === 'CLOUDFLARE_SERVICE_UNAVAILABLE';
  }

  /** Message that is always safe to show a customer. */
  get safeMessage(): string {
    return SAFE_MESSAGES[this.code];
  }
}

/** Cloudflare error code → normalized platform error. Documented Cloudflare codes only. */
export function normalizeCloudflareFailure(httpStatus: number, errors: CloudflareApiErrorEntry[]): CloudflareError {
  const codes = errors.map((e) => e.code ?? 0);
  const detail = errors.map((e) => e.message).filter(Boolean).join('; ') || undefined;

  if (httpStatus === 401 || codes.includes(10000) || codes.includes(6003)) {
    return new CloudflareError('CLOUDFLARE_AUTH_FAILED', detail, errors);
  }
  if (httpStatus === 403 || codes.includes(9109) || codes.includes(10001)) {
    return new CloudflareError('CLOUDFLARE_PERMISSION_DENIED', detail, errors);
  }
  if (httpStatus === 429 || codes.includes(971) || codes.includes(10100)) {
    return new CloudflareError('CLOUDFLARE_RATE_LIMITED', detail, errors);
  }
  if (httpStatus === 404 || codes.includes(1001) || codes.includes(7003)) {
    return new CloudflareError('CLOUDFLARE_ZONE_NOT_FOUND', detail, errors);
  }
  if (codes.includes(81044) || codes.includes(81004)) {
    return new CloudflareError('CLOUDFLARE_RECORD_NOT_FOUND', detail, errors);
  }
  if (httpStatus >= 500) {
    return new CloudflareError('CLOUDFLARE_SERVICE_UNAVAILABLE', detail, errors);
  }
  if (httpStatus === 400 || httpStatus === 422) {
    return new CloudflareError('CLOUDFLARE_VALIDATION_ERROR', detail, errors);
  }
  return new CloudflareError('CLOUDFLARE_API_ERROR', detail, errors);
}
