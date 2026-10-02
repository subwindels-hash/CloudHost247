/**
 * DNS connector error taxonomy.
 *
 * Every external DNS connector failure reaches the customer as one of these codes with a fixed,
 * client-safe message. Raw provider payloads and credentials never cross this boundary — the same
 * rule the Cloudflare integration follows (see src/integrations/cloudflare/errors.ts).
 *
 * Credential failures are fail-closed and never retried: an operator must configure the connector
 * before any live call is attempted (A11).
 */
import { HttpError } from '../lib/errors';
import { CloudflareError } from '../integrations/cloudflare/errors';

export type DnsProviderErrorCode =
  | 'DNS_PROVIDER_CONFIGURATION_REQUIRED'
  | 'DNS_PROVIDER_AUTH_FAILED'
  | 'DNS_PROVIDER_PERMISSION_DENIED'
  | 'DNS_PROVIDER_NOT_FOUND'
  | 'DNS_PROVIDER_CONFLICT'
  | 'DNS_PROVIDER_REJECTED'
  | 'DNS_PROVIDER_RATE_LIMITED'
  | 'DNS_PROVIDER_UPSTREAM_ERROR'
  | 'DNS_PROVIDER_UNSUPPORTED_OPERATION';

const HTTP_STATUS: Record<DnsProviderErrorCode, number> = {
  DNS_PROVIDER_CONFIGURATION_REQUIRED: 503,
  DNS_PROVIDER_AUTH_FAILED: 502,
  DNS_PROVIDER_PERMISSION_DENIED: 502,
  DNS_PROVIDER_NOT_FOUND: 404,
  DNS_PROVIDER_CONFLICT: 409,
  DNS_PROVIDER_REJECTED: 400,
  DNS_PROVIDER_RATE_LIMITED: 429,
  DNS_PROVIDER_UPSTREAM_ERROR: 502,
  DNS_PROVIDER_UNSUPPORTED_OPERATION: 400,
};

const SAFE_MESSAGES: Record<DnsProviderErrorCode, string> = {
  DNS_PROVIDER_CONFIGURATION_REQUIRED:
    'This DNS provider is not connected yet. An administrator must configure it before zones or records can be managed here.',
  DNS_PROVIDER_AUTH_FAILED:
    'The DNS provider credentials were rejected. An administrator must review the connector configuration.',
  DNS_PROVIDER_PERMISSION_DENIED: 'The DNS provider credentials lack permission for this operation.',
  DNS_PROVIDER_NOT_FOUND: 'The requested zone or record no longer exists at the DNS provider.',
  DNS_PROVIDER_CONFLICT: 'The DNS provider rejected this change because it conflicts with the current state there.',
  DNS_PROVIDER_REJECTED: 'The DNS provider rejected the submitted values.',
  DNS_PROVIDER_RATE_LIMITED: 'The DNS provider is rate-limiting requests. Please try again shortly.',
  DNS_PROVIDER_UPSTREAM_ERROR: 'The DNS provider could not be reached or returned an unexpected response.',
  DNS_PROVIDER_UNSUPPORTED_OPERATION: 'The DNS provider does not support this operation.',
};

export interface DnsProviderErrorOptions {
  /** Extra, client-safe context (provider name, record name, the documented reason). Never secrets. */
  detail?: string;
  /** Whether a later retry of the same request could succeed. Defaults to false. */
  retryable?: boolean;
}

export class DnsProviderError extends HttpError {
  readonly providerCode: DnsProviderErrorCode;
  readonly retryable: boolean;
  readonly detail: string | null;

  constructor(code: DnsProviderErrorCode, options: DnsProviderErrorOptions = {}) {
    const message = options.detail ? `${SAFE_MESSAGES[code]} (${options.detail})` : SAFE_MESSAGES[code];
    super(HTTP_STATUS[code], message, code);
    this.name = 'DnsProviderError';
    this.providerCode = code;
    this.detail = options.detail ?? null;
    this.retryable =
      options.retryable ?? (code === 'DNS_PROVIDER_RATE_LIMITED' || code === 'DNS_PROVIDER_UPSTREAM_ERROR');
  }

  get safeMessage(): string {
    return SAFE_MESSAGES[this.providerCode];
  }
}

export function dnsConfigurationRequired(provider: string, detail: string): DnsProviderError {
  return new DnsProviderError('DNS_PROVIDER_CONFIGURATION_REQUIRED', {
    detail: `${provider}: ${detail}`,
  });
}

export function unsupportedDnsOperation(provider: string, reason: string): DnsProviderError {
  return new DnsProviderError('DNS_PROVIDER_UNSUPPORTED_OPERATION', {
    detail: `${provider}: ${reason}`,
  });
}

