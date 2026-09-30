/**
 * Translates adapter failures into HTTP responses for the few endpoints that must talk to a
 * provider inside a request (for example issuing a short-lived console session). Provisioning
 * itself never runs in request scope — it goes through the durable queue.
 *
 * Two rules matter here:
 *  - a missing or broken provider integration is *our* problem, so it surfaces as 503/502 with a
 *    neutral customer-facing sentence rather than as a 500 stack trace or a fake success;
 *  - the provider's own message may name internal endpoints, so it is logged server-side and
 *    never returned to the browser. Only the stable error code is echoed, via the HttpError code.
 */
import { HttpError, NotFoundError, ServiceUnavailableError, UpstreamError, ValidationError } from '../../lib/errors';
import { ProviderError } from './types';

const CUSTOMER_MESSAGES: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: 'This action is unavailable because the infrastructure provider is not configured.',
  CONFIGURATION_REQUIRED: 'This action is unavailable because the infrastructure provider is not configured.',
  INVALID_CONFIGURATION: 'This action is unavailable because the infrastructure provider is not configured.',
  AUTHENTICATION_FAILED: 'This action is unavailable because the infrastructure provider rejected our credentials.',
  SERVICE_UNAVAILABLE: 'The infrastructure provider is temporarily unavailable. Please try again shortly.',
  RATE_LIMITED: 'The infrastructure provider is rate limiting requests. Please try again shortly.',
  PROVIDER_TIMEOUT: 'The infrastructure provider did not respond in time. Please try again shortly.',
  NETWORK_TEMPORARY_FAILURE: 'The infrastructure provider is temporarily unavailable. Please try again shortly.',
  INSUFFICIENT_CAPACITY: 'The infrastructure provider has no capacity for this request right now.',
};

export function providerErrorToHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (!(error instanceof ProviderError)) {
    return new UpstreamError('The infrastructure provider returned an unexpected response.');
  }
  if (error.code === 'UNSUPPORTED_OPERATION') {
    return new ValidationError('This action is not supported for this server.');
  }
  if (error.code === 'RESOURCE_NOT_FOUND') {
    return new NotFoundError('The provider no longer has a resource for this server.');
  }
  const message = CUSTOMER_MESSAGES[error.code];
  return message ? new ServiceUnavailableError(message) : new UpstreamError('The infrastructure provider returned an unexpected response.');
}
