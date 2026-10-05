/**
 * Infrastructure provider adapter boundary: failures, shared shapes and the method list.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/types.ts. Provider identifiers and
 * credentials never cross this boundary into route handlers or browser DTOs; callers deal in
 * provider-agnostic server/image records and receive a typed ProviderError when the provider
 * refuses or cannot be reached.
 *
 * Implementations must be idempotent: createServer is paired with findServerByIdempotencyKey, so a
 * crash between provider creation and local persistence cannot allocate a second billable resource.
 */
'use strict';

const PROVIDER_FAILURE_CODES = Object.freeze([
  'PROVIDER_TIMEOUT',
  'NETWORK_TEMPORARY_FAILURE',
  'RATE_LIMITED',
  'IMAGE_UNAVAILABLE',
  'INVALID_CONFIGURATION',
  'AUTHENTICATION_FAILED',
  'INSUFFICIENT_CAPACITY',
  'PROVIDER_NOT_CONFIGURED',
  'CONFIGURATION_REQUIRED',
  'SERVICE_UNAVAILABLE',
  'RESOURCE_NOT_FOUND',
  'UNSUPPORTED_OPERATION',
  'PROVIDER_ERROR',
]);

/**
 * A provider-side failure. `retryable` is the adapter's own judgement about whether the identical
 * call could succeed later; the provisioning worker uses it to decide between retry and dead-letter.
 * `providerResponse` is evidence for the job record and is passed through sanitizeProviderResponse
 * before it is stored — it never contains request headers or credentials.
 */
class ProviderError extends Error {
  constructor(code, message, retryable = false, providerResponse = undefined) {
    super(message);
    this.name = 'ProviderError';
    this.code = PROVIDER_FAILURE_CODES.includes(code) ? code : 'PROVIDER_ERROR';
    this.retryable = retryable;
    this.providerResponse = providerResponse;
  }
}

/** Classifies a provider HTTP status into the stable failure vocabulary above. */
function classifyStatus(status) {
  if (status === 401 || status === 403) return { code: 'AUTHENTICATION_FAILED', retryable: false };
  if (status === 404) return { code: 'RESOURCE_NOT_FOUND', retryable: false };
  if (status === 409 || status === 422) return { code: 'INVALID_CONFIGURATION', retryable: false };
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true };
  if (status === 507) return { code: 'INSUFFICIENT_CAPACITY', retryable: true };
  if (status >= 500) return { code: 'NETWORK_TEMPORARY_FAILURE', retryable: true };
  return { code: 'PROVIDER_ERROR', retryable: false };
}

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Every operation the boundary defines; the unavailable fallback refuses all of them. */
const ADAPTER_METHODS = Object.freeze([
  'validateConfiguration',
  'createServer',
  'provisionServer',
  'findServerByIdempotencyKey',
  'deleteServer',
  'rebootServer',
  'shutdownServer',
  'startServer',
  'powerOnServer',
  'powerOffServer',
  'getServer',
  'getServerStatus',
  'getServerIP',
  'getAvailableImages',
  'getImage',
  'reinstallServer',
  'rebuildServer',
  'resizeServer',
  'createSnapshot',
  'deleteSnapshot',
  'restoreSnapshot',
  'getConsole',
  'enableRescue',
  'disableRescue',
  'getServerMetrics',
  'healthCheck',
]);

module.exports = {
  PROVIDER_FAILURE_CODES,
  ProviderError,
  classifyStatus,
  asRecord,
  asString,
  ADAPTER_METHODS,
};