export function dnsConflict(provider: string, detail: string): DnsProviderError {
  return new DnsProviderError('DNS_PROVIDER_CONFLICT', { detail: `${provider}: ${detail}` });
}

export function dnsRejected(provider: string, detail: string): DnsProviderError {
  return new DnsProviderError('DNS_PROVIDER_REJECTED', { detail: `${provider}: ${detail}` });
}

export function dnsNotFound(provider: string, detail: string): DnsProviderError {
  return new DnsProviderError('DNS_PROVIDER_NOT_FOUND', { detail: `${provider}: ${detail}` });
}

/**
 * Maps a transport/provider failure onto the taxonomy above. Only the documented, modeled error
 * names drive the mapping; anything unrecognized becomes an upstream error rather than being
 * dressed up as a customer mistake.
 */
export function mapAwsRoute53Failure(error: unknown, provider = 'ROUTE53'): DnsProviderError {
  const shape = (error ?? {}) as { name?: string; message?: string; Code?: string };
  const name = shape.name ?? shape.Code ?? '';
  const message = shape.message ?? '';

  switch (name) {
    case 'NoSuchHostedZone':
    case 'NoSuchChange':
      return dnsNotFound(provider, 'the zone no longer exists at Route 53');
    case 'HostedZoneNotEmpty':
      return dnsConflict(provider, 'the hosted zone still contains records; delete them before deleting the zone');
    case 'InvalidChangeBatch':
      if (/already exists/i.test(message)) {
        return dnsConflict(provider, 'a record set with that name and type already exists');
      }
      if (/not found|does not exist/i.test(message)) {
        return dnsNotFound(provider, 'the record set no longer exists at Route 53');
      }
      return dnsRejected(provider, 'Route 53 rejected the record set change');
    case 'InvalidInput':
    case 'InvalidDomainName':
    case 'InvalidArgument':
      return dnsRejected(provider, 'Route 53 rejected the submitted values');
    case 'AccessDenied':
    case 'AccessDeniedException':
    case 'InvalidClientTokenId':
    case 'SignatureDoesNotMatch':
    case 'AuthFailure':
    case 'UnrecognizedClientException':
      return new DnsProviderError('DNS_PROVIDER_AUTH_FAILED', { detail: `${provider}: credentials were rejected` });
    case 'Throttling':
    case 'ThrottlingException':
    case 'RequestLimitExceeded':
    case 'PriorRequestNotComplete':
      return new DnsProviderError('DNS_PROVIDER_RATE_LIMITED', { detail: `${provider}: request was throttled` });
    default:
      return new DnsProviderError('DNS_PROVIDER_UPSTREAM_ERROR', {
        detail: `${provider}: ${name ? `${name} ` : ''}request failed`,
      });
  }
}

/**
 * Maps the Cloudflare integration's error onto this taxonomy so the DNS API speaks one error
 * language regardless of connector. Unknown/validation failures keep the Cloudflare code and
 * client-safe message rather than being flattened into a generic error.
 */
export function mapCloudflareDnsFailure(error: unknown, provider = 'CLOUDFLARE'): never {
  if (!(error instanceof CloudflareError)) throw error;
  switch (error.code) {
    case 'CLOUDFLARE_CONFIGURATION_REQUIRED':
      throw dnsConfigurationRequired(provider, error.message);
    case 'CLOUDFLARE_AUTH_FAILED':
      throw new DnsProviderError('DNS_PROVIDER_AUTH_FAILED', { detail: `${provider}: credentials were rejected` });
    case 'CLOUDFLARE_PERMISSION_DENIED':
      throw new DnsProviderError('DNS_PROVIDER_PERMISSION_DENIED', {
        detail: `${provider}: the API token lacks permission for this operation`,
      });
    case 'CLOUDFLARE_FEATURE_NOT_SUPPORTED':
      throw unsupportedDnsOperation(provider, error.message);
    case 'CLOUDFLARE_ZONE_NOT_FOUND':
    case 'CLOUDFLARE_RECORD_NOT_FOUND':
      throw dnsNotFound(provider, 'the zone or record no longer exists at Cloudflare');
    case 'CLOUDFLARE_RATE_LIMITED':
      throw new DnsProviderError('DNS_PROVIDER_RATE_LIMITED', { detail: `${provider}: request was throttled` });
    default:
      throw new HttpError(
        error.statusCode,
        error.code === 'CLOUDFLARE_VALIDATION_ERROR' ? error.message : error.safeMessage,
        error.code,
      );
  }
}
